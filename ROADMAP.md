# Timeline — Roadmap (v2 / post-v1 stretch goals)

> This document captures **v2 / post-v1 stretch goals** — ideas that are
> deliberately **out of scope for v1** (see the [manifest](manifest.md)
> "Non-goals"). It exists so future direction is captured in-repo even when the
> work is not scheduled. Nothing here is committed to a release; items are
> listed at a rough priority to guide future planning.
>
> All items below are **post-v1** and will not be implemented as part of the
> v1 milestone. They are recorded for context and future planning only.

## How to read this

- **Priority** is a rough ordering signal (P1 = highest/most foundational,
  P3 = lowest), not a commitment.
- **Problem it solves** explains why the item exists.
- Items marked **out-of-scope for v1** are not part of the v1 milestone.

---

## V2 / stretch items

### 1. Google Calendar import/export sync

- **Priority:** P1
- **Problem it solves:** users already keep calendars in Google Calendar; a
  one-way or two-way sync lets timeline events appear there (and existing
  Google events appear in timeline) without re-entering them, and makes the
  schedule accessible outside the loopback-only web app.
- **Out-of-scope for v1:** yes — v1 is explicitly local-first with no remote
  web access and no calendar sync; sync requires OAuth + remote network access,
  which contradicts the v1 loopback-only, no-auth posture.

### 2. `/ask` over history (conversational querying of past events)

- **Priority:** P1
- **Problem it solves:** today the app captures and reminds about **future**
  events; it does not let you ask questions about what happened or what is
  scheduled ("what did I do last March?", "when is the next HRA quarterly?").
  A conversational `/ask` over the event history turns the captured data into
  a queryable memory.
- **Out-of-scope for v1:** yes — v1 only stores and reminds about future
  events; history querying is a v2 capability.

### 3. PWA (installable / offline)

- **Priority:** P2
- **Problem it solves:** the web app currently requires being on the home
  network at `127.0.0.1:8123`. Making it a PWA (service worker + manifest)
  allows installing it and using it offline / from a homescreen icon, improving
  the day-to-day capture experience.
- **Out-of-scope for v1:** yes — v1 ships a plain responsive web app; a
  service worker and offline caching are v2.

### 4. Usage stats

- **Priority:** P3
- **Problem it solves:** there are currently no insights into how the app is
  used (events captured, reminders delivered, most common categories, capture
  latency). Lightweight local usage stats give the owner a sense of how well
  the app is working and surface rough trends.
- **Out-of-scope for v1:** yes — v1 has no analytics/usage telemetry; stats are
  a post-v1 enhancement.

---

## Notes

- All items are consistent with the manifest's non-goals and require no
  secrets, IDs, or emails.
- This file is docs-only; it does not change any code, schema, or behavior.
