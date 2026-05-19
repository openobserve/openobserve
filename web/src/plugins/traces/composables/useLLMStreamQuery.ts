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

import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { useStore } from "vuex";

/**
 * Minimal SQL query runner against the traces stream search endpoint.
 * Used by LLM Insights panels and composables — accumulates hits across
 * streamed pages and resolves once the request completes.
 *
 * Returns:
 *   - `executeQuery(sql, startTime, endTime)` → `Promise<any[]>` of all
 *     hits collected from the streamed response. Rejects with an `Error`
 *     enriched with `.status`, `.code`, `.raw` if the server signals
 *     failure.
 *   - `cancelAll()` → cancels every in-flight query started by this
 *     composable instance (by their generated trace IDs).
 *
 * Uses the org's `sql_base64_enabled` config to decide whether to send
 * SQL as base64 or plain text — matches the convention used elsewhere
 * in the codebase.
 *
 * @example
 *   const { executeQuery, cancelAll } = useLLMStreamQuery();
 *   const rows = await executeQuery(
 *     `SELECT count(*) FROM "default"`,
 *     1700000000000000,
 *     1700001000000000,
 *   );
 *   // ... later, on unmount:
 *   cancelAll();
 */
export function useLLMStreamQuery() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();

  const activeTraceIds = new Set<string>();

  function cancelAll() {
    activeTraceIds.forEach((id) => {
      cancelStreamQueryBasedOnRequestId({
        trace_id: id,
        org_id: store.state.selectedOrganization.identifier,
      });
    });
    activeTraceIds.clear();
  }

  function executeQuery(
    sql: string,
    startTime: number,
    endTime: number,
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const traceId = generateTraceContext().traceId;
      activeTraceIds.add(traceId);
      const accumulated: any[] = [];

      // Honour the SQL's own LIMIT as the request `size` so the
      // backend doesn't scan more rows than the panel actually wants.
      // Recent-errors panel uses LIMIT 10; latency raw uses LIMIT
      // 50000. Falls back to 1000 for queries without LIMIT.
      const limitMatch = sql.match(/\bLIMIT\s+(\d+)\b/i);
      const size = limitMatch ? parseInt(limitMatch[1], 10) : 1000;

      // Match the rest of the codebase: only base64-encode when the
      // org/instance has sql_base64_enabled. Plain SQL is fine otherwise.
      const useBase64 = store.state.zoConfig?.sql_base64_enabled;
      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: {
              sql: useBase64 ? b64EncodeUnicode(sql) : sql,
              start_time: startTime,
              end_time: endTime,
              from: 0,
              size,
            },
            ...(useBase64 ? { encoding: "base64" } : {}),
          },
          type: "search",
          pageType: "traces",
          searchType: "ui",
          traceId,
          org_id: store.state.selectedOrganization.identifier,
        },
        {
          data: (_payload: any, response: any) => {
            const hits: any[] = response.content?.results?.hits || [];
            if (hits.length > 0) accumulated.push(...hits);
          },
          error: (response: any, _traceId: any) => {
            activeTraceIds.delete(traceId);
            // useStreamingSearch wraps the server error body as
            // `{ content: { ...errorBody, trace_id }, type: "error" }`.
            // Unwrap so the real fields (message / error_detail / status)
            // are visible without forcing every caller to know the shape.
            const body = response?.content ?? response ?? {};
            const message =
              body.message ||
              body.error ||
              body.error_detail ||
              response?.message ||
              "Failed to fetch query data";
            const err: any = new Error(message);
            err.status = body.status ?? response?.status;
            err.code = body.code ?? response?.code;
            err.raw = response;
            reject(err);
          },
          complete: () => {
            activeTraceIds.delete(traceId);
            resolve(accumulated);
          },
          reset: () => {},
        },
      );
    });
  }

  return { executeQuery, cancelAll };
}
