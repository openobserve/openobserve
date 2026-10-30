// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import {
  describeAlertInPlainWords,
  describeCompositeInPlainWords,
  limitText,
  previewVerdictSentence,
  type ReadBackAlert,
} from "./alertReadBack";

const t = i18n.global.t as unknown as TranslateFn;

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
      "Alerts nobody yet when 3+ events turn up in 10 minutes, checked every 10 min, at most once every 10 minutes.",
    );
  });

  it("names the destinations and the hold", () => {
    expect(
      describeAlertInPlainWords(alert({ destinations: ["team-email"], pending_period_sec: 60 }), t),
    ).toBe(
      "Alerts team-email when 3+ events turn up in 10 minutes, for at least 1 hour, checked every 10 min, at most once every 10 minutes.",
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
      "Alerts nobody yet when avg of latency_ms is > 500 over 5 minutes, checked on the cron schedule 0 */5 * * * *.",
    );
  });

  it("is empty until a stream is picked", () => {
    expect(describeAlertInPlainWords(alert({ stream_name: "" }), t)).toBe("");
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
      "Alerts nobody yet when 3+ events turn up in 10 minutes, checked every 10 min, at most once every 10 minutes.",
    );
  });

  it("reads SQL rows after a switch from a builder measure", () => {
    const text = describeAlertInPlainWords(
      alert({ query_condition: { type: "sql", aggregation: leftoverMeasure } }),
      t,
      { aggregationEnabled: true },
    );
    expect(text).toContain("when the query returns ≥ 3 rows in 10 minutes");
    expect(text).not.toContain("latency_ms");
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
  it("states a firing verdict in events with the limit", () => {
    expect(
      previewVerdictSentence(
        { wouldTrigger: true, reason: "", count: 7, label: "data points" },
        alert(),
        t,
      ),
    ).toBe("Right now this would alert you: 7 events in the last 10 min (your limit is 3).");
  });

  it("states a quiet verdict", () => {
    expect(
      previewVerdictSentence(
        { wouldTrigger: false, reason: "", count: 1, label: "data point" },
        alert(),
        t,
      ),
    ).toBe("Quiet right now: 1 event in the last 10 min (limit 3).");
  });

  it("uses the preview's own noun outside the builder count mode", () => {
    const sql = alert({ query_condition: { type: "sql", aggregation: null } });
    expect(
      previewVerdictSentence({ wouldTrigger: false, reason: "", count: 2, label: "rows" }, sql, t),
    ).toBe("Quiet right now: 2 rows in the last 10 min (limit 3).");
  });

  it("lets the editor say the builder counts events", () => {
    const withAgg = alert({
      query_condition: { type: "custom", aggregation: { function: "avg" } },
    });
    expect(
      previewVerdictSentence(
        { wouldTrigger: false, reason: "", count: 0, label: "data points" },
        withAgg,
        t,
        { countsEvents: true },
      ),
    ).toBe("Quiet right now: 0 events in the last 10 min (limit 3).");
  });

  it("counts groups over the limit", () => {
    expect(
      previewVerdictSentence(
        { wouldTrigger: true, reason: "", count: 2, grouped: true },
        alert(),
        t,
      ),
    ).toBe("Right now 2 groups are over the limit.");
    expect(
      previewVerdictSentence(
        { wouldTrigger: false, reason: "", count: 0, grouped: true },
        alert(),
        t,
      ),
    ).toBe("Quiet right now: no group is over the limit.");
  });

  it("falls back to the preview's reason when nothing was counted", () => {
    expect(
      previewVerdictSentence({ wouldTrigger: true, reason: "When conditions match" }, alert(), t),
    ).toBe("Right now this would alert you: When conditions match.");
  });

  it("writes the operator only when it is not at-least", () => {
    expect(limitText(">=", 3)).toBe("3");
    expect(limitText("<", 3)).toBe("< 3");
  });
});
