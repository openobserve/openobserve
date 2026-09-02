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
 * The one key convention in the app, and the whole of it.
 *
 * Every key is rooted at `["org", <id>, …]`. Nothing enforces that beyond this
 * helper, but three things depend on it: the org-switch purge and the logout
 * purge scan by that prefix, and `persisters.ts` derives its storage prefix from
 * the same shape (`orgStoragePrefix`). Build a key by hand and it silently opts
 * out of all three.
 *
 * Each domain exports a key factory beside its endpoints:
 *
 *   export const functionKeys = {
 *     all:  (org: string) => orgKey(org, "functions"),
 *     list: (org: string) => orgKey(org, "functions", "list"),
 *   };
 *
 * `all` is the invalidation scope — what a write drops. `list`/`detail(id)` are
 * the individual entries. Keeping both in one object is what lets a mutation in
 * another domain invalidate this one without importing the query itself.
 */

/** Org segment for reads that are not org-scoped (app config, build info). */
export const GLOBAL_SCOPE = "__global__";

export const orgKey = (org: string, ...rest: readonly unknown[]) => ["org", org, ...rest] as const;

/** The same, for a read that has no org — `/config`, the license, the org list. */
export const globalKey = (...rest: readonly unknown[]) => orgKey(GLOBAL_SCOPE, ...rest);
