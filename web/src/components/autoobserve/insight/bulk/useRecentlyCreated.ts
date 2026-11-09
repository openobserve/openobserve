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

/** Alerts this session created, keyed by service and class, until the analysis pass after them sees them. */
const created = reactive(new Map<string, number>());

const keyOf = (serviceKey: string, cls: BulkKind): string => `${cls}\u0000${serviceKey}`;

/** The key the store uses for one service in one cluster and namespace of one org. */
export const serviceKeyOf = (
  org: string,
  service: string,
  cluster: string | null,
  namespace: string | null,
): string => [org, service, cluster ?? "", namespace ?? ""].join("\u0000");

const has = (serviceKey: string, cls: BulkKind): boolean => created.has(keyOf(serviceKey, cls));

const add = (serviceKey: string, cls: BulkKind, at: number = Date.now()): void => {
  created.set(keyOf(serviceKey, cls), at);
};

const remove = (serviceKey: string, cls: BulkKind): void => {
  created.delete(keyOf(serviceKey, cls));
};

/** Forgets every alert created before the pass at `passAt` (ms), which already counts them. */
const clearOnPass = (passAt: number): void => {
  for (const [key, at] of created) if (at <= passAt) created.delete(key);
};

export const useRecentlyCreated = () => ({ has, add, remove, clearOnPass });
