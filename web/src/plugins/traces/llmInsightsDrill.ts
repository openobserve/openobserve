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
 * Insights that drill down (AIO-26): the page's search filter and the trace
 * list behind a clicked chart point or KPI tile.
 *
 * The filter is trace-level: a trace matches when any of its spans matches,
 * so a model filter keeps the trace's tool and root spans too.
 */

import { TRACE_ERROR_SPANS_SQL, TRACE_ERRORED_SQL } from "./llmTraceOutcome";
import {
  agentFallbackUsage,
  agentParentsJoin,
  MODEL_SERIES_SQL,
  type LLMPanelDef,
} from "./config/llmInsightsPanels";
import { ATTRIBUTION_COLUMNS, traceUsageSum } from "./llmAttribution";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { timestampToTimezoneDate } from "@/utils/timezone";

/** A clicked chart point: the series value and, on a time axis, the bucket start (µs). */
export interface LLMPanelDrill {
  panel: LLMPanelDef;
  series: string | null;
  atMicros: number | null;
}

/** The span column a page click filters on (a model series, a Cost by row). */
export const FILTER_COLUMNS = { model: MODEL_SERIES_SQL, ...ATTRIBUTION_COLUMNS } as const;
export type FilterDim = keyof typeof FILTER_COLUMNS;

/** `column = 'value'`, as the search bar would hold it. */
export function equalsClause(dim: FilterDim, value: string): string {
  return `${FILTER_COLUMNS[dim]} = ${sqlLiteral(value)}`;
}

/**
 * The search with one more clause ANDed on; unchanged when it is already there.
 * A search with an OR is wrapped, so the clause narrows all of it.
 */
export function addSearchClause(search: string, clause: string): string {
  const q = search.trim();
  if (!q) return clause;
  if (q.includes(clause)) return q;
  return /\bor\b/i.test(q) ? `(${q}) and ${clause}` : `${q} and ${clause}`;
}

/**
 * The search bar's WHERE text as a bare trace-level predicate (no leading AND):
 * a trace matches when any of its spans does. "" when the search is empty.
 */
export function searchFilterSql(stream: string, search: string): string {
  const q = search.trim();
  return q ? `trace_id IN (SELECT trace_id FROM "${stream}" WHERE (${q}))` : "";
}

/** What a click selected: a series value, errored traces, or both, in a time range (µs). */
export interface TraceListSelection {
  startTime: number;
  endTime: number;
  /** Expression the clicked series was computed from, and its value. */
  seriesSql?: string;
  seriesValue?: string;
  /** true: only traces with an errored span; false: only traces without one. */
  errored?: boolean;
  /**
   * Only traces whose cost is on their agent span alone: the cost trend's
   * unattributed series, which no model value can select.
   */
  agentOnly?: boolean;
}

export const TRACE_LIST_LIMIT = 50;

/**
 * The trace list's row time: the time alone inside one calendar day, with the
 * date when the window spans several, so rows from different days differ.
 */
export function traceRowTimeFormat(sel: TraceListSelection | null, timezone: string): string {
  if (!sel) return "HH:mm:ss";
  const day = (us: number) => timestampToTimezoneDate(us, timezone, "yyyy-MM-dd");
  return day(sel.startTime) === day(sel.endTime) ? "HH:mm:ss" : "MMM d HH:mm:ss";
}

/**
 * The newest matching traces, one row each, with their errored span count.
 * A series that is also errored (a failing tool) needs one span that is both:
 * a trace whose grep call worked but whose LLM call failed is not a grep failure.
 * `hasParentSpan`: the stream stores span parents (`agentParentsJoin`).
 */
export function traceListSql(
  stream: string,
  sel: TraceListSelection,
  scope: string,
  hasParentSpan: boolean,
): string {
  const having: string[] = [];
  const series =
    sel.seriesSql && sel.seriesValue !== undefined
      ? `${sel.seriesSql} = ${sqlLiteral(sel.seriesValue)}`
      : "";
  if (series && sel.errored) {
    having.push(`max(CASE WHEN ${series} AND span_status = 'ERROR' THEN 1 ELSE 0 END) = 1`);
  } else if (series) {
    having.push(`max(CASE WHEN ${series} THEN 1 ELSE 0 END) = 1`);
  } else if (sel.errored !== undefined) {
    having.push(`${TRACE_ERRORED_SQL} = ${sel.errored ? 1 : 0}`);
  }
  if (sel.agentOnly) having.push(`${agentFallbackUsage("gen_ai_usage_cost")} > 0`);
  return [
    "SELECT trace_id, MIN(_timestamp) AS ts, MAX(end_time) - MIN(start_time) AS duration_ns,",
    "FIRST_VALUE(gen_ai_input_messages ORDER BY start_time ASC)",
    "FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != '') AS input,",
    `MAX(gen_ai_response_model) AS model, ${traceUsageSum("gen_ai_usage_cost")} AS cost,`,
    `${TRACE_ERROR_SPANS_SQL} AS error_spans`,
    `FROM "${stream}"${agentParentsJoin(stream, hasParentSpan)}`,
    scope ? `WHERE ${scope}` : "",
    "GROUP BY trace_id",
    having.length ? `HAVING ${having.join(" AND ")}` : "",
    `ORDER BY ts DESC LIMIT ${TRACE_LIST_LIMIT}`,
  ]
    .filter(Boolean)
    .join(" ");
}
