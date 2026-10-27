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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertPanelData } from "./convertPanelData";
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";
import { convertTableData } from "./convertTableData";
import { convertPivotTableData } from "./convertPivotTableData";
import { convertStateTimelineData } from "./convertStateTimelineData";
import { epochToMillis, formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import {
  CATEGORY10_PALETTE,
  TABLEAU10_PALETTE,
  getColorPalette,
  getSeriesColor,
  getSeriesHash,
} from "./colorPalette";
import {
  buildValueMappingCache,
  lookupValueMappingFull,
  resolveMetricValueStyle,
  specialMatchOf,
} from "./tableConfigUtils";
import { applyLineAreaThresholds, normalizeThresholds } from "./thresholds";
import { createSeriesOverrideLookup, toSeriesOverrideEntry } from "./seriesOverrides";
import { TableConverter } from "./promql/convertPromQLTableChart";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });
const metadata = {
  queries: [
    {
      query: "SELECT 1",
      startTime: 1704067200000000,
      endTime: 1704068400000000,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
      panelQueryIndex: 0,
    },
  ],
};

const TIMES = ["2024-01-01T00:00:00", "2024-01-01T00:10:00"];
const timeX = {
  label: "Timestamp",
  alias: "x_axis_1",
  column: "_timestamp",
  functionName: "histogram",
  aggregationFunction: "histogram",
  args: [{ type: "field", value: { field: "_timestamp" } }],
};
const categoryX = { label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] };
const yField = {
  label: "Value",
  alias: "y_axis_1",
  column: "value",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "value" } }],
};

const sqlPanel = (type: string, config: Record<string, any> = {}, x: any = timeX) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        stream: "default",
        stream_type: "logs",
        x: [x],
        y: [yField],
        z: [],
        breakdown: [],
      },
      config: { min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, decimals: 1, ...config },
});

