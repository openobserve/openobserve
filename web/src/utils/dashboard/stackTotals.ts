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

import { escapeHtml } from "@/utils/html";
import { gt } from "@/types/i18n";
import type { SeriesOverrideLookup } from "./seriesOverrides";

interface TooltipParam {
  seriesIndex: number;
  seriesName?: unknown;
}

interface StackGroup {
  first: number;
  members: number;
  total: number;
  counted: number;
  names: string[];
  seriesName: unknown;
  unit: string;
  mixedUnits: boolean;
}

type ValueAxisKey = "xAxis" | "yAxis";

interface ValueAxisBounds {
  min?: unknown;
  max?: unknown;
}

interface StackedSeries {
  name?: unknown;
  stack?: unknown;
  data?: unknown;
  _panelQueryIndex?: number;
}

interface StackedOptions {
  series?: unknown;
  xAxis?: unknown;
  yAxis?: unknown;
}

const STACK_TOTAL_CHART_TYPES: ReadonlySet<string> = new Set([
  "area-stacked",
  "stacked",
  "h-stacked",
]);

// Horizontal stacks put their values on the x axis; bars grow from 0 while a stacked area may be zoomed above it.
const STACKED_VALUE_AXIS: Readonly<Record<string, { axis: ValueAxisKey; fromZero: boolean }>> = {
  stacked: { axis: "yAxis", fromZero: true },
  "area-stacked": { axis: "yAxis", fromZero: false },
  "h-stacked": { axis: "xAxis", fromZero: true },
};

// A time shift or a second Y field appends the same "(...)" to every series name of its stack.
const NAME_SUFFIX = / (\([^()]*\))$/;

const toFinite = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

// A time-axis point is [time, value]; a category point sits at its category's index.
const pointOf = (point: unknown, index: number): [unknown, number | null] => {
  if (Array.isArray(point)) {
    const time = point[0] instanceof Date ? point[0].getTime() : point[0];
    return [time, toFinite(point[1])];
  }
  return [index, toFinite(point)];
};

const sharedSuffix = (names: string[]): string => {
  const suffix = names[0]?.match(NAME_SUFFIX)?.[1];
  return suffix && names.every((name) => name.endsWith(` ${suffix}`)) ? suffix : "";
};

const groupParams = (
  params: TooltipParam[],
  series: StackedSeries[],
  lookup: SeriesOverrideLookup,
  valueOf: (param: TooltipParam) => unknown,
): Map<string, StackGroup> => {
  const groups = new Map<string, StackGroup>();
  for (const param of params) {
    const stack = series[param?.seriesIndex]?.stack;
    if (stack === null || stack === undefined || stack === "") continue;
    const key = String(stack);
    let group = groups.get(key);
    if (!group) {
      group = {
        first: param.seriesIndex,
        members: 0,
        total: 0,
        counted: 0,
        names: [],
        seriesName: param.seriesName,
        unit: "",
        mixedUnits: false,
      };
      groups.set(key, group);
    }
    group.members++;
    group.first = Math.min(group.first, param.seriesIndex);
    group.names.push(String(param.seriesName ?? ""));
    const value = toFinite(valueOf(param));
    if (value === null) continue;
    const unit = JSON.stringify(lookup.unitArgs(param.seriesName));
    if (group.counted === 0) {
      group.unit = unit;
      group.seriesName = param.seriesName;
    } else if (unit !== group.unit) group.mixedUnits = true;
    group.total += value;
    group.counted++;
  }
  return groups;
};

/** Tooltip rows with one total per stack of the hovered points; sum them before any row cap. */
export const stackTotalRows = (
  panelType: string,
  params: unknown,
  series: unknown,
  lookup: SeriesOverrideLookup,
  valueOf: (param: TooltipParam) => unknown,
): string[] => {
  if (!STACK_TOTAL_CHART_TYPES.has(panelType) || !Array.isArray(params) || !Array.isArray(series))
    return [];
  const stackSeries: StackedSeries[] = series;
  const groups = [...groupParams(params, stackSeries, lookup, valueOf).values()].sort(
    (a, b) => a.first - b.first,
  );
  const distinct = (labels: string[]) => new Set(labels).size === labels.length;
  const bySuffix = groups.map((group) => (groups.length > 1 ? sharedSuffix(group.names) : ""));
  // Stacks of different panel queries read as that query's number.
  const byQuery = groups.map(
    (group, index) => `#${(stackSeries[group.first]?._panelQueryIndex ?? index) + 1}`,
  );
  const labels = distinct(bySuffix)
    ? bySuffix
    : distinct(byQuery)
      ? byQuery
      : groups.map((_, index) => `#${index + 1}`);
  const title = gt("dashboard.stackTotal");
  const rows: string[] = [];
  groups.forEach((group, index) => {
    // A single-series stack repeats its own row, and mixed units cannot be summed.
    if (group.members < 2 || group.counted === 0 || group.mixedUnits) return;
    const label = labels[index];
    const name = label ? `${title} ${label}` : title;
    const value = lookup.formatValue(group.total, group.seriesName);
    rows.push(`<strong>${escapeHtml(name)} : ${escapeHtml(value)}</strong>`);
  });
  return rows;
};

/** Widens a user-set value-axis min/max so it never cuts into a stack; positives and negatives stack apart. */
export const fitAxisBoundsToStacks = (
  options: StackedOptions | null | undefined,
  valueAxis: ValueAxisKey = "yAxis",
  fromZero = true,
): void => {
  const axis = options?.[valueAxis];
  if (!axis || typeof axis !== "object" || !Array.isArray(options?.series)) return;
  const bounds = axis as ValueAxisBounds;
  const hasMax = typeof bounds.max === "number";
  const hasMin = typeof bounds.min === "number";
  if (!hasMax && !hasMin) return;
  const sums = new Map<string, Map<unknown, number>>();
  const sumsOf = (key: string) => {
    let buckets = sums.get(key);
    if (!buckets) sums.set(key, (buckets = new Map()));
    return buckets;
  };
  let hi = fromZero ? 0 : -Infinity;
  let lo = fromZero ? 0 : Infinity;
  let seen = false;
  options.series.forEach((series: StackedSeries, seriesIndex: number) => {
    // Unnamed series carry annotations and limit lines, not stacked data.
    if (!series?.name || !Array.isArray(series.data)) return;
    const stack =
      series.stack === null || series.stack === undefined || series.stack === ""
        ? `series:${seriesIndex}`
        : `stack:${String(series.stack)}`;
    const positive = sumsOf(`${stack}|+`);
    const negative = sumsOf(`${stack}|-`);
    series.data.forEach((point: unknown, index: number) => {
      const [bucket, value] = pointOf(point, index);
      if (value === null) return;
      seen = true;
      const buckets = value < 0 ? negative : positive;
      const sum = (buckets.get(bucket) ?? 0) + value;
      buckets.set(bucket, sum);
      // Only stack ends set the extent; a segment value inside a stack never does.
      if (value < 0) lo = Math.min(lo, sum);
      else hi = Math.max(hi, sum);
    });
  });
  if (!seen) return;
  if (hasMax && Number.isFinite(hi)) bounds.max = Math.max(bounds.max as number, hi);
  if (hasMin && Number.isFinite(lo)) bounds.min = Math.min(bounds.min as number, lo);
};

/** Fits the value-axis bounds of stacked chart types; other types are left untouched. */
export const fitStackedAxisBounds = (
  chartType: string,
  options: StackedOptions | null | undefined,
): void => {
  const fit = STACKED_VALUE_AXIS[chartType];
  if (fit) fitAxisBoundsToStacks(options, fit.axis, fit.fromZero);
};
