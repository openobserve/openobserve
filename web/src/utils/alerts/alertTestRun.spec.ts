// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { EvaluateAlertResponse } from "./alertEvaluate.types";
import grouped from "@/test/fixtures/alerts/evaluate-grouped-fired.json";
import noSeries from "@/test/fixtures/alerts/evaluate-promql-no-series.json";
import errorsTruncated from "@/test/fixtures/alerts/evaluate-errors-truncated.json";
import {
  checkTimeText,
  evaluateAlertBody,
  requestFailureReason,
  testRunDay,
  testRunKey,
  testRunReport,
  testValueText,
} from "./alertTestRun";

const t = i18n.global.t as unknown as TranslateFn;
const report = (r: unknown, extra: { silenceMinutes?: number; ratio?: boolean } = {}) =>
  testRunReport(r as EvaluateAlertResponse, {
    t,
    timeZone: "UTC",
    nowMs: (r as EvaluateAlertResponse).end / 1000,
    ...extra,
  });
const lines = (r: unknown, extra: { silenceMinutes?: number; ratio?: boolean } = {}) =>
  Object.fromEntries(report(r, extra).lines.map((l) => [l.id, l]));
// Fired at the first check on two series, quiet since.
const promqlFiredEarlier = {
  ...noSeries,
  checks: noSeries.checks.map((c, i) =>
    i ? c : { ...c, state: "firing", fired: true, notified: true, matched: 2, reason: null },
  ),
  summary: {
    ...noSeries.summary,
    fired: 1,
    notifications: 1,
    notified_at: [noSeries.checks[0].time],
  },
};

describe("testRunReport", () => {
  it.each([
    [
      "grouped alert that fired",
      grouped,
      {
        summary:
          "Over the last 24 hours this would have fired in 3 of 6 checks, for 2 groups, and notified 2 times (09:20 and 09:50).",
        latestGroups: "At the latest check (10:00), no group was above the threshold.",
        held: "Notify at most every held back the other 1 firing.",
      },
    ],
    [
      "PromQL query that matched no series",
      noSeries,
      {
        summary: "Over the last 24 hours this would not have fired.",
        noSeries: "The query matched no series; http_server_duration_count has 3 series.",
      },
    ],
    [
      "PromQL query that fired earlier, so its series matched",
      promqlFiredEarlier,
      {
        summary:
          "Over the last 24 hours this would have fired in 1 of 3 checks and notified 1 time (09:50).",
        latestGroups: "At the latest check (10:00), no series was above the threshold.",
      },
    ],
    [
      "a failed check and a cut run",
      errorsTruncated,
      {
        summary: "Over the last 24 hours this would not have fired.",
        pendingOnly: "It matched in 1 check, but not for as long as Must last.",
        closest: "Closest: 1,000 at 09:40.",
        errors: "1 check failed: Search timed out",
        truncated: "Tested the latest 3 checks only.",
      },
    ],
  ])("states the run of a %s", (_name, fixture, expected) => {
    const shown = lines(fixture);
    expect(
      Object.fromEntries(Object.keys(shown).map((id) => [id, String(shown[id].text)])),
    ).toEqual(expected);
  });

  it("colours failures red and partial runs amber", () => {
    const shown = lines(errorsTruncated);
    expect([shown.errors.tone, shown.truncated.tone]).toEqual(["error", "warning"]);
  });

  it.each([
    [">=", "above the threshold"],
    ["<", "below the threshold"],
    ["=", "matched the condition"],
  ])("lists every group that fired with its checks, for %s", (operator, side) => {
    // A label every group shares names none of them, so only the one that differs is shown.
    const r = {
      ...grouped,
      checks: grouped.checks.map((c) => ({ ...c, operator })),
      summary: {
        ...grouped.summary,
        groups_fired: grouped.summary.groups_fired.map((g) => ({
          ...g,
          labels: { env: "prod", ...g.labels },
        })),
      },
    };
    const { groups, groupsMore } = report(r);
    expect(groups.map((g) => `${g.label}: ${g.text}`)).toEqual([
      `checkout: ${side} in 2 checks`,
      `cart: ${side} in 1 check`,
    ]);
    expect(groupsMore).toBe(0);
  });

  it("names the series of every metric when the query reads several", () => {
    const two = {
      ...noSeries,
      diagnostics: {
        metrics: [
          { name: "a_total", series: 3 },
          { name: "b_total", series: 0 },
        ],
      },
    };
    expect(String(lines(two).noSeries.text)).toBe(
      "The query matched no series. Series per metric: a_total has 3 and b_total has 0.",
    );
  });

  it("says when every check found nothing to count", () => {
    const empty = {
      ...grouped,
      checks: grouped.checks.map((c) => ({ ...c, state: "quiet", reason: "no_data", value: 0 })),
      summary: { ...grouped.summary, notifications: 0, notified_at: [], groups_fired: [] },
    };
    expect(String(lines(empty).matchedNothing.text)).toBe(
      "Your filters matched nothing in 24 hours. Check the filter values.",
    );
  });

  it("says a real-time day in events and notifications, never checks", () => {
    const realTime = {
      ...grouped,
      is_real_time: true,
      checks: grouped.checks.map((c) => ({ ...c, value: 10 })),
      summary: { ...grouped.summary, groups_fired: [] },
    };
    expect(Object.keys(lines(realTime, { silenceMinutes: 10 }))).toEqual(["summary"]);
    expect(String(lines(realTime, { silenceMinutes: 10 }).summary.text)).toBe(
      "Over the last 24 hours, 60 matching events would have sent 2 notifications, at most one every 10 minutes.",
    );
  });

  it("says a ratio with nothing in its top part is 0, not a broken query", () => {
    expect(String(lines(noSeries, { ratio: true }).noSeries.text)).toBe(
      "The query returned no value: the top of its ratio matched nothing in the latest check, so the share was 0.",
    );
  });

  it("names only the latest time once there are more than three", () => {
    const many = {
      ...grouped,
      summary: {
        ...grouped.summary,
        notifications: 5,
        notified_at: [1, 2, 3, 4, 5].map((h) => grouped.end - h * 3_600_000_000).reverse(),
        groups_fired: [],
      },
    };
    expect(String(lines(many).summary.text)).toBe(
      "Over the last 24 hours this would have fired in 3 of 6 checks and notified 5 times (the latest at 09:00).",
    );
  });

  it.each([
    ["has series, so the filters matched nothing then", 3, "secondary"],
    ["has none, so the query reads nothing", 0, "warning"],
  ])("tells a metric that %s apart by tone", (_case, series, tone) => {
    const r = { ...noSeries, diagnostics: { metrics: [{ name: "a_total", series }] } };
    expect(lines(r).noSeries.tone).toBe(tone);
  });

  it("names the series that came closest when none lasted long enough", () => {
    const check = errorsTruncated.checks[0];
    const r = {
      ...errorsTruncated,
      checks: [
        { ...check, groups: [{ key: "node=a", labels: { job: "x", node: "a" }, value: 0.93 }] },
        {
          ...check,
          time: check.time + 60_000_000,
          groups: [{ key: "node=b", labels: { node: "b" }, value: 0.97 }],
        },
      ],
    };
    expect(String(lines(r).closest.text)).toBe("Closest: b reached 0.97 at 09:41.");
  });
});

