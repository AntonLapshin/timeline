"""LLM event parsing via a thin direct JoinGonka OpenAI-compatible fetch (issue #70).

Turns free text into structured event draft(s) with a JSON-mode chat-completion
call. The pure logic lives here and is unit-tested with an injected/mocked HTTP
client (no real network):

- ``build_prompt`` — pure prompt construction (system + user), injecting the
  caller's ``now`` and ``tz`` so the model resolves relative dates correctly.
- ``build_request`` — pure JSON-mode request construction (URL, headers, body).
- ``validate_parse_response`` — pure validation of the model's JSON response
  into validated ``ParsedDraft``(s) or a ``needs_clarification`` request.
- ``parse_events`` — orchestrator that returns ``unavailable`` when the LLM key
  is absent, otherwise POSTs via the injected HTTP client and validates, with
  up to 5 attempts (exponential backoff) on transport failures and retryable
  statuses. Every failure path is logged server-side (``logger.error`` with
  the underlying error/status, issue #113) — never the raw text (only a
  redacted reference) and never any secret.

No real network happens in this module's own tests; the HTTP client is injected
so callers (and tests) supply a fake.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field, ValidationError

from .config import Settings
from .redaction import redact_text

logger = logging.getLogger(__name__)

#: The OpenAI-compatible chat completions path appended to the base URL.
_CHAT_COMPLETIONS_PATH = "/chat/completions"

#: Maximum POST attempts per parse call (1 initial try + up to 4 retries).
#: The JoinGonka gateway is known to be flaky (slow reads, transient 5xx),
#: so transport failures and retryable statuses are retried with backoff.
_MAX_ATTEMPTS = 5

#: HTTP statuses worth retrying: rate-limit / transient gateway failures.
#: Other 4xx (401 bad key, 403, 404 bad model, 405, …) fail immediately —
#: retrying them is pointless.
_RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})

#: Base delay (seconds) for exponential backoff between attempts: the wait
#: after failed attempt N is ``_RETRY_BASE_DELAY_SEC * 2**(N-1)``
#: (1s, 2s, 4s, 8s for the default 5 attempts).
_RETRY_BASE_DELAY_SEC = 1.0

#: System prompt describing the extraction task and output schema.
_SYSTEM_PROMPT = (
    "You are a calendar assistant. Extract one or more events from the user's "
    "free text and return them as JSON. Resolve relative dates/times against "
    "the supplied current date/time and timezone. Return a JSON object with "
    "exactly one of these shapes:\n"
    '1. {"events": [ {event}, ... ]} when the text describes one or more events.\n'
    '2. {"needs_clarification": true, "message": "<what is missing>"} when the '
    "text is too vague to determine an event.\n"
    'Each {event} has: "title" (string, required), "start_at" (ISO 8601 with '
    'offset, required), "all_day" (bool, default false), "tz" (IANA timezone, '
    'default the supplied tz), "rrule" (RFC 5545 recurrence rule or null for '
    'one-time), "priority" ("critical"|"medium"|"low"), "type" '
    '("one_time"|"recurrent"), "channels" (array of "telegram"|"email"), '
    '"reminder_offsets" (array of reminder offsets like "15m", "1h", "1d" — '
    'extract from phrases like "remind me 15 minutes before", "notify me '
    '1 hour in advance", "1 day before"; omit when the text asks for no '
    'reminder), and "tags" (array of strings). Only include fields you are '
    "confident about; omit uncertain optional fields. Never invent a critical "
    "financial event without a clear signal.\n"
)


# ---------------------------------------------------------------------------
# Pure prompt building
# ---------------------------------------------------------------------------


def build_prompt(text: str, now: datetime, tz: str) -> tuple[str, str]:
    """Build the (system, user) prompt pair for a parse request.

    Pure: no I/O, no side effects. ``now`` is injected so the model can resolve
    relative dates ("tomorrow", "next monday"); ``tz`` tells it what timezone
    the user is in.
    """
    user_prompt = (
        f"Current date/time: {now.isoformat()}\nTimezone: {tz}\nUser text: {text}\n"
    )
    return _SYSTEM_PROMPT, user_prompt


# ---------------------------------------------------------------------------
# Pure JSON-mode request construction
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParseRequest:
    """The fully-constructed HTTP request for a parse call."""

    url: str
    headers: dict[str, str]
    json: dict[str, Any]


def build_request(
    text: str, now: datetime, tz: str, settings: Settings
) -> ParseRequest:
    """Build the JSON-mode chat-completion request (pure).

    Requires an API key; callers should check ``settings.llm_api_key`` first and
    return ``unavailable`` when it is absent.
    """
    system, user = build_prompt(text, now, tz)
    base = settings.llm_base_url.rstrip("/")
    json_body: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }
    return ParseRequest(
        url=f"{base}{_CHAT_COMPLETIONS_PATH}",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.llm_api_key}",
        },
        json=json_body,
    )


# ---------------------------------------------------------------------------
# Pure response validation
# ---------------------------------------------------------------------------


class ParsedDraft(BaseModel):
    """A validated event draft, mirroring the web ``ParsedDraft`` contract."""

    title: str
    priority: str | None = Field(default=None, pattern="^(critical|medium|low)$")
    type: str | None = Field(default=None, pattern="^(one_time|recurrent)$")
    start_at: str | None = None
    all_day: bool | None = None
    tz: str | None = None
    rrule: str | None = None
    channels: list[str] | None = None
    reminder_offsets: list[str] | None = None
    tags: list[str] | None = None


class ParseResponse(BaseModel):
    """The validated outcome of a parse call.

    Exactly one of ``events`` or ``needs_clarification`` is populated.
    """

    events: list[ParsedDraft] | None = None
    needs_clarification: bool | None = None
    message: str | None = None


@dataclass(frozen=True)
class ParseOutcome:
    """A successful parse outcome: drafts or a clarification request."""

    drafts: list[ParsedDraft] | None = None
    clarification: str | None = None

    @property
    def needs_clarification(self) -> bool:
        return self.clarification is not None


def _retry_delay_sec(failed_attempt: int) -> float:
    """Exponential-backoff delay after failed attempt N (1-based)."""
    return _RETRY_BASE_DELAY_SEC * (2.0 ** (failed_attempt - 1))


def _is_retryable_status(status_code: Any) -> bool:
    """Whether an HTTP status is worth retrying (rate-limit / transient 5xx)."""
    return status_code in _RETRYABLE_STATUS_CODES


def _strip_code_fences(content: str) -> str:
    """Strip Markdown code fences the model sometimes adds around JSON."""
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop the opening fence (``` or ```json).
        lines = lines[1:]
        # Drop the closing fence when present.
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


#: Matches an explicit lead-time phrase like "15 minutes before", "1 hour in
#: advance", "notify me 2h before", "remind me 1 day ahead" (pure fallback so a
#: "notify me 15 minutes in advance" voice request keeps its reminder even when
#: the model omits ``reminder_offsets``).
_REMINDER_PHRASE_RE = re.compile(
    r"(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)"
    r"\s*(?:in\s+advance|before|ahead|early|prior)",
    re.IGNORECASE,
)

#: Normalizes a time-unit word to the shared-schema offset suffix.
_REMINDER_UNIT_SUFFIX = {
    "m": "m",
    "min": "m",
    "mins": "m",
    "minute": "m",
    "minutes": "m",
    "h": "h",
    "hr": "h",
    "hrs": "h",
    "hour": "h",
    "hours": "h",
    "d": "d",
    "day": "d",
    "days": "d",
    "w": "w",
    "week": "w",
    "weeks": "w",
}


def normalize_reminder_offset(value: str) -> str | None:
    """Normalize a raw offset to shared-schema form (``"15m"``, ``"1h"`` …).

    Returns ``None`` when the value is not a valid ``<amount><d|h|m|w>``
    offset (amount must be positive). Accepts verbose forms (``"15 min"``,
    ``"15 minutes"``, ``"1 hour"``) as well as the compact form.
    """
    match = re.fullmatch(
        r"\s*(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\s*",
        value.strip(),
        re.IGNORECASE,
    )
    if match is None:
        return None
    amount = int(match.group(1))
    if amount <= 0:
        return None
    suffix = _REMINDER_UNIT_SUFFIX.get(match.group(2).lower())
    if suffix is None:  # pragma: no cover — regex constrains the group
        return None
    return f"{amount}{suffix}"


def extract_reminder_offsets_from_text(text: str) -> list[str]:
    """Extract reminder offsets from explicit lead-time phrases (pure).

    Scans free text for ``"<N> <unit> (in advance|before|ahead|early|prior)"``
    phrases (e.g. *"notify me via telegram 15 minutes in advance"*) and returns
    the normalized offsets (``["15m"]``), deduplicated in first-seen order.
    Returns ``[]`` when the text names no lead time — the caller keeps whatever
    the model produced (possibly no reminder at all).
    """
    seen: list[str] = []
    for match in _REMINDER_PHRASE_RE.finditer(text or ""):
        normalized = normalize_reminder_offset(f"{match.group(1)} {match.group(2)}")
        if normalized is not None and normalized not in seen:
            seen.append(normalized)
    return seen


def _looks_like_payload(obj: Any) -> bool:
    """Whether a decoded JSON value looks like the model payload."""
    return isinstance(obj, dict) and (
        "events" in obj or "needs_clarification" in obj or "title" in obj
    )


def _iter_json_values(text: str) -> list[Any]:
    """Collect every top-level JSON value embedded in ``text``.

    The model sometimes wraps the payload in prose
    (``"Here you go: {...} hope that helps"``), appends an explanation
    after it, or concatenates two JSON objects (``{"events": []} {...}`` —
    the reported voice-message failure: ``Extra data: line 1 column 15
    (char 14)``). ``json.loads`` rejects all of these, so scan for ``{`` /
    ``[`` openers and ``raw_decode`` each candidate, skipping undecodable
    braces (e.g. prose with ``{not json}``).
    """
    decoder = json.JSONDecoder()
    values: list[Any] = []
    idx = 0
    end = len(text)
    while idx < end:
        nxt = min(
            (pos for pos in (text.find("{", idx), text.find("[", idx)) if pos != -1),
            default=-1,
        )
        if nxt == -1:
            break
        try:
            value, next_idx = decoder.raw_decode(text, nxt)
        except json.JSONDecodeError:
            idx = nxt + 1
            continue
        values.append(value)
        idx = next_idx if next_idx > nxt else nxt + 1
    return values


def _pick_payload(candidates: list[Any]) -> Any | None:
    """Pick the best payload-like candidate (or None when there is none)."""
    payloads = [c for c in candidates if _looks_like_payload(c)]
    if not payloads:
        # A bare array of event objects (no {"events": ...} wrapper).
        for candidate in candidates:
            if (
                isinstance(candidate, list)
                and candidate
                and all(isinstance(item, dict) for item in candidate)
            ):
                return {"events": candidate}
        return None
    # Prefer a non-empty events list over an empty one (e.g. the reported
    # ``{"events": []} {"events": [...]}`` concatenation), then a
    # clarification, then anything payload-like.
    for candidate in payloads:
        events = candidate.get("events") if isinstance(candidate, dict) else None
        if isinstance(events, list) and len(events) > 0:
            return candidate
    for candidate in payloads:
        if isinstance(candidate, dict) and candidate.get("needs_clarification"):
            return candidate
    return payloads[0]


def _decode_model_text(text: str) -> Any:
    """JSON-decode model ``content`` text, tolerating surrounding prose.

    Fast path is a strict ``json.loads`` (the common gateway case). On
    failure, fall back to extracting embedded JSON value(s) so trailing
    explanations or concatenated objects still parse instead of surfacing
    ``LLM returned non-JSON content: Extra data ...`` to the Telegram user.
    Raises ``ValueError`` when nothing payload-like is found.
    """
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    else:
        if _looks_like_payload(parsed):
            return parsed
        if isinstance(parsed, list):
            wrapped = _pick_payload([parsed])
            if wrapped is not None:
                return wrapped
        # A valid JSON scalar (e.g. `true`, `123`) is never a payload —
        # fall through to the embedded scan which may find the real object.
    candidates = _iter_json_values(text)
    picked = _pick_payload(candidates)
    if picked is not None:
        return picked
    if candidates:
        return candidates[0]
    raise ValueError(f"LLM returned non-JSON content: {text[:120]!r}")


def _content_to_text(content: Any) -> str | None:
    """Normalize a chat message ``content`` to text (or None when unusable).

    Most gateways send a plain string, but some send a list of content
    blocks (``[{"type": "text", "text": "{...}"}, ...]``). Join the text
    parts so the JSON extractor below still works.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                for key in ("text", "content"):
                    value = block.get(key)
                    if isinstance(value, str):
                        parts.append(value)
                        break
        return "".join(parts) or None
    return None


def _tool_call_arguments(message: dict[str, Any]) -> Any | None:
    """Return the first tool-call ``arguments`` payload, if the gateway used it."""
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        first = tool_calls[0]
        func: Any = first.get("function", {}) if isinstance(first, dict) else {}
        args: Any = func.get("arguments") if isinstance(func, dict) else None
        return args
    return None


def extract_model_payload(data: Any) -> Any:
    """Unwrap an OpenAI-compatible chat-completions body into the model payload.

    The gateway returns ``{"choices": [{"message": {"content": "<json>"}}]}``
    where ``content`` is a JSON string (or, rarely, an already-decoded dict)
    holding ``{"events": [...]}`` / ``{"needs_clarification": ...}``. This
    extracts and JSON-decodes that inner payload (pure).

    For testability, a body that already looks like the inner payload
    (has ``events`` / ``needs_clarification`` / ``title`` keys) is returned
    as-is. Anything else raises ``ValueError``.
    """
    if isinstance(data, dict):
        if "events" in data or "needs_clarification" in data or "title" in data:
            return data
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            message: Any = first.get("message", {}) if isinstance(first, dict) else {}
            if not isinstance(message, dict):
                raise ValueError("LLM response has no usable message content")
            content: Any = message.get("content")
            if isinstance(content, dict):
                return content
            text = _content_to_text(content)
            if text is not None:
                text = _strip_code_fences(text)
                if not text:
                    raise ValueError("LLM returned an empty message content")
                try:
                    return _decode_model_text(text)
                except ValueError as exc:
                    raise ValueError(str(exc)) from exc
            # Some gateways put JSON-mode output in tool_calls instead of
            # content (function.arguments as a JSON string or dict).
            args = _tool_call_arguments(message)
            if isinstance(args, dict):
                return args
            if isinstance(args, str) and _strip_code_fences(args):
                try:
                    return _decode_model_text(_strip_code_fences(args))
                except ValueError as exc:
                    raise ValueError(str(exc)) from exc
    raise ValueError("LLM response has no usable message content")


def validate_parse_response(data: Any) -> ParseOutcome:
    """Validate a model's JSON response into a ``ParseOutcome`` (pure).

    Raises ``ValueError`` when the response is not valid JSON-moded output that
    matches the expected schema (a malformed response is a hard error).
    """
    if not isinstance(data, dict):
        raise ValueError("parse response must be a JSON object")

    try:
        parsed = ParseResponse.model_validate(data)
    except ValidationError as exc:
        raise ValueError(f"invalid parse response: {exc}") from exc

    if parsed.needs_clarification:
        return ParseOutcome(clarification=parsed.message or "Need more details.")

    events = parsed.events or []
    if not events:
        return ParseOutcome(clarification="Need more details.")

    drafts: list[ParsedDraft] = []
    for event in events:
        # A draft needs at least a title and a start time to be usable.
        title = (event.title or "").strip()
        if not title or not event.start_at:
            raise ValueError("each parsed event needs a title and start_at")
        drafts.append(event)
    return ParseOutcome(drafts=drafts)


def _backfill_reminder_offsets(outcome: ParseOutcome, text: str) -> ParseOutcome:
    """Fill missing ``reminder_offsets`` from explicit lead-time phrases (pure).

    The model sometimes drops ``reminder_offsets`` even when the user names a
    lead time (*"notify me 15 minutes in advance"*). When a draft carries no
    usable offset, fall back to the regex extraction over the raw text so the
    reminder survives; drafts that already have normalized offsets are left
    untouched.
    """
    if outcome.needs_clarification or not outcome.drafts:
        return outcome
    fallback = extract_reminder_offsets_from_text(text)
    if not fallback:
        return outcome
    drafts: list[ParsedDraft] = []
    changed = False
    for draft in outcome.drafts:
        offsets = draft.reminder_offsets or []
        usable = [n for n in (normalize_reminder_offset(o) for o in offsets) if n]
        if usable:
            if usable != (draft.reminder_offsets or []):
                drafts.append(draft.model_copy(update={"reminder_offsets": usable}))
                changed = True
            else:
                drafts.append(draft)
        else:
            drafts.append(draft.model_copy(update={"reminder_offsets": list(fallback)}))
            changed = True
    if not changed:
        return outcome
    return ParseOutcome(drafts=drafts, clarification=outcome.clarification)


# ---------------------------------------------------------------------------
# HTTP client protocol + orchestrator
# ---------------------------------------------------------------------------


class HttpClient(Protocol):
    """The subset of an HTTP client ``parse_events`` needs (duck-typed)."""

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> Any:
        """POST JSON and return a response object with ``status_code``/``json``."""
        ...


@dataclass(frozen=True)
class ParseResult:
    """The result of a parse call, mirroring the web ``ParseResult`` contract."""

    ok: bool
    outcome: ParseOutcome | None = None
    error: str | None = None
    unavailable: bool = False


def parse_events(
    text: str,
    now: datetime,
    tz: str,
    settings: Settings,
    http_client: HttpClient,
    max_attempts: int = _MAX_ATTEMPTS,
    sleep: Callable[[float], None] = time.sleep,
) -> ParseResult:
    """Parse free text into validated event draft(s).

    Returns ``ParseResult(unavailable=True)`` when the LLM API key is absent
    (matching the web ``LlmParser`` contract where a 503 means unavailable).
    Otherwise builds the JSON-mode request and POSTs it via the injected
    ``http_client`` (no real network in tests), then validates the response.

    The gateway is flaky, so transport failures (timeouts, connection errors)
    and retryable statuses (429 / transient 5xx) are retried up to
    ``max_attempts`` times with exponential backoff (1s, 2s, 4s, 8s). Other
    4xx statuses (bad key/model) fail immediately. Every failure is logged
    server-side (``logger.error`` with the underlying error/status — never
    the raw text, prompt, or any secret) so the owner can diagnose bad
    keys/models/gate outages from the API logs (issue #113).
    """
    if not settings.llm_api_key:
        return ParseResult(ok=False, unavailable=True, error="LLM key not configured")

    # Log only a content-free reference — never the raw text or prompt body.
    logger.info("parse_events called ref=%s", redact_text(text))

    request = build_request(text, now, tz, settings)
    attempts = max(1, max_attempts)
    last_error = "unknown error"
    made = 0
    for attempt in range(1, attempts + 1):
        made = attempt
        try:
            response = http_client.post(
                request.url, headers=request.headers, json=request.json
            )
        except Exception as exc:  # noqa: BLE001 — surface any transport error
            last_error = f"LLM request failed: {exc}"
            if attempt < attempts:
                logger.warning(
                    "LLM parse attempt %d/%d failed ref=%s: %s — retrying",
                    attempt,
                    attempts,
                    redact_text(text),
                    last_error,
                )
                sleep(_retry_delay_sec(attempt))
                continue
            break

        status_code = getattr(response, "status_code", None)
        if status_code != 200:
            last_error = f"LLM request failed (HTTP {status_code})"
            if _is_retryable_status(status_code) and attempt < attempts:
                logger.warning(
                    "LLM parse attempt %d/%d failed ref=%s: %s — retrying",
                    attempt,
                    attempts,
                    redact_text(text),
                    last_error,
                )
                sleep(_retry_delay_sec(attempt))
                continue
            break

        try:
            data = response.json()
        except Exception as exc:  # noqa: BLE001 — non-JSON body
            error = f"LLM returned non-JSON: {exc}"
            logger.error("LLM parse failed ref=%s: %s", redact_text(text), error)
            return ParseResult(ok=False, error=error)

        try:
            outcome = validate_parse_response(extract_model_payload(data))
        except ValueError as exc:
            logger.error("LLM parse failed ref=%s: %s", redact_text(text), exc)
            return ParseResult(ok=False, error=str(exc))

        return ParseResult(ok=True, outcome=_backfill_reminder_offsets(outcome, text))

    if made > 1:
        last_error = f"{last_error} (after {made} attempts)"
    logger.error("LLM parse failed ref=%s: %s", redact_text(text), last_error)
    return ParseResult(ok=False, error=last_error)
