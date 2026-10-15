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

/**
 * Persisted field VALUES, for autocomplete. Not a composable — plain functions
 * over IndexedDB, which is why it carries no `use` prefix and sits beside
 * fieldValueDB.ts. (It was `useFieldValueStore`, one character from the real
 * composable `useFieldValuesStream`, and the two were mistaken for each other.)
 *
 * THE ONLY TWO WRITERS, and neither is tied to a stream type:
 *   1. captureFromValuesApi   — expanding a field in the sidebar. Reached from
 *      logs, traces and pipeline, via useFieldValuesStream.
 *   2. captureFromSearchHits  — Run Query results. Its one caller lives under
 *      composables/useLogs/, which is the Logs PAGE, not the logs stream TYPE:
 *      it captures under whichever type was searched, and that page's stream
 *      selector covers metrics and traces too.
 *
 * So the rule is "values come from what has been SEARCHED or EXPANDED", never
 * "values are logs-only". A stream nobody has looked at yet simply has none;
 * that is a cold cache, not a missing capability.
 *
 * All IndexedDB writes are scheduled via requestIdleCallback so they have
 * zero impact on main-thread rendering. Reads use an in-memory cache
 * (1-minute TTL, 500-entry cap) so repeated keystrokes never hit IndexedDB.
 */

import * as fieldValueDB from "@/composables/fieldValueDB";
import streamService from "@/services/stream";
import { extractValuesFromHits } from "@/utils/fieldValueUtils";

// ─── Configuration ────────────────────────────────────────────────────────────

// Max unique values stored per field in IDB. Overridable via .env.
const MAX_VALUES_PER_FIELD = Number((import.meta as any).env?.VITE_MAX_FIELD_VALUES ?? 50);

// Total IDB record cap across all orgs/streams/fields combined. Prevents the
// browser's IndexedDB storage from growing forever. Overridable via .env.
const MAX_FIELDS_STORED = Number((import.meta as any).env?.VITE_MAX_FIELDS_STORED ?? 5000);

// How far back to look when asking the server for values a cold cache has never
// seen. Recent values are the useful ones for completion, and a narrow window
// keeps the scan small.
export const FIELD_VALUES_LOOKBACK_MINUTES = 15;
const VALUES_LOOKBACK_MS = FIELD_VALUES_LOOKBACK_MINUTES * 60 * 1000;

// How many values one request asks for. A dropdown shows a handful; the
// endpoint charges for the rest.
const VALUES_REQUEST_SIZE = 10;
// An answer this long may have been cut short by the server.
export const FIELD_VALUES_REQUEST_SIZE = VALUES_REQUEST_SIZE;

// How long to wait for the endpoint before giving up. services/http.ts has its
// axios timeout commented out, so nothing upstream ends a stalled request.
const VALUES_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RANGE_REQUEST_TIMEOUT_MS = 30_000;
const MICROS_PER_DAY = 86_400_000_000;

// How long to wait before asking again about a field that answered with nothing
// — or whose request failed. NOT permanent: a transient 500, or one quiet
// fifteen-minute window, must not disable a field's values for the session.
const VALUES_RETRY_COOLDOWN_MS = 60_000;

// How long a field's values stay valid in IDB after the last write.
// Sliding window — every new write resets the clock. Overridable via .env (unit: days).
const FIELD_VALUE_TTL_MS =
  Number((import.meta as any).env?.VITE_FIELD_VALUE_TTL_DAYS ?? 7) * 86400 * 1000;

// ─── In-memory read cache ─────────────────────────────────────────────────────

// Two-level cache: memory → IDB → []. Spares repeated keystrokes an async IDB
// read; only the first read in each TTL window hits IDB.
const readCache = new Map<string, { values: string[]; ts: number }>();
const READ_CACHE_TTL_MS = 60_000; // 1 minute
const READ_CACHE_MAX_ENTRIES = 500;

/**
 * Called from the org-switch and logout purge paths. The IDB layer is purged
 * there too; without this, a user signing out and back in within the TTL could
 * be offered the previous user's captured values on an RBAC-restricted stream.
 */
