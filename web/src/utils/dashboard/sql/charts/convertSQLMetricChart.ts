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

import { calculateOptimalFontSize } from "../../chartDimensionUtils";
import { getContrastColor } from "../../chartColorUtils";
import { resolveMetricValueStyle } from "../../tableConfigUtils";
import { type SQLContext } from "../shared/types";
import { chartColor, chartNumber } from "../../../chartTheme";

// Copy-button size (icon-xs-sq) and the slot it needs beside the value
// (button + gaps). The value stays perfectly centered, so free width splits
// evenly between both sides — reserving the slot on BOTH sides during font
// fitting keeps the right-hand slot available on any reasonably wide panel.
export const METRIC_COPY_BTN_PX = 28;
export const METRIC_COPY_BTN_SLOT_PX = METRIC_COPY_BTN_PX + 4;

// Below this the value stops being readable; the fit may use it even when
// the button slot no longer fits, and the button then moves below the value
// (or hides) instead of shrinking the text further.
export const METRIC_MIN_FONT_PX = 12;

/**
 * Font size for a metric value: fits the width left over after reserving the
 * copy-button slot on both sides, capped by the cell height, and floored at
 * a readable minimum (never beyond what the height allows).
 */
export const calculateMetricFontSize = (text: string, width: number, height: number): number => {
  const fit = calculateOptimalFontSize(text, width - 2 * METRIC_COPY_BTN_SLOT_PX, height);
  const heightCap = Math.max(1, Math.floor(height / 1.2));
  const floorCap = Math.min(METRIC_MIN_FONT_PX, heightCap);
  // common case: the fit already clears the readability floor, so the
  // full-width fit (a second measurement binary search) is not needed
  if (fit >= floorCap) return fit;
  // the floor may ignore the button slots (the button wraps instead), but it
  // must never exceed what the full cell width fits — that would clip digits
  const fullWidthFit = calculateOptimalFontSize(text, width, height);
  return Math.max(fit, Math.min(floorCap, fullWidthFit));
};

// Style + geometry shared by BOTH sparkline renderers so they can't drift: the
// ECharts-series path (buildMetricSparkline, single metric) and the grid's
// per-cell primitive path (buildCellSparkline in convertSQLData).
export const METRIC_SPARKLINE = {
  fillOpacity: 0.15, // default area fill opacity
  lineWidth: 1, // default line width
  faintOpacity: 0.35, // line/bar/area opacity in the "background" layout
  faintAreaFactor: 0.6, // area-fill multiplier in the "background" layout
  bottomBandTopPct: 60, // "bottom" layout: the trend starts this % down the cell
};

/**
 * Persisted `config.sparkline` shape. Every field is optional/nullable — the
 * UI leaves them null until the user interacts, and each is guarded at read.
 */
export interface SparklineConfig {
  enabled?: boolean;
  type?: string | null;
  layout?: string | null;
  color?: string | null;
  fillOpacity?: number | null;
  lineWidth?: number | null;
}

export interface MetricSparkline {
  grid: any;
  xAxis: any[];
  yAxis: any[];
  series: any;
  /** Polar center Y so the value text sits above (bottom) or over (background) the trend. */
  polarCenterY: string;
  /** Fraction of panel height the value occupies (copy-button layout). */
  valueBandFactor: number;
  valueCenterFactor: number;
  /** Raw numeric series + resolved config, for renderers that draw the trend manually (grid). */
  data: number[];
  resolved: { type: string; color: string; fillOpacity: number; lineWidth: number; layout: string };
}

/**
 * Build the ECharts pieces for a metric sparkline (line/area/bar) from a numeric
 * series, or null when disabled or there is no trend to draw (< 2 points).
 */
