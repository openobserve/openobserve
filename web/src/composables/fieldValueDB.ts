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
 * Low-level IndexedDB operations for field value storage.
 * All methods are async and non-blocking to the caller.
 *
 * DB layout:
 *   Database : o2FieldValues  (version 1)
 *   Store    : fieldValues
 *   PK       : key  — composite string "org|streamType|streamName|fieldName"
 *   Index 1  : by_expires (expiresAt)  — used by evictExpired for TTL sweeps
 *   Index 2  : by_updated (updatedAt)  — used by trimToMaxFields to evict LRU
 *
 * Two indexes because the orderings differ: by expiry time (TTL) vs by
 * last-used time (LRU).
 */

const DB_NAME = "o2FieldValues";
const DB_VERSION = 1;
const STORE_NAME = "fieldValues";

export interface FieldValueRecord {
  key: string; // PK — composite key "org|streamType|streamName|fieldName"
  values: string[]; // unique, deduplicated; capped at MAX_VALUES_PER_FIELD
  updatedAt: number; // Unix ms — last write timestamp; used for LRU eviction
  expiresAt: number; // Unix ms — sliding TTL, reset on every write
  // "mixed" means values came from both sources at different points in time.
  // Used for debugging only — lets you see in DevTools where values originated.
  source: "values_api" | "search_hits" | "mixed";
}

// Cached IDB connection — opened once and reused across all calls.
// null means not yet opened (or was closed and needs to be reopened).
let _db: IDBDatabase | null = null;

/**
 * Opens the database lazily — returns the cached connection on subsequent calls.
 * Lazy open avoids the ~5–10ms IDB open cost for users who never trigger
 * autocomplete; the cached connection is reused so all operations share one
 * transaction queue.
 *
 * onclose / onversionchange: if another tab opens a newer DB version, the
 * browser closes existing connections — we null out _db so the next openDB()
 * reopens cleanly.
 */
export const openDB = (): Promise<IDBDatabase> => {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        // by_expires: IDBKeyRange.upperBound(now) range scan in evictExpired
        store.createIndex("by_expires", "expiresAt", { unique: false });
        // by_updated: ascending cursor in trimToMaxFields (oldest first)
        store.createIndex("by_updated", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // Reset the cached reference if the browser closes the connection
      // (e.g. another tab opens a newer DB version triggering a versionchange).
      _db.onclose = () => {
        _db = null;
      };
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db!);
    };
    req.onerror = () => reject(req.error);
  });
};

/**
 * Merge new values into an existing record for a single field.
 * Used by captureFromValuesApi (Values API path — one field at a time).
 *
 * Merge strategy:
 *   existing values + incoming values → deduplicate via Set → cap to maxValues,
 *   keeping the LAST maxValues (freshest).
 *
 * Sliding TTL: expiresAt is reset on every write, so frequently-queried fields
 * stay fresh and streams you stop using expire naturally after the TTL.
 *
 * `source` ("values_api" | "search_hits" | "mixed") is tracked for debugging only.
 */
export const mergeValues = async (
  key: string,
  incoming: string[],
  source: FieldValueRecord["source"],
  maxValues: number,
  ttlMs: number,
): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const existing: FieldValueRecord | undefined = getReq.result;
      // Combine existing + incoming into a Set for automatic deduplication.
      const valueSet = new Set(existing?.values ?? []);
      for (const v of incoming) valueSet.add(String(v));
      const merged = Array.from(valueSet);
      // Keep the last maxValues entries (most recently added, at the array's end).
      const values = merged.length > maxValues ? merged.slice(merged.length - maxValues) : merged;
      const now = Date.now();
      const record: FieldValueRecord = {
        key,
        values,
        updatedAt: now,
        expiresAt: now + ttlMs, // sliding window — reset on every write
        source: existing
          ? existing.source === source
            ? source // same source as before — keep it
            : "mixed" // different source — mark as mixed
          : source, // first write — use the incoming source
      };
      store.put(record);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Merge values for multiple fields in a single IDB transaction.
 * Used by captureFromSearchHits — the hot path after every Run Query.
 *
 * One transaction instead of N mergeValues calls: IDB transactions have a fixed
 * per-tx cost, so batching 40 fields into one tx is ~40× cheaper than 40 txs.
 * Per-field merge logic is identical to mergeValues.
 */