const promPanel = (type: string, config: Record<string, any> = {}) => ({
  id: "pq",
  type,
  queryType: "promql",
  queries: [
    {
      query: "up",
      customQuery: true,
      fields: { stream: "up", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "{job}", min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, decimals: 1, ...config },
});
const promMatrix = (values: string[]) => [
  {
    resultType: "matrix",
    result: [
      {
        metric: { job: "api" },
        values: values.map((v, i) => [1704067200 + i * 600, v]),
      },
    ],
  },
];

const viaPanel = async (panel: any, data: any[]) =>
  (
    (await convertPanelData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      panel.queryType === "promql" ? null : metadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const directSQL = async (panel: any, data: any[]) =>
  (
    (await convertMultiSQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      metadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const directPromQL = async (panel: any, data: any[]) =>
  (
    (await convertPromQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    )) as any
  ).options;

const timeRows = (values: unknown[]) => values.map((v, i) => ({ x_axis_1: TIMES[i], y_axis_1: v }));

const yAxisOf = (options: any) => (Array.isArray(options.yAxis) ? options.yAxis[0] : options.yAxis);
const sqlTooltip = (options: any, value: number) =>
  options.tooltip.formatter([
    {
      seriesName: "Value",
      seriesIndex: 0,
      dataIndex: 1,
      marker: "",
      name: TIMES[1],
      data: [TIMES[1], value],
      value: [TIMES[1], value],
    },
  ]);
const promTableValueColumn = (config: Record<string, any>, value: string) =>
  new TableConverter()
    .convert(
      [
        {
          series: [
            { metric: { job: "api" }, name: "api", data: [], values: [[1704067200, value]] },
          ],
          timestamps: [],
        },
      ] as any,
      { type: "table", config: { decimals: 1, promql_table_mode: "single", ...config } },
      store,
      { legends: [] } as any,
    )
    .columns.find((c: any) => c.field === "value");
const tableFormat = (table: any, field: string, value: unknown) =>
  table.columns.find((c: any) => c.field === field).format(value);

const pad = (n: number) => String(n).padStart(2, "0");
const localDateTime = (millis: number) => {
  const d = new Date(millis);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
};
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const MS_2024 = 1704067200000;

const format = (value: unknown, unit: string, decimals = 1) =>
  formatUnitValue(getUnitValue(value, unit, "", decimals));

// [unit, sample value, expected text]; the sample keeps a stable text whatever the axis decimals are.
const UNIT_CASES: Array<[string, unknown, string]> = [
  ["celsius", 21.5, "21.5°C"],
  ["fahrenheit", 70.5, "70.5°F"],
  ["hertz", 2500000, "2.5MHz"],
  ["bytes-per-sec", 2560, "2.5KiB/s"],
  ["boolean", 1, "true"],
  ["currency-yuan", 12.5, "¥12.5"],
  ["currency-won", 1200.5, "₩1,200.5"],
  ["datetime", MS_2024, localDateTime(MS_2024)],
  ["from-now", NOW - 5 * 60 * 1000, "5m ago"],
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("new units: getUnitValue", () => {
  it.each(UNIT_CASES)("formats %s", (unit, value, expected) => {
    expect(format(value, unit)).toBe(expected);
  });

  it("scales hertz and IEC byte rates through their ladders", () => {
    expect(format(950, "hertz")).toBe("950.0Hz");
    expect(format(1500, "hertz")).toBe("1.5kHz");
    expect(format(3.2e9, "hertz")).toBe("3.2GHz");
    expect(format(0, "hertz")).toBe("0.0Hz");
    expect(format(512, "bytes-per-sec")).toBe("512.0B/s");
    expect(format(3 * 1024 ** 2, "bytes-per-sec")).toBe("3.0MiB/s");
    expect(format(-2048, "bytes-per-sec")).toBe("-2.0KiB/s");
  });

  it("detects seconds, milliseconds, microseconds and nanoseconds since the epoch", () => {
    expect(epochToMillis(1704067200)).toBe(MS_2024);
    expect(epochToMillis(MS_2024)).toBe(MS_2024);
    expect(epochToMillis(MS_2024 * 1000)).toBe(MS_2024);
    expect(epochToMillis(MS_2024 * 1e6)).toBe(MS_2024);
    for (const value of [1704067200, MS_2024, MS_2024 * 1000, String(MS_2024 * 1000)]) {
      expect(format(value, "datetime")).toBe(localDateTime(MS_2024));
    }
    expect(format("2024-01-01T00:00:00Z", "datetime")).toBe(localDateTime(MS_2024));
  });

  it("reads the time from now in past and future, whatever the epoch unit", () => {
    expect(format((NOW - 3 * 3600 * 1000) * 1000, "from-now")).toBe("3h ago");
    expect(format(NOW / 1000 - 90, "from-now")).toBe("1m ago");
    expect(format(NOW + 2 * 86400 * 1000, "from-now")).toBe("in 2d");
    expect(format(NOW, "from-now")).toBe("0s ago");
  });

  it("reads booleans, numbers and their text forms", () => {
    expect(format(true, "boolean")).toBe("true");
    expect(format(false, "boolean")).toBe("false");
    expect(format(0, "boolean")).toBe("false");
    expect(format("TRUE", "boolean")).toBe("true");
    expect(format("false", "boolean")).toBe("false");
  });

  it("keeps missing and unreadable values as before", () => {
    expect(format("", "datetime")).toBe("-");
    expect(format("", "boolean")).toBe("-");
    expect(format("n/a", "datetime")).toBe("n/a");
    expect(getUnitValue(null, "boolean", "")).toEqual(getUnitValue(null, "default", ""));
  });

  it("formats temperatures with the panel decimals and leaves the existing currencies alone", () => {
    expect(format(-4, "celsius", 0)).toBe("-4°C");
    expect(format(12.5, "currency-yen")).toBe("¥12.5");
    expect(format(12.5, "currency-dollar")).toBe("$12.5");
  });
});

describe("new units on every formatting path", () => {
  it.each(UNIT_CASES)("SQL line axis label and tooltip use %s", async (unit, value, expected) => {
    const options = await viaPanel(sqlPanel("line", { unit }), [timeRows([value, value])]);
    expect(yAxisOf(options).axisLabel.formatter(value)).toBe(expected);
    expect(sqlTooltip(options, value as number)).toContain(expected);
  });

  it.each(UNIT_CASES)("PromQL line axis label uses %s", async (unit, value, expected) => {
    const options = await viaPanel(
      promPanel("line", { unit }),
      promMatrix([String(value), String(value)]),
    );
    expect(yAxisOf(options).axisLabel.formatter(value)).toBe(expected);
  });

  it.each(UNIT_CASES)("SQL table cells and a bar-gauge column use %s", (unit, value, expected) => {
    const panel = sqlPanel("table", { unit }, categoryX);
    const table: any = convertTableData(panel, [[{ x_axis_1: "/a", y_axis_1: value }]], store);
    expect(tableFormat(table, "y_axis_1", value)).toBe(expected);
    const gaugePanel = sqlPanel(
      "table",
      {
        unit,
        override_config: [
          {
            field: { matchBy: "name", value: "y_axis_1" },
            config: [{ type: "field_type", value: "bar_gauge" }],
          },
        ],
      },
      categoryX,
    );
    const gaugeTable: any = convertTableData(
      gaugePanel,
      [[{ x_axis_1: "/a", y_axis_1: value }]],
      store,
    );
    expect(tableFormat(gaugeTable, "y_axis_1", value)).toBe(expected);
  });

  it.each(UNIT_CASES)("a column unit override uses %s", (unit, value, expected) => {
    const panel = sqlPanel(
      "table",
      {
        unit: "default",
        override_config: [
          {
            field: { matchBy: "name", value: "y_axis_1" },
            config: [{ type: "unit", value: { unit, customUnit: "" } }],
          },
        ],
      },
      categoryX,
    );
    const table: any = convertTableData(panel, [[{ x_axis_1: "/a", y_axis_1: value }]], store);
    expect(tableFormat(table, "y_axis_1", value)).toBe(expected);
  });

  it.each(UNIT_CASES)("a series unit override uses %s", (unit, value, expected) => {
    const config = {
      decimals: 1,
      override_config: [toSeriesOverrideEntry({ matchBy: "name", value: "api", unit })],
    };
    expect(createSeriesOverrideLookup(config).formatValue(value, "api")).toBe(expected);
  });

  it.each(UNIT_CASES)("PromQL table values use %s", (unit, value, expected) => {
    expect(promTableValueColumn({ unit }, String(value)).format(String(value))).toBe(expected);
  });

  it.each(UNIT_CASES)("SQL and PromQL metric values use %s", async (unit, value, expected) => {
    const sql = await viaPanel(sqlPanel("metric", { unit }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: value }],
    ]);
    expect(sql.series[0]._metricText).toBe(expected);
    const prom = await viaPanel(promPanel("metric", { unit }), promMatrix([String(value)]));
    expect(prom.series[0]._metricText).toBe(expected);
  });

  it.each(UNIT_CASES)("the SQL gauge tooltip uses %s", async (unit, value, expected) => {
    const options = await viaPanel(sqlPanel("gauge", { unit }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: value }],
    ]);
    expect(options.tooltip.valueFormatter(value)).toBe(expected);
  });

  it("the gauge dial text uses the new units", async () => {
    const options = await viaPanel(sqlPanel("gauge", { unit: "celsius" }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: 21.5 }],
    ]);
    expect(options.series[0].data[0].detail.formatter(21.5)).toBe("21.5°C");
  });
});

