"""Tests for the monthly summary logic and endpoint (issue #15).

Covers the pure ``app.summary`` module (occurrences within a month, grouping by
priority, recurrence expansion, month boundaries, timezone interpretation) and
the ``GET /api/summary?month=YYYY-MM`` endpoint including validation.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.summary import MonthSummary, occurrences_in_month, summarize_month


def _event(**overrides: object) -> SimpleNamespace:
    """A minimal summary input, mirroring the Event model's attributes."""
    values: dict[str, object] = {
        "rrule": "FREQ=DAILY",
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "tz": "UTC",
        "all_day": False,
        "end_at": None,
        "priority": "medium",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


# --- pure occurrences_in_month ---------------------------------------------


def test_daily_event_occurs_every_day_in_month() -> None:
    """A daily event contributes one occurrence per day of the month."""
    event = _event()
    occs = occurrences_in_month(event, 2026, 1)
    assert len(occs) == 31


def test_monthly_event_occurs_once_in_month() -> None:
    """A monthly event contributes a single occurrence per month."""
    event = _event(rrule="FREQ=MONTHLY;BYMONTHDAY=15")
    occs = occurrences_in_month(event, 2026, 2)
    assert len(occs) == 1
    assert occs[0].start.day == 15


def test_quarterly_event_occurs_only_in_its_quarter() -> None:
    """A quarterly event appears in Jan/Apr/Jul/Oct but not adjacent months."""
    event = _event(rrule="FREQ=MONTHLY;INTERVAL=3")
    assert len(occurrences_in_month(event, 2026, 1)) == 1
    assert len(occurrences_in_month(event, 2026, 2)) == 0
    assert len(occurrences_in_month(event, 2026, 4)) == 1
    assert len(occurrences_in_month(event, 2026, 7)) == 1
    assert len(occurrences_in_month(event, 2026, 10)) == 1


def test_one_time_event_occurs_only_in_its_month() -> None:
    """A one-time event appears only in its start month."""
    event = _event(rrule=None, start_at=datetime(2026, 6, 5, 18, 0, tzinfo=UTC))
    assert len(occurrences_in_month(event, 2026, 6)) == 1
    assert len(occurrences_in_month(event, 2026, 7)) == 0


def test_event_started_before_month_still_counted() -> None:
    """An event that started in a prior month still recurs into the month."""
    event = _event(start_at=datetime(2025, 12, 1, 10, 0, tzinfo=UTC))
    occs = occurrences_in_month(event, 2026, 1)
    assert len(occs) == 31


def test_event_ended_before_month_not_counted() -> None:
    """An event whose recurrence ended before the month contributes nothing."""
    event = _event(
        rrule="FREQ=DAILY;UNTIL=20260110T000000Z",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
    )
    # UNTIL is Jan 10 00:00Z, so the last daily occurrence (10:00) is Jan 9.
    assert len(occurrences_in_month(event, 2026, 1)) == 9
    assert len(occurrences_in_month(event, 2026, 2)) == 0


def test_month_interpreted_in_event_tz() -> None:
    """The month is interpreted in the event's own timezone."""
    # 10:00 UTC on 2026-01-01 == 11:00 in Europe/Berlin (same local date).
    event = _event(tz="Europe/Berlin")
    occs = occurrences_in_month(event, 2026, 1)
    assert len(occs) == 31


# --- pure summarize_month ---------------------------------------------------


def test_summarize_month_groups_by_priority() -> None:
    """Occurrences are counted per priority and totalled."""
    events = [
        _event(priority="critical"),
        _event(priority="medium"),
        _event(priority="low"),
    ]
    summary = summarize_month(events, 2026, 1)
    assert summary.month == "2026-01"
    assert summary.total == 31 * 3
    assert summary.by_priority == {"critical": 31, "medium": 31, "low": 31}


def test_summarize_month_counts_recurrences() -> None:
    """A quarterly event contributes one per month it recurs in."""
    events = [_event(rrule="FREQ=MONTHLY;INTERVAL=3", priority="critical")]
    summary = summarize_month(events, 2026, 4)
    assert summary.total == 1
    assert summary.by_priority["critical"] == 1


def test_summarize_month_empty_month() -> None:
    """A month with no occurrences reports zero counts."""
    events = [_event(rrule="FREQ=MONTHLY;INTERVAL=3")]
    summary = summarize_month(events, 2026, 2)
    assert summary.total == 0
    assert summary.by_priority == {"critical": 0, "medium": 0, "low": 0}


def test_summarize_month_returns_dataclass() -> None:
    """summarize_month returns a MonthSummary dataclass."""
    summary = summarize_month([], 2026, 1)
    assert isinstance(summary, MonthSummary)
    assert summary.month == "2026-01"
    assert summary.total == 0


# --- /api/summary endpoint --------------------------------------------------


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """A TestClient with seeding disabled for deterministic summary counts."""
    settings = Settings(data_dir=tmp_path, db_name="summary.db", seed_on_start=False)
    with TestClient(create_app(settings)) as client:
        yield client


def test_summary_endpoint_returns_counts(client: TestClient) -> None:
    """GET /api/summary returns a priority breakdown for a month."""
    resp = client.get("/api/summary?month=2026-01")
    assert resp.status_code == 200
    body = resp.json()
    assert body["month"] == "2026-01"
    assert "total" in body
    assert body["by_priority"] == {"critical": 0, "medium": 0, "low": 0}


def test_summary_endpoint_counts_created_events(client: TestClient) -> None:
    """Created events are reflected in the summary for their month."""
    client.post(
        "/api/events",
        json={
            "title": "Critical daily",
            "type": "recurrent",
            "start_at": "2026-01-01T09:00:00+00:00",
            "tz": "UTC",
            "rrule": "FREQ=DAILY",
            "priority": "critical",
            "source": "web",
            "status": "active",
        },
    )
    resp = client.get("/api/summary?month=2026-01")
    body = resp.json()
    assert body["by_priority"]["critical"] == 31
    assert body["total"] == 31


def test_summary_endpoint_ignores_archived_events(client: TestClient) -> None:
    """Archived events are excluded from the summary."""
    client.post(
        "/api/events",
        json={
            "title": "Old",
            "type": "one_time",
            "start_at": "2026-01-01T09:00:00+00:00",
            "tz": "UTC",
            "priority": "critical",
            "source": "web",
            "status": "archived",
        },
    )
    resp = client.get("/api/summary?month=2026-01")
    assert resp.json()["total"] == 0


def test_summary_endpoint_invalid_month(client: TestClient) -> None:
    """A malformed month is rejected with 422."""
    assert client.get("/api/summary?month=2026-13").status_code == 422
    assert client.get("/api/summary?month=2026").status_code == 422
    assert client.get("/api/summary?month=Jan-2026").status_code == 422
