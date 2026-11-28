# Logging and observability

## Mobile prefixes

- `[Auth]`: Firebase session restoration, token/auth lifecycle, route guards,
  and sign-out.
- `[ImageRetrieval]`: protected-image token, signed URL, fallback, load, and
  failure events.
- `[AI]`: provider and credential resolution for outgoing AI requests and the
  Settings screen. It reports the saved provider, backend provider, and whether
  a device key exists, never the key itself.
- `[Checklist]`: failures of the background tip re-check
  (`POST /api/items/recheck`) on the review screen.
- `[Notifications]`: a local listing alert that could not be scheduled.
- `[Settings]`: failures loading saved preferences.
- `[AppStartup]`: development-only first-usable-screen marker.

These logs are for development diagnostics. They may identify UIDs and paths
where useful but must not contain ID tokens, passwords, or service-account
contents.

## Backend logs

Uvicorn logs cover request entry, authenticated UID, AI provider operations,
storage backend selection, object paths, image and video byte counts, video
frame counts, signed URL status, cleanup counts, and classified failures. AI
request lines include the provider (`gemini`, `groq`, or `claude`) and the
credential source, never the key. Provider exception text is not sent
to clients.

Notion failure logs include the app item ID and a safe category. They do not log
provider response bodies, Notion credentials, upload URLs, or private storage
paths. Ambiguous-create reconciliation is logged by item ID without page or
workspace details.

Use `/health` for configuration visibility. It reports booleans and selected
provider/model values (including `claude_configured` and the Claude model
IDs), not secret values.