describe("special value mappings", () => {
  const special = (match: string, text: string, color = "#ff0000") => ({
    type: "special",
    match,
    value: "",
    text,
    color,
  });
  const allSpecials = [
    special("null", "Nothing"),
    special("nan", "Not a number"),
    special("empty", "Blank"),
    special("true", "Yes"),
    special("false", "No"),
  ];

  it("classifies each special value", () => {
    expect(specialMatchOf(null)).toBe("null");
    expect(specialMatchOf(undefined)).toBe("null");
    expect(specialMatchOf(Number.NaN)).toBe("nan");
    expect(specialMatchOf("NaN")).toBe("nan");
    expect(specialMatchOf("")).toBe("empty");
    expect(specialMatchOf(true)).toBe("true");
    expect(specialMatchOf("False")).toBe("false");
    expect(specialMatchOf(0)).toBeNull();
    expect(specialMatchOf("null")).toBeNull();
    expect(specialMatchOf(" ")).toBeNull();
  });

  it("matches null, NaN, empty, true and false", () => {
    const cache = buildValueMappingCache(allSpecials);
    const text = (value: unknown) => lookupValueMappingFull(value, cache)?.text ?? null;
    expect(text(null)).toBe("Nothing");
    expect(text(undefined)).toBe("Nothing");
    expect(text(Number.NaN)).toBe("Not a number");
    expect(text("NaN")).toBe("Not a number");
    expect(text("")).toBe("Blank");
    expect(text(true)).toBe("Yes");
    expect(text("true")).toBe("Yes");
    expect(text(false)).toBe("No");
    expect(text(0)).toBeNull();
    expect(text("up")).toBeNull();
  });

  it("ignores a special mapping without a known match and keeps the other types working", () => {
    const cache = buildValueMappingCache([
      { type: "special", match: "zero", text: "Zero" },
      { type: "value", value: "1", text: "One" },
    ]);
    expect(lookupValueMappingFull(0, cache)).toBeNull();
    expect(lookupValueMappingFull(1, cache)?.text).toBe("One");
  });

  it("keeps missing table cells on the replacement when only a value mapping names null", () => {
    const panel = sqlPanel(
      "table",
      {
        unit: "default",
        no_value_replacement: "-",
        mappings: [{ type: "value", value: "null", text: "Text null" }],
      },
      categoryX,
    );
    const table: any = convertTableData(panel, [[{ x_axis_1: "/a", y_axis_1: 4 }]], store);
    expect(tableFormat(table, "y_axis_1", null)).toBe("-");
    expect(tableFormat(table, "x_axis_1", null)).toBe("-");
  });

  it("wins over the no-value replacement in SQL tables", () => {
    const panel = sqlPanel(
      "table",
      { unit: "default", no_value_replacement: "-", mappings: [special("null", "No reading")] },
      categoryX,
    );
    const table: any = convertTableData(
      panel,
      [
        [
          { x_axis_1: "/a", y_axis_1: 4 },
          { x_axis_1: "/b", y_axis_1: null },
        ],
      ],
      store,
    );
    expect(tableFormat(table, "y_axis_1", null)).toBe("No reading");
    expect(tableFormat(table, "y_axis_1", "")).toBe("-");
    expect(tableFormat(table, "x_axis_1", null)).toBe("No reading");
  });

  it("applies to pivot table cells", () => {
    const panel: any = sqlPanel(
      "table",
      { unit: "default", mappings: [special("null", "No reading")] },
      categoryX,
    );
    panel.queries[0].fields.breakdown = [
      { label: "Service", alias: "breakdown_1", column: "service", args: [] },
    ];
    const pivot: any = convertPivotTableData(
      panel,
      [
        [
          { x_axis_1: "/a", breakdown_1: "api", y_axis_1: 4 },
          { x_axis_1: "/b", breakdown_1: "web", y_axis_1: 2 },
        ],
      ],
      store,
    );
    const valueColumn = pivot.columns.find((c: any) => c.field !== "x_axis_1" && c.format);
    expect(valueColumn.format(null)).toBe("No reading");
  });

  it("applies to PromQL table values", () => {
    const column = promTableValueColumn({ mappings: [special("nan", "Not a number")] }, "NaN");
    expect(column.format("NaN")).toBe("Not a number");
  });

  it("sets the metric text and background on SQL and PromQL", async () => {
    const config = { unit: "default", mappings: [special("nan", "Not a number", "#00ff00")] };
    const style = resolveMetricValueStyle(Number.NaN, {
      mappings: config.mappings,
      unit: "default",
      customUnit: "",
      decimals: 1,
      panelBackground: "",
    });
    expect(style).toMatchObject({ text: "Not a number", bgColor: "#00ff00" });
    const prom = await viaPanel(promPanel("metric", config), promMatrix(["NaN"]));
    expect(prom.series[0]._metricText).toBe("Not a number");
    expect(prom.backgroundColor).toBe("#00ff00");
    const sql = await viaPanel(
      sqlPanel("metric", { ...config, mappings: [special("null", "None")] }, categoryX),
      [[{ x_axis_1: "/a", y_axis_1: null }]],
    );
    expect(sql.series[0]._metricText).toBe("None");
  });

  it("colours and names state timeline states", () => {
    const panel = {
      id: "st",
      type: "state-timeline",
      queryType: "sql",
      config: { mappings: [special("true", "Online", "#123456")] },
      queries: [
        {
          fields: {
            x: [{ alias: "x_axis_1" }],
            y: [{ alias: "y_axis_1", label: "online" }],
            breakdown: [],
          },
        },
      ],
    };
    const at = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, -1);
    const result: any = convertStateTimelineData(
      panel,
      [
        [
          { x_axis_1: at(0), y_axis_1: true },
          { x_axis_1: at(10), y_axis_1: false },
        ],
      ],
      store,
      null,
      [[{ histogram_interval: 10 }]],
      null,
    );
    const online = result.options.series[0].data.find((d: any) => d.state === "true");
    expect(online.itemStyle.color).toBe("#123456");
    expect(result.options.legend.data).toContain("Online");
  });
});

