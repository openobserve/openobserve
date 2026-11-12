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
import "@/locales";
import { gt } from "@/types/i18n";
import {
  alertNeedsWords,
  alertQueryOf,
  alertScheduleWords,
  firingRange,
  firingValueWords,
  isRowCount,
  lastWeekOf,
  lastWeekWindow,
  WEEK_BUCKET_SECONDS,
} from "./incidentAlertPanel";

const HOUR_US = 3_600_000_000;
const DAY_US = 24 * HOUR_US;

describe("incidentAlertPanel", () => {
  it.each([
    [
      "a count alert",
      {
        query_condition: { type: "sql" },
        trigger_condition: { period: 15, operator: ">=", threshold: 1 },
      },
      "alert needs ≥ 1 over 15 min",
    ],
    [
      "an aggregate, with locale numbers",
      {
        condition: {
          type: "custom",
          aggregation: { function: "max", having: { column: "mem", operator: ">=", value: 2.5e9 } },
        },
        trigger_condition: { period: 60 },
      },
      "alert needs highest mem ≥ 2,500,000,000 over 1 h",
    ],
    [
      "a percentile aggregate",
      {
        condition: {
          aggregation: { function: "p95", having: { column: "took", operator: ">", value: 9 } },
        },
      },
      "alert needs p95 of took > 9",
    ],
    [
      "an aggregate whose function has no words, by its field alone",
      {
        condition: {
          aggregation: { function: "stddev", having: { column: "took", operator: ">", value: 9 } },
        },
      },
      "alert needs took > 9",
    ],
    [
      "PromQL with no window",
      { query_condition: { type: "promql", promql_condition: { operator: ">", value: 10 } } },
      "alert needs > 10",
    ],
    [
      "an SLO burn rate by its own threshold and long window, not its unused count gate",
      {
        query_condition: {
          type: "slo",
          slo_condition: {
            kind: "burn_rate",
            operator: ">",
            critical: 14.4,
            long_window_secs: 3600,
          },
        },
        trigger_condition: { period: 5, operator: "=", threshold: 0 },
      },
      "alert needs burn rate > 14.4 over 1 h",
    ],
    [
      "an SLO error budget, over the SLO's own window",
      {
        query_condition: {
          type: "slo",
          slo_condition: { kind: "error_budget", operator: ">=", critical: 80 },
        },
        trigger_condition: { period: 5, operator: "=", threshold: 0 },
      },
      "alert needs budget consumed ≥ 80%",
    ],
  ])("states what %s needs", (_case, alert, words) => {
    expect(alertNeedsWords(gt, alert, "en-US", false)).toBe(words);
  });

  it.each([
    ["a count alert", { query_condition: { type: "custom" } }, true],
    ["an SQL alert", { query_condition: { type: "sql" } }, true],
    ["an alert with no condition", {}, true],
    ["an aggregate", { condition: { type: "custom", aggregation: { function: "avg" } } }, false],
    ["a PromQL alert", { query_condition: { type: "promql" } }, false],
    ["an SLO burn rate", { query_condition: { type: "slo" } }, false],
    ["a condition type it does not know", { query_condition: { type: "anomaly" } }, false],
  ])("%s counts rows: %s", (_case, alert, rows) => {
    expect(isRowCount(alert)).toBe(rows);
  });

  it("states the schedule and the silence after a firing", () => {
    expect(
      alertScheduleWords(gt, { frequency: 5, frequency_type: "minutes", silence: 30 }, false),
    ).toBe("Checked every 5 min · silenced 30 min after firing");
    expect(alertScheduleWords(gt, { frequency_type: "cron", cron: "0 0 * * * *" }, false)).toBe(
      "Checked on a custom schedule, about every 1 h",
    );
    expect(alertScheduleWords(gt, { frequency_type: "cron", cron: "not cron" }, false)).toBe(
      "Checked on a custom schedule",
    );
    expect(alertScheduleWords(gt, {}, true)).toBe("Checked as events arrive");
  });

  it("gives the query and its language", () => {
    expect(alertQueryOf({ query_condition: { type: "sql", sql: "SELECT 1" } })).toEqual({
      code: "SELECT 1",
      lang: "sql",
    });
    expect(alertQueryOf({ query_condition: { type: "custom" } })).toBeNull();
  });

  it("says 100+ rows only when the check stopped counting at its row cap", () => {
    const hit = { timestamp: 1, actual_value: 100, value_is_lower_bound: true };
    expect(firingValueWords(gt, hit, true, "en-US")).toEqual({ value: "100+ rows", capped: true });
    expect(
      firingValueWords(gt, { ...hit, actual_value: 37, value_is_lower_bound: false }, true, "en-US")
        ?.value,
    ).toBe("37 rows");
    expect(
      firingValueWords(
        gt,
        { ...hit, actual_value: 17.89, value_is_lower_bound: false },
        false,
        "en-US",
      )?.value,
    ).toBe("17.89");
    expect(firingValueWords(gt, { timestamp: 1 }, false, "en-US")).toBeNull();
    const rule = { timestamp: 1, actual_value: null, rule_value: "0.125" };
    expect(firingValueWords(gt, rule, false, "en-US")?.value).toBe("0.125");
    expect(firingValueWords(gt, { ...rule, rule_value: "NaN" }, false, "en-US")).toBeNull();
  });

  it.each(["Asia/Kathmandu", "Asia/Kolkata", "UTC", "America/New_York"])(
    "counts midnight firings on the right local day in %s",
    (zone) => {
      const window = lastWeekWindow(zone, Date.UTC(2026, 10, 12, 12) * 1000);
      const interval = WEEK_BUCKET_SECONDS * 1_000_000;
      const rows = [window.start + 60_000_000, window.start + DAY_US + 60_000_000].map((at) => ({
        bucket: Math.floor(at / interval) * interval,
        alert_id: "a",
        outcome: "firing",
        n: 1,
      }));
      expect(lastWeekOf(rows, "a", zone, window).days.map((day) => day.n)).toEqual([
        1, 1, 0, 0, 0, 0, 0,
      ]);
    },
  );

  it("puts 7 bars on the app zone's days, today last, from half-hour buckets", () => {
    // 2026-11-12 10:00 IST; IST days start at 18:30 UTC.
    const now = Date.UTC(2026, 10, 12, 4, 30) * 1000;
    const window = lastWeekWindow("Asia/Kolkata", now);
    expect(window.start).toBe(Date.UTC(2026, 10, 5, 18, 30) * 1000);
    expect(window.days.map((d) => d.day)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
    // 2023-11-05 23:30 EST, a 25 h day: a 24 h step back lands on the same day again.
    const fallBack = lastWeekWindow("America/New_York", Date.UTC(2023, 10, 6, 4, 30) * 1000);
    expect(fallBack.days.map((d) => d.day.slice(8))).toEqual([
      "30",
      "31",
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
    // A window opening on a 25 h or 23 h day starts at its first midnight; Havana repeats midnight.
    const start = (zone: string, now: number) => lastWeekWindow(zone, now * 1000).start / 1000;
    expect(start("America/New_York", Date.UTC(2026, 10, 7, 17))).toBe(Date.UTC(2026, 10, 1, 4));
    expect(start("America/New_York", Date.UTC(2026, 2, 14, 16))).toBe(Date.UTC(2026, 2, 8, 5));
    expect(start("America/Havana", Date.UTC(2026, 10, 7, 17))).toBe(Date.UTC(2026, 10, 1, 4));
    const lateUtc = Date.UTC(2026, 10, 11, 19) * 1000;
    const rows = [
      { bucket: lateUtc, alert_id: "a", outcome: "firing", n: 4, silenced: 3 },
      { bucket: lateUtc - HOUR_US, alert_id: "a", outcome: "firing", n: 2 },
      { bucket: lateUtc, alert_id: "a", outcome: "notify_failed", n: 1 },
      { bucket: lateUtc, alert_id: "a", outcome: "normal", n: 90 },
      { bucket: lateUtc, alert_id: "b", outcome: "firing", n: 9 },
      { bucket: window.start - DAY_US, alert_id: "a", outcome: "firing", n: 50 },
    ];
    const week = lastWeekOf(rows, "a", "Asia/Kolkata", window);
    expect(week.days.map((d) => d.n)).toEqual([0, 0, 0, 0, 0, 2, 5]);
    expect(week).toMatchObject({ total: 7, silenced: 3, firingDays: 2 });
  });

  it("states a range by date past a day, else by time, dated when not today", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 10, 11, h, m) * 1000;
    const now = at(25, 13);
    expect(firingRange("UTC", at(23, 15), at(25, 10), now)).toBe("Nov 11, 23:15 → 01:10");
    expect(firingRange("UTC", at(9), at(9 + 15 * 24), now)).toBe("Nov 11 → Nov 26");
    expect(firingRange("UTC", at(9), at(10), now)).toBe("Nov 11, 09:00 → 10:00");
  });
});
