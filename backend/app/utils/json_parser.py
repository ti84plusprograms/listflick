"""Robust JSON extraction and validation for Gemini model outputs."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def strip_markdown_fences(text: str) -> str:
    text = text.strip()
    match = _JSON_BLOCK_RE.search(text)
    if match:
        return match.group(1).strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_json_text(text: str) -> str:
    """Extract the most likely JSON payload from model text."""
    cleaned = strip_markdown_fences(text)
    if cleaned.startswith("{") or cleaned.startswith("["):
        return cleaned

    match = _JSON_OBJECT_RE.search(cleaned)
    if match:
        return match.group(0)

    return cleaned


def parse_json_loose(text: str) -> dict[str, Any]:
    raw = extract_json_text(text)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("JSON parse failed: %s", exc)
        raise ValueError(f"Invalid JSON from model: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("Expected JSON object from model")
    return data


def validate_model(data: dict[str, Any], model: type[T]) -> T:
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"Schema validation failed: {exc}") from exc


def parse_and_validate(text: str, model: type[T]) -> T:
    return validate_model(parse_json_loose(text), model)


def normalize_unknown(value: str | None, default: str = "unknown") -> str:
    if not value or not str(value).strip():
        return default
    cleaned = str(value).strip()
    if cleaned.lower() in {"n/a", "na", "none", "null", "not visible", "unidentifiable"}:
        return default
    return cleaned


def coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return []
