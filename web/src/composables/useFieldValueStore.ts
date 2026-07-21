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

// Max unique values stored per field in IDB. Overridable via .env.
const MAX_VALUES_PER_FIELD = Number(
  (import.meta as any).env?.VITE_MAX_FIELD_VALUES ?? 50,
);

// Total IDB record cap across all orgs/streams/fields combined. Prevents the
// browser's IndexedDB storage from growing forever. Overridable via .env.
const MAX_FIELDS_STORED = Number(
  (import.meta as any).env?.VITE_MAX_FIELDS_STORED ?? 5000,
);

// How long a field's values stay valid in IDB after the last write.
// Sliding window — every new write resets the clock. Overridable via .env (unit: days).
const FIELD_VALUE_TTL_MS =
  Number((import.meta as any).env?.VITE_FIELD_VALUE_TTL_DAYS ?? 7) *
  86400 *
  1000;

// ─── In-memory read cache ─────────────────────────────────────────────────────

// Two-level cache: memory → IDB → []. Spares repeated keystrokes an async IDB
// read; only the first read in each TTL window hits IDB.
const readCache = new Map<string, { values: string[]; ts: number }>();
const READ_CACHE_TTL_MS = 60_000; // 1 minute
const READ_CACHE_MAX_ENTRIES = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamContext {
  org: string;
  streamType: string; // 'logs' | 'metrics' | 'traces'
  streamName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Composite string key used as the IDB primary key.
// Format: "org|streamType|streamName|fieldName"
// The "|" separator is safe because org/stream names in OO cannot contain "|".
const makeKey = (ctx: StreamContext, fieldName: string): string =>
  `${ctx.org}|${ctx.streamType}|${ctx.streamName}|${fieldName}`;

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
