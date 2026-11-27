"""Shared helpers for sending one or more photos of an item to a vision model."""

from __future__ import annotations

MAX_ANALYSIS_IMAGES = 8


def collect_images(
    image_bytes: bytes | None = None,
    images: list[bytes] | None = None,
    *,
    limit: int = MAX_ANALYSIS_IMAGES,
    max_total_bytes: int | None = None,
) -> list[bytes]:
    """Return the photos to send, in order, with image 1 as the cover.

    ``images`` wins when given; ``image_bytes`` is the older single-photo argument and is used
    when ``images`` is empty. Empty entries are dropped, the list is capped at ``limit`` and,
    when ``max_total_bytes`` is set, at the photos that fit in that budget (the cover always fits).
    """
    candidates = [image for image in (images or []) if image]
    if not candidates and image_bytes:
        candidates = [image_bytes]

    selected: list[bytes] = []
    total = 0
    for image in candidates[: max(1, limit)]:
        if max_total_bytes is not None and selected and total + len(image) > max_total_bytes:
            break
        selected.append(image)
        total += len(image)
    return selected


def image_label(index: int, count: int) -> str:
    """Short text label placed before each photo when several are sent."""
    if index == 0:
        return f"Image 1 of {count} (cover photo):"
    return f"Image {index + 1} of {count}:"
