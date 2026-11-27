# System architecture

```text
Expo React Native client
        │ Firebase ID token
        ▼
FastAPI backend on local machine or Render
        ├── Firebase Admin token verification
        ├── PostgreSQL item records, analysis leases, and UID ownership checks
        ├── request-inline Gemini, Groq, or Claude analysis/generation
        ├── optional Notion synchronization
        └── Storage abstraction
                ├── private Supabase bucket when configured
                └── backend/uploads fallback for local development
```

Backend routes handle transport and dependency wiring. Item image and lifecycle
orchestration is in `backend/app/services/item_api_service.py`; analysis and
listing orchestration is in `analyze_service.py`; provider storage behavior is
in `storage_backends.py`, with the public contract in `storage_contract.py`.
Listing response normalization and image feedback assembly are in
`listing_response.py`.
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
