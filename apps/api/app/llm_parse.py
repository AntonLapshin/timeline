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
  is absent, otherwise POSTs via the injected HTTP client and validates.

No real network happens in this module's own tests; the HTTP client is injected
so callers (and tests) supply a fake.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field, ValidationError

from .config import Settings

#: The OpenAI-compatible chat completions path appended to the base URL.
_CHAT_COMPLETIONS_PATH = "/chat/completions"

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
    '("one_time"|"recurrent"), "channels" (array of "telegram"|"email"), and '
    '"tags" (array of strings). Only include fields you are confident about; '
    "omit uncertain optional fields. Never invent a critical financial event "
    "without a clear signal.\n"
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
) -> ParseResult:
    """Parse free text into validated event draft(s).

    Returns ``ParseResult(unavailable=True)`` when the LLM API key is absent
    (matching the web ``LlmParser`` contract where a 503 means unavailable).
    Otherwise builds the JSON-mode request and POSTs it via the injected
    ``http_client`` (no real network in tests), then validates the response.
    """
    if not settings.llm_api_key:
        return ParseResult(ok=False, unavailable=True, error="LLM key not configured")

    request = build_request(text, now, tz, settings)
    try:
        response = http_client.post(
            request.url, headers=request.headers, json=request.json
        )
    except Exception as exc:  # noqa: BLE001 — surface any transport error
        return ParseResult(ok=False, error=f"LLM request failed: {exc}")

    if getattr(response, "status_code", None) != 200:
        return ParseResult(
            ok=False, error=f"LLM request failed (HTTP {response.status_code})"
        )

    try:
        data = response.json()
    except Exception as exc:  # noqa: BLE001 — non-JSON body
        return ParseResult(ok=False, error=f"LLM returned non-JSON: {exc}")

    try:
        outcome = validate_parse_response(data)
    except ValueError as exc:
        return ParseResult(ok=False, error=str(exc))

    return ParseResult(ok=True, outcome=outcome)
