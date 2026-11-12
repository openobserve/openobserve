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
  TRACE_IDS_PER_GET_REQUEST,
  TRACE_TIME_RANGE_MAX_IDS,
  type TraceTimeRange,
} from "@/ts/interfaces/traces/traceTimeRange.types";
import { generateTraceContext } from "@/utils/zincutils";
import { chunkItems, mapWithConcurrency } from "@/utils/rum/batching";
import { normalizeTraceId, RUM_CORRELATION_TRACES_STREAM } from "@/utils/rum/fields";

/**
 * How a bulk resolve ended, for callers that must tell "the resolver failed" from "resolved,
 * but the trace is indexed nowhere" (an absent id means either).
 */
export interface TraceLocationsOutcome {
  /** True when a failure left some ids unanswered: the stream list, a probe (an error, a partial answer or a function error) or the whole resolve. */
  failed: boolean;
  /** The org's traces streams, as listed; empty when the list could not be read. */
  streams: string[];
}

/** Where a trace lives, and when it ran when the index could tell us. */
export interface TraceLocation {
  stream: string;
  /** Absent when the answer came from the probe fallback. */
  range?: TraceTimeRange;
}

// Ingestion can lag the event-derived window; probes are `limit 1` point lookups, so a wide buffer is free.
const PROBE_TIME_BUFFER_US = 300_000_000; // ±5 min

// Ids go in the GET query string, so a chunk stays within TRACE_IDS_PER_GET_REQUEST (a WAF
// blocks longer query strings); a long session makes many chunks, so only this many run at once.
const TIME_RANGE_IDS_PER_REQUEST = Math.min(TRACE_TIME_RANGE_MAX_IDS, TRACE_IDS_PER_GET_REQUEST);
const TIME_RANGE_CONCURRENCY = 6;
// The probe is one POST whose SQL lists every id once per stream, so thousands of unanswered ids
// go in chunks of this many, PROBE_CONCURRENCY at a time, instead of one huge request.
const PROBE_IDS_PER_REQUEST = 200;
const PROBE_CONCURRENCY = 2;

