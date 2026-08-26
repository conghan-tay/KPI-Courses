package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/example/kpi-courses/services/gateway/internal/api"
)

// querier is the read overlap between a pool and a transaction, so the helpers below
// serve Update's locked read and an ordinary read without being written twice.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const courseColumns = `
	c.id, c.specialist_id, u.name, u.bio, c.slug, c.title, c.tagline,
	c.price_cents, c.status, c.ingest_status, c.ingest_error,
	c.voice_card, c.positions, c.source_text, c.source_files,
	c.created_at, c.updated_at`

// PostgresRepository is the production Repository.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) List(
	ctx context.Context, specialistID string,
) ([]api.Course, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+courseColumns+`
		FROM courses c JOIN users u ON u.id = c.specialist_id
		WHERE c.specialist_id = $1
		ORDER BY c.created_at DESC`, specialistID)
	if err != nil {
		return nil, fmt.Errorf("list courses: %w", err)
	}
	courses, err := scanCourses(rows)
	if err != nil {
		return nil, err
	}
	if len(courses) == 0 {
		return courses, nil
	}

	// One query for every lesson in the list rather than one per course: the studio page
	// only needs a count today, but Journey 2's catalog will want the objectives, and
	// an N+1 that only shows up at ten courses is the kind that ships.
	ids := make([]string, 0, len(courses))
	for _, course := range courses {
		ids = append(ids, course.ID)
	}
	byCourse, err := r.lessonsFor(ctx, r.pool, ids)
	if err != nil {
		return nil, err
	}
	for index := range courses {
		courses[index].Lessons = byCourse[courses[index].ID]
		courses[index].Normalize()
	}
	return courses, nil
}

func (r *PostgresRepository) Get(ctx context.Context, id string) (api.Course, error) {
	return r.getBy(ctx, r.pool, "c.id = $1", id, false)
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (api.Course, error) {
	return r.getBy(ctx, r.pool, "c.slug = $1", slug, false)
}

func (r *PostgresRepository) getBy(
	ctx context.Context, q querier, where, value string, forUpdate bool,
) (api.Course, error) {
	// FOR UPDATE OF c: the join to users must not be locked too, or two ingests by the
	// same Specialist would serialise on their user row.
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE OF c"
	}
	row := q.QueryRow(ctx, `
		SELECT `+courseColumns+`
		FROM courses c JOIN users u ON u.id = c.specialist_id
		WHERE `+where+lock, value)

	course, err := scanCourse(row)
	if err != nil {
		return api.Course{}, err
	}
	byCourse, err := r.lessonsFor(ctx, q, []string{course.ID})
	if err != nil {
		return api.Course{}, err
	}
	course.Lessons = byCourse[course.ID]
	course.Normalize()
	return course, nil
}

func (r *PostgresRepository) Create(
	ctx context.Context, course api.Course,
) (api.Course, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return api.Course{}, fmt.Errorf("begin create: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	slug, err := uniqueSlug(ctx, transaction, course.Slug)
	if err != nil {
		return api.Course{}, err
	}
	course.Slug = slug
	course.Normalize()

	voiceCard, positions, sourceFiles, err := encodeDocuments(course)
	if err != nil {
		return api.Course{}, err
	}
	createdAt, updatedAt := parseTimestamp(course.CreatedAt), parseTimestamp(course.UpdatedAt)

	if _, err := transaction.Exec(ctx, `
		INSERT INTO courses (
			id, specialist_id, slug, title, tagline, price_cents, status,
			ingest_status, ingest_error, voice_card, positions, source_text,
			source_files, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		course.ID, course.SpecialistID, course.Slug, course.Title, course.Tagline,
		course.PriceCents, course.Status, course.IngestStatus, course.IngestError,
		voiceCard, positions, course.SourceText, sourceFiles, createdAt, updatedAt,
	); err != nil {
		return api.Course{}, fmt.Errorf("insert course: %w", err)
	}
	if err := replaceLessons(ctx, transaction, course.ID, course.Lessons); err != nil {
		return api.Course{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return api.Course{}, fmt.Errorf("commit create: %w", err)
	}
	return course, nil
}

func (r *PostgresRepository) Update(
	ctx context.Context, id string, mutate func(api.Course) api.Course,
) (api.Course, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return api.Course{}, fmt.Errorf("begin update: %w", err)
	}
	defer func() { _ = transaction.Rollback(ctx) }()

	current, err := r.getBy(ctx, transaction, "c.id = $1", id, true)
	if err != nil {
		return api.Course{}, err
	}

	updated := mutate(current)
	// The identity and the creation time are the store's, not the caller's: a mutate
	// that returns a different id would otherwise silently rewrite a different row.
	updated.ID = current.ID
	updated.SpecialistID = current.SpecialistID
	updated.CreatedAt = current.CreatedAt
	updated.UpdatedAt = api.Timestamp(time.Now())
	updated.Normalize()

	voiceCard, positions, sourceFiles, err := encodeDocuments(updated)
	if err != nil {
		return api.Course{}, err
	}

	if _, err := transaction.Exec(ctx, `
		UPDATE courses SET
			slug = $2, title = $3, tagline = $4, price_cents = $5, status = $6,
			ingest_status = $7, ingest_error = $8, voice_card = $9, positions = $10,
			source_text = $11, source_files = $12, updated_at = $13
		WHERE id = $1`,
		updated.ID, updated.Slug, updated.Title, updated.Tagline, updated.PriceCents,
		updated.Status, updated.IngestStatus, updated.IngestError, voiceCard, positions,
		updated.SourceText, sourceFiles, parseTimestamp(updated.UpdatedAt),
	); err != nil {
		return api.Course{}, fmt.Errorf("update course: %w", err)
	}
	if err := replaceLessons(ctx, transaction, updated.ID, updated.Lessons); err != nil {
		return api.Course{}, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return api.Course{}, fmt.Errorf("commit update: %w", err)
	}
	return updated, nil
}

