// Copyright 2026 OpenObserve Inc.
//
// useIntelSweep.ts — find which indicators appeared in the security streams.
//
// For every security stream the schema is read and the source identified; each
// indicator type is then matched against the columns that can hold it (what
// the source maps to that entity, plus columns named for it). One query per
// (stream, column, batch of ≤400 values), a few in flight at a time. What was
// searched is returned alongside the matches, so an empty result can be told
// apart from "nothing could have matched".

import { ref, shallowRef } from "vue";
import searchService from "@/services/search";
import streamService from "@/services/stream";
import { bestMatch } from "@/utils/security/classify";
import { FieldIndex } from "@/utils/security/fields";
import {
  batches,
  candidateColumns,
  foldMatches,
  sweepSql,
  type Indicator,
  type IndicatorMatch,
  type SweepType,
} from "@/utils/security/intel";
import { loadTaggedStreams, securityStreamNames } from "@/utils/security/streams";

/** Queries per sweep. Past this the sweep stops and says it is partial. */
export const MAX_SWEEP_QUERIES = 200;
const CONCURRENCY = 4;

/**
 * Normalized fields whose mapped columns carry each indicator type. Only the
 * unambiguous ones: a source's `host` or `resource` can be an account id or a
 * service name (CloudTrail maps them that way), so domains and URLs are found
 * by column name alone.
 */
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
  column: string;
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
  ) {
    const mySeq = ++seq;
    running.value = true;
    done.value = 0;
    failed.value = 0;
    partialResults.value = 0;
    partial.value = false;
    try {
      const all = await streamService.nameList(orgId, "logs", false);
      const names = securityStreamNames(
        (all.data?.list ?? []).map((s: any) => String(s.name)),
        loadTaggedStreams(orgId),
      );
      if (mySeq !== seq) return;
      streams.value = names;

      const valuesByType = new Map<SweepType, string[]>();
      for (const i of indicators) {
        if (i.type === "cidr") continue;
        const list = valuesByType.get(i.type) ?? [];
        if (!list.includes(i.indicator)) list.push(i.indicator);
        valuesByType.set(i.type, list);
      }

      const unread: string[] = [];
      const resolvers = await Promise.all(
        names.map((stream) =>
          columnsFor(orgId, stream).catch(() => {
            unread.push(stream);
            return () => [] as string[];
          }),
        ),
      );
      if (mySeq !== seq) return;
      unreadStreams.value = unread;

      // One task list per type, then interleaved, so the query cap cuts every
      // type a little rather than dropping the last type entirely.
      const perType: Task[][] = [];
      for (const [type, values] of valuesByType) {
        const list: Task[] = [];
        names.forEach((stream, s) => {
          for (const column of resolvers[s](type)) {
            for (const batch of batches(values)) list.push({ stream, column, type, values: batch });
          }
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
          if (mySeq !== seq) return;
          try {
            const res = await searchService.search(
              {
                org_identifier: orgId,
                query: {
                  query: {
                    sql: sweepSql(task.stream, task.column, task.type, task.values),
                    start_time: window.start,
                    end_time: window.end,
                    from: 0,
                    size: task.values.length,
                  },
                },
                page_type: "logs",
              },
              "ui",
            );
            results.push({ ...task, rows: res.data?.hits ?? [] });
            // A partial answer still counts its rows, but the column was not fully searched.
            if (res.data?.is_partial || res.data?.function_error) {
              partialTasks.push(task);
              partialResults.value += 1;
            }
          } catch {
            // One unreadable column must not sink the sweep; it is counted and shown.
            failed.value += 1;
            failedTasks.push(task);
          }
          if (mySeq === seq) done.value += 1;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (mySeq !== seq) return;
      // Coverage describes what actually ran: a column counts as searched only
      // when none of its batches was dropped by the cap or failed.
      const key = (t: Task) => `${t.type}|${t.stream}|${t.column}`;
      const incomplete = new Set([...dropped, ...failedTasks, ...partialTasks].map(key));
      coverage.value = [...valuesByType].map(([type, values]) => {
        const columns: { stream: string; column: string }[] = [];
        const skippedCols: { stream: string; column: string }[] = [];
        const seen = new Set<string>();
        for (const t of tasks) {
          if (t.type !== type || seen.has(key(t))) continue;
          seen.add(key(t));
          (incomplete.has(key(t)) ? skippedCols : columns).push({
            stream: t.stream,
            column: t.column,
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
