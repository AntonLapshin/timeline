"""Eval runner for the ``POST /api/events/parse`` pipeline (issue #76, M5-T4B).

Feeds the committed eval set (``tests/eval/eval_cases.py``) through the pure
``llm_parse.parse_events`` with an injected fake LLM client that returns each
case's recorded ``mock_response``. This verifies the full parse pipeline —
prompt building → JSON-mode request construction → response validation — and
asserts the expected structured draft fields (title, start_at, rrule,
priority, type, channels, tags, needs_clarification). No live network: the
HTTP client is a fake, so the eval runs as part of the normal pytest suite.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.config import Settings
from app.llm_parse import parse_events
from tests.eval.eval_cases import EVAL_CASES, EVAL_NOW_ISO, EvalCase

NOW = datetime.fromisoformat(EVAL_NOW_ISO).astimezone(UTC)


def _settings() -> Settings:
    return Settings(
        llm_base_url="https://gate.joingonka.ai/v1",
        llm_model="eval-model",
        llm_api_key="eval-key",
    )


class _FakeResponse:
    """A minimal fake HTTP response returning the recorded mock JSON."""

    def __init__(self, data: object) -> None:
        self.status_code = 200
        self._data = data

    def json(self) -> object:
        return self._data


class _FakeClient:
    """A fake HTTP client returning the case's recorded mock response."""

    def __init__(self, response: _FakeResponse) -> None:
        self.response = response

    def post(
        self, url: str, *, headers: dict[str, str], json: dict[str, object]
    ) -> _FakeResponse:
        return self.response


@pytest.mark.parametrize("case", EVAL_CASES, ids=lambda c: c.text)
def test_eval_parse_case(case: EvalCase) -> None:
    """Each eval sample produces the expected structured draft(s)."""
    client = _FakeClient(_FakeResponse(case.mock_response))
    result = parse_events(case.text, NOW, case.tz, _settings(), client)
    assert result.ok is True, f"parse failed: {result.error}"

    if case.expect_clarification:
        assert result.outcome is not None
        assert result.outcome.needs_clarification is True
        assert result.outcome.drafts is None
        return

    assert result.outcome is not None
    drafts = result.outcome.drafts
    assert drafts is not None
    assert len(drafts) == case.expect_draft_count
    draft = drafts[0]

    if case.expect_title is not None:
        assert draft.title == case.expect_title
    if case.expect_start_at is not None:
        assert draft.start_at == case.expect_start_at
    if case.expect_rrule is not None:
        assert draft.rrule == case.expect_rrule
    if case.expect_priority is not None:
        assert draft.priority == case.expect_priority
    if case.expect_type is not None:
        assert draft.type == case.expect_type
    if case.expect_channels is not None:
        assert draft.channels == case.expect_channels
    if case.expect_tags is not None:
        assert draft.tags == case.expect_tags


def test_eval_set_has_20_cases() -> None:
    """The committed eval set contains exactly 20 samples."""
    assert len(EVAL_CASES) == 20


def test_eval_set_covers_required_scenarios() -> None:
    """The eval set covers the acceptance-criteria scenarios."""
    texts = [c.text for c in EVAL_CASES]
    joined = "\n".join(texts)
    # Recurrent rules (daily/weekly/monthly/quarterly/yearly).
    assert any("every morning" in t for t in texts)  # daily
    assert any("every Monday" in t for t in texts)  # weekly
    assert any("every month" in t for t in texts)  # monthly
    assert any("every 3 months" in t for t in texts)  # quarterly
    assert any("every January" in t for t in texts)  # yearly
    # Relative future date resolution.
    assert any("next June" in t for t in texts)
    # Low priority for maybe/series/idea.
    assert any(t.startswith("Maybe") for t in texts)
    assert any("idea" in t for t in texts)
    # Ambiguous → medium default.
    assert any("sometime" in t for t in texts)
    # needs_clarification.
    assert any("Remind me about something" in t for t in texts)
    # Multi-event in one message.
    assert any("and gym" in t for t in texts)
    # tz / relative-date resolution across timezones.
    assert any(c.tz == "America/New_York" for c in EVAL_CASES)
    assert any(c.tz == "Asia/Tokyo" for c in EVAL_CASES)
    assert "tz" in joined or any(c.tz != "Europe/Berlin" for c in EVAL_CASES)
