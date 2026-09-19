"""Shared pytest configuration for the API test suite.

Hermeticity against the host machine (issue #140): the owner machine exports
production env vars (``TELEGRAM_*``, ``LLM_*``, ``TIMELINE_*``, ``STT_*``)
and :class:`app.config.Settings` reads env vars at instantiation, so leaked
values make "defaults" tests fail and outbound tests target the real
allowlisted chat id. An autouse fixture deletes those variables before every
test; a test opts out with ``@pytest.mark.keep_machine_env``.
"""

from __future__ import annotations

import os

import pytest

#: Env var prefixes that carry machine/production configuration into
#: ``Settings`` and must not leak into tests (issue #140).
HERMETIC_ENV_PREFIXES: tuple[str, ...] = ("TELEGRAM_", "LLM_", "TIMELINE_", "STT_")


def purge_machine_env(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Delete every ``TELEGRAM_*``/``LLM_*``/``TIMELINE_*``/``STT_*`` env var.

    Uses ``monkeypatch.delenv`` so the values are restored at teardown.
    Returns the sorted names removed so tests can assert on the mechanism;
    variables without a hermetic prefix (``PATH``, ``HOME``, ...) are never
    touched.
    """
    removed: list[str] = []
    for name in sorted(os.environ):
        if name.startswith(HERMETIC_ENV_PREFIXES):
            monkeypatch.delenv(name, raising=False)
            removed.append(name)
    return removed


@pytest.fixture(autouse=True)
def hermetic_env(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Delete machine env vars before each test (issue #140).

    ``Settings`` reads ``TELEGRAM_*``/``LLM_*``/``TIMELINE_*``/``STT_*`` from
    the environment at instantiation, so a machine that exports production
    values would otherwise leak them into every test. A test that
    intentionally wants the ambient env opts out by marking itself
    ``@pytest.mark.keep_machine_env``.
    """
    if request.node.get_closest_marker("keep_machine_env") is not None:
        return
    purge_machine_env(monkeypatch)
