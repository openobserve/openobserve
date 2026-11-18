// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  describeAlertInPlainWords,
  describeCompositeInPlainWords,
  filterPhrase,
  limitText,
  previewVerdictSentence,
  realtimeDailyVolume,
  type ReadBackAlert,
} from "./alertReadBack";
import { dataNoun } from "./alertCopy";

const t = i18n.global.t as unknown as TranslateFn;
const SQL = "SELECT count(*) FROM checkout_logs";

const alert = (over: Partial<ReadBackAlert> = {}): ReadBackAlert => ({
  stream_name: "checkout_logs",
  is_real_time: "false",
  destinations: [],
  workflows: [],
  pending_period_sec: 0,
  query_condition: { type: "custom", aggregation: null },
  trigger_condition: {
    operator: ">=",
    threshold: 3,
    period: 10,
    frequency: 10,
    frequency_type: "minutes",
    silence: 10,
  },
  ...over,
});

describe("describeAlertInPlainWords", () => {
  it("says nobody is alerted yet when no destination is picked", () => {
    expect(describeAlertInPlainWords(alert(), t)).toBe(
      "Won't notify anyone yet. Fires when 3+ events match in 10 minutes, checked every 10 min, at most once every 10 minutes.",
    );
  });

  it("says an incident opens when nobody else is told", () => {
    expect(
      describeAlertInPlainWords(alert({ creates_incident: true }), t, { incidentsEnabled: true }),
    ).toMatch(/^Opens an incident when 3\+ events match/);
  });

  it("ignores a stored incident flag where incidents are off", () => {
    expect(describeAlertInPlainWords(alert({ creates_incident: true }), t)).toMatch(
      /^Won't notify anyone yet\. Fires when/,
    );
  });

  it("reads an emptied look-back as 0 minutes, matching the field beside it", () => {
    const text = describeAlertInPlainWords(
      alert({ trigger_condition: { ...alert().trigger_condition, period: "" } }),
      t,
    );
    expect(text).toContain("match in 0 minutes");
  });

  it("keeps singular and plural units right for 1 and 2 hours", () => {
    const period = (n: number) =>
      describeAlertInPlainWords(
        alert({ trigger_condition: { ...alert().trigger_condition, period: n } }),
        t,
      );
    expect(period(1)).toContain("match in 1 minute,");
    expect(period(60)).toContain("match in 1 hour,");
    expect(period(120)).toContain("match in 2 hours,");
  });

  it("names the destinations and the hold", () => {
    expect(
      describeAlertInPlainWords(alert({ destinations: ["team-email"], pending_period_sec: 60 }), t),
    ).toBe(
      "Alerts team-email when 3+ events match in 10 minutes, for at least 1 hour, checked every 10 min, at most once every 10 minutes.",
    );
  });

  it("counts destinations past two", () => {
    expect(describeAlertInPlainWords(alert({ destinations: ["a", "b", "c"] }), t)).toContain(
      "Alerts a and 2 more when",
    );
  });

  it("reads a measured condition and a cron schedule", () => {
    const text = describeAlertInPlainWords(
      alert({
        query_condition: {
          type: "custom",
          aggregation: {
            function: "avg",
            having: { column: "latency_ms", operator: ">", value: 500 },
          },
        },
        trigger_condition: {
          operator: ">=",
          threshold: 1,
          period: 5,
          frequency_type: "cron",
          cron: "0 */5 * * * *",
          silence: 0,
        },
      }),
      t,
    );
    expect(text).toBe(
      "Won't notify anyone yet. Fires when avg of latency_ms is > 500 over 5 minutes, checked on the cron schedule 0 */5 * * * *.",
    );
  });

  it("is empty until a stream is picked", () => {
    expect(describeAlertInPlainWords(alert({ stream_name: "" }), t)).toBe("");
  });

  const limit = (threshold: unknown) => ({
    trigger_condition: {
      ...alert().trigger_condition,
      threshold,
    } as ReadBackAlert["trigger_condition"],
  });
  it.each([
    ["a SQL alert with no query", { query_condition: { type: "sql", sql: " " } }, "noQuery"],
    ["a negative limit", limit(-5), "fixLimit"],
    ["a fractional limit", limit(2.5), "fixLimit"],
    ["an emptied limit", limit(""), "fixLimit"],
  ] as const)("names the gap instead of a rule for %s", (_, over, gap) => {
    const key =
      gap === "noQuery" ? "alerts.saveModeDialog.noQuery" : "alerts.sections.condition.fixLimit";
    expect(describeAlertInPlainWords(alert(over), t)).toBe(t(key));
  });

  const leftoverMeasure = {
    function: "avg",
    having: { column: "latency_ms", operator: ">", value: 500 },
  };

  it("counts events once the measure is switched off, though the form keeps it", () => {
    const text = describeAlertInPlainWords(
      alert({ query_condition: { type: "custom", aggregation: leftoverMeasure } }),
      t,
      { aggregationEnabled: false },
    );
    expect(text).toBe(
      "Won't notify anyone yet. Fires when 3+ events match in 10 minutes, checked every 10 min, at most once every 10 minutes.",
    );
  });

  it("reads SQL rows after a switch from a builder measure", () => {
    const text = describeAlertInPlainWords(
      alert({ query_condition: { type: "sql", sql: SQL, aggregation: leftoverMeasure } }),
      t,
      { aggregationEnabled: true },
    );
    expect(text).toContain("when the query returns ≥ 3 rows in 10 minutes");
    expect(text).not.toContain("latency_ms");
  });

  it("reads the per-row value test of a SQL multi-alert", () => {
    const text = describeAlertInPlainWords(
      alert({
        query_condition: {
          type: "sql",
          sql: SQL,
          aggregation: {
            multi_alert: true,
            function: "count",
            having: { column: "cpu_percent", operator: ">", value: 90 },
          },
        },
      }),
      t,
    );
    expect(text).toContain("when the query returns a row where cpu_percent is > 90 in 10 minutes");
    expect(text).not.toContain("rows in");
  });
});

