# Deploy preview and production

`render.yaml` defines the Render web service `listing-assistant-api`, built
from `backend/Dockerfile`. Configure its listed secrets and runtime variables
in Render. The backend must use PostgreSQL, Firebase Admin credentials, and
Supabase Storage for a durable deployment.

The tracked Blueprint defaults to `ALLOW_SERVER_AI_KEY_FALLBACK=false`, so
users must provide Gemini, Groq, or Claude keys from the mobile app. Render prompts each
deployer for the `sync: false` database, Firebase, Supabase, and optional AI
secrets; their values are never stored in this repository.

To offer server-paid AI instead, provide your own `GEMINI_API_KEY`,
`GROQ_API_KEY` or `ANTHROPIC_API_KEY`, choose the matching `AI_PROVIDER`, and explicitly set
`ALLOW_SERVER_AI_KEY_FALLBACK=true`. Anyone using that deployment can then
consume the deployment owner's provider quota, so enable authentication,
monitor usage, and add an appropriate quota/rate-limit policy before exposing
it publicly.

Before an EAS preview or production build, create your own EAS project and set
`EXPO_PUBLIC_API_URL` in that profile's EAS environment to your backend. The
checked-in profiles intentionally contain neither an EAS project ID nor a
hosted API URL. A clone therefore cannot target the repository owner's EAS or
Render resources by default.

The blueprint intentionally defines no background worker. Configure
`ANALYSIS_LEASE_SECONDS`, `ANALYSIS_MAX_ATTEMPTS`, and
`PENDING_ITEM_RETENTION_HOURS` on the web service as tracked. Analysis runs in
the kickoff request; after a process restart, a client reconnect must wait for
lease expiry and retry. Do not claim autonomous disconnected processing in a
release until the separately billed worker plan is implemented and verified.

Build an internal preview app with:

```bash
cd mobile
npx eas-cli build --profile preview
```

Build production with:

```bash
npx eas-cli build --profile production
```

Preview is a distributable test build, not a local Metro development session.
Submit production only after authenticated device testing, image retrieval
testing, interrupted-upload and resume testing, Notion-mode verification, and
the full automated suite pass. The profile shapes are defined in
`mobile/eas.json`; deployment-specific URLs and identifiers belong in the
deployer's EAS/Firebase configuration.
