"""Tests for the pure LLM parse module (issue #70).

Covers the pure prompt-building, JSON-mode request construction, response
validation, and the orchestrator with an injected/mocked HTTP client (no real
network): prompt injection, JSON mode, multi-event, default/uncertain priority,
critical-financial guard, ``needs_clarification``, and the unavailable-key path.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import pytest

from app.config import Settings
from app.llm_parse import (
    ParseRequest,
    build_prompt,
    build_request,
    extract_model_payload,
    parse_events,
    validate_parse_response,
)

NOW = datetime(2026, 9, 15, 9, 0, tzinfo=UTC)
TZ = "Europe/Berlin"


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "llm_base_url": "https://gate.joingonka.ai/v1",
        "llm_model": "test-model",
        "llm_api_key": "test-key",
    }
    values.update(overrides)
    return Settings(**values)


class _FakeResponse:
    """A minimal fake HTTP response object."""

    def __init__(self, status_code: int = 200, data: object | None = None) -> None:
        self.status_code = status_code
        self._data = data

    def json(self) -> object:
        return self._data


class _FakeClient:
    """A fake HTTP client recording the last request."""

    def __init__(self, response: _FakeResponse) -> None:
        self.response = response
        self.last_url: str | None = None
        self.last_headers: dict[str, str] | None = None
        self.last_json: dict[str, object] | None = None

    def post(
        self, url: str, *, headers: dict[str, str], json: dict[str, object]
    ) -> _FakeResponse:
        self.last_url = url
        self.last_headers = headers
        self.last_json = json
        return self.response


# --- Prompt building --------------------------------------------------------


def test_build_prompt_injects_now_and_tz() -> None:
    """The user prompt embeds the current time and timezone."""
    system, user = build_prompt("dentist tomorrow 9am", NOW, TZ)
    assert "calendar assistant" in system
    assert NOW.isoformat() in user
    assert TZ in user
    assert "dentist tomorrow 9am" in user


def test_build_prompt_system_describes_json_schema() -> None:
    """The system prompt instructs JSON-mode output and the schema."""
    system, _ = build_prompt("x", NOW, TZ)
    assert "json_object" not in system  # JSON mode is a transport concern
    assert "needs_clarification" in system
    assert "start_at" in system


# --- Request construction ---------------------------------------------------


def test_build_request_uses_json_mode_and_model() -> None:
    """The request targets /chat/completions with JSON mode and the model."""
    req: ParseRequest = build_request("dentist tomorrow", NOW, TZ, _settings())
    assert req.url == "https://gate.joingonka.ai/v1/chat/completions"
    assert req.headers["Authorization"] == "Bearer test-key"
    assert req.headers["Content-Type"] == "application/json"
    assert req.json["model"] == "test-model"
    assert req.json["response_format"] == {"type": "json_object"}
    assert req.json["temperature"] == 0
    roles = [m["role"] for m in req.json["messages"]]
    assert roles == ["system", "user"]


def test_build_request_uses_custom_base_url() -> None:
    """A custom base URL is honored (trailing slash stripped)."""
    req = build_request("x", NOW, TZ, _settings(llm_base_url="https://llm.example/v1/"))
    assert req.url == "https://llm.example/v1/chat/completions"


def test_build_request_injects_now_tz_and_text() -> None:
    """The user message carries now/tz/text for relative-date resolution."""
    req = build_request("pay rent tomorrow", NOW, TZ, _settings())
    user_msg = req.json["messages"][1]["content"]
    assert NOW.isoformat() in user_msg
    assert TZ in user_msg
    assert "pay rent tomorrow" in user_msg


# --- Response validation ----------------------------------------------------


def test_validate_single_event() -> None:
    """A valid single-event response yields one draft."""
    outcome = validate_parse_response(
        {
            "events": [
                {
                    "title": "Dentist",
                    "start_at": "2026-09-16T09:00:00+02:00",
                    "tz": "Europe/Berlin",
                    "priority": "medium",
                }
            ]
        }
    )
    assert outcome.needs_clarification is False
    assert outcome.drafts is not None
    assert len(outcome.drafts) == 1
    assert outcome.drafts[0].title == "Dentist"
    assert outcome.drafts[0].priority == "medium"


def test_validate_multi_event() -> None:
    """A multi-event response yields multiple drafts."""
    outcome = validate_parse_response(
        {
            "events": [
                {"title": "A", "start_at": "2026-09-16T09:00:00+00:00"},
                {"title": "B", "start_at": "2026-09-17T10:00:00+00:00"},
            ]
        }
    )
    assert outcome.drafts is not None
    assert len(outcome.drafts) == 2


def test_validate_needs_clarification() -> None:
    """A clarification response is surfaced, not a draft."""
    outcome = validate_parse_response(
        {"needs_clarification": True, "message": "When is it?"}
    )
    assert outcome.needs_clarification is True
    assert outcome.clarification == "When is it?"


def test_validate_needs_clarification_default_message() -> None:
    """A clarification without a message gets a default."""
    outcome = validate_parse_response({"needs_clarification": True})
    assert outcome.needs_clarification is True
    assert outcome.clarification == "Need more details."


def test_validate_empty_events_is_clarification() -> None:
    """An empty events list is treated as needing clarification."""
    outcome = validate_parse_response({"events": []})
    assert outcome.needs_clarification is True


def test_validate_rejects_non_object() -> None:
    """A non-object response is a hard error."""
    with pytest.raises(ValueError):
        validate_parse_response([1, 2, 3])


def test_validate_rejects_invalid_priority() -> None:
    """An unknown priority is rejected."""
    with pytest.raises(ValueError):
        validate_parse_response(
            {"events": [{"title": "X", "priority": "urgent", "start_at": "2026-09-16"}]}
        )


def test_validate_rejects_missing_title_or_start() -> None:
    """Each event needs a title and a start_at."""
    with pytest.raises(ValueError):
        validate_parse_response({"events": [{"title": "X"}]})
    with pytest.raises(ValueError):
        validate_parse_response({"events": [{"start_at": "2026-09-16"}]})


def test_validate_keeps_optional_fields() -> None:
    """Optional fields (rrule, channels, tags, type) are preserved."""
    outcome = validate_parse_response(
        {
            "events": [
                {
                    "title": "Series",
                    "start_at": "2026-06-01T10:00:00+00:00",
                    "type": "recurrent",
                    "rrule": "FREQ=YEARLY",
                    "channels": ["telegram"],
                    "tags": ["health"],
                }
            ]
        }
    )
    draft = outcome.drafts[0]
    assert draft.type == "recurrent"
    assert draft.rrule == "FREQ=YEARLY"
    assert draft.channels == ["telegram"]
    assert draft.tags == ["health"]


# --- Orchestrator (injected/mocked HTTP client) -----------------------------


def test_parse_unavailable_without_key() -> None:
    """No API key ⇒ unavailable (matches the web 503 contract)."""
    client = _FakeClient(_FakeResponse())
    result = parse_events(
        "dentist tomorrow", NOW, TZ, _settings(llm_api_key=None), client
    )
    assert result.ok is False
    assert result.unavailable is True
    assert client.last_url is None  # no request was made


def test_parse_success_single_event() -> None:
    """A successful parse returns the validated draft."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]},
        )
    )
    result = parse_events("dentist tomorrow", NOW, TZ, _settings(), client)
    assert result.ok is True
    assert result.outcome is not None
    assert result.outcome.drafts[0].title == "Dentist"
    assert client.last_url.endswith("/chat/completions")
    assert client.last_json["response_format"] == {"type": "json_object"}


