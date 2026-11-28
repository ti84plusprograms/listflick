# Runtime and environments

| Environment | Mobile runtime | Backend | Image storage | Purpose |
|---|---|---|---|---|
| Development | Expo Development Build + Metro | local Uvicorn | local fallback or Supabase | coding and debugging |
| Preview | internal EAS build | Render | Supabase | shared acceptance testing |
| Production | production EAS build | Render | Supabase | released users |

Expo `--tunnel` changes how Metro is reached. It does not deploy the backend.
The API is online only when started locally, exposed through a backend tunnel,
or deployed to Render.

For development-client tunnel startup, `make mobile-tunnel` uses the local Expo
CLI, preserves Metro's cache, and compresses multipart JavaScript bundle
responses for the tunnel. `make mobile-tunnel-clean` is the explicit cache-
reset recovery path, while `make mobile-tunnel-measure` records repeated
bundle-to-usable-screen cycles in gitignored JSONL session files and prints an
automatic five-run pass/fail summary. See the
[mobile networking guide](../how-to/mobile-setup-and-device-networking.md) for
measurement and failure classification.

The EAS preview and production profiles contain no backend URL. Each deployer
must provide `EXPO_PUBLIC_API_URL` through their own EAS environment. The
repository does not direct clones to the repository owner's Render service.

All environments currently execute analysis inside the FastAPI request that
claims the database job. PostgreSQL makes the job resumable, but no environment
has an autonomous background worker. After a backend restart, the mobile
client must reconnect and retry once the old lease expires.

Listing videos are uploaded through the same web service and stored beside the
photos (Supabase when configured, otherwise `backend/uploads`). The request
size limit is `MAX_VIDEO_UPLOAD_MB` (default 100).

Notifications are local to the device in every environment. They need no
backend, push service, or signing capability, because
`mobile/plugins/withoutPushEntitlement.js` strips the push entitlement from
the native build. Appearance and notification preferences are stored on the
device (`@appearance`, `@notification_preferences`) and are not synced.
