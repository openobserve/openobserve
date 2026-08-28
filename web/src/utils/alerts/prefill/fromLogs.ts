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
 * Logs search → AlertPrefill.
 *
 * Takes a plain snapshot of `searchObj`, never the reactive object itself, so
 * the adapter stays pure (invariant 5). The caller is responsible for supplying
 * `resolvedSql` from `getSearchQueryPayload()` — that is the query the backend
 * would actually run, complete with the non-SQL-mode WHERE templating and
 * multi-stream handling that reimplementing here would only get wrong.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import {
  firstAggregateAlias,
  hasHistogramBucketing,
  periodMinutesFromRange,
  sanitizeAlertNamePart,
  stripDisplayOnlyClauses,
  warn,
  type PrefillTimeRange,
} from "../alertPrefill";

export interface LogsPrefillInput {
  streamNames: string[];
  streamType: string;
  /** True when the editor holds full SQL; false when it holds a filter fragment. */
  sqlMode: boolean;
  /** searchObj.data.query — raw editor content. */
  rawQuery: string;
  /** getSearchQueryPayload()?.query.sql — the resolved, backend-ready SQL. */
  resolvedSql: string;
  /** searchObj.data.tempFunctionContent, when a VRL function is applied. */
  vrl?: string | null;
  /** Which transform the user attached; "action" cannot be represented. */
  transformType?: "function" | "action" | null;
  datetime?: PrefillTimeRange | null;
  timezone?: string;
  /** Whether the last run returned any rows — drives an informational note. */
  hasResults?: boolean;
}

/**
 * Flatten the live `searchObj` into the plain snapshot the adapter takes.
 *
 * Separated from the adapter so the "which field goes where" mapping is itself
 * pure and testable — the logs page then only has to decide which query payload
 * to hand over, which is the one thing it genuinely knows.
 */
export const logsAlertSnapshot = (
  searchObj: any,
  resolvedSql: string,
  timezone?: string,
): LogsPrefillInput => ({
  streamNames: searchObj?.data?.stream?.selectedStream ?? [],
  streamType: searchObj?.data?.stream?.streamType ?? "logs",
  sqlMode: !!searchObj?.meta?.sqlMode,
  rawQuery: searchObj?.data?.query ?? "",
  resolvedSql,
  vrl: searchObj?.data?.tempFunctionContent ?? null,
  transformType: searchObj?.data?.transformType ?? null,
  datetime: searchObj?.data?.datetime
    ? {
        type: searchObj.data.datetime.type,
        relativeTimePeriod: searchObj.data.datetime.relativeTimePeriod,
        startTime: searchObj.data.datetime.startTime,
        endTime: searchObj.data.datetime.endTime,
      }
    : null,
  timezone,
  hasResults: (searchObj?.data?.queryResults?.hits?.length ?? 0) > 0,
});

/** Count the streams a SQL statement reads, to spot joins we can't represent. */
const readsMultipleStreams = (sql: string): boolean => {
  const matches = sql.match(/\b(?:from|join)\s+["'`]?[\w.-]+["'`]?/gi);
  if (!matches) return false;
  const streams = new Set(
    matches.map((m) =>
      m
        .replace(/^\s*\w+\s+/i, "")
        .replace(/["'`]/g, "")
        .toLowerCase(),
    ),
  );
  return streams.size > 1;
};

export const buildPrefillFromLogs = (input: LogsPrefillInput): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];

  const streams = input.streamNames?.filter(Boolean) ?? [];
  const streamName = streams[0] ?? "";

  if (!streams.length) {
    warnings.push(warn("noStream", "blocking"));
  }

  // In SQL mode the editor content IS the query. Otherwise it is a WHERE
  // fragment, and only the resolved payload is a runnable statement — say so,
  // because the alert's query will not look like what the user typed.
  let sql = input.sqlMode ? input.rawQuery : input.resolvedSql;
  if (!input.sqlMode && (input.rawQuery ?? "").trim()) {
    warnings.push(warn("convertedToSql", "info"));
  }

  sql = (sql ?? "").trim();

  // Time bucketing produces one row per bucket; an alert evaluates a single
  // window, so the row count would be the bucket count and the threshold
  // meaningless. Refuse rather than create an alert that quietly misfires.
  if (sql && hasHistogramBucketing(sql)) {
    warnings.push(warn("histogramNotSupported", "blocking"));
  }

  const stripped = stripDisplayOnlyClauses(sql);
  sql = stripped.sql;
  warnings.push(...stripped.warnings);

  if (sql && readsMultipleStreams(sql)) {
    warnings.push(warn("joinSingleStream", "warning", { stream: streamName }));
  }

  // An alert with no filter fires on literally every record in the stream.
  // Legitimate occasionally, a mistake usually — either way, say it out loud.
  if (!(input.rawQuery ?? "").trim()) {
    warnings.push(warn("broadMatch", "warning"));
  }

  if (input.hasResults === false) {
    warnings.push(warn("noResults", "info"));
  }

  const vrl = input.transformType === "function" ? input.vrl?.trim() || null : null;
  if (vrl) {
    warnings.push(warn("savedFunctionCopied", "info"));
  }

  const { minutes, warnings: rangeWarnings } = periodMinutesFromRange(input.datetime);
  warnings.push(...rangeWarnings);

  // A GROUP BY query already aggregates; surface the aggregate's alias so the
  // form can offer a threshold on the number rather than on the row count.
  const aggregateAlias = sql ? firstAggregateAlias(sql) : null;

  return {
    version: ALERT_PREFILL_VERSION,
    source: "logs",
    sourceLabel: streamName || "logs",
    name: `Alert_from_${sanitizeAlertNamePart(streamName, "logs")}`,
    streamType: input.streamType || "logs",
    streamName,
    streamCandidates: streams.map((name) => ({ name, type: input.streamType || "logs" })),
    queryType: "sql",
    sql,
    vrlFunction: vrl,
    periodMinutes: minutes,
    timezone: input.timezone,
    warnings,
    meta: {
      sqlMode: input.sqlMode,
      aggregateAlias,
    },
  };
};