func (r *PostgresRepository) ListRunning(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(
		ctx, "SELECT id FROM courses WHERE ingest_status = 'running' ORDER BY created_at",
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

// replaceLessons rewrites a course's whole lesson list.
//
// Delete-then-insert rather than a diff: reordering is the common edit, and moving
// lesson 3 to position 1 through in-place UPDATEs collides with UNIQUE (course_id, ord)
// halfway through. Courses are 5–9 lessons, so the cost of rewriting them all is
// nothing next to the cost of getting that dance wrong.
func replaceLessons(
	ctx context.Context, transaction pgx.Tx, courseID string, lessons []api.Lesson,
) error {
	if _, err := transaction.Exec(
		ctx, "DELETE FROM lessons WHERE course_id = $1", courseID,
	); err != nil {
		return fmt.Errorf("clear lessons: %w", err)
	}
	if len(lessons) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, lesson := range lessons {
		keyPoints, err := json.Marshal(lesson.KeyPoints)
		if err != nil {
			return fmt.Errorf("encode key points: %w", err)
		}
		batch.Queue(`
			INSERT INTO lessons (course_id, ord, title, objective, key_points, body_md)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			courseID, lesson.Ord, lesson.Title, lesson.Objective, keyPoints, lesson.BodyMD)
	}
	results := transaction.SendBatch(ctx, batch)
	if err := results.Close(); err != nil {
		return fmt.Errorf("insert lessons: %w", err)
	}
	return nil
}

func (r *PostgresRepository) lessonsFor(
	ctx context.Context, q querier, courseIDs []string,
) (map[string][]api.Lesson, error) {
	byCourse := map[string][]api.Lesson{}
	if len(courseIDs) == 0 {
		return byCourse, nil
	}
	rows, err := q.Query(ctx, `
		SELECT course_id, ord, title, objective, key_points, body_md
		FROM lessons WHERE course_id = ANY($1) ORDER BY course_id, ord`, courseIDs)
	if err != nil {
		return nil, fmt.Errorf("read lessons: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var courseID string
		var lesson api.Lesson
		var keyPoints []byte
		if err := rows.Scan(
			&courseID, &lesson.Ord, &lesson.Title, &lesson.Objective, &keyPoints,
			&lesson.BodyMD,
		); err != nil {
			return nil, fmt.Errorf("scan lesson: %w", err)
		}
		if err := json.Unmarshal(keyPoints, &lesson.KeyPoints); err != nil {
			return nil, fmt.Errorf("decode key points: %w", err)
		}
		lesson.Normalize()
		byCourse[courseID] = append(byCourse[courseID], lesson)
	}
	return byCourse, rows.Err()
}

// uniqueSlug resolves a collision by suffixing, matching what the JSON store it
// replaces did. The SELECT and the INSERT share a transaction, so two ingests racing on
// the same title cannot both settle on the same suffix.
func uniqueSlug(ctx context.Context, transaction pgx.Tx, desired string) (string, error) {
	rows, err := transaction.Query(
		ctx, "SELECT slug FROM courses WHERE slug = $1 OR slug LIKE $1 || '-%'", desired,
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

func encodeDocuments(course api.Course) (voiceCard, positions, sourceFiles []byte, err error) {
	if voiceCard, err = json.Marshal(course.VoiceCard); err != nil {
		return nil, nil, nil, fmt.Errorf("encode voice card: %w", err)
	}
	if positions, err = json.Marshal(course.Positions); err != nil {
		return nil, nil, nil, fmt.Errorf("encode positions: %w", err)
	}
	if sourceFiles, err = json.Marshal(course.SourceFiles); err != nil {
		return nil, nil, nil, fmt.Errorf("encode source files: %w", err)
	}
	return voiceCard, positions, sourceFiles, nil
}

func scanCourses(rows pgx.Rows) ([]api.Course, error) {
	defer rows.Close()
	courses := []api.Course{}
	for rows.Next() {
		course, err := scanCourse(rows)
		if err != nil {
			return nil, err
		}
		courses = append(courses, course)
	}
	return courses, rows.Err()
}

// scanCourse works for both pgx.Row and pgx.Rows, which is why it takes the narrow
// interface rather than either concrete type.
func scanCourse(row interface{ Scan(dest ...any) error }) (api.Course, error) {
	var course api.Course
	var voiceCard, positions, sourceFiles []byte
	var createdAt, updatedAt time.Time

	err := row.Scan(
		&course.ID, &course.SpecialistID, &course.SpecialistName, &course.SpecialistBio,
		&course.Slug, &course.Title, &course.Tagline, &course.PriceCents, &course.Status,
		&course.IngestStatus, &course.IngestError, &voiceCard, &positions,
		&course.SourceText, &sourceFiles, &createdAt, &updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.Course{}, ErrNotFound
	}
	if err != nil {
		return api.Course{}, fmt.Errorf("scan course: %w", err)
	}

	if err := json.Unmarshal(voiceCard, &course.VoiceCard); err != nil {
		return api.Course{}, fmt.Errorf("decode voice card: %w", err)
	}
	if err := json.Unmarshal(positions, &course.Positions); err != nil {
		return api.Course{}, fmt.Errorf("decode positions: %w", err)
	}
	if err := json.Unmarshal(sourceFiles, &course.SourceFiles); err != nil {
		return api.Course{}, fmt.Errorf("decode source files: %w", err)
	}
	course.CreatedAt = api.Timestamp(createdAt)
	course.UpdatedAt = api.Timestamp(updatedAt)
	course.Normalize()
	return course, nil
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
