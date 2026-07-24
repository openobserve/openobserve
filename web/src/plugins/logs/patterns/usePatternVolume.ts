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

import { ref, watch, type Ref } from "vue";
import searchService from "@/services/search";
import { extractWhereClause } from "@/utils/query/sqlUtils";
import { extractConstantsFromPattern, escapeForMatchAll } from "./patternUtils";

/** Context shared by every volume query. */
export interface PatternVolumeContext {
  orgId: string;
  streamName: string;
  /** Query window in microseconds. */
  startUs: number;
  endUs: number;
  /**
   * The extraction query's full SQL, if any — its WHERE clause is ANDed into the
   * volume query so a filtered extraction's sparklines/counts reflect the same
   * filtered subset (not the pattern across all logs).
   */
  baseSql?: string | null;
  /**
   * The rest of the extraction request's scope. A VRL function or action can
   * drop rows, and regions/clusters decide which nodes answer — so omitting them
   * would count a different population than the one the patterns came from.
   */
  queryFn?: string | null;
  actionId?: string | null;
  regions?: string[];
  clusters?: string[];
}

/**
 * Build the volume context from an extraction request, so every consumer scopes
 * its queries the same way. Returns null when there is nothing to query yet.
 *
 * The window comes from the extraction request itself, falling back to the
 * caller's. That keeps volumes on exactly the range the patterns were extracted
 * from — and it's what makes a re-run refresh: for a relative range the caller's
 * window is a computed over `relativeTimePeriod`, which doesn't change between
 * runs ("12h" stays "12h"), so it stays frozen at its first value and every
 * later run would keep querying the original window.
 */
export function buildPatternVolumeContext(args: {
  orgId: string;
  streamName?: string | null;
  window?: { start: number; end: number } | null;
  lastQuery?: any;
}): PatternVolumeContext | null {
  const { orgId, streamName, window, lastQuery } = args;
  const startUs = lastQuery?.query?.start_time ?? window?.start;
  const endUs = lastQuery?.query?.end_time ?? window?.end;
  if (!streamName || !startUs || !endUs) return null;
  return {
    orgId,
    streamName,
    startUs,
    endUs,
    baseSql: lastQuery?.query?.sql ?? null,
    queryFn: lastQuery?.query?.query_fn ?? null,
    actionId: lastQuery?.query?.action_id ?? null,
    regions: lastQuery?.regions ?? undefined,
    clusters: lastQuery?.clusters ?? undefined,
  };
}

/** SQL keywords that can follow a table name, so they're never read as aliases. */
const CLAUSE_KEYWORDS = "WHERE|GROUP|ORDER|LIMIT|OFFSET|HAVING|UNION|JOIN|ON|WINDOW|QUALIFY";

/**
 * The filter to AND into a volume query, or `null` when the extraction query's
 * semantics can't be faithfully reproduced.
 *
 * The volume query is a fresh `SELECT … FROM "<stream>"`, so it can only carry a
 * WHERE that stands alone. A condition qualified by a table alias
 * (`FROM "logs" AS l WHERE l.level = 'error'`) would reference an alias that
 * doesn't exist here, and filters living inside a CTE or subquery aren't in the
 * top-level WHERE at all. Returning null in those cases makes volume
 * unavailable, which is honest — silently dropping the filter would report
 * counts for the whole stream as if they were the pattern's.
 */
