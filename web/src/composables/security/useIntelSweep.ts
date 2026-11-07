// Copyright 2026 OpenObserve Inc.

// Coverage is returned with matches, so an empty result is told apart from "nothing could have matched".

import { ref, shallowRef } from "vue";
import { runPool, runSql } from "@/composables/security/useSecurityStreamPlans";
import streamService from "@/services/stream";
import { bestMatch } from "@/utils/security/classify";
import { FieldIndex } from "@/utils/security/fields";
import {
  batches,
  candidateColumns,
  foldMatches,
  sweepColumnRows,
  sweepSql,
  type Indicator,
  type IndicatorMatch,
  type SweepType,
} from "@/utils/security/intel";
import { securitySourceNames } from "@/utils/security/sourceSelection";

/** Queries per sweep. Past this the sweep stops and says it is partial. */
export const MAX_SWEEP_QUERIES = 200;
const CONCURRENCY = 4;

/** Unambiguous fields only: `host`/`resource` may hold account ids, so domains and URLs match by column name. */
const MAPPED_FIELDS: Record<
  SweepType,
  ("srcIp" | "dstIp" | "host" | "actor" | "actorId" | "resource")[]
> = {
  ip: ["srcIp", "dstIp"],
  domain: [],
  url: [],
  hash: [],
  email: ["actor", "actorId"],
};

export interface SweepCoverage {
  type: SweepType;
  indicators: number;
  /** Columns every batch of this type was searched in. */
  columns: { stream: string; column: string }[];
  /** Columns that could hold this type but were not (fully) searched: cap or failure. */
  skipped: { stream: string; column: string }[];
}

interface Task {
  stream: string;
  columns: string[];
  type: SweepType;
  values: string[];
}

export function useIntelSweep() {
  const matches = shallowRef<IndicatorMatch[]>([]);
  const coverage = shallowRef<SweepCoverage[]>([]);
  const streams = shallowRef<string[]>([]);
  const running = ref(false);
  const done = ref(0);
  const planned = ref(0);
  const partial = ref(false);
  const failed = ref(0);
  /** Queries the server answered only partially. */
  const partialResults = ref(0);
  /** Streams whose schema could not be read — nothing in them was searched. */
  const unreadStreams = shallowRef<string[]>([]);
  const lastRunAt = ref<number | null>(null);
  let seq = 0;

  async function columnsFor(orgId: string, stream: string) {
    const res = await streamService.schema(orgId, stream, "logs");
    const fields: string[] = (res.data?.schema ?? res.data?.fields ?? []).map((f: any) =>
      String(f.name),
    );
    const source = bestMatch(fields)?.source ?? null;
    const index = new FieldIndex(fields);
    const mapped = (type: SweepType) =>
      MAPPED_FIELDS[type]
        .flatMap((key) => (source?.map?.[key] as string[] | undefined) ?? [])
        .flatMap((path) => path.split("|"))
        .map((path) => index.resolve(path))
        .filter((c): c is string => !!c);
    return (type: SweepType) => candidateColumns(type, fields, mapped(type));
  }

  async function run(
    orgId: string,
    indicators: Indicator[],
    window: { start: number; end: number },
    signal?: AbortSignal,
  ) {
    const mySeq = ++seq;
    const stale = () => mySeq !== seq || !!signal?.aborted;
    running.value = true;
    done.value = 0;
    failed.value = 0;
    partialResults.value = 0;
    partial.value = false;
    try {
      const all = await streamService.nameList(orgId, "logs", false);
      const names = securitySourceNames(
        orgId,
        (all.data?.list ?? []).map((s: any) => String(s.name)),
      );
      if (stale()) return;
      streams.value = names;

      const valuesByType = new Map<SweepType, string[]>();
      const seenValues = new Map<SweepType, Set<string>>();
      for (const i of indicators) {
        if (i.type === "cidr") continue;
        const list = valuesByType.get(i.type) ?? [];
        const seen = seenValues.get(i.type) ?? new Set<string>();
        if (!seen.has(i.indicator)) {
          seen.add(i.indicator);
          list.push(i.indicator);
        }
        valuesByType.set(i.type, list);
        seenValues.set(i.type, seen);
      }

      const settled = await runPool(names.map((stream) => () => columnsFor(orgId, stream)));
      if (stale()) return;
      const unread = names.filter((_, s) => settled[s].status === "rejected");
      const resolvers = settled.map((r) =>
        r.status === "fulfilled" ? r.value : () => [] as string[],
      );
      unreadStreams.value = unread;

      // Interleaved per type, so the query cap trims every type rather than dropping the last one.
      const perType: Task[][] = [];
      for (const [type, values] of valuesByType) {
        const list: Task[] = [];
        names.forEach((stream, s) => {
          const columns = resolvers[s](type);
          if (!columns.length) return;
          for (const batch of batches(values)) list.push({ stream, columns, type, values: batch });
        });
        perType.push(list);
      }
      const tasks: Task[] = [];
      for (let i = 0; perType.some((list) => i < list.length); i++) {
        for (const list of perType) if (i < list.length) tasks.push(list[i]);
      }
      partial.value = tasks.length > MAX_SWEEP_QUERIES;
      const queue = tasks.slice(0, MAX_SWEEP_QUERIES);
      const dropped = tasks.slice(MAX_SWEEP_QUERIES);
      planned.value = queue.length;
      const failedTasks: Task[] = [];
      const partialTasks: Task[] = [];

      const results: {
        stream: string;
        column: string;
        type: SweepType;
        rows: Record<string, unknown>[];
      }[] = [];
      const worker = async () => {
        for (let task = queue.shift(); task; task = queue.shift()) {
          if (stale()) return;
          try {
            const res = await runSql(
              orgId,
              sweepSql(task.stream, task.columns, task.type, task.values),
              window.start,
              window.end,
              -1,
              { signal },
            );
            for (const { column, rows } of sweepColumnRows(task.columns, res.hits)) {
              results.push({ stream: task.stream, column, type: task.type, rows });
            }
            // A partial (or capped) answer still counts its rows, but its columns were not fully searched.
            if (res.partial || res.functionError) {
              partialTasks.push(task);
              partialResults.value += 1;
            }
          } catch {
            if (stale()) return;
            // One unreadable column must not sink the sweep; it is counted and shown.
            failed.value += 1;
            failedTasks.push(task);
          }
          if (mySeq === seq) done.value += 1;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (stale()) return;
      // A column counts as searched only when none of its batches was dropped by the cap or failed.
      const keys = (t: Task) => t.columns.map((column) => `${t.type}|${t.stream}|${column}`);
      const incomplete = new Set([...dropped, ...failedTasks, ...partialTasks].flatMap(keys));
      coverage.value = [...valuesByType].map(([type, values]) => {
        const columns: { stream: string; column: string }[] = [];
        const skippedCols: { stream: string; column: string }[] = [];
        const seen = new Set<string>();
        for (const t of tasks) {
          if (t.type !== type) continue;
          t.columns.forEach((column) => {
            const k = `${t.type}|${t.stream}|${column}`;
            if (seen.has(k)) return;
            seen.add(k);
            (incomplete.has(k) ? skippedCols : columns).push({ stream: t.stream, column });
          });
        }
        return { type, indicators: values.length, columns, skipped: skippedCols };
      });
      matches.value = foldMatches(indicators, results);
      lastRunAt.value = Date.now();
    } finally {
      if (mySeq === seq) running.value = false;
    }
  }

  return {
    matches,
    coverage,
    streams,
    unreadStreams,
    running,
    done,
    planned,
    partial,
    failed,
    partialResults,
    lastRunAt,
    run,
  };
}