export const clearReadCache = (): void => {
  readCache.clear();
  recentAnswers.clear();
  slowAnswers.clear();
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamContext {
  org: string;
  /**
   * Whichever type the caller searched or expanded — all three are stored and
   * read back the same way. Part of the key, never a filter on what may be
   * captured.
   */
  streamType: "logs" | "metrics" | "traces" | (string & {});
  streamName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Composite string key used as the IDB primary key.
// Format: "org|streamType|streamName|fieldName"
// The "|" separator is safe because org/stream names in OO cannot contain "|".
const makeKey = (ctx: StreamContext, fieldName: string): string =>
  `${ctx.org}|${ctx.streamType}|${ctx.streamName}|${fieldName}`;

// Server answers are cached per window, so values from different time ranges never mix.
const makeLookupKey = (ctx: StreamContext, fieldName: string, range?: FieldValuesTimeRange) =>
  range
    ? `${makeKey(ctx, fieldName)}|${range.startTime}-${range.endTime}`
    : makeKey(ctx, fieldName);

const KEYWORD_MARK = "|k:";

// The server matches a keyword case-insensitively, so the cache does too.
const withKeyword = (lookupKey: string, keyword?: string) =>
  keyword ? `${lookupKey}${KEYWORD_MARK}${keyword.toLowerCase()}` : lookupKey;

/**
 * Schedule a background write using requestIdleCallback.
 * Falls back to setTimeout(0) in environments without rIC (e.g. Safari).
 *
 * `timeout: 2000` forces the write even if the browser never goes idle, so data
 * is never lost. The .catch() keeps IDB failures (private browsing, quota) from
 * crashing the app — autocomplete is non-critical; errors are logged in dev only.
 */
const scheduleWrite = (fn: () => Promise<void>): void => {
  const wrapped = () =>
    fn().catch((err) => {
      if (import.meta.env.DEV) {
        console.debug("[fieldValueStore] write error:", err);
      }
    });

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(wrapped, { timeout: 2000 });
  } else {
    setTimeout(wrapped, 0);
  }
};

/**
 * Write to the in-memory read cache with a bounded size. Evicts 10% at a time
 * once full so eviction cost is amortized rather than paid on every insert.
 */
const setCacheEntry = (key: string, values: string[]): void => {
  readCache.set(key, { values, ts: Date.now() });
  if (readCache.size > READ_CACHE_MAX_ENTRIES) {
    const evict = Math.ceil(READ_CACHE_MAX_ENTRIES * 0.1);
    const iter = readCache.keys();
    for (let i = 0; i < evict; i++) {
      const { value, done } = iter.next();
      if (done) break;
      readCache.delete(value);
    }
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture values returned by the Values API (field expansion in FieldList).
 * Called from useFieldValuesStream.handleResponse() after the existing UI update.
 *
 * The 200-char filter is just a safety net against malformed responses (the
 * server has already ranked/filtered these values). readCache is deleted after
 * the write so the next autocomplete read returns the freshly captured values
 * instead of a stale cache entry.
 */
export const captureFromValuesApi = (
  ctx: StreamContext,
  fieldName: string,
  entries: Array<{ key: string }>,
): void => {
  const values = entries.map((e) => String(e.key)).filter((v) => v.length > 0 && v.length <= 200);

  if (values.length === 0) return;

  const key = makeKey(ctx, fieldName);
  scheduleWrite(async () => {
    await fieldValueDB.mergeValues(
      key,
      values,
      "values_api",
      MAX_VALUES_PER_FIELD,
      FIELD_VALUE_TTL_MS,
    );
    readCache.delete(key);
  });
};

/**
 * Capture field values from search result hits.
 * Called from useStreamFields.updateFieldValues() after existing UI update.
 * Limits to first 100 hits; skips high-cardinality and excluded fields.
 * Uses a single IDB transaction for all fields to minimise transaction overhead.
 *
 * Housekeeping (evictExpired + trimToMaxFields) runs on a 5% chance per capture
 * because evictExpired scans the whole by_expires index (~10–20ms on 5000
 * records) — too costly to run on every search.
 */
export const captureFromSearchHits = (
  ctx: StreamContext,
  hits: Record<string, any>[],
  schemaFields: string[],
): void => {
  // Early return avoids scheduling a no-op idle callback
  if (!hits || hits.length === 0) return;

  scheduleWrite(async () => {
    const extracted = extractValuesFromHits(hits.slice(0, 100), schemaFields, MAX_VALUES_PER_FIELD);

    const entries = Object.entries(extracted).map(([field, values]) => ({
      key: makeKey(ctx, field),
      values,
      source: "search_hits" as const,
    }));

    if (entries.length === 0) return;

    // Single transaction for all fields — N times cheaper than Promise.all(N writes)
    await fieldValueDB.mergeMultipleValues(entries, MAX_VALUES_PER_FIELD, FIELD_VALUE_TTL_MS);

    // Invalidate read-cache for written keys so the next autocomplete read
    // returns fresh values instead of the pre-write stale cache entry
    for (const { key } of entries) readCache.delete(key);

    // Opportunistically sweep — 5% chance per capture so cost is amortized
    if (Math.random() < 0.05) {
      await fieldValueDB.evictExpired();
      await fieldValueDB.trimToMaxFields(MAX_FIELDS_STORED);
    }
  });
};

/**
 * Read stored values for a field — used by autocomplete suggestion provider.
 * Uses in-memory cache (1-minute TTL, 500-entry cap) to avoid IndexedDB
 * round-trips during typing. Never throws — returns empty array on any failure
 * (IDB can be unavailable in private browsing; suggestions are non-critical).
 */
export const getFieldValuesForSuggestion = async (
  ctx: StreamContext,
  fieldName: string,
): Promise<string[]> => {
  const key = makeKey(ctx, fieldName);
  const cached = readCache.get(key);
  if (cached) {
    if (Date.now() - cached.ts < READ_CACHE_TTL_MS) {
      return cached.values;
    }
    // Expired — remove so we don't leak memory
    readCache.delete(key);
  }
  try {
    const values = await fieldValueDB.getValues(key);
    setCacheEntry(key, values);
    return values;
  } catch {
    return [];
  }
};

// ─── On-demand fetch ─────────────────────────────────────────────────────────

// Shared at module scope on purpose: every editor on the page asks the same
// questions, and the point of both maps is that the second asker pays nothing.
const inFlightRequests = new Map<string, Promise<string[]>>();
const suppressedUntil = new Map<string, number>();
const failedKeys = new Set<string>();
const recentAnswers = new Map<string, { values: string[]; ts: number }>();
const slowAnswers = new Map<string, Promise<string[]>>();

const rememberAnswer = (key: string, values: string[]): void => {
  recentAnswers.delete(key);
  recentAnswers.set(key, { values, ts: Date.now() });
  if (recentAnswers.size > READ_CACHE_MAX_ENTRIES) {
    recentAnswers.delete(recentAnswers.keys().next().value as string);
  }
};

const NO_VALUE_LOOKUP = "NoValueLookup";

/** Rejects a lookup that never ran, e.g. before the stream is known, so the editor never claims there are no values. */
export const noValueLookup = (): Error =>
  Object.assign(new Error("no field value lookup ran"), { name: NO_VALUE_LOOKUP });

export const isNoValueLookup = (error: unknown): boolean =>
  (error as Error | undefined)?.name === NO_VALUE_LOOKUP;

/** True while the last server lookup for this field failed, so "no values" would be a lie. */
export const fieldValuesUnavailable = (
  ctx: StreamContext,
  fieldName: string,
  timeRange?: FieldValuesTimeRange | null,
): boolean => failedKeys.has(makeLookupKey(ctx, fieldName, timeRange ?? undefined));

/**
 * Ask the server for a field's recent values, and leave them in the cache.
 *
 * Both capture paths are byproducts of something the user already did — a Run
 * Query, or expanding a field in the sidebar — so a stream nobody has touched
 * has no values at all and the editor quietly offers the field list instead.
 * This is the path for that case.
 *
 * Writes through captureFromValuesApi rather than to IndexedDB directly,
 * because that is what invalidates the read cache: the caller has just read
 * this key and primed it with an EMPTY list, and without invalidation the next
 * keystroke would still see nothing for a minute.
 *
 * Never throws; the editor races it against a wait budget and a late answer still fills the cache.
 */
export interface FieldValuesTimeRange {
  /** Microseconds. */
  startTime: number;
  /** Microseconds. */
  endTime: number;
}

export interface ValueLookupOptions {
  /** Called only when this call went to the server, so cache hits never skew the fetch-time median. */
  onFetched?: (ms: number) => void;
  /** Replaces the fifteen-minute lookback; its answers stay out of the persisted store. */
  timeRange?: FieldValuesTimeRange;
  /** Case-insensitive substring the server filters by; its answers stay out of the persisted store. */
  keyword?: string;
  /** What the user typed inside the value's quote, so the resolver can ask past the top values. */
  prefix?: string;
}

// The read cache is filled synchronously so the next keystroke is local; IndexedDB persistence can wait.
const storeAnswer = (
  ctx: StreamContext,
  fieldName: string,
  key: string,
  values: string[],
  transient: boolean,
): void => {
  if (!values.length) {
    suppressedUntil.set(key, Date.now() + VALUES_RETRY_COOLDOWN_MS);
    return;
  }
  suppressedUntil.delete(key);
  rememberAnswer(key, values);
  if (transient) return;
  setCacheEntry(key, values);
  captureFromValuesApi(
    ctx,
    fieldName,
    values.map((value) => ({ key: value })),
  );
};

// Lets a caller keep waiting on a request that outlived its timeout, until a ceiling calls it failed.
const trackSlowAnswer = (key: string, answer: Promise<string[]>): void => {
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<string[]>((resolve) => {
    ceiling = setTimeout(() => {
      failedKeys.add(key);
      resolve([]);
    }, VALUES_RETRY_COOLDOWN_MS);
  });
  const slow: Promise<string[]> = Promise.race([answer, stalled]).finally(() => {
    clearTimeout(ceiling);
    if (slowAnswers.get(key) === slow) slowAnswers.delete(key);
  });
  slowAnswers.set(key, slow);
};

// A seven-day lookup measured 10.3-14.3 s on a busy stream; one more second per day of range covers it with margin, capped so nothing waits forever.
const valuesRequestTimeoutMs = (range?: FieldValuesTimeRange): number => {
  if (!range) return VALUES_REQUEST_TIMEOUT_MS;
  const days = (range.endTime - range.startTime) / MICROS_PER_DAY;
  return Math.min(MAX_RANGE_REQUEST_TIMEOUT_MS, VALUES_REQUEST_TIMEOUT_MS + days * 1000);
};

/** The request still running after its caller's timeout, so an empty answer is not mistaken for "no values". */
export const pendingFieldValues = (
  ctx: StreamContext,
  fieldName: string,
  options: Pick<ValueLookupOptions, "timeRange" | "keyword"> = {},
): Promise<string[]> | null =>
  slowAnswers.get(
    withKeyword(
      makeLookupKey(ctx, fieldName, options.timeRange),
      options.keyword?.trim() || undefined,
    ),
  ) ?? null;

export const requestFieldValues = async (
  ctx: StreamContext,
  fieldName: string,
  options: ValueLookupOptions = {},
): Promise<string[]> => {
  if (!fieldName || !ctx.org || !ctx.streamType || !ctx.streamName) return [];

  const range = options.timeRange;
  const keyword = options.keyword?.trim() || undefined;
  const key = withKeyword(makeLookupKey(ctx, fieldName, range), keyword);

  const recent = recentAnswers.get(key);
  if (recent && Date.now() - recent.ts < READ_CACHE_TTL_MS) return recent.values;

  const until = suppressedUntil.get(key);
  if (until !== undefined && Date.now() < until) return [];

  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const endMicros = range?.endTime ?? Date.now() * 1000;
  const startMicros = range?.startTime ?? endMicros - VALUES_LOOKBACK_MS * 1000;
  const started = Date.now();

  // Settles on its own even after the caller stopped waiting, so a slow answer still reaches the cache.
  const answer = streamService
    .fieldValues({
      org_identifier: ctx.org,
      stream_name: ctx.streamName,
      fields: [fieldName],
      size: VALUES_REQUEST_SIZE,
      start_time: startMicros,
      end_time: endMicros,
      // Without this a metrics or traces stream is read as logs, and
      // answers with nothing.
      type: ctx.streamType,
      no_count: true,
      keyword,
    })
    .then(
      (response: any) => {
        const values: string[] = (response?.data?.hits?.[0]?.values ?? [])
          .map((entry: any) => String(entry?.zo_sql_key ?? ""))
          .filter((value: string) => value.length > 0);
        failedKeys.delete(key);
        options.onFetched?.(Date.now() - started);
        storeAnswer(ctx, fieldName, key, values, !!(range || keyword));
        return values;
      },
      () => {
        failedKeys.add(key);
        suppressedUntil.set(key, Date.now() + VALUES_RETRY_COOLDOWN_MS);
        return [] as string[];
      },
    );

  // The cleanup hangs off the RACE, because a request that never settles would never run its own.
  const request = (async (): Promise<string[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const giveUp = new Promise<string[]>((resolve) => {
      timer = setTimeout(() => {
        // Slow is not failed: no failure mark, and the cooldown only stops a second request piling on.
        suppressedUntil.set(key, Date.now() + VALUES_RETRY_COOLDOWN_MS);
        trackSlowAnswer(key, answer);
        resolve([]);
      }, valuesRequestTimeoutMs(range));
    });
    try {
      return await Promise.race([answer, giveUp]);
    } finally {
      clearTimeout(timer);
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, request);
  return request;
};

const keywordLanes = new Map<string, { busy: Promise<void> | null; newest: string }>();

// A complete answer for a shorter keyword already holds every value matching a longer one.
const coveredByCompleteAnswer = (lookupKey: string, keyword: string): string[] | null => {
  const wanted = keyword.toLowerCase();
  for (const [key, answer] of recentAnswers) {
    if (key !== lookupKey && !key.startsWith(lookupKey + KEYWORD_MARK)) continue;
    const shorter = key === lookupKey ? "" : key.slice(lookupKey.length + KEYWORD_MARK.length);
    const fresh = Date.now() - answer.ts < READ_CACHE_TTL_MS;
    if (fresh && wanted.includes(shorter) && answer.values.length < VALUES_REQUEST_SIZE) {
      return answer.values.filter((value) => value.toLowerCase().includes(wanted));
    }
  }
  return null;
};

/** Values matching a typed keyword, one request per field at a time; a newer keyword supersedes the waiting ones. */
export const requestFieldValuesMatching = async (
  ctx: StreamContext,
  fieldName: string,
  keyword: string,
  options: ValueLookupOptions = {},
): Promise<string[]> => {
  const wanted = keyword.trim();
  if (!wanted || !fieldName || !ctx.org || !ctx.streamType || !ctx.streamName) return [];

  const lookupKey = makeLookupKey(ctx, fieldName, options.timeRange);
  const lane = keywordLanes.get(lookupKey) ?? { busy: null, newest: "" };
  keywordLanes.set(lookupKey, lane);
  lane.newest = wanted;
  while (lane.busy) {
    await lane.busy;
    if (lane.newest !== wanted) return [];
  }

  const covered = coveredByCompleteAnswer(lookupKey, wanted);
  if (covered) return covered;

  const request = requestFieldValues(ctx, fieldName, { ...options, keyword: wanted });
  lane.busy = request.then(() => {
    lane.busy = null;
  });
  return request;
};