describe("no value replacement on metric, gauge and table", () => {
  it("replaces a missing SQL and PromQL metric value", async () => {
    const sql = await viaPanel(sqlPanel("metric", { no_value_replacement: "N/A" }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: null }],
    ]);
    expect(sql.series[0]._metricText).toBe("N/A");
    const prom = await viaPanel(
      promPanel("metric", { no_value_replacement: "N/A" }),
      promMatrix(["NaN"]),
    );
    expect(prom.series[0]._metricText).toBe("N/A");
  });

  it("keeps a real metric value and today's text without a replacement", async () => {
    const real = await viaPanel(sqlPanel("metric", { no_value_replacement: "N/A" }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: 0 }],
    ]);
    expect(real.series[0]._metricText).toBe("0.0");
    const without = await viaPanel(sqlPanel("metric", {}, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: null }],
    ]);
    expect(without.series[0]._metricText).toBe("0.0");
  });

  it("shows the replacement on a gauge dial with no value, on SQL and PromQL", async () => {
    const sql = await viaPanel(sqlPanel("gauge", { no_value_replacement: "N/A" }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: null }],
    ]);
    expect(sql.series[0].data[0].detail.formatter(0)).toBe("N/A");
    const real = await viaPanel(sqlPanel("gauge", { no_value_replacement: "N/A" }, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: 40 }],
    ]);
    expect(real.series[0].data[0].detail.formatter(40)).toBe("40.0");
    const prom = await viaPanel(
      promPanel("gauge", { no_value_replacement: "N/A" }),
      promMatrix(["NaN"]),
    );
    expect(prom.series[0].data[0].detail.formatter(0)).toBe("N/A");
  });

  it("replaces missing PromQL table values only when set", () => {
    const replaced = promTableValueColumn({ no_value_replacement: "N/A" }, "NaN");
    expect(replaced.format("NaN")).toBe("N/A");
    expect(replaced.format("5")).toBe("5.0");
    expect(promTableValueColumn({}, "NaN").format("NaN")).toBe(
      formatUnitValue(getUnitValue("NaN", undefined as any, undefined as any, 1)),
    );
  });

  it("renders gauges exactly as today while the replacement is empty", async () => {
    const panel = sqlPanel("gauge", { no_value_replacement: "" }, categoryX);
    const data = [[{ x_axis_1: "/a", y_axis_1: null }]];
    expect(serialize(await viaPanel(panel, data))).toBe(serialize(await directSQL(panel, data)));
  });
});

