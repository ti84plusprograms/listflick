"""Pick the most useful still frames from a seller's video for the vision model.

The phone extracts evenly spaced candidate frames (about 1.5 per second, 6 to 24 of
them) and uploads them with the video. This module scores each candidate and picks
the ones worth sending: sharp, not dark, and as different from each other as
possible. A video that mostly shows one view yields fewer frames; one that walks
around the item yields more. It is a Pillow port of the approved web prototype's
``extractFrames``.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from PIL import Image, ImageOps

# Analysis budget: at most 6 frames, at least 2 when there are photos, and never
# more images in total than the provider accepts.
MAX_VIDEO_FRAMES = 6
MIN_FRAMES_WITH_PHOTOS = 2
MAX_FRAME_CANDIDATES = 24

STATS_SIZE = 64
SIGNATURE_GRID = 8
DARK_MEAN_THRESHOLD = 18.0
BLURRY_FRACTION = 0.3
NEAR_DUPLICATE_DISTANCE = 5.0
LONG_VIDEO_SECONDS = 4.0
LONG_VIDEO_MIN_FRAMES = 3
FRAME_MAX_DIMENSION = 1024


@dataclass(frozen=True)
class FrameStats:
    sharpness: float
    brightness: float
    signature: tuple[float, ...]


@dataclass(frozen=True)
class FrameCandidate:
    index: int
    time: float
    content: bytes
    stats: FrameStats = field(compare=False)

    @property
    def sharpness(self) -> float:
        return self.stats.sharpness


@dataclass(frozen=True)
class SelectedFrame:
    candidate: FrameCandidate
    rank: int
    """Order in which farthest-point selection picked the frame (0 is the sharpest)."""


def frame_budget(photo_count: int, max_images: int = 8) -> int:
    """How many video frames go into the vision call next to ``photo_count`` photos."""
    if photo_count <= 0:
        return min(MAX_VIDEO_FRAMES, max_images)
    return min(MAX_VIDEO_FRAMES, max(MIN_FRAMES_WITH_PHOTOS, max_images - photo_count))


# Frames are phone video stills; anything far bigger is not one and would be costly to decode
# (a small, highly compressed PNG can expand to hundreds of MB).
MAX_FRAME_PIXELS = 24_000_000


def _open_frame(content: bytes, target: int) -> Image.Image:
    """Decode a frame as RGB, refusing oversized images and letting JPEGs decode at reduced scale."""
    with Image.open(io.BytesIO(content)) as opened:
        width, height = opened.size
        if width * height > MAX_FRAME_PIXELS:
            raise ValueError(f"Video frame is too large ({width}x{height})")
        opened.draft("RGB", (target, target))
        return ImageOps.exif_transpose(opened).convert("RGB")


def frame_stats(content: bytes) -> FrameStats:
    """Sharpness (Laplacian variance), mean brightness and an 8x8 RGB signature."""
    image = _open_frame(content, STATS_SIZE * 4)
    small = image.resize((STATS_SIZE, STATS_SIZE), Image.Resampling.BILINEAR)
    raw = small.tobytes()
    pixels = [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3)]
    n = STATS_SIZE
    gray = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels]
    mean = sum(gray) / len(gray)

    total = total_sq = 0.0
    count = 0
    for y in range(1, n - 1):
        row = y * n
        for x in range(1, n - 1):
            i = row + x
            lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - n] - gray[i + n]
            total += lap
            total_sq += lap * lap
            count += 1
    sharpness = total_sq / count - (total / count) ** 2

    block = n // SIGNATURE_GRID
    signature: list[float] = []
    for by in range(SIGNATURE_GRID):
        for bx in range(SIGNATURE_GRID):
            r_sum = g_sum = b_sum = 0
            for y in range(by * block, (by + 1) * block):
                row = y * n
                for x in range(bx * block, (bx + 1) * block):
                    r, g, b = pixels[row + x]
                    r_sum += r
                    g_sum += g
                    b_sum += b
            area = block * block
            signature.extend((r_sum / area, g_sum / area, b_sum / area))
    return FrameStats(sharpness=sharpness, brightness=mean, signature=tuple(signature))


def signature_distance(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    """Mean absolute difference between two colour signatures (0 to 255)."""
    if not a or len(a) != len(b):
        return 0.0
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def build_candidates(frames: list[bytes], times: list[float]) -> list[FrameCandidate]:
    """Score uploaded frames; unreadable frames are skipped."""
    candidates: list[FrameCandidate] = []
    for index, content in enumerate(frames[:MAX_FRAME_CANDIDATES]):
        try:
            stats = frame_stats(content)
        except Exception:
            continue
        time = times[index] if index < len(times) else float(index)
        candidates.append(FrameCandidate(index=index, time=max(0.0, float(time)), content=content, stats=stats))
    return candidates


def select_frames(
    candidates: list[FrameCandidate],
    max_frames: int,
    duration_seconds: float,
) -> list[SelectedFrame]:
    """Pick up to ``max_frames`` frames, returned in time order with their selection rank.

    Dark frames go first, then the blurriest 30%. The sharpest remaining frame starts
    the set; each next frame is the one whose colour signature is farthest from every
    frame already picked. Selection stops early once the best remaining frame is a
    near-duplicate, except that a video of 4 seconds or more keeps at least 3 frames
    (filled with the frames farthest apart in time).
    """
    if max_frames <= 0 or not candidates:
        return []
    pool = [c for c in candidates if c.stats.brightness >= DARK_MEAN_THRESHOLD] or list(candidates)
    sharpness = sorted(c.sharpness for c in pool)
    cut = sharpness[int(len(sharpness) * BLURRY_FRACTION)] if sharpness else 0.0
    good = [c for c in pool if c.sharpness >= cut]
    if len(good) < min(max_frames, len(pool)):
        good = pool

    selected: list[FrameCandidate] = [max(good, key=lambda c: c.sharpness)]
    min_frames = min(
        max_frames,
        len(good),
        LONG_VIDEO_MIN_FRAMES if duration_seconds >= LONG_VIDEO_SECONDS else 1,
    )
    while len(selected) < max_frames:
        best: FrameCandidate | None = None
        best_distance = -1.0
        for candidate in good:
            if candidate in selected:
                continue
            distance = min(signature_distance(s.stats.signature, candidate.stats.signature) for s in selected)
            if distance > best_distance:
                best_distance = distance
                best = candidate
        if best is None:
            break
        if best_distance < NEAR_DUPLICATE_DISTANCE:
            if len(selected) >= min_frames:
                break
            # Too similar to add on looks alone: take the frame farthest away in time.
            best = max(
                (c for c in good if c not in selected),
                key=lambda c: min(abs(s.time - c.time) for s in selected),
            )
        selected.append(best)

    ranked = [SelectedFrame(candidate=c, rank=rank) for rank, c in enumerate(selected)]
    return sorted(ranked, key=lambda frame: frame.candidate.time)


def normalize_frame(content: bytes, max_dimension: int = FRAME_MAX_DIMENSION) -> bytes:
    """Re-encode a frame as a JPEG no larger than the photos sent to the model."""
    image = _open_frame(content, max_dimension)
    width, height = image.size
    if max(width, height) > max_dimension:
        ratio = max_dimension / max(width, height)
        image = image.resize((max(1, int(width * ratio)), max(1, int(height * ratio))), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    return buffer.getvalue()
