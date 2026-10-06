// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Dashboard / metrics-explorer panel → AlertPrefill.
 *
 * Replaces the two hand-rolled payload builders that used to live in
 * PanelContainer.vue and usePanelActions.ts. Pure and synchronous (invariant 5):
 * the one piece that genuinely needs the async SQL parser — injecting a HAVING
 * clause into a raw SQL panel query — is carried as `meta.sqlHaving` and applied
 * by the consumer, which already owns the parser.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillQueryChoice,
  type AlertPrefillStreamCandidate,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { sanitizeAlertNamePart, periodMinutesFromRange, warn } from "../alertPrefill";
import { formulaRefs, isFormulaQuery, queryRefs } from "@/utils/dashboard/promql/formula";

/** Panel types whose shape has no meaningful row count to alert on. */
const UNSUPPORTED_PANEL_TYPES = ["markdown", "html", "geomap", "sankey"];

export interface PanelPrefillInput {
  panelTitle?: string;
  panelId?: string;
  panelType?: string;
  queries?: any[];
  queryType?: string;
  /** The panel query to alert on; the first when absent. */
  queryIndex?: number;
  /** Offered in the confirm dialog when the user has to pick the query. */
  queryChoices?: AlertPrefillQueryChoice[];
  /** The chosen query with dashboard variables already substituted — preferred over its raw text. */
  executedQuery?: string;
  timeRange?: {
    value_type?: string;
    relative_value?: number;
    relative_period?: string;
    startTime?: number;
    endTime?: number;
    /** A rendered panel's window. */
    start_time?: Date | null;
    end_time?: Date | null;
  };
  /** Wall-clock time in ms; a Date-pair window ending this close to it was a relative range. */
  now?: number;
  /** Threshold picked off the chart (context-menu flow). */
  threshold?: number;
  condition?: "above" | "below";
  /** Y-axis column the threshold applies to, extracted at the call site. */
  yAxisColumn?: string | null;
  timezone?: string;
}

/** Microseconds since the epoch exceed this; milliseconds do not until the year 5138. */
const MIN_EPOCH_MICROS = 1e14;

/** A rendered window ending within this of now was a relative ("last N") range. */
const ROLLING_END_TOLERANCE_MICROS = 5 * 60_000_000;

// Dashboards build these Dates from µs epochs, the Explorer from ms.
export const dateToMicros = (date: Date): number => {
  const value = date.getTime();
  return value > MIN_EPOCH_MICROS ? value : value * 1000;
};

/** The dashboard time range uses its own vocabulary; map it onto the shared one. */
const toPrefillRange = (timeRange: PanelPrefillInput["timeRange"], nowMs: number) => {
  if (!timeRange) return null;

  if (timeRange.start_time instanceof Date && timeRange.end_time instanceof Date) {
    const startTime = dateToMicros(timeRange.start_time);
    const endTime = dateToMicros(timeRange.end_time);
    if (Math.abs(nowMs * 1000 - endTime) <= ROLLING_END_TOLERANCE_MICROS && endTime > startTime) {
      const minutes = Math.max(1, Math.round((endTime - startTime) / 60_000_000));
      return { type: "relative" as const, relativeTimePeriod: `${minutes}m` };
    }
    return { type: "absolute" as const, startTime, endTime };
  }

  if (timeRange.value_type === "relative") {
    const value = timeRange.relative_value || 15;
    const unit = (timeRange.relative_period || "Minutes").toLowerCase();
    const suffix = unit.startsWith("hour")
      ? "h"
      : unit.startsWith("day")
        ? "d"
        : unit.startsWith("week")
          ? "w"
          : "m";
    return { type: "relative" as const, relativeTimePeriod: `${value}${suffix}` };
  }

  return {
    type: "absolute" as const,
    startTime: timeRange.startTime,
    endTime: timeRange.endTime,
  };
};

/**
 * Map a query-builder panel's fields onto the alert's aggregation block. Only
 * applies to built (non-custom) SQL queries — a custom query is opaque to us.
 */
const aggregationFromFields = (fields: any) => {
  if (!fields) return null;

  const groupBy = (fields.x ?? []).map((x: any) => x.alias || x.column).filter(Boolean);
  const yField = fields.y?.[0];

  if (!groupBy.length && !yField?.aggregationFunction) return null;

  return {
    group_by: groupBy,
    function: (yField?.aggregationFunction || "count").toLowerCase(),
    having: {
      column: yField ? yField.alias || yField.column : "",
      operator: ">=",
      value: 1,
    },
  };
};

/**
 * Panel filters come in two shapes, and both are live: dashboard schema v5+
 * stores a group object (`{ filterType: "group", conditions: [...] }`, possibly
 * nested), while pre-v5 panels — and metrics-explorer style callers — still hand
 * over a flat array. Reading only the array shape is what made every v5 panel
 * throw here, taking the whole "create alert" click with it.
 *
 * Alert conditions are one flat AND list, so nested groups are flattened.
 */
const flattenPanelFilters = (filter: any): any[] => {
  if (!filter) return [];
  if (Array.isArray(filter)) return filter;

  return (filter.conditions ?? []).flatMap((condition: any) =>
    condition?.filterType === "group" ? flattenPanelFilters(condition) : [condition],
  );
};

