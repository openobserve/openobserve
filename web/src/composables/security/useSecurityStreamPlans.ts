// Copyright 2026 OpenObserve Inc.
//
// useSecurityStreamPlans.ts — for every security stream, which columns hold
// users, IPs and hosts and how a failure is spelled.
//
// Entities and UEBA both query every security source at once, and both need
// the same answer per stream before they can write a single GROUP BY. Plans are
// rebuilt on every refresh, so a new stream or column shows up without a page
// reload; a stream whose schema cannot be read is reported, never skipped
// silently.

import { ref, shallowRef } from "vue";

import searchService from "@/services/search";
import streamService from "@/services/stream";
import { bestMatch } from "@/utils/security/classify";
import {
  LARGE_STREAM_ROWS,
  acceptOutcome,
  estimateRowsInWindow,
  planStream,
  volumeFromStats,
  type StreamPlan,
} from "@/utils/security/entities";
import {
  outcomeFallbackWindow,
  outcomeSampleSql,
  outcomeSampleWindow,
} from "@/utils/security/outcome";
import { securitySourceNames } from "@/utils/security/sourceSelection";

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
  /** The engine answered with part of the data (a node or partition missing). */
  partial: boolean;
  /** A query function reported an error; the rows may be incomplete. */
  functionError: string;
}

export interface SqlOptions {
  /** Aborts the request when the page leaves or starts over. */
  signal?: AbortSignal;
  traceparent?: string;
}

/** One search; throws on failure, and says when the answer is partial. */
export async function runSql(
  orgId: string,
  sql: string,
  startUs: number,
  endUs: number,
  size = -1,
  { signal, traceparent }: SqlOptions = {},
): Promise<SqlResult> {
  const res = await searchService.search(
    {
      org_identifier: orgId,
      query: { query: { sql, start_time: startUs, end_time: endUs, from: 0, size } },
      page_type: "logs",
      signal,
      traceparent,
    },
    "ui",
  );
  return {
    hits: res.data?.hits ?? [],
    partial: !!res.data?.is_partial,
    functionError: String(res.data?.function_error ?? ""),
  };
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
    const source = fields.length ? (bestMatch(fields)?.source ?? null) : null;
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
    try {
      const res = await streamService.nameList(orgId, "logs", false);
      const list: any[] = res.data?.list ?? [];
      const statsByName = new Map(list.map((s) => [String(s.name), s.stats]));
      const wanted = securitySourceNames(
        orgId,
        list.map((s) => String(s.name)),
      );
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
      names.value = [];
      plans.value = [];
      unreadable.value = [];
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  return { plans, names, unreadable, loading, error, load };
}
