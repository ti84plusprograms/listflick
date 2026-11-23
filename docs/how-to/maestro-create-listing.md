# Run the local Maestro UI flows

Use this guide to run ListFlick's black-box mobile UI flows on a local iOS
Simulator. The suite covers authentication and onboarding, provider first use,
listing creation, explicit AI-assisted field improvement, listing photo
management, and server-backed image download. The flows use real product UI,
deterministic fixture output, and isolated local data.

## Prerequisites

- Install the [Maestro CLI](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) (requires Java 17+):
  ```bash
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  export PATH="$PATH:$HOME/.maestro/bin"
  ```
- Install backend and mobile dependencies with `make install-backend` and
  `make install-mobile`.
- Create a dedicated local PostgreSQL database whose name contains `e2e` (e.g. using Docker):
  ```bash
  docker run -d --name listflick-e2e-postgres -p 55433:5432 \
    -e POSTGRES_USER=listflick -e POSTGRES_PASSWORD=listflick -e POSTGRES_DB=listflick_e2e \
    postgres:16-alpine
  ```
- Build and install the iOS development client.
- Simulated authentication is automated: the flows include an authentication helper
  (`.maestro/helpers/ensure-authenticated.yaml`) that automatically signs in using
  a deterministic local-only identity and a non-secret password-field sentinel if
  the simulator starts on the login screen or another tab.

The local E2E path does not require a Firebase test account, Firebase Admin
credentials, or a committed password. Simulated authentication is available
only in a development build with the loopback E2E API override, and the backend
accepts its deterministic token only while guarded E2E mode is active. See the
[authentication contract](../reference/authentication-contract.md).

Do not point this workflow at a shared or production backend. The startup gate
rejects non-local databases, Supabase Storage, Notion writes, and normal server
AI-key fallback. It also requires and supplies an E2E-specific filesystem
storage root under `backend/.e2e/uploads`.

## Available flows

| Flow | Command | Additional setup |
|---|---|---|
| Authentication and onboarding | `make e2e-auth-onboarding` | None; see the [focused guide](maestro-auth-onboarding.md) |
| AI provider first use | `make e2e-configure-ai` | Start the backend and Metro with the flags shown below |
| Create and save a listing | `make e2e-create-listing` | Seed the fixture photos |
| Improve a listing with AI | `make e2e-improve-listing` | Seed the fixture photos |
| Manage listing photos | `make e2e-manage-photos` | Seed both fixture photos |
| Download listing images | `make e2e-download-images` | Seed the fixture photos; allow Photos access |

## One-time listing-flow simulator setup

Boot the simulator, install and open the development client, and seed the
repository-owned fixture photos once:

```bash
make e2e-seed-ios
```

The seed command adds both repository-owned camera angles, stores a version
marker inside that simulator, and skips future inserts so repeated runs do not
fill the photo library. Use `bash scripts/seed-maestro-ios-photo.sh --force`
only after deleting or replacing the fixture photos.

The listing-oriented flows preserve app state (`clearState: false`) and
automatically ensure an authenticated session on the Home screen before
starting. They discard the dedicated E2E account's unfinished **Resume
listing** draft through the normal UI, then remove only fixture inventory items
whose accessible titles match **Vintage Canon Camera** or the improved
**Vintage Canon AE-1 35mm Film Camera**. Run the suite only with the simulated
E2E identity and isolated local database because pending-draft cleanup applies
to that identity's current draft.

## Flow 1: Create and save a listing (Golden Path)

This flow exercises the end-to-end user path: selecting a photo from the gallery,
verifying the processing screen, inspecting deterministic listing details, editing
the price to $120, saving to inventory, reopening from inventory, and cleaning up.

### Terminal 1: Start the isolated backend
Provide the isolated database URL and start the fixture backend:

```bash
export E2E_DATABASE_URL='postgresql://listflick:listflick@127.0.0.1:55433/listflick_e2e'
make e2e-backend
```

Confirm the backend reports fixture mode:

```bash
curl --fail-with-body http://127.0.0.1:8000/health
```

The response must contain `"ai_mode":"deterministic_e2e"`.

### Terminal 2: Start Metro
Start Metro with the E2E API URL:

```bash
make e2e-mobile
```

This command deliberately ignores `mobile/.env`, so a developer's normal API
URL cannot redirect the golden path away from the isolated local backend.
Open the installed development client in the simulator if it is not already connected to Metro.

