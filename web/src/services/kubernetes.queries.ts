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

import { queryOptions } from "@tanstack/vue-query";
import searchService from "./search";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/auth";
import { k8sKeys } from "./kubernetes.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";
import { parseVector, type Series } from "@/views/Infrastructure/kubernetes2/kubernetesModel";

// Two absolute END times inside one bucket must not share a key, because each request uses its exact time.
const timeKey = (startUs: number, endUs: number, relative: boolean) =>
  relative ? quantizeRange(startUs, endUs) : { start: startUs, end: endUs };

// The stream reports errors as { content }; callers read status and message off the error itself.
const streamError = (res: any) =>
  Object.assign(new Error(res?.content?.message ?? res?.content?.error ?? "search stream failed"), {
    status: res?.content?.status ?? res?.content?.code ?? null,
  });

// Every k8s query is complex, so the server runs it as one partition and its hits are appended.
function streamSqlHits(org: string, query: Record<string, unknown>) {
  const { fetchQueryDataWithHttpStream } = useHttpStreaming();
  const { traceId } = generateTraceContext();
  return new Promise<any[]>((resolve, reject) => {
    const hits: any[] = [];
    fetchQueryDataWithHttpStream(
      {
        queryReq: { query },
        type: "search",
        traceId,
        org_id: org,
        pageType: "logs",
        searchType: "ui",
      },
      {
        data: (_req: unknown, res: any) => {
          if (res?.type === "search_response_hits")
            hits.push(...(res.content?.results?.hits ?? []));
        },
        error: (_req: unknown, err: any) => reject(streamError(err)),
        complete: () => resolve(hits),
      },
    );
  });
}

export const k8sInstantQuery = (
  org: string,
  id: string,
  text: string,
  endUs: number,
  relative: boolean,
) =>
  queryOptions({
    queryKey: k8sKeys.instant(org, id, text, timeKey(endUs, endUs, relative).end),
    queryFn: async (): Promise<Series[]> =>
      parseVector(
        await searchService.metrics_query({
          org_identifier: org,
          // metrics_query interpolates the query raw into the URL.
          query: encodeURIComponent(text),
          end_time: endUs,
        }),
      ),
    staleTime: LIVE_STALE_TIME,
  });

export const k8sSqlQuery = (
  org: string,
  name: string,
  sql: string,
  startUs: number,
  endUs: number,
  relative: boolean,
  size?: number,
) =>
  queryOptions({
    queryKey: k8sKeys.sql(org, name, sql, timeKey(startUs, endUs, relative)),
    queryFn: (): Promise<any[]> =>
      streamSqlHits(org, {
        sql,
        start_time: startUs,
        end_time: endUs,
        from: 0,
        ...(size ? { size } : {}),
      }),
    staleTime: LIVE_STALE_TIME,
  });
