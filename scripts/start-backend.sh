#!/usr/bin/env bash
# Start (or restart) the FastAPI backend on port 8000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ ! -f .env ]]; then
  echo "Missing backend/.env — copy .env.example and set GEMINI_API_KEY"
  exit 1
fi

if lsof -ti:8000 >/dev/null 2>&1; then
  echo "Stopping existing process on port 8000..."
  kill -9 $(lsof -ti:8000) 2>/dev/null || true
  sleep 1
fi

echo "Starting backend at http://0.0.0.0:8000"
exec .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
