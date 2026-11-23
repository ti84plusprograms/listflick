import pytest

from app.schemas.gemini_outputs import GeminiListingOutput
from app.schemas.listing import VisionAnalysis
from app.utils.json_parser import (
    coerce_str_list,
    extract_json_text,
    normalize_unknown,
    parse_and_validate,
    parse_json_loose,
    strip_markdown_fences,
)


class TestStripMarkdown:
    def test_strips_json_fence(self):
        raw = '```json\n{"item_name": "Chair"}\n```'
        assert parse_json_loose(raw)["item_name"] == "Chair"

    def test_strips_plain_fence(self):
        assert strip_markdown_fences("```\n{}\n```") == "{}"

    def test_extracts_embedded_object(self):
        text = 'Here is the result:\n{"title": "Desk", "tags": []}\nThanks.'
        data = parse_json_loose(text)
        assert data["title"] == "Desk"


class TestMalformedJson:
    def test_invalid_json_raises(self):
        with pytest.raises(ValueError, match="Invalid JSON"):
            parse_json_loose("not json at all")

    def test_non_object_raises(self):
        with pytest.raises(ValueError, match="Expected JSON object"):
            parse_json_loose("[1, 2, 3]")


class TestVisionSchema:
    def test_missing_fields_use_defaults(self):
        data = parse_and_validate("{}", VisionAnalysis)
        assert data.brand == ""
        assert data.confidence == 0.0
        assert data.visible_defects == []

    def test_uncertain_brand_normalized_in_compat(self):
        out = VisionAnalysis.model_validate({"item_name": "Table", "brand": "n/a"})
        assert out.brand == ""


class TestListingSchema:
    def test_tags_as_string(self):
        raw = '{"title": "Chair", "description": "Nice chair.", "tags": "furniture"}'
        data = parse_and_validate(raw, GeminiListingOutput)
        assert data.tags == ["furniture"]


class TestHelpers:
    def test_normalize_unknown(self):
        assert normalize_unknown("") == "unknown"
        assert normalize_unknown("N/A") == "unknown"
        assert normalize_unknown("IKEA") == "IKEA"

    def test_coerce_str_list(self):
        assert coerce_str_list(None) == []
        assert coerce_str_list("a, b") == ["a, b"]
