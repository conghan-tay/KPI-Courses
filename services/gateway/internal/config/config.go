package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config contains only edge-service concerns: how to reach the database, the agent
// runtime and the knowledge store, plus the policies the public API enforces. Model and
// graph configuration belongs to the worker and never leaks into this process.
type Config struct {
	Environment string
	Port        string
	APIKey      string
	DatabaseURL string
	RedisURL    string
	RateLimit   int
	// RequestTimeout bounds a single gateway->dependency call. It is not the agent's
	// working time: ingestion is durable and continues past any HTTP request.
	RequestTimeout time.Duration

	TemporalAddress   string
	TemporalNamespace string
	TemporalTaskQueue string
	TemporalAPIKey    string
	TemporalTLS       bool

	// IngestTimeout bounds a whole ingestion run. It is owned here rather than by the
	// worker because workflow code cannot read the environment, so the deadline travels
	// as a StartWorkflowOptions field. It also bounds how long one SSE response stays
	// open and how long a completion watcher lives.
	IngestTimeout time.Duration

	ChromaURL        string
	ChromaTenant     string
	ChromaDatabase   string
	ChromaCollection string
	OpenAIBaseURL    string
	OpenAIAPIKey     string
	// EmbeddingModel must match EMBEDDING_MODEL on the worker if anything ever reads
	// these vectors back.
	EmbeddingModel string
}

func FromEnvironment() (Config, error) {
	rateLimit, err := envInt("RATE_LIMIT_PER_MINUTE", 60)
	if err != nil {
		return Config{}, err
	}
	ingestTimeoutMinutes, err := envInt("INGEST_TIMEOUT_MINUTES", 20)
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Environment: envOr("ENVIRONMENT", "development"),
		Port:        envOr("GATEWAY_PORT", "8080"),
		APIKey:      envOr("API_KEY", "local-api-key"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    envOr("REDIS_URL", "redis://localhost:6379/0"),
		RateLimit:   rateLimit,
		// Ingestion does not use this: it starts a workflow and streams. This bounds
		// the short calls — a database read, a query, a publish.
		RequestTimeout: 30 * time.Second,

		TemporalAddress:   envOr("TEMPORAL_ADDRESS", "localhost:7233"),
		TemporalNamespace: envOr("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue: envOr("TEMPORAL_TASK_QUEUE", "course-ingest"),
		TemporalAPIKey:    os.Getenv("TEMPORAL_API_KEY"),
		TemporalTLS:       envOr("TEMPORAL_TLS", "false") == "true",

		IngestTimeout: time.Duration(ingestTimeoutMinutes) * time.Minute,

		ChromaURL:        envOr("CHROMA_URL", "http://localhost:8000"),
		ChromaTenant:     envOr("CHROMA_TENANT", "default_tenant"),
		ChromaDatabase:   envOr("CHROMA_DATABASE", "default_database"),
		ChromaCollection: envOr("CHROMA_COLLECTION", "kb_sections_vectors"),
		OpenAIBaseURL:    envOr("OPENAI_BASE_URL", "https://api.openai.com"),
		OpenAIAPIKey:     os.Getenv("OPENAI_API_KEY"),
		EmbeddingModel:   envOr("EMBEDDING_MODEL", "text-embedding-3-small"),
	}
	if cfg.APIKey == "" {
		return Config{}, fmt.Errorf("API_KEY must not be empty")
	}
	if cfg.Environment == "production" && cfg.APIKey == "local-api-key" {
		return Config{}, fmt.Errorf("demo API keys are not allowed in production")
	}
	if cfg.DatabaseURL == "" {
		// There is no in-memory fallback on purpose. A gateway that silently starts
		// without a database is one that loses every course somebody publishes.
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.IngestTimeout <= 0 {
		return Config{}, fmt.Errorf("INGEST_TIMEOUT_MINUTES must be greater than zero")
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer: %w", key, err)
	}
	if value < 0 {
		return 0, fmt.Errorf("%s must not be negative", key)
	}
	return value, nil
}
