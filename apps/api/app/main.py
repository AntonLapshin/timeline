"""FastAPI application entrypoint for the timeline API.

Provides a minimal, bootable app with a `/healthz` endpoint and SQLite (WAL)
wiring, per milestone M1 (issue #1). The app factory keeps construction
testable: tests build an isolated app with their own database.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import create_engine_from_settings, make_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application (or app factory)."""
    settings = settings or get_settings()
    engine = create_engine_from_settings(settings)
    session_factory = make_session_factory(engine)

    app = FastAPI(
        title="Timeline API",
        version="0.1.0",
        description="Local-first schedule API (loopback only, no auth).",
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

    # Keep engine reference so it is not garbage collected and is inspectable.
    app.state.engine = engine
    app.state.session_factory = session_factory

    return app


# Module-level app for `uvicorn app.main:app` style runs.
app = create_app()
