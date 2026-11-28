import io

import pytest
from PIL import Image, ImageDraw, ImageFilter

from app.services.video_frames import (
    MAX_VIDEO_FRAMES,
    build_candidates,
    frame_budget,
    frame_stats,
    normalize_frame,
    select_frames,
    signature_distance,
)


def _jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


def _scene(color: tuple[int, int, int], *, layout: int = 0, blur: float = 0, size=(320, 240)) -> bytes:
    """A textured frame: a coloured background with a checkerboard 'item' placed by ``layout``."""
    image = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(image)
    x0 = 20 + (layout % 4) * 60
    y0 = 20 + (layout // 4) * 50
    for i in range(10):
        for j in range(10):
            fill = (255, 255, 255) if (i + j) % 2 else (10, 10, 10)
            draw.rectangle([x0 + i * 8, y0 + j * 8, x0 + i * 8 + 7, y0 + j * 8 + 7], fill=fill)
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    return _jpeg(image)


def _dark() -> bytes:
    return _jpeg(Image.new("RGB", (320, 240), (4, 4, 6)))


def test_frame_budget_matches_prototype_rule():
    assert frame_budget(0) == 6
    assert frame_budget(1) == 6
    assert frame_budget(2) == 6
    assert frame_budget(4) == 4
    assert frame_budget(6) == 2
    assert frame_budget(8) == 2
    # Groq takes fewer images per call.
    assert frame_budget(1, max_images=5) == 4
    assert frame_budget(4, max_images=5) == 2


def test_frame_stats_scores_sharp_frames_above_blurry_ones_and_dark_frames_dark():
    sharp = frame_stats(_scene((120, 60, 40)))
    blurry = frame_stats(_scene((120, 60, 40), blur=6))
    dark = frame_stats(_dark())

    assert sharp.sharpness > blurry.sharpness * 3
    assert dark.brightness < 18
    assert sharp.brightness > 18
    assert len(sharp.signature) == 8 * 8 * 3


def test_signature_distance_separates_different_views():
    red = frame_stats(_scene((200, 30, 30)))
    red_again = frame_stats(_scene((200, 30, 30)))
    blue = frame_stats(_scene((30, 30, 200), layout=5))

    assert signature_distance(red.signature, red_again.signature) < 5
    assert signature_distance(red.signature, blue.signature) > 20


def test_selection_drops_dark_and_blurry_frames_and_prefers_variety():
    frames = [
        _dark(),
        _scene((200, 40, 40), layout=0),
        _scene((200, 40, 40), layout=0, blur=8),
        _scene((40, 200, 40), layout=3),
        _scene((40, 200, 40), layout=3, blur=8),
        _scene((40, 40, 200), layout=6),
        _scene((200, 200, 40), layout=9),
        _scene((200, 40, 40), layout=0, blur=8),
        _dark(),
        _scene((200, 200, 200), layout=10, blur=8),
    ]
    times = [0.2 + i * 0.7 for i in range(len(frames))]
    candidates = build_candidates(frames, times)

    selected = select_frames(candidates, max_frames=4, duration_seconds=7)
    picked = {frame.candidate.index for frame in selected}

    assert picked == {1, 3, 5, 6}, "sharp, lit frames of four different views"
    assert [frame.candidate.time for frame in selected] == sorted(frame.candidate.time for frame in selected)
    assert min(selected, key=lambda f: f.rank).rank == 0


def test_selection_stops_early_on_near_duplicates_for_short_videos():
    frames = [_scene((150, 90, 60)) for _ in range(8)]
    candidates = build_candidates(frames, [i * 0.4 for i in range(8)])

    selected = select_frames(candidates, max_frames=MAX_VIDEO_FRAMES, duration_seconds=3)

    assert len(selected) == 1


def test_selection_keeps_three_frames_spread_in_time_for_long_videos():
    frames = [_scene((150, 90, 60)) for _ in range(10)]
    times = [i * 1.0 for i in range(10)]
    candidates = build_candidates(frames, times)

    selected = select_frames(candidates, max_frames=MAX_VIDEO_FRAMES, duration_seconds=10)

    assert len(selected) == 3
    chosen_times = [frame.candidate.time for frame in selected]
    gaps = [b - a for a, b in zip(chosen_times, chosen_times[1:])]
    assert min(gaps) >= 3, chosen_times


def test_all_dark_video_still_returns_a_frame_and_unreadable_frames_are_skipped():
    candidates = build_candidates([_dark(), b"not an image", _dark()], [0.0, 1.0, 2.0])

    assert [c.index for c in candidates] == [0, 2]
    assert len(select_frames(candidates, max_frames=2, duration_seconds=2)) >= 1
    assert select_frames([], max_frames=3, duration_seconds=5) == []


def test_normalize_frame_caps_size_at_photo_dimension():
    big = _jpeg(Image.new("RGB", (3000, 1500), (90, 90, 90)))

    with Image.open(io.BytesIO(normalize_frame(big))) as image:
        assert max(image.size) == 1024
        assert image.format == "JPEG"


@pytest.mark.parametrize("max_frames", [1, 2, 3])
def test_selection_never_exceeds_budget(max_frames):
    frames = [_scene((i * 20 % 255, 100, 200 - i * 15), layout=i) for i in range(12)]
    candidates = build_candidates(frames, [i * 0.6 for i in range(12)])

    assert len(select_frames(candidates, max_frames=max_frames, duration_seconds=7)) == max_frames


def test_oversized_frames_are_refused_before_decoding():
    import io as _io

    from PIL import Image as _Image

    from app.services.video_frames import MAX_FRAME_PIXELS, build_candidates, normalize_frame

    side = int(MAX_FRAME_PIXELS ** 0.5) + 10
    buffer = _io.BytesIO()
    _Image.new("L", (side, side), 0).save(buffer, format="PNG")
    huge = buffer.getvalue()
    assert build_candidates([huge], [0.0]) == []
    try:
        normalize_frame(huge)
    except ValueError:
        return
    raise AssertionError("normalize_frame accepted an oversized frame")
