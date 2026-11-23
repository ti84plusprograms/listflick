import io

import pytest
from PIL import Image

from app.services.image_service import ImageQualityError, build_image_quality_feedback, validate_and_process


def _make_image(width: int, height: int, color: tuple[int, int, int] | None = None) -> bytes:
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for x in range(width):
        for y in range(height):
            if color:
                pixels[x, y] = color
            else:
                pixels[x, y] = ((x * 5 + y * 3) % 255, (x + y) % 255, 128)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_oriented_image(width: int, height: int, orientation: int) -> bytes:
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for x in range(width):
        for y in range(height):
            pixels[x, y] = ((x * 9 + y * 5) % 255, (x * 3 + y * 7) % 255, 128)
    exif = Image.Exif()
    exif[274] = orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


class TestImageQuality:
    def test_rejects_too_small(self):
        with pytest.raises(ImageQualityError) as exc:
            validate_and_process(_make_image(100, 100))
        assert any("too small" in i.lower() for i in exc.value.issues)

    def test_accepts_valid_image(self):
        processed, metrics, feedback = validate_and_process(_make_image(800, 600))
        assert len(processed) > 0
        assert "blur_score" in metrics

    def test_builds_user_facing_feedback_for_valid_image(self):
        feedback, metrics = build_image_quality_feedback(_make_image(800, 600), image_id="item-1:0", image_index=0)
        assert feedback["image_id"] == "item-1:0"
        assert feedback["image_index"] == 0
        assert feedback["overall_status"] in {"good", "needs_improvement"}
        assert feedback["sharpness_status"] in {"good", "needs_improvement"}
        assert feedback["brightness_status"] == "good"
        assert feedback["suggested_action"]
        assert "contrast" in metrics

    def test_feedback_flags_dark_photo_without_hiding_action(self):
        feedback, _ = build_image_quality_feedback(_make_image(800, 600, color=(5, 5, 5)))
        assert feedback["overall_status"] == "poor"
        assert feedback["brightness_status"] == "poor"
        assert any("dark" in note.lower() for note in feedback["notes"])
        assert "Retake" in feedback["suggested_action"]

    def test_rejects_very_dark(self):
        with pytest.raises(ImageQualityError) as exc:
            validate_and_process(_make_image(800, 600, color=(5, 5, 5)))
        assert any("dark" in i.lower() for i in exc.value.issues)
        assert exc.value.feedback["brightness_status"] == "poor"

    def test_large_image_is_resized(self):
        processed, metrics, feedback = validate_and_process(_make_image(3000, 2000, color=None))
        assert metrics["processed_bytes"] > 0

    def test_applies_exif_orientation_before_saving(self):
        processed, _, _ = validate_and_process(_make_oriented_image(600, 900, orientation=6))
        img = Image.open(io.BytesIO(processed))
        assert img.size == (900, 600)
