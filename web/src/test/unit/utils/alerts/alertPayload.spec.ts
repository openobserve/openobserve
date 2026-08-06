import { describe, it, expect } from "vitest";
import { getAlertPayload } from "@/utils/alerts/alertPayload";

// Warning-field normalization (alerts_2.md Feature 1). OFormInput emits raw
// strings and a cleared field leaves "": both must be repaired before the
// payload reaches numeric Option<> fields in Rust — a string 400s, and a
// serialized "" is worse than absent.

const makeFormData = (overrides: any = {}): any => ({
  name: "a1",
  description: "",
  is_real_time: "false",
  trigger_condition: {
    threshold: "3",
    operator: ">=",
    period: "10",
    frequency: "10",
    silence: "0",
    ...(overrides.trigger_condition ?? {}),
  },
  context_attributes: [],
  query_condition: {
    type: "custom",
    conditions: [],
    sql: "",
    ...(overrides.query_condition ?? {}),
  },
  stream_name: "s",
  stream_type: "logs",
});

const makeContext = (opts: { aggregation?: boolean; tab?: string } = {}): any => ({
  store: { state: { userInfo: { email: "t@example.com" } } },
  isAggregationEnabled: { value: opts.aggregation ?? false },
  getSelectedTab: { value: opts.tab ?? "sql" },
  beingUpdated: false,
});

