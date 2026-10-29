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

import { scaleLinear } from "d3-scale";
import { isNumber } from "lodash-es";
import { color as echartsColor } from "echarts/core";
import { chartColor, chartNumber } from "../chartTheme";

export enum ColorModeWithoutMinMax {
  PALETTE_CLASSIC_BY_SERIES = "palette-classic-by-series",
  PALETTE_CLASSIC = "palette-classic",
  FIXED = "fixed",
}

// Light theme colors — perceptually distinct, blue-first, safe on light backgrounds
export const classicColorPaletteLightTheme = [
  "#5b8ef0", // blue
  "#34d399", // green
  "#fb923c", // orange
  "#f472b6", // pink
  "#a78bfa", // purple
  "#fbbf24", // yellow
  "#38bdf8", // sky
  "#f87171", // red
  "#2dd4bf", // teal
  "#4ade80", // lime
  "#e879f9", // fuchsia
  "#facc15", // amber
];

// Dark theme colors — brighter variants of the same hues for dark canvas legibility
export const classicColorPaletteDarkTheme = [
  "#60a5fa", // blue
  "#6ee7b7", // green
  "#fdba74", // orange
  "#f9a8d4", // pink
  "#c4b5fd", // purple
  "#fde68a", // yellow
  "#7dd3fc", // sky
  "#fca5a5", // red
  "#5eead4", // teal
  "#86efac", // lime
  "#f5d0fe", // fuchsia
  "#fef08a", // amber
];

// Classic dashboard series palette. The light/dark swap now lives in the
// --color-chart-series-* tokens (base.css / dark.css); this resolves them for
// ECharts via chartColor(). `_theme` is kept for call-site compatibility but is
// ignored — CSS owns the light/dark swap now, not a per-theme JS branch.
// The classicColorPalette*Theme arrays above remain the token source of truth and
// are still consumed directly by the log-histogram converters.
export const getColorPalette = (_theme?: string): string[] => [
  chartColor("--color-chart-series-1"),
  chartColor("--color-chart-series-2"),
  chartColor("--color-chart-series-3"),
  chartColor("--color-chart-series-4"),
  chartColor("--color-chart-series-5"),
  chartColor("--color-chart-series-6"),
  chartColor("--color-chart-series-7"),
  chartColor("--color-chart-series-8"),
  chartColor("--color-chart-series-9"),
  chartColor("--color-chart-series-10"),
  chartColor("--color-chart-series-11"),
  chartColor("--color-chart-series-12"),
];

// ── AI Observability semantic chart marks ───────────────────────────────────
// echarts needs resolved colours (not CSS vars), so these literals live here —
// the sanctioned home for chart hex. Categorical *series* must instead draw from
// getColorPalette() above; the constants below are single-purpose semantic /
// status marks whose exact hue carries meaning (a threshold line; a severity
// escalation) and so is kept deliberately fixed.

/** Quality average-score trend line (the primary series on the trend chart). */
export const QUALITY_SCORE_LINE_COLOR = "#2563eb";

/** Reference / threshold + p95 marker on the Quality trend + distribution charts. */
export const CHART_THRESHOLD_COLOR = "#b25400";

/** LLM Insights latency percentiles — a severity escalation, p50 → p99. */
export const LLM_LATENCY_SERIES_COLORS = {
  p50: "#64748b",
  p90: "#f59e0b",
  p95: "#f97316",
  p99: "#ef4444",
} as const;

/** LLM Insights single-metric panel colours (mirror the KPI tile tones). */
export const LLM_ERRORS_COLOR = "#ef4444";
export const LLM_SPANS_COLOR = "#3b82f6";
export const LLM_TOKENS_COLOR = "#a855f7";

const isValidHexColor = (color: string): boolean => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  return result !== null;
};

export const shadeColor = (
  color: string,
  value: number,
  min: number,
  max: number,
): string | null => {
  if (!isValidHexColor(color)) {
    return null;
  }
  if (typeof value !== "number" || typeof min !== "number" || typeof max !== "number") {
    return null;
  }
  let percent = 0;
  if (max === min) {
    percent = 0;
  } else {
    percent = (value - min) / (max - min);
  }
  const num = parseInt(color.replace("#", ""), 16),
    amt = Math.round(1.55 * percent * 100),
    R = ((num >> 16) & 0xff) + amt,
    G = ((num >> 8) & 0xff) + amt,
    B = (num & 0xff) + amt;

  const newColor = (
    0x1000000 +
    (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 0 ? 0 : B) : 255)
  )
    .toString(16)
    .slice(1);
  return "#" + newColor;
};

