import { describe, it, expect } from "vitest";
import {
  buildPrefillFromPanel,
  executedPanelQuery,
  panelQueryChoices,
  type PanelPrefillInput,
} from "./fromPanel";
import { normalizePrefill, isPrefillBlocked, needsConfirmation } from "../alertPrefill";

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

  // Dashboard schema v5 moved fields.filter from an array to a group object.
  // Reading it as an array threw for EVERY v5 panel — filter or not — which took
  // the whole "create alert" click down with it.
  it("maps list filters when they arrive as a v5 filter group, nested groups included", () => {
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
              filter: {
                filterType: "group",
                logicalOperator: "AND",
                conditions: [
                  {
                    filterType: "condition",
                    type: "list",
                    column: "level",
                    values: ["error"],
                  },
                  {
                    filterType: "group",
                    logicalOperator: "AND",
                    conditions: [
                      {
                        filterType: "condition",
                        type: "list",
                        column: "namespace",
                        values: ["prod"],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      }),
      makeId,
    );

    expect(p.conditions?.conditions).toHaveLength(2);
    expect(p.conditions?.conditions[0]).toMatchObject({ column: "level", value: "error" });
    expect(p.conditions?.conditions[1]).toMatchObject({ column: "namespace", value: "prod" });
  });

  it("survives an empty v5 filter group — the shape every filter-less panel carries", () => {
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
              filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
            },
          },
        ],
      }),
      makeId,
    );

    expect(p.conditions).toBeUndefined();
    expect(p.streamName).toBe("k8s_logs");
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

const promqlPanel = (overrides: Partial<PanelPrefillInput> = {}): PanelPrefillInput => ({
  panelTitle: "Disk",
  panelType: "line",
  queryType: "promql",
  queries: [
    { query: "avg(disk_used)", fields: { stream: "disk_used", stream_type: "metrics" } },
    {
      query: "sum(rate(io_ops[$__rate_interval]))",
      tabName: "IO",
      fields: { stream: "io_ops", stream_type: "metrics" },
    },
  ],
  ...overrides,
});

describe("buildPrefillFromPanel — the query the user points at", () => {
  it("alerts on the panel query at queryIndex, not always the first", () => {
    const p = buildPrefillFromPanel(
      promqlPanel({ queryIndex: 1, executedQuery: "sum(rate(io_ops[1m]))" }),
      makeId,
    );
    expect(p.streamName).toBe("io_ops");
    expect(p.promql).toBe("sum(rate(io_ops[1m]))");
  });

  it("keeps the first query when no index is given", () => {
    const p = buildPrefillFromPanel(promqlPanel(), makeId);
    expect(p.streamName).toBe("disk_used");
    expect(p.promql).toBe("avg(disk_used)");
  });

  it("carries the query choices and the chosen index, which makes the dialog necessary", () => {
    const choices = [
      { index: 0, query: "avg(disk_used)" },
      { index: 1, tabName: "IO", query: "sum(rate(io_ops[1m]))" },
    ];
    const p = normalizePrefill(
      buildPrefillFromPanel(promqlPanel({ queryIndex: 1, queryChoices: choices }), makeId),
    );
    expect(p.queryChoices).toEqual(choices);
    expect(p.queryIndex).toBe(1);
    expect(needsConfirmation(p)).toBe(true);
  });

  it("does not ask for a dialog when there is only one choice", () => {
    const p = normalizePrefill(
      buildPrefillFromPanel(
        promqlPanel({ queryChoices: [{ index: 0, query: "avg(disk_used)" }] }),
        makeId,
      ),
    );
    expect(needsConfirmation(p)).toBe(false);
  });
});

describe("buildPrefillFromPanel — unresolved dashboard variables", () => {
  it("blocks raw text that still holds a variable when the query has no executed text", () => {
    const raw = 'up{host="$host"}';
    const p = buildPrefillFromPanel(
      promqlPanel({ queries: [{ query: raw, fields: { stream: "up" } }] }),
      makeId,
    );
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);

    const resolved = buildPrefillFromPanel(
      promqlPanel({
        queries: [{ query: raw, fields: { stream: "up" } }],
        executedQuery: 'up{host="a"}',
      }),
      makeId,
    );
    expect(isPrefillBlocked(normalizePrefill(resolved))).toBe(false);
  });

  it("lets a regex end anchor through", () => {
    const p = buildPrefillFromPanel(
      promqlPanel({ queries: [{ query: 'up{job=~"api$"}', fields: { stream: "up" } }] }),
      makeId,
    );
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
  });
});

