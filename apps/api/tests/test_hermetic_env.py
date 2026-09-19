"""Tests for the hermetic-env mechanism in ``tests/conftest.py`` (issue #140).

The API test suite must pass on a machine that exports production env vars
(``TELEGRAM_*``/``LLM_*``/``TIMELINE_*``/``STT_*``): the autouse
``hermetic_env`` fixture deletes them before every test so ``Settings`` sees
its documented defaults. These tests pin the mechanism itself — the prefix
purge, the untouched non-matching variables, and the ``keep_machine_env``
opt-in — using a module-scoped fixture that simulates the owner-machine leak
(module scope is instantiated before the function-scoped autouse fixture, so
the leak exists when the purge runs, exactly as on the owner machine).
"""

from __future__ import annotations

import os

import pytest

from app.config import Settings
from tests.conftest import HERMETIC_ENV_PREFIXES, purge_machine_env

#: Fake production values simulating the owner-machine leak (issue #140).
LEAKED_ENV: dict[str, str] = {
    "TELEGRAM_USER_IDS": "998877",
    "LLM_API_KEY": "leaked-key",
    "TIMELINE_LOG_FILE": "/tmp/leaked.log",
    "STT_VOXTYPE_PATH": "/opt/leaked-voxtype",
}


@pytest.fixture(scope="module")
def leaked_machine_env() -> None:
    """Export fake production env vars for the whole module.

    Mutates ``os.environ`` directly (not monkeypatch) because it must stay
    set across tests to simulate the ambient machine environment; restored
    exactly at teardown.
    """
    saved = {name: os.environ.get(name) for name in LEAKED_ENV}
    os.environ.update(LEAKED_ENV)
    try:
        yield
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


# --- purge_machine_env (pure helper) ----------------------------------------


def test_purge_machine_env_removes_only_prefixed_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Prefixed vars are deleted; non-matching vars are never touched."""
    for name, value in LEAKED_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("PATH", "/usr/bin")  # control: no hermetic prefix
    monkeypatch.setenv("BOT_TOKEN", "123:abc")  # control: secret, not prefixed

    purge = pytest.MonkeyPatch()
    try:
        removed = purge_machine_env(purge)
        assert removed == sorted(LEAKED_ENV)
        for name in LEAKED_ENV:
            assert name not in os.environ
        assert os.environ["PATH"] == "/usr/bin"
        assert os.environ["BOT_TOKEN"] == "123:abc"
    finally:
        purge.undo()

    # delenv-based purge restores the values at undo (teardown hygiene).
    for name, value in LEAKED_ENV.items():
        assert os.environ[name] == value


def test_hermetic_prefixes_cover_settings_env_reads() -> None:
    """The purge prefixes cover every env-backed Settings group (issue #140).

    Guards the constant itself: the four prefixes must be exactly the ones
    the acceptance criteria name, so a renamed prefix cannot silently drop
    out of the purge.
    """
    assert HERMETIC_ENV_PREFIXES == ("TELEGRAM_", "LLM_", "TIMELINE_", "STT_")


# --- autouse fixture behavior (simulated owner-machine leak) -----------------


def test_autouse_purge_hides_leaked_machine_env(
    leaked_machine_env: None,
) -> None:
    """The autouse conftest fixture deletes leaked vars before each test.

    Fails if the autouse ``hermetic_env`` fixture is removed or stops
    purging: the module fixture re-exports the vars before this test, so
    they must be invisible here (and ``Settings`` must see its defaults).
    """
    for name in LEAKED_ENV:
        assert name not in os.environ

    settings = Settings()
    assert settings.log_file is None
    assert settings.log_max_bytes == 5 * 1024 * 1024
    assert settings.log_backup_count == 5
    assert settings.telegram_user_ids is None
    assert settings.llm_api_key is None
    assert settings.llm_model == ""
    assert settings.stt_voxtype_path == "voxtype"


@pytest.mark.keep_machine_env
def test_keep_machine_env_marker_opts_out(
    leaked_machine_env: None,
) -> None:
    """The ``keep_machine_env`` marker keeps the machine env visible."""
    assert os.environ["TELEGRAM_USER_IDS"] == LEAKED_ENV["TELEGRAM_USER_IDS"]
    settings = Settings()
    assert settings.telegram_user_ids == "998877"
    assert settings.llm_api_key == "leaked-key"
