"""Loopback-only bind guard for the timeline API (issues #77, #97).

The web/API server has **no auth**, so by default it must only ever bind to
the loopback interface. This module provides a fail-closed startup guard that
refuses to start when the configured bind host is not loopback-only (e.g.
``0.0.0.0`` or a LAN/internet interface) **unless** the operator explicitly
opts in to non-loopback binding (issue #97) via ``TIMELINE_ALLOW_NON_LOOPBACK``
— which exposes the app to the LAN with no auth, so it is opt-in only. The
logic is pure (no I/O) so it is fully unit-testable and lives outside any
HTTP/DB layer.
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


def assert_loopback_host(host: str, allow_non_loopback: bool = False) -> None:
    """Fail-closed guard: raise :class:`BindGuardError` for any non-loopback host.

    The timeline API has no auth, so binding to ``0.0.0.0`` (or any LAN/internet
    interface) would expose it to the network. Refuse to start in that case and
    tell the operator how to fix it — unless the operator has explicitly opted
    in to non-loopback binding via *allow_non_loopback* (issue #97,
    ``TIMELINE_ALLOW_NON_LOOPBACK=1``), which is a deliberate, documented
    trade-off that exposes the app to the LAN with no auth.
    """
    if not is_loopback_host(host) and not allow_non_loopback:
        raise BindGuardError(
            f"Refusing to start: bind host {host!r} is not loopback-only "
            "(timeline has no auth; set TIMELINE_HOST to 127.0.0.1, or "
            "explicitly opt in to non-loopback binding with "
            "TIMELINE_ALLOW_NON_LOOPBACK=1)."
        )
