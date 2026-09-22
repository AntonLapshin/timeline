"""Runtime wiring: start the Telegram bot + reminder scheduler in the API process.

Issue #111 (M9-T1): both subsystems were built and tested as modules but never
started in production — the API lifespan only created tables and seeded, so the
bot never replied and no reminder ever fired at runtime. This module owns the
start/stop lifecycle, called from the ``app.main`` lifespan:

- When ``BOT_TOKEN`` is set, the lifespan starts the APScheduler reminder
  engine (persistent SQLite jobstore + drain + failed-requeue) and the Telegram
  inbound bot polling as background tasks. The outbound sender
  (``make_telegram_job_func``) is wired as the scheduler's delivery channel so
  due reminders become Telegram cards with Ack/Snooze/Delete buttons.
- When ``BOT_TOKEN`` is unset, nothing starts (one clear log line) and the app
  behaves exactly as before.

The component statuses exposed here power the ``/healthz`` ``components`` field
so the owner can self-diagnose from the browser (``scheduler: running|disabled``,
``telegram: configured|not_configured|error``).
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings
from .scheduler import build_scheduler, catch_up_missed, drain_schedule, requeue_failed
from .telegram_allowlist import startup_warning
from .telegram_inbound import build_telegram_inbound_application
from .telegram_outbound import make_telegram_job_func, telegram_reminder_job

logger = logging.getLogger(__name__)

#: Starts (and later tears down) the runtime components. Injectable so tests
#: can fake the Telegram polling without network I/O.
RuntimeStarter = Callable[
    [Settings, sessionmaker[Session]], Awaitable["RuntimeComponents"]
]


@dataclass
class RuntimeComponents:
    """The background components started by the API lifespan (issue #111).

    ``None`` means the component is not running (either not configured or it
    failed to start). ``telegram_error`` carries the failure reason when the
    Telegram stack could not start despite a configured token.
    """

    #: The APScheduler reminder engine (None when disabled / failed).
    scheduler: BackgroundScheduler | None = None
    #: The python-telegram-bot Application running inbound polling (or None).
    telegram_app: Any | None = None
    #: The picklable reminder job entrypoint used for every scheduled job
    #: (``telegram_reminder_job``); routes/CRUD reuse it when re-scheduling
    #: after event writes (issue #134).
    job_func: Callable[..., object] | None = None
    #: Human-readable failure when the Telegram/scheduler stack failed to start.
    telegram_error: str | None = None

    @property
    def scheduler_status(self) -> str:
        """``"running"`` when the reminder engine is running, else ``"disabled"``."""
        return "running" if self.scheduler is not None else "disabled"

    @property
    def telegram_status(self) -> str:
        """``"configured"`` / ``"not_configured"`` / ``"error"`` for /healthz."""
        if self.telegram_error is not None:
            return "error"
        return "configured" if self.telegram_app is not None else "not_configured"

    async def shutdown(self) -> None:
        """Stop polling and the scheduler (best-effort, safe to call twice).

        Order matters: stop pulling updates first, then stop/shutdown the PTB
        application, then the scheduler thread. Each step is guarded so one
        failure never prevents the rest of the teardown.
        """
        app = self.telegram_app
        if app is not None:
            updater = getattr(app, "updater", None)
            if updater is not None:
                with contextlib.suppress(Exception):
                    await updater.stop()
            with contextlib.suppress(Exception):
                await app.stop()
            with contextlib.suppress(Exception):
                await app.shutdown()
        if self.scheduler is not None:
            with contextlib.suppress(Exception):
                self.scheduler.shutdown(wait=False)


async def start_runtime(
    settings: Settings, session_factory: sessionmaker[Session]
) -> RuntimeComponents:
    """Start the Telegram bot + reminder scheduler when ``BOT_TOKEN`` is set.

    With no ``BOT_TOKEN`` the runtime is a no-op (one clear log line) and the
    app starts exactly as before. With a token, the inbound bot polling and the
    APScheduler reminder engine (drain + failed-requeue + outbound Telegram
    delivery) run as background tasks in this process. Any startup failure is
    logged (never silent) and leaves the API serving with the component marked
    ``error`` on /healthz instead of taking the whole app down. An empty or
    partially-invalid Telegram allowlist is warned about at startup (issue
    #112): the bot still starts but an empty allowlist processes nothing (fail
    closed).
    """
    if not settings.telegram_bot_token:
        logger.info("Telegram bot + reminder scheduler disabled (BOT_TOKEN not set).")
        return RuntimeComponents()
    warning = startup_warning(settings.telegram_allowlist)
    if warning is not None:
        logger.warning("%s", warning)
    application = None
    scheduler = None
    try:
        scheduler = build_scheduler(settings)
        application = build_telegram_inbound_application(
            settings,
            session_factory,
            scheduler=scheduler,
            job_func=telegram_reminder_job,
        )
        if application is None:  # pragma: no cover — guarded by the token check
            logger.info("Telegram bot + reminder scheduler disabled (no bot token).")
            return RuntimeComponents()
        await application.initialize()
        job_func = make_telegram_job_func(
            session_factory, application.bot, settings, scheduler=scheduler
        )
        added = drain_schedule(scheduler, session_factory, job_func=job_func)
        requeued = requeue_failed(scheduler, session_factory, job_func=job_func)
        caught_up = catch_up_missed(
            scheduler,
            session_factory,
            job_func=job_func,
            lookback_days=settings.catchup_lookback_days,
        )
        scheduler.start()
        await application.start()
        updater = getattr(application, "updater", None)
        if updater is not None:
            await updater.start_polling()
        logger.info(
            "Telegram bot polling + reminder scheduler started "
            "(%d reminder job(s) scheduled, %d missed caught up).",
            added + requeued,
            caught_up,
        )
        return RuntimeComponents(
            scheduler=scheduler, telegram_app=application, job_func=job_func
        )
    except Exception as exc:  # noqa: BLE001 — keep the API serving, log loudly
        logger.exception("Telegram bot / reminder scheduler failed to start: %s", exc)
        failed = RuntimeComponents(
            scheduler=scheduler, telegram_app=application, telegram_error=str(exc)
        )
        await failed.shutdown()
        return RuntimeComponents(telegram_error=str(exc) or type(exc).__name__)


def components_status(components: Any | None) -> dict[str, str]:
    """The /healthz ``components`` map for a (possibly absent) runtime.

    Before the lifespan ran (or when unconfigured) the components report as
    ``disabled`` / ``not_configured`` so the endpoint is always truthful.
    """
    if components is None:
        return {"scheduler": "disabled", "telegram": "not_configured"}
    return {
        "scheduler": components.scheduler_status,
        "telegram": components.telegram_status,
    }
