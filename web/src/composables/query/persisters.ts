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
 * Per-query persisters. Persistence is opt-in at the query level (via a tier),
 * never whole-cache: a whole-client persister would write every list — including
 * per-tenant data on shared machines — and re-serialize the entire cache on a
 * debounce.
 *
 * Storage keys are `<prefix>-<queryHash>`, and every query hash begins
 * `["org","<orgId>",…]` (enforced by `queryKeys.ts`), so purging one org is a
 * prefix scan.
 */

import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import type { AsyncStorage } from "@tanstack/query-persist-client-core";
import {
  CACHE_NAMESPACES,
  cacheRemoveByPrefix,
  cacheClear,
  isIdbAvailable,
  idbStorage,
} from "./idbStorage";
import {
  clearOrg as clearFieldValuesForOrg,
  clearAll as clearAllFieldValues,
} from "@/composables/fieldValueDB";

/**
 * Bump when a cached response shape changes so stale payloads are discarded
 * rather than rendered.
 */
export const PERSIST_BUSTER = "1";

export const LS_PREFIX = "o2q";
export const IDB_PREFIX = "o2q-heavy";

const DAY_MS = 24 * 60 * 60_000;

/**
 * localStorage is unavailable in some private-browsing modes and throws on
 * quota. Wrapped so a storage failure degrades to "no persistence" instead of
 * breaking the query.
 */
const safeLocalStorage: AsyncStorage<string> | undefined =
  typeof window !== "undefined" && window.localStorage
    ? {
        getItem: (key) => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            /* quota exceeded — skip persisting */
          }
        },
        removeItem: (key) => {
          try {
            window.localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        },
        entries: () => {
          const out: Array<[string, string]> = [];
          try {
            for (let i = 0; i < window.localStorage.length; i++) {
              const k = window.localStorage.key(i);
              if (k === null) continue;
              out.push([k, window.localStorage.getItem(k) ?? ""]);
            }
          } catch {
            /* ignore */
          }
          return out;
        },
      }
    : undefined;

/** Small config-sized values that should survive a reload (T0 / T1 tiers). */
export const localPersister = experimental_createQueryPersister<string>({
  storage: safeLocalStorage,
  maxAge: DAY_MS,
  prefix: LS_PREFIX,
  buster: PERSIST_BUSTER,
});

/**
 * Heavy payloads (panel results, field values, trace DAGs) — IndexedDB, with
 * identity serialize/deserialize so values are structured-cloned rather than
 * stringified on the main thread.
 */
export const idbPersister = experimental_createQueryPersister<unknown>({
  storage: isIdbAvailable() ? idbStorage : undefined,
  maxAge: DAY_MS,
  prefix: IDB_PREFIX,
  buster: PERSIST_BUSTER,
  serialize: (persistedQuery) => persistedQuery,
  deserialize: (value) => value as ReturnType<typeof structuredClone>,
});

/**
 * Storage-key prefix for one org. Every query key starts `["org", orgId]`, and
 * the persister keys storage by the query hash, so this string is the exact
 * prefix of every persisted entry belonging to that org.
 */
const orgStoragePrefix = (prefix: string, org: string) => `${prefix}-["org",${JSON.stringify(org)}`;

const removeLocalByPrefix = (prefix: string): void => {
  if (!safeLocalStorage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};

/** Drop every persisted entry belonging to `org` (localStorage + IndexedDB). */
export const purgePersistedOrg = async (org: string): Promise<void> => {
  if (!org) return;
  removeLocalByPrefix(orgStoragePrefix(LS_PREFIX, org));
  await cacheRemoveByPrefix(orgStoragePrefix(IDB_PREFIX, org));
  // Non-query consumers of the same store (panel results) key themselves
  // `<namespace>|<org>|…`.
  for (const ns of CACHE_NAMESPACES) {
    await cacheRemoveByPrefix(`${ns}|${org}|`);
  }
  // Field values live in their own database, keyed "org|type|stream|field".
  await clearFieldValuesForOrg(org);
};

/** Drop everything this app persisted. Called on logout. */
export const purgeAllPersisted = async (): Promise<void> => {
  removeLocalByPrefix(`${LS_PREFIX}-`);
  await cacheClear();
  await clearAllFieldValues();
};
