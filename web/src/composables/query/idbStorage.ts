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
 * Shared IndexedDB key/value primitive for every heavy cache in the app
 * (query persister payloads, dashboard panel results, log field values).
 *
 * DB layout:
 *   Database : o2Cache (version 1)
 *   Store    : kv
 *   PK       : key       — caller-supplied composite string, org-scoped by convention
 *   Index 1  : by_expires (expiresAt) — TTL sweeps
 *   Index 2  : by_updated (updatedAt) — LRU trimming
 *
 * Two indexes because the orderings differ: expiry time (TTL) vs last-write
 * time (LRU). Values are written as-is so IndexedDB's structured clone does the
 * copying — never `JSON.parse(JSON.stringify(...))` on the main thread.
 */

import type { AsyncStorage } from "@tanstack/query-persist-client-core";

const DB_NAME = "o2Cache";
const DB_VERSION = 1;
const STORE_NAME = "kv";

const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_RECORDS = 500;

/**
 * Namespaces sharing this store. Keys are `<namespace>|<org>|<…parts>`, which
 * is what lets the org-switch purge find every consumer's records with one
 * prefix scan per namespace.
 */
export const PANEL_CACHE_NAMESPACE = "panel";
export const FIELD_VALUES_NAMESPACE = "fv";

export const CACHE_NAMESPACES = [PANEL_CACHE_NAMESPACE, FIELD_VALUES_NAMESPACE] as const;

export const orgScopedKey = (namespace: string, org: string, ...parts: string[]): string =>
  [namespace, org, ...parts].join("|");

export interface CacheRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number; // Unix ms — last write; drives LRU eviction
  expiresAt: number; // Unix ms — absolute TTL
}

// Cached connection — opened once, reused. null means "not open yet".
let _db: IDBDatabase | null = null;
let _openPromise: Promise<IDBDatabase> | null = null;

/** True when IndexedDB is usable (absent in jsdom and some private modes). */
export const isIdbAvailable = (): boolean => typeof indexedDB !== "undefined" && indexedDB !== null;

export const openCacheDB = (): Promise<IDBDatabase> => {
  if (_db) return Promise.resolve(_db);
  if (_openPromise) return _openPromise;
  if (!isIdbAvailable()) return Promise.reject(new Error("IndexedDB unavailable"));

  _openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("by_expires", "expiresAt", { unique: false });
        store.createIndex("by_updated", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      // Another tab opening a newer version closes this connection — drop the
      // cached reference so the next open reconnects cleanly.
      _db.onclose = () => {
        _db = null;
        _openPromise = null;
      };
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
        _openPromise = null;
      };
      resolve(_db);
    };
    req.onerror = () => {
      _openPromise = null;
      reject(req.error);
    };
  });
  return _openPromise;
};

/**
 * Run `fn` inside one transaction on the kv store and resolve when the whole
 * transaction commits. Exported so consumers that need read-modify-write in a
 * single transaction (field-value merges) can share the connection.
 */