interface MetricResult {
  values: [number, number][];
}

interface Metric {
  result?: MetricResult[];
}

export const getMetricMinMaxValue = (searchQueryData: Metric[]): [number, number] => {
  let min = Infinity;
  let max = -Infinity;

  const allValues = searchQueryData
    .filter((metric) => metric && metric.result)
    .flatMap((metric) => metric.result ?? [])
    .flatMap((result) => result.values ?? [])
    .map(([, value]) => value)
    .filter((value) => !Number.isNaN(value));

  if (allValues.length > 0) {
    min = Math.min(...allValues);
    max = Math.max(...allValues);
  }

  return [min, max];
};

interface SQLData {
  [key: string]: number | null | undefined;
}

export const getSQLMinMaxValue = (
  yaxiskeys: string[],
  searchQueryData: SQLData[],
): [number, number] => {
  // need min and max value for color
  let min = Infinity;
  let max = -Infinity;

  searchQueryData?.forEach((data: SQLData) => {
    yaxiskeys?.forEach((key: string) => {
      if (
        data[key] !== undefined &&
        isNumber(data[key]) &&
        !Number.isNaN(data[key]) &&
        data[key] !== null
      ) {
        min = Math.min(min, data[key]);
        max = Math.max(max, data[key]);
      }
    });
  });

  return [min, max];
};

// need one function which will take some series name and will return hash which will be between 1 to 1000
export const getSeriesHash = (seriesName: string, colorPalette: string[]) => {
  // Initialize a hash variable
  let hash = 0;
  const classicColorPaletteLength = colorPalette.length;
  // If the seriesName is empty, return 1 as a default hash value
  if (seriesName.length === 0) return 1;

  // Loop through each character in the series name
  for (let i = 0; i < seriesName.length; i++) {
    const char = seriesName.charCodeAt(i); // Get the Unicode value of the character
    hash = (hash << 5) - hash + char; // Bitwise hash computation
    hash |= 0; // Convert to 32-bit integer
  }

  // Ensure the hash is positive and between 0 to 99
  return Math.abs(hash) % classicColorPaletteLength;
};

type SeriesBy = "last" | "min" | "max";

// `values` may be a bare number from gauge callers; the try/catch below absorbs the non-array case
const getSeriesValueBasedOnSeriesBy = (values: any, seriesBy: SeriesBy): number | null => {
  try {
    const validValues = values.filter(
      (value: number | string) =>
        value != null && value !== "" && isNumber(value) && !Number.isNaN(value),
    );

    if (validValues.length === 0) return null;

    switch (seriesBy) {
      case "last":
        return +validValues[validValues.length - 1];
      case "min":
        return Math.min(...validValues);

      case "max":
        return Math.max(...validValues);
      default:
        return +validValues[validValues.length - 1];
    }
  } catch (error) {
    return null;
  }
};

/** The panel config keys an area fill reads. */
export interface AreaFillConfig {
  fill_opacity?: unknown;
  fill_gradient?: boolean | null;
}

interface ColorConfig {
  mode:
    | "fixed"
    | "shades"
    | "palette-classic-by-series"
    | "palette-classic"
    | "continuous-green-yellow-red"
    | "continuous-red-yellow-green"
    | "continuous-temperature"
    | "continuous-positive"
    | "continuous-negative"
    | "continuous-light-to-dark-blue";
  fixedColor?: string[];
  seriesBy?: SeriesBy;
  colorBySeries?: Array<{ value: string; color?: string }>;
}

function getDomainPartitions(chartMin: number, chartMax: number, numPartitions: number) {
  // If there's only one partition, return just chartMin and chartMax
  if (numPartitions < 2) {
    return [chartMin, chartMax];
  }

  const partitions = [];
  const step = (chartMax - chartMin) / (numPartitions - 1);

  for (let i = 0; i < numPartitions; i++) {
    partitions.push(chartMin + i * step);
  }

  return partitions;
}

