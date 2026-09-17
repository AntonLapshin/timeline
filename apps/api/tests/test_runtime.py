"""Tests for the runtime wiring (issue #111).

Covers ``app.runtime`` (start/stop lifecycle of the Telegram bot + reminder
scheduler) and the ``/healthz`` ``components`` status field wired through the
``app.main`` lifespan:

- ``start_runtime`` starts the scheduler + Telegram polling when ``BOT_TOKEN``
  is set (with a fake PTB application — no network I/O).
- it is a no-op with one clear log line when ``BOT_TOKEN`` is unset;
- a startup failure is logged and reported as ``error`` on /healthz instead of
  taking the API down, and partially-started components are shut down;
- ``RuntimeComponents.shutdown`` is best-effort and safe to call twice;
- ``components_status`` maps components to the /healthz fields.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app import runtime
from app.config import Settings
from app.db import create_engine_from_settings, make_session_factory
from app.main import create_app
from app.models import Base
from app.runtime import RuntimeComponents, components_status

# --- fakes (no network, no real Telegram) -------------------------------------


class _FakeUpdater:
    """Records start_polling/stop calls."""

    def __init__(self, calls: list[str]) -> None:
        self._calls = calls

    async def start_polling(self) -> None:
        self._calls.append("start_polling")

    async def stop(self) -> None:
        self._calls.append("updater.stop")


class _FakeTelegramApp:
    """A fake python-telegram-bot Application (initialize/start/stop)."""

    def __init__(self, *, fail_on: str | None = None) -> None:
        self.calls: list[str] = []
        self.bot = object()
        self.updater = _FakeUpdater(self.calls)
        self._fail_on = fail_on

    async def initialize(self) -> None:
        if self._fail_on == "initialize":
            raise RuntimeError("initialize exploded")
        self.calls.append("initialize")

    async def start(self) -> None:
        if self._fail_on == "start":
            raise RuntimeError("start exploded")
        self.calls.append("start")

    async def stop(self) -> None:
        if self._fail_on == "stop":
            raise RuntimeError("stop exploded")
        self.calls.append("stop")

    async def shutdown(self) -> None:
        self.calls.append("shutdown")


class _FakeScheduler:
    """A scheduler stand-in for the injectable-starter /healthz tests."""

    def __init__(self) -> None:
        self.shutdown_calls = 0

    def shutdown(self, wait: bool = True) -> None:  # noqa: ARG002 - signature only
        self.shutdown_calls += 1


def _settings(tmp_path: Path, token: str | None = "123:abc") -> Settings:
    return Settings(
        data_dir=tmp_path,
        db_name="runtime.db",
        telegram_bot_token=token,
        telegram_user_id="42",
    )


def _session_factory(tmp_path: Path) -> sessionmaker[Session]:
    settings = Settings(data_dir=tmp_path, db_name="runtime.db")
    engine = create_engine_from_settings(settings)
    Base.metadata.create_all(engine)
    return make_session_factory(engine)


# --- start_runtime -------------------------------------------------------------


def test_start_runtime_noop_without_token(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """No BOT_TOKEN -> nothing starts, one clear log line (issue #111)."""
    with caplog.at_level(logging.INFO):
        components = asyncio.run(
            runtime.start_runtime(
                _settings(tmp_path, token=None), _session_factory(tmp_path)
            )
        )
    assert components.scheduler is None
    assert components.telegram_app is None
    assert components.scheduler_status == "disabled"
    assert components.telegram_status == "not_configured"
    messages = [r.getMessage() for r in caplog.records]
    assert any("disabled" in m and "BOT_TOKEN" in m for m in messages)


def test_start_runtime_warns_on_empty_allowlist(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Token set but no allowlist -> fail-closed startup warning (issue #112)."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    settings = Settings(
        data_dir=tmp_path,
        db_name="runtime.db",
        telegram_bot_token="123:abc",
        telegram_user_id=None,
        telegram_user_ids=None,
    )
    with caplog.at_level(logging.WARNING):
        components = asyncio.run(
            runtime.start_runtime(settings, _session_factory(tmp_path))
        )
    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("ignore every message" in m for m in messages)
    # Fail closed but still running: the bot starts, the gate denies everyone.
    assert components.telegram_app is fake_app
    assert components.telegram_status == "configured"
    asyncio.run(components.shutdown())


def test_start_runtime_warns_on_invalid_allowlist_entries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Invalid allowlist entries are named in the startup warning (issue #112)."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    settings = Settings(
        data_dir=tmp_path,
        db_name="runtime.db",
        telegram_bot_token="123:abc",
        telegram_user_id="42",
        telegram_user_ids="abc",
    )
    with caplog.at_level(logging.WARNING):
        components = asyncio.run(
            runtime.start_runtime(settings, _session_factory(tmp_path))
        )
    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("abc" in m for m in messages)
    asyncio.run(components.shutdown())


def test_start_runtime_no_allowlist_warning_when_valid(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A valid allowlist logs no allowlist warning (issue #112)."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    with caplog.at_level(logging.WARNING):
        components = asyncio.run(
            runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
        )
    assert not [r for r in caplog.records if "allowlist problem" in r.getMessage()]
    asyncio.run(components.shutdown())


def test_start_runtime_starts_scheduler_and_bot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With a token the scheduler runs, polling starts, and the drain ran."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )

    assert components.telegram_app is fake_app
    assert components.scheduler is not None
    assert components.scheduler.running is True
    assert components.scheduler_status == "running"
    assert components.telegram_status == "configured"
    # The PTB application was initialized, started, and is polling.
    assert fake_app.calls == ["initialize", "start", "start_polling"]

    asyncio.run(components.shutdown())
    assert "updater.stop" in fake_app.calls
    assert "stop" in fake_app.calls
    assert "shutdown" in fake_app.calls
    assert components.scheduler.running is False


def test_start_runtime_shutdown_is_safe_twice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Calling shutdown twice never raises (best-effort, idempotent teardown)."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    asyncio.run(components.shutdown())
    asyncio.run(components.shutdown())  # must not raise
    assert "shutdown" in fake_app.calls
    assert components.scheduler is not None
    assert components.scheduler.running is False


def test_start_runtime_shutdown_swallows_component_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failing component never blocks the rest of the teardown."""
    fake_app = _FakeTelegramApp(fail_on="stop")
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    assert components.scheduler is not None
    asyncio.run(components.shutdown())
    # The scheduler was still shut down despite the app.stop() failure.
    assert components.scheduler.running is False
    assert "shutdown" in fake_app.calls


def test_start_runtime_telegram_build_failure_marks_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bot startup failure keeps the API serving with telegram=error."""

    def _boom(settings: Settings, sf: sessionmaker[Session]) -> Any:
        raise RuntimeError("telegram down")

    monkeypatch.setattr(runtime, "build_telegram_inbound_application", _boom)
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    assert components.scheduler is None
    assert components.telegram_app is None
    assert components.telegram_status == "error"
    assert components.telegram_error == "telegram down"
    assert components.scheduler_status == "disabled"


@pytest.mark.parametrize(
    ("patch_target", "message"),
    [
        ("build_scheduler", "scheduler jobstore broken"),
        ("drain_schedule", "drain exploded"),
    ],
)
def test_start_runtime_scheduler_failure_reports_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    patch_target: str,
    message: str,
) -> None:
    """A scheduler build/drain failure surfaces as telegram=error, not a crash."""
    fake_app = _FakeTelegramApp()
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )

    def _boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError(message)

    monkeypatch.setattr(runtime, patch_target, _boom)
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    assert components.scheduler is None
    assert components.telegram_status == "error"
    assert message in (components.telegram_error or "")
    # The bot got as far as initialize but was torn down again.
    assert "initialize" in fake_app.calls
    assert "stop" in fake_app.calls


def test_start_runtime_failure_shuts_down_partially_started(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure after the bot initialized stops it and the scheduler."""
    fake_app = _FakeTelegramApp(fail_on="start")
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    assert components.telegram_status == "error"
    assert "start exploded" in (components.telegram_error or "")
    assert "initialize" in fake_app.calls  # it got that far...
    assert "stop" in fake_app.calls  # ...and was torn down again


def test_start_runtime_polling_failure_reports_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A start_polling failure is reported as error, not a crash."""
    fake_app = _FakeTelegramApp()

    class _FailingUpdater(_FakeUpdater):
        async def start_polling(self) -> None:
            raise RuntimeError("polling refused")

    fake_app.updater = _FailingUpdater(fake_app.calls)
    monkeypatch.setattr(
        runtime, "build_telegram_inbound_application", lambda s, sf: fake_app
    )
    components = asyncio.run(
        runtime.start_runtime(_settings(tmp_path), _session_factory(tmp_path))
    )
    assert components.telegram_status == "error"
    assert "polling refused" in (components.telegram_error or "")
    assert "stop" in fake_app.calls


# --- components_status ----------------------------------------------------------


def test_components_status_none() -> None:
    """Before the lifespan ran, components report disabled / not_configured."""
    assert components_status(None) == {
        "scheduler": "disabled",
        "telegram": "not_configured",
    }


def test_components_status_error() -> None:
    """A Telegram failure is surfaced as ``error`` on /healthz."""
    status = components_status(RuntimeComponents(telegram_error="boom"))
    assert status == {"scheduler": "disabled", "telegram": "error"}


# --- /healthz integration (lifespan wiring) -------------------------------------


def test_healthz_components_unconfigured(tmp_path: Path) -> None:
    """The real lifespan with no BOT_TOKEN reports disabled / not_configured."""
    with TestClient(create_app(_settings(tmp_path, token=None))) as client:
        body = client.get("/healthz").json()
    assert body["components"] == {"scheduler": "disabled", "telegram": "not_configured"}


def test_healthz_components_configured_and_shutdown(tmp_path: Path) -> None:
    """The lifespan starts the (fake) runtime and shuts it down on exit."""
    started: list[Settings] = []
    scheduler = _FakeScheduler()

    async def starter(
        settings: Settings, session_factory: sessionmaker[Session]
    ) -> RuntimeComponents:
        started.append(settings)
        return RuntimeComponents(scheduler=scheduler, telegram_app=object())

    app = create_app(_settings(tmp_path), start_runtime=starter)
    with TestClient(app) as client:
        body = client.get("/healthz").json()
        assert body["components"] == {"scheduler": "running", "telegram": "configured"}
    assert len(started) == 1
    assert scheduler.shutdown_calls == 1  # shutdown ran when the app stopped


def test_healthz_components_error_status(tmp_path: Path) -> None:
    """A failed Telegram stack is reported as ``error`` on /healthz."""

    async def starter(
        settings: Settings, session_factory: sessionmaker[Session]
    ) -> RuntimeComponents:
        return RuntimeComponents(telegram_error="boom")

    app = create_app(_settings(tmp_path), start_runtime=starter)
    with TestClient(app) as client:
        body = client.get("/healthz").json()
    assert body["components"] == {"scheduler": "disabled", "telegram": "error"}


def test_healthz_components_before_lifespan(tmp_path: Path) -> None:
    """Without the lifespan (plain client), /healthz still reports a status."""
    client = TestClient(create_app(_settings(tmp_path, token=None)))
    body = client.get("/healthz").json()
    assert body["components"] == {"scheduler": "disabled", "telegram": "not_configured"}
