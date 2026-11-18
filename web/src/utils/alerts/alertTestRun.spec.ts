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
  microsText,
  requestFailureReason,
  testRunDay,
  testRunKey,
  testRunReport,
} from "./alertTestRun";

const t = i18n.global.t as unknown as TranslateFn;
const report = (r: unknown, unit?: string) =>
  testRunReport(r as EvaluateAlertResponse, {
    t,
    unit,
    timeZone: "UTC",
    nowMs: (r as EvaluateAlertResponse).end / 1000,
  });
const lines = (r: unknown) => Object.fromEntries(report(r).lines.map((l) => [l.id, l]));

describe("testRunReport", () => {
  it.each([
    [
      "grouped alert that fired",
      grouped,
      {
        summary:
          "Over the last 24 hours this would have fired 2 times (09:20 and 09:50), for checkout and cart.",
        now: "Right now: quiet (18 vs 50).",
        held: "1 more firing was held by Notify at most every.",
      },
    ],
    [
      "PromQL query that matched no series",
      noSeries,
      {
        summary: "Over the last 24 hours this would not have fired.",
        now: "Right now: no data in the last 5 minutes.",
        noSeries: "The query matched no series; http_server_duration_count has 3 series.",
      },
    ],
    [
      "a failed check and a cut run",
      errorsTruncated,
      {
        summary: "Over the last 24 hours this would not have fired.",
        pendingOnly: "It matched in 1 check, but not for as long as Must last.",
        now: "Right now: no data in the last 10 minutes.",
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

  it("lists every group that fired with its checks", () => {
    const { groups, groupsMore } = report(grouped);
    expect(groups.map((g) => `${g.label}: ${g.text}`)).toEqual([
      "checkout: over the limit in 2 checks",
      "cart: over the limit in 1 check",
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

  it("counts the firing times past three", () => {
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
      "Over the last 24 hours this would have fired 5 times (05:00, 06:00, 07:00, and 2 more).",
    );
  });
});

describe("testRunDay", () => {
  it("marks the hours with a firing check and keeps the scheduler's counts", () => {
    const day = testRunDay(grouped as EvaluateAlertResponse);
    expect([day.total, day.fired, day.alerts]).toEqual([6, 3, 2]);
    expect(day.hours.map((h, i) => (h ? i : -1)).filter((i) => i >= 0)).toEqual([23]);
    expect(day.events).toBeUndefined();
  });
});

describe("value text", () => {
  it.each([
    [500_000, "500 ms"],
    [1_500_000, "1.5 s"],
    [250, "250 µs"],
  ])("reads %i µs as %s", (micros, text) => {
    expect(String(microsText(micros, t))).toBe(text);
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
