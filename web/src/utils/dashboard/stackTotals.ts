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

const STACK_TOTAL_CHART_TYPES: ReadonlySet<string> = new Set([
  "area-stacked",
  "stacked",
  "h-stacked",
]);

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

const sharedSuffix = (names: string[]): string => {
  const suffix = names[0]?.match(NAME_SUFFIX)?.[1];
  return suffix && names.every((name) => name.endsWith(` ${suffix}`)) ? suffix : "";
};

const groupParams = (
  params: any[],
  series: any[],
  lookup: SeriesOverrideLookup,
  valueOf: (param: any) => unknown,
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
  valueOf: (param: any) => unknown,
): string[] => {
  if (!STACK_TOTAL_CHART_TYPES.has(panelType) || !Array.isArray(params) || !Array.isArray(series))
    return [];
  const groups = [...groupParams(params, series, lookup, valueOf).values()].sort(
    (a, b) => a.first - b.first,
  );
  const distinct = (labels: string[]) => new Set(labels).size === labels.length;
  const bySuffix = groups.map((group) => (groups.length > 1 ? sharedSuffix(group.names) : ""));
  // Stacks of different panel queries read as that query's number.
  const byQuery = groups.map(
    (group, index) => `#${((series as any[])[group.first]?._panelQueryIndex ?? index) + 1}`,
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
