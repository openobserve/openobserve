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

import { computed, effectScope, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import store from "@/stores";
import { ORG_SWITCHER_MAX_FAVORITES } from "@/utils/orgSwitcherList";

export { ORG_SWITCHER_MAX_FAVORITES, ORG_SWITCHER_RECENT_SHOWN } from "@/utils/orgSwitcherList";
export const ORG_SWITCHER_MAX_RECENTS = 10;
/** Smallest page_size any full org-list load requests; a list this long may be truncated. */
export const ORG_LIST_FULL_PAGE_SIZE = 100000;

export interface OrgSwitcherPrefs {
  v: 1;
  favorites: string[];
  recents: string[];
}

const emptyPrefs = (): OrgSwitcherPrefs => ({ v: 1, favorites: [], recents: [] });

const state = shallowRef<OrgSwitcherPrefs>(emptyPrefs());
let pendingLanding: string | null = null;

const uniqueStrings = (value: unknown, max: number): string[] | null => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return null;
  return [...new Set(value as string[])].slice(0, max);
};

export function orgSwitcherStorageKey(email: string | undefined | null): string | null {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return normalized ? `o2:org-switcher:v1:${normalized}` : null;
}

export function readPrefs(key: string): OrgSwitcherPrefs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyPrefs();
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return emptyPrefs();
    const favorites = uniqueStrings(record.favorites, ORG_SWITCHER_MAX_FAVORITES);
    const recents = uniqueStrings(record.recents, ORG_SWITCHER_MAX_RECENTS);
    if (!favorites || !recents) return emptyPrefs();
    return { v: 1, favorites, recents };
  } catch {
    return emptyPrefs();
  }
}

export function writePrefs(key: string, value: OrgSwitcherPrefs): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage must not fail the caller; memory still holds the change.
  }
}

const scope = effectScope(true);
const currentKey = scope.run(() =>
  computed(() =>
    orgSwitcherStorageKey((store.state.userInfo as { email?: string } | undefined)?.email),
  ),
) as ComputedRef<string | null>;

scope.run(() => {
  // Sync flush so a mutation never writes the previous user's prefs under the new key.
  watch(
    currentKey,
    (key) => {
      state.value = key ? readPrefs(key) : emptyPrefs();
    },
    { immediate: true, flush: "sync" },
  );
});

const commit = (next: OrgSwitcherPrefs) => {
  const key = currentKey.value;
  if (!key) return;
  state.value = next;
  writePrefs(key, next);
};

const onStorage = (event: StorageEvent) => {
  // A sessionStorage clear also fires with key null; treating it as ours would persist empty prefs on the next write.
  if (event.storageArea !== localStorage) return;
  const key = currentKey.value;
  if (key && (event.key === null || event.key === key)) state.value = readPrefs(key);
};

// Registered once at module load, so mounting the switcher never adds listeners.
if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

export function recordVisit(identifier: string): void {
  if (!identifier) return;
  const current = state.value;
  const recents = [identifier, ...current.recents.filter((id) => id !== identifier)].slice(
    0,
    ORG_SWITCHER_MAX_RECENTS,
  );
  commit({ ...current, recents });
}

export function noteLanding(identifier: string, knownIds: readonly string[]): void {
  if (!identifier) return;
  if (knownIds.length === 0) {
    pendingLanding = identifier;
    return;
  }
  pendingLanding = null;
  if (knownIds.includes(identifier)) recordVisit(identifier);
}

export function flushPendingLanding(knownIds: readonly string[]): void {
  if (!pendingLanding || knownIds.length === 0) return;
  const identifier = pendingLanding;
  pendingLanding = null;
  if (knownIds.includes(identifier)) recordVisit(identifier);
}

export function prune(validIds: readonly string[]): void {
  if (validIds.length === 0 || validIds.length >= ORG_LIST_FULL_PAGE_SIZE) return;
  const valid = new Set(validIds);
  const current = state.value;
  const favorites = current.favorites.filter((id) => valid.has(id));
  const recents = current.recents.filter((id) => valid.has(id));
  if (favorites.length === current.favorites.length && recents.length === current.recents.length) {
    return;
  }
  commit({ ...current, favorites, recents });
}

export function useOrgSwitcherPrefs(): {
  favorites: Readonly<Ref<readonly string[]>>;
  recents: Readonly<Ref<readonly string[]>>;
  isFavorite: (identifier: string) => boolean;
  canAddFavorite: ComputedRef<boolean>;
  canStore: ComputedRef<boolean>;
  toggleFavorite: (identifier: string) => boolean;
} {
  const favorites = computed<readonly string[]>(() => state.value.favorites);
  const recents = computed<readonly string[]>(() => state.value.recents);
  const canAddFavorite = computed(() => favorites.value.length < ORG_SWITCHER_MAX_FAVORITES);
  const canStore = computed(() => currentKey.value !== null);

  const isFavorite = (identifier: string) => state.value.favorites.includes(identifier);

  const toggleFavorite = (identifier: string): boolean => {
    if (!currentKey.value || !identifier) return false;
    const current = state.value;
    if (current.favorites.includes(identifier)) {
      commit({ ...current, favorites: current.favorites.filter((id) => id !== identifier) });
      return true;
    }
    if (current.favorites.length >= ORG_SWITCHER_MAX_FAVORITES) return false;
    commit({ ...current, favorites: [...current.favorites, identifier] });
    return true;
  };

  return { favorites, recents, isFavorite, canAddFavorite, canStore, toggleFavorite };
}

/** Test-only: drops the pending landing and reloads state from the current key. */
export function __resetOrgSwitcherPrefsForTest(): void {
  pendingLanding = null;
  const key = currentKey.value;
  state.value = key ? readPrefs(key) : emptyPrefs();
}