// Deduplicates concurrent resolves of the same id (e.g. the error card and the
// Traces tab racing on page load). Transient in-progress work, deliberately
// NOT in the Vuex store: entries delete themselves on settle, so org-switch
// staleness cannot apply.
// An entry whose owning instance cancel()led settles to CANCELLED, so a caller that joined it
// from another instance resolves again on its own instead of taking a silent fallback.
const CANCELLED = Symbol("cancelled");
const inFlight = new Map<string, Promise<TraceLocation | typeof CANCELLED>>();

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
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

  const activeProbeTraceIds = new Set<string>();
  // A cancelled stream calls no handler, so cancel() settles each in-flight probe itself (as a
  // failed miss), and bumps the generation so probeInChunks starts no further chunk.
  const probeSettlers = new Set<() => void>();
  let cancelGeneration = 0;

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

  /** The stream for an id found nowhere: `default`, unless the org's list shows it has no such stream. */
  const fallbackTracesStream = async (): Promise<string | null> => {
    const streams = await listTracesStreams();
    if (!streams.length) return RUM_CORRELATION_TRACES_STREAM;
    return streams.includes(RUM_CORRELATION_TRACES_STREAM) ? RUM_CORRELATION_TRACES_STREAM : null;
  };

  /**
   * One `traces/time_range` pass over `traceIds`, in URL-safe chunks of
   * TIME_RANGE_IDS_PER_REQUEST, TIME_RANGE_CONCURRENCY at a time. Splits the ids into the ones the index
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
    signal?: AbortSignal,
  ): Promise<{ found: Record<string, TraceLocation>; unanswered: string[] }> => {
    const found: Record<string, TraceLocation> = {};
    const unanswered: string[] = [];
    if (!traceIds.length) return { found, unanswered };

    const rank = new Map(streams.map((stream, index) => [stream, index]));
    const rankOf = (stream: string) => rank.get(stream) ?? Number.MAX_SAFE_INTEGER;

    const chunks = chunkItems(traceIds, TIME_RANGE_IDS_PER_REQUEST);

    await mapWithConcurrency(chunks, TIME_RANGE_CONCURRENCY, async (chunk) => {
      // An aborted resolve starts no further chunk.
      if (signal?.aborted) {
        unanswered.push(...chunk);
        return;
      }
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
          signal,
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
    });

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
    outcome?: TraceLocationsOutcome,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> => {
    if (!streams.length || !traceIds.length || signal?.aborted) return {};
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

    const probeTraceId = generateTraceContext()?.traceId ?? "";
    if (probeTraceId) activeProbeTraceIds.add(probeTraceId);
    let settleOnCancel: (() => void) | null = null;
    // Aborting stops this probe's stream and settles it, like cancel() does for every probe.
    const onAbort = () => {
      if (probeTraceId) {
        cancelStreamQueryBasedOnRequestId({
          trace_id: probeTraceId,
          org_id: store.state.selectedOrganization?.identifier,
        });
      }
      settleOnCancel?.();
    };
    try {
      await new Promise<void>((resolve) => {
        settleOnCancel = () => resolve();
        probeSettlers.add(settleOnCancel);
        signal?.addEventListener("abort", onAbort, { once: true });
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
            traceId: probeTraceId,
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
                // A partial answer or a function error keeps the hits it has, but a miss from it is not clean.
                if (outcome && (results?.is_partial || results?.function_error?.length)) {
                  outcome.failed = true;
                }
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
            error: () => {
              // a failed sub-query is a miss, not an error; the outcome tells a caller it was not a clean miss
              if (outcome) outcome.failed = true;
              resolve();
            },
            complete: () => resolve(),
            reset: () => {},
          },
        )?.catch?.(() => {
          if (outcome) outcome.failed = true;
          resolve();
        });
      });
    } catch {
      if (outcome) outcome.failed = true;
      return {};
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (probeTraceId) activeProbeTraceIds.delete(probeTraceId);
      if (settleOnCancel) probeSettlers.delete(settleOnCancel);
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

  /** probeBatch over `traceIds` in chunks of PROBE_IDS_PER_REQUEST; the answers merge (ids are distinct). */
  const probeInChunks = async (
    streams: string[],
    traceIds: string[],
    startTimeUs: number,
    endTimeUs: number,
    outcome?: TraceLocationsOutcome,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> => {
    const generation = cancelGeneration;
    const parts = await mapWithConcurrency(
      chunkItems(traceIds, PROBE_IDS_PER_REQUEST),
      PROBE_CONCURRENCY,
      async (chunk) =>
        signal?.aborted || generation !== cancelGeneration
          ? {}
          : probeBatch(streams, chunk, startTimeUs, endTimeUs, outcome, signal),
    );
    return Object.assign({}, ...parts);
  };

  /**
   * id → location for every id found (absent = found nowhere; callers fall
   * back to RUM_CORRELATION_TRACES_STREAM per id). The index answers first and
   * carries the trace's real range; only ids it could not cover fall through
   * to the probe, which escalates `knownStreams` → the remaining streams and
   * yields a stream but no range. Never rejects.
   *
   * The optional `outcome` is filled in for callers that need to know why an id is absent
   * (see TraceLocationsOutcome); callers that pass none behave as before.
   */
  const resolveTraceLocationsBulk = async (
    traceIds: string[],
    startTimeUs: number,
    endTimeUs: number,
    outcome?: TraceLocationsOutcome,
    // Aborting stops the remaining time_range chunks and probes; the answer so far is returned.
    signal?: AbortSignal,
  ): Promise<Record<string, TraceLocation>> => {
    if (outcome) {
      outcome.failed = false;
      outcome.streams = [];
    }
    // Once aborted or cancel()led, nothing more is written to the shared cache (it may already belong to
    // another org or session). Ids an abort left unanswered are not clean misses, so the outcome says it failed.
    const generation = cancelGeneration;
    const stopped = () => {
      const halted = Boolean(signal?.aborted) || generation !== cancelGeneration;
      if (halted && outcome) outcome.failed = true;
      return halted;
    };
    try {
      const result: Record<string, TraceLocation> = {};
      const toResolve: string[] = [];
      // A Set keeps the dedup linear for a session's thousands of ids.
      const queued = new Set<string>();
      for (const rawId of traceIds) {
        const canonical = normalizeTraceId(rawId);
        if (!canonical) continue;
        const cached = cache().byTraceId[canonical];
        if (cached) result[canonical] = cached;
        else if (!queued.has(canonical)) {
          queued.add(canonical);
          toResolve.push(canonical);
        }
      }
      if (!toResolve.length) return result;

      const allStreams = await listTracesStreams();
      if (outcome) outcome.streams = allStreams;
      if (!allStreams.length) {
        // No list means a failed read as often as an org without traces; either way nothing was resolved.
        if (outcome) outcome.failed = true;
        return result;
      }
      if (allStreams.length === 1) {
        // The stream is already known; the lookup is for the range alone, so
        // an unanswered id still resolves to that stream.
        const ranges = indexEndpointAvailable
          ? await lookupTraceLocations(
              allStreams,
              toResolve,
              startTimeUs,
              endTimeUs,
              allStreams,
              signal,
            )
          : { found: {} as Record<string, TraceLocation> };
        // An aborted lookup left ranges unknown; caching them range-less would outlive the abort.
        if (stopped()) return result;
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
        const lookup = await lookupTraceLocations(
          allStreams,
          toResolve,
          startTimeUs,
          endTimeUs,
          undefined,
          signal,
        );
        if (stopped()) return result;
        for (const [id, location] of Object.entries(lookup.found)) {
          result[id] = location;
          record(id, location.stream, location.range);
        }
        pending = lookup.unanswered;
      }
      if (!pending.length || stopped()) return result;

      const known: string[] = cache().knownStreams.filter((s: string) => allStreams.includes(s));
      const step1Streams = known.length ? known : allStreams;
      const step1 = await probeInChunks(
        step1Streams,
        pending,
        startTimeUs,
        endTimeUs,
        outcome,
        signal,
      );
      if (stopped()) return result;
      for (const [id, stream] of Object.entries(step1)) {
        result[id] = { stream };
        record(id, stream);
      }

      // Step 2: only unresolved ids, only unprobed streams.
      const unresolved = pending.filter((id) => !(id in result));
      const unprobed = allStreams.filter((s) => !step1Streams.includes(s));
      if (unresolved.length && unprobed.length) {
        const step2 = await probeInChunks(
          unprobed,
          unresolved,
          startTimeUs,
          endTimeUs,
          outcome,
          signal,
        );
        if (stopped()) return result;
        for (const [id, stream] of Object.entries(step2)) {
          result[id] = { stream };
          record(id, stream);
        }
      }
      return result;
    } catch (err: unknown) {
      console.error("Failed to resolve traces streams", err);
      if (outcome) outcome.failed = true;
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

    const generation = cancelGeneration;
    const pending = inFlight.get(canonical);
    if (pending) {
      const shared = await pending;
      if (shared !== CANCELLED) return shared;
      // Retry only if this instance did not cancel meanwhile (it would be a request after unmount).
      return generation === cancelGeneration
        ? resolveTraceLocation(traceId, startTimeUs, endTimeUs)
        : { stream: RUM_CORRELATION_TRACES_STREAM };
    }

    const promise = (async () => {
      const found = await resolveTraceLocationsBulk([canonical], startTimeUs, endTimeUs);
      if (generation !== cancelGeneration) return CANCELLED;
      return found[canonical] ?? { stream: RUM_CORRELATION_TRACES_STREAM };
    })().finally(() => {
      inFlight.delete(canonical);
    });
    inFlight.set(canonical, promise);
    const own = await promise;
    return own === CANCELLED ? { stream: RUM_CORRELATION_TRACES_STREAM } : own;
  };

  const cancel = () => {
    cancelGeneration += 1;
    activeProbeTraceIds.forEach((traceId) =>
      cancelStreamQueryBasedOnRequestId({
        trace_id: traceId,
        org_id: store.state.selectedOrganization?.identifier,
      }),
    );
    activeProbeTraceIds.clear();
    const settlers = [...probeSettlers];
    probeSettlers.clear();
    settlers.forEach((settle) => settle());
  };

  return { resolveTraceLocation, resolveTraceLocationsBulk, fallbackTracesStream, cancel };
}
