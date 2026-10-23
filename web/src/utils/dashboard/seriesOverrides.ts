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

import type { RE2JS } from "re2js";
import { escapeHtml } from "@/utils/html";
import { getAreaStyleOverride } from "./colorPalette";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { tryCompileLinearRegex } from "./tableConfigUtils";
import type { ThresholdMode, ThresholdShowAs } from "./thresholds";

export type SeriesOverrideMatchBy = "name" | "regex";

/** Thresholds as stored inside an override; every field may be missing. */
export interface SeriesOverrideThresholds {
  mode?: ThresholdMode;
  showAs?: ThresholdShowAs;
  baseColor?: string | null;
  steps?: { value: number; color: string }[];
}

/** One chart series override, parsed from a `series`/`series_regex` entry of `config.override_config`. */
export interface SeriesOverride {
  matchBy: SeriesOverrideMatchBy;
  value: string;
  displayName?: string;
  unit?: string;
  unitCustom?: string;
  decimals?: number;
  color?: string;
  thresholds?: SeriesOverrideThresholds;
}

/** The settings of every override matching one series, merged in list order. */
export interface ResolvedSeriesOverride {
  displayName?: string;
  unit?: string;
  unitCustom?: string;
  decimals?: number;
  color?: string;
  thresholds?: SeriesOverrideThresholds;
}

/** Arguments for `getUnitValue`, the override's unit settings merged over the panel's. */
export interface SeriesUnitArgs {
  unit: any;
  unitCustom: any;
  decimals: any;
}

/** Override lookups for one render, memoised per series name. */
export interface SeriesOverrideLookup {
  readonly active: boolean;
  get: (seriesName: unknown) => ResolvedSeriesOverride | null;
  displayName: <T>(seriesName: T) => T | string;
  unitArgs: (seriesName: unknown) => SeriesUnitArgs;
  formatValue: (value: unknown, seriesName: unknown) => string;
}

/** Chart types whose series take overrides. */
export const SERIES_OVERRIDE_CHART_TYPES: ReadonlySet<string> = new Set([
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "scatter",
  "pie",
  "donut",
  "gauge",
  "metric",
]);

/** `field.matchBy` values that mark an `override_config` entry as a chart series override. */
export const SERIES_OVERRIDE_MATCH_BY = { EXACT: "series", REGEX: "series_regex" } as const;

const MAX_COMPILED_PATTERNS = 500;

const LEGEND_RICH_PREFIXES = ["{a|", "{b|"];

const compiledPatterns = new Map<string, RE2JS | null>();

const compilePattern = (pattern: string): RE2JS | null => {
  if (compiledPatterns.has(pattern)) return compiledPatterns.get(pattern) ?? null;
  if (compiledPatterns.size >= MAX_COMPILED_PATTERNS) compiledPatterns.clear();
  const regex = pattern === "" ? null : tryCompileLinearRegex(pattern);
  compiledPatterns.set(pattern, regex);
  return regex;
};

const isSetText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const toDecimals = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
};

const isStepValue = (value: unknown): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : isSetText(value) && Number.isFinite(Number(value));

const hasThresholdSteps = (thresholds: unknown): thresholds is SeriesOverrideThresholds => {
  const steps = (thresholds as SeriesOverrideThresholds | undefined)?.steps;
  return (
    Array.isArray(steps) && steps.some((step) => isSetText(step?.color) && isStepValue(step?.value))
  );
};

const hasUnitSetting = (resolved: ResolvedSeriesOverride): boolean =>
  resolved.unit !== undefined ||
  resolved.unitCustom !== undefined ||
  resolved.decimals !== undefined;

const isNamedSeries = (series: any): boolean =>
  !!series && series.name !== null && series.name !== undefined && series.name !== "";

// Time-series points are [time, value]; category points are the value itself.
const pointValue = (value: unknown): unknown => (Array.isArray(value) ? value[1] : value);

const recolourSeries = (series: any, color: string, panelType: string, theme: string) => {
  if (series.itemStyle) series.itemStyle = { ...series.itemStyle, color };
  if (!series.itemStyle || "color" in series) series.color = color;
  if (series.lineStyle?.color !== undefined) series.lineStyle = { ...series.lineStyle, color };
  // The area gradient is built from the series colour, so it is rebuilt from the new one.
  if (series.areaStyle) {
    Object.assign(
      series,
      getAreaStyleOverride(panelType, series.areaStyle, color, series.name, theme),
    );
  }
};