export const getSeriesColor = (
  colorCfg: ColorConfig | null,
  seriesName: string,
  // PromQL converters pass raw string values or a single number; handled by getSeriesValueBasedOnSeriesBy
  value: number | Array<number | string>,
  chartMin: number,
  chartMax: number,
  theme: string,
  colorBySeries?: any,
): string | null => {
  const colorPalette = getColorPalette(theme);

  // Check for custom color from colorBySeries mappings first
  if (colorBySeries?.length > 0) {
    const customMapping = colorBySeries.find(
      (mapping: any) => mapping.value === seriesName && mapping.color,
    );
    if (customMapping) {
      return customMapping.color;
    }
  }

  if (!colorCfg) {
    return colorPalette[getSeriesHash(seriesName?.toString() ?? "", colorPalette)];
  } else if (colorCfg.mode === "fixed") {
    return colorCfg?.fixedColor?.[0] ?? "#53ca53";
  } else if (colorCfg.mode === "shades") {
    return shadeColor(
      colorCfg?.fixedColor?.[0] ?? "#53ca53",
      getSeriesValueBasedOnSeriesBy(value, "last") ?? chartMin,
      chartMin,
      chartMax,
    );
  } else if (colorCfg.mode === "palette-classic-by-series") {
    return colorPalette[getSeriesHash(seriesName?.toString() ?? "", colorPalette)];
  } else if (colorCfg.mode === "palette-classic") {
    return null;
  } else {
    const d3ColorObj = scaleLinear(
      getDomainPartitions(chartMin, chartMax, colorCfg?.fixedColor?.length ?? colorPalette.length),
      colorCfg?.fixedColor?.length ? colorCfg.fixedColor : colorPalette,
    );
    return d3ColorObj(
      (getSeriesValueBasedOnSeriesBy(value, colorCfg?.seriesBy ?? "last") ?? chartMin) as number,
    );
  }
};

// Below this redmean distance two palette colours read as one hue: the amber/yellow pair sits at 20-34.
const NEAR_COLOR_DISTANCE = 60;

const toRgb = (value: string): [number, number, number] | null => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

const isNearColor = (a: string, b: string): boolean => {
  const x = toRgb(a);
  const y = toRgb(b);
  if (!x || !y) return a === b;
  const rMean = (x[0] + y[0]) / 2;
  const [dr, dg, db] = [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const distance = Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  );
  return distance < NEAR_COLOR_DISTANCE;
};

/** Name-hashed palette colours; a name leaves its hash slot only when an earlier name or a reserved colour already holds that colour. */
export const getDistinctSeriesColors = (
  names: string[],
  palette: string[],
  reserved: string[] = [],
): Map<string, string> => {
  const colors = new Map<string, string>();
  const takenColors = [...reserved];
  const takenSlots = new Set(
    palette.flatMap((color, i) => (reserved.some((r) => isNearColor(color, r)) ? [i] : [])),
  );
  const isApart = (slot: number) => takenColors.every((c) => !isNearColor(palette[slot], c));
  const take = (name: string, slot: number) => {
    takenSlots.add(slot);
    takenColors.push(palette[slot]);
    colors.set(name, palette[slot]);
  };
  // Sorted, so the same set of names always gets the same colours.
  const unique = [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Uncontested hash slots are claimed before any probing, so a probe never takes another name's own colour.
  const displaced = unique.filter((name) => {
    const home = getSeriesHash(name, palette);
    if (takenSlots.has(home) || !isApart(home)) return true;
    take(name, home);
    return false;
  });
  displaced.forEach((name) => {
    const home = getSeriesHash(name, palette);
    const slots = palette.map((_, i) => (home + i) % palette.length);
    const isFree = (slot: number) => !takenSlots.has(slot);
    take(name, slots.find((i) => isFree(i) && isApart(i)) ?? slots.find(isFree) ?? home);
  });
  return colors;
};

/** Per-chart override of getSeriesColor's name hash: returns the distinct colour, or undefined where getSeriesColor decides. */
export const createDistinctSeriesColor = (
  names: string[],
  colorCfg: ColorConfig | null | undefined,
  theme: string,
): ((name: string) => string | undefined) => {
  if (colorCfg && colorCfg.mode !== "palette-classic-by-series") return () => undefined;
  const mappings = (colorCfg?.colorBySeries ?? []).filter((m) => m?.color);
  const mapped = new Set(mappings.map((m) => m.value));
  const colors = getDistinctSeriesColors(
    names.filter((name) => !mapped.has(name)),
    getColorPalette(theme),
    mappings.map((m) => String(m.color)),
  );
  return (name) => colors.get(name);
};

// Dashboard table row-highlight palette. The light/dark swap lives in the
// --color-chart-table-* tokens (base.css / dark.css); this resolves them via
// chartColor(). `_theme` kept for call-site compatibility, ignored.
export const getColorForTable = (_theme?: string): string[] => [
  chartColor("--color-chart-table-1"),
  chartColor("--color-chart-table-2"),
  chartColor("--color-chart-table-3"),
  chartColor("--color-chart-table-4"),
  chartColor("--color-chart-table-5"),
  chartColor("--color-chart-table-6"),
  chartColor("--color-chart-table-7"),
  chartColor("--color-chart-table-8"),
  chartColor("--color-chart-table-9"),
  chartColor("--color-chart-table-10"),
  chartColor("--color-chart-table-11"),
  chartColor("--color-chart-table-12"),
  chartColor("--color-chart-table-13"),
  chartColor("--color-chart-table-14"),
  chartColor("--color-chart-table-15"),
  chartColor("--color-chart-table-16"),
  chartColor("--color-chart-table-17"),
  chartColor("--color-chart-table-18"),
  chartColor("--color-chart-table-19"),
  chartColor("--color-chart-table-20"),
  chartColor("--color-chart-table-21"),
  chartColor("--color-chart-table-22"),
  chartColor("--color-chart-table-23"),
  chartColor("--color-chart-table-24"),
];

/**
 * Converts any CSS color ECharts can parse (hex with or without alpha, rgb, hsl, named) into an
 * rgba string with the given alpha. Returns the input unchanged if it can't be parsed.
 */
export const colorToRgba = (color: string, alpha: number): string => {
  if (!color) return color;
  const parsed = echartsColor.parse(color);
  if (!parsed) return color;
  const [r, g, b] = parsed;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Solid split-line style for chart grids — subtle so the lines recede behind
 * the data. Theme-aware: faint white on dark, faint black on light. Shared by
 * the PromQL and SQL chart builders so the grid look stays consistent.
 */
export const getGridLineStyle = (_theme?: string) => ({
  type: "solid",
  width: 1,
  // light/dark swap lives in the --color-chart-gridline token (base/dark css).
  color: chartColor("--color-chart-gridline"),
});

const verticalGradient = (topColor: string, bottomColor: string) => ({
  type: "linear",
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: topColor },
    { offset: 1, color: bottomColor },
  ],
  global: false,
});

