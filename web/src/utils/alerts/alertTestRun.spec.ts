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
  conditionsRoot,
  evaluateAlertBody,
  requestFailureReason,
  testRunDay,
  testRunKey,
  testRunReport,
  testValueText,
  promqlPreviewStepSeconds,
  seriesPeak,
  valueSplitFilter,
  valueSplitText,
} from "./alertTestRun";

const t = i18n.global.t as unknown as TranslateFn;
type Extra = Partial<Omit<Parameters<typeof testRunReport>[1], "t" | "nowMs">>;
const report = (r: unknown, extra: Extra = {}) =>
  testRunReport(r as EvaluateAlertResponse, {
    t,
    timeZone: "UTC",
    nowMs: (r as EvaluateAlertResponse).end / 1000,
    ...extra,
  });
const lines = (r: unknown, extra: Extra = {}) =>
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

// Notified at the first check; the scheduler paused the second; the third found nothing.
const pausedAfterNotify = (skipped?: boolean) => ({
  ...noSeries,
  checks: noSeries.checks.map((c, i) =>
    i === 0
      ? { ...c, state: "firing", fired: true, notified: true, matched: 2, reason: null }
      : i === 1
        ? {
            ...c,
            state: "firing",
            fired: true,
            held_by: "notify_at_most_every",
            reason: null,
            ...(skipped === undefined ? {} : { skipped }),
          }
        : c,
  ),
  summary: {
    ...noSeries.summary,
    fired: 2,
    notifications: 1,
    held: 1,
    notified_at: [noSeries.checks[0].time],
  },
});

