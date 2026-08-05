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
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { sanitizeAlertNamePart, periodMinutesFromRange, warn } from "../alertPrefill";

/** Panel types whose shape has no meaningful row count to alert on. */
const UNSUPPORTED_PANEL_TYPES = ["markdown", "html", "geomap", "sankey"];

export interface PanelPrefillInput {
  panelTitle?: string;
  panelId?: string;
  panelType?: string;
  queries?: any[];
  queryType?: string;
  /** Query with dashboard variables already substituted — preferred over queries[0].query. */
  executedQuery?: string;
  timeRange?: {
    value_type?: string;
    relative_value?: number;
    relative_period?: string;
    startTime?: number;
    endTime?: number;
  };
  /** Threshold picked off the chart (context-menu flow). */
  threshold?: number;
  condition?: "above" | "below";
  /** Y-axis column the threshold applies to, extracted at the call site. */
  yAxisColumn?: string | null;
  timezone?: string;
}

/** The dashboard time range uses its own vocabulary; map it onto the shared one. */
const toPrefillRange = (timeRange: PanelPrefillInput["timeRange"]) => {
  if (!timeRange) return null;

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

/** List-type panel filters map cleanly onto alert conditions; nothing else does. */
const conditionsFromFilters = (fields: any, makeId: () => string) => {
  const filters = fields?.filter ?? [];
  const conditions = filters
    .filter((f: any) => f.type === "list" && f.values?.length)
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

export const buildPrefillFromPanel = (
  input: PanelPrefillInput,
  makeId: () => string = () => Math.random().toString(36).slice(2),
): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];
  const query = input.queries?.[0];

  if (input.panelType && UNSUPPORTED_PANEL_TYPES.includes(input.panelType)) {
    warnings.push(warn("unsupportedPanelType", "warning", { type: input.panelType }));
  }

  if (!input.queries?.length) {
    warnings.push(warn("noQueries", "blocking"));
  }

  const isPromql = input.queryType === "promql";
  const sourceQuery = input.executedQuery || query?.query || "";

  const { minutes, warnings: rangeWarnings } = periodMinutesFromRange(
    toPrefillRange(input.timeRange),
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
    streamName: query?.fields?.stream || "",
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
