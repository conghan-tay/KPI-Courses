# Production deployment guide

The application is container-first. The Next web app, the Go gateway and the Python
worker are stateless and can run on Kubernetes, Cloud Run/ECS-style container platforms,
or a developer PaaS. Durable state lives in Postgres (knowledge bases) and Temporal (runs in
flight).

For a worked end-to-end example on a single managed PaaS, see
[`railway.md`](railway.md), which deploys the whole stack from a forked repository.

## Recommended managed layout

| Concern | Google Cloud | AWS |
|---|---|---|
| Containers | Cloud Run or GKE Autopilot | ECS Fargate or EKS |
| Durable execution | Temporal Cloud (or self-hosted on GKE) | Temporal Cloud (or self-hosted on EKS) |
| Knowledge bases | Cloud SQL for PostgreSQL | RDS for PostgreSQL |
| Distributed rate limit | Memorystore for Redis | ElastiCache for Redis |
| Vector store (Journey 3) | Chroma Cloud or a persistent Chroma workload | Chroma Cloud or persistent ECS/EKS workload |
| Secrets | Secret Manager | Secrets Manager |
| Images | Artifact Registry | ECR |

For the most developer-friendly first deployment, use Cloud Run for the three app
containers, Temporal Cloud, Cloud SQL and Memorystore. Only the web app and the gateway
should accept internet traffic, and the worker should accept none at all.

Two systems hold state and both need backing up, for different reasons. **Postgres** holds
the knowledge bases; losing it loses the product. **Temporal** holds runs in flight and the audit
trail of how each knowledge base was built; losing it strands any ingestion that was mid-flight,
which the gateway's boot reconciler cannot recover from because there is no longer a run
to re-attach to.

The gateway applies its migrations at boot, under a Postgres advisory lock, so rolling
several replicas at once is safe and no migration job is needed.

## Temporal

Either option works; pick before you size anything else.

- **Temporal Cloud** — set `TEMPORAL_ADDRESS` to your namespace endpoint,
  `TEMPORAL_NAMESPACE` to `<namespace>.<account>`, `TEMPORAL_API_KEY` to an API key, and
  `TEMPORAL_TLS=true`. Both the gateway and the worker need these. This is the
  lowest-operations path and is what the Kubernetes manifest assumes.
- **Self-hosted** — run a Temporal cluster with its own PostgreSQL or Cassandra
  persistence. The `temporalio/temporal server start-dev` container in `compose.yaml` is
  a development convenience only: it stores everything in a single SQLite file and is
  not a production topology.

Set a retention period on the namespace. A closed ingestion history is the record of
which sources produced which positions, and that is the first thing anyone will want when
a candidate says "I never said that" — so retention is a product decision, not only a
storage one.

`INGEST_TIMEOUT_MINUTES` bounds a whole run. It is owned by the gateway because workflow
code cannot read the environment, so it travels as a `StartWorkflowOptions` field. Size it
above the slowest realistic corpus: a run that trips it becomes a failed draft the
candidate has to retry, and retrying a fourteen-section ingestion is not free.

## Scaling

The gateway scales on request concurrency, as any HTTP service does — with one caveat: an
ingestion holds an SSE connection open for the length of the run, so concurrency here is
"candidates mid-ingestion", not "requests per second". Size connection limits and any
proxy idle timeout accordingly; the gateway itself sets no `WriteTimeout` for exactly this
reason.

The worker does not scale on requests: it polls a task queue and exposes no port, so scale
it on **task-queue backlog** (`temporal_workflow_task_schedule_to_start_latency`) and on
model latency. Two independent signals, two independent autoscaling policies.

Worker replicas are safe to scale horizontally. The pipeline holds no cross-activity
state, and every node is a pure function of the workflow state passed into it.

## The cross-language contract

The Go structs in `internal/api/types.go`, the Pydantic models in
`app/core/kb_schemas.py` and the zod schemas in `services/web/lib/types.ts` describe
the same JSON, and nothing enforces that at build time. A renamed field surfaces as a
workflow task failure or a client-side parse error at runtime. **Deploy the three services
together**, and treat a change to any one of those files as a change to all three.

The same applies to the workflow and query names in `internal/kb/runtime.go` and
`app/temporal/kb_workflow.py`: the gateway addresses the worker by string.

`make test-e2e` is what catches a drift, and it is worth running against a staging
environment rather than only in CI.

## Kubernetes

1. Build and push the images with immutable tags.
2. Copy `deploy/k8s/app.yaml`; replace image names, the Temporal endpoint, and the
   managed-service endpoints.
3. Replace the example Secret with External Secrets or your cloud secret manager.
4. Apply the manifest: `kubectl apply -f deploy/k8s/app.yaml`.
5. Put TLS and a managed WAF/API gateway in front of the `web` Service. The `gateway`
   Service should not be reachable from the internet: the web app is its only client, and
   the header it uses to say who is signed in is trusted.
6. Run the E2E suite against the public URL.

The manifest uses non-root, read-only containers. The `worker` Deployment has no `ports`
and no `Service`, and probes it with `python -m app.healthcheck`, which asserts that this
process is actually polling its task queue — a port check would prove nothing for a
worker. The gateway's readiness probe hits `/readyz`, which verifies Temporal
reachability; its liveness probe hits `/healthz`, which deliberately does not, so a
Temporal blip cannot cause a restart loop.

## Release checklist

- Pin images by digest; never deploy `latest` beyond the sample manifest.
- Rotate the API key and model keys; verify secret-manager access.
- Place OAuth/JWT validation at the web app and pass a verified subject to the gateway.
- Run unit, race, E2E, and dependency/security scans.
- Confirm the three schema files still agree; run `make test-e2e` against staging.
- Take a Postgres backup and verify a restore before the first real candidate signs up.
- Enable LangSmith tracing with a production project and sampling/redaction policy.
- Set Temporal namespace retention, alerts on task-queue backlog, and latency/error SLOs.
- Load-test with the chosen model because model latency controls overall concurrency.
- **Replace the trusted `X-Candidate-Id` header with real authentication.** Anything
  holding the gateway's API key can currently act as any seeded user.
- Set `INGEST_TIMEOUT_MINUTES` from a measured p99 of real corpora, not the default.
- Confirm `MODEL_PROVIDER` is not `fake` — the worker refuses it in production, but the
  check only fires on boot.
