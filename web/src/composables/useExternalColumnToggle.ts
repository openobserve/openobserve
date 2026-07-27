// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";
import { useTableColumnPersistence } from "@/lib/core/Table/composables/useTableColumnPersistence";

/**
 * Drives an `OTableColumnToggle` rendered OUTSIDE an `OTable` — e.g. in a page's
 * own action/filter bar — for listing tables whose toolbar lives outside the
 * table (so the built-in in-toolbar toggle can't be used without adding a lone
 * toolbar row).
 *
 * Hidden-column state is persisted under `tableId`, mirroring OTable's built-in
 * toggle. Bind the returned `columnVisibility` to both the toggle and the table:
 *
 * ```ts
 * const { columnVisibility, setColumnVisibility } =
 *   useExternalColumnToggle("rum-source-maps-list");
 * ```
 * ```vue
 * <OTableColumnToggle
 *   :columns="columns"
 *   :column-visibility="columnVisibility"
 *   @update:column-visibility="setColumnVisibility"
 * />
 * <OTable :columns="columns" :column-visibility="columnVisibility" ... />
 * ```
 */
const useExternalColumnToggle = (tableId: string) => {
  const persistence = useTableColumnPersistence({ tableId, enabled: true });

  const columnVisibility = ref<Record<string, boolean>>(persistence.loadColumnVisibility() ?? {});

  const setColumnVisibility = (visibility: Record<string, boolean>) => {
    columnVisibility.value = visibility;
    persistence.saveColumnVisibility(visibility);
  };

  return { columnVisibility, setColumnVisibility };
};

export default useExternalColumnToggle;
