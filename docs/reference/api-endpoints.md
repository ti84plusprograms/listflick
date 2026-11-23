# API endpoint reference

All `/api/items` routes require a Firebase bearer token. The backend returns
generic auth errors and scopes records to the verified Firebase UID.

Provider-execution routes (`POST /api/items/analyze`, `POST
/api/items/{id}/analysis-jobs`, and `POST /api/items/improve`) accept the
effective provider in `X-ListFlick-AI-Provider` and an optional device key in
`X-ListFlick-AI-Key`. A device key is never included in request bodies,
responses, or durable analysis state. Older clients without the provider header
use the configured `AI_PROVIDER`. The status polling route does not require
either header.

The mobile client resolves the effective provider as follows:

| Saved preference | Server fallback | Effective provider |
|---|---|---|
| Gemini or Groq | either | the saved provider |
| none | enabled | the backend `AI_PROVIDER` reported by `/health` |
| none | disabled | none; require the user to choose a provider |

After resolving the provider, the client uses its device key when present. If
the device key is absent, enabled server fallback may supply only that
provider's matching server key. Otherwise, the client returns a
credential-required error for the effective provider. This ordering also means
a saved provider can use its matching server key when it differs from
`AI_PROVIDER`.

Settings displays only the saved preference. Consequently, **AI Provider —
Choose** means that no user override is stored; it does not block AI when
server fallback supplies the backend default and its credential. Settings also
states which deployment provider is being supplied in that case. A device key
status of **Saved on this device** confirms storage only; provider validation
occurs on the next AI request.

The account route also requires a Firebase bearer token and only operates on
the UID in that verified token.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/items/upload` | upload one validated image |
| `POST` | `/api/items/upload-multiple` | upload up to eight validated images |
| `PUT` | `/api/items/{id}/images` | replace an item's image set |
| `POST` | `/api/items/analyze` | legacy synchronous analysis for installed clients |
| `POST` | `/api/items/{id}/analysis-jobs` | start or resume request-inline analysis |
| `GET` | `/api/items/{id}/analysis-jobs` | return lightweight analysis-job status |
| `POST` | `/api/items/improve` | apply an explicit listing improvement |
| `POST` | `/api/items/{id}/save` | save listing and optionally sync Notion |
| `POST` | `/api/items/{id}/notion/retry` | retry Notion synchronization |
| `POST` | `/api/items/{id}/trash` | move an item to Recently Deleted |
| `POST` | `/api/items/{id}/restore` | restore a trashed item |
| `DELETE` | `/api/items/{id}/draft` | discard an owned unsaved item and pending images |
| `DELETE` | `/api/items/{id}` | permanently delete item and images |
| `POST` | `/api/items/cleanup` | purge expired trashed and pending items |
| `GET` | `/api/items/{id}` | return item, job status, analysis, and listing data |
| `GET`/`HEAD` | `/api/items/{id}/image` | return the first image |
| `GET`/`HEAD` | `/api/items/{id}/image/{index}` | return image bytes |
| `GET` | `/api/items/{id}/image/{index}/url` | return a signed URL |
| `GET` | `/health` | report backend configuration status |
| `DELETE` | `/api/account` | permanently delete the authenticated account and app-owned data |

Interactive OpenAPI documentation is available at `/docs`. Image upload uses
multipart `files`; image responses are private and cacheable for one hour on
the backend response path.

The upload routes accept an optional `Idempotency-Key` header containing 8–128
letters, numbers, `.`, `_`, `:`, or `-`. The current mobile app always sends its
persisted operation ID. Repeating the same key and normalized image payload for
one user returns the same item; changing the payload returns `409`. The header
remains optional only for compatibility with installed older clients.
Same-payload retries may replace an incomplete deterministic pending object;
ordinary uploads and permanent-object promotion retain create-only behavior.

`POST /api/items/{id}/analysis-jobs` owns one durable job per item. The request
claims a lease and runs the provider call inline in the web process. It returns
the existing active or completed job for duplicate kickoff, and may return
`202` while another request owns the lease. Clients poll the owner-scoped
`GET /api/items/{id}/analysis-jobs` status response while analysis is active.
The full `GET /api/items/{id}` response is used for initial recovery/upload
reconciliation and once after analysis succeeds. This avoids repeated image
downloads and image-quality processing during a long analysis. An expired or
retryable lease requires a later client request because no background worker
is configured.

Credential failures use `retryable_failed` but do not consume the bounded
analysis-attempt budget. After the user replaces a rejected key, the same item
and job can be claimed again. Other retryable provider or timeout failures do
consume attempts.

Credential error objects use `AI_CREDENTIAL_REQUIRED` or
`AI_PROVIDER_CREDENTIAL_INVALID` and include the safe `provider` name
(`gemini` or `groq`). The mobile client uses that metadata to open the matching
add/replace-key flow for analysis and listing improvement. Error responses
never include the submitted key.

When the legacy synchronous route has already stored valid analysis and listing
results, item-scoped kickoff reconciles any owner-matched stale job to
`succeeded` and returns those results without another provider call.

The Pydantic schemas in `backend/app/schemas/listing.py` are the API contract
source of truth. The mobile client keeps corresponding named response types in
`mobile/types/api.ts`; functions in `mobile/services/api.ts` use those types
instead of defining inline response objects. Update the backend schema, mobile
contract type, and affected tests together when a response changes.

`GET /health` includes a safe `notion_capability` object with `configured`,
`creation_enabled`, `client_override_allowed`, `effective_request_enabled`, and
`reason`. The reason is `configured`, `backend_disabled`, or
`missing_credentials`; the response never includes a Notion key or destination
identifier.

The health response also exposes `allow_server_ai_key_fallback` so clients can
avoid requiring a device key when the deployment owner has explicitly enabled
server-managed AI credentials. It does not expose any credential value.

The `notion_sync` object returned by item, save, and retry routes keeps the
existing status, page, attempt, success, and safe-error fields. It also reports
`reason` when synchronization is skipped and a stable `error_code` for failed
requests. Skip reasons are persisted on the item so later reads preserve the
request outcome. Codes distinguish timeout, network, TLS, rate limit, authorization,
schema, missing-page/database, provider rejection, and unknown failures.

Notion writes are serialized by an item-scoped PostgreSQL lease. If another
save or retry already owns the lease, the route returns the authoritative
`syncing` state without starting a second provider request. The client can check
again safely. After an ambiguous create failure, the next claimed retry queries
the configured Notion destination for the app item marker before creating a new
page. Lease tokens and reconciliation markers are internal and are never
returned by the API.
