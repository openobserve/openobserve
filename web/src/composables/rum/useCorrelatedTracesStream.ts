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

import { useStore } from "vuex";
import type { TranslateFn } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import useHttpStreaming from "@/composables/useStreamingSearch";
import searchService from "@/services/search";
import {
  TRACE_TIME_RANGE_MAX_IDS,
  type TraceTimeRange,
} from "@/ts/interfaces/traces/traceTimeRange.types";
import { generateTraceContext } from "@/utils/zincutils";
import { normalizeTraceId, RUM_CORRELATION_TRACES_STREAM } from "@/utils/rum/fields";

/** Where a trace lives, and when it ran when the index could tell us. */
export interface TraceLocation {
  stream: string;
  /** Absent when the answer came from the probe fallback. */
  range?: TraceTimeRange;
}

// Probes look up a trace by id, but the caller's window is event-derived and
// ingestion can lag it — widen like useRumSpanBuilder's RUM_TIME_BUFFER_US,
// but generously: probes are `limit 1` point lookups, so the wider window is
// effectively free.
const PROBE_TIME_BUFFER_US = 300_000_000; // ±5 min

// Deduplicates concurrent resolves of the same id (e.g. the error card and the
// Traces tab racing on page load). Transient in-progress work, deliberately
// NOT in the Vuex store: entries delete themselves on settle, so org-switch
// staleness cannot apply.
const inFlight = new Map<string, Promise<TraceLocation>>();

// A 404 means this deployment has no time-range endpoint at all, which no
// retry can change — latch it off for the session rather than paying a failed
// request on every resolve. Transient failures (5xx, network) must NOT latch,
// and neither must partial coverage: that is legitimately per-request.
// Deliberately outside the store: it describes the backend, not the org, so it
// has to survive an org switch.
let indexEndpointAvailable = true;

/**
 * Discovers which traces stream contains a given trace id.
 *
 * The RUM correlation surfaces (error card, session Traces tab, event-drawer
 * navigation) have no stream picker, and assuming the backend's OTLP default
 * silently breaks every flow for orgs exporting traces to a named stream. A
 * trace id is globally unique, so probing streams for it is unambiguous: a
 * probe can only miss, never match the wrong trace.
 *
 * Layers (see the discovery spec):
 * - `byTraceId` (store): per-trace answers, shared across surfaces/remounts.
 * - `traces/time_range`: the backend's trace time index answers directly, and
 *   says via `partial_coverage` when it could not look at all.
 * - `_search_multi_stream` probe: the fallback for exactly that case — an
 *   older backend, indexing disabled, or data older than index coverage.
 * - `knownStreams` (store): the org-level learned fact the probe narrows by;
 *   a miss escalates to the full stream list and the new stream is learned.
 * Every failure path returns RUM_CORRELATION_TRACES_STREAM, reproducing the
 * pre-discovery behavior; misses are never cached so ingestion lag self-heals.
 */
