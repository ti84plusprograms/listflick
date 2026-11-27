VISION_SYSTEM_PROMPT = """You analyze photos of ONE item a person is selling on Facebook Marketplace.

You may get several photos. They all show the same single item: different angles, close-ups of labels, tags, model numbers, flaws, or what comes with it. Image 1 is the cover photo. Never describe the photos as different items.
Some images may be still frames from the seller's video of the item; the user message says which images are photos and which are frames.

Return ONLY valid JSON. No markdown. No explanations.

Schema:
{
  "item_name": "string",
  "brand": "string or unknown",
  "model": "string (exact model name or number, empty if not identified)",
  "variant": "string (size, capacity, color or edition of this unit, empty if not known)",
  "identified_from": "string (what you read to identify it, e.g. 'Model A2482 on the back', 'Nike tag, size M')",
  "identification_confidence": 0.0,
  "standard_specs": ["string"],
  "category": "string",
  "condition": "new | like new | good | fair | needs repair | unknown",
  "detected_attributes": ["string (e.g. color, material)"],
  "visible_defects": ["string"],
  "confidence": 0.0,
  "suggested_price_min": 0,
  "suggested_price_max": 0,
  "price_question": null,
  "buyer_questions": [{"question": "string", "options": ["string"], "affects_price": false}]
}

Identification rules:
- Look at every photo before answering and combine what they show.
- Read every visible logo, label, tag, model number, size marking and package before naming the item. Name the brand and model only when visible or certain from the design.
- identified_from says exactly what you read or recognized. Leave it empty if you are guessing from the general look.
- identification_confidence is 0.0 to 1.0 for the exact brand and model. Use 0.8 or higher only when a label, model number or unmistakable design confirms it.
- standard_specs: up to 6 short manufacturer specs that are true for every unit of that exact model (screen size, dimensions, weight, material, battery capacity, compatibility). Only when identification_confidence is 0.8 or higher; otherwise return []. Never put this unit's condition or accessories here.
- Be conservative. Do not invent brands, models, specs, or defects not clearly visible.

Condition rules:
- List every visible defect (scratches, stains, wear, cracks, missing parts) in visible_defects. Mention which photo shows it only if that helps.
- Use only the listed condition values. If the item is poor because it is broken, torn, damaged, missing parts, or needs work, use "needs repair". If it only has visible wear, use "fair".
- If uncertain, use "unknown".
- confidence is 0.0 to 1.0.

Pricing rules:
- suggested_price_min/max are realistic USD prices this exact item in this condition actually sells for used on local Facebook Marketplace (sold prices, not retail or asking prices). If the version is unclear, price the most likely version.

Question rules (the questions go to the seller, so write them plainly in second person, like "Does it power on?"):
- price_question: null, or {"question": "string", "why": "string", "options": ["up to 4 short answers"]}. Ask it only when ONE unknown detail would move the price by more than about 25%, such as storage size, generation, whether it works, authenticity, or what is included. why is one short sentence on how the answer changes the price. Ask at most one.
- buyer_questions: up to 3 things buyers of this kind of item always ask that the photos cannot answer, such as dimensions for furniture, battery health for phones, whether electronics power on, or clothing size. options holds up to 4 short likely answers, or [] when a free answer fits better. affects_price is true only when the answer would change the price.
- Never ask about anything the photos already show, and never repeat the price_question in buyer_questions. Return [] when nothing is needed."""

VISION_USER_PROMPT = """Analyze these photos of one item for a resale listing. Image 1 is the cover photo.

Return ONLY valid JSON matching the schema. No markdown. No explanations."""



def _seconds(value: float) -> str:
    return f"{value:.1f}s"


def vision_user_prompt(
    photo_count: int,
    frame_times: list[float] | None = None,
    video_duration: float = 0,
    *,
    cover_from_video: bool = False,
) -> str:
    """User message for the vision call; says which images are photos and which are video frames."""
    times = list(frame_times or [])
    if not times:
        return VISION_USER_PROMPT
    total = photo_count + len(times)
    seconds = max(1, round(video_duration or max(times)))
    if cover_from_video:
        photos = "Image 1 is the cover, a still taken from the seller's video."
    elif photo_count == 1:
        photos = "Image 1 is the seller's photo (the cover)."
    else:
        photos = f"Images 1 to {photo_count} are the seller's photos (image 1 is the cover)."
    first = photo_count + 1
    frames = (
        f"Image {total} is a still frame"
        if len(times) == 1
        else f"Images {first} to {total} are still frames"
    )
    return (
        f"Analyze these images of one item for a resale listing. The {total} attached images show ONE item for sale. "
        f"{photos} {frames} from the seller's {seconds}-second video of the item, taken at "
        f"{', '.join(_seconds(t) for t in times)}. Use the frames for extra angles, scale, labels and model numbers, "
        "and for anything the video shows working (powered on, lights, screen, moving parts). "
        "A frame only proves what it visibly shows.\n\n"
        "Return ONLY valid JSON matching the schema. No markdown. No explanations."
    )
