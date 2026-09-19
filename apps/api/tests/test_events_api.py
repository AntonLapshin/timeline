"""Tests for the event CRUD API endpoints (issue #15).

Exercises create, list, single-get, update and delete against an isolated app
instance whose lifespan creates tables and seeds the database. Validates the
shared-schema constraints (title length, priority/channel enums, reminder-offset
pattern) and 404 handling.
"""

from __future__ import annotations

import contextlib
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.models import DeliveryLog
from app.scheduler import build_scheduler, event_job_keys


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


def _noop_job(*args: object, **kwargs: object) -> object:
    """A placeholder reminder job (no Telegram, no DB)."""
    return None


def _shutdown_scheduler(scheduler: object) -> None:
    """Tear down a scheduler that may never have been started."""
    with contextlib.suppress(Exception):
        scheduler.shutdown(wait=False)  # type: ignore[attr-defined]


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


def _add_delivery(
    client: TestClient, event_id: int, **overrides: object
) -> DeliveryLog:
    """Insert a DeliveryLog row directly via the app's session factory."""
    fields: dict[str, object] = {"status": "sent"}
    fields.update(overrides)
    factory = client.app.state.session_factory
    with factory() as session:
        log = DeliveryLog(event_id=event_id, **fields)
        session.add(log)
        session.commit()
        session.refresh(log)
        return log


def test_get_event_deliveries_lists_logs(client: TestClient) -> None:
    """GET /api/events/{id}/deliveries returns the event's delivery log."""
    created = client.post("/api/events", json=_payload(title="Delivered")).json()
    event_id = created["id"]
    _add_delivery(
        client,
        event_id,
        occurrence_id="occ-1",
        offset="1h",
        status="sent",
        scheduled_at=datetime(2026, 9, 1, 9, 0, tzinfo=UTC),
        sent_at=datetime(2026, 9, 1, 9, 0, tzinfo=UTC),
    )
    _add_delivery(
        client,
        event_id,
        occurrence_id="occ-2",
        offset="1d",
        status="failed",
        error="network error",
    )

    resp = client.get(f"/api/events/{event_id}/deliveries")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    # Most recent first.
    assert [row["status"] for row in body] == ["failed", "sent"]
    first = body[0]
    assert first["event_id"] == event_id
    assert first["occurrence_id"] == "occ-2"
    assert first["offset"] == "1d"
    assert first["status"] == "failed"
    assert first["error"] == "network error"
    assert first["scheduled_at"] is None
    assert first["sent_at"] is None


def test_get_event_deliveries_empty(client: TestClient) -> None:
    """An event with no deliveries returns an empty list."""
    created = client.post("/api/events", json=_payload(title="Quiet")).json()
    resp = client.get(f"/api/events/{created['id']}/deliveries")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_event_deliveries_not_found(client: TestClient) -> None:
    """Fetching deliveries for a missing event returns 404."""
    resp = client.get("/api/events/999999/deliveries")
    assert resp.status_code == 404


def test_get_event_deliveries_scoped_to_event(client: TestClient) -> None:
    """Deliveries for other events are not returned."""
    a = client.post("/api/events", json=_payload(title="A")).json()
    b = client.post("/api/events", json=_payload(title="B")).json()
    _add_delivery(client, a["id"], status="sent")
    _add_delivery(client, b["id"], status="failed")

    resp = client.get(f"/api/events/{a['id']}/deliveries")
    body = resp.json()
    assert len(body) == 1
    assert body[0]["event_id"] == a["id"]
    assert body[0]["status"] == "sent"


# --- LLM parse endpoint (issue #70) -----------------------------------------


def test_parse_endpoint_unavailable_without_key(client: TestClient) -> None:
    """Without an LLM key, POST /api/events/parse returns 503 (unavailable)."""
    client.app.dependency_overrides[get_settings] = lambda: Settings(llm_api_key=None)
    try:
        resp = client.post(
            "/api/events/parse",
            json={"text": "dentist tomorrow 9am"},
        )
    finally:
        client.app.dependency_overrides.clear()
    assert resp.status_code == 503
    body = resp.json()
    assert "detail" in body


