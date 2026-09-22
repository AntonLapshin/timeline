"""Tests for the per-occurrence month expansion logic and endpoint (issue #27).

Covers the pure ``app.occurrences`` module (one-time vs recurrent events,
month boundaries, next-occurrence computation, sorting) and the
``GET /api/events/occurrences?month=YYYY-MM`` endpoint including validation.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.occurrences import EventOccurrence, occurrences_for_month


def _event(**overrides: object) -> SimpleNamespace:
    """A minimal occurrence input, mirroring the Event model's attributes."""
    values: dict[str, object] = {
        "id": 1,
        "title": "Test event",
        "priority": "medium",
        "tags": ["finance"],
        "rrule": "FREQ=DAILY",
        "start_at": datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
        "end_at": None,
        "all_day": False,
        "tz": "UTC",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


# --- pure occurrences_for_month --------------------------------------------


def test_one_time_event_contributes_single_occurrence() -> None:
    """A one-time event appears once, only in its start month."""
    event = _event(rrule=None, start_at=datetime(2026, 6, 5, 18, 0, tzinfo=UTC))
    occs = occurrences_for_month([event], 2026, 6)
    assert len(occs) == 1
    assert occs[0].event_id == 1
    assert occs[0].title == "Test event"
    assert occs[0].start_at == datetime(2026, 6, 5, 18, 0, tzinfo=UTC)
    assert len(occurrences_for_month([event], 2026, 7)) == 0


def test_recurrent_event_contributes_one_per_occurrence() -> None:
    """A daily event contributes one entry per day of the month."""
    event = _event()
    occs = occurrences_for_month([event], 2026, 1)
    assert len(occs) == 31
    # Every entry carries the recurrence badge rrule.
    assert all(o.rrule == "FREQ=DAILY" for o in occs)


def test_entries_carry_display_fields() -> None:
    """Each entry carries priority, tag, tz and all_day for the grid."""
    event = _event(priority="critical", tags=["health"], all_day=True, tz="UTC")
    occs = occurrences_for_month([event], 2026, 1)
    assert occs[0].priority == "critical"
    assert occs[0].tag == "health"
    assert occs[0].all_day is True
    assert occs[0].tz == "UTC"


def test_tag_is_none_when_event_has_no_tags() -> None:
    """An event with no tags yields a null tag."""
    event = _event(tags=[])
    occs = occurrences_for_month([event], 2026, 1)
    assert occs[0].tag is None


def test_month_boundary_occurrence_at_start() -> None:
    """An occurrence exactly at month start is included."""
    event = _event(rrule=None, start_at=datetime(2026, 3, 1, 0, 0, tzinfo=UTC))
    occs = occurrences_for_month([event], 2026, 3)
    assert len(occs) == 1
    assert occs[0].start_at == datetime(2026, 3, 1, 0, 0, tzinfo=UTC)


def test_month_boundary_occurrence_at_end() -> None:
    """An occurrence on the last day of the month is included."""
    event = _event(rrule=None, start_at=datetime(2026, 3, 31, 23, 59, tzinfo=UTC))
    occs = occurrences_for_month([event], 2026, 3)
    assert len(occs) == 1
    assert occs[0].start_at.day == 31


def test_leap_year_february() -> None:
    """A daily event covers all 29 days of a leap February."""
    event = _event(start_at=datetime(2024, 2, 1, 10, 0, tzinfo=UTC))
    occs = occurrences_for_month([event], 2024, 2)
    assert len(occs) == 29


def test_dst_crossing_month() -> None:
    """A daily event across a DST transition keeps one occurrence per day."""
    # Europe/Berlin DST begins the last Sunday of March (2026-03-29).
    event = _event(tz="Europe/Berlin", start_at=datetime(2026, 3, 1, 10, 0, tzinfo=UTC))
    occs = occurrences_for_month([event], 2026, 3)
    assert len(occs) == 31


def test_next_occurrence_points_past_the_month() -> None:
    """next_occurrence is the next occurrence at/after the month."""
    # Monthly on the 15th; asking for January gives the February occurrence.
    event = _event(rrule="FREQ=MONTHLY;BYMONTHDAY=15")
    occs = occurrences_for_month([event], 2026, 1)
    assert len(occs) == 1
    assert occs[0].next_occurrence == datetime(2026, 2, 15, 10, 0, tzinfo=UTC)


def test_next_occurrence_rolls_over_into_next_year() -> None:
    """December's next occurrence rolls into the following January."""
    # Monthly on the 15th; asking for December 2026 gives the January 2027
    # occurrence, exercising the ``month == 12`` year-rollover branch.
    event = _event(rrule="FREQ=MONTHLY;BYMONTHDAY=15")
    occs = occurrences_for_month([event], 2026, 12)
    assert len(occs) == 1
    assert occs[0].next_occurrence == datetime(2027, 1, 15, 10, 0, tzinfo=UTC)


def test_next_occurrence_none_when_event_ended() -> None:
    """An event that ends within the month has no next occurrence."""
    event = _event(
        rrule="FREQ=DAILY;COUNT=5",
        start_at=datetime(2026, 1, 1, 10, 0, tzinfo=UTC),
    )
    occs = occurrences_for_month([event], 2026, 1)
    assert len(occs) == 5
    assert occs[0].next_occurrence is None


def test_entries_sorted_by_start() -> None:
    """Entries across multiple events are sorted by start time."""
    early = _event(id=1, rrule=None, start_at=datetime(2026, 1, 1, 9, 0, tzinfo=UTC))
    late = _event(id=2, rrule=None, start_at=datetime(2026, 1, 1, 18, 0, tzinfo=UTC))
    occs = occurrences_for_month([late, early], 2026, 1)
    assert [o.event_id for o in occs] == [1, 2]


def test_empty_month_returns_empty_list() -> None:
    """A month with no events yields an empty list."""
    assert occurrences_for_month([], 2026, 1) == []


def test_returns_dataclass() -> None:
    """occurrences_for_month returns EventOccurrence dataclasses."""
    occs = occurrences_for_month([_event()], 2026, 1)
    assert isinstance(occs[0], EventOccurrence)


# --- /api/events/occurrences endpoint ---------------------------------------


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """A TestClient with seeding disabled for deterministic occurrences."""
    settings = Settings(
        data_dir=tmp_path, db_name="occurrences.db", seed_on_start=False
    )
    with TestClient(create_app(settings)) as client:
        yield client


def test_occurrences_endpoint_empty_month(client: TestClient) -> None:
    """A month with no events returns an empty list."""
    resp = client.get("/api/events/occurrences?month=2026-01")
    assert resp.status_code == 200
    assert resp.json() == []


def test_occurrences_endpoint_recurrent_event(client: TestClient) -> None:
    """A created daily event yields one occurrence per day in the month."""
    client.post(
        "/api/events",
        json={
            "title": "Daily standup",
            "type": "recurrent",
            "start_at": "2026-01-01T09:00:00+00:00",
            "tz": "UTC",
            "rrule": "FREQ=DAILY",
            "priority": "critical",
            "tags": ["team"],
            "source": "web",
            "status": "active",
        },
    )
    resp = client.get("/api/events/occurrences?month=2026-01")
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 31
    first = body[0]
    assert first["title"] == "Daily standup"
    assert first["priority"] == "critical"
    assert first["tag"] == "team"
    assert first["rrule"] == "FREQ=DAILY"
    assert first["start_at"].startswith("2026-01-01")
    assert first["next_occurrence"].startswith("2026-02-01")


def test_occurrences_endpoint_one_time_event(client: TestClient) -> None:
    """A one-time event appears once in its month and not elsewhere."""
    client.post(
        "/api/events",
        json={
            "title": "Launch",
            "type": "one_time",
            "start_at": "2026-06-05T18:00:00+00:00",
            "tz": "UTC",
            "priority": "low",
            "source": "web",
            "status": "active",
        },
    )
    june = client.get("/api/events/occurrences?month=2026-06").json()
    assert len(june) == 1
    assert june[0]["title"] == "Launch"
    assert june[0]["rrule"] is None
    assert client.get("/api/events/occurrences?month=2026-07").json() == []


def test_occurrences_endpoint_ignores_archived(client: TestClient) -> None:
    """Archived events are excluded from the occurrences."""
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
    assert client.get("/api/events/occurrences?month=2026-01").json() == []


def test_occurrences_endpoint_december_rollover(client: TestClient) -> None:
    """A December query returns the next occurrence in the following year."""
    client.post(
        "/api/events",
        json={
            "title": "Monthly review",
            "type": "recurrent",
            "start_at": "2026-01-15T10:00:00+00:00",
            "tz": "UTC",
            "rrule": "FREQ=MONTHLY;BYMONTHDAY=15",
            "priority": "medium",
            "source": "web",
            "status": "active",
        },
    )
    resp = client.get("/api/events/occurrences?month=2026-12")
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["start_at"].startswith("2026-12-15")
    assert body[0]["next_occurrence"].startswith("2027-01-15")


def test_occurrences_endpoint_quarterly_january_start_shows_october(
    client: TestClient,
) -> None:
    """A quarterly event starting 2026-01-01 occurs on 2026-10-01 (Q4).

    Regression test: the Q4 occurrence must be present in the October payload
    (with the following January as its next occurrence) in every view that
    reads per-month occurrences.
    """
    client.post(
        "/api/events",
        json={
            "title": "Pay HRA quarterly",
            "type": "recurrent",
            "start_at": "2026-01-01T12:00:00",
            "tz": "America/New_York",
            "rrule": "FREQ=MONTHLY;INTERVAL=3",
            "priority": "critical",
            "source": "web",
            "status": "active",
        },
    )
    resp = client.get("/api/events/occurrences?month=2026-10")
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 1
    assert body[0]["title"] == "Pay HRA quarterly"
    assert body[0]["start_at"].startswith("2026-10-01")
    assert body[0]["next_occurrence"].startswith("2027-01-01")


def test_occurrences_endpoint_invalid_month(client: TestClient) -> None:
    """A malformed month is rejected with 422."""
    assert client.get("/api/events/occurrences?month=2026-13").status_code == 422
    assert client.get("/api/events/occurrences?month=2026").status_code == 422
    assert client.get("/api/events/occurrences?month=Jan-2026").status_code == 422
