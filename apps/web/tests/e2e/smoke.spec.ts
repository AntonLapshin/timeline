import { test, expect, type Page } from "@playwright/test";

/**
 * Playwright smoke test for the timeline web app (issue #56).
 *
 * Boots the app shell (Vite dev server on 127.0.0.1:8123, started by the
 * Playwright `webServer` config) and verifies the core views render: the
 * Timeline, the Calendar, and the summary bar. The test runs with **no
 * backend** — it intercepts the API routes and returns sample JSON, so the
 * views render real content without a server.
 */

/**
 * Build the mocked events/occurrences/summary relative to the current date.
 *
 * The Calendar view starts on the current month and its agenda only lists
 * future occurrences, so the fixtures are generated from "today" (a couple of
 * days ahead, still in the current month). This keeps the smoke test robust
 * regardless of when it runs. All fixtures are loopback API responses served
 * by `mockApi` — the app never talks to a real backend.
 */
function buildMockData(): {
  events: unknown[];
  occurrences: unknown[];
  summary: Record<string, unknown>;
} {
  // Two future days in the current month (clamped so we never spill into the
  // next month, which would break the month-grid/agenda assertions).
  const now = new Date();
  const day1 = Math.min(now.getDate() + 1, 28);
  const day2 = Math.min(now.getDate() + 2, 28);
  const iso = (day: number, time: string) =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}`;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return {
    events: [
      {
        id: 1,
        title: "HRA quarterly check-up",
        description: "Annual-ish health review with Dr. Chen.",
        location_url: "",
        tags: ["health"],
        type: "recurrent",
        start_at: iso(day1, "10:00:00"),
        end_at: null,
        all_day: false,
        tz: "UTC",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
        priority: "critical",
        channels: ["telegram", "email"],
        reminder_offsets: ["1d", "2h"],
        remind_time_of_day: "09:00",
        repeat_until_ack: true,
        snooze_allowed: true,
        email_enabled: true,
        email_to: "me@example.com",
        source: "web",
        raw_input: null,
        ai_confidence: null,
        status: "active",
        created_at: "2026-08-01T00:00:00",
        updated_at: "2026-08-01T00:00:00",
      },
      {
        id: 2,
        title: "Product design review",
        description: "Review the new onboarding flow with the team.",
        location_url: "",
        tags: ["work"],
        type: "one_time",
        start_at: iso(day2, "14:30:00"),
        end_at: null,
        all_day: false,
        tz: "UTC",
        rrule: null,
        priority: "medium",
        channels: ["telegram"],
        reminder_offsets: ["7d", "1d"],
        remind_time_of_day: null,
        repeat_until_ack: false,
        snooze_allowed: false,
        email_enabled: false,
        email_to: null,
        source: "web",
        raw_input: null,
        ai_confidence: null,
        status: "active",
        created_at: "2026-09-01T00:00:00",
        updated_at: "2026-09-01T00:00:00",
      },
    ],
    occurrences: [
      {
        event_id: 1,
        title: "HRA quarterly check-up",
        priority: "critical",
        tag: "health",
        rrule: "FREQ=MONTHLY;INTERVAL=3",
        start_at: iso(day1, "10:00:00"),
        all_day: false,
        tz: "UTC",
        next_occurrence: null,
      },
      {
        event_id: 2,
        title: "Product design review",
        priority: "medium",
        tag: "work",
        rrule: null,
        start_at: iso(day2, "14:30:00"),
        all_day: false,
        tz: "UTC",
        next_occurrence: null,
      },
    ],
    summary: {
      month,
      total: 2,
      by_priority: { critical: 1, medium: 1, low: 0 },
    },
  };
}

/**
 * Intercept the loopback API routes and serve sample JSON so the app renders
 * real content with no backend. The app calls these endpoints on load.
 */
async function mockApi(page: Page): Promise<void> {
  const { events, occurrences, summary } = buildMockData();

  await page.route("**/api/events**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/occurrences")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(occurrences),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(events),
      });
    }
  });

  await page.route("**/api/summary**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summary),
    });
  });
}

test("app shell loads and the Timeline view renders", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  // The app shell header always renders.
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

  // The Timeline view is the active view by default and shows the mocked rows.
  await expect(page.getByText("HRA quarterly check-up").first()).toBeVisible();
  await expect(page.getByText("Product design review").first()).toBeVisible();
});

test("the summary bar appears with the mocked monthly total", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  await expect(page.getByText("2 events this month")).toBeVisible();
});

test("switching to the Calendar view renders the month grid", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  // Switch to the Calendar view via the app shell's view switcher.
  await page.getByRole("button", { name: "Calendar", exact: true }).click();

  // The Calendar view's month grid renders its navigation heading.
  const now = new Date();
  const monthLabel = `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;
  await expect(
    page.getByRole("heading", { name: monthLabel }),
  ).toBeVisible();

  // Switch to the Agenda sub-mode, which lists the event titles directly.
  await page.getByRole("button", { name: "Agenda", exact: true }).click();

  // The Calendar view renders the mocked occurrence.
  await expect(page.getByText("HRA quarterly check-up").first()).toBeVisible();
});

test("the dev-only showcase gallery renders via the ?showcase query", async ({
  page,
}) => {
  await page.goto("/?showcase=1");

  await expect(
    page.getByRole("heading", { name: "Component Showcase" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TimelineView" }),
  ).toBeVisible();
});