export async function resolveBaseFilter(sql?: string | null): Promise<string | null> {
  if (!sql?.trim()) return "";
  // Compound shapes whose filtering can't be re-expressed as a bare WHERE.
  if (/\bWITH\b|\bJOIN\b|\bUNION\b/i.test(sql)) return null;
  // A subquery in FROM, e.g. `FROM (SELECT ...)`.
  if (/\bFROM\s*\(/i.test(sql)) return null;
  // A table alias, e.g. `FROM "logs" AS l` or `FROM logs l`.
  if (
    new RegExp(
      String.raw`\bFROM\s+"?[\w.]+"?\s+(?:AS\s+)?(?!(?:${CLAUSE_KEYWORDS})\b)[A-Za-z_]\w*`,
      "i",
    ).test(sql)
  ) {
    return null;
  }
  const where = await extractWhereClause(sql);
  // A WHERE we failed to parse must not be treated as "no filter" — that would
  // silently widen the count to every log in the stream.
  if (!where && /\bWHERE\b/i.test(sql)) return null;
  return where;
}

/**
 * Target number of sparkline bars; the histogram interval is derived to hit
 * ~this. Kept just under what the cell can draw un-merged (see MAX_BARS in
 * PatternVolumeCell) so the bars shown ARE the buckets queried — asking for
 * more than fits only gets them averaged together on the way to the screen.
 */
const TARGET_BARS = 26;

/**
 * Snap a bucket width to a readable unit, returning both the DataFusion
 * `histogram()` interval string and its width in seconds. The seconds are what
 * lets the caller rebuild the full bucket grid and zero-fill empty buckets,
 * which `GROUP BY` omits.
 */
function histogramInterval(seconds: number): { label: string; seconds: number } {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return { label: `${s} second`, seconds: s };
  const m = Math.round(s / 60);
  if (m < 60) return { label: `${m} minute`, seconds: m * 60 };
  const h = Math.round(m / 60);
  if (h < 24) return { label: `${h} hour`, seconds: h * 3600 };
  const d = Math.round(h / 24);
  return { label: `${d} day`, seconds: d * 86400 };
}

export interface PatternVolumeResult {
  buckets: number[];
  /** Width of each bucket, so callers can say what a bar actually spans. */
  intervalSecs: number;
}

/**
 * Fetch a pattern's volume over time as an exact `histogram(_timestamp)` count,
 * filtered by the pattern's constant tokens via `match_all()`. Because pattern
 * templates come from full-text-search (tantivy-indexed) fields, this is an
 * index lookup — fast even over millions of rows — and it reflects the TRUE
 * time distribution (not a sample), so the sparkline matches the search histogram.
 *
 * Returns `null` when the pattern has no distinctive constant text to filter on
 * (an all-wildcard template) — those have no index term to query.
 */
export async function fetchPatternVolume(
  pattern: any,
  ctx: PatternVolumeContext,
): Promise<PatternVolumeResult | null> {
  const constants = extractConstantsFromPattern(pattern?.template ?? "");
  if (constants.length === 0) {
    return null;
  }

  const windowSecs = Math.max(1, (ctx.endUs - ctx.startUs) / 1_000_000);
  const { label: interval, seconds: intervalSecs } = histogramInterval(windowSecs / TARGET_BARS);

  const patternWhere = constants.map((c) => `match_all('${escapeForMatchAll(c)}')`).join(" AND ");
  // AND the extraction query's own filter (if any) so a filtered extraction's
  // volume reflects the same subset the patterns were extracted from. A null
  // means that filter can't be reproduced — report no volume rather than a
  // number for a different population.
  const baseWhere = await resolveBaseFilter(ctx.baseSql);
  if (baseWhere === null) return null;
  const where = baseWhere ? `(${baseWhere}) AND ${patternWhere}` : patternWhere;
  const sql =
    `SELECT histogram(_timestamp, '${interval}') AS zo_key, count(*) AS zo_cnt ` +
    `FROM "${ctx.streamName}" WHERE ${where} ` +
    `GROUP BY zo_key ORDER BY zo_key`;

  const response: any = await searchService.search(volumeSearchPayload(ctx, sql, 500), "ui");

  const hits: any[] = response?.data?.hits ?? [];
  return {
    buckets: bucketizeHistogram(hits, ctx.startUs, ctx.endUs, intervalSecs),
    intervalSecs,
  };
}

/**
 * Build a search payload that runs in the SAME scope the patterns were
 * extracted in. Dropping the VRL function, action, or region/cluster selection
 * would silently count a different population than the one being described.
 */
function volumeSearchPayload(ctx: PatternVolumeContext, sql: string, size: number) {
  return {
    org_identifier: ctx.orgId,
    query: {
      query: {
        sql,
        start_time: ctx.startUs,
        end_time: ctx.endUs,
        size,
        ...(ctx.queryFn ? { query_fn: ctx.queryFn } : {}),
        ...(ctx.actionId ? { action_id: ctx.actionId } : {}),
      },
      ...(ctx.regions?.length ? { regions: ctx.regions } : {}),
      ...(ctx.clusters?.length ? { clusters: ctx.clusters } : {}),
    },
    page_type: "logs",
  };
}

/**
 * Parse a histogram bucket key to epoch milliseconds.
 *
 * The backend returns naive ISO date-times (`2026-07-20T20:48:00`) that are
 * UTC. `new Date()` reads a date-TIME form with no offset as LOCAL time, which
 * silently shifts every bucket by the viewer's UTC offset — enough to slide a
 * whole sparkline off the end of its window. Force UTC when no zone is given.
 */
export function parseBucketKey(key: unknown): number {
  if (typeof key === "number") return key;
  if (typeof key !== "string" || !key) return NaN;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(key.trim());
  return new Date(hasZone ? key : `${key}Z`).getTime();
}

/**
 * Origin the backend anchors `histogram()` buckets to: it rewrites to
 * `date_bin(interval, ts, '2001-01-01T00:00:00')`, so bucket boundaries fall on
 * multiples of the interval from that instant — NOT from the query's start.
 */
const DATE_BIN_ORIGIN_MS = Date.UTC(2001, 0, 1);

/**
 * Place histogram hits on a zero-filled bucket grid spanning the query window.
 *
 * `GROUP BY` only returns buckets that HAVE rows, so mapping hits straight to
 * bars would pull an event at the start of the window next to one at the end
 * and read as continuous activity. Positioning each hit at its real offset
 * keeps quiet periods visible as gaps.
 *
 * The grid is anchored to the backend's `date_bin` origin rather than to the
 * query start. Anchoring at the start misaligns every boundary by
 * `start % interval`, which collapses the first two backend buckets into index
 * 0 (one floors to zero, the earlier one falls below the grid) and shifts the
 * rest — distinct buckets merge and the shape is wrong.
 */
export function bucketizeHistogram(
  hits: any[],
  startUs: number,
  endUs: number,
  intervalSecs: number,
): number[] {
  const bucketMs = Math.max(1, intervalSecs) * 1000;
  const startMs = startUs / 1000;
  const endMs = endUs / 1000;

  // First boundary at or before the window start, on the backend's grid.
  const gridStartMs =
    DATE_BIN_ORIGIN_MS + Math.floor((startMs - DATE_BIN_ORIGIN_MS) / bucketMs) * bucketMs;
  const bucketCount = Math.max(1, Math.ceil((endMs - gridStartMs) / bucketMs));

  const buckets = new Array<number>(bucketCount).fill(0);
  for (const hit of hits ?? []) {
    const keyMs = parseBucketKey(hit?.zo_key);
    if (Number.isNaN(keyMs)) continue;
    // Now that the grid matches the backend's, every returned bucket lands on
    // its own index; anything outside the window is genuinely out of range.
    const idx = Math.floor((keyMs - gridStartMs) / bucketMs);
    if (idx >= 0 && idx < bucketCount) {
      buckets[idx] += Number(hit?.zo_cnt ?? 0);
    }
  }
  return buckets;
}

/** Per-pattern volume state held centrally by PatternList. */
export interface PatternVolumeEntry {
  /** Histogram buckets; null = pattern has no queryable constants; [] = failed/empty. */
  buckets: number[] | null;
  /** Exact total occurrences (sum of buckets); null until known / unqueryable. */
  total: number | null;
  /** Width of each bucket in seconds; null until the volume resolves. */
  intervalSecs: number | null;
  loading: boolean;
}

/** Stable identity for a pattern across re-renders. */
export function patternVolumeKey(pattern: any): string {
  return String(pattern?.pattern_id ?? pattern?.template ?? "");
}

/**
 * Lazily fetch per-pattern volumes, one query per pattern, and cache the result.
 *
 * Deliberately demand-driven rather than eager: extraction can return up to
 * `max_clusters` patterns (1,000 by default), and fetching every one on open
 * would fire 1,000 searches for rows the user may never scroll to. Cells ask
 * for their own volume when they become visible, so cost tracks what's actually
 * on screen, and the cache keeps it to one query per pattern per query-window.
 */
export function usePatternVolumeCache(ctx: Ref<PatternVolumeContext | null>) {
  const entries = ref<Record<string, PatternVolumeEntry>>({});
  // Bumped whenever the context changes so late replies from the previous
  // window can't write into the fresh cache.
  let generation = 0;

  watch(ctx, () => {
    generation++;
    entries.value = {};
  });

  const request = async (pattern: any): Promise<void> => {
    const c = ctx.value;
    const key = patternVolumeKey(pattern);
    if (!c || !key || entries.value[key]) return;

    const token = generation;
    entries.value = {
      ...entries.value,
      [key]: { buckets: null, total: null, intervalSecs: null, loading: true },
    };
    let entry: PatternVolumeEntry;
    try {
      const result = await fetchPatternVolume(pattern, c);
      const buckets = result?.buckets ?? null;
      const total = buckets && buckets.length ? buckets.reduce((sum, v) => sum + v, 0) : null;
      entry = {
        buckets,
        total,
        intervalSecs: result?.intervalSecs ?? null,
        loading: false,
      };
    } catch {
      entry = { buckets: [], total: null, intervalSecs: null, loading: false };
    }
    if (token !== generation) return;
    entries.value = { ...entries.value, [key]: entry };
  };

  const get = (pattern: any): PatternVolumeEntry | undefined =>
    entries.value[patternVolumeKey(pattern)];

  return { entries, request, get };
}

export const PATTERN_VOLUME_CACHE = Symbol("pattern-volume-cache");

export interface PatternVolumeCache {
  request: (pattern: any) => Promise<void>;
  get: (pattern: any) => PatternVolumeEntry | undefined;
}

/**
 * Total events in the query window, for turning a pattern's share of the
 * extraction sample into a real-world magnitude.
 *
 * One aggregate query — NOT the sum of per-pattern volumes. Those come from
 * `match_all()` on a template's constant text, which matches a superset of the
 * pattern's own logs and can be identical for two different patterns (the
 * constants of `... from web` and `... from api` both reduce to the shared
 * prefix), so summing them double-counts and can exceed the true total.
 */
export async function fetchWindowTotal(ctx: PatternVolumeContext): Promise<number | null> {
  const baseWhere = await resolveBaseFilter(ctx.baseSql);
  // Can't reproduce the extraction's filter → no total, so the chips fall back
  // to sample counts instead of being scaled against the wrong population.
  if (baseWhere === null) return null;
  const sql =
    `SELECT count(*) AS zo_cnt FROM "${ctx.streamName}"` + (baseWhere ? ` WHERE ${baseWhere}` : "");
  try {
    const response: any = await searchService.search(volumeSearchPayload(ctx, sql, 1), "ui");
    const value = Number(response?.data?.hits?.[0]?.zo_cnt);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
