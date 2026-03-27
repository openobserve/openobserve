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
 * Composable that orchestrates field value capture from both data sources:
 *   1. Values API — field expansion in FieldList
 *   2. Search result hits — Run Query results
 *
 * All IndexedDB writes are scheduled via requestIdleCallback so they have
 * zero impact on main-thread rendering. Reads use an in-memory cache
 * (1-minute TTL, 500-entry cap) so repeated keystrokes never hit IndexedDB.
 */

import * as fieldValueDB from "@/composables/fieldValueDB";
import { extractValuesFromHits } from "@/utils/fieldValueUtils";

// ─── Configuration ────────────────────────────────────────────────────────────

// Max unique values stored per field in IDB. 50 is enough for all realistic
// observability filter fields (status codes, env names, log levels). More than
// 50 items in a dropdown is noise rather than help. Overridable via .env so
// team can tune without a code change.
const MAX_VALUES_PER_FIELD = Number(
  (import.meta as any).env?.VITE_MAX_FIELD_VALUES ?? 50,
);

// Total IDB record cap across all orgs/streams/fields combined. Prevents the
// browser's IndexedDB storage from growing forever across many sessions.
// 5000 records × ~50 values × ~20 chars avg ≈ ~5MB — well within browser limits.
// Overridable via .env.
const MAX_FIELDS_STORED = Number(
  (import.meta as any).env?.VITE_MAX_FIELDS_STORED ?? 5000,
);

// How long a field's values stay valid in IDB after the last write.
// Sliding window — every new write resets the 7-day clock. Fields from streams
// you stop querying disappear automatically after 7 days of inactivity.
// Overridable via .env (unit: days).
const FIELD_VALUE_TTL_MS =
  Number((import.meta as any).env?.VITE_FIELD_VALUE_TTL_DAYS ?? 7) *
  86400 *
  1000;

// ─── In-memory read cache ─────────────────────────────────────────────────────