describe("color palettes", () => {
  const cfg = (mode: string, extra: Record<string, any> = {}) => ({ mode, ...extra }) as any;

  it("hashes series names into Category 10 and Tableau 10", () => {
    for (const [mode, palette] of [
      ["palette-category10", CATEGORY10_PALETTE],
      ["palette-tableau10", TABLEAU10_PALETTE],
    ] as const) {
      const color = getSeriesColor(cfg(mode), "api", [1], 0, 10, "light");
      expect(color).toBe(palette[getSeriesHash("api", palette)]);
      expect(getSeriesColor(cfg(mode), "api", [5], 0, 10, "dark")).toBe(color);
    }
  });

  it("colours each series by the threshold step of its value", () => {
    const config = {
      thresholds: {
        mode: "absolute",
        baseColor: "#00aa00",
        steps: [
          { value: 50, color: "#ffaa00" },
          { value: 90, color: "#ff0000" },
        ],
      },
    };
    const color = (values: any[], seriesBy?: string) =>
      getSeriesColor(
        cfg("palette-from-thresholds", { seriesBy }),
        "api",
        values,
        0,
        100,
        "light",
        undefined,
        config,
      );
    expect(color([10, 95])).toBe("#ff0000");
    expect(color([10, 60])).toBe("#ffaa00");
    expect(color([10, 20])).toBe("#00aa00");
    expect(color([10, 95], "min")).toBe("#00aa00");
    expect(color(["60", "95"])).toBe("#ff0000");
  });

  it("resolves percentage steps over the chart range and falls back to the classic palette", () => {
    const config = { thresholds: { mode: "percentage", steps: [{ value: 50, color: "#ff0000" }] } };
    const mode = cfg("palette-from-thresholds");
    expect(getSeriesColor(mode, "api", [150], 0, 200, "light", undefined, config)).toBe("#ff0000");
    const classic = getColorPalette();
    const fallback = classic[getSeriesHash("api", classic)];
    expect(getSeriesColor(mode, "api", [20], 0, 200, "light", undefined, config)).toBe(fallback);
    expect(getSeriesColor(mode, "api", [20], 0, 200, "light")).toBe(fallback);
  });

  it("reaches SQL and PromQL line series, pies and gauges", async () => {
    const config = {
      unit: "default",
      color: { mode: "palette-from-thresholds", fixedColor: [], seriesBy: "last" },
      thresholds: { mode: "absolute", showAs: "line", steps: [{ value: 50, color: "#ff0000" }] },
    };
    const sql = await viaPanel(sqlPanel("line", config), [timeRows([10, 80])]);
    expect(sql.series[0].itemStyle?.color ?? sql.series[0].color).toBe("#ff0000");
    const prom = await viaPanel(promPanel("line", config), promMatrix(["10", "80"]));
    const promSeries = prom.series.find((s: any) => s.name === "api");
    expect(promSeries.itemStyle?.color ?? promSeries.color ?? promSeries.lineStyle?.color).toBe(
      "#ff0000",
    );
    const gauge = await viaPanel(sqlPanel("gauge", config, categoryX), [
      [{ x_axis_1: "/a", y_axis_1: 80 }],
    ]);
    expect(gauge.series[0].data[0].itemStyle.color).toBe("#ff0000");
    const tableau = await viaPanel(
      sqlPanel("pie", { color: { mode: "palette-tableau10", fixedColor: [] } }, categoryX),
      [[{ x_axis_1: "/a", y_axis_1: 4 }]],
    );
    const pie = tableau.series.find((s: any) => s.type === "pie");
    const sliceColor = pie.itemStyle.color({ name: "/a", value: 4 });
    expect(sliceColor).toBe(TABLEAU10_PALETTE[getSeriesHash("/a", TABLEAU10_PALETTE)]);
  });
});

