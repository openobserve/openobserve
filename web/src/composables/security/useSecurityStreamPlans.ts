// Copyright 2026 OpenObserve Inc.

// Plans are rebuilt on every refresh, so a new stream or column shows up without a page reload.

import { ref, shallowRef } from "vue";

import useHttpStreaming from "@/composables/useStreamingSearch";
import store from "@/stores";
import streamService from "@/services/stream";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { fetchSecuritySources, fetchSourceMatch } from "@/services/securitySources.queries";
import {
  LARGE_STREAM_ROWS,
  acceptOutcome,
  estimateRowsInWindow,
  planStream,
  volumeFromStats,
  type StreamPlan,
} from "@/utils/security/streamPlan";
import {
  outcomeFallbackWindow,
  outcomeSampleSql,
  outcomeSampleWindow,
} from "@/utils/security/outcome";

/** Queries in flight at once; the search service rejects a flood with 429. */
export const QUERY_CONCURRENCY = 4;

/** Runs tasks through a small worker pool, keeping each result or error in order. */
export async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency = QUERY_CONCURRENCY,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/** Caps queries in flight across every pool that shares it; a freed slot passes straight to the next waiter. */
export function createLimiter(concurrency = QUERY_CONCURRENCY) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export interface SqlResult {
  hits: Record<string, unknown>[];
  /** The stream's reported total; absent when no metadata came back. */
  total?: number;
  /** The engine answered with part of the data (a node or partition missing). */
  partial: boolean;
  /** A query function reported an error; the rows may be incomplete. */
  functionError: string;
}

export interface SqlOptions {
  /** Aborts the request when the page leaves or starts over. */
  signal?: AbortSignal;
  /** Lets a caller cancel the query on the server by its trace id. */
  traceId?: string;
  pageType?: string;
  /** False when the result cache may hold a stale answer, as for a replaced enrichment table. */
  useCache?: boolean;
}

/** One `_search_stream` search; throws on failure, and says when the answer is partial. */
export function runSql(
  orgId: string,
  sql: string,
  startUs: number,
  endUs: number,
  size = -1,
  {
    signal,
    traceId = generateTraceContext().traceId,
    pageType = "logs",
    useCache = true,
  }: SqlOptions = {},
): Promise<SqlResult> {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const useBase64 = store.state.zoConfig?.sql_base64_enabled;
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException("The search was aborted", "AbortError");
    if (signal?.aborted) return reject(aborted());
    let streamingAggs = false;
    let hits: Record<string, unknown>[] = [];
    const metadataHits: Record<string, unknown>[] = [];
    let total: number | undefined;
    let partial = false;
    let functionError = "";
    const onAbort = () => {
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: orgId });
      reject(aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);

    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: useBase64 ? b64EncodeUnicode(sql) : sql,
            start_time: startUs,
            end_time: endUs,
            from: 0,
            size,
          },
          ...(useBase64 ? { encoding: "base64" } : {}),
        },
        type: "search",
        pageType,
        searchType: "ui",
        traceId,
        org_id: orgId,
        clear_cache: !useCache,
      },
      {
        data: (_payload: unknown, response: any) => {
          const content = response?.content ?? {};
          const results = content.results ?? {};
          if (response?.type === "search_response_metadata") {
            streamingAggs ||= Boolean(results.streaming_aggs ?? content.streaming_aggs);
            partial ||= Boolean(results.is_partial);
            if (results.function_error) functionError = String(results.function_error);
            if (typeof results.total === "number") {
              total = streamingAggs ? results.total : (total ?? 0) + results.total;
            }
            // A cached response can carry its hits on metadata alone, so keep them as a fallback.
            if (Array.isArray(results.hits)) metadataHits.push(...results.hits);
            return;
          }
          if (response?.type !== "search_response_hits") return;
          const chunk: Record<string, unknown>[] = results.hits ?? [];
          if (!Array.isArray(chunk) || !chunk.length) return;
          // A streaming aggregate resends the whole result, so it replaces rather than appends.
          hits = streamingAggs ? [...chunk] : [...hits, ...chunk];
        },
        error: (_payload: unknown, response: any) => {
          done();
          const body = response?.content ?? response ?? {};
          const error: any = new Error(
            String(body.message ?? body.error ?? body.error_detail ?? "search failed"),
          );
          error.status = body.status;
          error.code = body.code;
          // Shaped like an axios error, so isForbiddenError and licenseDeniedFeatures read its status.
          error.response = { status: body.status, data: body };
          reject(error);
        },
        complete: () => {
          done();
          resolve({
            hits: hits.length ? hits : metadataHits,
            total,
            partial,
            functionError,
          });
        },
      },
    );
  });
}

