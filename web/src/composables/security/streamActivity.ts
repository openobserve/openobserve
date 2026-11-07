// Copyright 2026 OpenObserve Inc.

// Stream stats lag ingestion by minutes, so streams they call quiet are re-checked with one count each.

import { runPool, runSql } from "./useSecurityStreamPlans";
import { QUIET_AFTER_US, sourceHealth } from "@/utils/security/streams";
import { quoteIdent } from "@/utils/security/sql";

type StreamRow = { name: string; stats?: Record<string, any> } & Record<string, any>;

/** How long a stream the count found empty is trusted to stay quiet before it is counted again. */
export const QUIET_RECHECK_US = 10 * 60 * 1_000_000;
/** org/stream -> when a count last found it empty; spares the 60 s auto-refresh a search per quiet stream. */
const confirmedQuiet = new Map<string, number>();

/** Patches not-live streams' stats from a last-day count; a stream the count cannot read keeps its stats. */
export async function withRecentActivity<T extends StreamRow>(
  orgId: string,
  list: T[],
  names: string[],
  nowUs: number = Date.now() * 1000,
): Promise<T[]> {
  const wanted = new Set(names);
  const quietKey = (name: string) => `${orgId}/${name}`;
  const stale = list.filter(
    (s) =>
      wanted.has(s.name) &&
      sourceHealth(s.stats, nowUs) !== "live" &&
      nowUs - (confirmedQuiet.get(quietKey(s.name)) ?? -Infinity) >= QUIET_RECHECK_US,
  );
  if (!stale.length) return list;

  const settled = await runPool(
    stale.map(
      (s) => () =>
        runSql(
          orgId,
          `SELECT COUNT(*) AS zo_n, MAX(_timestamp) AS zo_last FROM ${quoteIdent(s.name)}`,
          nowUs - QUIET_AFTER_US,
          nowUs,
        ),
    ),
  );
  const patched = new Map<string, Record<string, any>>();
  settled.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const row = result.value.hits[0] ?? {};
    const count = Number(row.zo_n ?? 0);
    const last = Number(row.zo_last ?? 0);
    if (!count || !last) {
      confirmedQuiet.set(quietKey(stale[i].name), nowUs);
      return;
    }
    confirmedQuiet.delete(quietKey(stale[i].name));
    const stats = stale[i].stats ?? {};
    patched.set(stale[i].name, {
      ...stats,
      // At least this many; the stats total still wins once it catches up.
      doc_num: Math.max(Number(stats.doc_num ?? 0), count),
      doc_time_max: Math.max(Number(stats.doc_time_max ?? 0), last),
    });
  });
  if (!patched.size) return list;
  return list.map((s) => (patched.has(s.name) ? { ...s, stats: patched.get(s.name) } : s));
}

/** The OCSF class uids a stream carries over the window, most frequent first. */
export async function ocsfClassesIn(
  orgId: string,
  stream: string,
  column: string,
  startUs: number,
  endUs: number,
): Promise<number[]> {
  return (await ocsfClassCounts(orgId, stream, column, startUs, endUs)).map((c) => c.uid);
}

/** Rows per OCSF class uid over the window, most frequent first. */
export async function ocsfClassCounts(
  orgId: string,
  stream: string,
  column: string,
  startUs: number,
  endUs: number,
): Promise<{ uid: number; n: number }[]> {
  const col = quoteIdent(column);
  const { hits } = await runSql(
    orgId,
    `SELECT ${col} AS zo_class, COUNT(*) AS zo_n FROM ${quoteIdent(stream)} ` +
      `WHERE ${col} IS NOT NULL GROUP BY zo_class ORDER BY zo_n DESC LIMIT 50`,
    startUs,
    endUs,
  );
  return hits
    .map((h) => ({ uid: Number(h.zo_class), n: Number(h.zo_n) || 0 }))
    .filter((c) => Number.isInteger(c.uid) && c.uid > 0);
}
