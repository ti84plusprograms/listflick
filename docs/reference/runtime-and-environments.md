# Runtime and environments

| Environment | Mobile runtime | Backend | Image storage | Purpose |
|---|---|---|---|---|
| Development | Expo Development Build + Metro | local Uvicorn | local fallback or Supabase | coding and debugging |
| Local E2E | Expo Development Build + loopback Metro override | guarded deterministic local Uvicorn | `backend/.e2e/uploads` | isolated Maestro UI automation |
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

Local E2E is an explicit test environment, not a deployment profile. Its
backend starts only with a loopback PostgreSQL database whose name contains
`e2e`, clears provider and remote-service credentials, disables Notion writes,
and uses deterministic AI output. Its simulated mobile authentication is
development-only and also requires the loopback override. No EAS profile or
Render configuration enables these paths.

All environments currently execute analysis inside the FastAPI request that
claims the database job. PostgreSQL makes the job resumable, but no environment
has an autonomous background worker. After a backend restart, the mobile
client must reconnect and retry once the old lease expires.
