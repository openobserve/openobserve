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

import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowReactive,
  watchEffect,
} from "vue";
import { viewDenial, type AccessDenial } from "@/composables/useAccessStore";

// What each mounted inline lock names, by lock; the chip leaves these out so one 403 reads once.
const coveredByLock = shallowReactive(new Map<symbol, Set<string>>());

const denialId = (d: AccessDenial) => `${d.resource.key}|${d.permission}`;

/** Keeps `denials` out of the access chip while the calling component is mounted and active. */
export function coverDenials(denials: () => AccessDenial[]): void {
  const lock = Symbol("accessLock");
  // A KeepAlive-cached page stays mounted while another page is on screen; its lock must not hide that page's denials.
  const active = ref(true);
  watchEffect(() => {
    if (active.value) coveredByLock.set(lock, new Set(denials().map(denialId)));
    else coveredByLock.delete(lock);
  });
  onActivated(() => (active.value = true));
  onDeactivated(() => (active.value = false));
  onBeforeUnmount(() => coveredByLock.delete(lock));
}

/** `entries` without the ones an inline lock on screen already names. */
export function withoutCovered<T extends AccessDenial>(entries: T[]): T[] {
  if (coveredByLock.size === 0) return entries;
  const covered = new Set([...coveredByLock.values()].flatMap((ids) => [...ids]));
  return entries.filter((e) => !covered.has(denialId(e)));
}

/** What a forbidden table's lock names: its own refused list, or none when the table does not say which resource it lists. */
export function tableDenials(entries: AccessDenial[], resource?: string): AccessDenial[] {
  if (!resource) return [];
  const own = entries.filter((e) => e.permission === "list" && e.resource.key === resource);
  return own.length ? own : [viewDenial(resource, "list")];
}
