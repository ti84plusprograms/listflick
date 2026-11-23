"""Generate a small textured JPEG for API smoke tests."""
import io
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent / "fixtures" / "test_item.jpg"


def main() -> None:
    width, height = 640, 480
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for x in range(width):
        for y in range(height):
            pixels[x, y] = ((x * 5 + y * 3) % 255, (x + y) % 255, 140)
    # Simple "object" rectangle
    for x in range(200, 440):
        for y in range(120, 360):
            pixels[x, y] = (90, 70, 50)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, format="JPEG", quality=85)
    print(OUT)


if __name__ == "__main__":
    main()
