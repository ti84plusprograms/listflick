# Test and validate changes

From the repository root, run `make test`, then run `cd mobile && npm test`.
The mobile command includes TypeScript checking and the checked-in `tsx`
architecture/state tests. Run `cd mobile && npx tsc --noEmit` explicitly when
diagnosing TypeScript changes.

For API smoke validation, run `make backend` in one terminal and `make smoke`
in another. The smoke script checks health and unauthenticated endpoint
rejection; it does not replace an authenticated test with a real Firebase user,
Supabase bucket, AI provider, and physical device.

Before committing code, also run Python compileall, `git diff --check`, and
`./.graphify-venv/bin/graphify update . --force` after source changes.

The backend pytest configuration explicitly sets the async fixture loop scope
to `function`, avoiding the pytest-asyncio future-default deprecation. When
upgrading the Supabase client stack, escalate deprecations for storage
initialization with:

```bash
cd backend
PYTHONWARNINGS=error::DeprecationWarning .venv/bin/python -m pytest tests/test_cors.py::test_cors_preflight_allows_configured_origin
```

The backend suite (`cd backend && pytest -q`, also run by CI) includes video
(`test_video_api.py`, `test_video_frames.py`, `test_notion_video.py`), listing
questions and re-checks (`test_listing_answers_api.py`,
`test_listing_recheck.py`), and Claude client tests (`test_claude_client.py`).
The mobile `npm test` script runs `tsc --noEmit` and then every listed
`__tests__/*.test.ts` file with `tsx`, plus
`scripts/start-mobile-tunnel.test.mjs`. When you add a mobile test file, append
it to the `test` script in `mobile/package.json` or CI will not run it. Suites
for the newer surfaces are `listing-readiness`, `readiness-checklist`,
`home-redesign-wiring`, `listing-questions`, `video-media`,
`settings-preferences`, `settings-snapshot`, and `multiple-drafts`.

Resumability changes should cover the following focused surfaces before the
full suites:

```bash
backend/.venv/bin/pytest -q \
  backend/tests/test_image_quality_api.py \
  backend/tests/test_resumable_analysis.py \
  backend/tests/test_storage.py \
  backend/tests/test_migrations.py
cd mobile && npm test
```

For device acceptance, interrupt once after upload and once during analysis.
Confirm that Home lists the draft as **Unfinished listing** under **Needs
attention**, tapping it reopens the same server item ID, and completed analysis
is not called a second time. Repeat with two photo sets started back to back and
confirm Home shows one row per draft, each opening and discarding on its own.
While analysis is active,
confirm repeated requests use `GET /api/items/{id}/analysis-jobs` rather than
the full item endpoint. After analysis succeeds, open **Manage Photos** before
saving and confirm every retained photo still renders and can be submitted.
Then save and confirm the inventory uses server-backed images and the Home
screen no longer offers that operation. Also verify explicit discard,
account deletion after an interrupted upload, and seven-day expiry behavior.
This proves reconnect-driven recovery; it does not prove autonomous processing
because no background worker exists.

For notification acceptance, use a development build on a physical iPhone. Open
**Notifications** in Settings, choose **Allow Notifications**, and accept the
iOS prompt. Start an analysis, send ListFlick to the background, and confirm a
**Listing ready** alert (or **Listing needs attention** when checklist details
are missing, or when analysis fails). Repeat in the foreground and confirm no
alert is shown. Turn off **Listing Ready** and **Needs Attention** in turn and
confirm that kind stops.

For **Manage Photos** gallery acceptance, test both a local picker image and a
saved server-backed image on iOS and Android. Confirm that each tile shows a
loading indicator without hiding cached pixels, a failed authentication or
image request reaches the retry state without blocking the other photos, and
tapping every loaded tile opens the matching photo viewer. Open and close the
same cached photo more than once and confirm that viewer loading never changes
the grid tile back to loading. If a spinner is briefly visible, confirm it
disappears when the image source is attached, never remains over visible image
pixels, and never prevents opening the image. In the viewer,
swipe and use the previous/next controls, verify **Photo N of M**, then close it
with the visible control, the native iOS page-sheet swipe, and the Android back
button. Confirm that cancelling a partial sheet dismissal keeps the viewer open
and that a horizontal swipe still pages instead of dismissing. Finally confirm
that remove never opens the viewer, a normal tap never starts a reorder, a
deliberate hold still reorders, and the new order survives closing the viewer
and saving.

For the listing-preview carousel, use a listing with at least three photos on
iOS and Android. Swipe forward and backward through every photo and confirm the
active dot and screen-reader **Photo N of M** position follow only the settled
page. Start a partial swipe that snaps back and confirm the dot does not
advance. Rotate the device on a later photo and confirm the same logical photo
remains selected, paging still aligns to one full image, and the indicator
stays correct. Remove the active final photo in Manage Photos, return to Review,
and confirm the preview clamps without an empty page or exception.

