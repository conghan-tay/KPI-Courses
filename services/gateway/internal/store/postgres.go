package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/example/reverse-interview/services/gateway/internal/api"
)

// querier is the read overlap between a pool and a transaction, so the helpers below
// serve Update's locked read and an ordinary read without being written twice.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const kbColumns = `
	k.id, k.candidate_id, u.name, u.bio, k.slug, k.title, k.tagline,
	k.status, k.ingest_status, k.ingest_error,
	k.pre_roll, k.chips, k.quiz, k.source_text, k.source_files,
	k.created_at, k.updated_at`

// PostgresRepository is the production Repository.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) List(
	ctx context.Context, candidateID string,
) ([]api.KnowledgeBase, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+kbColumns+`
		FROM knowledge_bases k JOIN users u ON u.id = k.candidate_id
		WHERE k.candidate_id = $1
		ORDER BY k.created_at DESC`, candidateID)
	if err != nil {
		return nil, fmt.Errorf("list knowledge bases: %w", err)
	}
	stored, err := scanKnowledgeBases(rows)
	if err != nil {
		return nil, err
	}
	if len(stored) == 0 {
		return stored, nil
	}

	// One query for every section in the list rather than one per knowledge base: the
	// studio page only needs a count today, but Journey 2 will want the summaries, and
	// an N+1 that only shows up at ten rows is the kind that ships.
	ids := make([]string, 0, len(stored))
	for _, knowledgeBase := range stored {
		ids = append(ids, knowledgeBase.ID)
	}
	byKB, err := r.sectionsFor(ctx, r.pool, ids)
	if err != nil {
		return nil, err
	}
	for index := range stored {
		stored[index].Sections = byKB[stored[index].ID]
		stored[index].Normalize()
	}
	return stored, nil
}

func (r *PostgresRepository) Get(ctx context.Context, id string) (api.KnowledgeBase, error) {
	return r.getBy(ctx, r.pool, "k.id = $1", id, false)
}

func (r *PostgresRepository) GetBySlug(
	ctx context.Context, slug string,
) (api.KnowledgeBase, error) {
	return r.getBy(ctx, r.pool, "k.slug = $1", slug, false)
}

func (r *PostgresRepository) getBy(
	ctx context.Context, q querier, where, value string, forUpdate bool,
) (api.KnowledgeBase, error) {
	// FOR UPDATE OF k: the join to users must not be locked too, or two ingests by the
	// same candidate would serialise on their user row.
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF k"
	}
	row := q.QueryRow(ctx, `
		SELECT `+kbColumns+`
		FROM knowledge_bases k JOIN users u ON u.id = k.candidate_id
		WHERE `+where+lock, value)

	knowledgeBase, err := scanKnowledgeBase(row)
	if err != nil {
		return api.KnowledgeBase{}, err
	}
	byKB, err := r.sectionsFor(ctx, q, []string{knowledgeBase.ID})
	if err != nil {
		return api.KnowledgeBase{}, err
	}
	knowledgeBase.Sections = byKB[knowledgeBase.ID]
	knowledgeBase.Normalize()
	return knowledgeBase, nil
}

func (r *PostgresRepository) Create(
	ctx context.Context, knowledgeBase api.KnowledgeBase,
) (api.KnowledgeBase, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("begin create: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	slug, err := uniqueSlug(ctx, transaction, knowledgeBase.Slug)
	if err != nil {
		return api.KnowledgeBase{}, err
	}
	knowledgeBase.Slug = slug
	knowledgeBase.Normalize()

	encoded, err := encodeDocuments(knowledgeBase)
	if err != nil {
		return api.KnowledgeBase{}, err
	}
	createdAt := parseTimestamp(knowledgeBase.CreatedAt)
	updatedAt := parseTimestamp(knowledgeBase.UpdatedAt)

	if _, err := transaction.Exec(ctx, `
		INSERT INTO knowledge_bases (
			id, candidate_id, slug, title, tagline, status,
			ingest_status, ingest_error, pre_roll, chips, quiz, source_text,
			source_files, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		knowledgeBase.ID, knowledgeBase.CandidateID, knowledgeBase.Slug,
		knowledgeBase.Title, knowledgeBase.Tagline, knowledgeBase.Status,
		knowledgeBase.IngestStatus, knowledgeBase.IngestError,
		encoded.preRoll, encoded.chips, encoded.quiz,
		knowledgeBase.SourceText, encoded.sourceFiles, createdAt, updatedAt,
	); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("insert knowledge base: %w", err)
	}
	if err := replaceSections(
		ctx, transaction, knowledgeBase.ID, knowledgeBase.Sections,
	); err != nil {
		return api.KnowledgeBase{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("commit create: %w", err)
	}
	return knowledgeBase, nil
}