describe("buildPrefillFromPanel — the Date pair a rendered panel holds", () => {
  const TWO_HOURS_US = 2 * 3_600_000_000;
  const START_US = 1_700_000_000_000_000;

  it("reads a dashboard's Dates, built from microsecond epochs, as the period", () => {
    const p = buildPrefillFromPanel(
      promqlPanel({
        timeRange: { start_time: new Date(START_US), end_time: new Date(START_US + TWO_HOURS_US) },
      }),
      makeId,
    );
    expect(p.periodMinutes).toBe(120);
  });

  it("reads the Explorer's Dates, built from millisecond epochs, as the same period", () => {
    const p = buildPrefillFromPanel(
      promqlPanel({
        timeRange: {
          start_time: new Date(START_US / 1000),
          end_time: new Date((START_US + TWO_HOURS_US) / 1000),
        },
      }),
      makeId,
    );
    expect(p.periodMinutes).toBe(120);
  });
});

describe("buildPrefillFromPanel — relative or absolute", () => {
  const HOUR_MS = 3_600_000;
  const NOW_MS = 1_800_000_000_000;
  const dates = (endMs: number, unit: number) => ({
    start_time: new Date((endMs - HOUR_MS) * unit),
    end_time: new Date(endMs * unit),
  });

  it("treats a window ending now as a rolling one, without the absolute-range warning", () => {
    for (const unit of [1, 1000]) {
      const p = buildPrefillFromPanel(
        promqlPanel({ timeRange: dates(NOW_MS - 30_000, unit), now: NOW_MS }),
        makeId,
      );
      expect(p.periodMinutes).toBe(60);
      expect(p.warnings.map((w) => w.key)).not.toContain("absoluteToRolling");
    }
  });

  it("warns for a window that ended in the past", () => {
    const p = buildPrefillFromPanel(
      promqlPanel({ timeRange: dates(NOW_MS - 24 * HOUR_MS, 1000), now: NOW_MS }),
      makeId,
    );
    expect(p.periodMinutes).toBe(60);
    expect(p.warnings.map((w) => w.key)).toContain("absoluteToRolling");
  });
});

describe("executedPanelQuery", () => {
  const metadata = [
    { query: "avg(disk_used)", panelQueryIndex: 0, timeRangeGap: { seconds: 0 } },
    { query: "sum(rate(io_ops[1m]))", panelQueryIndex: 1, timeRangeGap: { seconds: 0 } },
    { query: "avg(disk_used)", panelQueryIndex: 0, timeRangeGap: { seconds: 86_400_000 } },
  ];

  it("returns the primary window's executed text for a panel query", () => {
    expect(executedPanelQuery(metadata, 1)).toBe("sum(rate(io_ops[1m]))");
    expect(executedPanelQuery([metadata[2], metadata[0]], 0)).toBe("avg(disk_used)");
  });

  it("falls back to the positional entry when the metadata carries no panel index", () => {
    expect(executedPanelQuery([{ query: "a" }, { query: "b" }], 1)).toBe("b");
    expect(executedPanelQuery(undefined, 0)).toBeUndefined();
  });
});

describe("panelQueryChoices", () => {
  it("lists each visible query with its tab name and executed text", () => {
    const queries = promqlPanel().queries!;
    const metadata = [
      { query: "avg(disk_used)", panelQueryIndex: 0 },
      { query: "sum(rate(io_ops[1m]))", panelQueryIndex: 1 },
    ];
    expect(panelQueryChoices(queries, metadata)).toEqual([
      { index: 0, tabName: undefined, query: "avg(disk_used)" },
      { index: 1, tabName: "IO", query: "sum(rate(io_ops[1m]))" },
    ]);
    expect(panelQueryChoices(queries, metadata, [1])).toEqual([
      { index: 1, tabName: "IO", query: "sum(rate(io_ops[1m]))" },
    ]);
  });
});