For legal and support acceptance, enable airplane mode and open **Privacy &
Data** and **Terms of Service** from Settings. Confirm both documents remain
readable on a small screen and with the largest system text size, headings are
announced by VoiceOver or TalkBack, text can be selected, and the back control
returns to Settings. Open **Contact Support** with a configured mail app and
confirm the recipient, subject, app version, platform, editable prompts, and
privacy warning are present. Repeat without an available mail handler and
confirm **Copy Email** and **Copy Template** work without adding account IDs,
listing data, logs, tokens, API keys, or photos.

For AI Settings acceptance, test both deployment modes with a Firebase user
that has never saved a provider preference.

With `ALLOW_SERVER_AI_KEY_FALLBACK=false`, confirm the main **AI** card shows
only **AI Provider — Choose**, with no provider key row or selected option in
the selector. Starting AI must show the neutral **API key required** prompt and
open the provider selector without sending an AI request. Select Groq and
confirm its key sheet opens and the card reveals **Groq API Key — Not saved**.
Then select Gemini, save a Gemini key, and confirm the card shows only **AI
Provider — Gemini** and **Gemini API Key — Saved on this device**. Confirm the
save message explains that validation happens on the next AI request. Switch
back to Groq and confirm its independent status returns. The saved key must
never be rendered. Once a provider is selected, a missing key must offer **Add
API Key** and open that provider's key sheet without first sending an AI
request. Save an invalid nonblank key, start AI, and confirm the provider
rejection offers **Replace API Key** rather than implying the key was valid.
Repeat that rejection check from an Edit Listing improvement action.

With `ALLOW_SERVER_AI_KEY_FALLBACK=true` and a configured server key for
`AI_PROVIDER`, confirm the card still shows **AI Provider — Choose** before the
user saves an override, and confirm the hint identifies the provider supplied
by the deployment. Start AI and confirm the request uses `AI_PROVIDER` without
showing the provider-selection or device-key prompt. Save the other provider as
an override and confirm subsequent requests identify that provider; without
its device key, it may use only that provider's matching server key. If the
effective provider has neither a device key nor a configured server key,
confirm the app requests that provider's key.

When investigating provider selection, use the Settings and camera logs. They
separately report `savedProvider`, `backendProvider`, `effectiveProvider`,
`deviceKey`, `fallbackEnabled`, and whether the effective provider has a
matching server key. Boolean logs never report key contents. Settings initially
shows **Loading…** and logs both successful and failed AI-setting reads; moving
away before the read completes is recorded as `screenActive=false`.

For the legacy local-listing migration, install over a build that stored a
valid global `@listings` value. Sign into account A and confirm the listings
appear once in account A's scope. Sign out and sign into account B; confirm the
legacy listings do not appear again. Also confirm signed-out screens never
consume or display the global value.

In a production build, confirm the Notion developer override is not present.

For **Listing Image Download** acceptance, test on physical iOS and Android devices
before archiving any download-related plans:
1. **Permission Reset:**
   - *iOS:* In system Settings > Privacy & Security > Photos > ListFlick, set access to
     "None". Confirm tapping **Save Photos to Device** triggers the native prompt
     requesting "Add Photos Only". Confirm tapping "Don't Allow" presents the
     "Permission needed" alert explaining how to enable access in Settings.
   - *Android:* In system Settings > Apps > ListFlick > Permissions, revoke Photos
     and Videos access. Confirm the permission prompt appears on tap and rejection is
     handled gracefully.
2. **Local and Content URI Saving:**
   - On iOS, create an unsaved listing draft with local camera/picker images (`file://`).
     Select **Save Photos to Device** and confirm all photos appear in the native
     Photos app (Recents album).
   - On Android, verify with images sourced from the system photo picker (`content://`).
     Confirm assets save directly into Gallery / Google Photos without extra download steps.
3. **Protected and Signed Remote Images:**
   - Open a previously saved listing from Inventory where photos are backed by backend
     endpoints (`/api/items/<id>/image/<index>`) or signed remote storage URLs.
   - Save photos to device. Confirm the download progress/busy state appears, and
     the success alert matches the exact count saved.
4. **Inducing Failure Modes & Safe Retry:**
   - *Offline / Interrupted:* Enable Airplane mode while viewing a server-backed listing.
     Select **Save Photos to Device**. Confirm the failure alert is shown with a
     **Try Again** option.
   - *Safe Partial Retry:* Disable Airplane mode, tap **Try Again**, and confirm
     photos save without duplicating previously saved assets in the photo library.
5. **Duplicate-Tap and In-Flight Protection:**
   - Trigger a multi-photo download and immediately attempt to tap the menu action again.
     Confirm the item is disabled ("Saving Photos...") and duplicate download jobs
     are prevented.
6. **Cache Cleanup:**
   - Confirm via file inspection or device logs that no temporary staging files
     (`listflick-download-*`) remain in the application cache directory after
     completion or failure.
