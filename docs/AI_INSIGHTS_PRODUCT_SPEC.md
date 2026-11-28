# AI Insights Product Specification

This document defines the product and UX architecture for AI Insights in ListFlick. It supersedes the earlier model where every AI diagnostic card could appear on the main listing review screen.

## 1. Product Model

AI listing generation is core product behavior. The app generates an initial marketplace listing during the normal photo-to-listing flow. This generation is not controlled by the AI Insights setting.

AI Insights are premium-style guidance layered on top of the core generated listing. For now, the existing Settings toggle is the feature gate. Do not implement subscriptions, payments, entitlements, or remote billing checks yet.

The toggle controls visibility and availability of smart guidance:
- Missing information checklist.
- Image quality feedback.
- Pricing tiers, confidence, and reasoning.
- Listing quality score and suggestions.
- AI improve, rewrite, regenerate, or recalculate actions.

The toggle must not:
- Disable initial AI listing generation.
- Delete existing insight data.
- Hide save, export, inventory, or Notion sync behavior.
- Trigger AI calls merely because a screen is opened.

## 2. Screen Architecture

### View Listing

View Listing is the clean final marketplace listing preview.

It shows:
- Photos.
- Manage Photos button directly under or near the photo section.
- Active listing price.
- Title.
- Combined Description & Details card.
- Final listing fields needed for posting.
- Save, export, copy, share, post, inventory, and Notion sync actions where supported.

It does not show full AI diagnostic cards. Do not place the full missing checklist, pricing analysis, image feedback, quality score, or AI rewrite tools on this screen.

When AI Insights are ON:
- View Listing remains preview-first.
- No inline editing.
- Show small edit shortcuts:
  - Edit beside Title.
  - Edit beside Price.
  - Edit beside combined Description & Details.
- Each shortcut navigates to Edit Listing focused on the relevant section.

When AI Insights are OFF:
- View Listing supports simple manual editing.
- Title can be edited inline.
- Price can be edited inline.
- Combined Description & Details uses one modal or expandable editor.
- No AI insight labels, cards, buttons, badges, or suggestion indicators are shown.

### Edit Listing

Edit Listing is the AI-assisted listing workspace. It is mainly used when AI Insights are ON.

It contains editable listing fields:
- Title.
- Active price.
- Description.
- Category.
- Condition.
- Brand/model.
- Color.
- Material.
- Dimensions.
- Flaws/damage.
- Included accessories.
- Pickup, shipping, and payment preferences.
- Other supported listing fields.

When AI Insights are ON, this screen may show listing-related insights:
- Missing information checklist.
- Pricing tiers, confidence, warnings, and reason.
- Listing quality score and top suggestions.
- AI improve, rewrite, regenerate, or recalculate actions.

This screen does not show photo previews, Manage Photos, or image quality feedback.

### Manage Photos

Manage Photos is the dedicated photo workspace.

It always supports basic photo management where available:
- View photos.
- Add photo.
- Remove photo.
- Replace photo.
- Reorder photos.
- Set cover photo.

When AI Insights are ON:
- Show photo-specific image quality feedback and suggested actions.

When AI Insights are OFF:
- Hide image quality feedback and photo insight cards.
- Show only basic photo management.

## 3. AI Insights ON Behavior

AI Insights ON means smart guidance is visible and optional AI actions are available. It does not mean the app should constantly recalculate or rewrite content.

Expected behavior:
- View Listing remains clean and preview-first.
- Edit Listing becomes the primary workspace for listing improvements.
- Manage Photos becomes the primary workspace for photo quality guidance.
- Insight UI can reference existing generated or stored insight data.
- Optional AI actions require explicit user intent.

Allowed AI action examples:
- Improve title.
- Rewrite description.
- Make price more competitive.
- Regenerate listing from current known facts.
- Recalculate quality score if the implementation requires an explicit action.

Insight content should be concise, buyer-focused, and actionable. Avoid technical language such as raw blur scores, model confidence internals, stack traces, or API error payloads.

## 4. AI Insights OFF Behavior

AI Insights OFF means the app behaves like a simple listing editor and preview tool.

Expected behavior:
- Core AI listing generation still runs during normal listing generation.
- View Listing supports simple inline or lightweight manual editing.
- No AI insight cards, AI action buttons, premium labels, suggestion badges, pricing analysis, quality score, missing checklist, or image quality cards are visible.
- Manage Photos remains available for basic photo management only.
- Save, export, copy, share, post, inventory, and Notion sync status remain available where supported.

Existing insight data may remain in local/backend state but must be hidden from the UI.

## 5. Pricing Flow

AI may generate:
- Fast sale price.
- Recommended price.
- High ask price.
- Confidence.
- Pricing reason.
- Optional pricing warnings.

The listing has only one active price. The recommended price becomes the default active listing price after generation.

