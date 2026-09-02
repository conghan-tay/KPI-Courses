package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.temporal.io/sdk/client"

	"github.com/example/reverse-interview/services/gateway/internal/config"
	"github.com/example/reverse-interview/services/gateway/internal/httpapi"
	"github.com/example/reverse-interview/services/gateway/internal/kb"
	"github.com/example/reverse-interview/services/gateway/internal/knowledge"
	"github.com/example/reverse-interview/services/gateway/internal/store"
)

const shutdownGrace = 20 * time.Second

// healthcheck makes the binary its own container healthcheck.
//
// The runtime image is distroless: no shell, no curl, no wget. Rather than
// reintroduce a shell just to probe a port, the process probes itself.
var healthcheck = flag.Bool("healthcheck", false, "probe /healthz and exit")

func main() {
	flag.Parse()
	if *healthcheck {
		os.Exit(probe())
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("gateway stopped", "error", err)
		os.Exit(1)
	}
}

func probe() int {
	port := os.Getenv("GATEWAY_PORT")
	if port == "" {
		port = "8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, "unhealthy:", err)
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "unhealthy: status", response.StatusCode)
		return 1
	}
	return 0
}

func run(logger *slog.Logger) error {
	cfg, err := config.FromEnvironment()
	if err != nil {
		return err
	}

	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelStartup()

	pool, err := pgxpool.New(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(startupCtx); err != nil {
		return err
	}
	// Applied at boot rather than by an init container: one schema file, one place it
	// can go wrong, and the advisory lock inside makes concurrent replicas safe.
	if err := store.Migrate(startupCtx, pool); err != nil {
		return err
	}
	repository := store.NewPostgresRepository(pool)

	temporalClient, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
		Credentials: func() client.Credentials {
			if cfg.TemporalAPIKey == "" {
				return nil
			}
			return client.NewAPIKeyStaticCredentials(cfg.TemporalAPIKey)
		}(),
		ConnectionOptions: client.ConnectionOptions{TLS: tlsConfig(cfg)},
		Logger:            logger,
	})
	if err != nil {
		return err
	}
	defer temporalClient.Close()

	redisOptions, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	runtime := kb.NewTemporalRuntime(
		temporalClient, cfg.TemporalTaskQueue, cfg.IngestTimeout,
	)
	ingestor := kb.NewIngestor(kb.IngestorOptions{
		Repository: repository,
		Runtime:    runtime,
		Logger:     logger,
		// A watcher and a stream both outlive the workflow's own deadline by a minute,
		// so a run that times out is recorded as failed rather than abandoned.
		MaxStream: cfg.IngestTimeout + time.Minute,
	})
	// A crash or a deploy mid-ingestion leaves drafts in "running" with nobody waiting
	// on them. Re-attach before serving, so the studio is never lying about a knowledge base.
	if err := ingestor.Reconcile(startupCtx); err != nil {
		logger.Warn("could not re-attach to in-flight ingestions", "error", err)
	}

	httpClient := &http.Client{Timeout: cfg.RequestTimeout}
	embedder := knowledge.NewOpenAIEmbedder(
		cfg.OpenAIBaseURL, cfg.OpenAIAPIKey, cfg.EmbeddingModel, httpClient,
	)
	knowledgeRepository := knowledge.NewChromaRepository(
		knowledge.ChromaConfig{
			BaseURL:    cfg.ChromaURL,
			Tenant:     cfg.ChromaTenant,
			Database:   cfg.ChromaDatabase,
			Collection: cfg.ChromaCollection,
		},
		embedder,
		httpClient,
	)

	handler := httpapi.New(httpapi.Options{
		APIKey:     cfg.APIKey,
		Repository: repository,
		Ingestor:   ingestor,
		Runtime:    runtime,
		Knowledge:  knowledgeRepository,
		Health:     healthChecker{temporalClient},
		Limiter:    httpapi.NewRedisRateLimiter(redisClient, cfg.RateLimit, time.Minute),
		Logger:     logger,
		Timeout:    cfg.RequestTimeout,
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       60 * time.Second,
		// No WriteTimeout. The ingestion stream stays open for minutes by design, and a
		// server-wide write deadline would sever it mid-status-line. Each handler
		// bounds itself instead: short routes through the request context, the stream
		// through the ingestor's own deadline.
		IdleTimeout: 120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info(
			"gateway listening",
			"address", server.Addr,
			"temporal", cfg.TemporalAddress,
			"task_queue", cfg.TemporalTaskQueue,
		)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		// Drain in-flight requests so a deploy does not sever a caller mid-response. An
		// ingestion in flight is unaffected either way: it is durable, and the next
		// process re-attaches to it on boot.
		logger.Info("gateway shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func tlsConfig(cfg config.Config) *tls.Config {
	// Temporal Cloud requires TLS and is always reached with an API key, so enabling
	// TLS implicitly for keyed connections avoids a confusing misconfiguration.
	if !cfg.TemporalTLS && cfg.TemporalAPIKey == "" {
		return nil
	}
	return &tls.Config{MinVersion: tls.VersionTLS12}
}

// healthChecker adapts the Temporal client to the handler's readiness interface.
type healthChecker struct {
	client client.Client
}

func (h healthChecker) CheckHealth(ctx context.Context) error {
	_, err := h.client.CheckHealth(ctx, &client.CheckHealthRequest{})
	return err
}
