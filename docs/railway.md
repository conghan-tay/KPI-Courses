# Railway deployment guide

A concrete, reproducible path for running this project on [Railway](https://railway.com) from a
forked repository. [`deployment.md`](deployment.md) covers the portable Kubernetes and GCP/AWS
mapping; this guide covers a single managed PaaS end to end, including the CLI behaviour that will
otherwise cost you an afternoon.

## Service topology

Railway builds each service from the same repository root, selecting a different Dockerfile per
service. Only the **web** app receives a public domain.

| Railway service | Source | Port | Exposure |
|---|---|---|---|
| `web` | repo, `services/web/Dockerfile` | 3000 | Public domain |
| `gateway` | repo, `services/gateway/Dockerfile` | 8080 | Private |
| `worker` | repo, `services/agent/Dockerfile` | none | Private, no port at all |
| `Postgres` | Railway managed | 5432 | Private |
| `Redis` | Railway managed | 6379 | Private |

The gateway is **not** public, and that is not tidiness. It trusts the `X-Candidate-Id` header its
caller sends — the server-side half of the `SIGN IN AS` switcher — so anything that can reach it
with the API key can act as any user. The web app is its only legitimate client until real
authentication replaces that header. See the README.

Durable execution comes from **Temporal Cloud**, not from a Railway service. Running a Temporal
cluster on Railway is possible but is a poor use of a PaaS: it wants its own database, several
roles, and careful upgrades. Temporal Cloud's free tier is sufficient here.

Postgres is required. It holds the knowledge bases, and losing it loses the product. Temporal holds runs in
flight and the record of how each knowledge base was built.

`chroma` and `mcp-tools` are in `compose.yaml` but are **not** deployed here. Nothing in Journey 1
reads a vector or calls a tool; they exist for Journey 3. Deploy them when you build it.

Services reach each other over Railway's private network at `<service>.railway.internal`.
Environments created after 2025-10-16 resolve those names to both IPv4 and IPv6, so the existing
`0.0.0.0` binds work unmodified. Older environments are IPv6-only and would require binding `::`.

## Plan sizing

Railway's free plan allows **five services**. This topology needs three repo-backed services —
`web`, `gateway`, `worker` — plus managed Postgres and Redis. That is exactly five.

## Prerequisites

1. Fork the repository. A fork is a new repository and does **not** inherit Railway's GitHub App
   grant — authorize it explicitly under **New → GitHub Repo → Configure GitHub App**.
2. Install and authenticate the CLI. Managed databases and volumes are CLI-only; they are not
   exposed over the Railway MCP server.
3. Create a Temporal Cloud namespace and an API key.
4. Have a model key ready, or accept that `MODEL_PROVIDER=fake` is refused in production — see
   `Settings.reject_demo_production_configuration`.

```bash
railway login
railway init --name reverse-interview-fork      # creates and links the project
railway status --json
```

## 1. Generate production secrets

The gateway rejects the demo credential once `ENVIRONMENT=production`, in
`config.FromEnvironment` (`services/gateway/internal/config/config.go`). The worker rejects the
fixture model in production, in `Settings.reject_demo_production_configuration`
(`services/agent/app/core/settings.py`).

```bash
openssl rand -hex 32 > api_key.txt        # shared by the web app and the gateway
```

One shared secret. The web app sends it as `GATEWAY_API_KEY`; the gateway checks it as `API_KEY`.

## 2. Provision stateful services first

```bash
railway add --database postgres --json
railway add --database redis --json
```

Always pass `--json`. Without it a successful create writes nothing to stdout, and a blind retry
silently provisions a second database.

Confirm the generated connection variables, because `${{Service.VAR}}` references are
case-sensitive:

```bash
railway variable list --service Postgres --json    # DATABASE_URL
railway variable list --service Redis --json       # REDIS_URL
```

There is no migration step to run. The gateway applies its embedded migrations at boot under a
Postgres advisory lock, so several replicas starting at once is safe.

## 3. Create the application services

```bash
railway add --service worker  --repo YOURUSER/YOURFORK --branch main --json
railway add --service gateway --repo YOURUSER/YOURFORK --branch main --json
railway add --service web     --repo YOURUSER/YOURFORK --branch main \
  --variables "PORT=3000" --json
```

Each of these triggers an immediate deploy that **will fail**. See
[CLI behaviour worth knowing](#cli-behaviour-worth-knowing) below.

Then set build and deploy configuration per service:

| Service | `dockerfilePath` | `watchPatterns` | Healthcheck |
|---|---|---|---|
| `web` | `services/web/Dockerfile` | `services/web/**` | `/studio` |
| `gateway` | `services/gateway/Dockerfile` | `services/gateway/**` | `/readyz` |
| `worker` | `services/agent/Dockerfile` | `services/agent/**`, `pyproject.toml`, `uv.lock`, `docs/productDocs/fixtures/**` | none |

The `worker` service must have **no healthcheck and no port**. Railway's healthchecks are HTTP
probes, and the worker serves no HTTP; configuring one guarantees a failed deploy. Railway reports
the service healthy as long as the process stays up. To check it properly, use the container-level
command the Compose and Kubernetes setups use:

```bash
railway run --service worker python -m app.healthcheck
```

Leave `rootDirectory` unset. The Python Dockerfiles `COPY pyproject.toml uv.lock ./` and
`COPY docs/productDocs/fixtures` from the repository root, and the web Dockerfile copies from
`services/web`, so scoping the build root breaks them.

Watch patterns matter here because all three services share one repository. Without them every push
rebuilds all three — and the worker genuinely does depend on `docs/productDocs/fixtures`, which is
why it is in that list.

## 4. Set variables

`worker`:

```
ENVIRONMENT=production
MODEL_PROVIDER=anthropic
MODEL_NAME=claude-opus-5
ANTHROPIC_API_KEY=<key>
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=reverse-interview-railway
LANGSMITH_API_KEY=<key>
TEMPORAL_ADDRESS=<namespace>.<account>.tmprl.cloud:7233
TEMPORAL_NAMESPACE=<namespace>.<account>
TEMPORAL_API_KEY=<temporal cloud api key>
TEMPORAL_TLS=true
TEMPORAL_TASK_QUEUE=kb-ingest
MAX_LESSONS=9
MAX_POSITIONS=8
```

`gateway`:

```
ENVIRONMENT=production
PORT=8080
GATEWAY_PORT=8080
API_KEY=<generated>
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
TEMPORAL_ADDRESS=<namespace>.<account>.tmprl.cloud:7233
TEMPORAL_NAMESPACE=<namespace>.<account>
TEMPORAL_API_KEY=<temporal cloud api key>
TEMPORAL_TLS=true
TEMPORAL_TASK_QUEUE=kb-ingest
INGEST_TIMEOUT_MINUTES=20
```

`web`:

```
PORT=3000
API_BASE_URL=http://gateway.railway.internal:8080
GATEWAY_API_KEY=<generated>
```

Two variables must be **identical** across services or the system misbehaves quietly:
`TEMPORAL_TASK_QUEUE` (or the gateway starts work nothing will pick up), and the API key — set once
as `API_KEY` on the gateway and as `GATEWAY_API_KEY` on the web app.

`API_BASE_URL` must **not** be `NEXT_PUBLIC_API_BASE_URL`. A public variable is inlined into the
client bundle at build time, and the gateway has no public domain to reach.

Use the literal `.railway.internal` hostname rather than `${{gateway.RAILWAY_PRIVATE_DOMAIN}}`; the
reference syntax is unreliable for some service names.

Pipe secrets through stdin so they never reach shell history:

```bash
tr -d '\n' < api_key.txt | railway variable set API_KEY --stdin --service gateway
tr -d '\n' < api_key.txt | railway variable set GATEWAY_API_KEY --stdin --service web
```

## 5. Expose only the web app

```bash
railway domain --service web --port 3000 --json
```

Never generate a domain for `gateway` or `worker`. The gateway trusts its caller's claim about who
is signed in; a public domain on it is an authentication bypass, not a convenience.

## 6. Deploy

Redeploy in dependency order:

```bash
railway redeploy --service worker  --from-source --yes
railway redeploy --service gateway --from-source --yes
railway redeploy --service web     --from-source --yes
```

A queued build is not a deploy. Poll each service until it reaches a terminal state:

```bash
railway deployment list --service worker --environment production --limit 1 --json
```

The gateway's first boot applies the migrations and seeds the two dev users. Watch for it:

```bash
railway logs --service gateway --lines 100
```

## Verification

```bash
curl -sS https://<your-domain>/studio                            # 200, the empty studio
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://<your-domain>/api/kb                              # 200 through the proxy
```

Then walk Journey 1 in a browser: `BUILD A COURSE`, drop
`docs/productDocs/fixtures/source.md`, and watch the ingestion panel. With a real model this takes
90–150 seconds and streams one status line per document and one per section.

Confirm the gateway is genuinely unreachable from outside:

```bash
railway domain list --service gateway --json    # expect no domains
railway domain list --service worker --json     # expect no domains
```

The proof that durable execution works is a **worker restart mid-ingestion**:

```bash
# start an ingestion in the browser, then, while it is running:
railway redeploy --service worker --yes
# the run resumes on the new container and the knowledge base still lands
```

And a **gateway restart mid-ingestion**, which exercises the boot reconciler:

```bash
railway redeploy --service gateway --yes
# the browser loses its stream, but the knowledge base still reaches `ready`:
# the new container re-attaches a completion watcher to every in-flight run.
```

Watch the same run in the Temporal Cloud UI. Its history shows one activity per source file and one
per section, each with its own retry policy — which is the visible proof that a flaky call on section
four does not restart the ingestion.

Build logs:

```bash
railway logs --service worker --environment production --build --lines 200
```

## CLI behaviour worth knowing

- **The first deploy of every repo-backed service fails, by design of the ordering.**
  `railway add --repo` deploys immediately, before `dockerfilePath` can be set, so Railpack runs
  instead of Docker, detects a language, finds no start command, and errors. This is expected; set
  the configuration, then `railway redeploy --from-source`. Do not debug the first failure.
- **`railway environment edit --service-config` can silently no-op.** Setting `build.builder`
  through it exited 0 and changed nothing. Use the Railway MCP server or the dashboard. Setting
  `dockerfilePath` switches the builder to `DOCKERFILE` on its own, so `builder` never needs to be
  set explicitly.
- **`railway volume add` has no `--service` flag.** Supplying one at the parent level panics the
  CLI. Run `railway service link <service>` first, then `railway volume add --mount-path ...`.
- **`railway variable delete` rejects `--yes` and `--skip-deploys`**, which `railway variable set`
  accepts. Passing them makes the command do nothing without an obvious error.
- **Read configuration back after every mutation.** Several operations above exit 0 without
  applying. `railway environment config --json` and `railway variable list --json` are the source
  of truth, not command exit codes.

## Notes and caveats

- **Replace the trusted `X-Candidate-Id` header before real users.** Everything above assumes the
  gateway is private and its only caller is the web app. That assumption is the whole authorization
  model right now.
- An ingestion holds an SSE connection open for the length of the run. If you put a proxy or CDN in
  front of the web app, check its idle timeout: anything under `INGEST_TIMEOUT_MINUTES` will sever
  the status stream mid-run. The run still completes — the gateway persists from a watcher that
  outlives the request — but the candidate watches a stalled panel.
- Scale `worker` freely. The pipeline holds no cross-activity state, and every node is a pure
  function of the workflow state passed into it.
- `GET /readyz` verifies Temporal reachability. `/healthz` deliberately does not, so a Temporal blip
  cannot cause a restart loop.
- Back up Postgres and verify a restore before the first real candidate signs up. Set a retention
  period on the Temporal namespace: closed histories are the record of which sources produced which
  positions.
- `.env` is gitignored and is not copied by any Dockerfile, so local secrets never enter the images.
- Rotate the API key and the Temporal API key on a schedule.
