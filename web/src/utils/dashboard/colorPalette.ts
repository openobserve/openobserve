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

export const getColorPalette = (theme: string) => {
  return theme === "dark" ? classicColorPaletteDarkTheme : classicColorPaletteLightTheme;
};

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
const getSeriesHash = (seriesName: string, colorPalette: string[]) => {
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

const getColorForTableLight = [
  "#FFCDEE",
  "#FFD2D3",
  "#C8FCFA",
  "#B2DAFB",
  "#C0E9FC",
  "#FFCDE5",
  "#C0EFF5",
  "#FFFDBA",
  "#E6F3FF",
  "#F2B9B9",
  "#A6E8F0",
  "#C8E5FC",
  "#E8A3F4",
  "#C0E5E2",
  "#C9FFBD",
  "#F8B1C9",
  "#BDDFFF",
  "#D2B9FF",
  "#D2EBDA",
  "#C0E3C2",
  "#F0F8E8",
  "#FFF2CC",
  "#FFE6E6",
  "#E8F4FD",
];

const getColorForTableDark = [
  "rgba(255, 100, 180, 0.15)",
  "rgba(255, 100, 110, 0.15)",
  "rgba(100, 240, 230, 0.15)",
  "rgba(90, 170, 240, 0.15)",
  "rgba(100, 210, 240, 0.15)",
  "rgba(255, 100, 160, 0.15)",
  "rgba(100, 220, 230, 0.15)",
  "rgba(255, 250, 100, 0.15)",
  "rgba(160, 200, 255, 0.15)",
  "rgba(230, 130, 130, 0.15)",
  "rgba(100, 210, 225, 0.15)",
  "rgba(100, 190, 240, 0.15)",
  "rgba(200, 100, 240, 0.15)",
  "rgba(100, 200, 195, 0.15)",
  "rgba(130, 240, 120, 0.15)",
  "rgba(240, 130, 170, 0.15)",
  "rgba(130, 190, 255, 0.15)",
  "rgba(170, 120, 255, 0.15)",
  "rgba(150, 210, 170, 0.15)",
  "rgba(130, 200, 135, 0.15)",
  "rgba(210, 240, 180, 0.15)",
  "rgba(255, 230, 130, 0.15)",
  "rgba(255, 180, 180, 0.15)",
  "rgba(180, 225, 245, 0.15)",
];

export const getColorForTable = (theme: string): string[] =>
  theme === "dark" ? getColorForTableDark : getColorForTableLight;

/**
 * Converts a color string (hex, rgb, or rgba) into an rgba string with the
 * given alpha. Returns the input unchanged if it can't be parsed.
 */
export const colorToRgba = (color: string, alpha: number): string => {
  if (!color) return color;
  // hex: #rgb or #rrggbb
  if (color[0] === "#") {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const num = parseInt(hex, 16);
    if (Number.isNaN(num)) return color;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // rgb()/rgba()
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(",").map((p) => p.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
};

/**
 * Dashed split-line style for chart grids — subtle so the lines recede behind
 * the data. Theme-aware: faint white on dark, faint black on light. Shared by
 * the PromQL and SQL chart builders so the grid look stays consistent.
 */
export const getGridLineStyle = (theme: string) => ({
  type: "dashed",
  width: 1,
  color: theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
});

/**
 * Builds a top-to-bottom vertical gradient for area chart fills that fades
 * from a translucent series color at the top to fully transparent at the
 * bottom. `color` should be the resolved concrete series color.
 */
export const getAreaGradientColor = (color: string, theme?: string) => {
  const isDark = theme === "dark";
  const topAlpha = isDark ? 1 : 0.9;
  const bottomAlpha = isDark ? 1 : 0.4;
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: colorToRgba(color, topAlpha) },
      { offset: 1, color: colorToRgba(color, bottomAlpha) },
    ],
    global: false,
  };
};

/**
 * Builds the `{ areaStyle: {...} }` override for area charts — fades the fill
 * into a bottom-to-top transparent gradient. Returns `{}` for non-area charts
 * or when there's no base areaStyle. Resolves a concrete color from the palette
 * when the series color is null (auto-palette mode). Shared by the PromQL and
 * SQL chart builders so the area fill stays consistent.
 */
export const getAreaStyleOverride = (
  panelType: string,
  baseAreaStyle: any,
  resolvedColor: any,
  seriesName: any,
  theme: string,
) => {
  const isAreaChart = panelType === "area" || panelType === "area-stacked";
  if (!isAreaChart || !baseAreaStyle) return {};
  const palette = getColorPalette(theme);
  const color = resolvedColor ?? palette[getSeriesHash(seriesName?.toString() ?? "", palette)];
  return {
    areaStyle: {
      ...baseAreaStyle,
      color: getAreaGradientColor(color, theme),
    },
  };
};
