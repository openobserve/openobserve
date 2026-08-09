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

/**
 * Dashboard **panel schemas** (version 2) for the query-detail history charts,
 * so they render through the shared `PanelSchemaRenderer` — the same engine
 * dashboards use — instead of a hand-built ECharts option object. That buys the
 * units, axes, legend, tooltip, timezone conversion and theming for free, and
 * keeps these two charts looking like every other chart in the product.
 *
 * The series are already computed CLIENT-side (`buildHistorySeries` +
 * `seriesValues`/`qpsValues`/`errorRateValues` in `history.ts`): the
 * `query/history` endpoint returns classified rollup windows, not a table the
 * renderer could query, and the below-top-N / live classification has no SQL
 * equivalent. So there is no query for the renderer to fire.
 * DECISION: use the renderer's pre-fetched-results injection path
 * (`injectedPromqlData` on PanelSchemaRenderer / usePanelDataLoader). Despite
 * the prop's name that branch does not look at `queryType` — it only needs
 * `data` to hold one entry per query in the shape the query executor would have
 * written. We hand it a `queryType: "sql"` panel plus one synthetic row per
 * window, the same technique VersionOverlayChart.vue and MetricCardChart.vue
 * use. See `buildHistoryRows` for the row shape.
 *
 * Two traps encoded here rather than discovered at runtime:
 *
 *  • The x column carries the raw MICROSECOND window timestamp. `isTimeStamp`
 *    in dateTimeUtils matches a 16-digit number, which is what promotes the
 *    axis to a real time axis; a millisecond value is 13 digits and would
 *    silently render as a category axis of unreadable integers.
 *  • `sqlTimeSeriesConverter` reads `metadata.queries[i].timeRangeGap.seconds`
 *    WITHOUT optional-chaining the `.seconds` (line 339), so injected metadata
 *    must carry `timeRangeGap: { seconds: 0 }` per query or the time-axis
 *    conversion throws and the panel renders blank.
 *
 * The builders are pure and exported so specs can assert on the schema and the
 * rows without mounting a chart or a canvas.
 */

import { chartColor } from "@/utils/chartTheme";
import type { I18nText } from "@/types/i18n";

import type { DbmHistoryPoint } from "@/utils/dbm/history";

/** One synthetic result row — the shape the SQL executor writes to `data[0]`. */
export interface DbmHistoryRow {
  /** Window end, MICROseconds. 16 digits, which is what makes the axis a time axis. */
  ts: number;
  [seriesKey: string]: number | null;
}

/** Column aliases. These are data accessors, not prose — never translated. */
export const DBM_X_FIELD = "ts";
export const DBM_LATENCY_FIELDS = ["p50", "p95", "p99"] as const;
export const DBM_VOLUME_FIELDS = ["qps", "error_rate"] as const;

interface AxisField {
  alias: string;
  column: string;
  color: string | null;
  label: I18nText | string;
}

const axisField = (name: string, label: I18nText | string): AxisField => ({
  alias: name,
  column: name,
  color: null,
  label,
});

/**
 * Config keys every panel needs, so a renderer branch that reads one does not
 * hit `undefined`. Only `unit`/`decimals`/`color`/type-specific keys differ
 * between the two panels, and those are supplied by the callers below.
 */
const baseConfig = () => ({
  show_legends: true,
  legends_position: "bottom",
  unit_custom: "",
  // A gap is a window we cannot speak for; connecting across it would draw a
  // straight line through unmeasured time and imply we measured it. This is the
  // §4.4 below-top-N rule expressed in the schema instead of a markArea.
  connect_nulls: false,
  no_value_replacement: "",
  axis_border_show: true,
  wrap_table_cells: false,
  base_map: { type: "osm" },
  map_view: { zoom: 1, lat: 0, lng: 0 },
  mark_line: [],
  drilldown: [],
});

/**
 * The queries array. `query` is never executed — the injected data
 * short-circuits the fetch — but it must be non-empty so the renderer's
 * `hasAtLeastOneQuery()` gate does not fall through to the empty state.
 */
const injectedQuery = (opts: { label: string; x: AxisField; y: AxisField[] }) => [
  {
    query: `-- injected: ${opts.label}`,
    customQuery: true,
    vrlFunctionQuery: "",
    fields: {
      stream: "",
      stream_type: "traces",
      x: [opts.x],
      y: opts.y,
      z: [],
      breakdown: [],
      filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      latitude: null,
      longitude: null,
      weight: null,
    },
    config: {
      promql_legend: "",
      layer_type: "scatter",
      weight_fixed: 1,
      limit: 0,
      min: 0,
      max: 100,
      time_shift: [],
    },
  },
];

/**
 * The latency panel: p50/p95/p99 as three y fields on one time axis.
 *
 * `nanoseconds` is the unit because every rollup metric on this page is ns
 * (`end_time - start_time` on a span, undivided) — the same unit the table
 * cells format with. Getting it wrong makes the chart read 1000x off the
 * headline stats sitting directly above it.
 */