const applyAxisSeriesOverride = (
  series: any,
  lookup: SeriesOverrideLookup,
  panelType: string,
  theme: string,
) => {
  const resolved = lookup.get(series.name);
  if (!resolved) return;
  if (resolved.color) recolourSeries(series, resolved.color, panelType, theme);
  if (hasUnitSetting(resolved)) {
    const name = series.name;
    series.label = {
      ...series.label,
      formatter: (params: any) => lookup.formatValue(pointValue(params?.value), name),
    };
  }
};

const percentText = (value: unknown, total: number, decimals: number): string => {
  const numeric = Number(value);
  const percent = total > 0 && Number.isFinite(numeric) ? (numeric / total) * 100 : 0;
  return `${percent.toFixed(decimals)}%`;
};

const applyPieOverrides = (series: any, lookup: SeriesOverrideLookup) => {
  if (!Array.isArray(series?.data)) return;
  // Only the `{d}%` label is unit-free; a custom label already reads the lookup itself.
  const percentLabel = series.label?.formatter === "{d}%";
  const total = series.data.reduce((sum: number, item: any) => {
    const numeric = Number(item?.value);
    return Number.isFinite(numeric) && numeric > 0 ? sum + numeric : sum;
  }, 0);
  series.data = series.data.map((item: any) => {
    const resolved = lookup.get(item?.name);
    if (!resolved) return item;
    let next = item;
    if (resolved.color) next = { ...next, itemStyle: { ...next.itemStyle, color: resolved.color } };
    const decimals = resolved.decimals;
    if (percentLabel && decimals !== undefined) {
      next = {
        ...next,
        label: { ...next.label, formatter: () => percentText(item.value, total, decimals) },
      };
    }
    return next;
  });
};

// A silent gauge drawn on top that shows only the title, so the real data item keeps its original name.
const buildGaugeTitleSeries = (gauge: any, text: string) => ({
  type: "gauge",
  silent: true,
  center: gauge.center,
  radius: gauge.radius,
  startAngle: gauge.startAngle,
  endAngle: gauge.endAngle,
  min: gauge.min,
  max: gauge.max,
  tooltip: { show: false },
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: { show: false },
  pointer: { show: false },
  progress: { show: false },
  anchor: { show: false },
  detail: { show: false },
  title: { ...gauge.title, show: true },
  data: [{ name: text, value: gauge.data?.[0]?.value ?? 0 }],
});

const applyGaugeTitleOverrides = (options: any, lookup: SeriesOverrideLookup) => {
  const titles: any[] = [];
  for (const gauge of options.series) {
    const item = gauge?.type === "gauge" ? gauge.data?.[0] : null;
    const displayName = item ? lookup.get(item.name)?.displayName : undefined;
    if (!displayName || gauge.title?.show === false) continue;
    item.title = { ...item.title, show: false };
    titles.push(buildGaugeTitleSeries(gauge, displayName));
  }
  options.series.push(...titles);
};

const relabelLegendText = (text: unknown, name: string, display: string): unknown => {
  if (text === name) return display;
  const prefix = LEGEND_RICH_PREFIXES.find((p) => text === `${p}${name}}`);
  return prefix ? `${prefix}${display}}` : text;
};

const wrapLegendNames = (legend: any, lookup: SeriesOverrideLookup) => {
  for (const item of Array.isArray(legend) ? legend : [legend]) {
    if (!item || typeof item !== "object") continue;
    const formatter = item.formatter;
    item.formatter = (name: string) => {
      const display = String(lookup.displayName(name));
      if (typeof formatter === "string") return formatter.replace(/\{name\}/g, display);
      if (typeof formatter !== "function") return display;
      const text = formatter(name);
      return display === name ? text : relabelLegendText(text, name, display);
    };
    const tooltipFormatter = item.tooltip?.formatter;
    if (typeof tooltipFormatter !== "function") continue;
    item.tooltip = {
      ...item.tooltip,
      formatter: (params: any) => {
        // The original runs first: it records the hovered series under its original name.
        const text = tooltipFormatter(params);
        const display = lookup.displayName(params?.name);
        return display === params?.name ? text : escapeHtml(String(display));
      },
    };
  }
};

