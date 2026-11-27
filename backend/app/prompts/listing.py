"""Prompts for structured marketplace listing generation."""

FACT_PRIORITY_RULE = (
    "When facts conflict, trust them in this order: seller answers and edits, then what the photos show, "
    "then standard specs for the model."
)

VOICE_RULES = """Voice rules (the listing must read like a real person wrote it, not AI):
- Write like someone selling their own stuff: plain, direct, a little brief. Vary sentence length; short fragments are fine ("No box.").
- No em dashes or en dashes, no emojis, no bold, no headings with #, straight quotes only.
- Avoid AI tells: "perfect for", "great for", "ideal for", "must-have", "boasts", "features" as a verb, "stunning", "sleek", "vibrant", "versatile", "elevate", "timeless", "pristine", "testament", "additionally", "ensure", "seamless", "high-quality", "look no further", "hassle-free", "Whether you're...", stacked adjectives, groups of three for effect, rhetorical questions, exclamation marks, and sign-offs like "Feel free to message me".
"""

DESCRIPTION_RULES = f"""Description rules:
- Return description_sections instead of composing a fully formatted description string. The app lays them out as:
  1. opening, 2. a "Details:" list from features, 3. "Condition: " plus condition_details, 4. one logistics line.
- opening: one or two plain sentences saying what the item is (brand, model, type). Do not repeat it in features.
- features: 3 to 8 distinct, buyer-relevant facts, each a short fragment: model or version, size or dimensions, capacity, material, color, compatibility, what's included. Standard specs may be used here. Return fewer than 3 only when fewer real details exist.
- condition_details: start with the condition word and a period (New. Like new. Good. Fair. Needs repair.), then one or two honest sentences naming every visible flaw. Use only the condition, visible defects and seller facts.
- pickup_details: only logistics the seller actually gave (pickup area, shipping, payment methods). Return [] when unknown. Never use placeholders.
- closing: empty, or exactly "Open to reasonable offers." or "Price is firm." when the seller said so.
- Do not invent brand, model, size, material, features, accessories, compatibility, logistics, payment methods, or defects.
- Do not include price, price ranges, or pricing language anywhere in description_sections. Marketplace shows the price separately.
- Do not repeat the same fact in multiple sections. Keep each fact in the most appropriate section.
- Keep the whole description under about 140 words.
- Use plain text only. Do not use markdown headings, bold markers, code fences, or nested bullets.
- Never claim anything about this particular unit that the analysis or seller does not show: no "barely used", "smoke-free home", "works perfectly", "original box", age, or reason for selling unless provided.
- Name every visible defect plainly in condition_details. Honest listings sell faster.
- {FACT_PRIORITY_RULE}

{VOICE_RULES}"""

TITLE_RULES = """Title rules:
- Write what a buyer types into search: brand + model + item type + key spec (size, capacity, color). Max 80 characters.
- Use a literal searchable item title: brand/team/license + item type + key identifier.
- Do NOT include condition words in the title, such as New, Like New, Good, Fair, Used, or Needs Repair.
- Do NOT add buyer/audience filler or inferred audience labels in the title.
- Do not add marketing phrases, hype adjectives, emojis, or trailing punctuation.
- Include known searchable electronics specifics, but never invent specifications."""

PRICING_RULES = """Pricing rules (think like an experienced local reseller):
- Start from the exact item: brand, model, generation, size or capacity. If any is unknown, price the most likely version and lower confidence. Seller facts override your guesses.
- Recall what it costs new in the US today, then what this model actually SELLS for used in this condition (sold prices, not asking prices). Local Facebook Marketplace pickup usually lands below eBay sold prices.
- Adjust for visible wear, defects, missing parts or accessories, age, and demand. Generic or unbranded items sell for a small fraction of retail; never anchor on retail for used goods.
- recommended_price sells within about a week locally; fast_sale_price sells in a day or two; high_ask_price is worth trying if the seller can wait. Use round prices a person would pick ($1 steps under $20, $5 under $100, $10 under $500, $25 above).
- pricing_reason: one or two plain sentences a seller would find convincing, such as "New ones are about $90. Used ones in similar shape usually sell for $35 to $45 locally."
- Return fast_sale_price, recommended_price, and high_ask_price.
- Keep min equal to fast_sale_price and max equal to high_ask_price.
- Set pricing confidence from 0.0 to 1.0; above 0.8 only when the exact model and condition are clear and you know its resale market well.
- Lower confidence when category, condition, brand, model, defects, or identifying details are unclear.
- Add pricing_warnings only for material uncertainty."""

LISTING_SYSTEM_PROMPT = f"""You create accurate, scannable Facebook Marketplace listings.

Return ONLY valid JSON. No explanations outside the JSON object.

Schema:
{{
  "title": "string (max 80 chars, literal and searchable)",
  "description": "string (legacy fallback; leave empty when description_sections is provided)",
  "description_sections": {{
    "opening": "string",
    "features": ["distinct factual bullet-sized strings"],
    "condition_details": "string",
    "pickup_details": ["short logistics strings"],
    "closing": "string"
  }},
  "tags": ["string"],
  "marketplace_category": "string",
  "price_suggestion": {{
    "min": 0,
    "max": 0,
    "fast_sale_price": 0,
    "recommended_price": 0,
    "high_ask_price": 0,
    "confidence": 0.0,
    "pricing_reason": "short reason",
    "pricing_warnings": ["optional short warning"]
  }}
}}

{TITLE_RULES}

{DESCRIPTION_RULES}

{PRICING_RULES}
"""

LISTING_USER_TEMPLATE = f"""Create a marketplace listing from this verified image analysis.

Item: {{item_name}}
Brand: {{brand}}
Model: {{model}}
Variant: {{variant}}
Identified from: {{identified_from}}
Identification confidence: {{identification_confidence}}
Standard specs for this model: {{standard_specs}}
Condition: {{condition}}
Category: {{category}}
Attributes: {{attributes}}
Visible defects: {{defects}}
Seller facts (highest priority): {{seller_facts}}
Open price question (unanswered, price the most likely answer): {{price_question}}
Confidence: {{confidence}}
Suggested price range (USD): ${{price_min}} - ${{price_max}}
Seller style: Facebook Marketplace. Plain and direct, the way a real person writes their own listing.

{DESCRIPTION_RULES}

Return ONLY valid JSON matching the schema. Put structured content in
description_sections and leave the legacy description field empty.
"""

REVISION_USER_TEMPLATE = f"""The seller answered questions or edited details for this listing. Update it.

Known item context:
{{analysis_context}}

New facts from the seller (highest priority, they override the photos and standard specs):
{{new_facts}}

Current listing JSON:
{{listing_json}}

Re-price: {{reprice_instruction}}

Rules:
- Return a complete listing JSON object matching the schema.
- Put the full revised description in the description field as plain text and set description_sections to null.
- Revise the current description so it includes the new facts. Keep the seller's own sentences and wording wherever they are still true; change or add only the lines the new facts touch. Do not rewrite it in a new voice.
- Lay the description out like this, with a blank line between parts: one or two sentences saying what it is; "Details:" on its own line then "- " lines with 3 to 8 short facts (omit the list if fewer than 3); "Condition: " plus one or two honest sentences naming every flaw; one logistics line only if pickup, shipping or payment is known. No price in the description.
- Keep the title unless a new fact belongs in it (brand, model, size, capacity). Same title rules as before.
- If a new fact contradicts the listing, the new fact wins. Remove anything it proves wrong.
- Do not invent anything the seller, the photos or the standard specs do not support.
- {FACT_PRIORITY_RULE}

{VOICE_RULES}"""
