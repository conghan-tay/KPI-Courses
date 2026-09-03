-- The data model from POC_UserJourney.md §1, restricted to what Journey 1 needs.
-- Journeys 2 and 3 add recruiters, sessions, messages, gate_attempts and bookings
-- alongside these.
--
-- NOTE: migrate.go records applied migrations in schema_migrations, so editing this file
-- does NOT re-run it against a database that has already seen it. `make down` (or
-- `docker compose down -v`) once after a schema change here.

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('candidate', 'recruiter')),
    bio        TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT ''
);

-- The two seeded rows behind the dev-mode SIGN IN AS switcher. They must stay in step
-- with services/web/lib/seed.ts, which is what the cookie names. Arun Velasco is the
-- candidate in docs/productDocs/fixtures/, so the seeded identity and the fixture
-- knowledge base belong to the same person.
INSERT INTO users (id, name, role, bio) VALUES
    (
        'user-arun',
        'Arun Velasco',
        'candidate',
        'Payments engineer. Five and a half years on supplier payouts at Agoda — virtual card issuance, PSP failover, nightly reconciliation. Eleven years, four employers, one gap he will tell you about.'
    ),
    (
        'user-priya',
        'Priya Raman',
        'recruiter',
        'Technical recruiting for a card issuer. Screens twelve backend engineers a week and would rather screen three.'
    )
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge_bases (
    id            TEXT PRIMARY KEY,
    candidate_id  TEXT NOT NULL REFERENCES users (id),
    slug          TEXT NOT NULL UNIQUE,
    -- The candidate's display name, and the one line under it. There is no price:
    -- POC_UserJourney.md §0 fixes pricing at the platform level ($3 + model cost per
    -- hour, $20 for twenty minutes), so it is copy rather than data.
    title         TEXT NOT NULL,
    tagline       TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL CHECK (status IN ('draft', 'published')),
    -- Not a product concept. It exists because "ingestion timeout → keep the draft,
    -- offer retry" needs somewhere to record that a draft is mid-flight or broken.
    ingest_status TEXT NOT NULL CHECK (ingest_status IN ('running', 'ready', 'failed')),
    ingest_error  TEXT NOT NULL DEFAULT '',
    -- The pre-roll, the chips and the quiz are documents the review screen edits
    -- wholesale, so they stay JSONB. Sections get a table because Journey 2 addresses
    -- them individually, by id.
    pre_roll      JSONB NOT NULL DEFAULT '{}'::JSONB,
    chips         JSONB NOT NULL DEFAULT '[]'::JSONB,
    quiz          JSONB NOT NULL DEFAULT '[]'::JSONB,
    source_text   TEXT NOT NULL DEFAULT '',
    source_files  JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_bases_candidate_created_idx
    ON knowledge_bases (candidate_id, created_at DESC);

-- Partial index: the boot reconciler asks for exactly this set, and it is nearly always
-- empty.
CREATE INDEX IF NOT EXISTS knowledge_bases_running_idx
    ON knowledge_bases (id) WHERE ingest_status = 'running';

CREATE TABLE IF NOT EXISTS kb_sections (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id        TEXT NOT NULL REFERENCES knowledge_bases (id) ON DELETE CASCADE,
    ord          INTEGER NOT NULL CHECK (ord >= 1),
    -- Together these form the id every chip and quiz item cites: "path", or
    -- "path#anchor". The uniqueness constraint is load-bearing rather than tidy — two
    -- sections sharing an id turn every reference to it into a coin flip between two
    -- different bodies.
    path         TEXT NOT NULL CHECK (path <> ''),
    anchor       TEXT NOT NULL DEFAULT '',
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    body_md      TEXT NOT NULL DEFAULT '',
    source_names JSONB NOT NULL DEFAULT '[]'::JSONB,
    UNIQUE (kb_id, ord),
    UNIQUE (kb_id, path, anchor)
);

CREATE INDEX IF NOT EXISTS kb_sections_kb_ord_idx ON kb_sections (kb_id, ord);
