// Copyright 2026 OpenObserve Inc.

import { computed, ref, watch, type ComputedRef, type InjectionKey } from "vue";

/**
 * Tree mode for OTable: flattens parents + their (expanded) children into a
 * single visible row list, tracks expansion state, and exposes per-row metadata
 * so child components (cells, rows) can render inline chevrons, indentation,
 * and warning rows.
 *
 * State is owned here. Parent components can sync via `expanded-ids` v-model.
 */
export interface OTableTreeRowMeta {
  depth: number;
  hasChildren: boolean;
  isParent: boolean;
  isExpanded: boolean;
  parentId: string | null;
  /** True when this row is the last child within its parent's children array. */
  isLastChild: boolean;
}

export interface OTableTreeContext<TData = any> {
  enabled: boolean;
  treeColumnId: string | null;
  /** Returns tree meta for the given original row, or null if not in tree mode. */
  getMeta: (row: TData) => OTableTreeRowMeta | null;
  /** Toggle expansion of a parent row. */
  toggle: (row: TData) => void;
  /** Does this parent have a warning row that should render before children? */
  hasWarning: (row: TData) => boolean;
}

export const OTableTreeContextKey: InjectionKey<ComputedRef<OTableTreeContext>> =
  Symbol("o2-table-tree-ctx");

export function useTableTree<TData extends Record<string, any>>(
  props: {
    tree?: boolean;
    data: TData[];
    expandedIds?: string[];
    rowKey?: string;
    getChildren?: (row: TData) => TData[] | undefined;
    getRowWarning?: (row: TData) => boolean;
    treeColumnId?: string;
    columns: { id: string; isAction?: boolean }[];
  },
  emit: (event: "update:expandedIds", ids: string[]) => void,
) {
  const enabled = computed(() => !!props.tree);
  const keyField = computed(() => props.rowKey ?? "id");

  const expandedIds = ref<Set<string>>(new Set(props.expandedIds ?? []));

  watch(
    () => props.expandedIds,
    (ids) => {
      const next = new Set(ids ?? []);
      // avoid re-emitting if no change
      if (
        next.size !== expandedIds.value.size ||
        Array.from(next).some((id) => !expandedIds.value.has(id))
      ) {
        expandedIds.value = next;
      }
    },
  );

  const treeColumnId = computed(() => {
    if (!enabled.value) return null;
    if (props.treeColumnId) return props.treeColumnId;
    const first = props.columns.find((c) => !c.isAction);
    return first?.id ?? null;
  });

  function getChildrenOf(row: TData): TData[] {
    if (!row) return [];
    const fn = props.getChildren;
    const c = fn ? fn(row) : (row as any).children;
    return Array.isArray(c) ? c : [];
  }

  function rowId(row: TData): string {
    return String((row as any)[keyField.value] ?? "");
  }

  /** Metadata map (by row reference) + flattened row list */
  const flat = computed(() => {
    const meta = new Map<TData, OTableTreeRowMeta>();
    const rows: TData[] = [];
    if (!enabled.value) {
      return { rows: props.data, meta };
    }
    const walk = (
      row: TData,
      depth: number,
      parentId: string | null,
      isLastChild: boolean,
    ) => {
      const children = getChildrenOf(row);
      const hasChildren = children.length > 0;
      const id = rowId(row);
      const isExpanded = expandedIds.value.has(id);
      meta.set(row, {
        depth,
        hasChildren,
        isParent: hasChildren,
        isExpanded,
        parentId,
        isLastChild,
      });
      rows.push(row);
      if (hasChildren && isExpanded) {
        children.forEach((child, i) =>
          walk(child, depth + 1, id, i === children.length - 1),
        );
      }
    };
    for (const row of props.data ?? []) walk(row, 0, null, false);
    return { rows, meta };
  });

  function getMeta(row: TData): OTableTreeRowMeta | null {
    if (!enabled.value) return null;
    return flat.value.meta.get(row) ?? null;
  }

  function toggle(row: TData) {
    if (!enabled.value) return;
    const id = rowId(row);
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
    emit("update:expandedIds", Array.from(next));
  }

  function hasWarning(row: TData): boolean {
    if (!enabled.value || !props.getRowWarning) return false;
    return !!props.getRowWarning(row);
  }

  const context = computed<OTableTreeContext<TData>>(() => ({
    enabled: enabled.value,
    treeColumnId: treeColumnId.value,
    getMeta,
    toggle,
    hasWarning,
  }));

  return {
    enabled,
    treeColumnId,
    expandedIds,
    flatRows: computed(() => flat.value.rows),
    getMeta,
    toggle,
    hasWarning,
    context,
  };
}