def test_parse_logs_only_redacted_reference(caplog: pytest.LogCaptureFixture) -> None:
    """A parse call never writes raw text or prompt bodies to logs."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]},
        )
    )
    with caplog.at_level(logging.INFO):
        result = parse_events("pay rent tomorrow 9am", NOW, TZ, _settings(), client)
    assert result.ok is True
    records = [r.getMessage() for r in caplog.records]
    # The log records exist but contain only a content-free reference.
    assert any("parse_events called" in r for r in records)
    assert "pay rent tomorrow" not in "\n".join(records)
    assert "9am" not in "\n".join(records)
    assert any("sha=" in r and "len=" in r for r in records)


def test_parse_success_multi_event() -> None:
    """A multi-event response returns multiple drafts."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {
                "events": [
                    {"title": "A", "start_at": "2026-09-16T09:00:00+00:00"},
                    {"title": "B", "start_at": "2026-09-17T10:00:00+00:00"},
                ]
            },
        )
    )
    result = parse_events("a then b", NOW, TZ, _settings(), client)
    assert result.ok is True
    assert len(result.outcome.drafts) == 2


def test_parse_needs_clarification() -> None:
    """When the model can't decide, a clarification is returned, not a draft."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {"needs_clarification": True, "message": "Which day?"},
        )
    )
    result = parse_events("sometime soon", NOW, TZ, _settings(), client)
    assert result.ok is True
    assert result.outcome.needs_clarification is True
    assert result.outcome.clarification == "Which day?"


def test_parse_http_error() -> None:
    """A non-200 response is a failure."""
    client = _FakeClient(_FakeResponse(500, {}))
    result = parse_events("x", NOW, TZ, _settings(), client, sleep=lambda _s: None)
    assert result.ok is False
    assert "HTTP 500" in result.error


def test_parse_http_error_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    """A non-200 LLM response is logged server-side with the status (issue #113)."""
    client = _FakeClient(_FakeResponse(502, {}))
    with caplog.at_level(logging.ERROR, logger="app.llm_parse"):
        result = parse_events(
            "dentist tomorrow", NOW, TZ, _settings(), client, sleep=lambda _s: None
        )
    assert result.ok is False
    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert any(r.levelno == logging.ERROR for r in caplog.records)
    assert "LLM parse failed" in messages
    assert "HTTP 502" in messages


def test_parse_transport_error_is_logged_without_secrets(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A transport failure is logged with the error — never the key or text."""

    class _RaisingClient:
        def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]):
            raise RuntimeError("connection refused")

    with caplog.at_level(logging.ERROR, logger="app.llm_parse"):
        result = parse_events(
            "dentist tomorrow 9am",
            NOW,
            TZ,
            _settings(),
            _RaisingClient(),
            sleep=lambda _s: None,
        )
    assert result.ok is False
    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "LLM parse failed" in messages
    assert "connection refused" in messages
    # No secrets and no raw user text in the logs.
    assert "test-key" not in messages
    assert "dentist tomorrow 9am" not in messages
    # The redacted reference is included for correlation with the info line.
    assert "sha=" in messages


def test_parse_invalid_response_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    """A malformed model response is logged with the validation error."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {
                "events": [
                    {"title": "X", "priority": "urgent", "start_at": "2026-09-16"}
                ]
            },
        )
    )
    with caplog.at_level(logging.ERROR, logger="app.llm_parse"):
        result = parse_events("x", NOW, TZ, _settings(), client)
    assert result.ok is False
    messages = "\n".join(r.getMessage() for r in caplog.records)
    assert "LLM parse failed" in messages
    assert "invalid" in messages


