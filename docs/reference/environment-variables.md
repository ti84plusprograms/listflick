# Environment variables

## Backend

| Variable | Purpose |
|---|---|
| `APP_ENV` | runtime label; must be exactly `e2e` before deterministic fixture mode can start |
| `E2E_MODE` | local-only deterministic AI and simulated-auth backend switch; defaults to `false` and fails closed unless all E2E isolation checks pass |
| `E2E_REQUIRE_BYOK_UI` | E2E-only health variant that reports no server fallback or configured provider key so Maestro can exercise first-time provider UX |
| `AI_PROVIDER` | backend default (`gemini`, `groq`, or `claude`); also the mobile effective provider when fallback is enabled and the user has no saved preference |
| `ALLOW_SERVER_AI_KEY_FALLBACK` | allow server Gemini/Groq/Claude keys without a request BYOK key; the code, example, and Render blueprint defaults are `false`; when explicitly enabled, it also allows `AI_PROVIDER` to resolve an unset mobile preference |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini credentials/model |
| `GEMINI_MODEL_FALLBACKS`, `GEMINI_MAX_RETRIES`, `GEMINI_REQUEST_TIMEOUT` | Gemini fallback model list (comma-separated), retry count (`2`), and request timeout in seconds (`60`) |
| `GROQ_API_KEY` | Groq credential; keep server-side and never commit a real key |
| `GROQ_VISION_MODEL` | Supported Groq vision model ID; must be `qwen/qwen3.8-27b` |
| `GROQ_VISION_REASONING_EFFORT` | Groq vision reasoning mode; `none` disables Qwen reasoning, `default` enables it |
| `GROQ_TEXT_MODEL` | Groq text model ID; defaults to `openai/gpt-oss-20b` |
| `GROQ_MAX_RETRIES`, `GROQ_REQUEST_TIMEOUT` | Groq retry count (`2`) and request timeout in seconds (`30`) |
| `ANTHROPIC_API_KEY` | Claude (Anthropic) credential for server fallback; keep server-side and never commit a real key |
| `CLAUDE_VISION_MODEL` | Claude model used for photo analysis; defaults to `claude-sonnet-5-5` |
| `CLAUDE_TEXT_MODEL` | Claude model used for listing writing and pricing; defaults to `claude-sonnet-5-5` |
| `CLAUDE_MAX_RETRIES`, `CLAUDE_REQUEST_TIMEOUT` | Claude retry count (`2`) and request timeout in seconds (`90`) |
| `DATABASE_URL` | PostgreSQL connection used by the asyncpg database layer |
| `ANALYSIS_LEASE_SECONDS` | request-inline analysis lease duration; defaults to `300` |
| `ANALYSIS_MAX_ATTEMPTS` | maximum claims before terminal failure; defaults to `3` |
| `PENDING_ITEM_RETENTION_HOURS` | resumable unsaved-item retention; defaults to `168` (seven days) |
| `UPLOAD_DIR` | filesystem-storage root used when Supabase is not configured; defaults to `./uploads` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only Supabase Storage credential |
| `SUPABASE_STORAGE_BUCKET` | private image bucket, normally `images` (also holds listing videos) |
| `MAX_VIDEO_UPLOAD_MB` | largest listing video the API accepts; defaults to `100`. Must be positive. Video upload requests whose `Content-Length` exceeds this plus room for 24 frames get `413` before the body is read |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin service-account JSON secret |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | local Firebase service-account path |
| `CORS_ORIGINS` | comma-separated credentialed browser origins; `*` is rejected |
| `NOTION_CREATE_ENTRIES` | enable Notion create/update operations |
| `NOTION_ALLOW_CLIENT_OVERRIDE` | development-only per-request Notion toggle |
| `NOTION_SYNC_LEASE_SECONDS` | per-item Notion write lease; defaults to `300` |
| `NOTION_API_KEY` | Notion integration secret |
| `NOTION_DATA_SOURCE_ID` | preferred Notion data source identifier |
| `NOTION_DATABASE_ID` | legacy/fallback Notion database identifier |
| `NOTION_API_VERSION` | Notion API version sent by the integration |

For public deployments, use BYOK: users enter provider keys in the mobile app,
where they are stored in Expo SecureStore. The key is sent only on provider-
execution requests and is not persisted by ListFlick. Self-hosters may set
`GEMINI_API_KEY`, `GROQ_API_KEY` and/or `ANTHROPIC_API_KEY` and explicitly enable
`ALLOW_SERVER_AI_KEY_FALLBACK=true`; the deployment owner then assumes provider
usage and cost responsibility. With fallback enabled, a saved mobile provider
preference takes precedence. If no preference is saved, the mobile client uses
`AI_PROVIDER` from `/health` as the effective provider. In Settings, **Choose**
means there is no saved override; it does not mean AI is unavailable.