// Two-level cache: memory → IDB → [].
// Without this, every keystroke in the query editor (e.g. "status = ") would
// trigger an async IDB read (~1ms). With it, the first keystroke pays the IDB
// cost; all subsequent keystrokes in the same minute return from memory in ~0ms.
const readCache = new Map<string, { values: string[]; ts: number }>();
const READ_CACHE_TTL_MS = 60_000; // 1 minute — balance between freshness and cost
const READ_CACHE_MAX_ENTRIES = 500; // ~10 streams × ~50 fields each; enough for any session

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamContext {
  org: string;
  streamType: string; // 'logs' | 'metrics' | 'traces'
  streamName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Composite string key used as the IDB primary key.
// Format: "org|streamType|streamName|fieldName"
// e.g.  : "myorg|logs|http_logs|status"
//
// Why a flat string instead of a compound key?
// IDB compound keys require an array and more complex range queries.
// A flat string is simpler, human-readable in DevTools, and works perfectly
// for our point-read access pattern. The "|" separator is safe because
// org/stream names in OO cannot contain "|".
const makeKey = (ctx: StreamContext, fieldName: string): string =>
  `${ctx.org}|${ctx.streamType}|${ctx.streamName}|${fieldName}`;

/**
 * Schedule a background write using requestIdleCallback.
 * Falls back to setTimeout(0) in environments without rIC (e.g. Safari).
 *
 * Why this wrapper exists:
 * - requestIdleCallback runs the work AFTER the browser has finished rendering
 *   the current frame — zero impact on the search results appearing on screen.
 * - timeout: 2000 is a safety valve: if the browser stays busy for 2 full
 *   seconds without an idle slot, the write is forced anyway so data is never
 *   permanently lost.
 * - Safari does not support requestIdleCallback. setTimeout(0) is the next
 *   best thing — it defers to the next event loop tick, which still avoids
 *   blocking the current render cycle.
 * - The .catch() wrapper ensures IDB failures (private browsing, quota
 *   exceeded, IDB unavailable) never crash the app. Autocomplete is a
 *   nice-to-have, not a critical feature. Errors are logged in dev only.
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
 * Write to the in-memory read cache with a bounded size.
 *
 * Why evict 10% at a time instead of 1 entry?
 * Evicting a single entry on every insert-at-cap means paying the eviction
 * cost on every new entry once the map is full. Evicting 10% (50 entries) at
 * once amortizes that cost — we only pay it once every 50 inserts.
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
 * Called from useFieldValuesStream.handleResponse() AFTER the existing UI
 * state update — returns synchronously in ~1µs.
 *
 * Why 200-char filter here (vs 150 in extractValuesFromHits)?
 * The Values API returns pre-selected top values from the server — they have
 * already been ranked and filtered for relevance. The 200-char limit is just
 * a safety net against malformed responses. We don't need the aggressive
 * filtering used for raw log hits where any field can appear.
 *
 * Why delete readCache after write?
 * If the user had already triggered autocomplete for this field (cache was
 * populated), the write would update IDB but the stale cache entry would be
 * returned for the next 60 seconds. Deleting it forces a fresh IDB read the
 * next time the user types, ensuring they see the newly captured values.
 */
export const captureFromValuesApi = (
  ctx: StreamContext,
  fieldName: string,
  entries: Array<{ key: string }>,
): void => {
  const values = entries
    .map((e) => String(e.key))
    .filter((v) => v.length > 0 && v.length <= 200);

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
 * Why hits.slice(0, 100) even though the logs page already caps at 100?
 * Defensive programming — this function is a public export and could be called
 * by future code that passes a larger array. The slice keeps the contract clear.
 *
 * Why one mergeMultipleValues call instead of N mergeValues calls?
 * Each IDB transaction has a fixed overhead (open, commit, IDB lock). If a
 * stream has 40 fields, 40 individual transactions = 40× that overhead.
 * One transaction with 40 operations = 1× overhead. Substantially cheaper
 * for wide schemas.
 *
 * Why 5% chance for housekeeping (evictExpired + trimToMaxFields)?
 * evictExpired scans the entire IDB by_expires index — on 5000 records that
 * takes 10–20ms even in an idle callback. Running it on every search wastes
 * that time when 99% of searches produce no newly expired records.
 * 1-in-20 gives periodic cleanup with 1/20th the cumulative cost.
 */
export const captureFromSearchHits = (
  ctx: StreamContext,
  hits: Record<string, any>[],
  schemaFields: string[],
): void => {
  // Early return avoids scheduling a no-op idle callback
  if (!hits || hits.length === 0) return;

  scheduleWrite(async () => {
    const extracted = extractValuesFromHits(
      hits.slice(0, 100),
      schemaFields,
      MAX_VALUES_PER_FIELD,
    );

    const entries = Object.entries(extracted).map(([field, values]) => ({
      key: makeKey(ctx, field),
      values,
      source: "search_hits" as const,
    }));

    if (entries.length === 0) return;

    // Single transaction for all fields — N times cheaper than Promise.all(N writes)
    await fieldValueDB.mergeMultipleValues(
      entries,
      MAX_VALUES_PER_FIELD,
      FIELD_VALUE_TTL_MS,
    );

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
 * round-trips during typing. Never throws — returns empty array on any failure.
 *
 * Why return [] on error instead of propagating?
 * IDB can be unavailable in private browsing mode or certain enterprise
 * browser configurations. Users in those environments should still be able to
 * use the query editor — they just won't see value suggestions. Crashing or
 * showing an error for a non-critical enhancement would be a worse experience.
 *
 * Why check Date.now() - cached.ts < TTL instead of storing expiresAt?
 * Minor: computing expiresAt = Date.now() + TTL at write time and comparing
 * at read time is equivalent. The ts approach is slightly more readable
 * because the TTL constant appears only in one place (READ_CACHE_TTL_MS).
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
