#!/usr/bin/env sh
# The shortest proof the stack is wired: health, then one ingestion end to end.
#
# With MODEL_PROVIDER=fake (the compose default) this replays
# docs/productDocs/fixtures and takes a few seconds. Against a real provider it
# takes a couple of minutes and costs money.
set -eu

base_url="${GATEWAY_URL:-http://localhost:8080}"
api_key="${API_KEY:-local-api-key}"
source_file="${SOURCE_FILE:-docs/productDocs/fixtures/source.md}"

curl --fail --silent --show-error "$base_url/healthz"
echo

# The gateway takes text, not files: turning an upload into text is the web app's
# job (services/web/lib/extract.ts). The "# SOURCE FILE:" header is what the
# graph splits the corpus back apart on.
python3 - "$source_file" > /tmp/ingest-request.json <<'PY'
import json, sys
body = open(sys.argv[1], encoding="utf-8").read()
json.dump({
    "title": "Smoke Test Course",
    "tagline": "The deal is won or lost long before anyone says a price.",
    "price_cents": 34900,
    "source_text": f"# SOURCE FILE: source.md\n\n{body}",
    "source_files": ["source.md"],
}, sys.stdout)
PY

# --no-buffer so the status lines arrive as the graph produces them, which is the
# whole point of the endpoint.
curl --fail --silent --show-error --no-buffer \
  -H "X-API-Key: $api_key" \
  -H "X-Specialist-Id: user-dana" \
  -H "Content-Type: application/json" \
  --data @/tmp/ingest-request.json \
  "$base_url/v1/courses/ingest"
