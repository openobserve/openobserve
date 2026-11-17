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

import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

/** The window a usual level is measured over. */
export const BASELINE_LOOKBACK_US = 7 * 24 * 3_600_000_000;

const LOOKBACK_HOURS = 7 * 24;
// The latency alert ignores windows with fewer requests, so a p95 over fewer says nothing usual.
const MIN_REQUESTS = 20;
// A week's level barely moves in minutes, and two reads of it must not draft two thresholds for one check.
const KEEP_MS = 15 * 60_000;

/** One usual-level query: the error count or the p95, scoped like the alert it sets a threshold for. */
export interface BaselineRequest {
  kind: "errors" | "latency";
  stream: { type: string; name: string };
  sql: string;
}

export type Hit = Record<string, unknown>;

const measured = new Map<string, { value: number; at: number }>();

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const HOUR_US = 3_600_000_000;

// A young service has fewer hours than the lookback, so dividing by the whole week would undercount its rate.
const hoursOfData = (hits: Hit[], end: number): number => {
  const starts = hits.map((h) => Number(h.first_seen)).filter((n) => Number.isFinite(n) && n > 0);
  if (!starts.length) return LOOKBACK_HOURS;
  const hours = (end - Math.min(...starts)) / HOUR_US;
  return Math.min(LOOKBACK_HOURS, Math.max(1, hours));
};

const levelOf = (kind: BaselineRequest["kind"], hits: Hit[], end: number): number | null => {
  if (kind === "errors") {
    const perHour = hits.reduce((sum, h) => sum + num(h.errors), 0) / hoursOfData(hits, end);
    return perHour > 0 ? perHour : null;
  }
  const requests = hits.reduce((sum, h) => sum + num(h.requests), 0);
  const p95 = Math.max(0, ...hits.map((h) => num(h.p95_ms)));
  return requests >= MIN_REQUESTS && p95 > 0 ? p95 : null;
};

/** The usual errors an hour (over the hours with data, up to 7 days) or p95 in ms, from one streaming query; null when there is none or it was stopped. */
export const measureBaseline = (
  org: string,
  request: BaselineRequest,
  signal?: AbortSignal,
): Promise<number | null> => {
  const key = `${org}\n${request.kind}\n${request.stream.type}\n${request.sql}`;
  const kept = measured.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.value);
  return readBaseline(org, request, signal).then((value) => {
    if (value !== null && !signal?.aborted) measured.set(key, { value, at: Date.now() });
    return value;
  });
};

/** Drops every kept level, so the next read measures again. */
export const forgetBaselines = (): void => measured.clear();

/** One aggregate query's rows over the 7 days before `end`; null when it failed or was stopped. */
export const readHits = (
  org: string,
  streamType: string,
  sql: string,
  end: number,
  signal?: AbortSignal,
): Promise<Hit[] | null> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
    const { traceId } = generateTraceContext();
    signal?.addEventListener(
      "abort",
      () => {
        cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: org });
        resolve(null);
      },
      { once: true },
    );
    let hits: Hit[] = [];
    void fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(sql),
            start_time: end - BASELINE_LOOKBACK_US,
            end_time: end,
            from: 0,
            size: 1,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: org,
        pageType: streamType,
        searchType: "ui",
      },
      {
        data: (_payload: unknown, res: any) => {
          if (res?.type !== "search_response_hits") return;
          const chunk: Hit[] = res.content?.results?.hits ?? [];
          // A streamed aggregate resends its running total, so only the latest chunk counts.
          hits = res.content?.streaming_aggs ? chunk : [...hits, ...chunk];
        },
        error: () => resolve(null),
        complete: () => resolve(hits),
      },
    );
  });

const readBaseline = async (
  org: string,
  request: BaselineRequest,
  signal?: AbortSignal,
): Promise<number | null> => {
  const end = Date.now() * 1000;
  const hits = await readHits(org, request.stream.type, request.sql, end, signal);
  return hits ? levelOf(request.kind, hits, end) : null;
};
