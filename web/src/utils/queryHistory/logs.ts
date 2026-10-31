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

import { ref } from "vue";
import { REASON_KIND, type RunReason, type LogsSignature } from "@/composables/useLogs/useAutoRun";
import type {
  HistoryTime,
  QueryHistoryEntry,
  QueryHistoryRecordBody,
} from "@/services/query_history";
import { b64DecodeUnicodeSafe, b64EncodeUnicode } from "@/utils/formatters";
import { encodeColumns } from "@/composables/useLogs/useLogsUrl";
import {
  buildQueryKey,
  fitContext,
  restoreWindow,
  resultContext,
  runResultFromError,
  type RestoreTime,
  type RunError,
  type RunResult,
} from "./recentSearches";

/** The user-initiated reasons (design 3.2); refresh, paging, sort, tabs, landing and links never record. */
const RECORDED_REASONS = new Set<RunReason>([
  "run",
  "explicit",
  "run-anyway",
  "filter",
  "stream",
  "function",
  "time",
  "time-typed",
  "zoom",
  "narrow",
  "compare",
  "saved-view",
]);

/** The re-apply route type the Logs page loads without running. */
export const LOGS_REAPPLY_TYPE = "search_history_re_apply";

/** Bumped once per restore, so restoring the same row twice is two requests even when the URL does not change. */
export const logsReapplyRequest = ref<{ seq: number; run: boolean }>({ seq: 0, run: false });

export interface LogsRunRecordInput {
  signature: LogsSignature;
  startUs: number;
  endUs: number;
  columns: string[];
  result: RunResult;
}

export type LogsRouteQuery = Record<string, string>;

/** True when a user action ran the search; on the untouched template only an explicit Run counts. */
export const isRecordedLogsRun = (
  reasons: readonly RunReason[],
  editor?: Pick<LogsSignature, "query" | "sqlMode">,
): boolean => {
  const recorded = reasons.filter((reason) => RECORDED_REASONS.has(reason));
  if (!recorded.length) return false;
  if (!editor || !isUntouchedLogsQuery(editor.query, editor.sqlMode)) return true;
  return recorded.some((reason) => REASON_KIND[reason] === "explicit");
};

/** What a settled run records, or null for a cancelled one; a partial result is ok with a warning. */
export const logsRunResult = (run: {
  error: RunError | null;
  partial: boolean;
}): RunResult | null => {
  if (run.error) return runResultFromError(run.error);
  return run.partial ? { status: "ok", warning: "" } : { status: "ok" };
};

/** The record for a settled Logs run, or null when there is no query text to keep. */
export const buildLogsRecord = (input: LogsRunRecordInput): QueryHistoryRecordBody | null => {
  const { signature } = input;
  const query = signature.query.trim();
  if (!query) return null;
  const vrl = signature.transform?.trim() ?? "";
  const mode = signature.sqlMode ? "sql" : "filter";
  const page: Record<string, string> = {
    stream_type: signature.streamType,
    stream: signature.streams.join(","),
    sql_mode: String(signature.sqlMode),
    quick_mode: String(signature.quickMode),
    defined_schemas: signature.definedSchemas,
    fn_editor: String(!!vrl),
  };
  if (vrl) page.functionContent = b64EncodeUnicode(vrl) ?? "";
  if (!signature.sqlMode && input.columns.length) page.columns = encodeColumns(input.columns);
  if (signature.regions.length) page.regions = signature.regions.join(",");
  if (signature.clusters.length) page.clusters = signature.clusters.join(",");
  const time: HistoryTime =
    signature.time.type === "relative"
      ? {
          type: "relative",
          period: signature.time.period,
          start_time: input.startUs,
          end_time: input.endUs,
        }
      : { type: "absolute", start_time: input.startUs, end_time: input.endUs };
  return {
    source: "logs",
    query,
    query_key: buildQueryKey({
      streams: signature.streams,
      streamType: signature.streamType,
      mode,
      query,
      vrl,
    }),
    streams: [...signature.streams],
    status: input.result.status,
    context: fitContext({ page, time, ...resultContext(input.result) }),
  };
};

/** URL query that reopens a Logs row; `reapply` loads it through the page's re-apply flow. */
export const logsRouteQuery = (
  entry: QueryHistoryEntry,
  when: RestoreTime,
  orgId: string,
  reapply: boolean,
): LogsRouteQuery => {
  const query: LogsRouteQuery = {
    ...(entry.context.page ?? {}),
    stream: entry.context.page?.stream ?? entry.streams.join(","),
    query: b64EncodeUnicode(entry.query) ?? "",
    org_identifier: orgId,
  };
  const window = restoreWindow(entry.context.time, when);
  if (window?.type === "relative") query.period = window.period;
  if (window?.type === "absolute") {
    query.from = String(window.startUs);
    query.to = String(window.endUs);
  }
  if (reapply) query.type = LOGS_REAPPLY_TYPE;
  return query;
};

/** The VRL function a Logs row ran with, or "" when it had none. */
export const logsEntryFunction = (entry: QueryHistoryEntry): string =>
  entry.source === "logs" ? b64DecodeUnicodeSafe(entry.context.page?.functionContent ?? "") : "";

/** Asks the Logs page to apply the route it is on, and to run it when `run` is set. */
export const requestLogsReapply = (run: boolean) => {
  logsReapplyRequest.value = { seq: logsReapplyRequest.value.seq + 1, run };
};

/** The SQL template a new Logs search starts from counts as an empty editor. */
export const isUntouchedLogsQuery = (query: string, sqlMode: boolean): boolean => {
  const text = query.trim();
  if (!text) return true;
  return sqlMode && /^select\s+\*\s+from\s+"?[^"\s]+"?$/i.test(text);
};

export const logsExampleQueries = (stream: string, sqlMode: boolean): string[] => {
  if (!stream) return [];
  return sqlMode
    ? [
        `SELECT * FROM "${stream}" WHERE match_all('error')`,
        `SELECT COUNT(*) AS total FROM "${stream}"`,
      ]
    : ["match_all('error')", "match_all('timeout')"];
};
