import base64
import io
from pathlib import Path
from typing import Optional

from PIL import Image, ImageFilter, ImageOps, ImageStat

MAX_DIMENSION = 1024
QUALITY_CHECK_MAX_DIMENSION = 768
MIN_WIDTH = 200
MIN_HEIGHT = 200
BLUR_THRESHOLD = 50.0
MIN_BRIGHTNESS = 30.0
MAX_BRIGHTNESS = 230.0
GOOD_MIN_BRIGHTNESS = 50.0
GOOD_MAX_BRIGHTNESS = 210.0
LOW_CONTRAST_THRESHOLD = 20.0
GOOD_CONTRAST_THRESHOLD = 35.0
GOOD_BLUR_THRESHOLD = 100.0


class ImageQualityError(Exception):
    def __init__(self, message: str, issues: list[str], feedback: Optional[dict] = None):
        super().__init__(message)
        self.issues = issues
        self.feedback = feedback or {}


def _laplacian_variance(img: Image.Image) -> float:
    gray = img.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    stat = ImageStat.Stat(edges)
    return stat.var[0]


def _mean_brightness(img: Image.Image) -> float:
    gray = img.convert("L")
    return ImageStat.Stat(gray).mean[0]


def _contrast(img: Image.Image) -> float:
    gray = img.convert("L")
    return ImageStat.Stat(gray).stddev[0]


def _status_for_sharpness(blur_score: float) -> str:
    if blur_score < BLUR_THRESHOLD:
        return "poor"
    if blur_score < GOOD_BLUR_THRESHOLD:
        return "needs_improvement"
    return "good"


def _status_for_brightness(brightness: float) -> str:
    if brightness < MIN_BRIGHTNESS or brightness > MAX_BRIGHTNESS:
        return "poor"
    if brightness < GOOD_MIN_BRIGHTNESS or brightness > GOOD_MAX_BRIGHTNESS:
        return "needs_improvement"
    return "good"


def _status_for_contrast(contrast: float) -> str:
    if contrast < LOW_CONTRAST_THRESHOLD:
        return "poor"
    if contrast < GOOD_CONTRAST_THRESHOLD:
        return "needs_improvement"
    return "good"


def _overall_status(statuses: list[str]) -> str:
    if "poor" in statuses:
        return "poor"
    if "needs_improvement" in statuses:
        return "needs_improvement"
    return "good"


def build_image_quality_feedback(image_bytes: bytes, image_id: str = "", image_index: int = 0) -> tuple[dict, dict]:
    """Return user-facing feedback and raw quality metrics for one image."""
    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")

    width, height = img.size
    quality_img = img
    if max(width, height) > QUALITY_CHECK_MAX_DIMENSION:
        ratio = QUALITY_CHECK_MAX_DIMENSION / max(width, height)
        quality_img = img.resize((int(width * ratio), int(height * ratio)), Image.Resampling.BILINEAR)

    blur_score = _laplacian_variance(quality_img)
    brightness = _mean_brightness(quality_img)
    contrast = _contrast(quality_img)

    sharpness_status = _status_for_sharpness(blur_score)
    brightness_status = _status_for_brightness(brightness)
    contrast_status = _status_for_contrast(contrast)
    detail_status = _overall_status([sharpness_status, contrast_status])

    notes: list[str] = []
    if width < MIN_WIDTH or height < MIN_HEIGHT:
        notes.append("Photo is too small to show the item clearly.")
    if sharpness_status == "poor":
        notes.append("Photo looks blurry.")
    elif sharpness_status == "needs_improvement":
        notes.append("Photo could be sharper.")
    if brightness < MIN_BRIGHTNESS:
        notes.append("Photo is too dark.")
    elif brightness > MAX_BRIGHTNESS:
        notes.append("Photo is too bright.")
    elif brightness_status == "needs_improvement":
        notes.append("Lighting could be better.")
    if contrast_status != "good":
        notes.append("Item edges and details do not stand out enough.")
    if detail_status != "good" and "Item edges and details do not stand out enough." not in notes:
        notes.append("Item details may be hard to see.")

    statuses = [sharpness_status, brightness_status, contrast_status, detail_status]
    if width < MIN_WIDTH or height < MIN_HEIGHT:
        statuses.append("poor")
    overall_status = _overall_status(statuses)

    if overall_status == "poor":
        suggested_action = "Retake this photo before posting."
    elif overall_status == "needs_improvement":
        suggested_action = "Use if needed, but a clearer photo may help it sell."
    else:
        suggested_action = "Use this photo."

    feedback = {
        "image_id": image_id,
        "image_index": image_index,
        "overall_status": overall_status,
        "sharpness_status": sharpness_status,
        "brightness_status": brightness_status,
        "contrast_status": contrast_status,
        "detail_status": detail_status,
        "notes": notes,
        "suggested_action": suggested_action,
    }
    metrics = {
        "original_size": f"{width}x{height}",
        "blur_score": round(blur_score, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
    }
    return feedback, metrics


def validate_and_process(image_bytes: bytes, image_id: str = "", image_index: int = 0) -> tuple[bytes, dict, dict]:
    """Resize, compress, and validate image quality. Returns processed bytes, metrics, and feedback."""
    img = Image.open(io.BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")

    issues: list[str] = []
    width, height = img.size
    feedback, metrics = build_image_quality_feedback(image_bytes, image_id=image_id, image_index=image_index)

    if width < MIN_WIDTH or height < MIN_HEIGHT:
        issues.append(f"Image too small ({width}x{height}). Minimum {MIN_WIDTH}x{MIN_HEIGHT}.")

    blur_score = metrics["blur_score"]
    brightness = metrics["brightness"]

    if blur_score < BLUR_THRESHOLD:
        issues.append("Image appears too blurry. Please retake with better focus.")
    if brightness < MIN_BRIGHTNESS:
        issues.append("Image is too dark. Try better lighting.")
    if brightness > MAX_BRIGHTNESS:
        issues.append("Image is overexposed. Reduce glare or brightness.")

    if issues:
        raise ImageQualityError("Image quality check failed", issues, feedback=feedback)

    if max(width, height) > MAX_DIMENSION:
        ratio = MAX_DIMENSION / max(width, height)
        new_size = (int(width * ratio), int(height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85, optimize=True)
    processed = buffer.getvalue()

    metrics["processed_bytes"] = len(processed)
    return processed, metrics, feedback


def to_base64_data_url(image_bytes: bytes) -> str:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"