func (r *PostgresRepository) Update(
	ctx context.Context, id string, mutate func(api.KnowledgeBase) api.KnowledgeBase,
) (api.KnowledgeBase, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("begin update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	current, err := r.getBy(ctx, transaction, "k.id = $1", id, true)
	if err != nil {
		return api.KnowledgeBase{}, err
	}

	updated := mutate(current)
	// The identity and the creation time are the store's, not the caller's: a mutate
	// that returns a different id would otherwise silently rewrite a different row.
	updated.ID = current.ID
	updated.CandidateID = current.CandidateID
	updated.CreatedAt = current.CreatedAt
	updated.UpdatedAt = api.Timestamp(time.Now())
	updated.Normalize()

	encoded, err := encodeDocuments(updated)
	if err != nil {
		return api.KnowledgeBase{}, err
	}

	if _, err := transaction.Exec(ctx, `
		UPDATE knowledge_bases SET
			slug = $2, title = $3, tagline = $4, status = $5,
			ingest_status = $6, ingest_error = $7, pre_roll = $8, chips = $9,
			quiz = $10, source_text = $11, source_files = $12, updated_at = $13
		WHERE id = $1`,
		updated.ID, updated.Slug, updated.Title, updated.Tagline, updated.Status,
		updated.IngestStatus, updated.IngestError, encoded.preRoll, encoded.chips,
		encoded.quiz, updated.SourceText, encoded.sourceFiles,
		parseTimestamp(updated.UpdatedAt),
	); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("update knowledge base: %w", err)
	}
	if err := replaceSections(ctx, transaction, updated.ID, updated.Sections); err != nil {
		return api.KnowledgeBase{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("commit update: %w", err)
	}
	return updated, nil
}

func (r *PostgresRepository) ListRunning(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(
		ctx,
		"SELECT id FROM knowledge_bases WHERE ingest_status = 'running' ORDER BY created_at",
	)
	if err != nil {
		return nil, fmt.Errorf("list running ingestions: %w", err)
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan running ingestion: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *PostgresRepository) User(ctx context.Context, id string) (api.User, error) {
	var user api.User
	err := r.pool.QueryRow(
		ctx, "SELECT id, name, role, bio, avatar_url FROM users WHERE id = $1", id,
	).Scan(&user.ID, &user.Name, &user.Role, &user.Bio, &user.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.User{}, ErrUnknownUser
	}
	if err != nil {
		return api.User{}, fmt.Errorf("read user: %w", err)
	}
	return user, nil
}

// replaceSections rewrites a knowledge base's whole section list.
//
// Delete-then-insert rather than a diff: reordering is a common edit, and moving section
// 3 to position 1 through in-place UPDATEs collides with UNIQUE (kb_id, ord) halfway
// through. A knowledge base is 8–16 sections, so the cost of rewriting them all is
// nothing next to the cost of getting that dance wrong.
func replaceSections(
	ctx context.Context, transaction pgx.Tx, kbID string, sections []api.Section,
) error {
	if _, err := transaction.Exec(
		ctx, "DELETE FROM kb_sections WHERE kb_id = $1", kbID,
	); err != nil {
		return fmt.Errorf("clear sections: %w", err)
	}
	if len(sections) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, section := range sections {
		sourceNames, err := json.Marshal(section.SourceNames)
		if err != nil {
			return fmt.Errorf("encode source names: %w", err)
		}
		batch.Queue(`
			INSERT INTO kb_sections (
				kb_id, ord, path, anchor, title, summary, body_md, source_names
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			kbID, section.Ord, section.Path, section.Anchor, section.Title,
			section.Summary, section.BodyMD, sourceNames)
	}
	results := transaction.SendBatch(ctx, batch)
	if err := results.Close(); err != nil {
		return fmt.Errorf("insert sections: %w", err)
	}
	return nil
}

func (r *PostgresRepository) sectionsFor(
	ctx context.Context, q querier, kbIDs []string,
) (map[string][]api.Section, error) {
	byKB := map[string][]api.Section{}
	if len(kbIDs) == 0 {
		return byKB, nil
	}
	rows, err := q.Query(ctx, `
		SELECT kb_id, ord, path, anchor, title, summary, body_md, source_names
		FROM kb_sections WHERE kb_id = ANY($1) ORDER BY kb_id, ord`, kbIDs)
	if err != nil {
		return nil, fmt.Errorf("read sections: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var kbID string
		var section api.Section
		var sourceNames []byte
		if err := rows.Scan(
			&kbID, &section.Ord, &section.Path, &section.Anchor, &section.Title,
			&section.Summary, &section.BodyMD, &sourceNames,
		); err != nil {
			return nil, fmt.Errorf("scan section: %w", err)
		}
		if err := json.Unmarshal(sourceNames, &section.SourceNames); err != nil {
			return nil, fmt.Errorf("decode source names: %w", err)
		}
		section.Normalize()
		byKB[kbID] = append(byKB[kbID], section)
	}
	return byKB, rows.Err()
}

// uniqueSlug resolves a collision by suffixing. The SELECT and the INSERT share a
// transaction, so two ingests racing on the same display name cannot both settle on the
// same suffix.
func uniqueSlug(ctx context.Context, transaction pgx.Tx, desired string) (string, error) {
	rows, err := transaction.Query(
		ctx,
		"SELECT slug FROM knowledge_bases WHERE slug = $1 OR slug LIKE $1 || '-%'",
		desired,
	)
	if err != nil {
		return "", fmt.Errorf("read slugs: %w", err)
	}
	defer rows.Close()

	taken := map[string]bool{}
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return "", fmt.Errorf("scan slug: %w", err)
		}
		taken[slug] = true
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if !taken[desired] {
		return desired, nil
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s-%d", desired, suffix)
		if !taken[candidate] {
			return candidate, nil
		}
	}
}

// encodedDocuments is the JSONB half of a knowledge-base row. The pre-roll, the chips
// and the quiz stay documents because the review screen edits each of them wholesale;
// sections get a table because Journey 2 addresses them individually.
type encodedDocuments struct {
	preRoll     []byte
	chips       []byte
	quiz        []byte
	sourceFiles []byte
}

func encodeDocuments(knowledgeBase api.KnowledgeBase) (encodedDocuments, error) {
	var encoded encodedDocuments
	var err error
	if encoded.preRoll, err = json.Marshal(knowledgeBase.PreRoll); err != nil {
		return encodedDocuments{}, fmt.Errorf("encode pre-roll: %w", err)
	}
	if encoded.chips, err = json.Marshal(knowledgeBase.Chips); err != nil {
		return encodedDocuments{}, fmt.Errorf("encode chips: %w", err)
	}
	if encoded.quiz, err = json.Marshal(knowledgeBase.Quiz); err != nil {
		return encodedDocuments{}, fmt.Errorf("encode quiz: %w", err)
	}
	if encoded.sourceFiles, err = json.Marshal(knowledgeBase.SourceFiles); err != nil {
		return encodedDocuments{}, fmt.Errorf("encode source files: %w", err)
	}
	return encoded, nil
}

func scanKnowledgeBases(rows pgx.Rows) ([]api.KnowledgeBase, error) {
	defer rows.Close()
	stored := []api.KnowledgeBase{}
	for rows.Next() {
		knowledgeBase, err := scanKnowledgeBase(rows)
		if err != nil {
			return nil, err
		}
		stored = append(stored, knowledgeBase)
	}
	return stored, rows.Err()
}

// scanKnowledgeBase works for both pgx.Row and pgx.Rows, which is why it takes the
// narrow interface rather than either concrete type.
func scanKnowledgeBase(row interface{ Scan(dest ...any) error }) (api.KnowledgeBase, error) {
	var knowledgeBase api.KnowledgeBase
	var preRoll, chips, quiz, sourceFiles []byte
	var createdAt, updatedAt time.Time

	err := row.Scan(
		&knowledgeBase.ID, &knowledgeBase.CandidateID, &knowledgeBase.CandidateName,
		&knowledgeBase.CandidateBio, &knowledgeBase.Slug, &knowledgeBase.Title,
		&knowledgeBase.Tagline, &knowledgeBase.Status, &knowledgeBase.IngestStatus,
		&knowledgeBase.IngestError, &preRoll, &chips, &quiz,
		&knowledgeBase.SourceText, &sourceFiles, &createdAt, &updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.KnowledgeBase{}, ErrNotFound
	}
	if err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("scan knowledge base: %w", err)
	}

	if err := json.Unmarshal(preRoll, &knowledgeBase.PreRoll); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("decode pre-roll: %w", err)
	}
	if err := json.Unmarshal(chips, &knowledgeBase.Chips); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("decode chips: %w", err)
	}
	if err := json.Unmarshal(quiz, &knowledgeBase.Quiz); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("decode quiz: %w", err)
	}
	if err := json.Unmarshal(sourceFiles, &knowledgeBase.SourceFiles); err != nil {
		return api.KnowledgeBase{}, fmt.Errorf("decode source files: %w", err)
	}
	knowledgeBase.CreatedAt = api.Timestamp(createdAt)
	knowledgeBase.UpdatedAt = api.Timestamp(updatedAt)
	knowledgeBase.Normalize()
	return knowledgeBase, nil
}

// parseTimestamp turns the RFC 3339 strings the API carries back into a time for the
// database. An unparseable value means a bug upstream, and defaulting to now keeps the
// row writable rather than failing an ingest over a timestamp.
func parseTimestamp(value string) time.Time {
	at, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Now().UTC()
	}
	return at.UTC()
}
