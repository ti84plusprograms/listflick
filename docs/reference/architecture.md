# System architecture

```text
Expo React Native client
        │ Firebase ID token
        ▼
FastAPI backend on local machine or Render
        ├── Firebase Admin token verification
        ├── PostgreSQL item records, analysis leases, and UID ownership checks
        ├── request-inline Gemini, Groq, or Claude analysis/generation
        │   (all photos plus selected video frames in one vision call)
        ├── optional Notion synchronization
        └── Storage abstraction
                ├── private Supabase bucket when configured (photos and video)
                └── backend/uploads fallback for local development
```

Backend routes handle transport and dependency wiring. Item image and lifecycle
orchestration is in `backend/app/services/item_api_service.py`; analysis and
listing orchestration is in `analyze_service.py`; provider storage behavior is
in `storage_backends.py`, with the public contract in `storage_contract.py`.
Listing response normalization and image feedback assembly are in
`listing_response.py`. Provider clients are `gemini_client.py`,
`groq_client.py`, and `claude_client.py` (Anthropic Messages API), behind
`ai_service.py`; `utils/humanize.py` removes em dashes, emojis, curly quotes and
bold from model text before it is rendered. Listing questions and seller
answers are handled in `analyze_service.py`, the checklist in
`listing_checklist.py`, and the tip re-check route (`api/recheck.py`) in
`listing_recheck.py`. One video per listing is validated and stored by
`video_service.py`, with frame selection in `video_frames.py`; the body-size
guard for video uploads is `utils/body_limit.py`.
Resumable analysis claims, lease handling, and transactional completion live in
`resumable_analysis.py`. The active Render blueprint has only a web service: a
request owns the AI call, while PostgreSQL preserves enough state for the
mobile client to resume after reconnecting. It is not an autonomous queue.
Generated listing descriptions use structured provider sections rendered by
`backend/app/services/description_renderer.py`; legacy free-form descriptions
are cleaned as a compatibility fallback.

The mobile API boundary is `mobile/services/api.ts`. Auth state is managed by
`mobile/state/AuthContext.tsx`; protected image loading by
`mobile/components/AuthenticatedImage.tsx`; local listing state by
`mobile/services/storage.ts` and workspace contexts. Inventory navigation passes
only a saved-listing ID; the review screen hydrates the full workspace from the
UID-scoped local store instead of serializing the complete listing into route
parameters.
Before upload, the mobile client persists a user-scoped operation ID and image
references. The same ID becomes the upload idempotency key; after upload the
server item ID is saved immediately. Home can then resume polling or kickoff
without another item upload.

The home screen is built from the saved listings and every unfinished analysis
(`mobile/utils/listingReadiness.ts`). The review screen computes its "Ready to
list" checklist on the phone from the listing as it stands
(`mobile/utils/readinessChecklist.ts`) and calls `POST /api/items/recheck` to
re-check the AI tips after photo or text edits. Several unfinished listings can
exist at once: `mobile/services/storage.ts` keeps them as a list keyed by
operation ID. The camera records or picks one video per listing
(`mobile/services/videoFrames.ts` extracts candidate frames), and the video
uploads with the item.

Appearance (light or dark) is held by `mobile/state/AppearanceContext.tsx` and
persisted in AsyncStorage as `@appearance`; screens build their styles with
`themedStyles` so they redraw when it changes. Notifications are local only
(`mobile/services/notifications.ts`, `expo-notifications`): ListFlick schedules
an alert when an analysis finishes or fails while the app is in the background,
according to the preferences stored under `@notification_preferences`. There is
no push server, no device token, and no remote push. The Expo config plugin
`mobile/plugins/withoutPushEntitlement.js` removes the `aps-environment`
entitlement that `expo-notifications` would otherwise add.