describe("testRunDay", () => {
  it("marks the hours with a firing check and keeps the scheduler's counts", () => {
    const day = testRunDay(grouped as EvaluateAlertResponse);
    expect([day.total, day.fired, day.alerts, day.pending]).toEqual([6, 3, 2, 0]);
    // Fired, fired, clear, fired: one refire, and the last firing is a single-check spike.
    expect([day.refires, day.singleCheckSpikes]).toEqual([1, 1]);
    expect(day.hours.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)).toEqual([23]);
    expect(day.events).toBeUndefined();
  });
});

describe("value text", () => {
  it.each([
    [500_000, "microseconds", "500 ms"],
    [0.85, "percent-1", "0.85 (85 %)"],
    [12, null, "12"],
  ])("reads %s in %s as %s", (value, unit, text) => {
    expect(String(testValueText(value, unit, t))).toBe(text);
  });

  it("adds the weekday to a time that is not today", () => {
    const now = Date.UTC(2026, 10, 18, 12, 0);
    expect(String(checkTimeText(Date.UTC(2026, 10, 18, 9, 5) * 1000, "UTC", now))).toBe("09:05");
    expect(String(checkTimeText(Date.UTC(2026, 10, 17, 22, 40) * 1000, "UTC", now))).toBe(
      "Tue 22:40",
    );
  });
});

describe("requestFailureReason", () => {
  it.each([
    [{ response: { status: 403, data: { message: "Blocked" } } }, "Blocked"],
    [{ response: { status: 502, data: {} } }, "the server answered 502"],
    [new Error("Network Error"), "no answer from the server"],
  ])("says what failed for %o", (error, text) => {
    expect(String(requestFailureReason(error, t))).toBe(text);
  });
});

describe("evaluateAlertBody", () => {
  const form = () =>
    ({
      name: "errors",
      description: "",
      is_real_time: "false",
      pending_period_sec: 5,
      context_attributes: [],
      destinations: ["pager"],
      stream_name: "app",
      stream_type: "logs",
      trigger_condition: { threshold: "3", operator: ">=", period: 10, frequency: 10, silence: 30 },
      query_condition: {
        type: "sql",
        sql: "SELECT count(*) AS c FROM app",
        conditions: [],
        multi_time_range: [{ offSet: "1w" }],
        vrl_function: ".x = 1",
      },
    }) as any;
  const context = {
    store: { state: { userInfo: { email: "a@b.c" } } },
    isAggregationEnabled: { value: false },
    getSelectedTab: { value: "sql" },
  };

  it("sends the save payload with its comparison and function, and leaves the form alone", () => {
    const data = form();
    const body = evaluateAlertBody(data, context);
    expect(body.query_condition.multi_time_range).toEqual([{ offSet: "1w" }]);
    expect(body.query_condition.vrl_function).toBeTruthy();
    expect(body.query_condition.conditions).toEqual({ version: 2, conditions: [] });
    expect(body.pending_period_sec).toBe(300);
    expect(body).not.toHaveProperty("updatedAt");
    expect(data).not.toHaveProperty("updatedAt");
  });

  it("keys two alerts alike when only what the dry run ignores differs", () => {
    const a = evaluateAlertBody(form(), context);
    const b = evaluateAlertBody({ ...form(), name: "other", destinations: [] }, context);
    const c = evaluateAlertBody(
      { ...form(), trigger_condition: { ...form().trigger_condition, threshold: "4" } },
      context,
    );
    expect(testRunKey(a)).toBe(testRunKey(b));
    expect(testRunKey(a)).not.toBe(testRunKey(c));
  });
});