/** List-type panel filters map cleanly onto alert conditions; nothing else does. */
const conditionsFromFilters = (fields: any, makeId: () => string) => {
  const conditions = flattenPanelFilters(fields?.filter)
    .filter((f: any) => f?.type === "list" && f.values?.length)
    .map((f: any) => ({
      filterType: "condition",
      column: f.column,
      operator: "=",
      value: f.values[0],
      values: [],
      logicalOperator: "AND",
      id: makeId(),
    }));

  if (!conditions.length) return undefined;

  return {
    filterType: "group" as const,
    logicalOperator: "AND",
    groupId: makeId(),
    conditions,
  };
};

/** The metrics a formula's inputs read, once each; an alert needs one of them as its stream. */
const formulaInputStreams = (queries: any[], formula: string): AlertPrefillStreamCandidate[] => {
  const referenced = new Set(formulaRefs(formula));
  const letters = queryRefs(queries);
  const seen = new Set<string>();
  return queries.flatMap((query, i) => {
    const name = query?.fields?.stream;
    const letter = letters[i];
    if (!name || !letter || !referenced.has(letter) || isFormulaQuery(query) || seen.has(name))
      return [];
    seen.add(name);
    return [{ name, type: query.fields.stream_type || "metrics" }];
  });
};

/** The executed text of a panel query's current-period window; shifted windows follow the primaries. */
export const executedPanelQuery = (
  metadataQueries: any[] | undefined,
  panelQueryIndex: number,
): string | undefined => {
  const primary = metadataQueries?.find(
    (entry: any) =>
      entry?.panelQueryIndex === panelQueryIndex && !Number(entry?.timeRangeGap?.seconds),
  );
  return (primary ?? metadataQueries?.[panelQueryIndex])?.query || undefined;
};

/** The confirm dialog's choice of query, one per visible panel query. */
export const panelQueryChoices = (
  queries: any[],
  metadataQueries: any[] | undefined,
  visibleIndexes: number[] = queries.map((_, index) => index),
): AlertPrefillQueryChoice[] =>
  visibleIndexes.map((index) => ({
    index,
    tabName: queries[index]?.tabName,
    query: executedPanelQuery(metadataQueries, index) ?? queries[index]?.query ?? "",
  }));

export const buildPrefillFromPanel = (
  input: PanelPrefillInput,
  makeId: () => string = () => Math.random().toString(36).slice(2),
): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];
  const queryIndex = input.queryIndex ?? 0;
  const query = input.queries?.[queryIndex];

  if (input.panelType && UNSUPPORTED_PANEL_TYPES.includes(input.panelType)) {
    warnings.push(warn("unsupportedPanelType", "warning", { type: input.panelType }));
  }

  if (!input.queries?.length) {
    warnings.push(warn("noQueries", "blocking"));
  }

  const isPromql = input.queryType === "promql";
  const inputStreams =
    isPromql && isFormulaQuery(query)
      ? formulaInputStreams(input.queries ?? [], query.config.formula)
      : [];
  const sourceQuery = input.executedQuery || query?.query || "";
  // Raw text from a query that never ran may still hold dashboard variables the evaluator cannot fill.
  if (!input.executedQuery && /\$(\w|\{)/.test(sourceQuery)) {
    warnings.push(warn("unresolvedQuery", "blocking"));
  }

  const { minutes, warnings: rangeWarnings } = periodMinutesFromRange(
    toPrefillRange(input.timeRange, input.now ?? Date.now()),
  );
  warnings.push(...rangeWarnings);

  // A built (non-custom) SQL panel carries structured fields we can lift into
  // the alert's aggregation + conditions rather than leaving it as opaque SQL.
  const isBuilt = !isPromql && query?.customQuery === false && !!query?.fields;
  const aggregation = isBuilt ? aggregationFromFields(query.fields) : null;
  const conditions = isBuilt ? conditionsFromFilters(query.fields, makeId) : undefined;

  const hasThreshold = input.threshold !== undefined && !!input.condition;
  const operator = input.condition === "above" ? ">=" : "<=";

  if (hasThreshold && aggregation) {
    aggregation.having.value = input.threshold as number;
    aggregation.having.operator = operator;
  }

  const prefill: AlertPrefill = {
    version: ALERT_PREFILL_VERSION,
    source: "panel",
    sourceLabel: input.panelTitle || "panel",
    name: `Alert_from_${sanitizeAlertNamePart(input.panelTitle, "panel")}`,
    streamType: query?.fields?.stream_type || (isPromql ? "metrics" : "logs"),
    streamName: inputStreams[0]?.name ?? (query?.fields?.stream || ""),
    ...(inputStreams.length > 1 ? { streamCandidates: inputStreams } : {}),
    queryType: isPromql ? "promql" : "sql",
    vrlFunction: query?.vrlFunctionQuery || null,
    aggregation,
    conditions,
    periodMinutes: minutes,
    timezone: input.timezone,
    warnings,
    meta: {
      panelId: input.panelId,
      panelType: input.panelType,
    },
    ...(input.queryChoices ? { queryChoices: input.queryChoices, queryIndex } : {}),
  };

  if (isPromql) {
    prefill.promql = sourceQuery;
    if (hasThreshold) {
      prefill.promqlCondition = {
        column: "value",
        operator,
        value: input.threshold as number,
      };
    }
  } else {
    prefill.sql = sourceQuery;
    // Raw-SQL panels get their threshold as a HAVING clause injected into the
    // query text, which needs the SQL parser — the consumer applies this.
    if (hasThreshold && !aggregation && input.yAxisColumn) {
      prefill.meta = {
        ...prefill.meta,
        sqlHaving: {
          column: input.yAxisColumn,
          operator,
          value: input.threshold,
        },
      };
    }
  }

  return prefill;
};