describe("buildPrefillFromPanel — a formula query", () => {
  const formulaPanel = (formula: string, overrides: Partial<PanelPrefillInput> = {}) =>
    promqlPanel({
      queries: [
        {
          query: 'sum(rate(http_errors_total{code=~"5.."}[5m]))',
          fields: { stream: "http_errors_total", stream_type: "metrics" },
          config: { ref: "A", hide: true },
        },
        {
          query: "sum(rate(http_requests_total[5m]))",
          fields: { stream: "http_requests_total", stream_type: "metrics" },
          config: { ref: "B", hide: true },
        },
        {
          query: "",
          fields: { stream: "", stream_type: "metrics" },
          config: { formula },
        },
      ],
      queryIndex: 2,
      executedQuery:
        '(sum(rate(http_errors_total{code=~"5.."}[5m]))) / (sum(rate(http_requests_total[5m]))) * 100',
      ...overrides,
    });

  it("alerts on the combined expression and offers each input's metric as a stream", () => {
    const p = normalizePrefill(buildPrefillFromPanel(formulaPanel("A / B * 100"), makeId));
    expect(p.promql).toBe(
      '(sum(rate(http_errors_total{code=~"5.."}[5m]))) / (sum(rate(http_requests_total[5m]))) * 100',
    );
    expect(p.streamCandidates).toEqual([
      { name: "http_errors_total", type: "metrics" },
      { name: "http_requests_total", type: "metrics" },
    ]);
    expect(isPrefillBlocked(p)).toBe(false);
    expect(needsConfirmation(p)).toBe(true);
  });

  it("lists a metric two inputs share once, and needs no stream choice then", () => {
    const panel = formulaPanel("A / B");
    panel.queries![0].query = 'sum(rate(http_requests_total{code=~"5.."}[5m]))';
    const p = normalizePrefill(buildPrefillFromPanel(panel, makeId));
    expect(p.streamCandidates).toBeUndefined();
    expect(p.streamName).toBe("http_requests_total");
    expect(needsConfirmation(p)).toBe(false);
  });

  it("takes only the inputs the formula references, by stored letter", () => {
    const p = buildPrefillFromPanel(formulaPanel("B * 2"), makeId);
    expect(p.streamName).toBe("http_requests_total");
    expect(p.streamCandidates).toBeUndefined();
  });

  it("gives legacy inputs without a stored letter their positional one", () => {
    const panel = formulaPanel("A + B");
    delete panel.queries![0].config.ref;
    delete panel.queries![1].config.ref;
    const p = buildPrefillFromPanel(panel, makeId);
    expect(p.streamCandidates?.map((c) => c.name)).toEqual([
      "http_errors_total",
      "http_requests_total",
    ]);
  });

  it("reads code-mode inputs' metrics from their text, not the inherited stream pick", () => {
    const panel = formulaPanel("A / B * 100");
    panel.queries![0].fields.stream = "cpu_usage";
    panel.queries![1].fields.stream = "cpu_usage";
    const p = buildPrefillFromPanel(panel, makeId);
    expect(p.streamCandidates?.map((c) => c.name)).toEqual([
      "http_errors_total",
      "http_requests_total",
    ]);
  });

  it("finds the inputs' metrics when the inherited stream pick is empty", () => {
    const panel = formulaPanel("A / B * 100");
    panel.queries![0].fields.stream = "";
    panel.queries![1].fields.stream = "";
    const p = normalizePrefill(buildPrefillFromPanel(panel, makeId));
    expect(p.streamCandidates?.map((c) => c.name)).toEqual([
      "http_errors_total",
      "http_requests_total",
    ]);
    expect(isPrefillBlocked(p)).toBe(false);
  });

  it("prefers an input's executed text, so a metric behind a variable is still found", () => {
    const panel = formulaPanel("A / B", {
      metadataQueries: [
        { query: "sum(rate(errors_v2[1m]))", panelQueryIndex: 0, notSent: true },
        { query: "sum(rate(requests_v2[1m]))", panelQueryIndex: 1, notSent: true },
      ],
    });
    panel.queries![0].query = "sum(rate($errors[$__rate_interval]))";
    panel.queries![1].query = "sum(rate($requests[$__rate_interval]))";
    const p = buildPrefillFromPanel(panel, makeId);
    expect(p.streamCandidates?.map((c) => c.name)).toEqual(["errors_v2", "requests_v2"]);
  });

  it("takes a builder-mode input's metric from its builder stream", () => {
    const panel = formulaPanel("A / B");
    panel.queries![0].customQuery = false;
    panel.queries![0].fields.stream = "builder_metric";
    const p = buildPrefillFromPanel(panel, makeId);
    expect(p.streamCandidates?.map((c) => c.name)).toEqual([
      "builder_metric",
      "http_requests_total",
    ]);
  });

  it("leaves a plain query's single stream alone", () => {
    const p = buildPrefillFromPanel(formulaPanel("A / B", { queryIndex: 1 }), makeId);
    expect(p.streamName).toBe("http_requests_total");
    expect(p.streamCandidates).toBeUndefined();
  });
});