Rules:
- Manual price edits override AI suggestions.
- Selecting a pricing tier updates the active price field.
- Selecting or manually editing a price must not trigger a new AI call.
- The app may retain AI tier data for future display when AI Insights are ON.

When AI Insights are ON:
- Price editing happens in Edit Listing.
- Pricing cards live in Edit Listing.
- Recommended is visually emphasized.
- Tapping Fast sale, Recommended, or High ask updates the active price field.
- Users can still manually edit the active price.

When AI Insights are OFF:
- The user edits the active price directly from View Listing.
- No pricing cards, confidence labels, or pricing reasons are shown.

## 6. Photo Management Flow

View Listing shows photos and provides a clear Manage Photos entry point. It should not become the photo diagnostics workspace.

Manage Photos owns:
- Adding photos.
- Removing photos.
- Replacing photos.
- Reordering photos.
- Choosing the cover photo.
- Showing image quality feedback when AI Insights are ON.

Image quality feedback is photo-specific and belongs in Manage Photos, not Edit Listing.

Uploading or viewing photos may use existing deterministic validation, but opening View Listing, Edit Listing, or Manage Photos must not by itself trigger a new AI call.

## 7. AI Call / Cost Rules

Extra AI calls must be intentional.

Do not trigger new AI calls when:
- Opening View Listing.
- Opening Edit Listing.
- Opening Manage Photos.
- Toggling AI Insights ON or OFF.
- Selecting an existing price tier.
- Manually editing fields.
- Saving local edits.
- Retrying Notion sync.

AI calls are allowed when the user explicitly taps an AI action:
- Improve or rewrite listing.
- Regenerate listing.
- Generate a platform-ready version.
- Make price more competitive.
- Recalculate an AI-dependent insight, if such an insight cannot be deterministic.

Implementation note: the automatic tip re-check described in section 11 is
the one current exception to this section. It is a small, debounced, tips-only
call and is skipped when AI Insights are OFF. The product decision on whether to
keep it automatic or move it behind a tap is open.

Prefer deterministic calculations for readiness scoring, checklist status, image feedback derived from local image metrics, and compatibility transforms.

## 8. Data / State Rules

Core listing state:
- Generated listing data.
- Active listing price.
- Photos and cover photo.
- User edits.
- Save/export/Notion sync status.

Insight state:
- Missing checklist.
- Image quality feedback.
- Pricing tiers/confidence/reason.
- Quality score/suggestions.
- AI improvement drafts or history, if implemented.

Rules:
- The AI Insights toggle hides or shows insight UI; it does not delete insight data.
- The toggle must not change the active listing price.
- The toggle must not disable core listing generation.
- Manual edits are source-of-truth for user-confirmed fields.
- AI guesses should remain marked as uncertain unless the user confirms or edits them.
- Saved listings from older versions must remain readable.
- Backend and frontend types must remain compatible.
- Notion sync status remains visible regardless of AI Insights state.

## 9. Implementation Constraints

Do not introduce a large new framework for this architecture.

Prefer:
- Existing Expo Router screens and navigation patterns.
- Existing backend schemas and service boundaries.
- Existing `VisionAnalysis`, `GeneratedListing`, `PriceSuggestion`, `AIService`, `NotionService`, and Notion payload patterns.
- Deterministic helper services for non-AI calculations.
- Incremental migration from the current review screen into View Listing, Edit Listing, and Manage Photos responsibilities.

Avoid:
- Broad refactors while product behavior is still being stabilized.
- Auto-running AI calls from render or screen focus effects.
- Showing raw API errors, secrets, token details, or model internals.
- Splitting Description and Details into separate edit actions when they are visually grouped as one card.

## 10. Current Implementation Audit Checklist

This checklist reflects the current implementation as of the latest audit.

- [x] AI Insights setting exists in local storage via `getAIInsightsSettings()` / `saveAIInsightsSettings()`.
- [x] The setting is controlled from the Settings tab (`mobile/app/(tabs)/settings.tsx`).
- [x] Core single-item listing generation ignores the AI Insights toggle.
- [x] View Listing (`mobile/app/review.tsx`) has Manage Photos near the photo section.
- [x] View Listing does not show full missing checklist, pricing guidance, listing quality, image feedback, or AI improve panels.
- [x] View Listing has no inline editing when AI Insights are ON.
- [x] View Listing exposes edit shortcuts when AI Insights are ON.
- [x] View Listing supports simple manual editing when AI Insights are OFF.
- [x] Edit Listing (`mobile/app/edit-listing.tsx`) supports title, price, description, category, condition, detail fields, pricing tiers, checklist, quality score, and AI improve actions.
- [x] Manage Photos (`mobile/app/manage-photos.tsx`) supports add, remove, replace, reorder, and cover photo behavior.
- [x] Manage Photos hides image feedback when AI Insights are OFF.
- [x] Image quality feedback is not shown in Edit Listing.
- [x] Pricing tier selection changes active price without a new AI call.
- [x] Manual price edits mark the active price as manual.
- [x] Opening Review Listing, Edit Listing, and Manage Photos does not intentionally trigger extra AI calls.
- [x] Notion sync status remains visible outside the AI Insights gate.
- [x] Saved listings from older versions can still load because new fields are optional.