A nonblank device key is reported as **Saved on this device**. Saving does not
contact Gemini, Groq, or Claude, so it does not claim the key is valid. The selected
provider validates the key on the next AI request; a rejected key returns
`AI_PROVIDER_CREDENTIAL_INVALID` and the app offers **Replace API Key**.

The tracked Render service explicitly sets
`ALLOW_SERVER_AI_KEY_FALLBACK=false`. Its `GEMINI_API_KEY`, `GROQ_API_KEY` and
`ANTHROPIC_API_KEY` entries use `sync: false`, so a Blueprint never contains or
copies a provider secret. A self-hoster who wants server-paid requests must
supply their own key, change the fallback flag to `true`, and accept the usage
and cost. Never enable fallback on a deployment backed by someone else's provider account.

The variables remain server-only. `/health` exposes the provider name, whether
server fallback is enabled, provider-configured booleans (`gemini_configured`,
`groq_configured`, `claude_configured`), selected model IDs, and effective
Notion capability metadata. It never returns credential or destination values.

`E2E_MODE=true` is accepted only with `APP_ENV=e2e`, a localhost PostgreSQL
database whose name contains `e2e`, server-key fallback disabled, Notion writes
disabled, and no Supabase configuration. In that isolated mode, `/health`
reports `ai_mode=deterministic_e2e`; analysis uses checked-in fixture output and
does not construct a Gemini, Groq, or Claude client. This mode is for the local Maestro
flow only and is not configured in `render.yaml` or any EAS profile.
`E2E_REQUIRE_BYOK_UI=true` additionally requires `E2E_MODE=true`; it changes
only the E2E health presentation and leaves the deterministic provider guard in
place.

The E2E startup command overrides `UPLOAD_DIR` with `backend/.e2e/uploads`, so
its cleanup and item deletion cannot touch normal development files under
`backend/uploads`.
PostgreSQL is required; the backend applies versioned schema migrations from
`backend/app/db/migrations.py` during startup.

All processing lease and retention values must be positive integers. They are
explicit in `backend/.env.example` and `render.yaml`. They configure the
existing web service; they do not enable a background worker. The Notion lease
serializes writes for one item across overlapping web requests and expires so a
later request can recover abandoned work.

### Groq model configuration

`GROQ_VISION_MODEL` is intentionally pinned to `qwen/qwen3.8-27b`. The backend
rejects any other value at settings load time because the verified Groq vision
request contract depends on Qwen's `reasoning_effort` parameter. Supporting a
different Groq vision model requires a new compatibility probe plus matching
code, tests, deployment config, and documentation changes.

`GROQ_VISION_REASONING_EFFORT` is also explicit and tracked. It defaults to
`none`, which sends `reasoning_effort="none"` on vision requests and leaves text
requests unchanged. Use `default` only when intentionally testing Qwen's
reasoning-enabled mode. Blank values, surrounding whitespace, and unsupported
mode names fail settings validation.

`GROQ_TEXT_MODEL` defaults to `openai/gpt-oss-20b`, Groq's documented replacement
for the retired `llama-3.1-8b-instant` model. The tracked local template matches
the code default. The Render blueprint intentionally does not publish a text
model override, so a deployment uses the code default unless a private service
environment override is configured. Text requests continue to omit
`reasoning_effort` and use Groq JSON Object Mode; the replacement supports that
request format.

Locally, a nonblank `GROQ_VISION_MODEL` in the process environment or
`backend/.env` overrides the code default. On Render, the tracked blueprint
supplies the explicit model and reasoning-mode values; change `render.yaml` in
the same change as any deployed Groq request-mode migration instead of relying
on an undocumented dashboard value.

Alternate Groq vision model IDs are unsupported in the current backend. Blank
values, values with surrounding whitespace, and non-Qwen values fail settings
validation. The `/health` response exposes the selected model ID and reasoning mode as
`groq_vision_model` and `groq_vision_reasoning_effort` without exposing the API
key.

## Mobile

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | backend base URL compiled into the mobile app |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | self-hoster's Google OAuth web client ID; public identifier used for Google Sign-In |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | self-hoster's Google OAuth iOS client ID; public identifier required for Google Sign-In on iOS |
| `LISTFLICK_E2E_API_URL` | local development-client API override and simulated-auth gate; accepts only a loopback HTTP URL |
| `LISTFLICK_E2E_RESET_AI_SETTINGS` | when exactly `true`, clears the signed-in E2E user's provider selection and provider keys at app startup; requires the loopback override and is ignored outside development |

Only public, non-secret configuration belongs in the mobile environment. The
repository's preview and production EAS profiles intentionally contain no API
URL; configure `EXPO_PUBLIC_API_URL` in your own EAS environment before
building. If the Google client IDs are omitted, the app hides Google Sign-In;
email/password authentication remains available once Firebase is configured.
The two `LISTFLICK_E2E_*` variables are local test-process controls, not public
deployment configuration; no EAS profile enables them. The mobile runtime uses
the E2E URL and simulated identity only when `__DEV__` is also true, so setting
the manifest value cannot activate simulated authentication in a production
build.
