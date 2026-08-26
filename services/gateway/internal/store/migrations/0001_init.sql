-- The data model from POC_UserJourney.md §1, restricted to what Journey 1 needs.
-- Journeys 2 and 3 add enrollments, progress, messages and asks alongside these.

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('specialist', 'seeker')),
    bio        TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT ''
);

-- The two seeded rows behind the dev-mode SIGN IN AS switcher. They must stay in step
-- with services/web/lib/seed.ts, which is what the cookie names. Dana Mercado is the
-- specialist in docs/productDocs/fixtures/source.md, so the seeded identity and the
-- fixture course belong to the same person.
INSERT INTO users (id, name, role, bio) VALUES
    (
        'user-dana',
        'Dana Mercado',
        'specialist',
        'Eleven years selling industrial pumps into procurement departments. Six years running a 30-person B2B services firm. Now fixes pricing for services businesses doing $1M–$20M.'
    ),
    (
        'user-sam',
        'Sam Okonkwo',
        'seeker',
        'Runs a 12-person branding studio. Keeps losing deals at the proposal stage.'
    )
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS courses (
    id            TEXT PRIMARY KEY,
    specialist_id TEXT NOT NULL REFERENCES users (id),
    slug          TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    tagline       TEXT NOT NULL DEFAULT '',
    price_cents   INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    status        TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    -- Not in the POC data model. It exists because "ingestion timeout → keep the draft,
    -- offer retry" needs somewhere to record that a draft is mid-flight or broken.
    ingest_status TEXT NOT NULL CHECK (ingest_status IN ('running', 'ready', 'failed')),
    ingest_error  TEXT NOT NULL DEFAULT '',
    -- Positions and the voice card are documents the review screen edits wholesale, so
    -- they stay JSONB exactly as POC_UserJourney.md §1 has them. Lessons get a table
    -- because Journey 3 addresses them individually by ordinal.
    voice_card    JSONB NOT NULL DEFAULT '{}'::JSONB,
    positions     JSONB NOT NULL DEFAULT '[]'::JSONB,
    source_text   TEXT NOT NULL DEFAULT '',
    source_files  JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS courses_specialist_created_idx
    ON courses (specialist_id, created_at DESC);

-- Partial index: the boot reconciler asks for exactly this set, and it is nearly always
-- empty.
CREATE INDEX IF NOT EXISTS courses_running_idx
    ON courses (id) WHERE ingest_status = 'running';

CREATE TABLE IF NOT EXISTS lessons (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id  TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    ord        INTEGER NOT NULL CHECK (ord >= 1),
    title      TEXT NOT NULL,
    objective  TEXT NOT NULL DEFAULT '',
    key_points JSONB NOT NULL DEFAULT '[]'::JSONB,
    body_md    TEXT NOT NULL DEFAULT '',
    UNIQUE (course_id, ord)
);

CREATE INDEX IF NOT EXISTS lessons_course_ord_idx ON lessons (course_id, ord);
