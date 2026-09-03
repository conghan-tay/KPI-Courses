// Command seed puts the reference knowledge base in the studio without running a model.
//
// It is opt-in: an empty studio is a designed screen ("Nothing here yet. Build one."),
// and a demo that starts with somebody else's knowledge base already in it is a worse
// demo. Run it when you want the review screen populated in one second instead of ninety.
//
//	go run ./cmd/seed            # from services/gateway, with DATABASE_URL set
//	make seed-kb
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/example/reverse-interview/services/gateway/internal/api"
	"github.com/example/reverse-interview/services/gateway/internal/kb"
	"github.com/example/reverse-interview/services/gateway/internal/store"
)

// The header services/web/lib/extract.ts writes between concatenated uploads. The corpus
// is rebuilt with it here so [RETRY INGESTION] on a seeded knowledge base runs the same
// read loop a real upload would, rather than seeing one giant document.
const sourceHeader = "# SOURCE FILE: "

// fixtureFiles is the reference corpus, in the order the dropzone sends it.
var fixtureFiles = []string{
	"resume.md",
	"agoda-supplier-payouts.md",
	"agoda-psp-routing.md",
	"agoda-reconciliation.md",
	"postgres-notes.md",
	"nodusart-advisory.md",
	"career-notes.md",
}

// fixture is docs/productDocs/fixtures/expected.json: the reference output of one
// ingestion run, alongside the metadata resume.md's frontmatter carries.
type fixture struct {
	KnowledgeBase struct {
		Slug    string `json:"slug"`
		Title   string `json:"title"`
		Tagline string `json:"tagline"`
	} `json:"kb"`
	Sections []api.Section  `json:"sections"`
	Chips    []api.Chip     `json:"chips"`
	Quiz     []api.QuizItem `json:"quiz"`
	PreRoll  api.PreRoll    `json:"pre_roll"`
}

func main() {
	fixtureDir := flag.String(
		"fixtures", envOr("FIXTURE_DIR", "../../docs/productDocs/fixtures"),
		"directory holding expected.json and the source documents",
	)
	candidateID := flag.String(
		"candidate", "user-arun", "seeded candidate to own the knowledge base",
	)
	flag.Parse()

	if err := run(*fixtureDir, *candidateID); err != nil {
		fmt.Fprintln(os.Stderr, "seed failed:", err)
		os.Exit(1)
	}
}

func run(fixtureDir, candidateID string) error {
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
	source, err := readCorpus(fixtureDir)
	if err != nil {
		return err
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

	user, err := repository.User(ctx, candidateID)
	if err != nil {
		return fmt.Errorf("resolve %s: %w", candidateID, err)
	}

	now := api.Timestamp(time.Now())
	draft := kb.NewDraft(kb.NewKBID(), user, api.IngestRequest{
		Title:       loaded.KnowledgeBase.Title,
		Tagline:     loaded.KnowledgeBase.Tagline,
		SourceText:  source,
		SourceFiles: fixtureFiles,
	}, now)
	// Straight to "ready": this is what an ingestion would have produced, so the
	// knowledge base lands in exactly the state the review screen expects.
	seeded := kb.ApplyIngestResult(draft, api.IngestResult{
		Sections: loaded.Sections,
		Chips:    loaded.Chips,
		Quiz:     loaded.Quiz,
		PreRoll:  loaded.PreRoll,
	})

	created, err := repository.Create(ctx, seeded)
	if err != nil {
		return fmt.Errorf("write knowledge base: %w", err)
	}
	fmt.Printf(
		"seeded %s (%d sections, %d chips, %d quiz items) at /studio/%s\n",
		created.Slug, len(created.Sections), len(created.Chips), len(created.Quiz),
		created.ID,
	)
	return nil
}

// readCorpus rebuilds what joinCorpus in services/web/lib/extract.ts would have sent.
func readCorpus(fixtureDir string) (string, error) {
	parts := make([]string, 0, len(fixtureFiles))
	for _, name := range fixtureFiles {
		body, err := os.ReadFile(filepath.Join(fixtureDir, name))
		if err != nil {
			return "", fmt.Errorf("read %s: %w", name, err)
		}
		parts = append(parts, sourceHeader+name+"\n\n"+string(body))
	}
	return strings.Join(parts, "\n\n---\n\n"), nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
