# Contributing

ListFlick is a FastAPI backend (`backend/`) and an Expo/React
Native mobile app (`mobile/`). This is a beta project; expect the API and app
to change.

## Getting started

- Backend: see [docs/README.md](docs/README.md) and `docs/reference/` for
  local setup, environment variables, and running the API.
- Mobile: `cd mobile && npm install`, then `npm run start` (see
  `mobile/package.json` for available scripts).

Copy `backend/.env.example` and `mobile/.env.example` to `.env` and fill in
your own configuration. Download mobile Firebase client files from your own
Firebase project as described in
[Firebase Authentication](docs/how-to/firebase-authentication.md). Never commit
`.env` files, Firebase client files, `.firebaserc`, `service-account.json`, or
other credentials. BYOK is the default; server-key fallback must use a
self-hoster's own provider account and be enabled explicitly.

## Making changes

1. Create a branch off `master` for your change.
2. Keep changes focused — a bug fix shouldn't bundle unrelated refactors.
3. Add or update tests alongside behavior changes.
4. Run the relevant test suite before opening a PR:
   - Backend: `cd backend && pytest -q`
   - Mobile: `cd mobile && npm test` (runs `tsc --noEmit` plus the test files
     under `mobile/__tests__/`)
5. Open a pull request against `master`. CI runs both test suites
   automatically.

## Reporting issues

Use the [GitHub issue tracker](https://github.com/ti84plusprograms/listflick/issues)
for bugs and feature requests, and [Discussions](https://github.com/ti84plusprograms/listflick/discussions)
for questions. Do not include credentials, ID tokens,
service-account files, API keys, or private photos in an issue. See
[SECURITY.md](SECURITY.md) for reporting security vulnerabilities privately.
