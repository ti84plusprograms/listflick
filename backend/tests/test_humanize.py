from app.utils.humanize import humanize_text, humanize_title


def test_humanize_replaces_dashes_quotes_bold_and_emojis():
    text = "Blue lamp — works great \U0001F60A. “Barely” used, **solid** base. Sells for $25–$35."
    assert humanize_text(text) == 'Blue lamp, works great. "Barely" used, solid base. Sells for $25-$35.'


def test_humanize_keeps_line_structure():
    assert humanize_text("Line one\n  Line two – more") == "Line one\nLine two, more"


def test_humanize_title_drops_trailing_punctuation():
    assert humanize_title("IKEA Blue Ceramic Lamp — Large.") == "IKEA Blue Ceramic Lamp, Large"


def test_humanize_title_keeps_size_marks_and_drops_wrapping_quotes():
    assert humanize_title('Vizio Smart TV 32"') == 'Vizio Smart TV 32"'
    assert humanize_title('"Vintage" Lamp') == '"Vintage" Lamp'
    assert humanize_title('"Oak Desk"') == "Oak Desk"


def test_humanize_text_does_not_join_lines():
    assert humanize_text("Pickup in Midtown\n. Cash only") == "Pickup in Midtown\n. Cash only"
    assert humanize_text("Details:\n— Two drawers") == "Details:\nTwo drawers"
