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
import { cacheRemoveByPrefix } from "@/composables/query/idbStorage";
import { LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { panelKeyDigest } from "@/composables/query/panelKey";
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

window._o2_removeDashboardCache = async (): Promise<void> => {
  try {
    const cache = queryClient.getQueryCache();
    await Promise.all(
      cache
        .getAll()
        .filter((query) => isPanelKey(query.queryKey))
        .map(async (query) => {
          await idbPersister.removeQueries?.({ queryKey: query.queryKey, exact: true });
          cache.remove(query);
        }),
    );
    // Entries that were only ever on disk have no in-memory query to walk.
    await idbPersister.persisterGc?.();
  } catch (error) {
    console.error("Error clearing dashboard cache:", error);
  }
};

window._o2_getDashboardCache = async (): Promise<any> => {
  try {
    const cache: any = {};
    queryClient
      .getQueryCache()
      .getAll()
      .forEach((query) => {
        if (!isPanelKey(query.queryKey)) return;
        const [, , , folderId, dashboardId, panelId] = query.queryKey as any[];
        const entry = query.state.data as PanelCacheEntry | undefined;
        if (!entry) return;

        if (!cache[folderId]) cache[folderId] = {};
        if (!cache[folderId][dashboardId]) cache[folderId][dashboardId] = {};
        cache[folderId][dashboardId][panelId] = {
          key: entry.key,
          value: entry.value,
          cacheTimeRange: entry.cacheTimeRange,
          timestamp: entry.timestamp,
        };
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

  const keyFor = (cacheKey: any) =>
    panelKeys.result(org, folderId, dashboardId, panelId, panelKeyDigest(cacheKey));

  const savePanelCache = async (key: any, data: any, cacheTimeRange: any): Promise<void> => {
    try {
      const queryKey = keyFor(key);
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
   * `currentKey` is the key the panel would run with now — its digest selects
   * the matching entry. Callers still verify the returned key themselves, so a
   * digest collision cannot serve the wrong result.
   */
  const getPanelCache = async (currentKey?: any): Promise<PanelCacheEntry | null> => {
    try {
      const queryKey = keyFor(currentKey);

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
 * Drop every cached result for one panel — all of its variable digests, in
 * memory and on disk. Called when the panel itself is deleted: otherwise its
 * payload sits in IndexedDB until the 24 h TTL or the record cap reclaims it.
 */
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

export const dropPanelCache = async (
  org: string,
  folderId: string,
  dashboardId: string,
  panelId: string,
): Promise<void> => {
  try {
    // One panel owns one entry per variable digest, and the digest is the key's
    // last segment — so drop the segment and match everything under it.
    const panelPrefix = panelKeys.result(org, folderId, dashboardId, panelId, "").slice(0, -1);
    queryClient.removeQueries({ queryKey: panelPrefix });
    // The persister keys by the query HASH, not the array, so the disk prefix is
    // that hash with its closing bracket swapped for the separator.
    const hashPrefix = hashKey(panelPrefix).replace(/\]$/, ",");
    await cacheRemoveByPrefix(`${IDB_PREFIX}-${hashPrefix}`);
  } catch (error) {
    console.error("Error dropping panel cache:", error);
  }
};