### Terminal 3: Run the test
Execute the Maestro flow:

```bash
make e2e-create-listing
```

The underlying direct command is:

```bash
maestro test .maestro/create-listing.yaml
```

## Flow 2: AI provider first-use and missing-key flow

This flow starts with no selected provider or saved provider key, exposes both
Gemini and Groq as explicit choices, selects Groq, and verifies the Groq-specific
missing-key prompt. It never enters a key or starts analysis.

### Terminal 1: Start backend with BYOK UI state
Start the isolated backend with its BYOK missing-key state exposed:

```bash
E2E_REQUIRE_BYOK_UI=true make e2e-backend
```

### Terminal 2: Start Metro with AI settings reset
Start Metro with the development-only AI settings reset enabled:

```bash
LISTFLICK_E2E_RESET_AI_SETTINGS=true make e2e-mobile
```

The reset clears only the selected provider and provider keys for the signed-in
E2E identity. It preserves the authenticated session, listings, and other app
preferences. This flow stops at the pre-photo credential check, so it does not
need the image fixture.

### Terminal 3: Run the test
Execute the Maestro flow:

```bash
make e2e-configure-ai
```

The underlying direct command is:

```bash
maestro test .maestro/configure-ai.yaml
```

Do not enable the reset when manually testing a real user's saved provider
credentials.

## Flow 3: Improve a listing with AI

This flow enables AI Photo Insights through Settings, creates the deterministic
camera listing, opens Edit Listing, applies the existing buyer-trust suggestion,
and verifies the visible **Brand / Model** field changes to **Canon AE-1**. The
screen reports that AI updated Brand / Model, title, and description before the
flow saves and reopens the listing to prove those changes persisted. It cleans
up only the improved fixture listing.

Use the same isolated backend, Metro process, authenticated simulator, and
seeded fixture required by the listing-creation flow. Then run:

```bash
make e2e-improve-listing
```

The underlying direct command is:

```bash
maestro test .maestro/improve-listing.yaml
```

## Flow 4: Manage listing photos

This flow creates the deterministic listing, opens Manage Photos, adds the
second seeded camera angle, browses both photos in the native viewer, removes
one, verifies that the last photo cannot be removed, and saves the resulting
photo set. It reopens Manage Photos before saving the listing to prove that the
change persisted in the listing workspace.

Use the same isolated backend, Metro process, authenticated simulator, and
seeded fixture required by the listing-creation flow. Then run:

```bash
make e2e-manage-photos
```

The underlying direct command is:

```bash
maestro test .maestro/manage-photos.yaml
```

## Flow 5: Download server-backed listing images

This flow creates the deterministic listing, saves it to inventory to establish
server-backed image URLs, reopens the listing from inventory, captures the
device Photos library state before download, triggers **Save Photos to Device**
from the overflow menu, validates the completion confirmation alert, asserts the
native Photos library opens after the download, records before/after screenshots
for inspection, and cleans up the fixture listing from inventory.

Use the same isolated backend, Metro process, authenticated simulator, and
seeded fixture required by the listing-creation flow. Then run:

```bash
make e2e-download-images
```

The underlying direct command is:

```bash
maestro test .maestro/download-images.yaml
```

## Determinism and cleanup

The backend returns **Vintage Canon Camera**, **$125**, and
**A deterministic test listing description.** without initializing either
provider client. The creation flow changes the price to **$120**. The
improvement flow returns **Vintage Canon AE-1 35mm Film Camera**, fills
**Brand / Model** with **Canon AE-1**, and reports the exact fields changed. Both
flows prove their result persisted in Inventory and on the reopened listing,
then permanently remove only their fixture data.
The photo-management flow uses the two camera-angle fixtures, then leaves one
before saving and cleanup.

The image-download flow deletes its fixture listing and backend image, but it
does not delete the downloaded copy from the simulator's Photos library. This
avoids destructive automation against unrelated photos. Reset the simulator's
media library when repeated download-flow runs make those copies inconvenient.
Maestro stores the before/after screenshots in its normal test artifacts, not
in the repository.

The native media-picker adapters are
`.maestro/helpers/pick-first-photo.yaml` and
`.maestro/helpers/pick-second-photo.yaml`, based on semantic media-picker IDs
and labels across common OS versions. All ListFlick controls use visible labels
or React Native accessibility identifiers; no screen coordinates are used.
