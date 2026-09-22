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

import { computed, ref, watch, type Ref } from "vue";

export const SELECTION_STORAGE_KEY = "o2-tables-selection-v1";
export const SELECTION_TTL_MS = 30 * 60 * 1000;
export const SELECTION_MAX_IDS = 1000;

interface ScopeEntry<TSnapshot> {
  rows: Record<string, TSnapshot>;
  savedAt: number;
}

type AllScopes = Record<string, ScopeEntry<unknown>>;

export interface PersistedSelectionOptions<TRow, TSnapshot> {
  tableId: string;
  /** Everything that changes which dataset the table shows: org, folder, tab. */
  scope: () => string;
  rows: Ref<TRow[]>;
  getRowId: (row: TRow) => string;
  /** "server" keeps ids whose rows sit on other pages; "client" drops ids missing from rows. */
  mode?: "client" | "server";
  /** The fields bulk actions need, captured while the row is still on screen. */
  snapshot?: (row: TRow) => TSnapshot;
  /** For pages that hold selected row objects: lets them rebuild their own state from restored ids. */
  onRestore?: (ids: string[]) => void;
}

function readAll(): AllScopes {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as AllScopes) : {};
  } catch {
    return {};
  }
}

function writeAll(all: AllScopes): void {
  try {
    if (Object.keys(all).length === 0) sessionStorage.removeItem(SELECTION_STORAGE_KEY);
    else sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // sessionStorage can be unavailable or full; selection then lives in memory only.
  }
}

function isFresh(
  entry: ScopeEntry<unknown> | undefined,
  now: number,
): entry is ScopeEntry<unknown> {
  return !!entry && typeof entry.rows === "object" && now - entry.savedAt < SELECTION_TTL_MS;
}

export function clearPersistedSelections(): void {
  try {
    sessionStorage.removeItem(SELECTION_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Row selection that survives leaving the page, keyed by org + table + context. */
export function usePersistedSelection<TRow, TSnapshot = true>(
  options: PersistedSelectionOptions<TRow, TSnapshot>,
) {
  const scopeKey = computed(() => `${options.scope()}:${options.tableId}`);
  const takeSnapshot = options.snapshot ?? (() => true as TSnapshot);
  const snapshots = ref<Record<string, TSnapshot>>({}) as Ref<Record<string, TSnapshot>>;
  const selectedIds = ref<string[]>([]);
  // Pages reset selection while their first fetch settles, so nothing is restored or saved before rows exist.
  const restored = ref(false);
  // After a scope change the rows on screen still belong to the old scope until they are replaced.
  let staleRows: TRow[] | null = null;

  function rowsById(): Map<string, TRow> {
    return new Map(options.rows.value.map((row) => [options.getRowId(row), row]));
  }

  function restore(): void {
    const entry = readAll()[scopeKey.value];
    const stored = isFresh(entry, Date.now()) ? (entry.rows as Record<string, TSnapshot>) : {};
    const onPage = rowsById();
    const next: Record<string, TSnapshot> = {};
    for (const id of Object.keys(stored)) {
      if (options.mode !== "server" && !onPage.has(id)) continue;
      next[id] = stored[id];
    }
    snapshots.value = next;
    selectedIds.value = Object.keys(next);
    restored.value = true;
    if (selectedIds.value.length > 0) options.onRestore?.(selectedIds.value);
  }

  function persist(): void {
    const now = Date.now();
    const all = readAll();
    for (const key of Object.keys(all)) {
      if (!isFresh(all[key], now)) delete all[key];
    }
    if (selectedIds.value.length === 0) delete all[scopeKey.value];
    else all[scopeKey.value] = { rows: snapshots.value, savedAt: now };
    writeAll(all);
  }

  function reconcile(): void {
    if (!restored.value) {
      const rows = options.rows.value;
      if (rows.length > 0 && rows !== staleRows) restore();
      return;
    }

    const onPage = rowsById();
    const next: Record<string, TSnapshot> = {};
    const kept: string[] = [];

    for (const id of selectedIds.value) {
      const row = onPage.get(id);
      // A server-paged id with no row and no snapshot cannot be acted on later, so it is dropped.
      if (options.mode === "server" && !row && !(id in snapshots.value)) continue;
      if (kept.length >= SELECTION_MAX_IDS) break;
      next[id] = row ? takeSnapshot(row) : (snapshots.value[id] ?? (true as TSnapshot));
      kept.push(id);
    }

    snapshots.value = next;
    if (kept.length !== selectedIds.value.length) selectedIds.value = kept;
    persist();
  }

  watch(scopeKey, () => {
    staleRows = options.rows.value;
    restored.value = false;
    snapshots.value = {};
    selectedIds.value = [];
  });
  watch([selectedIds, options.rows], reconcile, { immediate: true });

  const selectedRows = computed<TSnapshot[]>(() => {
    // The watcher fills snapshots a tick late, so an on-screen row is the fallback until then.
    const onPage = rowsById();
    const resolved: TSnapshot[] = [];
    for (const id of selectedIds.value) {
      const row = onPage.get(id);
      if (id in snapshots.value) resolved.push(snapshots.value[id]);
      else if (row) resolved.push(takeSnapshot(row));
    }
    return resolved;
  });

  const offPageCount = computed(() => {
    const onPage = rowsById();
    return selectedIds.value.filter((id) => !onPage.has(id)).length;
  });

  function remove(ids: string[]): void {
    const gone = new Set(ids);
    selectedIds.value = selectedIds.value.filter((id) => !gone.has(id));
  }

  function clear(): void {
    selectedIds.value = [];
  }

  return { selectedIds, selectedRows, offPageCount, remove, clear };
}
