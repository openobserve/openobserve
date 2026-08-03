// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { buildPanelAutoName, buildAlertAutoName } from "./autoName";

/** Stand-in for vue-i18n's `t`, using the real en-US templates. */
const templates: Record<string, string> = {
  "dashboard.autoName.recordCount": "record count",
  "dashboard.autoName.measure": "{fn} of {field}",
  "dashboard.autoName.measureByDimension": "{subject} by {dimension}",
  "dashboard.autoName.streamOverview": "{stream} overview",
  "alerts.autoName.anomaly": "anomaly_{stream}",
  "alerts.autoName.realTime": "realtime_{stream}",
  "alerts.autoName.queryAlert": "{stream}_query_alert",
  "alerts.autoName.streamAlert": "{stream}_alert",
  "alerts.autoName.aggregation": "{stream}_{fn}_{field}",
  "alerts.autoName.condition": "{stream}_{column}_{operator}_{value}",
};

const t = (key: string, params: Record<string, unknown> = {}) =>
  (templates[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));

const panel = (fields: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  data: {
    type: "bar",
    queries: [{ customQuery: false, fields: { stream: "k8s_logs", ...fields } }],
    ...overrides,
  },
  layout: { currentQueryIndex: 0 },
});

describe("buildPanelAutoName", () => {
  it("names a panel after its measure", () => {
    const name = buildPanelAutoName(
      panel({ y: [{ column: "duration", aggregationFunction: "avg" }] }),
      t,
    );

    expect(name).toBe("Avg of duration");
  });

  it("adds the breakdown as the 'by' dimension", () => {
    const name = buildPanelAutoName(
      panel({
        y: [{ column: "duration", aggregationFunction: "avg" }],
        breakdown: [{ column: "service" }],
      }),
      t,
    );

    expect(name).toBe("Avg of duration by service");
  });

  it("reads count(_timestamp) as a record count rather than a field measure", () => {
    const name = buildPanelAutoName(
      panel({ y: [{ column: "_timestamp", aggregationFunction: "count" }] }),
      t,
    );

    expect(name).toBe("Record count");
  });

  it("uses a non-time X field as the dimension when there is no breakdown", () => {
    const name = buildPanelAutoName(
      panel({
        x: [{ column: "status_code" }],
        y: [{ column: "_timestamp", aggregationFunction: "count" }],
      }),
      t,
    );

    expect(name).toBe("Record count by status_code");
  });

  it("ignores the time bucket on the X axis", () => {
    const name = buildPanelAutoName(
      panel({
        x: [{ column: "_timestamp", aggregationFunction: "histogram" }],
        y: [{ column: "duration", aggregationFunction: "max" }],
      }),
      t,
    );

    expect(name).toBe("Max of duration");
  });

  it("names after the first two measures and drops the rest (no '+N more' clutter)", () => {
    const name = buildPanelAutoName(
      panel({
        y: [
          { column: "duration", aggregationFunction: "avg" },
          { column: "duration", aggregationFunction: "max" },
          { column: "duration", aggregationFunction: "min" },
        ],
      }),
      t,
    );

    expect(name).toBe("Avg of duration, Max of duration");
  });

  it("prefers a field's display label over its column", () => {
    const name = buildPanelAutoName(
      panel({ y: [{ label: "Latency", column: "duration", aggregationFunction: "p99" }] }),
      t,
    );

    expect(name).toBe("P99 of Latency");
  });

  it("falls back to the stream when no measure is configured yet", () => {
    expect(buildPanelAutoName(panel({ y: [] }), t)).toBe("K8s_logs overview");
  });

  it("does not name a panel after generated SQL aliases", () => {
    const custom = panel({ y: [{ alias: "y_axis_1", aggregationFunction: "count" }] });
    custom.data.queries[0].customQuery = true;

    expect(buildPanelAutoName(custom, t)).toBe("K8s_logs overview");
  });

  it("has nothing to say about a fieldless markdown panel with no stream", () => {
    const markdown = panel({ stream: "", y: [] }, { type: "markdown" });

    expect(buildPanelAutoName(markdown, t)).toBe("");
  });

  it("returns an empty name rather than throwing on an unbuilt panel", () => {
    expect(buildPanelAutoName(undefined, t)).toBe("");
    expect(buildPanelAutoName({ data: { queries: [] } }, t)).toBe("");
  });

  // The BUILDER shape is what usePanelFields actually writes today: the column
  // lives in `args[{type:'field'}].value.field`, the aggregation in
  // `functionName`, and the time flag in `treatAsNonTimestamp`. The legacy
  // `{column, aggregationFunction}` shape above is the older/imported form. These
  // guard the args-traversal / functionName / treatAsNonTimestamp branches that
  // the "_timestamp by Cost" bug originally slipped through.
  describe("builder-shape fields", () => {
    const yField = (fn: string, field: string, extra: Record<string, unknown> = {}) => ({
      functionName: fn,
      args: [{ type: "field", value: { field } }],
      treatAsNonTimestamp: true,
      ...extra,
    });

    it("names a builder-shape measure (column read from args, aggregation from functionName)", () => {
      expect(buildPanelAutoName(panel({ y: [yField("avg", "duration")] }), t)).toBe(
        "Avg of duration",
      );
    });

    it("reads a builder count on the time column as a record count", () => {
      // treatAsNonTimestamp:false marks the field AS the time column, even when
      // its name isn't the default `_timestamp`.
      const field = yField("count", "event_time", { treatAsNonTimestamp: false });
      expect(buildPanelAutoName(panel({ y: [field] }), t)).toBe("Record count");
    });

    it("uses a builder breakdown as the 'by' dimension", () => {
      expect(
        buildPanelAutoName(
          panel({ y: [yField("avg", "duration")], breakdown: [yField("count", "service")] }),
          t,
        ),
      ).toBe("Avg of duration by service");
    });

    it("honours a deployment's custom timestamp_column for a builder count", () => {
      // Column matches the configured time column by NAME (no treatAsNonTimestamp).
      const field = {
        functionName: "count",
        args: [{ type: "field", value: { field: "event_time" } }],
      };
      expect(buildPanelAutoName(panel({ y: [field] }), t, { timestampColumn: "event_time" })).toBe(
        "Record count",
      );
    });
  });
});

