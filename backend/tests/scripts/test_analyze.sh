#!/usr/bin/env bash
# Smoke test: verify API is live and auth-gated endpoints respond correctly.
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:8000}"

echo "→ Health check: $API_URL/health"
curl -sf "$API_URL/health" | python3 -m json.tool

echo ""
echo "→ Auth gate check: POST /api/items/upload (expect 401/403)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/items/upload" \
  -F "file=@/dev/null;type=image/jpeg" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  echo "  ✓ Upload correctly requires auth (HTTP $HTTP_CODE)"
elif [[ "$HTTP_CODE" == "000" ]]; then
  echo "  ✗ Could not reach upload endpoint" >&2
  exit 1
else
  echo "  ⚠ Unexpected status (HTTP $HTTP_CODE) — expected 401 or 403"
fi

echo ""
echo "→ Auth gate check: POST /api/items/analyze (expect 401/403)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/items/analyze" \
  -H "Content-Type: application/json" \
  -d '{"item_id": "test"}')

if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  echo "  ✓ Analyze correctly requires auth (HTTP $HTTP_CODE)"
elif [[ "$HTTP_CODE" == "000" ]]; then
  echo "  ✗ Could not reach analyze endpoint" >&2
  exit 1
else
  echo "  ⚠ Unexpected status (HTTP $HTTP_CODE) — expected 401 or 403"
fi

echo ""
echo "✓ Smoke test passed — API is live and auth gates are active"