def test_parse_transport_error() -> None:
    """A transport exception is surfaced as a failure."""

    class _RaisingClient:
        def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]):
            raise RuntimeError("boom")

    result = parse_events(
        "x", NOW, TZ, _settings(), _RaisingClient(), sleep=lambda _s: None
    )
    assert result.ok is False
    assert "boom" in result.error


def test_parse_non_json_body() -> None:
    """A non-JSON body is a failure."""

    class _BadJsonResponse:
        status_code = 200

        def json(self):
            raise ValueError("not json")

    result = parse_events("x", NOW, TZ, _settings(), _FakeClient(_BadJsonResponse()))
    assert result.ok is False
    assert "non-JSON" in result.error


def test_parse_invalid_response_shape() -> None:
    """A malformed response (bad priority) is a failure, not a silent save."""
    client = _FakeClient(
        _FakeResponse(
            200,
            {
                "events": [
                    {"title": "X", "priority": "urgent", "start_at": "2026-09-16"}
                ]
            },
        )
    )
    result = parse_events("x", NOW, TZ, _settings(), client)
    assert result.ok is False
    assert "invalid" in result.error


# --- Retry with backoff (flaky gateway) -------------------------------------


class _SequenceClient:
    """A fake HTTP client replaying a scripted response/exception sequence."""

    def __init__(self, script: list) -> None:
        self._script = list(script)
        self.posts = 0

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]):
        self.posts += 1
        item = self._script.pop(0) if self._script else self._script[-1]
        if isinstance(item, Exception):
            raise item
        return item


