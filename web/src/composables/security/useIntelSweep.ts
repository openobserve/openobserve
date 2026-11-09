// Copyright 2026 OpenObserve Inc.

// Coverage is returned with matches, so an empty result is told apart from "nothing could have matched".

import { ref, shallowRef } from "vue";
import streamService from "@/services/stream";
import securityIntel, {
  type SweepCoverage,
  type SweepStreamTarget,
} from "@/services/securityIntel";
import { fetchSecuritySources, fetchSourceMatch } from "@/services/securitySources.queries";
import { FieldIndex } from "@/utils/security/fields";
import type { Indicator, IndicatorMatch, SweepType } from "@/utils/security/intel";

export type { SweepCoverage } from "@/services/securityIntel";
export { MAX_SWEEP_QUERIES } from "@/services/securityIntel";

/** Unambiguous fields only: `host`/`resource` may hold account ids, so domains and URLs match by column name. */
const MAPPED_FIELDS: Partial<
  Record<SweepType, ("srcIp" | "dstIp" | "host" | "actor" | "actorId" | "resource")[]>
> = {
  ip: ["srcIp", "dstIp"],
  email: ["actor", "actorId"],
};

/** Columns the stream's detected source maps to each type, for the server to search too. */
async function mappedColumns(orgId: string, stream: string): Promise<SweepStreamTarget> {
  const res = await streamService.schema(orgId, stream, "logs");
  const fields: string[] = (res.data?.schema ?? res.data?.fields ?? []).map((f: any) =>
    String(f.name),
  );
  const source = fields.length
    ? ((await fetchSourceMatch(orgId, fields)).classification?.source ?? null)
    : null;
  const index = new FieldIndex(fields);
  const mapped: SweepStreamTarget["mapped"] = {};
  for (const [type, keys] of Object.entries(MAPPED_FIELDS) as [SweepType, string[]][]) {
    const columns = keys
      .flatMap(
        (key) => (source?.map?.[key as keyof typeof source.map] as string[] | undefined) ?? [],
      )
      .flatMap((path) => path.split("|"))
      .map((path) => index.resolve(path))
      .filter((c): c is string => !!c);
    if (columns.length) mapped[type] = columns;
  }
  return { name: stream, mapped };
}

export function useIntelSweep() {
  const matches = shallowRef<IndicatorMatch[]>([]);
  const coverage = shallowRef<SweepCoverage[]>([]);
  const streams = shallowRef<string[]>([]);
  const running = ref(false);
  const done = ref(0);
  const planned = ref(0);
  /** The query cap cut the sweep short. */
  const partial = ref(false);
  const failed = ref(0);
  /** Queries the server answered only partially. */
  const partialResults = ref(0);
  /** Indicators fully checked, out of `total` sweepable ones. */
  const checked = ref(0);
  const total = ref(0);
  /** Streams whose schema could not be read — nothing in them was searched. */
  const unreadStreams = shallowRef<string[]>([]);
  const lastRunAt = ref<number | null>(null);
  let seq = 0;

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
    planned.value = 0;
    try {
      const names = (await fetchSecuritySources(orgId)).sources;
      if (stale()) return;
      streams.value = names;
      const targets = await Promise.all(
        names.map((name) => mappedColumns(orgId, name).catch(() => ({ name }))),
      );
      if (stale()) return;
      const res = (await securityIntel.sweep(orgId, indicators, targets, window, signal)).data;
      if (stale()) return;
      // The server echoes each match's key; the page keeps its own copy of the indicator.
      const byKey = new Map(
        indicators.map((i) => [`${i.type}:${i.indicator.toLowerCase()}`, i] as const),
      );
      matches.value = res.matches.flatMap((m) => {
        const indicator = byKey.get(`${m.indicator.type}:${m.indicator.indicator.toLowerCase()}`);
        return indicator ? [{ ...m, indicator }] : [];
      });
      coverage.value = res.coverage;
      unreadStreams.value = res.unread_streams;
      partial.value = res.capped;
      failed.value = res.failed;
      partialResults.value = res.partial_results;
      checked.value = res.checked;
      total.value = res.total;
      planned.value = res.planned;
      done.value = res.planned;
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
    checked,
    total,
    lastRunAt,
    run,
  };
}
