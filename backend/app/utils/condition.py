from __future__ import annotations

import re


CANONICAL_CONDITIONS = {"New", "Like New", "Good", "Fair", "Needs Repair"}

_REPAIR_WORDS = {
    "broken",
    "cracked",
    "damaged",
    "does not work",
    "doesn't work",
    "missing",
    "needs repair",
    "not working",
    "repair",
    "torn",
}


def _has_repair_signal(value: str) -> bool:
    lower = value.lower()
    return any(word in lower for word in _REPAIR_WORDS)


def _has_word(value: str, pattern: str) -> bool:
    return bool(re.search(pattern, value))


def normalize_condition(value: str | None, *, defects: list[str] | None = None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    normalized = raw.lower().replace("_", " ").replace("-", " ")
    normalized = " ".join(normalized.split())
    context = " ".join([raw, *(defects or [])])

    if _has_word(normalized, r"\blike\s+new\b|\bexcellent\b|\bmint\b"):
        return "Like New"
    if _has_word(normalized, r"\bneeds?\s+repair\b|\bfor\s+parts\b|\bnot\s+working\b|\bbroken\b"):
        return "Needs Repair"
    if _has_word(normalized, r"\bnew\b"):
        return "New"
    if _has_word(normalized, r"\bgood\b|\bused\b|\bpre\s+owned\b"):
        return "Good"
    if _has_word(normalized, r"\bfair\b"):
        return "Fair"
    if _has_word(normalized, r"\bpoor\b|\bbad\b|\bheavily\s+used\b|\bworn\b"):
        return "Needs Repair" if _has_repair_signal(context) else "Fair"

    return ""