const alert = (overrides: Record<string, unknown> = {}) => ({
  stream_name: "k8s_logs",
  is_real_time: "false",
  query_condition: {
    type: "custom",
    conditions: { filterType: "group", conditions: [] },
    aggregation: null,
  },
  ...overrides,
});

describe("buildAlertAutoName", () => {
  it("says nothing until a stream is chosen", () => {
    expect(buildAlertAutoName(alert({ stream_name: "" }), t)).toBe("");
  });

  it("names a condition alert after the condition it watches", () => {
    const name = buildAlertAutoName(
      alert({
        query_condition: {
          type: "custom",
          conditions: {
            filterType: "group",
            conditions: [{ column: "status", operator: ">=", value: 500 }],
          },
        },
      }),
      t,
    );

    expect(name).toBe("k8s_logs_status_gte_500");
  });

  it("produces a name the alert-name rule accepts (no spaces or reserved chars)", () => {
    const name = buildAlertAutoName(
      alert({
        stream_name: "prod logs",
        query_condition: {
          type: "custom",
          conditions: {
            filterType: "group",
            conditions: [{ column: "user:id", operator: "=", value: "a b" }],
          },
        },
      }),
      t,
    );

    expect(name).toBe("prod_logs_user_id_eq_a_b");
    expect(name).not.toMatch(/[:#?\s'"%&]/);
  });

  it("reaches into nested condition groups for the first real condition", () => {
    const name = buildAlertAutoName(
      alert({
        query_condition: {
          type: "custom",
          conditions: {
            filterType: "group",
            conditions: [
              {
                filterType: "group",
                conditions: [{ column: "level", operator: "=", value: "error" }],
              },
            ],
          },
        },
      }),
      t,
    );

    expect(name).toBe("k8s_logs_level_eq_error");
  });

  it("prefers the aggregation over a condition when one is configured", () => {
    const name = buildAlertAutoName(
      alert({
        query_condition: {
          type: "custom",
          conditions: {
            filterType: "group",
            conditions: [{ column: "status", operator: ">=", value: 500 }],
          },
          aggregation: { function: "avg", having: { column: "latency", operator: ">=", value: 1 } },
        },
      }),
      t,
    );

    expect(name).toBe("k8s_logs_avg_latency");
  });

  it("marks real-time and anomaly alerts by their kind", () => {
    expect(buildAlertAutoName(alert({ is_real_time: "true" }), t)).toBe("realtime_k8s_logs");
    expect(buildAlertAutoName(alert({ is_real_time: "anomaly" }), t)).toBe("anomaly_k8s_logs");
  });

  it("does not try to summarise a hand-written query", () => {
    const name = buildAlertAutoName(
      alert({ query_condition: { type: "sql", sql: "SELECT 1", conditions: {} } }),
      t,
    );

    expect(name).toBe("k8s_logs_query_alert");
  });

  it("falls back to the stream when nothing is configured beyond it", () => {
    expect(buildAlertAutoName(alert(), t)).toBe("k8s_logs_alert");
  });
});
