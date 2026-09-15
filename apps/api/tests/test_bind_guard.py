"""Tests for the loopback-only bind guard (issue #77, M6-T1).

The timeline API has no auth, so it must fail closed and refuse to start when
bound to anything other than the loopback interface (e.g. ``0.0.0.0``).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.bind_guard import (
    BindGuardError,
    assert_loopback_host,
    is_loopback_host,
)
from app.config import Settings
from app.main import create_app

# --- Pure guard logic --------------------------------------------------------


def test_loopback_hosts_are_accepted() -> None:
    """Canonical loopback hosts pass the guard."""
    for host in ("127.0.0.1", "localhost", "::1"):
        assert is_loopback_host(host) is True
        assert_loopback_host(host)  # must not raise


def test_loopback_hosts_are_case_and_space_insensitive() -> None:
    """Whitespace and case around the host are tolerated."""
    assert is_loopback_host(" 127.0.0.1 ") is True
    assert is_loopback_host("LOCALHOST") is True


def test_non_loopback_hosts_are_rejected() -> None:
    """Any non-loopback host (0.0.0.0, LAN/internet) is refused."""
    for host in ("0.0.0.0", "192.168.1.10", "10.0.0.5", "example.com", "0.0.0.0:8123"):
        assert is_loopback_host(host) is False
        with pytest.raises(BindGuardError):
            assert_loopback_host(host)


def test_guard_rejects_non_loopback_host() -> None:
    """The fail-closed guard raises BindGuardError for 0.0.0.0."""
    with pytest.raises(BindGuardError):
        assert_loopback_host("0.0.0.0")


def test_guard_error_message_mentions_loopback_fix() -> None:
    """The error tells the operator how to fix the bind host."""
    with pytest.raises(BindGuardError, match="127.0.0.1"):
        assert_loopback_host("0.0.0.0")


# --- Startup integration (fail-closed) ---------------------------------------


def test_create_app_refuses_non_loopback_host(tmp_path: Path) -> None:
    """create_app fails closed when the configured host is not loopback-only."""
    settings = Settings(data_dir=tmp_path, db_name="test.db", host="0.0.0.0")
    with pytest.raises(BindGuardError):
        create_app(settings)


def test_create_app_accepts_loopback_host(tmp_path: Path) -> None:
    """create_app builds successfully for the default loopback host."""
    settings = Settings(data_dir=tmp_path, db_name="test.db", host="127.0.0.1")
    client = TestClient(create_app(settings))
    resp = client.get("/healthz")
    assert resp.status_code == 200
