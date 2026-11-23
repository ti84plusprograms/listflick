#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -z "${E2E_DATABASE_URL:-}" ]]; then
  echo "Set E2E_DATABASE_URL to a dedicated local PostgreSQL database whose name contains 'e2e'." >&2
  exit 1
fi

export APP_ENV=e2e
export E2E_MODE=true
export E2E_REQUIRE_BYOK_UI="${E2E_REQUIRE_BYOK_UI:-false}"
export DATABASE_URL="${E2E_DATABASE_URL}"
export UPLOAD_DIR="${REPO_ROOT}/backend/.e2e/uploads"
export AI_PROVIDER=gemini
export ALLOW_SERVER_AI_KEY_FALLBACK=false
export GEMINI_API_KEY=
export GROQ_API_KEY=
export SUPABASE_URL=
export SUPABASE_SERVICE_ROLE_KEY=
export NOTION_CREATE_ENTRIES=false
export NOTION_ALLOW_CLIENT_OVERRIDE=false
export NOTION_API_KEY=
export NOTION_DATA_SOURCE_ID=
export NOTION_DATABASE_ID=

if lsof -ti:8000 >/dev/null 2>&1; then
  echo "Stopping existing process on port 8000..."
  kill -9 $(lsof -ti:8000) 2>/dev/null || true
  sleep 1
fi

cd "${REPO_ROOT}/backend"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
