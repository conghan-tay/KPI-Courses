// Command seed puts the reference course in the studio without running a model.
//
// It is opt-in: an empty studio is a designed screen ("No courses yet. Make one."), and
// a demo that starts with somebody else's course already in it is a worse demo. Run it
// when you want the review screen populated in one second instead of ninety.
//
//	go run ./cmd/seed            # from services/gateway, with DATABASE_URL set
//	make seed-course
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/example/kpi-courses/services/gateway/internal/api"
	"github.com/example/kpi-courses/services/gateway/internal/courses"
	"github.com/example/kpi-courses/services/gateway/internal/store"
)

// fixture is docs/productDocs/fixtures/expected.json: the reference output of one
// ingestion run, alongside the course metadata source.md's frontmatter carries.
type fixture struct {
	Course struct {
		Slug       string `json:"slug"`
		Title      string `json:"title"`
		Tagline    string `json:"tagline"`
		PriceCents int    `json:"price_cents"`
	} `json:"course"`
	Lessons   []api.Lesson   `json:"lessons"`
	Positions []api.Position `json:"positions"`
	VoiceCard api.VoiceCard  `json:"voice_card"`
}

func main() {
	fixtureDir := flag.String(
		"fixtures", envOr("FIXTURE_DIR", "../../docs/productDocs/fixtures"),
		"directory holding expected.json and source.md",
	)
	specialistID := flag.String("specialist", "user-dana", "seeded specialist to own the course")
	flag.Parse()

	if err := run(*fixtureDir, *specialistID); err != nil {
		fmt.Fprintln(os.Stderr, "seed failed:", err)
		os.Exit(1)
	}
}

func run(fixtureDir, specialistID string) error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}

	expected, err := os.ReadFile(filepath.Join(fixtureDir, "expected.json"))
	if err != nil {
		return fmt.Errorf("read expected.json: %w", err)
	}
	var loaded fixture
	if err := json.Unmarshal(expected, &loaded); err != nil {
		return fmt.Errorf("parse expected.json: %w", err)
	}
	// The real corpus, so the review screen's quote-anchor check has something to check
	// against and [RETRY INGESTION] on this course would actually work.
	source, err := os.ReadFile(filepath.Join(fixtureDir, "source.md"))
	if err != nil {
		return fmt.Errorf("read source.md: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool); err != nil {
		return err
	}
	repository := store.NewPostgresRepository(pool)

	user, err := repository.User(ctx, specialistID)
	if err != nil {
		return fmt.Errorf("resolve %s: %w", specialistID, err)
	}

	now := api.Timestamp(time.Now())
	draft := courses.NewDraft(courses.NewCourseID(), user, api.IngestRequest{
		Title:       loaded.Course.Title,
		Tagline:     loaded.Course.Tagline,
		PriceCents:  loaded.Course.PriceCents,
		SourceText:  string(source),
		SourceFiles: []string{"source.md"},
	}, now)
	// Straight to "ready": this is what an ingestion would have produced, so the course
	// lands in exactly the state the review screen expects.
	seeded := courses.ApplyIngestResult(draft, api.IngestResult{
		Lessons:   loaded.Lessons,
		Positions: loaded.Positions,
		VoiceCard: loaded.VoiceCard,
	})

	created, err := repository.Create(ctx, seeded)
	if err != nil {
		return fmt.Errorf("write course: %w", err)
	}
	fmt.Printf(
		"seeded %s (%d lessons, %d positions) at /studio/%s\n",
		created.Slug, len(created.Lessons), len(created.Positions), created.ID,
	)
	return nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
