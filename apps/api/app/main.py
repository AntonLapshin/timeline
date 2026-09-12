"""FastAPI application entrypoint for the timeline API.

Provides a bootable app with a `/healthz` endpoint, SQLite (WAL) wiring, the
event CRUD + summary routes (issue #15), and first-run seeding. The app factory
keeps construction testable: tests build an isolated app with their own
database. On startup the lifespan creates any missing tables and seeds the
initial events when the database is empty.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models, seed  # noqa: F401  (models registers tables on Base.metadata)
from .config import Settings, get_settings
from .db import Base, create_engine_from_settings, make_session_factory
from .routes import router


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application (or app factory)."""
    settings = settings or get_settings()
    engine = create_engine_from_settings(settings)
    session_factory = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> Any:
        """Create missing tables and seed the database on first run."""
        Base.metadata.create_all(engine)
        if settings.seed_on_start:
            with session_factory() as session:
                seed.seed_if_empty(session)
        yield

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
        db: Session = Depends(get_session),  # noqa: B008 (FastAPI dependency injection)
    ) -> dict[str, str]:
        """Liveness probe: returns ok when the DB is reachable."""
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(router)

    # Keep engine reference so it is not garbage collected and is inspectable.
    app.state.engine = engine
    app.state.session_factory = session_factory

    return app


# Module-level app for `uvicorn app.main:app` style runs.
app = create_app()