export const buildLatencyPanelSchema = (names: {
  p50: I18nText;
  p95: I18nText;
  p99: I18nText;
  time: I18nText;
}): Record<string, unknown> => ({
  version: 2,
  id: "dbm-query-latency",
  // The card header above the renderer already carries the title; a panel title
  // here would render a second heading inside the plot area.
  title: "",
  description: "",
  type: "line",
  config: {
    ...baseConfig(),
    unit: "nanoseconds",
    decimals: 2,
    // Rollup windows are sparse — a range can contain a single measured window,
    // and a line with no symbol cannot draw a lone point.
    show_symbol: true,
    line_interpolation: "smooth",
    line_thickness: 2,
    // One colour per percentile. It must be `palette-classic-by-series`, which
    // hashes the series NAME into the palette: `palette-classic` returns null
    // from getSeriesColor (colorPalette.ts) and ignores `fixedColor` entirely,
    // so all three percentiles came out the same yellow, and `fixed` is worse —
    // it resolves every series to fixedColor[0]. Hashing the name also keeps
    // p95 the same colour across re-renders, which pinning by position does not
    // survive when a series is absent from a window.
    color: {
      mode: "palette-classic-by-series",
      seriesBy: "last",
    },
  },
  queryType: "sql",
  queries: injectedQuery({
    label: "dbm-latency",
    x: axisField(DBM_X_FIELD, names.time),
    y: [
      axisField(DBM_LATENCY_FIELDS[0], names.p50),
      axisField(DBM_LATENCY_FIELDS[1], names.p95),
      axisField(DBM_LATENCY_FIELDS[2], names.p99),
    ],
  }),
});

/**
 * The volume panel: calls-per-second bars with a failed-call rate line.
 *
 * A bar rather than a line because a call count is a quantity accumulated over
 * a window, not a continuous reading — and a missing bar reads as "nothing
 * here", which is the correct reading for an unmeasured window.
 *
 * `numbers` (not a percent unit) because the two series share one value axis
 * and the bars are the dominant one; the rate is emitted as a percentage
 * NUMBER by the caller so both sit on a comparable scale.
 *
 * TWO decimals, not zero: a call RATE is routinely sub-1 (a query running once
 * a minute is 0.017/s), and rounding to whole numbers collapses every such bar
 * label to "0" — verified against a real workload whose axis tops out at 0.21.
 */
export const buildVolumePanelSchema = (names: {
  qps: I18nText;
  errorRate: I18nText;
  time: I18nText;
}): Record<string, unknown> => ({
  version: 2,
  id: "dbm-query-volume",
  title: "",
  description: "",
  type: "bar",
  config: {
    ...baseConfig(),
    unit: "numbers",
    decimals: 2,
    show_symbol: false,
    line_interpolation: "smooth",
    line_thickness: 2,
    // Failures must be RED — that is meaning, not decoration, so it cannot be
    // left to a palette. `colorBySeries` maps a series NAME to a colour and is
    // the first thing getSeriesColor checks, which is the only mechanism that
    // survives: `palette-classic` ignores fixedColor outright and `fixed`
    // collapses every series onto fixedColor[0]. Calls keep the hashed palette
    // colour so the two are never confusable.
    color: {
      mode: "palette-classic-by-series",
      seriesBy: "last",
      colorBySeries: [
        // Calls is pinned too, not just failures: name-hashing picked magenta
        // for it, which reads as an alert for what is ordinary throughput. With
        // only two series and both carrying meaning, neither can be left to a
        // hash — blue is "normal traffic", red is "failing", as everywhere else.
        //
        // These MUST be resolved through chartColor(). Unlike the palette and
        // `fixedColor`, `colorBySeries` hands its `color` to ECharts verbatim
        // (getSeriesColor returns customMapping.color with no resolution), so a
        // raw `--color-*` token name is an invalid colour and paints black.
        //
        // Both tokens must also be ones chartTheme's FALLBACKS table knows:
        // chartColor returns "" for anything it cannot resolve, which is the
        // same black. That rules out `--color-severity-error-color`, so the
        // failure series uses the chart layer's own red.
        { value: names.qps, color: chartColor("--color-chart-series-1") },
        { value: names.errorRate, color: chartColor("--color-service-health-critical") },
      ],
    },
  },
  queryType: "sql",
  queries: injectedQuery({
    label: "dbm-volume",
    x: axisField(DBM_X_FIELD, names.time),
    y: [
      axisField(DBM_VOLUME_FIELDS[0], names.qps),
      axisField(DBM_VOLUME_FIELDS[1], names.errorRate),
    ],
  }),
});

/**
 * One row per history window, in the shape the SQL executor would have written.
 *
 * `values` is keyed by the y-field alias, and each array is aligned 1:1 with
 * `points` (that is the contract `seriesValues`/`qpsValues`/`errorRateValues`
 * already honour). A `null` stays `null` — it is a window we cannot speak for,
 * and coercing it to `0` is the exact bug the history module exists to prevent.
 */
export const buildHistoryRows = (
  points: DbmHistoryPoint[],
  values: Record<string, (number | null)[]>,
): DbmHistoryRow[] =>
  points.map((point, index) => {
    const row: DbmHistoryRow = { ts: point.timestamp };
    for (const [key, series] of Object.entries(values)) {
      row[key] = series[index] ?? null;
    }
    return row;
  });

/**
 * The injected-results envelope. `timeRangeGap` is mandatory, not decorative:
 * `sqlTimeSeriesConverter` dereferences `.seconds` without optional-chaining,
 * so omitting it throws mid-conversion and the panel renders blank.
 * `resultMetaData` must be a 2D array — the missing-value filler calls
 * `.map()` on each query's slot.
 */
export const buildInjectedHistoryData = (
  rows: DbmHistoryRow[],
  window: { startTime: number; endTime: number },
) => ({
  data: [rows],
  metadata: {
    queries: [
      {
        startTime: window.startTime,
        endTime: window.endTime,
        timeRangeGap: { seconds: 0 },
      },
    ],
  },
  resultMetaData: [[]],
});
