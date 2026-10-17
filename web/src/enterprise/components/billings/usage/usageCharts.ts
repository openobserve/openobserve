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

import type { TranslateFn } from "@/types/i18n";
import { chartAxisLine, chartBg, chartColor, chartTextColor } from "@/utils/chartTheme";
import { createBaseLegendConfig } from "@/utils/dashboard/legendConfiguration";
import { meterForEvent, METERS, type MeteringDetails, type MeterKey } from "./meteringModel";
import { cyclePrices, PRICED_EVENTS, type CostRow, type Forecast } from "./trendsModel";
import { trendsCostSql, USAGE_STREAM_NAME } from "./usageQueries";

/** A `mark_line` entry of the dashboards engine: a horizontal line at `value` on the y axis. */
export interface MarkLine {
  name: string;
  type: "yAxis";
  value: number;
  color?: string;
}

export interface SeriesColor {
  value: string;
  color: string;
}

/** A meter keeps its palette slot across every usage view, so colour means one thing. */
export function meterColorFor(key: MeterKey): string {
  const slot =
    (Math.max(
      METERS.findIndex((def) => def.key === key),
      0,
    ) %
      12) +
    1;
  return chartColor(`--color-chart-series-${slot}`);
}

/** A palette slot by position, for series that are not meters, such as a super org's orgs. */
export function paletteColor(index: number): string {
  return chartColor(`--color-chart-series-${(Math.max(index, 0) % 12) + 1}`);
}

const HEX = /^#([0-9a-f]{6})$/i;

