# Authentication contract

The mobile client authenticates with Firebase Authentication and sends:
`Authorization: Bearer <firebase-id-token>`.

The backend uses Firebase Admin `verify_id_token(..., check_revoked=True)` and
passes only the verified UID into database and storage workflows.

| Condition | Response |
|---|---|
| missing bearer credentials | `401 Authentication required` |
| invalid, expired, or revoked token | `401 Invalid authentication credentials` |
| owned item not found | `404` without revealing another user's record |
| storage access denied | `403 Storage access denied` |

The client may force one token refresh after a protected request receives
401/403. Tokens, signed URLs, and service credentials must not be persisted in
AsyncStorage or exposed in logs.

## Local E2E exception

The local Maestro environment uses a deliberately narrow simulated-auth path.
The mobile client can create and persist a deterministic simulated identity
only when `__DEV__` is true and `LISTFLICK_E2E_API_URL` supplies a validated
loopback HTTP URL. Password input is ignored in that mode and no Firebase
account is created. The backend accepts the resulting `e2e-token-<uid>` bearer
token only when `E2E_MODE=true`; that mode separately requires `APP_ENV=e2e`, a
local database whose name contains `e2e`, isolated E2E upload storage, disabled
server-key fallback and Notion writes, and no Supabase configuration.

Preview and production builds cannot enable the mobile simulated-auth path,
and a backend outside guarded E2E mode sends these tokens through normal
Firebase verification, where they fail. See
[Run the local Maestro UI flows](../how-to/maestro-create-listing.md) for the
supported workflow.

Listing data stored locally is scoped by the active Firebase UID. This includes
saved listings, Recently Deleted listings, edit drafts, and the list of
unfinished listings (`@pending_analyses`). When no user is
authenticated, these records use an isolated `signed-out` scope. A legacy
global saved-listings value has no owner metadata, so it is never exposed while
signed out. The first authenticated account that encounters valid legacy data
claims it, copies it into that UID's scope, and removes the global source. A
persistent owner marker prevents the same legacy data from being copied into a
second account if cleanup is interrupted.
