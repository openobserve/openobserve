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
 * The one persister left, for the dashboard panel-result cache. Never
 * whole-cache: a whole-client persister would write every list — including
 * per-tenant data on shared machines — and re-serialize the entire cache on a
 * debounce. No `*.queries.ts` declaration persists: a read restored from disk is
 * served without any age check, which is a bug for everything but panel results.
 *
 * Storage keys are `<prefix>-<queryHash>`, and every query hash begins
 * `["org","<orgId>",…]` (enforced by `queryKeys.ts`), so purging one org is a
 * prefix scan.
 */

import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import {
  CACHE_NAMESPACES,
  cacheRemoveByPrefix,
  cacheRemoveWhere,
  cacheClear,
  isIdbAvailable,
  idbStorage,
} from "./idbStorage";
import {
  clearOrg as clearFieldValuesForOrg,
  clearAllExceptOrg as clearFieldValuesExceptOrg,
  clearAll as clearAllFieldValues,
} from "@/composables/fieldValueDB";
import { GLOBAL_SCOPE } from "./keys";

/** Bump when a persisted response shape changes; a bump re-runs every dashboard panel's search on next read. */
export const IDB_BUSTER = "1";

export const IDB_PREFIX = "o2q-heavy";

const DAY_MS = 24 * 60 * 60_000;

/**
 * Panel results — IndexedDB, with identity serialize/deserialize so values are
 * structured-cloned rather than stringified on the main thread. Log field values
 * keep their own database (`fieldValueDB.ts`).
 */
export const idbPersister = experimental_createQueryPersister<unknown>({
  storage: isIdbAvailable() ? idbStorage : undefined,
  maxAge: DAY_MS,
  prefix: IDB_PREFIX,
  buster: IDB_BUSTER,
  serialize: (persistedQuery) => persistedQuery,
  deserialize: (value) => value as never,
});

/**
 * Storage-key prefix for one org. Every query key starts `["org", orgId]`, and
 * the persister keys storage by the query hash, so this string is the exact
 * prefix of every persisted entry belonging to that org.
 */
const orgStoragePrefix = (prefix: string, org: string) => `${prefix}-["org",${JSON.stringify(org)}`;

/** Drop every persisted entry belonging to `org`. */
export const purgePersistedOrg = async (org: string): Promise<void> => {
  if (!org) return;
  await cacheRemoveByPrefix(orgStoragePrefix(IDB_PREFIX, org));
  // Legacy only. Panel results moved onto the query prefix above, so nothing
  // writes `<namespace>|<org>|…` any more — this drains the entries an older
  // build left in a user's IndexedDB. Removable once those have aged out.
  for (const ns of CACHE_NAMESPACES) {
    await cacheRemoveByPrefix(`${ns}|${org}|`);
  }
  // Field values live in their own database, keyed "org|type|stream|field".
  await clearFieldValuesForOrg(org);
};

/**
 * Drop every persisted entry that belongs to neither `keepOrg` nor the global
 * scope. `purgePersistedOrg` only cleans the org being LEFT, so entries from
 * orgs visited in older sessions used to sit on disk until the 24 h max age —
 * this is the org-switch sweep that removes them too.
 */
export const purgePersistedExceptOrg = async (keepOrg: string): Promise<void> => {
  if (!keepOrg) return;
  const keepIdb = [
    orgStoragePrefix(IDB_PREFIX, keepOrg),
    orgStoragePrefix(IDB_PREFIX, GLOBAL_SCOPE),
  ];
  const keepNs = CACHE_NAMESPACES.map((ns) => `${ns}|${keepOrg}|`);
  await cacheRemoveWhere((key) => {
    if (key.startsWith(`${IDB_PREFIX}-`)) return !keepIdb.some((p) => key.startsWith(p));
    if (CACHE_NAMESPACES.some((ns) => key.startsWith(`${ns}|`))) {
      return !keepNs.some((p) => key.startsWith(p));
    }
    return false;
  });
  await clearFieldValuesExceptOrg(keepOrg);
};

/** Drop everything this app persisted. Called on logout. */
export const purgeAllPersisted = async (): Promise<void> => {
  await cacheClear();
  await clearAllFieldValues();
};
