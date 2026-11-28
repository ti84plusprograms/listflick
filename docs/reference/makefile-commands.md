# Makefile commands

Run these from the repository root.

| Command | Effect |
|---|---|
| `make install-backend` | create `backend/.venv` and install Python requirements |
| `make install-mobile` | install mobile npm dependencies |
| `make backend` | run Uvicorn on `0.0.0.0:8000` with reload |
| `make mobile` | write the current LAN IP and start Expo |
| `make mobile-manual` | run the iOS device development build |
| `make mobile-tunnel` | start the local Expo CLI in development-client tunnel mode and reuse Metro's cache |
| `make mobile-tunnel-clean` | start the same tunnel after explicitly clearing Metro's cache |
| `make mobile-tunnel-measure` | exclude one warm-up, persist five reopen cycles, print a threshold summary, and stop |
| `make mobile-tunnel-benchmark` | run five warm tunnel-ready measurements and report the median and failures |
| `make docs-user-flow` | regenerate `docs/generated/user-flow.svg` from the canonical Mermaid source |
| `make test` | run the backend pytest suite |
| `make smoke` | run health and auth-gate API smoke checks |
| `make build-preview` | start the EAS preview build |
| `make build-prod` | start the EAS production build |

`make mobile` overwrites `mobile/.env` with a generated LAN URL. Do not commit
that file.

The tunnel commands run `mobile/node_modules/.bin/expo` directly, so they do
not download or implicitly install an Expo CLI. They also enable compression
for Expo's multipart development bundle, which otherwise crosses the tunnel
uncompressed. Run `make install-mobile` when the local CLI is missing. The
Metro tunnel does not expose the backend URL in `EXPO_PUBLIC_API_URL`.

`make docs-user-flow` runs the pinned Mermaid CLI version through `npx`. The
first run may download the CLI; no global Mermaid installation is required.

Reopen measurement sessions are newline-delimited JSON files under the
gitignored `mobile/.metrics/` directory. A complete session exits zero only
when its five-run median is no more than 8 seconds and its maximum is no more
than 12 seconds.
