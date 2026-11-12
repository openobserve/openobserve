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

import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useStore } from "vuex";
import { useQueries, useQuery } from "@tanstack/vue-query";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import type { BucketHit } from "./serviceChartSql";
import {
  hasRows,
  issueSeriesSql,
  ISSUE_STEP_MS,
  toIssueSeries,
  type IssueSeries,
  type IssueStream,
  type IssueWindow,
} from "./issueSeries";

export type IssueSeriesStatus = "idle" | "loading" | "ready" | "empty" | "failed" | "denied";

interface StreamEvent {
  type?: string;
  content?: { results?: { hits?: BucketHit[] }; streaming_aggs?: boolean };
}

interface StreamError {
  content?: { status?: number };
}

/** A failed stream query, carrying the HTTP status the search answered with. */
export class IssueSeriesError extends Error {
  constructor(readonly status: number | null) {
    super(`issue series failed${status ? ` (${status})` : ""}`);
  }
}

type Streaming = ReturnType<typeof useHttpStreaming>;

const fetchHits = (
  streaming: Streaming,
  org: string,
  stream: IssueStream,
  w: IssueWindow,
  signal: AbortSignal,
): Promise<BucketHit[]> =>
  new Promise((resolve, reject) => {
    const { traceId } = generateTraceContext();
    const hits = new Map<string, BucketHit>();
    signal.addEventListener("abort", () =>
      streaming.cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: org }),
    );
    void streaming.fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(issueSeriesSql(stream.name)),
            start_time: w.startMs * 1000,
            end_time: w.endMs * 1000,
            from: 0,
            // One hit per bucket, plus one for a bucket the window's edge splits.
            size: Math.ceil((w.endMs - w.startMs) / ISSUE_STEP_MS) + 1,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: org,
        pageType: stream.type,
        searchType: "ui",
      },
      {
        data: (_payload: unknown, res: StreamEvent) => {
          if (res?.type !== "search_response_hits") return;
          if (res.content?.streaming_aggs) hits.clear();
          for (const hit of res.content?.results?.hits ?? []) hits.set(String(hit.t), hit);
        },
        error: (_payload: unknown, err?: StreamError) =>
          reject(new IssueSeriesError(err?.content?.status ?? null)),
        complete: () => resolve([...hits.values()]),
      },
    );
  });

const seriesOptions = (
  streaming: Streaming,
  org: string,
  s: IssueStream | null,
  w: IssueWindow | null,
) => ({
  queryKey: autoobserveKeys.issueSeries(
    org,
    s?.type ?? "",
    s?.name ?? "",
    w?.startMs ?? 0,
    w?.endMs ?? 0,
  ),
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IssueSeries> =>
    toIssueSeries(await fetchHits(streaming, org, s!, w!, signal), w!),
  enabled: !!s && !!w && !!org,
  // A window that ended before the newest bucket never changes, so it is read once.
  staleTime: w?.fixed ? Infinity : LIVE_STALE_TIME,
  retry: false,
});

const statusOf = (
  ready: boolean,
  error: unknown,
  data: IssueSeries | undefined,
): IssueSeriesStatus => {
  if (!ready) return "idle";
  if (error) return error instanceof IssueSeriesError && error.status === 403 ? "denied" : "failed";
  if (!data) return "loading";
  return hasRows(data) ? "ready" : "empty";
};

/** Rows per 15 minutes of one stream over an incident's window, shared by every view of that incident. */
export const useIssueSeries = (
  stream: MaybeRefOrGetter<IssueStream | null>,
  window: MaybeRefOrGetter<IssueWindow | null>,
) => {
  const store = useStore();
  const streaming = useHttpStreaming();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const query = useQuery(() =>
    seriesOptions(streaming, org.value, toValue(stream), toValue(window)),
  );
  const status = computed(() =>
    statusOf(
      !!toValue(stream) && !!toValue(window),
      query.isError.value ? query.error.value : null,
      query.data.value,
    ),
  );
  return {
    status,
    series: computed(() => query.data.value ?? null),
    retry: () => void query.refetch(),
  };
};

/** The same series for several streams over one window, for comparing them side by side. */
export const useIssueSeriesList = <S extends IssueStream>(
  streams: MaybeRefOrGetter<S[]>,
  window: MaybeRefOrGetter<IssueWindow | null>,
) => {
  const store = useStore();
  const streaming = useHttpStreaming();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const results = useQueries({
    queries: computed(() =>
      toValue(streams).map((s) => seriesOptions(streaming, org.value, s, toValue(window))),
    ),
  });
  return computed(() =>
    toValue(streams).map((stream, i) => {
      const r = results.value[i];
      return {
        stream,
        status: statusOf(!!toValue(window), r?.isError ? r.error : null, r?.data),
        series: r?.data ?? null,
        retry: () => void r?.refetch(),
      };
    }),
  );
};
