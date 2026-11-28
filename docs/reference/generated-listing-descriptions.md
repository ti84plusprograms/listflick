# Generated listing descriptions

The backend owns the final generated-description format. AI providers return
structured description sections when supported, and
`backend/app/services/description_renderer.py` renders them into one stable,
Facebook Marketplace-ready description.

## Rendering contract

The renderer emits plain text with no emoji headers and no price, in this
order, separated by blank lines:

1. A short opening sentence or two.
2. `Details:` followed by `- ` bullets of distinct facts (3 to 8). With fewer
   than 3 facts the list is omitted and the facts become short sentences after
   the opening.
3. `Condition:` with one concise condition statement (a placeholder when the
   model gave none).
4. One logistics line, such as `Pickup in Midtown. Cash or Venmo. Open to
   reasonable offers.`

```text
Apple iPhone 13 in blue, unlocked.

Details:
- 128GB storage
- Model A2482

Condition: Good. Light scratches on the back glass.

Pickup in Midtown. Cash or Venmo. Open to reasonable offers.
```

The renderer removes duplicate facts, strips bullet prefixes before re-rendering,
and removes suggested-price prose. It accepts a `price` argument only for
compatibility and never writes it: Marketplace shows the price separately, and
a price line goes stale when the seller edits the price. Placeholder text in
logistics lines is dropped, and the closing sentence is kept only when it is
about offers. The model must not invent missing facts or payment methods.

Before rendering, `backend/app/utils/humanize.py` strips em dashes, emojis,
curly quotes and bold markers from model text so the result reads the same
whichever provider (Gemini, Groq, or Claude) wrote it.

## Compatibility behavior

Older provider responses may contain only the legacy free-form `description`
field. Those responses are cleaned by `normalize_description`, which keeps the
blank lines of the plain layout and delegates to `normalize_legacy_description`
for text that uses the earlier emoji headers (`🔹 Features:`, `💵 Price:`,
`✅ Condition:`, `📍 Pickup Details:`). Stored listings in that older layout
keep loading, and `strip_price_lines` removes stale price lines. New structured
responses take precedence over the legacy string.

The mobile client continues to receive a normal `description` string. This
keeps the current API and saved-listing behavior compatible while moving format
ownership out of the mobile parser. The mobile formatter
(`mobile/utils/descriptionFormatter.ts`) detects the layout, treating emoji
headers as legacy and everything else as plain, and edits managed lines inside
the `Details:` list, the `Condition:` line, and the logistics line without
writing a price into the description.

## Extension guidance

New description behavior should be added to the structured sections or the
renderer rather than by adding more duplicated rules to individual prompts or
mobile string mutations. If a new field is needed, update the provider output
schema, renderer, tests, and affected API/mobile contracts together.
