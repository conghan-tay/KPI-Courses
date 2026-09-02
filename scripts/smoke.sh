#!/usr/bin/env sh
# The shortest proof the stack is wired: health, then one ingestion end to end.
#
# With MODEL_PROVIDER=fake (the compose default) this replays
# docs/productDocs/fixtures and takes a few seconds. Against a real provider it
# takes a couple of minutes and costs money.
set -eu

base_url="${GATEWAY_URL:-http://localhost:8080}"
api_key="${API_KEY:-local-api-key}"
fixtures="${FIXTURE_DIR:-docs/productDocs/fixtures}"

curl --fail --silent --show-error "$base_url/healthz"
echo

# The gateway takes text, not files: turning an upload into text is the web app's
# job (services/web/lib/extract.ts). The "# SOURCE FILE:" header is what the
# graph splits the corpus back apart on.
python3 - "$fixtures" > /tmp/ingest-request.json <<'PY'
import json, os, sys

fixtures = sys.argv[1]
names = [
    "resume.md",
    "agoda-supplier-payouts.md",
    "agoda-psp-routing.md",
    "agoda-reconciliation.md",
    "postgres-notes.md",
    "nodusart-advisory.md",
    "career-notes.md",
]
parts = []
for name in names:
    with open(os.path.join(fixtures, name), encoding="utf-8") as handle:
        parts.append(f"# SOURCE FILE: {name}\n\n{handle.read()}")

json.dump({
    "title": "Smoke Test Candidate",
    "tagline": "Payments engineer. Eleven years, four employers, one gap.",
    "source_text": "\n\n---\n\n".join(parts),
    "source_files": names,
}, sys.stdout)
PY

# --no-buffer so the status lines arrive as the graph produces them, which is the
# whole point of the endpoint.
curl --fail --silent --show-error --no-buffer \
  -H "X-API-Key: $api_key" \
  -H "X-Candidate-Id: user-arun" \
  -H "Content-Type: application/json" \
  --data @/tmp/ingest-request.json \
  "$base_url/v1/knowledge-bases/ingest"