describe("testRunReport", () => {
  it.each([
    [
      "grouped alert that fired",
      grouped,
      {
        summary:
          "Over the last 24 hours this would have fired in 3 of 6 checks, for 2 groups, and sent notifications in 2 of them (09:20 and 09:50).",
        latestGroups: "At the latest check (10:00), no group was above the threshold.",
        held: "In the other check, every firing group was within 30 minutes of its last notification, so Notify at most every held them back.",
      },
    ],
    [
      "PromQL query that matched no series",
      noSeries,
      {
        summary: "Over the last 24 hours this would not have fired.",
        noSeries: "http_server_duration_count has data, but nothing matched the query in 24 hours.",
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
        summary: "Over the last 30 minutes this would not have fired.",
        pendingOnly: "It matched in 1 check, but not for as long as Must last.",
        closest: "Closest: 1,000 at 09:40.",
        errors: "1 check failed: Search timed out",
        truncated: "The test reached its time limit, so the 23 hours before that were not tested.",
      },
    ],
    [
      "check the scheduler paused after a notification",
      pausedAfterNotify(true),
      {
        summary:
          "Over the last 24 hours this would have fired in 1 of 2 checks and notified 1 time (09:50).",
        paused:
          "Notify at most every paused the other check: after a notification the alert waits 30 minutes before it checks again.",
        latestGroups: "At the latest check (10:00), no series was above the threshold.",
      },
    ],
    [
      "server that does not mark paused checks",
      pausedAfterNotify(),
      {
        summary:
          "Over the last 24 hours this would have fired in 2 of 3 checks and notified 1 time (09:50).",
        held: "The other firing came within 30 minutes of a notification, so Notify at most every held it back.",
        latestGroups: "At the latest check (10:00), no series was above the threshold.",
      },
    ],
  ])("states the run of a %s", (_name, fixture, expected) => {
    const shown = lines(fixture, { silenceMinutes: 30 });
    expect(
      Object.fromEntries(Object.keys(shown).map((id) => [id, String(shown[id].text)])),
    ).toEqual(expected);
  });

  it("colours failures red and partial runs amber", () => {
    const shown = lines(errorsTruncated);
    expect([shown.errors.tone, shown.truncated.tone]).toEqual(["error", "warning"]);
  });

  it.each([
    [">=", "Most often above the threshold:"],
    ["<", "Most often below the threshold:"],
    ["=", "Most often matching the condition:"],
  ])("lists every group that fired with its checks, for %s", (operator, heading) => {
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
    const { groupsHeading, groups, groupsMore } = report(r);
    expect(String(groupsHeading)).toBe(heading);
    expect(groups.map((g) => `${g.label}: ${g.text}`)).toEqual([
      "checkout: 2 checks",
      "cart: 1 check",
    ]);
    expect(groupsMore).toBe(0);
  });

  it("names each group by the fewest labels that tell them apart, ids last", () => {
    const pod = (cluster: string, ns: string, name: string, uid: string) => ({
      key: name,
      labels: {
        k8s_cluster: cluster,
        k8s_namespace_name: ns,
        k8s_pod_name: name,
        k8s_pod_uid: uid,
      },
      checks: 3,
    });
    const uid = (n: number) => `${n}aa0f3c2-6b1e-4d2a-9c11-0242ac120002`;
    const r = {
      ...grouped,
      summary: {
        ...grouped.summary,
        groups_fired: [
          pod("ap1", "openobserve", "ingester-0", uid(1)),
          pod("ap1", "openobserve", "querier-0", uid(2)),
          pod("eu1", "openobserve", "ingester-0", uid(3)),
        ],
      },
    };
    expect(report(r).groups.map((g) => String(g.label))).toEqual([
      "ap1 · ingester-0",
      "ap1 · querier-0",
      "eu1 · ingester-0",
    ]);
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

  it.each([
    {
      name: "the dry run's capped counts as a floor",
      capped: true,
      eventDay: null,
      text: "Over the last 24 hours, at least 60 matching events would have sent 6 notifications, at most one every 10 minutes.",
    },
    {
      name: "the 24-hour row's own count when it has one",
      capped: true,
      eventDay: { events: 900, windows: [{ events: 900, minutes: 60 }] },
      text: "Over the last 24 hours, 900 matching events would have sent 6 notifications, at most one every 10 minutes.",
    },
  ])(
    "says a real-time day in events and notifications from $name",
    ({ capped, eventDay, text }) => {
      const realTime = {
        ...grouped,
        is_real_time: true,
        checks: grouped.checks.map((c) => ({ ...c, value: 10, value_is_lower_bound: capped })),
        summary: { ...grouped.summary, groups_fired: [] },
      };
      const shown = lines(realTime, { silenceMinutes: 10, eventDay } as never);
      expect(Object.keys(shown)).toEqual(["summary"]);
      expect(String(shown.summary.text)).toBe(text);
    },
  );

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
    [
      "one metric with data",
      [3],
      {},
      "a_total has data, but nothing matched the query in 24 hours.",
      "secondary",
    ],
    [
      "one metric without data",
      [0],
      {},
      "a_total has no data in the latest check, so the query has nothing to read.",
      "warning",
    ],
    [
      "metrics that all have data",
      [3, 1],
      {},
      "a_total and b_total have data, but nothing matched the query in 24 hours.",
      "secondary",
    ],
    [
      "metrics that have none",
      [0, 0],
      {},
      "None of a_total and b_total has data in the latest check, so the query has nothing to read.",
      "warning",
    ],
    [
      "a metric missing from a query that needs both",
      [3, 0],
      {},
      "Nothing matched the query in 24 hours, and b_total has no data in the latest check.",
      "warning",
    ],
    [
      "a missing alternative of an or",
      [3, 0],
      { alternatives: true },
      "Nothing matched the query in 24 hours, and b_total has no data in the latest check.",
      "secondary",
    ],
    [
      "a ratio whose top part matched nothing",
      [3, 1],
      { ratio: true },
      "Nothing matched the top part of the ratio in 24 hours, so the share stayed at 0.",
      "secondary",
    ],
    [
      "a ratio of two alternatives, one without data",
      [1, 0],
      { ratio: true, alternatives: true },
      "Nothing matched the top part of the ratio in 24 hours, so the share stayed at 0.",
      "secondary",
    ],
  ])("says in words why a PromQL day matched nothing: %s", (_case, counts, extra, text, tone) => {
    const names = ["a_total", "b_total"];
    const r = {
      ...noSeries,
      diagnostics: { metrics: counts.map((series, i) => ({ name: names[i], series })) },
    };
    const line = lines(r, extra).noSeries;
    expect([String(line.text), line.tone]).toEqual([text, tone]);
  });

  it.each([
    ["none lasted long enough", "pending"],
    ["the day never fired", "quiet"],
  ])("names the series that came closest when %s", (_case, state) => {
    const check = { ...errorsTruncated.checks[0], state };
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
  it.each([
    ["a peak past every check", 90.7, "above", true],
    ["a peak no higher than a check", 0.97, "above", false],
    ["a dip past every check of a below alert", 0.5, "below", true],
  ])("says checks miss short peaks between them: %s", (_case, value, side, shown) => {
    const check = { ...errorsTruncated.checks[0], state: "quiet", error: null };
    const operator = side === "above" ? ">" : "<";
    const r = {
      ...errorsTruncated,
      query_type: "promql",
      truncated: false,
      checks: [0.93, 0.97].map((v, i) => ({
        ...check,
        operator,
        time: check.time + i * 300_000_000,
        groups: [{ key: "n", labels: { n: "a" }, value: v }],
      })),
      summary: { ...errorsTruncated.summary, errors: 0, pending: 0 },
    };
    const line = lines(r, {
      checkEveryMinutes: 5,
      previewPeak: { value, atMs: check.time / 1000 + 120_000 },
    }).betweenChecks;
    expect(line ? String(line.text) : null).toBe(
      shown
        ? `Checks read the value every 5 minutes; short peaks between checks (up to ${value} at 09:42) are not seen.`
        : null,
    );
  });
});

describe("testRunDay", () => {
  it("marks the hours with a firing check and keeps the scheduler's counts", () => {
    const day = testRunDay(grouped as EvaluateAlertResponse);
    expect([day.total, day.fired, day.alerts, day.pending]).toEqual([6, 3, 2, 0]);
    // Fired, fired, clear, fired: one refire, and the last firing is a single-check spike.
    expect([day.refires, day.singleCheckSpikes]).toEqual([1, 1]);
    expect(day.hours.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)).toEqual([23]);
    // The firing hour is shaded by how many of its checks fired, so busy hours stand apart.
    expect(day.hourShares[23]).toBeCloseTo(3 / 6);
    expect(day.hourShares[0]).toBe(0);
    expect(day.events).toBeUndefined();
    expect(day.untestedHours).toBe(0);
  });

  it("counts a paused check as neither a firing nor a refire, and leaves a cut run's early hours untested", () => {
    const paused = testRunDay(pausedAfterNotify(true) as EvaluateAlertResponse);
    expect([paused.fired, paused.refires]).toEqual([1, 0]);
    expect(testRunDay(errorsTruncated as EvaluateAlertResponse).untestedHours).toBe(23);
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

describe("previewPeak and value split", () => {
  it.each([
    [
      "above",
      [
        [1000, 1],
        [2000, 9],
        [3000, 4],
      ],
      { value: 9, atMs: 2000 },
    ],
    [
      "below",
      [
        [1000, 1],
        [2000, 9],
        [3000, null],
      ],
      { value: 1, atMs: 1000 },
    ],
    ["above", [], null],
  ] as const)("finds the %s-most drawn sample with its time", (side, data, peak) => {
    expect(seriesPeak([{ data: data as unknown[] }], side)).toEqual(peak);
  });

  it.each([
    ["the 24-hour view of a 5-minute check", 1440, 5, true, 300],
    ["the 12-hour view of a 10-minute check", 720, 10, true, 600],
    ["the short view, where the server's step is finer", 30, 5, false, 0],
    ["a long default view the server would draw coarser than the checks", 4320, 5, false, 300],
    ["a one-minute check over 24 hours", 1440, 1, true, 60],
  ])("samples the preview at check times for %s", (_case, range, every, fixed, step) => {
    expect(promqlPreviewStepSeconds(range, every, fixed)).toBe(step);
  });

  it.each([
    [
      "one filter with several values",
      [{ column: "reason", operator: "in", value: ["A", "B"] }],
      { column: "reason", values: ["A", "B"] },
    ],
    ["a single value", [{ column: "reason", operator: "in", value: ["A"] }], null],
    [
      "two multi-value filters",
      [
        { column: "a", operator: "in", value: ["A", "B"] },
        { column: "b", operator: "in", value: ["C", "D"] },
      ],
      null,
    ],
  ])("splits a real-time day by %s", (_case, conditions, split) => {
    const group = {
      filterType: "group",
      logicalOperator: "AND",
      conditions: conditions.map((c) => ({
        filterType: "condition",
        logicalOperator: "AND",
        ...c,
      })),
    };
    expect(valueSplitFilter({ version: 2, conditions: group })).toEqual(split);
    // The saved form wraps the group; the WHERE builder needs the bare group either way.
    expect([conditionsRoot({ version: 2, conditions: group }), conditionsRoot(group)]).toEqual([
      group,
      group,
    ]);
  });

  it("counts each value, a value never seen as 0, and folds the rest past five", () => {
    expect(String(valueSplitText(["Killing", "OOMKilled"], [{ v: "Killing", n: 59038 }], t))).toBe(
      "Of these: Killing 59,038 and OOMKilled 0.",
    );
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    expect(
      String(
        valueSplitText(
          many,
          many.map((v, i) => ({ v, n: i + 1 })),
          t,
        ),
      ),
    ).toBe("Of these: g 7, f 6, e 5, d 4, c 3, and 2 more.");
  });
});