describe("describeCompositeInPlainWords", () => {
  const composite = {
    destinations: ["oncall"],
    pending_period_sec: 0,
    trigger_condition: { silence: 10 },
    composite_condition: { expression: "({c1} && !{c2})" },
    children: [
      { alert_id: "c1", accessible: true, name: "cpu_high" },
      { alert_id: "c2", accessible: true, name: "maintenance" },
    ],
  };

  it("reads the combined expression with the child alert names", () => {
    expect(describeCompositeInPlainWords(composite, t)).toBe(
      "Alerts oncall when its alerts match (cpu_high AND NOT maintenance), at most once every 10 minutes.",
    );
  });

  it("is empty until there is an expression", () => {
    expect(
      describeCompositeInPlainWords({ ...composite, composite_condition: { expression: "" } }, t),
    ).toBe("");
  });
});

describe("previewVerdictSentence", () => {
  const sql = alert({ query_condition: { type: "sql", aggregation: null } });
  const measure = alert({
    stream_type: "metrics",
    query_condition: {
      type: "custom",
      aggregation: { function: "avg", having: { column: "value", operator: ">=", value: 1 } },
    },
  });
  const traces = alert({
    stream_type: "traces",
    trigger_condition: { ...alert().trigger_condition, threshold: 100000000 },
  });
  const promql = (promql_condition: { operator: string; value: number } | null) =>
    alert({
      query_condition: { type: "promql", promql_condition },
      trigger_condition: { ...alert().trigger_condition, threshold: 1, period: 5 },
    });
  it.each([
    [
      "a firing event count",
      { wouldTrigger: true, reason: "", count: 7 },
      alert(),
      {},
      "Would alert now: 7 events in the last 10 minutes (threshold 3).",
    ],
    [
      "a quiet span count with a large threshold",
      { wouldTrigger: false, reason: "", count: 20232 },
      traces,
      {},
      "Quiet now: 20,232 spans in the last 10 minutes (threshold 100,000,000).",
    ],
    [
      "SQL rows the server capped",
      { wouldTrigger: true, reason: "", count: 2000, atLeast: true, label: "rows" },
      sql,
      {},
      "Would alert now: at least 2,000 rows in the last 10 minutes (threshold 3).",
    ],
    [
      "a builder that counts samples",
      { wouldTrigger: false, reason: "", count: 0, label: "data points" },
      alert({ stream_type: "metrics", query_condition: { type: "custom", aggregation: {} } }),
      { countsEvents: true },
      "Quiet now: 0 samples in the last 10 minutes (threshold 3).",
    ],
    [
      "an ungrouped measure",
      { wouldTrigger: true, reason: "", count: 1, value: 42.125 },
      measure,
      {},
      "Would alert now: avg of value is 42.13 in the last 10 minutes (threshold 1).",
    ],
    [
      "groups capped at the row limit",
      { wouldTrigger: true, reason: "", count: 1000, atLeast: true, grouped: true },
      alert(),
      {},
      "Would alert now: at least 1,000 groups are over the threshold.",
    ],
    [
      "no group over",
      { wouldTrigger: false, reason: "", count: 0, grouped: true },
      alert(),
      {},
      "Quiet now: no group is over the threshold.",
    ],
    [
      "one group short",
      { wouldTrigger: false, reason: "", count: 1, grouped: true },
      alert(),
      {},
      "Quiet now: 1 group is over the threshold (needs 3).",
    ],
    [
      "PromQL series against the value threshold, not the series count",
      { wouldTrigger: false, reason: "", count: 0 },
      promql({ operator: ">=", value: 80 }),
      {},
      "Quiet now: 0 series in the last 5 minutes (threshold 80).",
    ],
    [
      "PromQL rule mode against the series count",
      { wouldTrigger: false, reason: "", count: 0 },
      promql(null),
      {},
      "Quiet now: 0 series in the last 5 minutes (threshold 1).",
    ],
    [
      "nothing counted",
      { wouldTrigger: true, reason: "When conditions match" },
      alert(),
      {},
      "Would alert now: When conditions match.",
    ],
    [
      "real time before a count",
      { wouldTrigger: true, reason: "" },
      alert({ is_real_time: "true" }),
      {},
      "Fires on each matching event.",
    ],
    [
      "real time with no filter",
      { wouldTrigger: true, reason: "", count: 1500, windowMinutes: 30 },
      alert({ is_real_time: "true" }),
      { hasFilter: false },
      "Fires on each matching event: 1,500 in the last 30 minutes. Add a filter to narrow it. About 72,000 notifications a day before Notify at most every",
    ],
    [
      "real time with a filter that still matches a lot",
      { wouldTrigger: true, reason: "", count: 30952, windowMinutes: 30 },
      alert({ is_real_time: "true" }),
      { hasFilter: true },
      "Fires on each matching event: 30,952 in the last 30 minutes. About 1,500,000 notifications a day before Notify at most every",
    ],
    [
      "real time with nothing matched",
      { wouldTrigger: true, reason: "", count: 0, windowMinutes: 30 },
      alert({ is_real_time: "true" }),
      { hasFilter: true },
      "Fires on each matching event: 0 in the last 30 minutes.",
    ],
  ] as const)("states %s", (_, verdict, readBack, opts, sentence) => {
    expect(previewVerdictSentence({ ...verdict }, readBack, t, opts)).toBe(sentence);
  });

  it("writes the operator only when it is not at-least, in the locale's numbers", () => {
    expect(limitText(">=", 3000)).toBe("3,000");
    expect(limitText("<", 3)).toBe("< 3");
  });
});

