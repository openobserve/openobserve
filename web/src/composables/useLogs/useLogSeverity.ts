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

import { toRaw } from "vue";
import { useStore } from "vuex";
import { searchState } from "@/composables/useLogs/searchState";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { STREAM_NAME_FIELD } from "@/utils/logs/streamNameColumn";
import {
  buildSeverityProjection,
  resolveLogSeverity,
  severitySchemaGeneration,
  sqlSelectOutputNames,
  type LogSeverity,
  type SeverityProjection,
} from "@/utils/logs/statusParser";

/** The `/config` fields the severity guard reads; absent on backends that predate them. */
export interface SeverityZoConfig {
  quick_mode_num_fields?: number;
  quick_mode_force_enabled?: boolean;
  ui_logs_severity_inference?: boolean;
}

// Server defaults of ZO_QUICK_MODE_NUM_FIELDS / ZO_QUICK_MODE_FORCE_ENABLED, used until /config exposes them.
const DEFAULT_QUICK_MODE_NUM_FIELDS = 500;
const DEFAULT_QUICK_MODE_FORCE_ENABLED = true;

/** Guard inputs of one search, taken when it is dispatched so later editor changes cannot alter them. */
export interface SeverityRequestSnapshot {
  sqlMode: boolean;
  quickMode: boolean;
  interestingFields: readonly string[];
  sqlColumns: ReadonlySet<string> | "all" | null;
  selectedStreams: readonly string[];
}

let executedRequest: SeverityRequestSnapshot | null = null;
// Results written outside getQueryReq (search-around) carry their own request, keyed by the raw hits array.
const boundRequests = new WeakMap<object, SeverityRequestSnapshot>();
// Used only when no dispatch was recorded (e.g. a search job); keyed by the hits array of that run.
let fallbackRequest: { hits: unknown; request: SeverityRequestSnapshot } | null = null;
let cachedProjection: {
  request: SeverityRequestSnapshot;
  generation: number;
  projection: SeverityProjection;
} | null = null;

export function captureSeverityRequest(
  searchObj: any,
  quickMode: boolean,
  parseSql: () => { columns?: unknown } | null | undefined,
): SeverityRequestSnapshot {
  const sqlMode = !!searchObj.meta.sqlMode;
  return {
    sqlMode,
    quickMode,
    interestingFields: [...(searchObj.data.stream.interestingFieldList ?? [])],
    sqlColumns: sqlMode ? sqlSelectOutputNames(parseSql()?.columns) : "all",
    selectedStreams: [...(searchObj.data.stream.selectedStream ?? [])],
  };
}

/** Records the dispatched request; every row of its results is guarded by it. */
export function recordSeverityRequest(request: SeverityRequestSnapshot | null): void {
  executedRequest = request;
}

/** Ties a hits array that bypassed getQueryReq to the request that produced it. */
export function bindSeverityRequest(hits: unknown, request: SeverityRequestSnapshot): void {
  if (hits && typeof hits === "object") boundRequests.set(toRaw(hits), request);
}

/** Severity of logs-page rows, with the projection guard derived from the executed search. */
export default function useLogSeverity() {
  const store = useStore();
  const { searchObj } = searchState();
  const { fnParsedSQL } = logsUtils();

  const requestForResults = (): SeverityRequestSnapshot => {
    const hits = toRaw(searchObj.data.queryResults?.hits);
    const bound = hits && typeof hits === "object" ? boundRequests.get(hits) : undefined;
    if (bound) return bound;
    if (executedRequest) return executedRequest;
    if (!fallbackRequest || fallbackRequest.hits !== hits) {
      const request = captureSeverityRequest(searchObj, !!searchObj.meta.quickMode, fnParsedSQL);
      fallbackRequest = { hits, request };
    }
    return fallbackRequest.request;
  };

  // A schema bump refreshes only the stream schemas; the request half stays the dispatched one.
  const currentProjection = (): SeverityProjection => {
    const request = requestForResults();
    const generation = severitySchemaGeneration();
    if (cachedProjection?.request === request && cachedProjection.generation === generation) {
      return cachedProjection.projection;
    }
    const cfg = (store.state.zoConfig ?? {}) as SeverityZoConfig;
    const projection = buildSeverityProjection({
      ...request,
      streams: searchObj.data.streamResults?.list ?? [],
      streamNameField: STREAM_NAME_FIELD,
      quickModeNumFields: cfg.quick_mode_num_fields ?? DEFAULT_QUICK_MODE_NUM_FIELDS,
      quickModeForceEnabled: cfg.quick_mode_force_enabled ?? DEFAULT_QUICK_MODE_FORCE_ENABLED,
    });
    cachedProjection = { request, generation, projection };
    return projection;
  };

  const rowSeverity = (row: unknown): LogSeverity => resolveLogSeverity(row, currentProjection());

  return { rowSeverity };
}
