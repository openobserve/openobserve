import { describe, it, expect } from "vitest";
import { buildPrefillFromPanel, type PanelPrefillInput } from "./fromPanel";
import { normalizePrefill, isPrefillBlocked } from "../alertPrefill";

let idCounter = 0;
const makeId = () => `id-${idCounter++}`;

const sqlPanel = (overrides: Partial<PanelPrefillInput> = {}): PanelPrefillInput => ({
  panelTitle: "Error rate",
  panelType: "line",
  queryType: "sql",
  queries: [
    {
      query: 'SELECT count(*) as cnt FROM "k8s_logs"',
      customQuery: true,
      fields: { stream: "k8s_logs", stream_type: "logs" },
    },
  ],
  timeRange: { value_type: "relative", relative_value: 30, relative_period: "Minutes" },
  ...overrides,
});

describe("buildPrefillFromPanel", () => {
  it("maps a custom SQL panel", () => {
    const p = buildPrefillFromPanel(sqlPanel(), makeId);
    expect(p.source).toBe("panel");
    expect(p.queryType).toBe("sql");
    expect(p.sql).toBe('SELECT count(*) as cnt FROM "k8s_logs"');
    expect(p.streamName).toBe("k8s_logs");
    expect(p.streamType).toBe("logs");
    expect(p.periodMinutes).toBe(30);
    expect(p.name).toBe("Alert_from_Error_rate");
  });

  it("prefers the executed query over the raw one (variables substituted)", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({ executedQuery: "SELECT * FROM \"k8s_logs\" WHERE ns = 'prod'" }),
      makeId,
    );
    expect(p.sql).toBe("SELECT * FROM \"k8s_logs\" WHERE ns = 'prod'");
  });

  it("maps relative period units", () => {
    expect(
      buildPrefillFromPanel(
        sqlPanel({
          timeRange: { value_type: "relative", relative_value: 2, relative_period: "Hours" },
        }),
        makeId,
      ).periodMinutes,
    ).toBe(120);
    expect(
      buildPrefillFromPanel(
        sqlPanel({
          timeRange: { value_type: "relative", relative_value: 1, relative_period: "Days" },
        }),
        makeId,
      ).periodMinutes,
    ).toBe(1440);
  });

  it("warns on an unsupported panel type but still builds", () => {
    const p = buildPrefillFromPanel(sqlPanel({ panelType: "geomap" }), makeId);
    expect(p.warnings.map((w) => w.key)).toContain("unsupportedPanelType");
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
  });

  it("blocks a panel with no queries", () => {
    const p = normalizePrefill(buildPrefillFromPanel(sqlPanel({ queries: [] }), makeId));
    expect(p.warnings.map((w) => w.key)).toContain("noQueries");
    expect(isPrefillBlocked(p)).toBe(true);
  });

  it("lifts aggregation out of a built query's fields", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({
        queries: [
          {
            query: "SELECT …",
            customQuery: false,
            fields: {
              stream: "k8s_logs",
              stream_type: "logs",
              x: [{ column: "namespace", alias: "ns" }],
              y: [{ column: "code", alias: "total", aggregationFunction: "COUNT" }],
            },
          },
        ],
      }),
      makeId,
    );
    expect(p.aggregation).toEqual({
      group_by: ["ns"],
      function: "count",
      having: { column: "total", operator: ">=", value: 1 },
    });
  });

  it("applies a chart threshold to the aggregation having clause", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({
        threshold: 500,
        condition: "above",
        queries: [
          {
            query: "SELECT …",
            customQuery: false,
            fields: {
              stream: "k8s_logs",
              stream_type: "logs",
              y: [{ alias: "total", aggregationFunction: "count" }],
            },
          },
        ],
      }),
      makeId,
    );
    expect(p.aggregation?.having).toEqual({ column: "total", operator: ">=", value: 500 });
  });

  it("maps a 'below' condition to <=", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({
        threshold: 10,
        condition: "below",
        queries: [
          {
            query: "SELECT …",
            customQuery: false,
            fields: {
              stream: "s",
              stream_type: "logs",
              y: [{ alias: "t", aggregationFunction: "avg" }],
            },
          },
        ],
      }),
      makeId,
    );
    expect(p.aggregation?.having.operator).toBe("<=");
  });

  it("carries a raw-SQL threshold as meta.sqlHaving for the consumer's parser", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({ threshold: 42, condition: "above", yAxisColumn: "cnt" }),
      makeId,
    );
    expect(p.aggregation).toBeNull();
    expect(p.meta?.sqlHaving).toEqual({ column: "cnt", operator: ">=", value: 42 });
  });

  it("maps list filters onto alert conditions", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({
        queries: [
          {
            query: "SELECT …",
            customQuery: false,
            fields: {
              stream: "k8s_logs",
              stream_type: "logs",
              y: [{ alias: "c", aggregationFunction: "count" }],
              filter: [{ type: "list", column: "level", values: ["error"] }],
            },
          },
        ],
      }),
      makeId,
    );
    expect(p.conditions?.conditions[0]).toMatchObject({
      column: "level",
      operator: "=",
      value: "error",
    });
  });

  it("maps a promql panel with a threshold", () => {
    const p = buildPrefillFromPanel(
      {
        panelTitle: "CPU",
        queryType: "promql",
        queries: [{ query: "rate(cpu[5m])", fields: {} }],
        threshold: 0.9,
        condition: "above",
        timeRange: { value_type: "relative", relative_value: 5, relative_period: "Minutes" },
      },
      makeId,
    );
    expect(p.queryType).toBe("promql");
    expect(p.promql).toBe("rate(cpu[5m])");
    expect(p.streamType).toBe("metrics");
    expect(p.promqlCondition).toEqual({ column: "value", operator: ">=", value: 0.9 });
  });

  it("carries the VRL function through", () => {
    const p = buildPrefillFromPanel(
      sqlPanel({
        queries: [
          {
            query: "SELECT * FROM s",
            customQuery: true,
            fields: { stream: "s", stream_type: "logs" },
            vrlFunctionQuery: ".foo = 1",
          },
        ],
      }),
      makeId,
    );
    expect(p.vrlFunction).toBe(".foo = 1");
  });

  it("converts an absolute panel range to a rolling window", () => {
    const start = 1_700_000_000_000_000;
    const p = buildPrefillFromPanel(
      sqlPanel({
        timeRange: { value_type: "absolute", startTime: start, endTime: start + 45 * 60_000_000 },
      }),
      makeId,
    );
    expect(p.periodMinutes).toBe(45);
    expect(p.warnings.map((w) => w.key)).toContain("absoluteToRolling");
  });

  it("produces a prefill that satisfies the contract", () => {
    const p = normalizePrefill(buildPrefillFromPanel(sqlPanel(), makeId));
    expect(isPrefillBlocked(p)).toBe(false);
    expect(p.streamName).toBeTruthy();
    expect(p.periodMinutes).toBeGreaterThan(0);
  });
});