export const mergeMultipleValues = async (
  entries: Array<{
    key: string;
    values: string[];
    source: FieldValueRecord["source"];
  }>,
  maxValues: number,
  ttlMs: number,
): Promise<void> => {
  if (entries.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();

    for (const { key, values: incoming, source } of entries) {
      const getReq = store.get(key);
      getReq.onsuccess = () => {
        const existing: FieldValueRecord | undefined = getReq.result;
        const valueSet = new Set(existing?.values ?? []);
        for (const v of incoming) valueSet.add(String(v));
        const merged = Array.from(valueSet);
        const values = merged.length > maxValues ? merged.slice(merged.length - maxValues) : merged;
        const record: FieldValueRecord = {
          key,
          values,
          updatedAt: now,
          expiresAt: now + ttlMs,
          source: existing ? (existing.source === source ? source : "mixed") : source,
        };
        store.put(record);
      };
    }

    // Resolves once every field's get+put has completed — the full batch is written.
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Fast point-read for a single field's values.
 * Returns empty array if record is missing or expired.
 *
 * Checks expiresAt at read time (not just via evictExpired, which runs on ~5%
 * of searches) so an expired-but-not-yet-swept record never serves stale values.
 */
export const getValues = async (key: string): Promise<string[]> => {
  let db: IDBDatabase;
  try {
    db = await openDB();
  } catch {
    // IDB unavailable (private browsing, unsupported browser, quota) — return
    // empty array so autocomplete silently degrades rather than throwing.
    return [];
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      const record = req.result as FieldValueRecord | undefined;
      if (!record) {
        resolve([]);
        return;
      }
      // Check TTL at read time — don't serve expired data even if evictExpired
      // hasn't swept this record yet.
      if (record.expiresAt < Date.now()) {
        resolve([]);
        return;
      }
      resolve(record.values);
    };
    req.onerror = () => resolve([]); // never throw — autocomplete is non-critical
  });
};

/**
 * Evict all records whose expiresAt < now (TTL cleanup).
 * Called opportunistically on ~5% of searches to amortize the scan cost.
 *
 * Uses the by_expires index so the cursor reads ONLY expired records —
 * O(expired), not O(total). Opportunistic rather than every-search because the
 * scan costs ~5–10ms even when nothing has expired.
 */
export const evictExpired = async (): Promise<number> => {
  const db = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const index = tx.objectStore(STORE_NAME).index("by_expires");
    // upperBound(now, true) = expiresAt < now (exclusive upper bound)
    const range = IDBKeyRange.upperBound(now, true);
    let deleted = 0;
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        deleted++;
        cursor.continue(); // advance to next expired record
      } else {
        resolve(deleted); // cursor exhausted — done
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Trim total record count to maxFields — evict least-recently-used fields first.
 * Called opportunistically alongside evictExpired (~5% of searches).
 *
 * Trims by updatedAt (oldest first): the least-recently-queried fields are least
 * useful in autocomplete. A last-resort guard against unbounded growth in edge
 * cases (many orgs/streams, very long sessions).
 */
export const trimToMaxFields = async (maxFields: number): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const total = countReq.result;
      if (total <= maxFields) {
        // Already under the cap — nothing to do
        resolve();
        return;
      }
      const toDelete = total - maxFields;
      // by_updated cursor starts from the smallest updatedAt (least recently used)
      const index = store.index("by_updated");
      let deleted = 0;
      index.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && deleted < toDelete) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(); // deleted enough or ran out of records
        }
      };
    };
  });
};