/** Steps of one colour mixed toward `toward`; a non-hex value on either side is returned unchanged. */
export function shadeOf(color: string, step: number, toward: string): string {
  const from = HEX.exec(color.trim());
  const to = HEX.exec(toward.trim());
  if (!from || !to) return color;
  const mix = Math.min(step * 0.17, 0.85);
  const channels = (hex: string) =>
    [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const target = channels(to[1]);
  const mixed = channels(from[1]).map((channel, index) =>
    Math.round(channel + (target[index] - channel) * mix),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Top entities in shades of their meter, and the remainder in the neutral axis colour. */
export function entitySeriesColors(
  meterKey: MeterKey,
  names: string[],
  otherLabel: string,
): SeriesColor[] {
  const base = meterColorFor(meterKey);
  return [
    ...names.map((name, index) => ({ value: name, color: shadeOf(base, index, chartBg()) })),
    { value: otherLabel, color: chartAxisLine() },
  ];
}

/** Stacked cost bars priced by cycle; a real query, so it renders through `PanelSchemaRenderer`. */
export function buildTrendsPanelSchema(opts: {
  orgId: string;
  cycles: MeteringDetails[];
  bucket: string;
  /** Narrows the chart to one meter's events. */
  events?: string[];
  decimals?: number;
  /** Horizontal reference lines, such as the run rate, drawn across the bars. */
  markLines?: MarkLine[];
  t: TranslateFn;
}) {
  const { orgId, cycles, bucket, events = PRICED_EVENTS, decimals = 2, markLines = [], t } = opts;
  const seriesColors = events.map((event) => ({
    value: event,
    color: meterColorFor(meterForEvent(event)?.key ?? "ingestion"),
  }));
  return buildStackedCostPanelSchema({
    id: "usage-trends-cost",
    sql: trendsCostSql(orgId, cyclePrices(cycles), bucket, events),
    seriesColors,
    decimals,
    markLines,
    t,
  });
}

/** One stacked daily cost panel shape, shared by Trends and the meter detail view. */
export function buildStackedCostPanelSchema(opts: {
  id: string;
  sql: string;
  seriesColors: SeriesColor[];
  decimals?: number;
  markLines?: MarkLine[];
  t: TranslateFn;
}) {
  const { id, sql, seriesColors, decimals = 2, markLines = [], t } = opts;
  return {
    version: 2,
    id,
    title: "",
    description: "",
    type: "stacked",
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: "currency",
      unit_custom: "",
      decimals,
      axis_border_show: true,
      connect_nulls: false,
      no_value_replacement: "",
      show_symbol: false,
      base_map: { type: "osm" },
      map_view: { zoom: 1, lat: 0, lng: 0 },
      mark_line: markLines,
      color: {
        mode: "palette-classic",
        fixedColor: [],
        seriesBy: "last",
        colorBySeries: seriesColors,
      },
    },
    queryType: "sql",
    queries: [
      {
        query: sql,
        customQuery: true,
        vrlFunctionQuery: "",
        fields: {
          stream: USAGE_STREAM_NAME,
          stream_type: "logs",
          x: [{ alias: "x_axis_1", column: "x_axis_1", color: null, label: t("billing.time") }],
          y: [
            {
              alias: "y_axis_1",
              column: "y_axis_1",
              color: null,
              label: t("billing.usageV2.colCost"),
            },
          ],
          z: [],
          breakdown: [
            {
              alias: "breakdown_1",
              column: "breakdown_1",
              color: null,
              label: t("billing.event"),
            },
          ],
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
    ],
  };
}

const DAY_SECONDS = 86_400;

/** Series that carry the forecast, left out of the per-day tooltip rows. */
const FORECAST_SERIES = new Set(["lo", "hi"]);

/**
 * Trends chart as a plain ECharts option: stacked cost bars per meter and, for the open
 * cycle, the cumulative spend with a dashed projection and its range on a second axis.
 * `PanelSchemaRenderer` cannot add those series, so the page renders this with `ChartRenderer`.
 */
export function buildTrendsChartOption(opts: {
  rows: CostRow[];
  events: string[];
  /** Unix seconds; `bucket` is the slot width in seconds. */
  start: number;
  end: number;
  bucket: number;
  now: number;
  /** Only drawn on a daily bucket, because the run rate is per day. */
  forecast: Forecast | null;
  meterLabel: (key: MeterKey) => string;
  money: (value: number) => string;
  slotLabel: (ts: number) => string;
  labels: {
    spendToDate: string;
    forecast: string;
    dayTotal: string;
    projected: string;
  };
}) {
  const { rows, bucket, now, money, labels } = opts;
  const first = Math.floor(opts.start / bucket) * bucket;
  const slots: number[] = [];
  for (let ts = first; ts < opts.end; ts += bucket) slots.push(ts);
  const n = slots.length;
  const index = new Map(slots.map((ts, i) => [ts, i]));

  const meters = METERS.filter((def) => def.events.some((event) => opts.events.includes(event)));
  const meterOf = new Map<string, MeterKey>();
  for (const def of meters) for (const event of def.events) meterOf.set(event, def.key);

  const perMeter = new Map<MeterKey, number[]>(meters.map((def) => [def.key, Array(n).fill(0)]));
  const totals: number[] = Array(n).fill(0);
  for (const row of rows) {
    const key = meterOf.get(row.event);
    const i = index.get(Math.floor(row.ts / bucket) * bucket);
    if (!key || i === undefined) continue;
    perMeter.get(key)![i] += row.cost;
    totals[i] += row.cost;
  }

  // Slots up to and including the one holding `now` are actuals; the rest are future.
  const elapsed = Math.max(slots.filter((ts) => ts <= now).length, 1);
  const f = bucket === DAY_SECONDS && elapsed < n ? opts.forecast : null;
  const cum: number[] = [];
  totals.slice(0, elapsed).forEach((v, i) => cum.push((cum[i - 1] ?? 0) + v));
  const from = cum[elapsed - 1] ?? 0;
  const left = n - elapsed;
  // A straight path from today's spend to the target, so the last point is the target itself.
  const path = (target: number) =>
    Array<number | null>(elapsed - 1)
      .fill(null)
      .concat(Array.from({ length: left + 1 }, (_, k) => from + ((target - from) * k) / left));
  const mid = f ? path(f.projected) : [];
  const low = f ? path(f.low) : [];
  const high = f ? path(f.high) : [];

  const accent = chartColor("--color-primary-500");
  const muted = chartTextColor();
  const bars = meters.map((def) => ({
    name: opts.meterLabel(def.key),
    type: "bar",
    stack: "cost",
    barMaxWidth: 20,
    yAxisIndex: 0,
    itemStyle: { color: meterColorFor(def.key) },
    data: perMeter.get(def.key)!.map((v, i) => (i < elapsed && v > 0 ? v : null)),
  }));
  const forecastSeries = f
    ? [
        // Range band: an invisible lower bound, then the gap above it filled.
        {
          name: "lo",
          type: "line",
          yAxisIndex: 1,
          stack: "band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          data: low,
        },
        {
          name: "hi",
          type: "line",
          yAxisIndex: 1,
          stack: "band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          areaStyle: { color: accent, opacity: 0.12 },
          data: high.map((v, k) => (v == null ? null : v - (low[k] ?? 0))),
        },
        {
          name: labels.spendToDate,
          type: "line",
          yAxisIndex: 1,
          symbol: "none",
          lineStyle: { color: accent, width: 2.5 },
          itemStyle: { color: accent },
          data: cum.concat(Array(left).fill(null)),
        },
        {
          name: labels.forecast,
          type: "line",
          yAxisIndex: 1,
          symbol: "none",
          lineStyle: { color: accent, width: 2, type: "dashed" },
          itemStyle: { color: accent },
          data: mid,
          // The projected total sits on the end of the dashed line, where the eye lands.
          endLabel: {
            show: true,
            formatter: `${labels.projected} ${money(f.projected)}`,
            color: accent,
            fontWeight: 600,
            align: "right",
            offset: [-4, -14],
          },
        },
      ]
    : [];

  const days = slots.map(opts.slotLabel);
  return {
    animation: false,
    grid: { left: 56, right: f ? 56 : 16, top: 24, bottom: 64 },
    // The dashboards' legend: one scrollable line with page arrows when meters overflow.
    legend: (() => {
      const legend = createBaseLegendConfig({ config: { legends_position: "bottom" } }, null);
      return {
        ...legend,
        data: bars.map((bar) => bar.name),
        textStyle: { ...legend.textStyle, color: muted },
      };
    })(),
    xAxis: {
      type: "category",
      data: days,
      axisLine: { lineStyle: { color: chartAxisLine() } },
      axisTick: { show: false },
      axisLabel: { color: muted, interval: Math.max(Math.ceil(n / 8) - 1, 0) },
    },
    yAxis: [
      {
        type: "value",
        axisLabel: { color: muted, formatter: money },
        splitLine: { lineStyle: { color: chartAxisLine(), type: "dashed" } },
      },
      {
        type: "value",
        show: !!f,
        axisLabel: { color: muted, formatter: money },
        splitLine: { show: false },
      },
    ],
    // Same tooltip as the dashboards: on <body>, so the chart pane never clips it.
    tooltip: {
      trigger: "axis",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      borderWidth: 1,
      padding: [8, 12],
      formatter: (
        params: { dataIndex: number; seriesName: string; value: number | null; marker: string }[],
      ) => {
        const d = params[0]?.dataIndex ?? 0;
        if (f && d >= elapsed) {
          return (
            `<b>${days[d]} · ${labels.forecast}</b><br/>${money(mid[d] ?? f.projected)}` +
            `<br/><span style="opacity:.75">${money(low[d] ?? f.low)} – ${money(high[d] ?? f.high)}</span>`
          );
        }
        const lines = params
          .filter(
            (p) =>
              p.value != null &&
              !FORECAST_SERIES.has(p.seriesName) &&
              p.seriesName !== labels.spendToDate &&
              p.seriesName !== labels.forecast,
          )
          .map(
            (p) =>
              `${p.marker}${p.seriesName}<span style="float:right;margin-left:1.125rem">${money(p.value!)}</span>`,
          );
        const spend = f
          ? `<br/>${labels.spendToDate}<span style="float:right;margin-left:1.125rem">${money(cum[d])}</span>`
          : "";
        return (
          `<b>${days[d]}</b><br/>${lines.join("<br/>")}<br/>${labels.dayTotal}` +
          `<span style="float:right;margin-left:1.125rem;font-weight:600">${money(totals[d])}</span>${spend}`
        );
      },
    },
    series: [...bars, ...forecastSeries],
  };
}
