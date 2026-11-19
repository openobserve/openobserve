// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  compactDuration,
  compactNumber,
  durationText,
  everyDuration,
  joinListMore,
  measureWords,
  notifyHelp,
  valueRangeText,
  valueWithUnit,
} from "./alertCopy";

const t = i18n.global.t as unknown as TranslateFn;

describe("joinListMore", () => {
  it.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b, and c"],
    [["a", "b", "c", "d", "e"], "a, b, c, and 2 more"],
  ])("%j reads %s", (items, expected) => {
    expect(joinListMore(items, t)).toBe(expected);
  });

  it("takes a smaller cap", () => {
    expect(joinListMore(["a", "b", "c"], t, 1)).toBe("a and 2 more");
  });
});

describe("valueRangeText", () => {
  it.each([
    [{ min: 2, max: 2 }, undefined, t("alerts.guard.valueSteady", { value: "2" })],
    [{ min: 1, max: 3 }, undefined, t("alerts.guard.valueRange", { min: "1", max: "3" })],
    [
      { min: 0.5, max: 0.5 },
      { typed: 50, fix: 0.5 },
      t("alerts.guard.ratioSteady", { value: "0.5", typed: "50", fix: "0.5" }),
    ],
  ])("%j with %j reads the steady or ranged copy", (range, ratio, expected) => {
    expect(valueRangeText(range, t, ratio)).toBe(expected);
  });
});

describe("valueWithUnit", () => {
  it.each([
    [90, "percent", "short", "90 %"],
    [0.85, "percent-1", "short", "0.85 (85 %)"],
    [500, "milliseconds", "short", "500 ms"],
    [1500, "bytes-per-sec", "short", "1,500 B/s"],
    [21.5, "°C", "short", "21.5 °C"],
    [42, "", "short", "42"],
    [42, "none", "short", "42"],
    [1, "seconds", "words", "1 second"],
    [2500, "microseconds", "words", "2,500 microseconds"],
    [90, "percent", "words", "90 %"],
  ] as const)("%s %s (%s) reads %s", (value, unit, style, expected) => {
    expect(valueWithUnit(value, unit, t, style)).toBe(expected);
  });
});

describe("durations", () => {
  it.each([
    [30, "every 30 seconds", "30 seconds", "30 s"],
    [60, "every minute", "1 minute", "1 min"],
    [600, "every 10 minutes", "10 minutes", "10 min"],
    [3600, "every hour", "1 hour", "1 h"],
    [7200, "every 2 hours", "2 hours", "2 h"],
    [86400, "every day", "1 day", "1 d"],
    [90, "every 90 seconds", "90 seconds", "1 min"],
  ])("%i s reads %s / %s / %s", (seconds, every, words, compact) => {
    expect(`every ${everyDuration(seconds, t)}`).toBe(every);
    expect(durationText(seconds, t)).toBe(words);
    expect(compactDuration(seconds, t)).toBe(compact);
  });
});

describe("compactNumber", () => {
  it.each([
    [0, "0"],
    [950, "950"],
    [22_400, "22K"],
    [1_250_000, "1.3M"],
  ])("%i reads %s", (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});

describe("measureWords", () => {
  it.each([
    ["count", "service_name", ["service_name"], "number of events"],
    ["count", "", [], "number of events"],
    ["count", "user_id", ["service_name"], "number of events with user_id"],
    ["avg", "duration", [], "avg of duration"],
  ])("%s of %s grouped by %j reads %s", (fn, column, groups, expected) => {
    const aggregation = { function: fn, having: { column } };
    expect(measureWords(aggregation, groups, "logs", t)).toBe(expected);
  });
});

describe("notifyHelp", () => {
  const sql = "SELECT pod, count(*) FROM t GROUP BY pod";
  it.each([
    ["one alert", { type: "promql", promql: "avg by (node) (x)" }, "", ""],
    [
      "a PromQL by-label",
      { type: "promql", promql: "avg by (node) (x)", promql_multi_alert: true },
      "Each",
      "node",
    ],
    [
      "no by-label",
      { type: "promql", promql: "avg without (cpu) (x)", promql_multi_alert: true },
      "EachSeries",
      "",
    ],
    [
      "a builder group",
      { aggregation: { multi_alert: true, group_by: ["svc", ""] } },
      "Each",
      "svc",
    ],
    [
      "a builder group, one alert",
      { aggregation: { multi_alert: false, group_by: ["svc"] } },
      "",
      "",
    ],
    ["a SQL group", { type: "sql", sql, aggregation: { multi_alert: true } }, "Each", "pod"],
  ])("%s says what each wait covers", (_case, qc, scope, labels) => {
    const params = labels ? { labels } : {};
    expect(notifyHelp(qc, t)).toEqual({
      remind: t(`alerts.form.remind.whileFiring${scope}` as any, params),
      suppress: t(`alerts.alertSettings.suppressRepeatsHelp${scope}` as any, params),
      scope: scope
        ? t(labels ? "alerts.form.remind.per" : "alerts.form.remind.perSeries", params)
        : null,
    });
  });
});