describe("dataNoun", () => {
  it.each([
    ["logs", "custom", 2, "events"],
    ["metrics", "custom", 1, "sample"],
    ["traces", "custom", 2, "spans"],
    ["logs", "sql", 1, "row"],
    ["metrics", "promql", 2, "series"],
    [undefined, undefined, 2, "events"],
  ])("a %s stream in %s mode counts %s %s", (streamType, mode, count, noun) => {
    expect(dataNoun(streamType, mode, count, t)).toBe(noun);
  });
});

describe("realtimeDailyVolume", () => {
  it.each([
    ["a count over half an hour", { count: 30952, windowMinutes: 30 }, 1485696],
    ["no count yet", { windowMinutes: 30 }, null],
    ["no window", { count: 5, windowMinutes: 0 }, null],
  ])("projects %s to a day", (_, verdict, perDay) => {
    expect(realtimeDailyVolume({ wouldTrigger: true, reason: "", ...verdict })).toBe(perDay);
  });
});

describe("filterPhrase", () => {
  const cond = (column: string, operator: string, value: unknown, logicalOperator = "AND") => ({
    filterType: "condition",
    column,
    operator,
    value,
    logicalOperator,
  });
  const tree = (...conditions: unknown[]) => ({
    filterType: "group",
    logicalOperator: "AND",
    conditions,
  });
  it.each([
    ["no filter", tree(), null],
    ["only the builder's blank row", tree(cond("", "=", "")), null],
    ["one condition", tree(cond("severity", "=", "ERROR")), "severity is ERROR"],
    [
      "an OR inside a group",
      tree(cond("level", "=", "error"), {
        ...tree(cond("reason", "=", "Killing"), cond("note", "contains", "oom", "OR")),
      }),
      "level is error and (reason is Killing or note contains oom)",
    ],
    [
      "more than three conditions, closing an open group",
      tree(
        cond("a", "=", "1"),
        cond("b", "=", "2"),
        tree(cond("c", "=", "3"), cond("d", "=", "4", "OR")),
        cond("e", "=", "5"),
      ),
      "a is 1 and b is 2 and (c is 3) and 2 more",
    ],
  ])("reads %s", (_, conditions, phrase) => {
    expect(filterPhrase(conditions, "alert", t)?.text ?? null).toBe(phrase);
  });
});