describe("getAlertPayload warning-field normalization", () => {
  it("count warning_threshold ships as a number, not the input's string", () => {
    const payload = getAlertPayload(
      makeFormData({ trigger_condition: { warning_threshold: "96" } }),
      makeContext({ tab: "sql" }),
    );
    expect(payload.trigger_condition.warning_threshold).toBe(96);
  });

  it("a cleared warning ('' from the input) is DELETED, not serialized", () => {
    const payload = getAlertPayload(
      makeFormData({ trigger_condition: { warning_threshold: "" } }),
      makeContext({ tab: "sql" }),
    );
    expect("warning_threshold" in payload.trigger_condition).toBe(false);
  });

  it("aggregation warning_value ships numeric; blank is deleted", () => {
    const agg = {
      group_by: ["host"],
      function: "avg",
      having: { column: "value", operator: ">=", value: "85" },
      warning_value: "70.5",
    };
    const payload = getAlertPayload(
      makeFormData({ query_condition: { aggregation: agg } }),
      makeContext({ aggregation: true, tab: "custom" }),
    );
    expect(payload.query_condition.aggregation.warning_value).toBe(70.5);

    const blank = getAlertPayload(
      makeFormData({
        query_condition: { aggregation: { ...agg, warning_value: "" } },
      }),
      makeContext({ aggregation: true, tab: "custom" }),
    );
    expect("warning_value" in blank.query_condition.aggregation).toBe(false);
  });

  it("promql_warning_value ships numeric on the promql tab", () => {
    const payload = getAlertPayload(
      makeFormData({
        query_condition: {
          type: "promql",
          promql: "up",
          promql_condition: { column: "value", operator: ">=", value: "1" },
          promql_warning_value: "0.9",
        },
      }),
      makeContext({ tab: "promql" }),
    );
    expect(payload.query_condition.promql_warning_value).toBe(0.9);
  });

  // D13 family exclusivity: a warning left over from another tab/mode must
  // not ship — the backend now rejects e.g. warning_threshold on
  // aggregation/PromQL alerts.
  it("stale count warning is dropped when switching to promql", () => {
    const payload = getAlertPayload(
      makeFormData({
        trigger_condition: { warning_threshold: "5" },
        query_condition: {
          type: "promql",
          promql: "up",
          promql_condition: { column: "value", operator: ">=", value: "1" },
        },
      }),
      makeContext({ tab: "promql" }),
    );
    expect("warning_threshold" in payload.trigger_condition).toBe(false);
  });

  it("stale count warning is dropped on aggregation (builder) alerts", () => {
    const payload = getAlertPayload(
      makeFormData({
        trigger_condition: { warning_threshold: "5" },
        query_condition: {
          aggregation: {
            group_by: ["host"],
            function: "avg",
            having: { column: "value", operator: ">=", value: "85" },
          },
        },
      }),
      makeContext({ aggregation: true, tab: "custom" }),
    );
    expect("warning_threshold" in payload.trigger_condition).toBe(false);
  });

  // D12: realtime alerts carry no warning family at all. A user can configure
  // a scheduled warning THEN switch to realtime — the hidden fields must not
  // ship, or the backend's realtime rejection makes the form unsaveable.
  it("realtime strips every warning field and notify_on_warning", () => {
    const payload = getAlertPayload(
      makeFormData({ trigger_condition: { warning_threshold: "5", notify_on_warning: false } }),
      { ...makeContext({ tab: "custom" }) },
    );
    // baseline sanity: scheduled keeps it
    expect(payload.trigger_condition.warning_threshold).toBe(5);

    const realtime = getAlertPayload(
      {
        ...makeFormData({
          trigger_condition: { warning_threshold: "5", notify_on_warning: false },
          query_condition: {
            aggregation: {
              group_by: [],
              function: "avg",
              having: { column: "value", operator: ">=", value: "85" },
              warning_value: "70",
            },
            promql_warning_value: "0.9",
          },
        }),
        is_real_time: "true",
      },
      makeContext({ tab: "custom", aggregation: true }),
    );
    expect("warning_threshold" in realtime.trigger_condition).toBe(false);
    expect("notify_on_warning" in realtime.trigger_condition).toBe(false);
    expect("promql_warning_value" in realtime.query_condition).toBe(false);
    if (realtime.query_condition.aggregation) {
      expect("warning_value" in realtime.query_condition.aggregation).toBe(false);
    }
  });

  it("notify_on_warning is dropped when no warning is configured", () => {
    const payload = getAlertPayload(
      makeFormData({ trigger_condition: { notify_on_warning: true } }),
      makeContext({ tab: "sql" }),
    );
    expect("notify_on_warning" in payload.trigger_condition).toBe(false);
  });

  it("notify_on_warning is always dropped (removed from UI — warnings always notify)", () => {
    const payload = getAlertPayload(
      makeFormData({
        trigger_condition: { warning_threshold: "2", notify_on_warning: false },
      }),
      makeContext({ tab: "sql" }),
    );
    // Never emitted, so the backend applies its default (unwrap_or(true) = notify).
    expect("notify_on_warning" in payload.trigger_condition).toBe(false);
  });

  it("stale promql warning is dropped on non-promql tabs", () => {
    const payload = getAlertPayload(
      makeFormData({
        query_condition: { promql_warning_value: "0.9" },
      }),
      makeContext({ tab: "sql" }),
    );
    expect("promql_warning_value" in payload.query_condition).toBe(false);
  });
});

// Feature 2 (PT-1/PT-6): priority & tags reach the API in the shapes the
// backend expects, and are ABSENT when unset so pre-Feature-2 alerts are
// byte-identical.
describe("getAlertPayload priority & tags", () => {
  it("priority ships as an integer even though the select yields a string", () => {
    const payload = getAlertPayload(
      { ...makeFormData(), priority: "2" } as any,
      makeContext({ tab: "sql" }),
    );
    expect(payload.priority).toBe(2);
  });

  it("unset priority is deleted, never sent as null or 0", () => {
    for (const unset of [null, undefined, ""]) {
      const payload = getAlertPayload(
        { ...makeFormData(), priority: unset } as any,
        makeContext({ tab: "sql" }),
      );
      expect("priority" in payload).toBe(false);
    }
  });

  it("tags ship as an array and are dropped when empty", () => {
    const withTags = getAlertPayload(
      { ...makeFormData(), tags: ["prod", "service:checkout"] } as any,
      makeContext({ tab: "sql" }),
    );
    expect(withTags.tags).toEqual(["prod", "service:checkout"]);

    const empty = getAlertPayload(
      { ...makeFormData(), tags: [] } as any,
      makeContext({ tab: "sql" }),
    );
    expect("tags" in empty).toBe(false);
  });
});
