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

import { reactive } from "vue";
import type { BulkKind } from "./useBulkReview";

/** How long a just-added alert waits for a pass to count it before the page stops polling for one. */
export const ADDED_KEEP_MS = 30 * 60_000;

interface Added {
  org: string;
  at: number;
}

/** Alerts this session created, keyed by service and class, until the analysis pass after them sees them. */
const created = reactive(new Map<string, Added>());

const keyOf = (serviceKey: string, cls: BulkKind): string => `${cls}\u0000${serviceKey}`;

/** The key the store uses for one service in one cluster and namespace of one org. */
export const serviceKeyOf = (
  org: string,
  service: string,
  cluster: string | null,
  namespace: string | null,
): string => [org, service, cluster ?? "", namespace ?? ""].join("\u0000");

const orgOf = (serviceKey: string): string => serviceKey.split("\u0000")[0];

const fresh = (entry: Added, now: number): boolean => now - entry.at <= ADDED_KEEP_MS;

const has = (serviceKey: string, cls: BulkKind, now: number = Date.now()): boolean => {
  const entry = created.get(keyOf(serviceKey, cls));
  return !!entry && fresh(entry, now);
};

const add = (serviceKey: string, cls: BulkKind, at: number = Date.now()): void => {
  created.set(keyOf(serviceKey, cls), { org: orgOf(serviceKey), at });
};

const remove = (serviceKey: string, cls: BulkKind): void => {
  created.delete(keyOf(serviceKey, cls));
};

/** Forgets every alert of `org` created before its pass at `passAt` (ms), which already counts them. */
const clearOnPass = (org: string, passAt: number): void => {
  for (const [key, entry] of created)
    if (entry.org === org && entry.at <= passAt) created.delete(key);
};

/** Whether an alert of `org` created after its pass at `passAt` (ms) still waits to be counted. */
const waiting = (org: string, passAt: number = 0, now: number = Date.now()): boolean => {
  for (const entry of created.values())
    if (entry.org === org && entry.at > passAt && fresh(entry, now)) return true;
  return false;
};

export const useRecentlyCreated = () => ({ has, add, remove, clearOnPass, waiting });

/** The just-added kind each coverage check is filled by. */
export const KIND_OF_CHECK = { errors: "errors", latency: "latency", absence: "no_data" } as const;
