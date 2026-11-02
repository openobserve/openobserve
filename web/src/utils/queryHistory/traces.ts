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

import type {
  HistoryTime,
  QueryHistoryEntry,
  QueryHistoryRecordBody,
} from "@/services/query_history";
import { b64EncodeUnicode } from "@/utils/formatters";
import {
  buildQueryKey,
  fitContext,
  restoreWindow,
  resultContext,
  type RestoreTime,
  type RestoreWindow,
  type RunResult,
} from "./recentSearches";

/** First-time examples; every traces stream carries these fields. */
export const TRACES_EXAMPLE_QUERIES = ["span_status = 'ERROR'", "duration > 1000000"];

export interface TracesRunRecordInput {
  stream: string;
  /** `traces` or `spans`. */
  searchMode: string;
  query: string;
  time: HistoryTime;
  result: RunResult;
}

/** What the Traces page applies to reopen a row. */
export interface TracesRestore {
  stream: string;
  searchMode: string;
  query: string;
  window: RestoreWindow | null;
}

/** The record for a settled Traces run, or null when there is no filter text to keep. */
export const buildTracesRecord = (input: TracesRunRecordInput): QueryHistoryRecordBody | null => {
  const query = input.query.trim();
  if (!query || !input.stream) return null;
  const streams = [input.stream];
  return {
    source: "traces",
    query,
    query_key: buildQueryKey({ streams, streamType: "traces", mode: input.searchMode, query }),
    streams,
    status: input.result.status,
    context: fitContext({
      page: { stream: input.stream, tab: input.searchMode },
      time: input.time,
      ...resultContext(input.result),
    }),
  };
};

export const tracesRestore = (entry: QueryHistoryEntry, when: RestoreTime): TracesRestore => ({
  stream: entry.context.page?.stream ?? entry.streams[0] ?? "",
  searchMode: entry.context.page?.tab ?? "traces",
  query: entry.query,
  window: restoreWindow(entry.context.time, when),
});

export const tracesRouteQuery = (
  entry: QueryHistoryEntry,
  when: RestoreTime,
  orgId: string,
): Record<string, string> => {
  const restore = tracesRestore(entry, when);
  const query: Record<string, string> = {
    stream: restore.stream,
    tab: restore.searchMode,
    query: b64EncodeUnicode(restore.query) ?? "",
    org_identifier: orgId,
  };
  if (restore.window?.type === "relative") query.period = restore.window.period;
  if (restore.window?.type === "absolute") {
    query.from = String(restore.window.startUs);
    query.to = String(restore.window.endUs);
  }
  return query;
};