export interface PlanOptions {
  signal?: AbortSignal;
  /** Skip the outcome sample for streams without a user column; their plans keep no failure. */
  requireUser?: boolean;
}

export function useSecurityStreamPlans() {
  const plans = shallowRef<StreamPlan[]>([]);
  /** Every security stream named by the stream list, planned or not yet. */
  const names = shallowRef<string[]>([]);
  /** Streams whose schema could not be read, so they are not in `plans`. */
  const unreadable = ref<string[]>([]);
  const loading = ref(false);
  const error = ref("");
  /** The request that failed the load, kept so a page can tell a refusal from an outage. */
  const failure = shallowRef<unknown>(null);
  let seq = 0;

  async function sampleOutcome(
    orgId: string,
    plan: StreamPlan,
    sampleStart: number,
    sampleEnd: number,
    signal?: AbortSignal,
  ): Promise<{ value: unknown; n: number }[]> {
    const sql = outcomeSampleSql(plan.stream, plan.outcomeColumn!);
    const [start, end] = outcomeSampleWindow(sampleStart, sampleEnd);
    let { hits } = await runSql(orgId, sql, start, end, -1, { signal });
    const [wideStart, wideEnd] = outcomeFallbackWindow(sampleStart, sampleEnd);
    const wideRows = estimateRowsInWindow(plan.volume, wideStart, wideEnd);
    // A stream quiet for the last hour gets a wider look, unless that look is itself huge.
    if (!hits.length && wideStart < start && wideRows !== null && wideRows <= LARGE_STREAM_ROWS) {
      ({ hits } = await runSql(orgId, sql, wideStart, wideEnd, -1, { signal }));
    }
    return hits.map((h) => ({ value: h.zo_value, n: Number(h.zo_n ?? 0) }));
  }

  async function planOne(
    orgId: string,
    name: string,
    stats: unknown,
    sampleStart: number,
    sampleEnd: number,
    options: PlanOptions,
  ): Promise<StreamPlan> {
    options.signal?.throwIfAborted();
    const schema = await streamService.schema(orgId, name, "logs");
    const fields: string[] = (schema.data?.schema ?? schema.data?.fields ?? []).map((f: any) =>
      String(f.name),
    );
    const source = fields.length
      ? await fetchSourceMatch(orgId, fields)
          .then((m) => m.classification?.source ?? null)
          .catch(() => null)
      : null;
    const plan = { ...planStream(name, fields, source), volume: volumeFromStats(stats) };
    if (!plan.outcomeColumn) return plan;
    if (options.requireUser && !plan.columns.user) return acceptOutcome(plan, []);
    // Trust an outcome column only after reading what it actually holds.
    try {
      return acceptOutcome(
        plan,
        await sampleOutcome(orgId, plan, sampleStart, sampleEnd, options.signal),
      );
    } catch {
      return acceptOutcome(plan, []);
    }
  }

  /** Rebuilds every plan; outcome columns are judged on the last hour of the window. */
  async function load(
    orgId: string,
    sampleStart: number,
    sampleEnd: number,
    options: PlanOptions = {},
  ) {
    if (!orgId) return;
    const mine = ++seq;
    loading.value = true;
    error.value = "";
    failure.value = null;
    try {
      const res = await streamService.nameList(orgId, "logs", false);
      const list: any[] = res.data?.list ?? [];
      const statsByName = new Map(list.map((s) => [String(s.name), s.stats]));
      const listed = new Set(list.map((s) => String(s.name)));
      const wanted = (await fetchSecuritySources(orgId)).sources.filter((n) => listed.has(n));
      if (mine !== seq) return;
      names.value = [...wanted].sort();
      const settled = await runPool(
        wanted.map(
          (name) => () =>
            planOne(orgId, name, statsByName.get(name), sampleStart, sampleEnd, options),
        ),
      );
      const out: StreamPlan[] = [];
      const failed: string[] = [];
      settled.forEach((r, i) =>
        r.status === "fulfilled" ? out.push(r.value) : failed.push(wanted[i]),
      );
      if (mine !== seq) return;
      plans.value = out.sort((a, b) => a.stream.localeCompare(b.stream));
      unreadable.value = failed.sort();
    } catch (e: any) {
      if (mine !== seq) return;
      error.value = e?.response?.data?.message ?? e?.message ?? "";
      failure.value = e;
      names.value = [];
      plans.value = [];
      unreadable.value = [];
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  return { plans, names, unreadable, loading, error, failure, load };
}
