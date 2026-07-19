// Copyright 2026 OpenObserve Inc.

/**
 * Persists column widths and column visibility to localStorage.
 * Only active when both `enabled` is true and a `tableId` is provided.
 *
 * Storage schema — a SINGLE global entry holds the state for every table,
 * nested by `tableId`:
 *
 *   o2-tables-column-state-v1 → {
 *     [tableId]: {
 *       sizes:      Record<string, number>,   // frozen fixed widths
 *       visibility: Record<string, boolean>,  // shown/hidden per column
 *     }
 *   }
 *
 * The key is versioned (-v1). The width model is Excel-style (a persisted width
 * is a frozen fixed width, not a hint).
 */
const GLOBAL_STORAGE_KEY = "o2-tables-column-state-v1";

interface TableState {
  sizes?: Record<string, number>;
  visibility?: Record<string, boolean>;
}

type AllTablesState = Record<string, TableState>;

export function useTableColumnPersistence(options: {
  tableId: string | undefined;
  enabled: boolean;
}) {
  const { tableId, enabled } = options;

  const isActive = enabled && !!tableId;

  function readAll(): AllTablesState {
    try {
      const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      return parsed as AllTablesState;
    } catch {
      return {};
    }
  }

  function writeAll(state: AllTablesState): void {
    try {
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable (private mode, quota exceeded)
    }
  }

  function loadColumnSizes(): Record<string, number> | null {
    if (!isActive || !tableId) return null;
    const sizes = readAll()[tableId]?.sizes;
    return sizes && typeof sizes === "object" ? sizes : null;
  }

  function saveColumnSizes(sizes: Record<string, number>): void {
    if (!isActive || !tableId) return;
    // Read-modify-write: only touch this table's slice so other tables sharing
    // the global entry are never clobbered.
    const all = readAll();
    all[tableId] = { ...all[tableId], sizes };
    writeAll(all);
  }

  function loadColumnVisibility(): Record<string, boolean> | null {
    if (!isActive || !tableId) return null;
    const visibility = readAll()[tableId]?.visibility;
    return visibility && typeof visibility === "object" ? visibility : null;
  }

  function saveColumnVisibility(visibility: Record<string, boolean>): void {
    if (!isActive || !tableId) return;
    const all = readAll();
    all[tableId] = { ...all[tableId], visibility };
    writeAll(all);
  }

  function clearPersistedState(): void {
    if (!tableId) return;
    const all = readAll();
    if (!(tableId in all)) return;
    delete all[tableId];
    writeAll(all);
  }

  return {
    isActive,
    loadColumnSizes,
    saveColumnSizes,
    loadColumnVisibility,
    saveColumnVisibility,
    clearPersistedState,
  };
}
