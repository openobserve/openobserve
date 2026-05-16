// Copyright 2026 OpenObserve Inc.

import { computed, ref } from "vue";
import type { Row } from "@tanstack/vue-table";

/**
 * Manages recursive row grouping / tree expansion state.
 *
 * Used for hierarchical tables like IAM Permissions where rows
 * have parent-child relationships defined by `getSubRows`.
 *
 * Two modes:
 * - **tree**: Recursive parent-child hierarchy (default expanded to depth 0)
 * - **grouped**: Flat grouping by column value (all groups start collapsed)
 */
export function useTableRowGrouping<TData>(
  options: {
    /** Grouping mode */
    mode?: "tree" | "grouped";
    /** Gets the unique id for a row (for tracking expansion state) */
    getRowId?: (row: TData) => string;
    /** Max depth to expand by default (tree mode only) */
    defaultExpandedDepth?: number;
    /** Initially expanded row ids */
    initialExpandedIds?: string[];
  } = {},
) {
  const mode = options.mode ?? "tree";
  const getRowId = options.getRowId ?? ((row: any) => row?.id?.toString() ?? "");

  const expandedIds = ref<Set<string>>(
    new Set(options.initialExpandedIds ?? []),
  );

  function isExpanded(row: TData): boolean {
    return expandedIds.value.has(getRowId(row));
  }

  function toggleRow(row: TData) {
    const id = getRowId(row);
    const next = new Set(expandedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedIds.value = next;
  }

  function expandRow(row: TData) {
    const id = getRowId(row);
    const next = new Set(expandedIds.value);
    next.add(id);
    expandedIds.value = next;
  }

  function collapseRow(row: TData) {
    const id = getRowId(row);
    const next = new Set(expandedIds.value);
    next.delete(id);
    expandedIds.value = next;
  }

  /**
   * Recursively expand or collapse all descendants of a row up to a given depth.
   * depth=0 means just the row itself, depth=Infinity means all descendants.
   */
  function setExpandedRecursive(
    row: TData,
    expand: boolean,
    maxDepth: number = Infinity,
    currentDepth: number = 0,
  ) {
    if (currentDepth >= maxDepth) return;
    const id = getRowId(row);
    const next = new Set(expandedIds.value);
    if (expand) {
      next.add(id);
    } else {
      next.delete(id);
    }
    expandedIds.value = next;
  }

  function expandAll(rows: TData[], maxDepth?: number) {
    const next = new Set(expandedIds.value);
    const depth = maxDepth ?? Infinity;
    function walk(items: TData[], currentDepth: number) {
      if (currentDepth > depth) return;
      for (const row of items) {
        next.add(getRowId(row));
        const children = (row as any)?.children as TData[] | undefined;
        if (children?.length) {
          walk(children, currentDepth + 1);
        }
      }
    }
    walk(rows, 0);
    expandedIds.value = next;
  }

  function collapseAll() {
    expandedIds.value = new Set();
  }

  return {
    mode,
    isExpanded,
    toggleRow,
    expandRow,
    collapseRow,
    setExpandedRecursive,
    expandAll,
    collapseAll,
    expandedIds,
  };
}
