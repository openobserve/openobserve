// Copyright 2026 OpenObserve Inc.

/**
 * Persists column widths and column visibility to localStorage.
 * Only active when both `enabled` is true and a `tableId` is provided.
 *
 * Storage key schema:
 *   o2-table-{tableId}-column-sizes-v2     → Record<string, number>
 *   o2-table-{tableId}-column-visibility   → Record<string, boolean>
 *
 * The sizes key is versioned (-v2): the Excel-style resize model changed what a
 * persisted width means (a frozen fixed width, not a hint), so pre-existing
 * sizes are intentionally discarded on upgrade.
 */
const COLUMN_SIZES_KEY = "column-sizes-v2";
export function useTableColumnPersistence(options: {
  tableId: string | undefined;
  enabled: boolean;
}) {
  const { tableId, enabled } = options;

  const isActive = enabled && !!tableId;

  function storageKey(suffix: string) {
    return `o2-table-${tableId}-${suffix}`;
  }

  function loadColumnSizes(): Record<string, number> | null {
    if (!isActive) return null;
    try {
      const raw = localStorage.getItem(storageKey(COLUMN_SIZES_KEY));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed as Record<string, number>;
    } catch {
      return null;
    }
  }

  function saveColumnSizes(sizes: Record<string, number>): void {
    if (!isActive) return;
    try {
      localStorage.setItem(storageKey(COLUMN_SIZES_KEY), JSON.stringify(sizes));
    } catch {
      // localStorage may be unavailable (private mode, quota exceeded)
    }
  }

  function loadColumnVisibility(): Record<string, boolean> | null {
    if (!isActive) return null;
    try {
      const raw = localStorage.getItem(storageKey("column-visibility"));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      return parsed as Record<string, boolean>;
    } catch {
      return null;
    }
  }

  function saveColumnVisibility(visibility: Record<string, boolean>): void {
    if (!isActive) return;
    try {
      localStorage.setItem(
        storageKey("column-visibility"),
        JSON.stringify(visibility),
      );
    } catch {
      // localStorage may be unavailable (private mode, quota exceeded)
    }
  }

  function clearPersistedState(): void {
    if (!tableId) return;
    try {
      localStorage.removeItem(storageKey(COLUMN_SIZES_KEY));
      localStorage.removeItem(storageKey("column-visibility"));
    } catch {
      // no-op
    }
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
