"""Loopback-only bind guard for the timeline API (issue #77).

The web/API server has **no auth**, so it must only ever bind to the loopback
interface. This module provides a fail-closed startup guard that refuses to
start when the configured bind host is not loopback-only (e.g. ``0.0.0.0`` or a
LAN/internet interface). The logic is pure (no I/O) so it is fully
unit-testable and lives outside any HTTP/DB layer.
"""

from __future__ import annotations

#: Host values that resolve to the loopback interface (localhost only, no auth).
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class BindGuardError(RuntimeError):
    """Raised when the configured bind host is not loopback-only."""


def is_loopback_host(host: str) -> bool:
    """Return True when *host* binds only to the loopback interface.

    Accepts the canonical IPv4 loopback (``127.0.0.1``), the IPv6 loopback
    (``::1``) and ``localhost``. Everything else (``0.0.0.0``, LAN/internet
    addresses, hostnames) is treated as non-loopback and refused.
    """
    return host.strip().lower() in _LOOPBACK_HOSTS


def assert_loopback_host(host: str) -> None:
    """Fail-closed guard: raise :class:`BindGuardError` for any non-loopback host.

    The timeline API has no auth, so binding to ``0.0.0.0`` (or any LAN/internet
    interface) would expose it to the network. Refuse to start in that case and
    tell the operator how to fix it.
    """
    if not is_loopback_host(host):
        raise BindGuardError(
            f"Refusing to start: bind host {host!r} is not loopback-only "
            "(timeline has no auth; set TIMELINE_HOST to 127.0.0.1)."
        )
