// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the composed AddAlert orchestrator schema. These exercise the
// schema in isolation (no component mount) to prove the topbar rules + the
// reused QueryConfig / AlertSettings rules fire at the right nested paths and in
// the right is_real_time branch (Rule ④ validation parity).

import { describe, it, expect } from "vitest";
import i18n from "@/locales";
import { makeAddAlertSchema, defaultAddAlertMeta } from "./AddAlert.schema";

// Messages are i18n-driven now — resolve through the real locale so assertions
// verify the exact English (parity) AND that the keys exist.
const t = (key: string, named?: Record<string, unknown>): string =>
  (i18n.global.t as any)(key, named);
const addAlertSchema = makeAddAlertSchema(t);
const ALERT_NAME_REQUIRED_MESSAGE = t("alerts.nameRequired");
const ALERT_NAME_SPECIAL_CHARS_MESSAGE = t("alerts.nameNoSpecialChars");
const STREAM_TYPE_REQUIRED_MESSAGE = t("alerts.validation.streamTypeRequired");
const STREAM_NAME_REQUIRED_MESSAGE = t("alerts.validation.streamNameRequired");

const validScheduled = (over: Record<string, any> = {}) => ({
  name: "my_alert",
  stream_type: "logs",
  stream_name: "default",
  is_real_time: "false",
  destinations: ["dest1"],
  creates_incident: false,
  trigger_condition: {
    period: 10,
    operator: ">=",
    frequency: 10,
    cron: "",
    threshold: 3,
    silence: 10,
    frequency_type: "minutes",
    timezone: "UTC",
  },
  query_condition: {
    conditions: {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "",
      conditions: [],
    },
    sql: "",
    promql: "",
    type: "custom",
    aggregation: null,
    promql_condition: null,
    vrl_function: null,
    multi_time_range: [],
  },
  logGroupBy: [],
  // DISPLAY value for the "Check every" input (minutes mode → same number as
  // the stored trigger_condition.frequency minutes). The frequency rules key off
  // this path — it is the one bound to the visible input.
  _ui: { checkEvery: 10 },
  _meta: defaultAddAlertMeta(),
  ...over,
});

/** Collect issue messages keyed by dot-path for easy assertions. */
const issuesByPath = (value: any): Record<string, string[]> => {
  const res = addAlertSchema.safeParse(value);
  const map: Record<string, string[]> = {};
  if (!res.success) {
    for (const issue of res.error.issues) {
      const key = issue.path.join(".");
      (map[key] ||= []).push(issue.message);
    }
  }
  return map;
};

