"""Tests for the shared pure helpers in ``app.utils``."""

from __future__ import annotations

import pytest

from app.utils import bool_env, optional_env, parse_hhmm


def test_parse_hhmm() -> None:
    assert parse_hhmm("22:00") == (22, 0)
    assert parse_hhmm("08:30") == (8, 30)
    assert parse_hhmm("9") == (9, 0)


def test_parse_hhmm_rejects_non_numeric() -> None:
    with pytest.raises(ValueError):
        parse_hhmm("ab:cd")


def test_bool_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIMELINE_FLAG_X", raising=False)
    assert bool_env("TIMELINE_FLAG_X", False) is False
    assert bool_env("TIMELINE_FLAG_X", True) is True
    for raw in ("1", "true", "YES", " on "):
        monkeypatch.setenv("TIMELINE_FLAG_X", raw)
        assert bool_env("TIMELINE_FLAG_X", False) is True
    for raw in ("0", "false", "no", ""):
        monkeypatch.setenv("TIMELINE_FLAG_X", raw)
        assert bool_env("TIMELINE_FLAG_X", True) is False


def test_optional_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIMELINE_OPT_X", raising=False)
    assert optional_env("TIMELINE_OPT_X") is None
    monkeypatch.setenv("TIMELINE_OPT_X", "  ")
    assert optional_env("TIMELINE_OPT_X") is None
    monkeypatch.setenv("TIMELINE_OPT_X", " value ")
    assert optional_env("TIMELINE_OPT_X") == "value"
