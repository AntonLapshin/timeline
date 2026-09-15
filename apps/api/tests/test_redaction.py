"""Tests for log redaction helpers (issue #76, M5-T4B).

Verifies that sensitive content — user message text, parsed event content,
LLM prompt bodies, and audio/voice file paths — is never written to logs.
The helpers return content-free references (length + short hash, or a file
basename) so operators can correlate log lines without leaking private data.
"""

from __future__ import annotations

from app.redaction import redact_path, redact_prompt, redact_text


def test_redact_text_never_contains_raw_text() -> None:
    """The raw message text never appears in the redacted reference."""
    secret = "pay rent tomorrow 9am at 123 Main St"
    ref = redact_text(secret)
    assert secret not in ref
    # Only a length + short hash are present.
    assert f"len={len(secret)}" in ref
    assert "sha=" in ref


def test_redact_text_is_deterministic() -> None:
    """The same text yields the same redacted reference."""
    assert redact_text("hello world") == redact_text("hello world")


def test_redact_text_differs_for_different_text() -> None:
    """Different text yields a different hash reference."""
    assert redact_text("one thing") != redact_text("another thing")


def test_redact_path_keeps_only_basename() -> None:
    """Directory components (which may leak usernames/paths) are dropped."""
    ref = redact_path("/home/monarch/ws/tmp/voice_123.ogg")
    assert "voice_123.ogg" in ref
    assert "/home/monarch" not in ref
    assert "ws/tmp" not in ref


def test_redact_path_handles_windows_separators() -> None:
    """Windows-style backslash paths are normalized to basename only."""
    ref = redact_path("C:\\Users\\alice\\AppData\\voice.ogg")
    assert "voice.ogg" in ref
    assert "C:" not in ref
    assert "alice" not in ref


def test_redact_path_plain_filename() -> None:
    """A bare filename is preserved as-is."""
    assert redact_path("voice_123.ogg") == "<file voice_123.ogg>"


def test_redact_prompt_never_contains_prompt_body() -> None:
    """The prompt body (which embeds raw user text) is never logged."""
    system = "You are a calendar assistant."
    user = "Current date/time: 2026-09-15T09:00:00+00:00\nUser text: pay rent tomorrow"
    ref = redact_prompt(system, user)
    assert "pay rent" not in ref
    assert "calendar assistant" not in ref
    assert "2026-09-15" not in ref
    assert f"system={len(system)}" in ref
    assert f"user={len(user)}" in ref