describe("addAlertSchema (composed orchestrator schema)", () => {
  it("passes a complete valid scheduled alert", () => {
    expect(addAlertSchema.safeParse(validScheduled()).success).toBe(true);
  });

  // ── Topbar (name §4 restore + stream required) ──────────────────────────────
  it("blocks an empty name", () => {
    const m = issuesByPath(validScheduled({ name: "" }));
    expect(m["name"]).toContain(ALERT_NAME_REQUIRED_MESSAGE);
  });

  it("blocks a name with unsupported characters (§4 restore)", () => {
    const m = issuesByPath(validScheduled({ name: "bad name" }));
    expect(m["name"]).toContain(ALERT_NAME_SPECIAL_CHARS_MESSAGE);
    // colon / hash / quotes / % / & are all rejected
    expect(issuesByPath(validScheduled({ name: "a:b" }))["name"]).toBeTruthy();
    expect(issuesByPath(validScheduled({ name: "a#b" }))["name"]).toBeTruthy();
    expect(issuesByPath(validScheduled({ name: "a%b" }))["name"]).toBeTruthy();
  });

  it("blocks an empty stream_type and stream_name", () => {
    const m = issuesByPath(
      validScheduled({ stream_type: "", stream_name: "" }),
    );
    expect(m["stream_type"]).toContain(STREAM_TYPE_REQUIRED_MESSAGE);
    expect(m["stream_name"]).toContain(STREAM_NAME_REQUIRED_MESSAGE);
  });

  // ── AlertSettings (reused) ──────────────────────────────────────────────────
  it("requires at least one destination", () => {
    const m = issuesByPath(validScheduled({ destinations: [] }));
    expect(m["destinations"]?.length).toBeGreaterThan(0);
  });

  it("requires period ≥ 1 for scheduled alerts", () => {
    const base = validScheduled();
    base.trigger_condition.period = 0;
    const m = issuesByPath(base);
    expect(m["trigger_condition.period"]?.length).toBeGreaterThan(0);
  });

  it("does NOT enforce period ≥ 1 for realtime alerts", () => {
    const base = validScheduled({
      is_real_time: "true",
      _meta: defaultAddAlertMeta({ isRealTime: "true" }),
    });
    base.trigger_condition.period = 0;
    const m = issuesByPath(base);
    expect(m["trigger_condition.period"]).toBeUndefined();
  });

  // ── QueryConfig (reused) ────────────────────────────────────────────────────
  it("requires threshold ≥ 1 for scheduled alerts", () => {
    const base = validScheduled();
    base.trigger_condition.threshold = 0;
    const m = issuesByPath(base);
    expect(m["trigger_condition.threshold"]?.length).toBeGreaterThan(0);
  });

  it("restores promql operator + value requiredness in promql mode (§4)", () => {
    const base = validScheduled({
      _meta: defaultAddAlertMeta({ tab: "promql" }),
    });
    base.query_condition.type = "promql";
    base.query_condition.promql_condition = { operator: "", value: "" };
    const m = issuesByPath(base);
    expect(
      m["query_condition.promql_condition.operator"]?.length,
    ).toBeGreaterThan(0);
    expect(
      m["query_condition.promql_condition.value"]?.length,
    ).toBeGreaterThan(0);
  });

  it("promql value is zero-safe (0 passes)", () => {
    const base = validScheduled({
      _meta: defaultAddAlertMeta({ tab: "promql" }),
    });
    base.query_condition.type = "promql";
    base.query_condition.promql_condition = { operator: ">=", value: 0 };
    const m = issuesByPath(base);
    expect(m["query_condition.promql_condition.value"]).toBeUndefined();
  });

  it("blocks a partially-filled condition row (custom mode)", () => {
    const base = validScheduled();
    base.query_condition.conditions = {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "",
      conditions: [
        {
          filterType: "condition",
          column: "",
          operator: "=",
          value: "",
          logicalOperator: "AND",
        },
      ],
    };
    const m = issuesByPath(base);
    expect(
      m["query_condition.conditions.conditions.0.column"]?.length,
    ).toBeGreaterThan(0);
  });

  // ── Anomaly branch: near-pass-through — `name` ONLY ─────────────────────────
  // The detection-config fields live on AnomalyDetectionConfig's own form, so
  // this schema still ignores stream/query/settings in anomaly mode. `name` is
  // the exception: it is the one topbar field this form holds, and its blank
  // rule is re-homed here from saveAnomalyDetection's toast so the field can
  // actually highlight.
  it("does NOT validate stream/query/settings in anomaly mode", () => {
    const base = validScheduled({
      name: "my_anomaly",
      stream_type: "",
      stream_name: "",
      destinations: [],
      is_real_time: "anomaly",
    });
    expect(addAlertSchema.safeParse(base).success).toBe(true);
  });

  it("requires name in anomaly mode", () => {
    const base = validScheduled({
      name: "",
      stream_type: "",
      stream_name: "",
      destinations: [],
      is_real_time: "anomaly",
    });
    const m = issuesByPath(base);
    expect(m["name"]).toEqual(["Anomaly name is required."]);
    // Still the ONLY issue — nothing else tightened alongside it.
    expect(Object.keys(m)).toEqual(["name"]);
  });

  it("does NOT apply the alert special-chars rule to an anomaly name", () => {
    const base = validScheduled({
      name: "has space:and#chars",
      is_real_time: "anomaly",
    });
    expect(addAlertSchema.safeParse(base).success).toBe(true);
  });
});
