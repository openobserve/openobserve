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

export type TooltipSort = "none" | "asc" | "desc";

export const TOOLTIP_SORT_VALUES: readonly TooltipSort[] = ["none", "asc", "desc"];

/** The panel's tooltip row order; a missing or unknown value keeps the value-descending default. */
export const resolveTooltipSort = (config: any): TooltipSort => {
  const value = config?.tooltip_sort;
  return value === "none" || value === "asc" ? value : "desc";
};

/** Sorts axis-tooltip rows in place by `config.tooltip_sort`; rows without a numeric value go last in either direction. */
export const sortTooltipParams = <T>(
  params: T[],
  config: any,
  valueOf: (row: T) => unknown,
): T[] => {
  if (!Array.isArray(params)) return params;
  const sort = resolveTooltipSort(config);
  if (sort === "none") return params;
  const direction = sort === "asc" ? -1 : 1;
  const numberOf = (row: T): number | null => {
    const value = valueOf(row);
    const numeric = value === null || value === undefined || value === "" ? NaN : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  params.sort((a, b) => {
    const x = numberOf(a);
    const y = numberOf(b);
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0);
    return direction * (y - x);
  });
  return params;
};
