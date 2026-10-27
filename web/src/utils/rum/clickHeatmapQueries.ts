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

import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { rumFieldNames } from "@/utils/rum/fields";
import { scopeClause, type AnalyticsScope } from "@/utils/rum/productAnalyticsQueries";

export type DeviceClass = "all" | "desktop" | "tablet" | "phone";
export type DeviceBucket = Exclude<DeviceClass, "all"> | "unknown";

export const TABLET_MIN_WIDTH = 768;
export const DESKTOP_MIN_WIDTH = 1024;
export const PAGE_LIST_LIMIT = 50;
export const RANKING_LIMIT = 500;

const WIDTH = "display_viewport_width";
const NAME = "action_target_name";
const FRUSTRATION = "action_frustration_type";
// Frustration is a JSON array in a text column, so an empty '[]' means no signal.
const NO_SIGNAL = "('', '[]')";

const has = (scope: AnalyticsScope, field: string): boolean => scope.schema[field] === true;

const present = (scope: AnalyticsScope, field: string): string | null => {
  const names = rumFieldNames(field).filter((n) => has(scope, n));
  if (!names.length) return null;
  return names.length === 1 ? names[0] : `COALESCE(${names.join(", ")})`;
};

const widthExpr = (scope: AnalyticsScope): string =>
  has(scope, WIDTH) ? WIDTH : "CAST(NULL AS BIGINT)";

const frustrationHas = (scope: AnalyticsScope, signal: string): string =>
  has(scope, FRUSTRATION)
    ? `COUNT(DISTINCT CASE WHEN ${FRUSTRATION} LIKE '%${signal}%' THEN action_id END)`
    : "0";

const frustratedExpr = (scope: AnalyticsScope): string =>
  has(scope, FRUSTRATION)
    ? `COUNT(DISTINCT CASE WHEN ${FRUSTRATION} IS NOT NULL AND ${FRUSTRATION} NOT IN ${NO_SIGNAL} THEN action_id END)`
    : "0";

/** The expression naming a clicked element, or null when the stream records no target. */
export function selectorExpr(scope: AnalyticsScope): string | null {
  const target = present(scope, "action_target");
  if (target) return `json_get_str(${target}, 'selector')`;
  return present(scope, "action_target_selector");
}

const clickRows = (scope: AnalyticsScope): string => {
  const parts = [scopeClause(scope), "type = 'action'"];
  if (has(scope, "action_type")) parts.push("action_type = 'click'");
  return parts.join(" AND ");
};

/** Phone, tablet and desktop are cut by the viewport width recorded with the click. */
export function deviceClause(scope: AnalyticsScope, device: DeviceClass): string {
  if (device === "all") return "";
  if (!has(scope, WIDTH)) return " AND 1 = 0";
  if (device === "phone") return ` AND ${WIDTH} > 0 AND ${WIDTH} < ${TABLET_MIN_WIDTH}`;
  if (device === "tablet") {
    return ` AND ${WIDTH} >= ${TABLET_MIN_WIDTH} AND ${WIDTH} < ${DESKTOP_MIN_WIDTH}`;
  }
  return ` AND ${WIDTH} >= ${DESKTOP_MIN_WIDTH}`;
}

const pageRows = (scope: AnalyticsScope, url: string, device: DeviceClass): string =>
  `${clickRows(scope)} AND view_url = ${sqlLiteral(url)}${deviceClause(scope, device)}`;

/** Clicks per page, for the page picker. */
export function pageListSql(scope: AnalyticsScope): string {
  return `SELECT view_url, COUNT(DISTINCT action_id) AS clicks FROM "_rumdata" WHERE ${clickRows(scope)} AND view_url IS NOT NULL AND view_url <> '' GROUP BY view_url ORDER BY clicks DESC, view_url ASC LIMIT ${PAGE_LIST_LIMIT}`;
}

/** Clicks per device class on one page; clicks without a width land in `unknown`. */
export function deviceSplitSql(scope: AnalyticsScope, url: string): string {
  const w = widthExpr(scope);
  const cls = `CASE WHEN ${w} >= ${DESKTOP_MIN_WIDTH} THEN 'desktop' WHEN ${w} >= ${TABLET_MIN_WIDTH} THEN 'tablet' WHEN ${w} > 0 THEN 'phone' ELSE 'unknown' END`;
  return `SELECT ${cls} AS cls, COUNT(DISTINCT action_id) AS clicks FROM "_rumdata" WHERE ${clickRows(scope)} AND view_url = ${sqlLiteral(url)} GROUP BY cls ORDER BY cls ASC`;
}

/** Distinct clicks, distinct sessions and frustrated clicks for one page and device. */
export function totalsSql(scope: AnalyticsScope, url: string, device: DeviceClass): string {
  return `SELECT COUNT(DISTINCT action_id) AS clicks, COUNT(DISTINCT session_id) AS sessions, ${frustratedExpr(scope)} AS frustrated FROM "_rumdata" WHERE ${pageRows(scope, url, device)}`;
}

/** Per-element clicks, sessions and frustration split; null when the stream records no target. */
export function rankingSql(scope: AnalyticsScope, url: string, device: DeviceClass): string | null {
  const sel = selectorExpr(scope);
  if (!sel) return null;
  const name = has(scope, NAME) ? `MAX(${NAME})` : "CAST(NULL AS VARCHAR)";
  const cols = [
    `${sel} AS selector`,
    `${name} AS name`,
    "COUNT(DISTINCT action_id) AS clicks",
    "COUNT(DISTINCT session_id) AS sessions",
    `${frustrationHas(scope, "rage_click")} AS rage`,
    `${frustrationHas(scope, "dead_click")} AS dead`,
    `${frustrationHas(scope, "error_click")} AS err`,
    `${frustratedExpr(scope)} AS frustrated`,
  ];
  return `SELECT ${cols.join(", ")} FROM "_rumdata" WHERE ${pageRows(scope, url, device)} AND ${sel} IS NOT NULL GROUP BY selector ORDER BY clicks DESC, sessions DESC, selector ASC LIMIT ${RANKING_LIMIT}`;
}