## 11. Current Implementation Reality

Implemented screens:
- `mobile/app/review.tsx` is the current View Listing screen.
- `mobile/app/edit-listing.tsx` is the listing workspace and owns AI improve actions.
- `mobile/app/manage-photos.tsx` is the photo workspace and owns image quality feedback display.
- `mobile/app/(tabs)/settings.tsx` stores seller defaults and the AI Insights toggle.

Implemented data flow:
- Initial generation is triggered only from `mobile/app/processing.tsx`.
- Single-item generation uses upload-multiple plus `/api/items/analyze`.
- Draft listing edits and photo changes are stored locally through `DraftListingEdits`.
- Saved inventory entries are stored in AsyncStorage through `SavedListing`.
- The active listing price is separate from retained AI price tiers.

Implemented AI Insights behavior:
- AI Insights ON: Review Listing uses edit shortcuts and routes to Edit Listing.
- AI Insights OFF: Review Listing shows simple inline editing and hides insight UI.
- Edit Listing shows pricing guidance, quality score, missing checklist, and AI improve actions only when AI Insights are ON.
- Manage Photos shows photo feedback only when AI Insights are ON.
- Edit Listing offers eight "Improve with AI" chips (more searchable title,
  shorter description, more casual, more professional, add condition details,
  build buyer trust, more competitive price, Marketplace-ready polish), hidden
  when AI Insights are OFF. Each is an explicit tap through `POST /api/items/improve`,
  and "more competitive price" also updates the price tiers. The
  `pricing_reason` shows under the tiers.
- Claude is a third provider beside Gemini and Groq, selected the same way
  (saved device key or server `ANTHROPIC_API_KEY`). The AI-call rules above apply
  to it unchanged.
- Analysis sends every photo (up to 8, cover first) in one vision call, and
  video frames count toward that budget. A listing can have one video, which is
  not gated by AI Insights.
- The vision step can return one price question and up to three buyer
  questions. They appear as open questions on View Listing and Edit Listing and
  are answered through `POST /api/items/{item_id}/answers` (an explicit user
  action; dismissing questions makes no AI call). Open questions also appear as
  missing checklist items.
- View Listing shows a live "Ready to list" checklist and score computed on the
  device from the listing as it stands (`mobile/utils/readinessChecklist.ts`).
  It is deterministic, makes no AI call, and recalculates on every change. This
  is separate from the AI-gated checklist and quality score in Edit Listing.
- `POST /api/items/recheck` re-checks the open AI tips automatically, about 1.5
  seconds after photos change (with the stored photos) or the text, price,
  condition, or category changes (text only). It runs only on View Listing, only
  when AI Insights are ON and a provider key is usable, never on first open, and
  not when no tip is open (`mobile/hooks/useListingRecheck.ts`). This is a
  deliberate exception to the explicit-tap rule in section 7; see the note there.
- AI improve actions require explicit taps and return a preview that must be accepted before replacing current fields.
- Analyze and listing improvement use the saved mobile provider when present.
  With server fallback enabled and no saved preference, they use the backend
  `AI_PROVIDER`; Settings shows **Choose** because no user override is stored
  and identifies the deployment-supplied provider in its hint. A device key is
  labeled **Saved on this device** until the provider validates it on an AI
  request; a rejection routes to the matching replacement-key flow.

Implemented photo behavior:
- Manage Photos uses a selected-photo model.
- Tap a photo to select it.
- Long-press a photo to make it the cover.
- A single toolbar acts on the selected photo.

## 12. Mismatches And Open UX Gaps

These are documentation/product mismatches or implementation gaps. They are not implementation instructions by themselves.

- **Review styling mismatch:** View Listing behavior mostly matches the architecture, but the visual design still has older high-emphasis buttons, emoji button labels, and card-heavy styling.
- **Manage Photos affordance mismatch:** The selected-photo toolbar reduces repeated buttons, but the screen still relies on visible helper text and long-press discovery. This may need a clearer human UI pattern.
- **Edit Listing density mismatch:** Edit Listing has many fields and AI actions in a single long scroll. It matches the feature architecture but may need grouping or progressive disclosure.
- **Description/details mismatch:** Structured detail fields are stored in draft state and appended into the description. Review Listing does not display those details as separate structured fields.
- **Focus target mismatch:** Edit Listing receives `focus` params, but the screen currently displays the focus as text rather than scrolling/focusing the relevant section.
- **Automatic re-check mismatch:** `POST /api/items/recheck` fires after edits on View Listing without a tap, which conflicts with sections 3 and 7 (see the note in section 7).
- **Notion persistence mismatch:** Review Listing displays Notion status from backend responses during the session, but locally saved inventory records do not persist full `NotionSyncStatus`.
