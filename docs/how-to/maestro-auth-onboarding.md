# Authentication and onboarding Maestro flow

Use this guide to run ListFlick's black-box authentication, sign-up, sign-in,
and sign-out onboarding UI flow on a local iOS Simulator using Maestro.

## Overview

The authentication onboarding flow (`.maestro/auth-onboarding.yaml`) verifies
the complete user lifecycle from a fresh, unauthenticated launch through account
creation, home landing, settings verification, and clean sign out:

1. **Unauthenticated Launch**: Lands on the Welcome / Login screen (`id: login-screen`).
2. **Mode Toggle**: Switches between Sign In and Sign Up ("Create Account") modes via `id: auth-toggle-mode-button`.
3. **Client-side Form Validation**: Submitting without credentials displays `id: auth-error-message` ("Please enter email and password").
4. **Simulated Account Creation**: Enters the deterministic local identity
   `onboarding-test@listflick.test` and a placeholder password, then submits
   **Create Account**. E2E mode ignores the password and does not create a
   Firebase account.
5. **Home Landing**: Transition to Home tab (`id: home-screen`, "Sell something today").
6. **Account Verification**: Navigates to Settings (`id: settings-screen`), verifying the active account email is displayed.
7. **Clean Sign Out**: Taps "Sign Out", confirms in native dialog, and cleanly transitions back to the Login screen.

## Prerequisites

- [Maestro CLI](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) (requires Java 17+):
  ```bash
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  export PATH="$PATH:$HOME/.maestro/bin"
  ```
- Local PostgreSQL database running with an `e2e` name:
  ```bash
  docker run -d --name listflick-e2e-postgres -p 55433:5432 \
    -e POSTGRES_USER=listflick -e POSTGRES_PASSWORD=listflick -e POSTGRES_DB=listflick_e2e \
    postgres:16-alpine
  ```
- Booted iOS Simulator with ListFlick development client installed.

The flow does not require a real Firebase account, Firebase Admin credentials,
or a secret password. It must use the guarded local E2E backend and loopback
mobile configuration described below.

## Running the Flow

### Terminal 1: Start the isolated backend
```bash
export E2E_DATABASE_URL="postgresql://listflick:listflick@127.0.0.1:55433/listflick_e2e"
make e2e-backend
```

### Terminal 2: Start Expo for mobile
```bash
make e2e-mobile
```

### Terminal 3: Run the Maestro test
```bash
make e2e-auth-onboarding
```

Alternatively, invoke Maestro directly:
```bash
maestro test .maestro/auth-onboarding.yaml
```

## How It Works

- **Simulation Guardrails (`IS_E2E`)**: Simulated authentication operates only
  when `__DEV__` is enabled and `extra.e2eApiUrl` is configured. In production
  builds, simulated auth is completely inaccessible and all operations route to
  Firebase Auth.
- **Backend Acceptance**: In E2E mode (`settings.e2e_mode is True`), the backend
  accepts deterministic `e2e-token-<uid>` authorization headers without making
  outbound Firebase Admin calls.
- **State Resilience**: If the app starts signed in on Home or Settings, the
  flow signs out before beginning. It finishes signed out on the Login screen.
  Start this focused flow from one of those supported product screens.
