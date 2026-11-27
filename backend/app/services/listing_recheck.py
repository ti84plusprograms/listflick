"""Re-check earlier AI tips against the listing's current photos and text.

The mobile "Ready to list" checklist calls this after the seller adds, removes or
reorders photos (with images) or edits the text (without images). The model says
which earlier tips are now done, may add up to two new ones, and grades each photo.

Photos are sent as one numbered contact sheet so the call works with the existing
single-image ``generate_json`` of every provider client.
"""

from __future__ import annotations

import io
import logging
import math
import re
import time
from typing import Any

from fastapi import HTTPException
from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.schemas.listing import ImageQualityFeedback
from app.schemas.recheck import (
    MAX_RECHECK_TIPS,
    ListingTip,
    RecheckListingRequest,
    RecheckListingResponse,
    RecheckModelOutput,
)
from app.services.ai_credentials import AIProviderCredentialInvalidError
from app.services.claude_client import ClaudeClientError
from app.services.gemini_client import GeminiClientError
from app.services.groq_client import GroqClientError
from app.services.image_service import build_image_quality_feedback
from app.utils.humanize import humanize_text

logger = logging.getLogger("uvicorn.error")

MAX_RECHECK_IMAGES = 8
MAX_NEW_SUGGESTIONS = 2
CONTACT_SHEET_TILE = 448
_STATUS_RANK = {"good": 0, "needs_improvement": 1, "poor": 2}
_PHOTO_TIP = re.compile(r"photo|picture|pic\b|shot|angle|image|lighting|label|close-?up|background|video", re.I)

RECHECK_SYSTEM_PROMPT = (
    "You review Facebook Marketplace listings for ListFlick. You decide which earlier "
    "suggestions the seller has now finished. Be strict and literal: a suggestion is done only "
    "when the listing clearly shows it. Reply with one JSON object and nothing else."
)


def is_photo_tip(text: str) -> bool:
    return bool(_PHOTO_TIP.search(text or ""))


def build_recheck_prompt(payload: RecheckListingRequest, *, image_count: int) -> str:
    with_images = image_count > 0
    facts = {
        "category": payload.category,
        "condition": payload.condition,
        "asking_price": payload.asking_price,
    }
    tip_lines = "\n".join(
        f"{index}. {tip.text}{' (already done)' if tip.done else ''}"
        for index, tip in enumerate(payload.tips, start=1)
    ) or "(none)"
    photos_line = (
        f"The attached image is a contact sheet of the seller's {image_count} current photo"
        f"{'' if image_count == 1 else 's'}, numbered in order (photo 1 is the cover)."
        if with_images
        else "No photos are attached this time; judge only the text and facts."
    )
    rules = [
        "1. done: the numbers of suggestions that are now satisfied by the photos, title, description or facts. "
        "A photo suggestion is done only if a photo clearly shows it."
        + ("" if with_images else " Leave photo suggestions as they are."),
        "2. new_suggestions: at most 2 short, plain, actionable suggestions, only for something important that is "
        "still missing and not already listed. Usually none.",
    ]
    reply_shape = '{"done":[],"new_suggestions":[]}'
    if with_images:
        rules.append(
            "3. image_quality_feedback: one entry per photo, image_index from 1, overall_status good | "
            "needs_improvement | poor, suggested_action as a short phrase."
        )
        reply_shape = (
            '{"done":[],"new_suggestions":[],"image_quality_feedback":'
            '[{"image_index":1,"overall_status":"good","suggested_action":""}]}'
        )
    return "\n".join(
        [
            "You check a Facebook Marketplace listing for ListFlick and say which earlier suggestions are now done.",
            photos_line,
            "",
            "Item facts:",
            str(facts),
            f"Title: {payload.title!r}",
            "Description:",
            '"""',
            payload.description,
            '"""',
            "Earlier suggestions:",
            tip_lines,
            "",
            *rules,
            "Reply with only one JSON object, no other text:",
            reply_shape,
        ]
    )


def _label_font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1 has no sized default font.
        return ImageFont.load_default()