export default function useCorrelatedTracesStream(t: TranslateFn) {
  const store = useStore();
  const { getStreams } = useStreams(t);
  const { fetchQueryDataWithHttpStream } = useHttpStreaming();

  const cache = () => store.state.organizationData.correlatedTracesStreams;

  const listTracesStreams = async (): Promise<string[]> => {
    try {
      const res = (await getStreams("traces", false)) as { list: { name: string }[] };
      const names = (res?.list ?? []).map((option) => option.name);
      // Deterministic probe order: default first, then the list order.
      names.sort((a, b) => {
        if (a === RUM_CORRELATION_TRACES_STREAM) return -1;
        if (b === RUM_CORRELATION_TRACES_STREAM) return 1;
        return 0;
      });
      return names;
    } catch (err: unknown) {
      console.error("Failed to get traces streams", err);
      return [];
    }
  };

  /**
   * One `traces/time_range` pass over `traceIds`, chunked at the server's id
   * cap and issued in parallel. Splits the ids into the ones the index
   * resolved and the ones it could not answer for — a scan timeout, missing
   * coverage, or a failed request. An authoritative `not_found` counts as
   * answered, so a trace the org genuinely does not have never reaches the
   * probe.
   */
  const lookupTraceLocations = async (
    streams: string[],
    traceIds: string[],
    startTimeUs: number,
    endTimeUs: number,
    narrowTo?: string[],
  ): Promise<{ found: Record<string, TraceLocation>; unanswered: string[] }> => {
    const found: Record<string, TraceLocation> = {};
    const unanswered: string[] = [];
    if (!traceIds.length) return { found, unanswered };

    const rank = new Map(streams.map((stream, index) => [stream, index]));
    const rankOf = (stream: string) => rank.get(stream) ?? Number.MAX_SAFE_INTEGER;

    const chunks: string[][] = [];
    for (let index = 0; index < traceIds.length; index += TRACE_TIME_RANGE_MAX_IDS) {
      chunks.push(traceIds.slice(index, index + TRACE_TIME_RANGE_MAX_IDS));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const response = await searchService.get_trace_time_ranges({
            org_identifier: store.state.selectedOrganization.identifier,
            trace_ids: chunk,
            start_time: startTimeUs,
            end_time: endTimeUs,
            // Anchors the server's locate pass, so a typical RUM window is
            // covered in its first round.
            hint_ts: startTimeUs,
            streams: narrowTo,
          });
          const data = response?.data;
          const partialCoverage = Boolean(data?.partial_coverage);
          const answered = new Set<string>();
          for (const result of data?.results ?? []) {
            const id = result?.trace_id;
            if (!id) continue;
            if (result.status === "found" && result.stream) {
              const current = found[id];
              // The server stops at the first stream that hits, but concurrent
              // lookups can both report — settle it the way the probe does.
              if (!current || rankOf(result.stream) < rankOf(current.stream)) {
                found[id] = { stream: result.stream, range: result.range };
              }
              answered.add(id);
            } else if (result.status === "not_found" && !partialCoverage) {
              answered.add(id);
            }
          }
          unanswered.push(...chunk.filter((id) => !answered.has(id)));
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 404 || status === 405) indexEndpointAvailable = false;
          unanswered.push(...chunk);
        }
      }),
    );

    return { found, unanswered };
  };

  /**
   * One `_search_multi_stream` request probing `streams` for `traceIds`.
   * Returns id → stream for every id found. Chunks are attributed via
   * `results.query_index` (the sub-query's position in the sql array) and
   * collected until `complete`; ties resolve to the FIRST stream in `streams`
   * order — never to arrival order, which is nondeterministic.
   */
  const probeBatch = async (
    streams: string[],
    traceIds: string[],
    startTimeUs: number,
    endTimeUs: number,
  ): Promise<Record<string, string>> => {
    if (!streams.length || !traceIds.length) return {};
    const idList = traceIds.map((id) => `'${id}'`).join(",");
    // DISTINCT is load-bearing: the probe scans span rows, and one trace's
    // spans would otherwise consume the whole limit, leaving sibling ids
    // unresolved (observed live).
    const sqls = streams.map(
      (stream) =>
        `select distinct trace_id from "${stream}" where trace_id IN (${idList}) limit ${traceIds.length}`,
    );

    // hits[streamIndex] = set of ids found in that stream
    const hitsByStreamIndex: Array<Set<string>> = streams.map(() => new Set());

    try {
      await new Promise<void>((resolve) => {
        fetchQueryDataWithHttpStream(
          {
            queryReq: {
              query: {
                sql: sqls, // string[] → auto-routes to _search_multi_stream
                sql_mode: "full",
                start_time: startTimeUs - PROBE_TIME_BUFFER_US,
                end_time: endTimeUs + PROBE_TIME_BUFFER_US,
                size: traceIds.length,
              },
            },
            type: "search",
            traceId: generateTraceContext()?.traceId ?? "",
            org_id: store.state.selectedOrganization.identifier,
            pageType: "traces",
            searchType: "UI",
          },
          {
            // Wire shape (verified live): each sub-query emits a
            // `search_response_metadata` event whose results carry
            // `query_index`, followed by a separate `search_response_hits`
            // event that has ONLY `{hits}`. Events arrive strictly paired in
            // SSE order, so the last metadata's index attributes the hits
            // that follow it.
            data: (() => {
              let lastQueryIndex: number | null = null;
              const harvest = (hits: unknown, queryIndex: number | null) => {
                if (queryIndex === null || !Array.isArray(hits)) return;
                const bucket = hitsByStreamIndex[queryIndex];
                if (!bucket) return;
                for (const hit of hits) {
                  if (typeof hit?.trace_id === "string") bucket.add(hit.trace_id);
                }
              };
              return (_payload: any, response: any) => {
                const results = response?.content?.results;
                const ownIndex =
                  typeof results?.query_index === "number" ? results.query_index : null;
                if (response?.type === "search_response_metadata") {
                  lastQueryIndex = ownIndex;
                  harvest(results?.hits, ownIndex);
                } else {
                  harvest(results?.hits, ownIndex ?? lastQueryIndex);
                }
              };
            })(),
            error: () => resolve(), // a failed sub-query is a miss, not an error
            complete: () => resolve(),
            reset: () => {},
          },
        )?.catch?.(() => resolve());
      });
    } catch {
      return {};
    }

    // First stream in probe order wins ties (edge case 16).
    const found: Record<string, string> = {};
    streams.forEach((stream, index) => {
      for (const id of hitsByStreamIndex[index]) {
        if (!(id in found)) found[id] = stream;
      }
    });
    return found;
  };

  const record = (traceId: string, stream: string, range?: TraceTimeRange) => {
    store.commit("setCorrelatedTracesStream", { traceId, stream, range });
  };

  /**
   * id → location for every id found (absent = found nowhere; callers fall
   * back to RUM_CORRELATION_TRACES_STREAM per id). The index answers first and
   * carries the trace's real range; only ids it could not cover fall through
   * to the probe, which escalates `knownStreams` → the remaining streams and
   * yields a stream but no range. Never rejects.
   */
  const resolveTraceLocationsBulk = async (
    traceIds: string[],
    startTimeUs: number,
    endTimeUs: number,
  ): Promise<Record<string, TraceLocation>> => {
    try {
      const result: Record<string, TraceLocation> = {};
      const toResolve: string[] = [];
      for (const rawId of traceIds) {
        const canonical = normalizeTraceId(rawId);
        if (!canonical) continue;
        const cached = cache().byTraceId[canonical];
        if (cached) result[canonical] = cached;
        else if (!toResolve.includes(canonical)) toResolve.push(canonical);
      }
      if (!toResolve.length) return result;

      const allStreams = await listTracesStreams();
      if (!allStreams.length) return result;
      if (allStreams.length === 1) {
        // The stream is already known; the lookup is for the range alone, so
        // an unanswered id still resolves to that stream.
        const ranges = indexEndpointAvailable
          ? await lookupTraceLocations(allStreams, toResolve, startTimeUs, endTimeUs, allStreams)
          : { found: {} as Record<string, TraceLocation> };
        for (const id of toResolve) {
          const location = { stream: allStreams[0], range: ranges.found[id]?.range };
          result[id] = location;
          record(id, location.stream, location.range);
        }
        return result;
      }

      // The index answers first; only what it could not cover is probed.
      let pending = toResolve;
      if (indexEndpointAvailable) {
        const lookup = await lookupTraceLocations(allStreams, toResolve, startTimeUs, endTimeUs);
        for (const [id, location] of Object.entries(lookup.found)) {
          result[id] = location;
          record(id, location.stream, location.range);
        }
        pending = lookup.unanswered;
      }
      if (!pending.length) return result;

      const known: string[] = cache().knownStreams.filter((s: string) => allStreams.includes(s));
      const step1Streams = known.length ? known : allStreams;
      const step1 = await probeBatch(step1Streams, pending, startTimeUs, endTimeUs);
      for (const [id, stream] of Object.entries(step1)) {
        result[id] = { stream };
        record(id, stream);
      }

      // Step 2: only unresolved ids, only unprobed streams.
      const unresolved = pending.filter((id) => !(id in result));
      const unprobed = allStreams.filter((s) => !step1Streams.includes(s));
      if (unresolved.length && unprobed.length) {
        const step2 = await probeBatch(unprobed, unresolved, startTimeUs, endTimeUs);
        for (const [id, stream] of Object.entries(step2)) {
          result[id] = { stream };
          record(id, stream);
        }
      }
      return result;
    } catch (err: unknown) {
      console.error("Failed to resolve traces streams", err);
      return {};
    }
  };

  /**
   * Where `traceId` lives, falling back to RUM_CORRELATION_TRACES_STREAM with
   * no range. Never rejects.
   */
  const resolveTraceLocation = async (
    traceId: string,
    startTimeUs: number,
    endTimeUs: number,
  ): Promise<TraceLocation> => {
    const canonical = normalizeTraceId(traceId);
    if (!canonical) return { stream: RUM_CORRELATION_TRACES_STREAM };

    const cached = cache().byTraceId[canonical];
    if (cached) return cached;

    const pending = inFlight.get(canonical);
    if (pending) return pending;

    const promise = (async () => {
      const found = await resolveTraceLocationsBulk([canonical], startTimeUs, endTimeUs);
      return found[canonical] ?? { stream: RUM_CORRELATION_TRACES_STREAM };
    })().finally(() => {
      inFlight.delete(canonical);
    });
    inFlight.set(canonical, promise);
    return promise;
  };

  return { resolveTraceLocation, resolveTraceLocationsBulk };
}
