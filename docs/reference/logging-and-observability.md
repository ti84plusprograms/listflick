# Logging and observability

## Mobile prefixes

- `[Auth]`: Firebase session restoration, token/auth lifecycle, route guards,
  and sign-out.
- `[ImageRetrieval]`: protected-image token, signed URL, fallback, load, and
  failure events.

These logs are for development diagnostics. They may identify UIDs and paths
where useful but must not contain ID tokens, passwords, or service-account
contents.

## Backend logs

Uvicorn logs cover request entry, authenticated UID, AI provider operations,
storage backend selection, object paths, image byte counts, signed URL status,
cleanup counts, and classified failures. Provider exception text is not sent
to clients.

Notion failure logs include the app item ID and a safe category. They do not log
provider response bodies, Notion credentials, upload URLs, or private storage
paths. Ambiguous-create reconciliation is logged by item ID without page or
workspace details.

Use `/health` for configuration visibility. It reports booleans and selected
provider/model values, not secret values.
