"""Committed eval set for the ``POST /api/events/parse`` pipeline (issue #76).

Each sample is a free-text input plus the expected structured draft fields
(title, start_at, rrule, priority, type, channels, tags, needs_clarification).
The eval runner (``tests/eval/test_eval_parse.py``) feeds each input through
the pure ``llm_parse.parse_events`` with an injected fake LLM client that
returns the recorded ``mock_response`` — so the harness verifies the full
parse pipeline (prompt building → request → validation) against expected
outputs with no live network.

Coverage of acceptance criteria:
- one-time future events
- recurrent daily/weekly/monthly/quarterly/yearly
- "next June" (relative future-date resolution)
- maybe/series/idea → low priority
- ambiguous → medium default
- needs_clarification
- multi-event in one message
- tz / relative-date resolution
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EvalCase:
    """A single eval sample: input text + expected draft fields."""

    #: The free-text the user sends (the ``text`` argument to parse_events).
    text: str
    #: The timezone the user is in (injected into the prompt).
    tz: str = "Europe/Berlin"
    #: The mock LLM JSON response the fake client returns (simulates the model).
    mock_response: dict[str, Any] = field(default_factory=dict)
    #: Expected parsed draft fields. ``None`` fields are not asserted.
    expect_title: str | None = None
    expect_start_at: str | None = None
    expect_rrule: str | None = None
    expect_priority: str | None = None
    expect_type: str | None = None
    expect_channels: list[str] | None = None
    expect_tags: list[str] | None = None
    #: When True, the sample should produce a needs_clarification outcome.
    expect_clarification: bool = False
    #: Expected number of drafts (default 1).
    expect_draft_count: int = 1


#: The reference time injected into every eval call (fixed for determinism).
EVAL_NOW_ISO = "2026-09-15T09:00:00+00:00"

EVAL_CASES: list[EvalCase] = [
    # --- one-time future events -------------------------------------------
    EvalCase(
        text="Dentist appointment tomorrow at 9am",
        mock_response={
            "events": [
                {
                    "title": "Dentist appointment",
                    "start_at": "2026-09-16T09:00:00+02:00",
                    "tz": "Europe/Berlin",
                    "priority": "medium",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Dentist appointment",
        expect_start_at="2026-09-16T09:00:00+02:00",
        expect_priority="medium",
        expect_type="one_time",
    ),
    EvalCase(
        text="Brush teeth every morning at 7am",
        mock_response={
            "events": [
                {
                    "title": "Brush teeth",
                    "start_at": "2026-09-16T07:00:00+02:00",
                    "priority": "low",
                    "type": "recurrent",
                    "rrule": "FREQ=DAILY",
                }
            ]
        },
        expect_title="Brush teeth",
        expect_rrule="FREQ=DAILY",
        expect_type="recurrent",
    ),
    EvalCase(
        text="Weekly team sync every Monday at 9am",
        mock_response={
            "events": [
                {
                    "title": "Weekly team sync",
                    "start_at": "2026-09-21T09:00:00+02:00",
                    "priority": "medium",
                    "type": "recurrent",
                    "rrule": "FREQ=WEEKLY;BYDAY=MO",
                }
            ]
        },
        expect_title="Weekly team sync",
        expect_rrule="FREQ=WEEKLY;BYDAY=MO",
        expect_type="recurrent",
    ),
    EvalCase(
        text="Pay rent on the 1st of every month",
        mock_response={
            "events": [
                {
                    "title": "Pay rent",
                    "start_at": "2026-10-01T00:00:00+02:00",
                    "priority": "critical",
                    "type": "recurrent",
                    "rrule": "FREQ=MONTHLY;BYMONTHDAY=1",
                }
            ]
        },
        expect_title="Pay rent",
        expect_rrule="FREQ=MONTHLY;BYMONTHDAY=1",
        expect_type="recurrent",
        expect_priority="critical",
    ),
    EvalCase(
        text="Quarterly tax filing every 3 months",
        mock_response={
            "events": [
                {
                    "title": "Quarterly tax filing",
                    "start_at": "2026-12-01T09:00:00+01:00",
                    "priority": "critical",
                    "type": "recurrent",
                    "rrule": "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1",
                }
            ]
        },
        expect_title="Quarterly tax filing",
        expect_rrule="FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1",
        expect_type="recurrent",
    ),
    EvalCase(
        text="Annual review with manager every January",
        mock_response={
            "events": [
                {
                    "title": "Annual review",
                    "start_at": "2027-01-15T10:00:00+01:00",
                    "priority": "medium",
                    "type": "recurrent",
                    "rrule": "FREQ=YEARLY;BYMONTH=1",
                }
            ]
        },
        expect_title="Annual review",
        expect_rrule="FREQ=YEARLY;BYMONTH=1",
        expect_type="recurrent",
    ),
    # --- "next June" (relative future-date resolution) ---------------------
    EvalCase(
        text="Vacation next June for two weeks",
        mock_response={
            "events": [
                {
                    "title": "Vacation",
                    "start_at": "2027-06-01T00:00:00+02:00",
                    "priority": "low",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Vacation",
        expect_start_at="2027-06-01T00:00:00+02:00",
        expect_priority="low",
    ),
    # --- maybe/series/idea → low priority ----------------------------------
    EvalCase(
        text="Maybe go to the gym sometime this month",
        mock_response={
            "events": [
                {
                    "title": "Maybe gym",
                    "start_at": "2026-09-20T18:00:00+02:00",
                    "priority": "low",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Maybe gym",
        expect_priority="low",
    ),
    EvalCase(
        text="Series idea: learn to paint this winter",
        mock_response={
            "events": [
                {
                    "title": "Learn to paint",
                    "start_at": "2026-12-01T10:00:00+01:00",
                    "priority": "low",
                    "type": "recurrent",
                    "rrule": "FREQ=WEEKLY;BYDAY=SA",
                }
            ]
        },
        expect_title="Learn to paint",
        expect_priority="low",
        expect_type="recurrent",
    ),
    # --- ambiguous → medium default ----------------------------------------
    EvalCase(
        text="Lunch with a friend sometime",
        mock_response={
            "events": [
                {
                    "title": "Lunch with a friend",
                    "start_at": "2026-09-16T12:00:00+02:00",
                    "priority": "medium",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Lunch with a friend",
        expect_priority="medium",
    ),
    EvalCase(
        text="Call the bank about the card",
        mock_response={
            "events": [
                {
                    "title": "Call the bank",
                    "start_at": "2026-09-16T14:00:00+02:00",
                    "priority": "medium",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Call the bank",
        expect_priority="medium",
    ),
    # --- needs_clarification -----------------------------------------------
    EvalCase(
        text="Remind me about something",
        mock_response={
            "needs_clarification": True,
            "message": "What event and when?",
        },
        expect_title=None,
        expect_clarification=True,
    ),
    EvalCase(
        text="Sometime later",
        mock_response={"needs_clarification": True, "message": "When exactly?"},
        expect_title=None,
        expect_clarification=True,
    ),
    # --- multi-event in one message ----------------------------------------
    EvalCase(
        text="Dentist at 9am and gym at 6pm tomorrow",
        mock_response={
            "events": [
                {
                    "title": "Dentist",
                    "start_at": "2026-09-16T09:00:00+02:00",
                    "priority": "medium",
                    "type": "one_time",
                },
                {
                    "title": "Gym",
                    "start_at": "2026-09-16T18:00:00+02:00",
                    "priority": "low",
                    "type": "one_time",
                },
            ]
        },
        expect_title="Dentist",
        expect_draft_count=2,
    ),
    # --- tz / relative-date resolution -------------------------------------
    EvalCase(
        text="Meeting with the client tomorrow at 3pm",
        tz="America/New_York",
        mock_response={
            "events": [
                {
                    "title": "Meeting with the client",
                    "start_at": "2026-09-16T15:00:00-04:00",
                    "tz": "America/New_York",
                    "priority": "critical",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Meeting with the client",
        expect_start_at="2026-09-16T15:00:00-04:00",
        expect_priority="critical",
    ),
    EvalCase(
        text="Call mom next Sunday at noon",
        tz="Asia/Tokyo",
        mock_response={
            "events": [
                {
                    "title": "Call mom",
                    "start_at": "2026-09-20T12:00:00+09:00",
                    "tz": "Asia/Tokyo",
                    "priority": "medium",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Call mom",
        expect_start_at="2026-09-20T12:00:00+09:00",
    ),
    # --- channels / tags ----------------------------------------------------
    EvalCase(
        text="Remind me on telegram about the flight next week",
        mock_response={
            "events": [
                {
                    "title": "Flight",
                    "start_at": "2026-09-22T08:00:00+02:00",
                    "priority": "critical",
                    "type": "one_time",
                    "channels": ["telegram"],
                    "tags": ["travel"],
                }
            ]
        },
        expect_title="Flight",
        expect_channels=["telegram"],
        expect_tags=["travel"],
        expect_priority="critical",
    ),
    EvalCase(
        text="Birthday party next Saturday at 7pm",
        mock_response={
            "events": [
                {
                    "title": "Birthday party",
                    "start_at": "2026-09-19T19:00:00+02:00",
                    "priority": "medium",
                    "type": "one_time",
                    "tags": ["social"],
                }
            ]
        },
        expect_title="Birthday party",
        expect_tags=["social"],
    ),
    # --- all-day event -----------------------------------------------------
    EvalCase(
        text="Holiday all day on December 25",
        mock_response={
            "events": [
                {
                    "title": "Holiday",
                    "start_at": "2026-12-25T00:00:00+01:00",
                    "all_day": True,
                    "priority": "medium",
                    "type": "one_time",
                }
            ]
        },
        expect_title="Holiday",
        expect_start_at="2026-12-25T00:00:00+01:00",
    ),
    # --- financial critical guard (draft preserved, never auto-saved) ------
    EvalCase(
        text="Pay the mortgage on the 5th of each month",
        mock_response={
            "events": [
                {
                    "title": "Pay the mortgage",
                    "start_at": "2026-10-05T00:00:00+02:00",
                    "priority": "critical",
                    "type": "recurrent",
                    "rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
                }
            ]
        },
        expect_title="Pay the mortgage",
        expect_priority="critical",
        expect_type="recurrent",
        expect_rrule="FREQ=MONTHLY;BYMONTHDAY=5",
    ),
]
