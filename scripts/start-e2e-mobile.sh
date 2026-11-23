#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}/mobile"
export EXPO_NO_DOTENV=1
export LISTFLICK_E2E_API_URL="http://127.0.0.1:8000"
exec npx expo start --dev-client --localhost --clear