export const buildMetricSparkline = (
  values: unknown[],
  spark: SparklineConfig | null | undefined,
  fallbackColor: string,
): MetricSparkline | null => {
  if (!spark?.enabled || !Array.isArray(values) || values.length < 2) return null;
  const data = values.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  if (data.length < 2) return null;

  const type = spark.type === "bar" || spark.type === "line" ? spark.type : "area";
  const color = spark.color || fallbackColor;
  const fillOpacity =
    typeof spark.fillOpacity === "number" ? spark.fillOpacity : METRIC_SPARKLINE.fillOpacity;
  const lineWidth =
    typeof spark.lineWidth === "number" ? spark.lineWidth : METRIC_SPARKLINE.lineWidth;
  const layout = spark.layout === "background" ? "background" : "bottom";
  const faint = layout === "background";

  const rawMin = Math.min(...data);
  const rawMax = Math.max(...data);
  const pad = (rawMax - rawMin) * 0.1 || Math.abs(rawMax) * 0.1 || 1;
  const min = faint ? rawMin : rawMin - pad;
  const max = faint ? rawMax : rawMax + pad;

  const series: any = {
    type: type === "bar" ? "bar" : "line",
    data,
    xAxisIndex: 0,
    yAxisIndex: 0,
    silent: true,
    symbol: "none",
    smooth: type !== "bar",
    lineStyle: { width: lineWidth, color, opacity: faint ? METRIC_SPARKLINE.faintOpacity : 1 },
    itemStyle: { color, opacity: faint ? METRIC_SPARKLINE.faintOpacity : 1 },
    ...(type === "area"
      ? {
          areaStyle: {
            color,
            opacity: faint ? fillOpacity * METRIC_SPARKLINE.faintAreaFactor : fillOpacity,
          },
        }
      : {}),
    ...(type === "bar" ? { barWidth: "55%" } : {}),
    z: 1,
  };

  return {
    grid: {
      left: "2%",
      right: "2%",
      top: faint ? "2%" : `${METRIC_SPARKLINE.bottomBandTopPct}%`,
      bottom: faint ? "2%" : "0%",
      containLabel: false,
    },
    xAxis: [
      { type: "category", show: false, boundaryGap: type === "bar", data: data.map((_, i) => i) },
    ],
    yAxis: [{ type: "value", show: false, scale: true, min, max }],
    series,
    polarCenterY: faint ? "50%" : "30%",
    valueBandFactor: faint ? 1 : 0.6,
    valueCenterFactor: faint ? 0.5 : 0.3,
    data,
    resolved: { type, color, fillOpacity, lineWidth, layout },
  };
};

/** Normalize a histogram bucket key (UTC string, or sec/ms/µs number) to microseconds. */
const bucketMicros = (raw: any): number => {
  if (raw == null) return NaN;
  const num = Number(raw);
  if (!Number.isNaN(num)) {
    if (num >= 1e14) return num; // microseconds
    if (num >= 1e11) return num * 1e3; // milliseconds
    if (num >= 1e8) return num * 1e6; // seconds
    return num; // already small (e.g. test indices) — use as-is
  }
  const s = String(raw);
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? NaN : ms * 1e3;
};

/**
 * Full-range sparkline series: one slot per histogram bucket across the user's
 * [start, end] range, so the x-axis width stays FIXED as streaming chunks arrive
 * — a chunk fills its own slots and the rest stay `noValue`, instead of the axis
 * rescaling to whatever data has landed so far. The bucket interval is derived
 * from the data's smallest gap. Falls back to filling only the internal gaps
 * (then to raw values) when the range or interval can't be determined.
 */
export const fillSparklineRange = (
  hits: any,
  startMicros: number,
  endMicros: number,
  noValue: number = 0,
): number[] => {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const valOf = (h: any): number => {
    if (h?.zo_sql_num != null) return Number(h.zo_sql_num);
    for (const [k, v] of Object.entries(h ?? {})) {
      if (k === "zo_sql_key" || k === "zo_sql_breakdown" || k.includes("timestamp")) continue;
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
    return NaN;
  };
  const points = [...hits]
    .map((h) => ({ t: bucketMicros(h?.zo_sql_key ?? h?._timestamp), v: valOf(h) }))
    .filter((p) => !Number.isNaN(p.v) && !Number.isNaN(p.t))
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return points.map((p) => p.v);

  // Histogram buckets are regular, so the smallest gap is the bucket interval.
  let interval = Infinity;
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].t - points[i - 1].t;
    if (gap > 0 && gap < interval) interval = gap;
  }
  if (!Number.isFinite(interval) || interval <= 0) return points.map((p) => p.v);

  // Preferred: one slot for every bucket across the whole user range → fixed width.
  const haveRange =
    Number.isFinite(startMicros) && Number.isFinite(endMicros) && endMicros > startMicros;
  if (haveRange) {
    const n = Math.min(5000, Math.round((endMicros - startMicros) / interval) + 1);
    if (n >= 2) {
      const out = new Array(n).fill(noValue);
      let placed = 0;
      for (const p of points) {
        const idx = Math.round((p.t - startMicros) / interval);
        if (idx >= 0 && idx < n) {
          out[idx] = p.v;
          placed++;
        }
      }
      // If nothing landed in range (bad parse/unit), don't blank the sparkline —
      // fall through to the data-only path below.
      if (placed > 0) return out;
    }
  }

  // No usable range: fill only the internal gaps between real buckets so the
  // trend still dips through omitted buckets.
  const out: number[] = [points[0].v];
  for (let i = 1; i < points.length; i++) {
    const missing = Math.round((points[i].t - points[i - 1].t) / interval) - 1;
    if (missing > 0 && missing <= 5000) {
      for (let k = 0; k < missing; k++) out.push(noValue);
    }
    out.push(points[i].v);
  }
  return out;
};

