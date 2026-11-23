#!/usr/bin/env bash
# Run from anywhere — live API smoke test.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/backend/tests/scripts/test_analyze.sh" "$@"
