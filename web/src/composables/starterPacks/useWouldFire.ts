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

import { onScopeDispose } from "vue";

import useHttpStreaming from "@/composables/useStreamingSearch";
import useParser from "@/composables/useParser";
import { generateTraceContext } from "@/utils/zincutils";

import {
  COUNT_ALIAS,
  frequencySeconds,
  HISTOGRAM_ALIAS,
  HISTORY_WINDOW_SECONDS,
  historySql,
  periodMinutes,
  promqlResult,
  sqlResult,
  type PromqlSeries,
  type SqlBucket,
  type WouldFireResult,
} from "./wouldFire";

type StreamRequest = Parameters<
  ReturnType<typeof useHttpStreaming>["fetchQueryDataWithHttpStream"]
>[0];
type HistoryRequest = Pick<StreamRequest, "type" | "queryReq" | "pageType" | "searchType">;

const US_PER_SECOND = 1_000_000;
const HISTORY_ROW_LIMIT = 5000;

const bucketSeconds = (value: unknown): number => {
  if (typeof value === "number") return value / US_PER_SECOND;
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`) / 1000;
};

/** Counts what an alert would have done, from client queries since a disabled alert keeps no history. */
export function useWouldFire(org: string) {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const live = new Set<string>();

  const stream = <T>(
    request: HistoryRequest,
    onHits: (response: any) => void,
    finish: () => T,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const traceId = generateTraceContext()?.traceId ?? "";
      live.add(traceId);
      fetchQueryDataWithHttpStream(
        // A cached empty range would read as no incidents.
        { ...request, traceId, org_id: org, skipCache: true },
        {
          data: (_request: unknown, response: any) => onHits(response),
          error: (_request: unknown, error: unknown) => {
            live.delete(traceId);
            reject(error);
          },
          complete: () => {
            live.delete(traceId);
            resolve(finish());
          },
        },
      );
    });

  const checkPromql = (alert: Record<string, any>, endUs: number) => {
    const step = frequencySeconds(alert);
    const chunks: PromqlSeries[] = [];
    return stream(
      {
        type: "promql",
        queryReq: {
          query: alert.query_condition.promql,
          start_time: endUs - HISTORY_WINDOW_SECONDS * US_PER_SECOND,
          end_time: endUs,
          step: `${step}s`,
          query_type: "range",
        },
      },
      (response) => {
        if (response?.type === "promql_response") {
          chunks.push(...((response.content?.results?.result ?? []) as PromqlSeries[]));
        }
      },
      () => promqlResult(chunks, alert, step),
    );
  };

  const checkSql = async (
    alert: Record<string, any>,
    endUs: number,
    streamAgeSeconds: number | null,
  ) => {
    const minutes = periodMinutes(alert);
    const parser = await useParser().sqlParser();
    const sql = historySql(parser, alert.query_condition.sql, minutes);
    if (!sql) throw new Error("alert_query_not_checkable");
    const buckets: SqlBucket[] = [];
    return stream(
      {
        type: "search",
        pageType: alert.stream_type,
        searchType: "UI",
        queryReq: {
          query: {
            sql,
            sql_mode: "full",
            start_time: endUs - HISTORY_WINDOW_SECONDS * US_PER_SECOND,
            end_time: endUs,
            size: HISTORY_ROW_LIMIT,
          },
        },
      },
      (response) => {
        if (response?.type !== "search_response_hits") return;
        for (const hit of response.content?.results?.hits ?? []) {
          buckets.push({
            time: bucketSeconds(hit[HISTOGRAM_ALIAS]),
            count: Number(hit[COUNT_ALIAS]),
          });
        }
      },
      () => sqlResult(buckets, alert, minutes * 60, streamAgeSeconds),
    );
  };

  /** Rejects when the alert's query cannot be bucketed; the row then offers a Retry. */
  const check = (
    alert: Record<string, any>,
    streamAgeSeconds: number | null = null,
  ): Promise<WouldFireResult> => {
    const endUs = Date.now() * 1000;
    const type = alert.query_condition?.type;
    if (type === "promql") return checkPromql(alert, endUs);
    if (type === "sql") return checkSql(alert, endUs, streamAgeSeconds);
    return Promise.reject(new Error("alert_query_not_checkable"));
  };

  const cancelAll = () => {
    for (const traceId of live) {
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: org });
    }
    live.clear();
  };

  onScopeDispose(cancelAll);

  return { check, cancelAll };
}
