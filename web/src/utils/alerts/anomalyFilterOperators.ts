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

/**
 * Operator list that mirrors the dashboard condition operators
 * (AddCondition.vue) so both surfaces stay in sync.
 */
export const ANOMALY_FILTER_OPERATORS = [
  "=",
  "<>",
  ">=",
  "<=",
  ">",
  "<",
  "IN",
  "NOT IN",
  "str_match",
  "str_match_ignore_case",
  "match_all",
  "re_match",
  "re_not_match",
  "Contains",
  "Starts With",
  "Ends With",
  "Not Contains",
  "Is Null",
  "Is Not Null",
] as const;

export type AnomalyFilterOperator = (typeof ANOMALY_FILTER_OPERATORS)[number];

/** Returns true when the operator requires a value input. */
export const operatorNeedsValue = (op: string): boolean =>
  op !== "Is Null" && op !== "Is Not Null";

/**
 * Converts a single filter row { field, operator, value } into a SQL
 * expression fragment (no leading AND/WHERE).
 *
 * Mirrors the operator handling in dashboardAutoQueryBuilder.ts
 * `buildCondition()` but without dashboard-specific context (no stream
 * aliases, no column-type lookup).
 */
export const buildAnomalyFilterExpression = (
  field: string,
  operator: string,
  value: string,
): string => {
  if (!field) return "";

  const quoted = (v: string) => `'${v}'`;

  switch (operator) {
    case "Is Null":
      return `${field} IS NULL`;
    case "Is Not Null":
      return `${field} IS NOT NULL`;
    case "IN":
      return `${field} IN (${value})`;
    case "NOT IN":
      return `${field} NOT IN (${value})`;
    case "match_all":
      return `match_all(${quoted(value)})`;
    case "str_match":
    case "Contains":
      return `str_match(${field}, ${quoted(value)})`;
    case "str_match_ignore_case":
      return `str_match_ignore_case(${field}, ${quoted(value)})`;
    case "re_match":
      return `re_match(${field}, ${quoted(value)})`;
    case "re_not_match":
      return `re_not_match(${field}, ${quoted(value)})`;
    case "Not Contains":
      return `${field} NOT LIKE '%${value}%'`;
    case "Starts With":
      return `${field} LIKE '${value}%'`;
    case "Ends With":
      return `${field} LIKE '%${value}'`;
    default:
      // =, <>, >, <, >=, <=
      return `${field} ${operator} ${quoted(value)}`;
  }
};
