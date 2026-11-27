# Local development

This tutorial starts the backend and mobile app locally and verifies that the
repository is ready for development.

## 1. Install prerequisites

Install Python, Node.js, Xcode for iOS builds, and a Firebase project. The
mobile app uses native Firebase packages, so Expo Go is not the supported app
runtime.

From the repository root:

```bash
make install-backend
make install-mobile
```

## 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

For the default BYOK mode, leave `ALLOW_SERVER_AI_KEY_FALLBACK=false`; users
choose Gemini, Groq, or Claude and supply their own key in the mobile app. For an
opt-in self-hosted server-key mode, set your own provider key and explicitly
enable fallback. For a real deployment, also configure your own PostgreSQL,
Firebase Admin credentials, and Supabase Storage. See the
[environment reference](../reference/environment-variables.md).

> Configuration note: the checked-in backend example currently contains a
> SQLite-style `DATABASE_URL`, while the backend requirements use `asyncpg`
> and the runtime database module expects PostgreSQL. Use the deployed or local
> PostgreSQL URL until that example is reconciled.

## 3. Start the backend

```bash
make backend
```

Verify it at <http://localhost:8000/health>. API documentation is at
<http://localhost:8000/docs>.

## 4. Configure the mobile app

```bash
cp mobile/.env.example mobile/.env
```

Configure the mobile Firebase files and OAuth identifiers from your own
Firebase project before building; see
[Firebase Authentication](../how-to/firebase-authentication.md).

For an iOS simulator, `http://localhost:8000` works. For a physical device,
set `EXPO_PUBLIC_API_URL` to the Mac's LAN address, or use the tunnel guide.

## 5. Start the mobile app

For automatic LAN-IP configuration:

```bash
make mobile
```

For manual development-client startup:

```bash
cd mobile
npx expo start --offline --dev-client --lan
```

When LAN access to Metro is unavailable, use `make mobile-tunnel`. This changes
Metro transport only; configure a separately reachable backend URL as described
in the [mobile networking guide](../how-to/mobile-setup-and-device-networking.md).
Use `make mobile-tunnel-measure` when checking force-quit and reopen latency.
For user-like startup without Metro, install an EAS preview build with
`make build-preview`.

Build and install the native client with `npx expo run:ios` or
`npx expo run:android`. Sign in before using protected item and image routes.

## 6. Validate the checkout

```bash
make test
cd mobile && npm test
cd .. && make smoke
```

`make smoke` requires the backend to be running and checks health plus auth
gates. It does not perform an authenticated AI listing generation.
