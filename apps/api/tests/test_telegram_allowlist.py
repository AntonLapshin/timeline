"""Tests for the pure Telegram user-allowlist helpers (issue #112).

Covers ``app.telegram_allowlist``: parsing (single, multiple, whitespace,
duplicates, invalid entries, empty), fail-closed membership checks, and the
startup-warning message builder.
"""

from __future__ import annotations

from app.telegram_allowlist import TelegramAllowlist, parse_allowlist, startup_warning

# --- parse_allowlist ------------------------------------------------------------


def test_parse_allowlist_empty_allows_nobody() -> None:
    """No sources (or only blanks) -> an empty allowlist (fail closed)."""
    assert parse_allowlist() == TelegramAllowlist()
    assert parse_allowlist(None, None) == TelegramAllowlist()
    assert parse_allowlist("") == TelegramAllowlist()
    assert parse_allowlist("   ") == TelegramAllowlist()
    assert parse_allowlist(", ,") == TelegramAllowlist()
    assert not bool(parse_allowlist())


def test_parse_allowlist_single_id() -> None:
    """A single numeric id parses to a one-element allowlist."""
    assert parse_allowlist("42").ids == (42,)
    assert parse_allowlist("42").invalid == ()
    assert parse_allowlist("42").allows(42) is True


def test_parse_allowlist_multiple_ids() -> None:
    """Comma-separated ids all parse, in first-seen order."""
    assert parse_allowlist("111,222,333").ids == (111, 222, 333)


def test_parse_allowlist_tolerates_whitespace_and_empty_entries() -> None:
    """Whitespace around entries and stray commas are tolerated."""
    assert parse_allowlist(" 111 , 222 ,, 333 ").ids == (111, 222, 333)


def test_parse_allowlist_dedupes_preserving_order() -> None:
    """Duplicate ids collapse to the first occurrence, order preserved."""
    assert parse_allowlist("222,111,222,111").ids == (222, 111)


def test_parse_allowlist_collects_invalid_entries() -> None:
    """Non-numeric entries are dropped and reported, valid ones kept."""
    parsed = parse_allowlist("111,abc,  ,xyz,222")
    assert parsed.ids == (111, 222)
    assert parsed.invalid == ("abc", "xyz")


def test_parse_allowlist_fully_invalid_is_fail_closed() -> None:
    """Only invalid entries -> empty allowlist (allows nobody)."""
    parsed = parse_allowlist("abc,def")
    assert parsed.ids == ()
    assert parsed.invalid == ("abc", "def")
    assert not parsed


def test_parse_allowlist_combines_and_dedupes_sources() -> None:
    """Multiple raw values (new + legacy var) combine and dedupe."""
    parsed = parse_allowlist("111,222", "222,333")
    assert parsed.ids == (111, 222, 333)


def test_parse_allowlist_rejects_signed_and_weird_numbers() -> None:
    """Signed and underscore-separated entries are invalid, not parsed."""
    parsed = parse_allowlist("+42", "-42", "1_0", "42")
    assert parsed.ids == (42,)
    assert parsed.invalid == ("+42", "-42", "1_0")


def test_parse_allowlist_rejects_non_ascii_digits() -> None:
    """Non-ASCII digit entries are invalid, not parsed (``isascii`` guard).

    ``str.isdigit()`` is True for unicode digits (Arabic-Indic ``٤٢``,
    superscript ``²``) and ``int()`` would even accept them, but Telegram user
    ids are plain ASCII digits — the ``isascii()`` guard drops lookalike-digit
    entries so they can never match a real id (fail closed).
    """
    parsed = parse_allowlist("٤٢", "²")
    assert parsed.ids == ()
    assert parsed.invalid == ("٤٢", "²")
    assert not parsed


# --- TelegramAllowlist.allows ---------------------------------------------------


def test_allows_numeric_string_equivalence() -> None:
    """str/int forms of the same id are equivalent; None never allowed."""
    allowlist = parse_allowlist("42, 7")
    assert allowlist.allows(42) is True
    assert allowlist.allows("42") is True
    assert allowlist.allows(7) is True
    assert allowlist.allows("7") is True
    assert allowlist.allows(999) is False
    assert allowlist.allows("999") is False
    assert allowlist.allows(None) is False
    assert allowlist.allows("abc") is False


def test_allows_empty_allowlist_denies_everyone() -> None:
    """An empty allowlist (fail closed) allows nobody, even a valid id."""
    empty = TelegramAllowlist()
    assert empty.allows(42) is False
    assert empty.allows("42") is False
    assert empty.allows(None) is False


# --- startup_warning ------------------------------------------------------------


def test_startup_warning_none_for_valid_allowlist() -> None:
    """A valid, fully-parsed allowlist needs no warning."""
    assert startup_warning(parse_allowlist("42,111")) is None


def test_startup_warning_for_empty_allowlist() -> None:
    """An empty allowlist warns that the bot will ignore every message."""
    warning = startup_warning(parse_allowlist(None))
    assert warning is not None
    assert "ignore every message" in warning
    assert "fail closed" in warning


def test_startup_warning_lists_invalid_entries() -> None:
    """Dropped entries are named in the warning even with valid ids present."""
    warning = startup_warning(parse_allowlist("42,abc,def"))
    assert warning is not None
    assert "abc, def" in warning
    assert "ignore every message" not in warning


def test_startup_warning_combines_empty_and_invalid() -> None:
    """Empty + invalid produces one combined warning."""
    warning = startup_warning(parse_allowlist("abc"))
    assert warning is not None
    assert "ignore every message" in warning
    assert "abc" in warning
