"""Remove common machine-writing tells from listing text (from the humanizer guidelines).

Applied to model output before it is rendered, so the result reads like a person wrote it
whichever AI provider produced it. Only formatting tells are fixed here; wording is handled
by the prompts.
"""

from __future__ import annotations

import re

_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]")
_NUMBER_DASH = re.compile("(\\d)\\s*[\u2013\u2014]\\s*(\\$?\\d)")
_DASH = re.compile("[ \\t]*[\u2013\u2014][ \\t]*|[ \\t]--[ \\t]")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_SPACE_BEFORE_PUNCT = re.compile(r"[ \t]+([,.!?;:])")
_DOUBLE_COMMA = re.compile(r",\s*,")
_PUNCT_COMMA = re.compile(r"([.!?]),")
_SPACES = re.compile(r"[ \t]{2,}")
_QUOTES = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'"})


def humanize_text(value: object) -> str:
    text = str(value or "")
    if not text:
        return ""
    text = text.translate(_QUOTES)
    text = _NUMBER_DASH.sub(r"\1-\2", text)
    text = _DASH.sub(", ", text)
    text = _EMOJI.sub("", text)
    text = _BOLD.sub(r"\1", text)
    text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
    text = _DOUBLE_COMMA.sub(",", text)
    text = _PUNCT_COMMA.sub(r"\1", text)
    text = _SPACES.sub(" ", text)
    return "\n".join(line.strip().lstrip(", ") for line in text.splitlines()).strip()


def humanize_title(value: object) -> str:
    text = humanize_text(value).replace("\n", " ")
    text = text.rstrip(".!,;:").strip()
    # Drop wrapping quotes only. A lone trailing quote is usually a size mark (32" TV, 6' table).
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    return text
