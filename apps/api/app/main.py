"""FastAPI application entrypoint for the timeline API.

Provides a bootable app with a `/healthz` endpoint, SQLite (WAL) wiring, the
event CRUD + summary routes (issue #15), and first-run seeding. The app factory
keeps construction testable: tests build an isolated app with their own
database. On startup the lifespan creates any missing tables and seeds the
initial events when the database is empty, then starts the runtime components
(issue #111): with ``BOT_TOKEN`` set the Telegram inbound bot polls and the
APScheduler reminder engine delivers due reminders as Telegram cards — all in
this process; without it the app starts exactly as before.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import (  # noqa: F401  (models registers tables on Base.metadata)
    models,
    runtime,
    seed,
)
from .bind_guard import assert_loopback_host
from .config import Settings, get_settings
from .db import Base, create_engine_from_settings, make_session_factory
from .logging_setup import configure_logging
from .routes import router
from .runtime import RuntimeStarter, components_status

#: Process start time (monotonic) used to report uptime on /healthz.
_START_MONOTONIC = time.monotonic()


def create_app(
    settings: Settings | None = None,
    *,
    start_runtime: RuntimeStarter | None = None,
) -> FastAPI:
    """Build the FastAPI application (or app factory).

    ``start_runtime`` is injectable so tests can fake the Telegram/scheduler
    startup (the real one needs a live Telegram API); it defaults to the real
    :func:`app.runtime.start_runtime` wiring.
    """
    settings = settings or get_settings()
    # Fail-closed: never bind to a non-loopback host (no auth) unless the
    # operator explicitly opted in via TIMELINE_ALLOW_NON_LOOPBACK (issue #97).
    assert_loopback_host(settings.host, allow_non_loopback=settings.allow_non_loopback)
    configure_logging(settings)
    engine = create_engine_from_settings(settings)
    session_factory = make_session_factory(engine)
    starter: RuntimeStarter = start_runtime or runtime.start_runtime

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> Any:
        """Create tables, seed, then start the runtime components (issue #111)."""
        Base.metadata.create_all(engine)
        if settings.seed_on_start:
            with session_factory() as session:
                seed.seed_if_empty(session)
        components = await starter(settings, session_factory)
        app.state.runtime = components
        try:
            yield
        finally:
            await components.shutdown()

    app = FastAPI(
        title="Timeline API",
        version="0.2.0",
        description="Local-first schedule API (loopback only, no auth).",
        lifespan=lifespan,
    )

    def get_session() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    @app.get("/healthz", tags=["system"])
    def healthz(
        request: Request,
        db: Session = Depends(get_session),  # noqa: B008 (FastAPI dependency injection)
    ) -> dict[str, Any]:
        """Liveness probe: ok + uptime + component status when the DB is reachable.

        ``components`` lets the owner self-diagnose from the browser: the
        reminder scheduler (``running``/``disabled``) and the Telegram bot
        (``configured``/``not_configured``/``error``).
        """
        db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "uptime_seconds": int(time.monotonic() - _START_MONOTONIC),
            "components": components_status(
                getattr(request.app.state, "runtime", None)
            ),
        }

    app.include_router(router)

    # Keep engine reference so it is not garbage collected and is inspectable.
    app.state.engine = engine
    app.state.session_factory = session_factory
    # Set by the lifespan; /healthz falls back to disabled/not_configured.
    app.state.runtime = None

    return app


# Module-level app for `uvicorn app.main:app` style runs.
app = create_app()
