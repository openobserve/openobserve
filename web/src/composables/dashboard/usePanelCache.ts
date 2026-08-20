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
 * Per-panel result cache. The public API (`getPanelCache` / `savePanelCache`)
 * is unchanged; the storage underneath is now the shared IndexedDB primitive,
 * which brings three things this cache never had:
 *
 *  - the org in the key, so two orgs cannot collide on a dashboard id and the
 *    org-switch purge can find these records;
 *  - a TTL and an LRU cap, so panel payloads — the largest objects the app
 *    stores — no longer grow without bound;
 *  - structured-clone writes instead of `JSON.parse(JSON.stringify(...))` on
 *    the main thread for multi-MB result sets.
 */

import {
  PANEL_CACHE_NAMESPACE,
  cacheAllRecords,
  cacheClear,
  cacheGetRecord,
  cacheMaintain,
  cacheSetOrThrow,
  orgScopedKey,
} from "@/composables/query/idbStorage";
import { panelKeyDigest } from "@/composables/query/panelKey";
import { toRaw } from "vue";

/**
 * Strip Vue's reactive proxies so structured clone can take the value.
 *
 * `toRaw` only unwraps the level it is handed, and a panel's result reaches
 * this file as a proxy several containers deep — every write threw
 * `DataCloneError: [object Array] could not be cloned` and the cache stayed
 * empty. Recursion is limited to arrays and plain objects: a raw target holds
 * its children raw, so the walk stops as soon as `toRaw` returns the same
 * object it was given, and anything exotic (Date, TypedArray) is already
 * cloneable and passed through untouched.
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

  // Only plain objects: a Date or a TypedArray clones as-is, and walking one
  // would rebuild it as a bag of properties.
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

/** Panel results are large; keep far fewer of them than of small config values. */
const MAX_PANEL_RECORDS = 200;
const PANEL_TTL_MS = 24 * 60 * 60_000;

export interface PanelCacheEntry {
  key: any;
  value: any;
  cacheTimeRange: any;
  timestamp: number;
}

// The digest of the normalized schema + variables is part of the key, so a
// panel's different variable combinations no longer overwrite each other.
const panelKey = (
  org: string,
  folderId: string,
  dashboardId: string,
  panelId: string,
  digest: string,
): string => orgScopedKey(PANEL_CACHE_NAMESPACE, org, folderId, dashboardId, panelId, digest);

window._o2_removeDashboardCache = async (): Promise<void> => {
  try {
    await cacheClear();
  } catch (error) {
    console.error("Error clearing dashboard cache:", error);
  }
};

window._o2_getDashboardCache = async (): Promise<any> => {
  try {
    const records = await cacheAllRecords<PanelCacheEntry>();
    const cache: any = {};

    records.forEach((record) => {
      if (!record.key.startsWith(`${PANEL_CACHE_NAMESPACE}|`)) return;
      const [, , folderId, dashboardId, panelId] = record.key.split("|");

      if (!cache[folderId]) cache[folderId] = {};
      if (!cache[folderId][dashboardId]) cache[folderId][dashboardId] = {};

      cache[folderId][dashboardId][panelId] = {
        key: record.value.key,
        value: record.value.value,
        cacheTimeRange: record.value.cacheTimeRange,
        timestamp: record.value.timestamp,
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

  let writesSinceSweep = 0;

  const savePanelCache = async (key: any, data: any, cacheTimeRange: any): Promise<void> => {
    try {
      await cacheSetOrThrow<PanelCacheEntry>(
        panelKey(org, folderId, dashboardId, panelId, panelKeyDigest(key)),
        toStorable({ key, value: data, cacheTimeRange, timestamp: Date.now() }),
        PANEL_TTL_MS,
      );
      // The SQL executor saves per partition, so sweep occasionally rather than
      // paying the scan on every write.
      if (++writesSinceSweep >= 20) {
        writesSinceSweep = 0;
        void cacheMaintain(MAX_PANEL_RECORDS);
      }
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
      const record = await cacheGetRecord<PanelCacheEntry>(
        panelKey(org, folderId, dashboardId, panelId, panelKeyDigest(currentKey)),
      );
      if (!record) return null;

      return {
        key: record.value.key,
        value: record.value.value,
        cacheTimeRange: record.value.cacheTimeRange,
        timestamp: record.value.timestamp,
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