describe("thresholds shown as a dashed line", () => {
  const panel = (showAs: string) => ({
    type: "line",
    config: {
      thresholds: {
        mode: "absolute",
        showAs,
        steps: [
          { value: 50, color: "#ffaa00" },
          { value: 90, color: "#ff0000" },
        ],
      },
    },
  });
  const optionsWith = (showAs: string) => {
    const options: any = {
      xAxis: { type: "time" },
      yAxis: { type: "value" },
      series: [
        {
          name: "api",
          type: "line",
          data: [
            [0, 10],
            [1, 95],
          ],
        },
      ],
      tooltip: {},
    };
    applyLineAreaThresholds(options, panel(showAs));
    return options;
  };

  it("is a known show-as value", () => {
    expect(normalizeThresholds(panel("dashed_line").config.thresholds)?.showAs).toBe("dashed_line");
  });

  it("draws every limit with the same dash and leaves the series colour alone", () => {
    const options = optionsWith("dashed_line");
    const lines = options.series.find((s: any) => s.markLine).markLine.data;
    expect(lines.map((l: any) => l.lineStyle.type)).toEqual([
      [6, 4],
      [6, 4],
    ]);
    expect(lines.map((l: any) => l.lineStyle.color)).toEqual(["#ffaa00", "#ff0000"]);
    expect(options.visualMap).toBeUndefined();
  });

  it("keeps the stepped dashes of Limit line only", () => {
    const lines = optionsWith("line").series.find((s: any) => s.markLine).markLine.data;
    expect(lines[0].lineStyle.type).not.toEqual(lines[1].lineStyle.type);
  });

  it("reaches a converted SQL line chart", async () => {
    const options = await viaPanel(
      sqlPanel("line", {
        unit: "default",
        thresholds: {
          mode: "absolute",
          showAs: "dashed_line",
          steps: [{ value: 50, color: "#f00" }],
        },
      }),
      [timeRows([10, 80])],
    );
    const marker = options.series.find((s: any) => s.markLine?.data?.length);
    expect(marker.markLine.data[0].lineStyle.type).toEqual([6, 4]);
  });
});

describe("absent keys render exactly as today", () => {
  it.each(["metric", "gauge", "table"])("SQL %s without a replacement", async (type) => {
    const panel = sqlPanel(type, { unit: "default" }, categoryX);
    const data = [[{ x_axis_1: "/a", y_axis_1: 4 }]];
    if (type === "table") {
      const direct: any = convertTableData(panel, data, store);
      const viaConvert: any = await convertPanelData(
        panel,
        data,
        store,
        panelRef(),
        { value: null },
        { value: [] },
        metadata,
        { height: "400px" },
        { value: [] },
        false,
      );
      expect(serialize(viaConvert.columns)).toBe(serialize(direct.columns));
      return;
    }
    expect(serialize(await viaPanel(panel, data))).toBe(serialize(await directSQL(panel, data)));
  });

  it("PromQL gauge without a replacement", async () => {
    const panel = promPanel("gauge", { unit: "default" });
    expect(serialize(await viaPanel(panel, promMatrix(["NaN"])))).toBe(
      serialize(await directPromQL(panel, promMatrix(["NaN"]))),
    );
  });
});
