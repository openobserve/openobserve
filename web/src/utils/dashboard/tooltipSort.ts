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

/** Sorts axis-tooltip rows in place by `config.tooltip_sort`; `valueOf` must already map a missing value to a number. */
export const sortTooltipParams = <T>(
  params: T[],
  config: any,
  valueOf: (row: T) => number,
): T[] => {
  if (!Array.isArray(params)) return params;
  const sort = resolveTooltipSort(config);
  if (sort === "none") return params;
  const direction = sort === "asc" ? -1 : 1;
  params.sort((a, b) => direction * (valueOf(b) - valueOf(a)));
  return params;
};