def test_parse_retries_transient_5xx_then_succeeds() -> None:
    """Transient 5xx responses are retried with exponential backoff."""
    sleeps: list[float] = []
    client = _SequenceClient(
        [
            _FakeResponse(503, {}),
            _FakeResponse(502, {}),
            _FakeResponse(
                200,
                {
                    "events": [
                        {"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}
                    ]
                },
            ),
        ]
    )
    result = parse_events(
        "dentist tomorrow", NOW, TZ, _settings(), client, sleep=sleeps.append
    )
    assert result.ok is True
    assert result.outcome is not None
    assert result.outcome.drafts[0].title == "Dentist"
    assert client.posts == 3
    assert sleeps == [1.0, 2.0]


def test_parse_retries_transport_errors_then_succeeds() -> None:
    """Timeouts/connection errors are retried (the known flaky-gateway case)."""
    sleeps: list[float] = []
    client = _SequenceClient(
        [
            RuntimeError("The read operation timed out"),
            RuntimeError("The read operation timed out"),
            _FakeResponse(
                200,
                {
                    "events": [
                        {"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}
                    ]
                },
            ),
        ]
    )
    result = parse_events(
        "dentist tomorrow", NOW, TZ, _settings(), client, sleep=sleeps.append
    )
    assert result.ok is True
    assert client.posts == 3
    assert sleeps == [1.0, 2.0]


def test_parse_does_not_retry_auth_errors() -> None:
    """A 401 (bad key) fails immediately — retrying is pointless."""
    sleeps: list[float] = []
    client = _SequenceClient([_FakeResponse(401, {})])
    result = parse_events("x", NOW, TZ, _settings(), client, sleep=sleeps.append)
    assert result.ok is False
    assert "HTTP 401" in result.error
    assert client.posts == 1
    assert sleeps == []


def test_parse_gives_up_after_five_attempts() -> None:
    """A persistently failing gateway is tried 5 times, then reported."""
    sleeps: list[float] = []
    client = _SequenceClient([RuntimeError("The read operation timed out")] * 5)
    result = parse_events("x", NOW, TZ, _settings(), client, sleep=sleeps.append)
    assert result.ok is False
    assert "timed out" in result.error
    assert "after 5 attempts" in result.error
    assert client.posts == 5
    assert sleeps == [1.0, 2.0, 4.0, 8.0]


def test_parse_gives_up_after_five_attempts_on_5xx() -> None:
    """A persistently 503 gateway is tried 5 times, then reported."""
    sleeps: list[float] = []
    client = _SequenceClient([_FakeResponse(503, {})] * 5)
    result = parse_events("x", NOW, TZ, _settings(), client, sleep=sleeps.append)
    assert result.ok is False
    assert "HTTP 503" in result.error
    assert "after 5 attempts" in result.error
    assert client.posts == 5


# --- Priority / critical-financial guard (web-side contract parity) ---------


def test_default_priority_is_medium_when_uncertain() -> None:
    """A draft without a priority defaults to medium (uncertain)."""
    outcome = validate_parse_response(
        {"events": [{"title": "Lunch", "start_at": "2026-09-16T12:00:00+00:00"}]}
    )
    assert outcome.drafts[0].priority is None  # absent ⇒ web defaults to medium


def test_low_priority_on_maybe_series_idea() -> None:
    """A maybe/series/idea hint is preserved as low priority by the model."""
    outcome = validate_parse_response(
        {
            "events": [
                {
                    "title": "maybe gym",
                    "start_at": "2026-09-16T12:00:00+00:00",
                    "priority": "low",
                }
            ]
        }
    )
    assert outcome.drafts[0].priority == "low"


def test_critical_financial_never_silently_saved() -> None:
    """A financial event is returned as a draft, never auto-saved.

    The parse endpoint returns drafts only; persistence requires explicit
    confirmation (the web wizard). The draft preserves the critical priority so
    the confirm step can keep it.
    """
    outcome = validate_parse_response(
        {
            "events": [
                {
                    "title": "pay rent",
                    "start_at": "2026-10-01T00:00:00+00:00",
                    "priority": "critical",
                }
            ]
        }
    )
    assert outcome.drafts[0].priority == "critical"


# --- Chat-completions envelope unwrapping (smart-input fix) ------------------


def test_extract_model_payload_passes_through_inner_payload() -> None:
    """A body that already looks like the model payload is returned as-is."""
    inner = {"events": [{"title": "X", "start_at": "2026-09-16"}]}
    assert extract_model_payload(inner) == inner


def test_extract_model_payload_unwraps_json_string_content() -> None:
    """The real gateway envelope (choices[0].message.content as JSON) unwraps."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    envelope = {"choices": [{"message": {"content": json.dumps(inner)}}]}
    assert extract_model_payload(envelope) == inner


def test_extract_model_payload_unwraps_dict_content_and_fences() -> None:
    """Dict content and ```json fences are both tolerated."""
    inner = {"needs_clarification": True, "message": "Which day?"}
    assert (
        extract_model_payload({"choices": [{"message": {"content": inner}}]}) == inner
    )
    import json

    fenced_content = "```json\n" + json.dumps(inner) + "\n```"
    fenced = {"choices": [{"message": {"content": fenced_content}}]}
    assert extract_model_payload(fenced) == inner


def test_extract_model_payload_rejects_envelope_without_content() -> None:
    """An envelope with no usable content is a clean ValueError."""
    with pytest.raises(ValueError):
        extract_model_payload({"foo": "bar"})
    with pytest.raises(ValueError):
        extract_model_payload({"choices": []})


def test_parse_unwraps_real_gateway_envelope() -> None:
    """parse_events succeeds against a real OpenAI-style gateway body."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    envelope = {"choices": [{"message": {"content": json.dumps(inner)}}]}
    client = _FakeClient(_FakeResponse(200, envelope))
    result = parse_events("dentist tomorrow", NOW, TZ, _settings(), client)
    assert result.ok is True
    assert result.outcome is not None
    assert result.outcome.drafts is not None
    assert result.outcome.drafts[0].title == "Dentist"


# --- Lenient content decoding (voice-message "Extra data" fix) --------------


def test_extract_model_payload_tolerates_trailing_prose() -> None:
    """Trailing prose after the JSON no longer raises Extra-data (voice fix)."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    content = json.dumps(inner) + "\nHope that helps!"
    envelope = {"choices": [{"message": {"content": content}}]}
    assert extract_model_payload(envelope) == inner


def test_extract_model_payload_tolerates_leading_prose() -> None:
    """Leading prose before the JSON is skipped."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    content = "Here is your event: " + json.dumps(inner)
    envelope = {"choices": [{"message": {"content": content}}]}
    assert extract_model_payload(envelope) == inner


def test_extract_model_payload_prefers_nonempty_concatenated_object() -> None:
    """``{"events": []} {"events": [...]}`` (char-14 Extra data) keeps drafts."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    content = json.dumps({"events": []}) + " " + json.dumps(inner)
    envelope = {"choices": [{"message": {"content": content}}]}
    assert extract_model_payload(envelope) == inner


def test_extract_model_payload_empty_events_with_trailing_text() -> None:
    """Empty events plus trailing text parses (caller maps it to clarification)."""
    import json

    content = json.dumps({"events": []}) + " trailing prose"
    envelope = {"choices": [{"message": {"content": content}}]}
    assert extract_model_payload(envelope) == {"events": []}
    assert (
        validate_parse_response(extract_model_payload(envelope)).needs_clarification
        is True
    )


def test_extract_model_payload_supports_content_blocks_and_tool_calls() -> None:
    """List content blocks, tool_calls args and bare arrays all unwrap."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    blocks = {
        "choices": [
            {"message": {"content": [{"type": "text", "text": json.dumps(inner)}]}}
        ]
    }
    assert extract_model_payload(blocks) == inner
    tool = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [{"function": {"arguments": json.dumps(inner)}}],
                }
            }
        ]
    }
    assert extract_model_payload(tool) == inner
    bare = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        [{"title": "A", "start_at": "2026-09-16T09:00:00+00:00"}]
                    )
                }
            }
        ]
    }
    assert extract_model_payload(bare) == {
        "events": [{"title": "A", "start_at": "2026-09-16T09:00:00+00:00"}]
    }


def test_extract_model_payload_still_rejects_pure_prose() -> None:
    """Prose with no JSON inside is still a clean ValueError."""
    with pytest.raises(ValueError, match="non-JSON"):
        extract_model_payload(
            {"choices": [{"message": {"content": "just some chatter, no json"}}]}
        )


def test_parse_trailing_prose_envelope_succeeds() -> None:
    """parse_events succeeds when the model appends prose after the JSON."""
    import json

    inner = {"events": [{"title": "Dentist", "start_at": "2026-09-16T09:00:00+02:00"}]}
    envelope = {"choices": [{"message": {"content": json.dumps(inner) + "\nDone!"}}]}
    client = _FakeClient(_FakeResponse(200, envelope))
    result = parse_events("dentist tomorrow", NOW, TZ, _settings(), client)
    assert result.ok is True
    assert result.outcome is not None
    assert result.outcome.drafts is not None
    assert result.outcome.drafts[0].title == "Dentist"
