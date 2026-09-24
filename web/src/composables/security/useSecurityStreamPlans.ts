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
import { acceptOutcome, planStream, type StreamPlan } from "@/utils/security/entities";
import { outcomeSampleSql } from "@/utils/security/outcome";
import { loadTaggedStreams, securityStreamNames } from "@/utils/security/streams";

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

export interface SqlResult {
  hits: Record<string, unknown>[];
  /** The engine answered with part of the data (a node or partition missing). */
  partial: boolean;
  /** A query function reported an error; the rows may be incomplete. */
  functionError: string;
}

/** One search; throws on failure, and says when the answer is partial. */
export async function runSql(
  orgId: string,
  sql: string,
  startUs: number,
  endUs: number,
  size = -1,
): Promise<SqlResult> {
  const res = await searchService.search(
    {
      org_identifier: orgId,
      query: { query: { sql, start_time: startUs, end_time: endUs, from: 0, size } },
      page_type: "logs",
    },
    "ui",
  );
  return {
    hits: res.data?.hits ?? [],
    partial: !!res.data?.is_partial,
    functionError: String(res.data?.function_error ?? ""),
  };
}

export function useSecurityStreamPlans() {
  const plans = shallowRef<StreamPlan[]>([]);
  /** Streams whose schema could not be read, so they are not in `plans`. */
  const unreadable = ref<string[]>([]);
  const loading = ref(false);
  const error = ref("");
  let seq = 0;

  async function planOne(
    orgId: string,
    name: string,
    sampleStart: number,
    sampleEnd: number,
  ): Promise<StreamPlan> {
    const schema = await streamService.schema(orgId, name, "logs");
    const fields: string[] = (schema.data?.schema ?? schema.data?.fields ?? []).map((f: any) =>
      String(f.name),
    );
    const source = fields.length ? (bestMatch(fields)?.source ?? null) : null;
    const plan = planStream(name, fields, source);
    if (!plan.outcomeColumn) return plan;
    // Trust an outcome column only after reading what it actually holds.
    try {
      const { hits } = await runSql(
        orgId,
        outcomeSampleSql(name, plan.outcomeColumn),
        sampleStart,
        sampleEnd,
      );
      return acceptOutcome(
        plan,
        hits.map((h) => ({ value: h.zo_value, n: Number(h.zo_n ?? 0) })),
      );
    } catch {
      return acceptOutcome(plan, []);
    }
  }

  /** Rebuilds every plan; outcome columns are judged over the page's window. */
  async function load(orgId: string, sampleStart: number, sampleEnd: number) {
    if (!orgId) return;
    const mine = ++seq;
    loading.value = true;
    error.value = "";
    try {
      const res = await streamService.nameList(orgId, "logs", false);
      const names = securityStreamNames(
        (res.data?.list ?? []).map((s: any) => String(s.name)),
        loadTaggedStreams(orgId),
      );
      const settled = await runPool(
        names.map((name) => () => planOne(orgId, name, sampleStart, sampleEnd)),
      );
      const out: StreamPlan[] = [];
      const failed: string[] = [];
      settled.forEach((r, i) =>
        r.status === "fulfilled" ? out.push(r.value) : failed.push(names[i]),
      );
      if (mine !== seq) return;
      plans.value = out.sort((a, b) => a.stream.localeCompare(b.stream));
      unreadable.value = failed.sort();
    } catch (e: any) {
      if (mine !== seq) return;
      error.value = e?.response?.data?.message ?? e?.message ?? "";
      plans.value = [];
      unreadable.value = [];
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  return { plans, unreadable, loading, error, load };
}
