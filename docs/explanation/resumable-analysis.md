# Resumable analysis without a background worker

The current listing flow survives mobile screen remounts, app restarts, lost
upload responses, and ordinary analysis-request timeouts without creating a
second item. It does this with a persisted mobile operation, an idempotent
upload claim, and a PostgreSQL analysis job.

This is a reconnect-driven design. The FastAPI web request that claims an
analysis job also performs the AI call. There is no Render background worker,
queue consumer, or autonomous scheduler in the deployed configuration.

Provider credentials are request-scoped. Durable analysis state does not persist
AI provider credentials. A reconnect that executes provider work resolves the
effective provider again and attaches its current device key when available.
When server fallback is enabled, an unset mobile preference resolves to the
backend `AI_PROVIDER` and the backend supplies its configured key. Status
polling does not need a provider or key.

Saving a mobile key only proves that a nonblank value is present in secure
storage. The provider validates it during the next execution request. Missing
or rejected credentials leave the durable job recoverable without consuming
its bounded attempt budget, so the user can add or replace the key and resume
the same item.

## Request flow

```text
select photos
    -> copy photos into the app document directory
    -> save user-scoped pending operation on the device
    -> upload with Idempotency-Key
    -> persist returned item ID immediately
    -> load the item once to reconcile upload and existing job state
    -> POST /api/items/{item_id}/analysis-jobs
    -> web request claims a PostgreSQL lease and calls the AI provider
    -> poll GET /api/items/{item_id}/analysis-jobs
    -> fetch GET /api/items/{item_id} once after success
    -> retain the pending operation and photos through review
    -> save server-backed image references, then clear recovery data
```

The Home screen exposes an unfinished operation as **Resume listing**. Returning
home does not discard server state. Explicit discard deletes the owned pending
item, its analysis job through the database foreign key, and its pending image
objects. Discard remains available from an unsaved review draft after analysis
has completed, so retaining recovery files does not prevent starting over.

## Upload idempotency

The mobile operation ID is sent as `Idempotency-Key` on upload. The backend
stores it under a unique `(user_id, client_request_id)` index together with a
fingerprint of the normalized image payload.

- Repeating the key with the same images resolves to the same item.
- Repeating the key with different images returns `409 Conflict`.
- The same key may be used independently by two different users.
- Concurrent requests can create at most one item for a user's key.
- Older clients remain compatible because the header is optional, but uploads
  without it do not receive the idempotency guarantee.

An interrupted upload claim remains recoverable. A retry restages the images
against the same row instead of creating a new item. Idempotent restaging may
replace deterministic pending object paths only after the authenticated user,
operation key, and processed-image fingerprint match. Partial and concurrent
same-key requests therefore converge on the same bytes instead of failing on
Supabase's default duplicate-object rejection.

## Analysis job and lease states

Each item has at most one `analysis_jobs` row.

`analysis_jobs` is an internal backend table. Its migration enables PostgreSQL
row-level security and removes table privileges from Supabase's `anon` and
`authenticated` roles. The FastAPI service reaches it only through the direct
server-side PostgreSQL connection; the mobile app cannot query it through the
Supabase Data API.

| State | Meaning | Client action |
|---|---|---|
| `queued` | ready to be claimed | start or resume |
| `processing` | a web request owns an unexpired lease | poll |
| `retryable_failed` | a safe transient failure was recorded | retry when the UI offers it |
| `terminal_failed` | attempts are exhausted or the failure is permanent | show the terminal error |
| `succeeded` | item analysis and listing were committed | load the item and continue |

Claiming increments the attempt count and creates a bounded lease. A duplicate
kickoff returns the existing active or completed job instead of calling the AI
provider again. Successful job completion and item-result persistence happen
in one database transaction. Only a safe error code is stored; raw provider
output is not persisted in the job record. The lightweight status endpoint
reads only the owned item and job row; it does not build the full item response
or rerun image-quality feedback.

A missing or provider-rejected request credential releases the lease without
consuming an analysis attempt. The job remains `retryable_failed` while the
user replaces the device key, including after repeated rejected-key requests.
Transient provider, timeout, and expired-lease failures still consume attempts
and become terminal when the configured limit is reached.

The legacy `POST /api/items/analyze` route stays synchronous for installed
clients. The current mobile app uses the item-scoped job endpoint. If a legacy
request completes an item that already has a failed or active job row, the next
item-scoped kickoff reconciles that owner-matched row to `succeeded`, clears its
stale lease/error fields, and returns the existing results without another AI
call.

## What this design guarantees

With the current mobile client and a durable PostgreSQL/Supabase deployment:

- a lost upload response can be retried with the same operation key;
- a remount or app restart resumes the known server item;
- duplicate kickoff does not repeat a completed AI call;
- an expired lease becomes retryable after the app reconnects; and
- all reads, claims, retries, and discards remain scoped to the authenticated
  Firebase UID.

## What it does not guarantee

There is no autonomous execution after every web process exit. Render may stop
the request or restart the service after the client disconnects. When that
happens, the lease eventually expires and a later app reconnect must claim a
new attempt. The server also has no heartbeat from a separate worker, so the
lease is deliberately longer than the expected provider call.

Autonomous crash recovery requires the separately documented paid background
worker. That is deferred and is not represented in `render.yaml`.

## Retention

Pending items and their image references have a seven-day recovery window by
default. Before AsyncStorage records the operation, the mobile app copies
camera or picker assets into its document directory, which the OS does not
treat as an evictable cache. Analysis completion keeps those copies because
review and photo management still use them. Successful save switches the
workspace and local inventory record to authenticated server image routes,
then removes the operation and app-owned copies. Explicit discard, expiry,
account cleanup, and failed operation setup also remove them.

Backend startup and authenticated `/api/items/cleanup` remove expired pending
database rows and then their storage objects. General pending-object cleanup
excludes paths still referenced by unexpired database items, preventing an
age-only sweep from breaking a resumable operation.

The retention and lease behavior are configured by
`PENDING_ITEM_RETENTION_HOURS`, `ANALYSIS_LEASE_SECONDS`, and
`ANALYSIS_MAX_ATTEMPTS`.
