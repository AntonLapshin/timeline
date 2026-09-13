"""Tests for the event CRUD API endpoints (issue #15).

Exercises create, list, single-get, update and delete against an isolated app
instance whose lifespan creates tables and seeds the database. Validates the
shared-schema constraints (title length, priority/channel enums, reminder-offset
pattern) and 404 handling.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """A TestClient whose lifespan creates tables and seeds the DB."""
    settings = Settings(data_dir=tmp_path, db_name="test.db")
    with TestClient(create_app(settings)) as client:
        yield client


def _payload(**overrides: object) -> dict[str, object]:
    """A minimal valid event create payload."""
    values: dict[str, object] = {
        "title": "Team standup",
        "type": "one_time",
        "start_at": "2026-01-01T10:00:00+00:00",
        "tz": "UTC",
        "priority": "medium",
        "source": "web",
        "status": "active",
    }
    values.update(overrides)
    return values


def test_create_event(client: TestClient) -> None:
    """POST /api/events creates an event and returns it with an id."""
    resp = client.post("/api/events", json=_payload())
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] is not None
    assert body["title"] == "Team standup"
    assert body["type"] == "one_time"
    assert body["priority"] == "medium"
    assert body["channels"] == ["telegram"]
    assert body["status"] == "active"


def test_create_event_applies_defaults(client: TestClient) -> None:
    """Optional fields default per the shared schema."""
    resp = client.post("/api/events", json=_payload())
    body = resp.json()
    assert body["description"] == ""
    assert body["tags"] == []
    assert body["all_day"] is False
    assert body["rrule"] is None
    assert body["reminder_offsets"] == []
    assert body["source"] == "web"


def test_create_event_validation_errors(client: TestClient) -> None:
    """Invalid payloads are rejected with 422."""
    # Empty title violates minLength 1.
    resp = client.post("/api/events", json=_payload(title=""))
    assert resp.status_code == 422

    # Bad priority enum value.
    resp = client.post("/api/events", json=_payload(priority="urgent"))
    assert resp.status_code == 422

    # Bad reminder offset pattern.
    resp = client.post("/api/events", json=_payload(reminder_offsets=["tomorrow"]))
    assert resp.status_code == 422

    # Missing required fields.
    resp = client.post("/api/events", json={"title": "x"})
    assert resp.status_code == 422


def test_list_events(client: TestClient) -> None:
    """GET /api/events returns the seeded events plus any created ones."""
    client.post("/api/events", json=_payload(title="New event"))
    resp = client.get("/api/events")
    assert resp.status_code == 200
    body = resp.json()
    titles = [e["title"] for e in body]
    assert "New event" in titles
    assert "Pay HRA (quarterly)" in titles


def test_get_event(client: TestClient) -> None:
    """GET /api/events/{id} returns the single event."""
    created = client.post("/api/events", json=_payload(title="Fetch me")).json()
    resp = client.get(f"/api/events/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Fetch me"


def test_get_event_not_found(client: TestClient) -> None:
    """Getting a missing event returns 404."""
    resp = client.get("/api/events/999999")
    assert resp.status_code == 404


def test_update_event(client: TestClient) -> None:
    """PATCH /api/events/{id} partially updates an event."""
    created = client.post("/api/events", json=_payload(title="Before")).json()
    resp = client.patch(
        f"/api/events/{created['id']}", json={"title": "After", "priority": "low"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "After"
    assert body["priority"] == "low"
    # Unchanged fields are preserved.
    assert body["type"] == "one_time"


def test_update_event_not_found(client: TestClient) -> None:
    """Patching a missing event returns 404."""
    resp = client.patch("/api/events/999999", json={"title": "x"})
    assert resp.status_code == 404


def test_update_event_validation(client: TestClient) -> None:
    """Invalid update payloads are rejected with 422."""
    created = client.post("/api/events", json=_payload()).json()
    resp = client.patch(
        f"/api/events/{created['id']}", json={"reminder_offsets": ["bad"]}
    )
    assert resp.status_code == 422


def test_delete_event(client: TestClient) -> None:
    """DELETE /api/events/{id} removes the event."""
    created = client.post("/api/events", json=_payload(title="Delete me")).json()
    resp = client.delete(f"/api/events/{created['id']}")
    assert resp.status_code == 204
    # The event is gone.
    assert client.get(f"/api/events/{created['id']}").status_code == 404


def test_delete_event_not_found(client: TestClient) -> None:
    """Deleting a missing event returns 404."""
    resp = client.delete("/api/events/999999")
    assert resp.status_code == 404