// Trellis titles repeat the series name of their grid.
const relabelTitles = (title: any, displayNames: Map<string, string>) => {
  for (const item of Array.isArray(title) ? title : [title]) {
    const display = typeof item?.text === "string" ? displayNames.get(item.text) : undefined;
    if (display !== undefined) item.text = display;
  }
};

/** True for an `override_config` entry that targets chart series; tables skip these. */
export const isSeriesOverrideEntry = (entry: any): boolean =>
  entry?.field?.matchBy === SERIES_OVERRIDE_MATCH_BY.EXACT ||
  entry?.field?.matchBy === SERIES_OVERRIDE_MATCH_BY.REGEX;

/** A series `override_config` entry as one override, later settings of a type winning; null for other entries. */
export const parseSeriesOverrideEntry = (entry: any): SeriesOverride | null => {
  if (!isSeriesOverrideEntry(entry) || typeof entry.field.value !== "string") return null;
  const override: SeriesOverride = {
    matchBy: entry.field.matchBy === SERIES_OVERRIDE_MATCH_BY.REGEX ? "regex" : "name",
    value: entry.field.value,
  };
  for (const item of Array.isArray(entry.config) ? entry.config : []) {
    const value = item?.value;
    if (item?.type === "unit") {
      override.unit = value?.unit;
      override.unitCustom = value?.customUnit;
    } else if (item?.type === "decimals") override.decimals = value;
    else if (item?.type === "display_name") override.displayName = value;
    else if (item?.type === "series_color") override.color = value;
    else if (item?.type === "thresholds") override.thresholds = value;
  }
  return override;
};

/** The `override_config` entry for one override with only its set settings; null when nothing is set. */
export const toSeriesOverrideEntry = (override: SeriesOverride): Record<string, any> | null => {
  const config: Array<{ type: string; value: unknown }> = [];
  if (isSetText(override.unit) || isSetText(override.unitCustom)) {
    config.push({
      type: "unit",
      value: { unit: override.unit ?? "", customUnit: override.unitCustom ?? "" },
    });
  }
  const decimals = toDecimals(override.decimals);
  if (decimals !== null) config.push({ type: "decimals", value: decimals });
  if (isSetText(override.displayName)) {
    config.push({ type: "display_name", value: override.displayName });
  }
  if (isSetText(override.color)) config.push({ type: "series_color", value: override.color });
  if (hasThresholdSteps(override.thresholds)) {
    config.push({ type: "thresholds", value: override.thresholds });
  }
  if (config.length === 0) return null;
  const matchBy =
    override.matchBy === "regex" ? SERIES_OVERRIDE_MATCH_BY.REGEX : SERIES_OVERRIDE_MATCH_BY.EXACT;
  return { field: { matchBy, value: override.value }, config };
};

/** The chart series overrides of a panel config in list order; table entries are ignored. */
export const getSeriesOverrides = (config: any): SeriesOverride[] =>
  Array.isArray(config?.override_config)
    ? config.override_config
        .map(parseSeriesOverrideEntry)
        .filter((o: SeriesOverride | null): o is SeriesOverride => o !== null)
    : [];

/** True when the override applies to the series; an invalid regex matches nothing. */
export const matchesSeriesOverride = (seriesName: string, override: SeriesOverride): boolean => {
  if (!override || typeof override.value !== "string") return false;
  const name = String(seriesName ?? "");
  if (override.matchBy === "regex") {
    const regex = compilePattern(override.value);
    if (!regex) return false;
    try {
      return regex.test(name);
    } catch {
      return false;
    }
  }
  return override.value === name;
};

