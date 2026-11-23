#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_PATH="${REPO_ROOT}/.maestro/fixtures/vintage-camera.jpg"
ANGLE_FIXTURE_PATH="${REPO_ROOT}/.maestro/fixtures/vintage-camera-angle.jpg"
MARKER_DOMAIN="com.listingassistant.maestro"
MARKER_KEY="vintage-camera-fixtures-v2"
FORCE_SEED="${1:-}"

for fixture in "${FIXTURE_PATH}" "${ANGLE_FIXTURE_PATH}"; do
  if [[ ! -f "${fixture}" ]]; then
    echo "Fixture not found: ${fixture}" >&2
    exit 1
  fi
done

if ! xcrun simctl list devices booted | grep -q "(Booted)"; then
  echo "Boot an iOS Simulator before seeding the Maestro fixture." >&2
  exit 1
fi

if [[ "${FORCE_SEED}" != "--force" ]] && \
  xcrun simctl spawn booted defaults read "${MARKER_DOMAIN}" "${MARKER_KEY}" >/dev/null 2>&1; then
  echo "Maestro camera fixture is already seeded in the booted simulator."
  exit 0
fi

xcrun simctl addmedia booted "${FIXTURE_PATH}" "${ANGLE_FIXTURE_PATH}"
xcrun simctl spawn booted defaults write "${MARKER_DOMAIN}" "${MARKER_KEY}" -bool true
echo "Seeded both Maestro camera fixtures into the booted simulator photo library."