def test_parse_endpoint_llm_failure_returns_502_and_logs(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A real LLM failure surfaces as 502 with the cause logged (issue #113).

    The LLM HTTP client is faked (no network): the gate returns 502, the API
    responds 502 with the underlying error in ``detail`` and logs it
    server-side — without the API key or the raw user text.
    """
    settings = Settings(llm_api_key="test-key", llm_model="test-model")
    client.app.dependency_overrides[get_settings] = lambda: settings

    class _FakeLlmResponse:
        status_code = 502

        def json(self) -> dict[str, object]:
            return {"error": "invalid api key"}

    class _FakeLlmClient:
        def post(
            self, url: str, *, headers: dict[str, str], json: dict[str, object]
        ) -> _FakeLlmResponse:
            return _FakeLlmResponse()

    monkeypatch.setattr(httpx, "Client", lambda *a, **k: _FakeLlmClient())
    try:
        with caplog.at_level(logging.ERROR, logger="app.llm_parse"):
            resp = client.post("/api/events/parse", json={"text": "dentist tomorrow"})
    finally:
        client.app.dependency_overrides.clear()
    assert resp.status_code == 502
    assert "LLM request failed (HTTP 502)" in resp.json()["detail"]
    # The underlying failure is in the server logs — but no secrets/text.
    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "LLM parse failed" in messages
    assert "HTTP 502" in messages
    assert "test-key" not in messages
    assert "dentist tomorrow" not in messages


def test_parse_endpoint_requires_text(client: TestClient) -> None:
    """An empty text payload is rejected with 422."""
    resp = client.post("/api/events/parse", json={"text": ""})
    assert resp.status_code == 422


# --- runtime scheduling wiring (issue #134, M10-T1) ----------------------------


def _runtime_client(tmp_path: Path, scheduler: object) -> TestClient:
    """A TestClient whose runtime runs the given (real) scheduler."""
    from app.runtime import RuntimeComponents

    async def starter(settings: Settings, session_factory: object) -> RuntimeComponents:
        return RuntimeComponents(
            scheduler=scheduler, telegram_app=object(), job_func=_noop_job
        )

    return TestClient(
        create_app(
            Settings(data_dir=tmp_path, db_name="test.db"),
            start_runtime=starter,  # type: ignore[arg-type]
        )
    )


def test_create_event_schedules_reminder_job(tmp_path: Path) -> None:
    """POST /api/events schedules the event's reminders immediately (#133)."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"api-jobs-{id(object())}.db")
    )
    try:
        with _runtime_client(tmp_path, scheduler) as client:
            future = (
                datetime.now(UTC).replace(microsecond=0) + timedelta(days=30)
            ).isoformat()
            resp = client.post(
                "/api/events",
                json=_payload(start_at=future, reminder_offsets=["1h"]),
            )
            assert resp.status_code == 201
            event_id = resp.json()["id"]
            keys = event_job_keys(scheduler, event_id)
            assert len(keys) == 1
            assert next(iter(keys)).startswith(f"{event_id}:")
    finally:
        _shutdown_scheduler(scheduler)


def test_update_event_replans_reminder_job(tmp_path: Path) -> None:
    """PUT /api/events re-plans the event's jobs (no stale duplicates)."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"api-jobs-{id(object())}.db")
    )
    try:
        with _runtime_client(tmp_path, scheduler) as client:
            future = (
                datetime.now(UTC).replace(microsecond=0) + timedelta(days=30)
            ).isoformat()
            created = client.post(
                "/api/events",
                json=_payload(start_at=future, reminder_offsets=["1h"]),
            ).json()
            event_id = created["id"]
            assert len(scheduler.get_jobs()) == 1
            old_key = next(iter(scheduler.get_jobs())).id

            moved = (
                datetime.now(UTC).replace(microsecond=0) + timedelta(days=31)
            ).isoformat()
            resp = client.patch(f"/api/events/{event_id}", json={"start_at": moved})
            assert resp.status_code == 200

            keys = event_job_keys(scheduler, event_id)
            assert len(keys) == 1
            assert old_key not in keys  # old occurrence's job is gone
    finally:
        _shutdown_scheduler(scheduler)


def test_delete_event_removes_reminder_jobs(tmp_path: Path) -> None:
    """DELETE /api/events/{id} drops the event's pending reminder jobs."""
    scheduler = build_scheduler(
        Settings(data_dir=tmp_path, db_name=f"api-jobs-{id(object())}.db")
    )
    try:
        with _runtime_client(tmp_path, scheduler) as client:
            future = (
                datetime.now(UTC).replace(microsecond=0) + timedelta(days=30)
            ).isoformat()
            created = client.post(
                "/api/events",
                json=_payload(start_at=future, reminder_offsets=["1h"]),
            ).json()
            event_id = created["id"]
            assert len(scheduler.get_jobs()) == 1

            resp = client.delete(f"/api/events/{event_id}")
            assert resp.status_code == 204
            assert scheduler.get_jobs() == []
    finally:
        _shutdown_scheduler(scheduler)


def _disabled_runtime_client(tmp_path: Path) -> TestClient:
    """A TestClient whose runtime is deterministically disabled.

    The default starter honours the machine's Telegram/scheduler settings, so
    a dev box with a configured token would start a live scheduler and make
    the disabled-path assertions environment-dependent. Injecting a starter
    that returns all-``None`` ``RuntimeComponents`` pins the disabled
    scenario (review finding on PR #137).
    """
    from app.runtime import RuntimeComponents

    async def starter(settings: Settings, session_factory: object) -> RuntimeComponents:
        return RuntimeComponents()

    return TestClient(
        create_app(
            Settings(data_dir=tmp_path, db_name="test.db"),
            start_runtime=starter,  # type: ignore[arg-type]
        )
    )


def test_event_writes_without_scheduler_still_work(tmp_path: Path) -> None:
    """With the scheduler disabled, event writes are a scheduling no-op.

    The disabled scenario is pinned via an injected starter returning
    ``RuntimeComponents()`` (scheduler=None) so the test can't silently
    exercise a live scheduler on a machine with a configured token.
    """
    with _disabled_runtime_client(tmp_path) as disabled:
        resp = disabled.post("/api/events", json=_payload())
        assert resp.status_code == 201
        event_id = resp.json()["id"]
        renamed = disabled.patch(f"/api/events/{event_id}", json={"title": "X"})
        assert renamed.status_code == 200
        assert disabled.delete(f"/api/events/{event_id}").status_code == 204
