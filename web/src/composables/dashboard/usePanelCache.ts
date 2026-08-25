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
 * Per-panel result cache, on the app's query layer.
 *
 * The public API (`getPanelCache` / `savePanelCache`) is unchanged and so is the
 * behaviour: a panel restores its last result and fires no query. What moved is
 * where the result lives — from a private IndexedDB namespace with its own TTL
 * and LRU to a normal TanStack entry under `["org", <org>, "panels", …]`, held
 * in memory by the query cache and on disk by the same `indexedDbPersister`
 * every other heavy read uses.
 *
 * Three things follow from being on the query layer rather than beside it:
 *
 *  - the org-switch and logout purges already scan that key prefix, so panel
 *    results are dropped by the code that drops everything else instead of by
 *    the namespace sweep only this file knew about;
 *  - `gcTime` and the persister's `maxAge` replace the hand-rolled record cap
 *    and 24 h TTL;
 *  - a panel result is visible in the devtools next to the query that fetched
 *    the dashboard it belongs to.
 *
 * What deliberately did NOT move is the read path: `usePanelDataLoader` still
 * decides when to restore, and a restored panel still issues no request. Making
 * panels revalidate is a behaviour change, not a storage one.
 */

import { toRaw } from "vue";
import { hashKey } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { idbPersister, IDB_PREFIX } from "@/composables/query/persisters";
import {
  cacheAllRecords,
  cacheRemove,
  cacheRemoveByPrefix,
  cacheRemoveWhere,
} from "@/composables/query/idbStorage";
import { LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { panelKeys } from "./panel.querykeys";

/**
 * Strip Vue's reactive proxies so structured clone can take the value.
 *
 * `toRaw` only unwraps the level it is handed, and a panel's result arrives
 * several containers deep — every write used to throw `DataCloneError: [object
 * Array] could not be cloned` and the cache stayed empty. Recursion covers
 * arrays and plain objects only: a raw target holds its children raw, and
 * anything exotic (Date, TypedArray) already clones and would be rebuilt as a
 * bag of properties if walked.
 *
 * Still required on the query layer: the persister serializes with identity and
 * hands the value straight to IndexedDB.
 */
const toStorable = <T>(value: T, seen = new WeakMap<object, any>()): T => {
  if (value === null || typeof value !== "object") return value;

  const raw = toRaw(value as object);

  // Result sets repeat the same series object across partitions; without this
  // a shared child is copied once per reference.
  const hit = seen.get(raw);
  if (hit !== undefined) return hit;

  if (Array.isArray(raw)) {
    const out: any[] = [];
    seen.set(raw, out);
    for (let i = 0; i < raw.length; i++) out[i] = toStorable(raw[i], seen);
    return out as T;
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return raw as T;

  const out: Record<string, any> = {};
  seen.set(raw, out);
  for (const key of Object.keys(raw)) {
    const child = (raw as Record<string, any>)[key];
    // Functions are not cloneable and never carry panel state.
    if (typeof child === "function") continue;
    out[key] = toStorable(child, seen);
  }
  return out as T;
};

declare global {
  interface Window {
    _o2_removeDashboardCache: () => Promise<void>;
    _o2_getDashboardCache: () => Promise<any>;
  }
}

export interface PanelCacheEntry {
  key: any;
  value: any;
  cacheTimeRange: any;
  timestamp: number;
}

/**
 * Panel entries are written per partition by the SQL executor, so they are read
 * back far more often than they are fetched. `staleTime: Infinity` states what
 * the read path already does — a restored panel does not revalidate — rather
 * than leaving it to the client default that never applies here.
 */
const panelEntryOptions = {
  gcTime: LONG_GC_TIME,
  staleTime: Infinity,
  persister: idbPersister.persisterFn,
} as const;

const isPanelKey = (key: readonly unknown[]) => key[0] === "org" && key[2] === "panels";

// Matches the persisted form of every panel key, any org: the persister keys
// storage by the hashed array, so `"panels"` sits at the third position.
const PERSISTED_PANEL_KEY = /^\["org",("(?:[^"\\]|\\.)*"|null),"panels"/;

window._o2_removeDashboardCache = async (): Promise<void> => {
  try {
    const cache = queryClient.getQueryCache();
    cache
      .getAll()
      .filter((query) => isPanelKey(query.queryKey))
      .forEach((query) => cache.remove(query));
    // Entries that were only ever on disk have no in-memory query to walk, so
    // sweep the store by key shape — main's version cleared the whole store.
    await cacheRemoveWhere(
      (key) =>
        key.startsWith(`${IDB_PREFIX}-`) &&
        PERSISTED_PANEL_KEY.test(key.slice(IDB_PREFIX.length + 1)),
    );
  } catch (error) {
    console.error("Error clearing dashboard cache:", error);
  }
};

window._o2_getDashboardCache = async (): Promise<any> => {
  try {
    const cache: any = {};
    const put = (queryKey: readonly unknown[], entry: PanelCacheEntry | undefined) => {
      if (!entry) return;
      const [, , , folderId, dashboardId, panelId] = queryKey as any[];
      if (!cache[folderId]) cache[folderId] = {};
      if (!cache[folderId][dashboardId]) cache[folderId][dashboardId] = {};
      cache[folderId][dashboardId][panelId] = {
        key: entry.key,
        value: entry.value,
        cacheTimeRange: entry.cacheTimeRange,
        timestamp: entry.timestamp,
      };
    };

    // Disk first, then memory on top — main read the whole store, and entries
    // that were only ever persisted have no in-memory query to walk.
    for (const record of await cacheAllRecords<any>()) {
      const persisted = record.value;
      if (!Array.isArray(persisted?.queryKey) || !isPanelKey(persisted.queryKey)) continue;
      put(persisted.queryKey, persisted.state?.data as PanelCacheEntry | undefined);
    }
    queryClient
      .getQueryCache()
      .getAll()
      .forEach((query) => {
        if (!isPanelKey(query.queryKey)) return;
        put(query.queryKey, query.state.data as PanelCacheEntry | undefined);
      });
    return cache;
  } catch (error) {
    console.error("Error getting dashboard cache:", error);
    return {};
  }
};

/**
 * Use Panel Cache Data on a per dashboard basis in combination with folderid, dashboard id and panel id
 */
export const usePanelCache = (
  folderId: string,
  dashboardId: string,
  panelId: string,
  /** Scopes the cache key; two orgs can otherwise collide on a dashboard id. */
  org = "",
) => {
  if (!(folderId && dashboardId && panelId)) {
    const savePanelCache = async (_key: any, _data: any, _cacheTimeRange: any): Promise<void> => {
      // do nothing
    };

    const getPanelCache = async (_key?: any): Promise<null> => {
      return null;
    };

    return {
      savePanelCache,
      getPanelCache,
    };
  }

  const queryKey = panelKeys.result(org, folderId, dashboardId, panelId);

  const savePanelCache = async (key: any, data: any, cacheTimeRange: any): Promise<void> => {
    try {
      const entry = toStorable<PanelCacheEntry>({
        key,
        value: data,
        cacheTimeRange,
        timestamp: Date.now(),
      });

      // The entry has to exist as a real query before it can carry the persister
      // and a gcTime: `setQueryData` alone builds one with the client defaults,
      // which would collect a panel result on the app's ordinary schedule.
      queryClient.setQueryDefaults(queryKey, panelEntryOptions as any);
      queryClient.setQueryData(queryKey, entry);
      await idbPersister.persistQueryByKey?.(queryKey as any, queryClient);
    } catch (error) {
      console.error("Error saving panel cache:", error);
    }
  };

  /**
   * Returns the panel's single entry, whatever it was last saved with — the
   * caller compares the entry's stored `key` against the key it would run with
   * now and treats a mismatch as a miss, exactly as on main. The parameter is
   * accepted for call-site compatibility and ignored.
   */
  const getPanelCache = async (_currentKey?: any): Promise<PanelCacheEntry | null> => {
    try {
      // Memory first: a panel remounting inside one session never touches disk.
      let entry = queryClient.getQueryData<PanelCacheEntry>(queryKey);

      if (!entry) {
        // Two things this call does not do what its name suggests: it keys
        // storage by the query HASH rather than the key array, and it returns
        // the stored `state.data` already unwrapped — not the PersistedQuery.
        entry = (await idbPersister.retrieveQuery?.(hashKey(queryKey))) as
          PanelCacheEntry | undefined;
        if (entry) {
          // Hydrate, so the next remount is a memory hit and the org purge can
          // see this entry without reading IndexedDB.
          queryClient.setQueryDefaults(queryKey, panelEntryOptions as any);
          queryClient.setQueryData(queryKey, entry);
        }
      }

      if (!entry) return null;

      return {
        key: entry.key,
        value: entry.value,
        cacheTimeRange: entry.cacheTimeRange,
        timestamp: entry.timestamp,
      };
    } catch (error) {
      console.error("Error getting panel cache:", error);
      return null;
    }
  };

  return {
    savePanelCache,
    getPanelCache,
  };
};

/**
 * Drop every cached panel result under one dashboard, in memory and on disk.
 * Called when the dashboard itself is deleted — panel-level pruning never runs
 * for panels that go down with their dashboard, so without this their payloads
 * sit orphaned in IndexedDB until the 24 h TTL reclaims them.
 */
export const dropDashboardPanelCache = async (
  org: string,
  folderId: string,
  dashboardId: string,
): Promise<void> => {
  try {
    const dashboardPrefix = panelKeys.dashboard(org, folderId, dashboardId);
    queryClient.removeQueries({ queryKey: dashboardPrefix });
    const hashPrefix = hashKey(dashboardPrefix).replace(/\]$/, ",");
    await cacheRemoveByPrefix(`${IDB_PREFIX}-${hashPrefix}`);
  } catch (error) {
    console.error("Error dropping dashboard panel cache:", error);
  }
};

/**
 * Drop one panel's cached result, in memory and on disk. Called when the panel
 * itself is deleted: otherwise its payload sits in IndexedDB until the 24 h TTL
 * or the record cap reclaims it.
 */
export const dropPanelCache = async (
  org: string,
  folderId: string,
  dashboardId: string,
  panelId: string,
): Promise<void> => {
  try {
    const queryKey = panelKeys.result(org, folderId, dashboardId, panelId);
    queryClient.removeQueries({ queryKey, exact: true });
    // The persister keys storage by the query HASH, not the key array.
    await cacheRemove(`${IDB_PREFIX}-${hashKey(queryKey)}`);
  } catch (error) {
    console.error("Error dropping panel cache:", error);
  }
};