/** Merges every override matching the series, later wins per setting; null when none matches or none sets anything. */
export const resolveSeriesOverride = (
  config: any,
  seriesName: string,
): ResolvedSeriesOverride | null => {
  const overrides = getSeriesOverrides(config);
  if (overrides.length === 0) return null;
  const resolved: ResolvedSeriesOverride = {};
  for (const override of overrides) {
    if (!matchesSeriesOverride(seriesName, override)) continue;
    if (isSetText(override.displayName)) resolved.displayName = override.displayName;
    if (isSetText(override.unit)) resolved.unit = override.unit;
    if (isSetText(override.unitCustom)) resolved.unitCustom = override.unitCustom;
    const decimals = toDecimals(override.decimals);
    if (decimals !== null) resolved.decimals = decimals;
    if (isSetText(override.color)) resolved.color = override.color.trim();
    if (hasThresholdSteps(override.thresholds)) resolved.thresholds = override.thresholds;
  }
  return Object.keys(resolved).length > 0 ? resolved : null;
};

/** Override lookups for one render; without overrides every helper returns what the panel settings give. */
export const createSeriesOverrideLookup = (config: any): SeriesOverrideLookup => {
  const active = getSeriesOverrides(config).length > 0;
  const base: SeriesUnitArgs = {
    unit: config?.unit,
    unitCustom: config?.unit_custom,
    decimals: config?.decimals,
  };
  const cache = new Map<string, ResolvedSeriesOverride | null>();
  const get = (seriesName: unknown): ResolvedSeriesOverride | null => {
    if (!active || seriesName === null || seriesName === undefined) return null;
    const key = String(seriesName);
    let resolved = cache.get(key);
    if (resolved === undefined) {
      resolved = resolveSeriesOverride(config, key);
      cache.set(key, resolved);
    }
    return resolved;
  };
  const unitArgs = (seriesName: unknown): SeriesUnitArgs => {
    const resolved = get(seriesName);
    if (!resolved || !hasUnitSetting(resolved)) return base;
    return {
      unit: resolved.unit ?? base.unit,
      unitCustom: resolved.unitCustom ?? base.unitCustom,
      decimals: resolved.decimals ?? base.decimals,
    };
  };
  return {
    active,
    get,
    displayName: <T>(seriesName: T): T | string => get(seriesName)?.displayName ?? seriesName,
    unitArgs,
    formatValue: (value: unknown, seriesName: unknown): string => {
      const args = unitArgs(seriesName);
      return formatUnitValue(getUnitValue(value, args.unit, args.unitCustom, args.decimals));
    },
  };
};

/** Series-level tooltip for a gauge whose override renames it or changes its unit; empty otherwise. */
export const gaugeOverrideTooltip = (
  lookup: SeriesOverrideLookup,
  gaugeName: string,
): { tooltip?: { formatter: (params: any) => string } } => {
  const resolved = lookup.get(gaugeName);
  if (!resolved || (resolved.displayName === undefined && !hasUnitSetting(resolved))) return {};
  const label = escapeHtml(String(lookup.displayName(gaugeName)));
  return {
    tooltip: {
      formatter: (params: any) =>
        `${params?.marker ?? ""} ${label} : <b>${escapeHtml(lookup.formatValue(params?.value, gaugeName))}</b>`,
    },
  };
};

/** Applies override colour, data-label unit, legend and title display names to the final options; matching uses the original names, which stay on the series. */
export const applySeriesOverrides = (options: any, panelSchema: any, theme: string): void => {
  const panelType = panelSchema?.type;
  if (!SERIES_OVERRIDE_CHART_TYPES.has(panelType) || panelType === "metric") return;
  if (!Array.isArray(options?.series)) return;
  const lookup = createSeriesOverrideLookup(panelSchema?.config);
  if (!lookup.active) return;

  if (panelType === "gauge") {
    applyGaugeTitleOverrides(options, lookup);
    return;
  }
  const displayNames = new Map<string, string>();
  for (const series of options.series) {
    if (panelType === "pie" || panelType === "donut") {
      applyPieOverrides(series, lookup);
      continue;
    }
    if (!isNamedSeries(series)) continue;
    applyAxisSeriesOverride(series, lookup, panelType, theme);
    const display = lookup.get(series.name)?.displayName;
    if (display !== undefined) displayNames.set(String(series.name), display);
  }
  wrapLegendNames(options.legend, lookup);
  if (displayNames.size && options.title) relabelTitles(options.title, displayNames);
};