def build_contact_sheet(images: list[bytes], *, tile: int = CONTACT_SHEET_TILE) -> bytes:
    """Lay photos out in a numbered grid and return one JPEG."""

    tiles: list[Image.Image] = []
    for raw in images[:MAX_RECHECK_IMAGES]:
        try:
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        except Exception:  # noqa: BLE001 - an unreadable photo gets a blank tile, keeping numbering stable.
            img = Image.new("RGB", (tile, tile), (200, 200, 200))
        tiles.append(ImageOps.pad(img, (tile, tile), color=(255, 255, 255)))
    if not tiles:
        raise ValueError("No images to lay out")

    columns = max(1, math.ceil(math.sqrt(len(tiles))))
    rows = math.ceil(len(tiles) / columns)
    gap = 8
    sheet = Image.new(
        "RGB",
        (columns * tile + (columns - 1) * gap, rows * tile + (rows - 1) * gap),
        (255, 255, 255),
    )
    draw = ImageDraw.Draw(sheet)
    font = _label_font(36)
    for index, img in enumerate(tiles):
        x = (index % columns) * (tile + gap)
        y = (index // columns) * (tile + gap)
        sheet.paste(img, (x, y))
        draw.rectangle((x, y, x + 56, y + 52), fill=(26, 26, 26))
        draw.text((x + 16, y + 6), str(index + 1), fill=(255, 255, 255), font=font)

    out = io.BytesIO()
    sheet.save(out, format="JPEG", quality=82)
    return out.getvalue()


def _merge_tips(
    tips: list[ListingTip],
    output: RecheckModelOutput,
    *,
    with_images: bool,
) -> list[ListingTip]:
    merged = [ListingTip(text=tip.text, done=tip.done) for tip in tips]
    for number in output.done:
        index = number - 1
        if 0 <= index < len(merged):
            # Without photos the model cannot confirm a photo tip; keep it open.
            if not with_images and is_photo_tip(merged[index].text):
                continue
            merged[index].done = True

    added = 0
    for raw in output.new_suggestions:
        if added >= MAX_NEW_SUGGESTIONS or len(merged) >= MAX_RECHECK_TIPS:
            break
        text = humanize_text(raw).strip()[:500]
        if not text or any(tip.text.lower() == text.lower() for tip in merged):
            continue
        merged.append(ListingTip(text=text, done=False))
        added += 1
    return merged


def _photo_feedback(images: list[bytes], output: RecheckModelOutput) -> list[ImageQualityFeedback]:
    """Combine the pixel checks used at upload with the model's verdict; the worse one wins."""

    verdicts = {v.image_index: v for v in output.image_quality_feedback}
    feedback: list[ImageQualityFeedback] = []
    for index, raw in enumerate(images[:MAX_RECHECK_IMAGES]):
        try:
            base, _ = build_image_quality_feedback(raw, image_index=index)
        except Exception:  # noqa: BLE001
            base = {"image_index": index}
        entry: dict[str, Any] = {**base, "image_index": index}
        verdict = verdicts.get(index + 1)
        status = verdict.overall_status if verdict else ""
        if status in _STATUS_RANK and _STATUS_RANK[status] > _STATUS_RANK.get(entry.get("overall_status", "good"), 0):
            entry["overall_status"] = status
            action = humanize_text(verdict.suggested_action).strip() if verdict else ""
            if action:
                entry["suggested_action"] = action
                entry["notes"] = [*entry.get("notes", []), action]
            elif status == "poor":
                entry["suggested_action"] = "Retake this photo before posting."
        feedback.append(ImageQualityFeedback.model_validate(entry))
    return feedback


def _client_for(ai: Any) -> Any:
    # AIService keeps the provider client private; tests may pass a client directly.
    return getattr(ai, "_client", ai)


async def recheck_listing_record(
    payload: RecheckListingRequest,
    images: list[bytes],
    *,
    ai: Any,
) -> RecheckListingResponse:
    images = images[:MAX_RECHECK_IMAGES] if payload.include_images else []
    with_images = bool(images)
    image_bytes = build_contact_sheet(images) if with_images else None

    start = time.perf_counter()
    try:
        output = await _client_for(ai).generate_json(
            system_instruction=RECHECK_SYSTEM_PROMPT,
            user_prompt=build_recheck_prompt(payload, image_count=len(images)),
            image_bytes=image_bytes,
            schema_model=RecheckModelOutput,
            max_output_tokens=1024,
        )
    except AIProviderCredentialInvalidError as exc:
        from app.services.analyze_service import provider_credential_invalid_error

        raise provider_credential_invalid_error(ai) from exc
    except (GeminiClientError, GroqClientError, ClaudeClientError) as exc:
        logger.warning("Listing re-check failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    logger.info(
        "Listing re-check completed in %.2fs (images=%d, tips=%d)",
        time.perf_counter() - start,
        len(images),
        len(payload.tips),
    )

    return RecheckListingResponse(
        item_id=payload.item_id,
        tips=_merge_tips(payload.tips, output, with_images=with_images),
        image_quality_feedback=_photo_feedback(images, output) if with_images else [],
        checked_images=len(images),
    )