/** The theme's top-to-bottom area fill fade; `stacked` reads the area-stacked tokens, which stay opaque in dark. */
export const getAreaGradientColor = (color: string, stacked = false) => {
  // Dark keeps a stack's layers opaque since they tile; unstacked areas overlap, so they stay translucent.
  const topAlpha = stacked
    ? chartNumber("--chart-area-stacked-fill-top-opacity", 0.9)
    : chartNumber("--chart-area-fill-top-opacity", 0.9);
  const bottomAlpha = stacked
    ? chartNumber("--chart-area-stacked-fill-bottom-opacity", 0.4)
    : chartNumber("--chart-area-fill-bottom-opacity", 0.4);
  return verticalGradient(colorToRgba(color, topAlpha), colorToRgba(color, bottomAlpha));
};

/** The `area` panel's `fill_opacity` as a 0-1 alpha, or null when unset so the theme tokens apply. */
export const getAreaFillOpacity = (
  panelType: string,
  config?: AreaFillConfig | null,
): number | null => {
  const value = config?.fill_opacity;
  if (panelType !== "area" || value === null || value === undefined || value === "") return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return Math.min(Math.max(percent, 0), 100) / 100;
};

/** The `{ areaStyle }` override for area charts: the theme gradient, or the `area` panel's own fill opacity and gradient; `{}` for other charts. */
export const getAreaStyleOverride = (
  panelType: string,
  baseAreaStyle: any,
  resolvedColor: any,
  seriesName: any,
  theme: string,
  config?: AreaFillConfig | null,
) => {
  const isAreaChart = panelType === "area" || panelType === "area-stacked";
  if (!isAreaChart || !baseAreaStyle) return {};
  const palette = getColorPalette(theme);
  const color = resolvedColor ?? palette[getSeriesHash(seriesName?.toString() ?? "", palette)];
  const gradient = panelType !== "area" || config?.fill_gradient !== false;
  const opacity = getAreaFillOpacity(panelType, config);
  if (opacity === null) {
    return {
      areaStyle: {
        ...baseAreaStyle,
        color: gradient
          ? getAreaGradientColor(color, panelType === "area-stacked")
          : colorToRgba(color, chartNumber("--chart-area-fill-top-opacity", 0.9)),
      },
    };
  }
  // The alpha rides on areaStyle.opacity, which also replaces ECharts' 0.7 default, so the percent is exact.
  return {
    areaStyle: {
      ...baseAreaStyle,
      opacity,
      color: gradient ? verticalGradient(colorToRgba(color, 1), colorToRgba(color, 0)) : color,
    },
  };
};
