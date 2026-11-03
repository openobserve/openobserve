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

/** The five-number summary and sample count a box plot builder query computes per category. */
export const BOXPLOT_STATS = [
  { key: "low", column: "min", sql: (value: string) => `min(${value})` },
  { key: "q1", column: "q1", sql: (value: string) => `approx_percentile_cont(${value}, 0.25)` },
  {
    key: "median",
    column: "median",
    sql: (value: string) => `approx_percentile_cont(${value}, 0.5)`,
  },
  { key: "q3", column: "q3", sql: (value: string) => `approx_percentile_cont(${value}, 0.75)` },
  { key: "high", column: "max", sql: (value: string) => `max(${value})` },
  { key: "count", column: "count", sql: (value: string) => `count(${value})` },
] as const;

export type BoxplotStatKey = (typeof BOXPLOT_STATS)[number]["key"];

export const boxplotStatAlias = (alias: string, column: string) => `${alias}_${column}`;

export const boxplotStatAliases = (alias: string) =>
  BOXPLOT_STATS.map((stat) => boxplotStatAlias(alias, stat.column));
