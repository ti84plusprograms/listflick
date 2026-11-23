# Makefile commands

Run these from the repository root.

| Command | Effect |
|---|---|
| `make install-backend` | create `backend/.venv` and install Python requirements |
| `make install-mobile` | install mobile npm dependencies |
| `make backend` | run Uvicorn on `0.0.0.0:8000` with reload |
| `make e2e-backend` | run the local-only deterministic E2E backend using `E2E_DATABASE_URL` |
| `make e2e-mobile` | start Expo against the isolated local E2E backend |
| `make e2e-seed-ios` | seed the two repository-owned camera fixtures into the booted iOS Simulator once |
| `make e2e-auth-onboarding` | run the complete authentication, sign-up, sign-in, and sign-out onboarding Maestro flow |
| `make e2e-create-listing` | run the local Maestro listing-creation golden path |
| `make e2e-configure-ai` | run the provider-neutral first-use and missing-key Maestro flow |
| `make e2e-improve-listing` | create a fixture listing, apply an AI suggestion, and verify the saved result |
| `make e2e-manage-photos` | add, browse, remove, persist, and clean up deterministic listing photos |
| `make e2e-download-images` | download server-backed listing images to device camera roll and clean up |
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

`make e2e-backend` requires a dedicated local PostgreSQL URL whose database
name contains `e2e`. It clears provider, Supabase, and Notion credentials from
the child process, and uses `backend/.e2e/uploads` instead of the normal local
upload directory, before starting the guarded fixture service. See the
[Maestro guide](../how-to/maestro-create-listing.md) for simulator and
authentication prerequisites.
Set `E2E_REQUIRE_BYOK_UI=true` for the configuration flow so health reports the
missing-key state. Start `make e2e-mobile` with
`LISTFLICK_E2E_RESET_AI_SETTINGS=true` to reset only provider settings between
runs; neither flag is used by the authentication, listing-creation,
AI-improvement, photo-management, or image-download flow.

Reopen measurement sessions are newline-delimited JSON files under the
gitignored `mobile/.metrics/` directory. A complete session exits zero only
when its five-run median is no more than 8 seconds and its maximum is no more
than 12 seconds.
