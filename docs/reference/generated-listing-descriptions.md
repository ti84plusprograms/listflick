# Generated listing descriptions

The backend owns the final generated-description format. AI providers return
structured description sections when supported, and
`backend/app/services/description_renderer.py` renders them into one stable,
Facebook Marketplace-ready description.

## Rendering contract

The renderer emits sections in this order:

1. A short opening sentence.
2. `🔹 Features:` with distinct factual bullets.
3. `💵 Price:` using the normalized recommended price.
4. `✅ Condition:` with one concise condition statement.
5. `📍 Pickup Details:` with logistics lines or safe placeholders.
6. An optional short closing sentence.

The renderer removes duplicate facts, strips bullet prefixes before re-rendering,
removes suggested-price prose, and adds placeholders when price or logistics are
unknown. The model must not invent missing facts or payment methods.

## Compatibility behavior

Older provider responses may contain only the legacy free-form `description`
field. Those responses are cleaned by `normalize_legacy_description` and remain
usable. New structured responses take precedence over the legacy string.

The mobile client continues to receive a normal `description` string. This
keeps the current API and saved-listing behavior compatible while moving format
ownership out of the mobile parser. The mobile description editor may still
parse older descriptions for backward compatibility.

## Extension guidance

New description behavior should be added to the structured sections or the
renderer rather than by adding more duplicated rules to individual prompts or
mobile string mutations. If a new field is needed, update the provider output
schema, renderer, tests, and affected API/mobile contracts together.