/**
 * Applies chart-specific options for: metric
 *
 * Mutates `ctx.options` in place.
 */
export function applyMetricChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    yAxisKeys,
    defaultSeriesProps,
    getAxisDataFromKey,
    chartPanelRef,
    sparklineData,
    metadata,
  } = ctx;

  const key1 = yAxisKeys?.[0];
  const yAxisValue = getAxisDataFromKey(key1);
  const rawValue = yAxisValue?.length > 0 ? yAxisValue[yAxisValue.length - 1] : 0;
  const metricStyle = resolveMetricValueStyle(rawValue, {
    mappings: panelSchema?.config?.mappings,
    unit: panelSchema?.config?.unit,
    customUnit: panelSchema?.config?.unit_custom,
    decimals: panelSchema?.config?.decimals,
    panelBackground: panelSchema?.config?.background?.value?.color ?? "",
  });
  const metricText = metricStyle.text;
  options.backgroundColor = metricStyle.bgColor;
  options.dataset = { source: [[]] };
  options.tooltip = {
    show: false,
  };
  options.angleAxis = {
    show: false,
  };
  options.radiusAxis = {
    show: false,
  };
  // --- Optional sparkline (metric value + line/area/bar trend) ---
  // Prefer the histogram (is_ui_histogram) series; fall back to the metric's own values.
  // The trend spans the user's full [start, end] range (fixed x-axis width across
  // streaming chunks); empty buckets fill with no_value_replacement (numeric), else 0.
  const rawNoValue = Number(panelSchema?.config?.no_value_replacement);
  const sparkNoValue = Number.isFinite(rawNoValue) ? rawNoValue : 0;
  const histogramSeries = fillSparklineRange(
    sparklineData,
    Number(metadata?.queries?.[0]?.startTime),
    Number(metadata?.queries?.[0]?.endTime),
    sparkNoValue,
  );
  const sparklineInput = histogramSeries.length >= 2 ? histogramSeries : yAxisValue;
  const sparkline = buildMetricSparkline(
    sparklineInput,
    panelSchema?.config?.sparkline,
    chartColor("--color-accent"),
  );
  if (sparkline) {
    options.polar = { center: ["50%", sparkline.polarCenterY], radius: 0 };
    options.grid = sparkline.grid;
    options.xAxis = sparkline.xAxis;
    options.yAxis = sparkline.yAxis;
  } else {
    options.polar = {};
    options.xAxis = [];
    options.yAxis = [];
  }

  // metric value color: explicit mapping text color wins; otherwise auto-contrast.
  const metricFillColor =
    metricStyle.textColor ??
    getContrastColor(
      metricStyle.bgColor,
      chartColor("--color-chart-metric-text"),
      chartNumber("--chart-metric-contrast-threshold", 0.5),
    );
  const metricFieldLabel = panelSchema?.queries?.[0]?.fields?.y?.[0]?.label || key1;

  const textSeries: any = {
    ...defaultSeriesProps,
    _metricText: metricText,
    _metricFillColor: metricFillColor,
    _metricBgColor: metricStyle.bgColor,
    _metricLabel: metricFieldLabel,
    // Raw trend + config so the multi-query grid can draw a per-cell sparkline.
    _metricSparkData: sparkline?.data ?? null,
    _metricSparkConfig: sparkline?.resolved ?? null,
    z: 2,
    renderItem: function (params: any) {
      try {
        return {
          type: "text",
          style: {
            text: metricText,
            fontSize: calculateMetricFontSize(
              metricText,
              params?.coordSys?.cx * 2,
              params?.coordSys?.cy * 2,
            ), //coordSys is relative. so that we can use it to calculate the dynamic size
            fontWeight: 500,
            align: "center",
            verticalAlign: "middle",
            x: params?.coordSys?.cx,
            y: params?.coordSys?.cy,
            fill: metricFillColor,
          },
        };
      } catch {
        return "";
      }
    },
  };

  // Text series first (grid extracts series[0]); sparkline layered behind via z.
  options.series = sparkline ? [textSeries, sparkline.series] : [textSeries];

  // Rect for the per-value copy icon overlay (single metric fills the area).
  const panelEl = chartPanelRef?.value;
  if (panelEl) {
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    // With a bottom sparkline the value occupies the top ~60% band.
    const valueH = sparkline ? h * sparkline.valueBandFactor : h;
    const cy = sparkline ? h * sparkline.valueCenterFactor : h / 2;
    textSeries._metricLayout = {
      left: 0,
      top: 0,
      width: w,
      height: valueH,
      cx: w / 2,
      cy,
      fontSize: calculateMetricFontSize(metricText, w, valueH),
    };
  }
}