export const withStore = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T,
): Promise<T> => {
  const db = await openCacheDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result: T;
    try {
      result = fn(tx.objectStore(STORE_NAME));
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

/**
 * Run a single IDB request and resolve on its own `onsuccess`. A one-request
 * transaction auto-commits, so waiting for `oncomplete` buys nothing and makes
 * the helper unusable against simpler IDB shims.
 */
const runRequest = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openCacheDB();
  const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return new Promise<T>((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/** Point read. Returns undefined when missing or expired. */
export const cacheGet = async <T>(key: string): Promise<T | undefined> => {
  try {
    const record = await runRequest<CacheRecord<T> | undefined>("readonly", (store) =>
      store.get(key),
    );
    // Checked at read time as well as by the sweeper, so an expired record is
    // never served just because the sweep has not run yet.
    if (!record || record.expiresAt < Date.now()) return undefined;
    return record.value;
  } catch {
    return undefined;
  }
};

/**
 * Like `cacheGet`, but returns the whole record (timestamps included) and lets
 * failures propagate — its callers own their error reporting.
 */
export const cacheGetRecord = async <T>(key: string): Promise<CacheRecord<T> | undefined> => {
  const record = await runRequest<CacheRecord<T> | undefined>("readonly", (store) =>
    store.get(key),
  );
  if (!record || record.expiresAt < Date.now()) return undefined;
  return record;
};

/** Write and let failures propagate — for callers that report their own errors. */
export const cacheSetOrThrow = async <T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> => {
  const now = Date.now();
  await runRequest("readwrite", (store) =>
    store.put({ key, value, updatedAt: now, expiresAt: now + ttlMs } as CacheRecord<T>),
  );
};

export const cacheSet = async <T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> => {
  try {
    await cacheSetOrThrow(key, value, ttlMs);
  } catch {
    // Caching is best-effort — a quota or private-mode failure must never
    // surface to the caller.
  }
};

export const cacheRemove = async (key: string): Promise<void> => {
  try {
    await runRequest("readwrite", (store) => store.delete(key));
  } catch {
    /* best-effort */
  }
};

export const cacheKeys = async (): Promise<string[]> => {
  try {
    return (await runRequest<IDBValidKey[]>("readonly", (store) => store.getAllKeys())).map(String);
  } catch {
    return [];
  }
};

export const cacheEntries = async <T>(): Promise<Array<[string, T]>> => {
  try {
    const all = await runRequest<CacheRecord<T>[]>("readonly", (store) => store.getAll());
    return all.map((r) => [r.key, r.value] as [string, T]);
  } catch {
    return [];
  }
};

/** Whole records, for the dashboard-cache debug helper. */
export const cacheAllRecords = async <T>(): Promise<CacheRecord<T>[]> => {
  try {
    return await runRequest<CacheRecord<T>[]>("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
};

/** Delete every record whose key starts with `prefix`. Used by the org purge. */
export const cacheRemoveByPrefix = async (prefix: string): Promise<number> => {
  try {
    const db = await openCacheDB();
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      // Bounded range scan rather than a full-store cursor: every key with the
      // prefix sorts between `prefix` and `prefix + ￿`.
      const range = IDBKeyRange.bound(prefix, prefix + "￿", false, false);
      let deleted = 0;
      const req = tx.objectStore(STORE_NAME).openCursor(range);
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else resolve(deleted);
      };
      req.onerror = () => resolve(deleted);
    });
  } catch {
    return 0;
  }
};

export const cacheClear = async (): Promise<void> => {
  try {
    await runRequest("readwrite", (store) => store.clear());
  } catch {
    /* best-effort */
  }
};

/** TTL sweep — O(expired) via the by_expires index, not O(total). */
export const cacheEvictExpired = async (): Promise<number> => {
  try {
    const db = await openCacheDB();
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const index = tx.objectStore(STORE_NAME).index("by_expires");
      const range = IDBKeyRange.upperBound(Date.now(), true);
      let deleted = 0;
      const req = index.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else resolve(deleted);
      };
      req.onerror = () => resolve(deleted);
    });
  } catch {
    return 0;
  }
};

/** LRU trim — evicts the least-recently-written records above `maxRecords`. */
export const cacheTrimToMax = async (maxRecords: number = DEFAULT_MAX_RECORDS): Promise<number> => {
  try {
    const db = await openCacheDB();
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      let deleted = 0;
      countReq.onsuccess = () => {
        const toDelete = countReq.result - maxRecords;
        if (toDelete <= 0) {
          resolve(0);
          return;
        }
        // by_updated ascends from the oldest write — exactly LRU order.
        const cursorReq = store.index("by_updated").openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor && deleted < toDelete) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else resolve(deleted);
        };
        cursorReq.onerror = () => resolve(deleted);
      };
      countReq.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
};

/**
 * Sweep expired entries then LRU-trim. Called opportunistically (not on every
 * write) because the scan costs a few ms even when nothing is evictable.
 */
export const cacheMaintain = async (maxRecords: number = DEFAULT_MAX_RECORDS): Promise<void> => {
  await cacheEvictExpired();
  await cacheTrimToMax(maxRecords);
};

/**
 * `AsyncStorage` adapter over the store above, for the TanStack query
 * persister. Typed with `TStorageValue = unknown` so the persister's
 * serialize/deserialize can be identity functions — values reach IndexedDB as
 * live objects and are structured-cloned instead of stringified.
 */
export const createIdbStorage = (
  opts: { ttlMs?: number; maxRecords?: number } = {},
): AsyncStorage<unknown> => {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS;
  let writesSinceSweep = 0;

  return {
    getItem: (key) => cacheGet<unknown>(key),
    setItem: async (key, value) => {
      await cacheSet(key, value, ttlMs);
      // Amortized maintenance: one sweep per 20 writes keeps the store bounded
      // without paying the scan on every panel result.
      if (++writesSinceSweep >= 20) {
        writesSinceSweep = 0;
        void cacheMaintain(maxRecords);
      }
    },
    removeItem: (key) => cacheRemove(key),
    entries: () => cacheEntries<unknown>(),
  };
};

export const idbStorage: AsyncStorage<unknown> = createIdbStorage();
