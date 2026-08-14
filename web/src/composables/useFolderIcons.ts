// Copyright 2026 OpenObserve Inc.
//
// The ONE place a folder's emoji is read from and written to.
//
// The folders API has no `icon` field yet, so the icon is kept in localStorage,
// scoped by org + folder type. Reads already prefer a server-provided
// `folder.icon` when one is present, so the day the column ships the only
// change needed here is to make `setIcon` PUT it instead of (or as well as)
// writing local storage — no call site moves.
//
// Caveat while local: icons live in this browser only. They are not shared with
// teammates and are lost when site data is cleared.

import { computed, reactive, toValue, type MaybeRefOrGetter } from "vue";
import { useStore } from "vuex";

/** folderId -> emoji */
type IconMap = Record<string, string>;

const STORAGE_PREFIX = "o2:folder-icons";

// Module-scope so every rail, dialog and dropdown on the page reads the same
// map and re-renders together — localStorage on its own is not reactive.
const cache = reactive<Record<string, IconMap>>({});
const hydrated = new Set<string>();

function scopeKey(org: string, type: string): string {
  return `${STORAGE_PREFIX}:${org}:${type}`;
}

function hydrate(key: string): void {
  if (hydrated.has(key)) return;
  hydrated.add(key);
  try {
    const stored = window.localStorage.getItem(key);
    cache[key] = stored ? (JSON.parse(stored) as IconMap) : {};
  } catch {
    // Unparseable or unavailable (private mode, quota, disabled storage) —
    // fall back to in-memory only rather than breaking the folder list.
    cache[key] = {};
  }
}

function persist(key: string): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(cache[key] ?? {}));
  } catch {
    // Non-fatal: the icon still applies for this session.
  }
}

/** A folder as the rail and the dialogs see it. `icon` is the future API field. */
export interface FolderWithIcon {
  folderId: string;
  icon?: string | null;
}

export function useFolderIcons(folderType: MaybeRefOrGetter<string>) {
  const store = useStore();

  const key = computed(() => {
    const org = store.state.selectedOrganization?.identifier ?? "unknown";
    return scopeKey(org, toValue(folderType));
  });

  const icons = computed<IconMap>(() => {
    hydrate(key.value);
    return cache[key.value] ?? {};
  });

  /** The emoji to show for a folder, or null when it has none. */
  function iconFor(folder: FolderWithIcon | null | undefined): string | null {
    if (!folder?.folderId) return null;
    const fromServer = folder.icon?.trim();
    if (fromServer) return fromServer;
    return icons.value[folder.folderId] || null;
  }

  /** Store a folder's emoji; pass null/empty to remove it. */
  function setIcon(folderId: string, icon: string | null | undefined): void {
    if (!folderId) return;
    hydrate(key.value);
    const map = cache[key.value];
    const next = icon?.trim();
    if (next) map[folderId] = next;
    else delete map[folderId];
    persist(key.value);
  }

  /** Drop a deleted folder's entry so the map doesn't grow forever. */
  function removeIcon(folderId: string): void {
    setIcon(folderId, null);
  }

  return { iconFor, setIcon, removeIcon };
}

/** Test-only: forget every hydrated scope. */
export function __resetFolderIconCache(): void {
  hydrated.clear();
  for (const k of Object.keys(cache)) delete cache[k];
}
