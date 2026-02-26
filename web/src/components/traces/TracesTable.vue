<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  TracesTable — Generic TanStack Table wrapper for OpenObserve

  Column sizing contract (via ColumnDef.meta):
    meta.grow     — flex: 1 1 0 (fills remaining space).
                    Pair with meta.minWidth (px) or ColumnDef.minSize.
    meta.align    — 'left' | 'center' | 'right'  (default: 'left')
    column.size   — fixed pixel width when grow is not set (TanStack default: 150)

  Row styling:
    rowClass prop — (row: T) => string | string[] | Record<string, boolean>
    Use 'oz-table__row--error' to render the red left-border error variant.

  Slots:
    #loading  — shown while loading=true
    #empty    — shown when rows is empty and loading=false
-->

<!-- Module augmentation must live in a non-setup script block -->
<script lang="ts">
declare module "@tanstack/vue-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** flex: 1 1 0 — column grows to fill remaining space */
    grow?: boolean;
    /** min-width in px when grow is true (falls back to ColumnDef.minSize) */
    minWidth?: number;
    /** text alignment for both header and cell */
    align?: "left" | "center" | "right";
  }
}
export default {};
</script>

<script setup lang="ts" generic="T extends Record<string, any>">
import {
  useVueTable,
  getCoreRowModel,
  FlexRender,
  type ColumnDef,
  type Column,
} from "@tanstack/vue-table";

// ─────────────────────────────────────────────────────────────────────────────
// Props & emits
// ─────────────────────────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    /** TanStack column definitions — include `meta.grow` / `meta.align` */
    columns: ColumnDef<T>[];
    /** Row data */
    rows: T[];
    /** Show loading slot instead of rows */
    loading?: boolean;
    /**
     * Returns Quasar/Tailwind class(es) for a given row.
     * Use 'oz-table__row--error' to trigger the red left-border variant.
     */
    rowClass?: (
      row: T,
    ) => string | string[] | Record<string, boolean> | undefined;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  "row-click": [row: T];
}>();

// ─────────────────────────────────────────────────────────────────────────────
// Table instance
// ─────────────────────────────────────────────────────────────────────────────
const table = useVueTable({
  get data() {
    return props.rows;
  },
  get columns() {
    return props.columns;
  },
  getCoreRowModel: getCoreRowModel(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Column sizing helpers
// ─────────────────────────────────────────────────────────────────────────────
function getColumnStyle(column: Column<T, unknown>): Record<string, string> {
  const meta = column.columnDef.meta;

  if (meta?.grow) {
    const min = meta.minWidth ?? column.columnDef.minSize ?? 100;
    return { flex: "1 1 0", minWidth: `${min}px`, overflow: "hidden" };
  }

  const size = column.getSize();
  return { flex: `0 0 ${size}px`, width: `${size}px`, overflow: "hidden" };
}

function getAlignClass(column: Column<T, unknown>): string {
  const a = column.columnDef.meta?.align;
  if (a === "center") return "text-center";
  if (a === "right") return "text-right";
  return "";
}
</script>

<template>
  <div class="oz-table">
    <!-- ── Sticky header ─────────────────────────────────────────────────── -->
    <div
      class="oz-table__head row no-wrap items-center q-px-sm tw:border-[var(--o2-border-color)]!"
    >
      <div
        v-for="header in table.getHeaderGroups()[0].headers"
        :key="header.id"
        class="oz-table__th text-caption text-weight-bold"
        :class="getAlignClass(header.column)"
        :style="getColumnStyle(header.column)"
      >
        <FlexRender
          :render="header.column.columnDef.header"
          :props="header.getContext()"
        />
      </div>
    </div>

    <!-- ── Rows ──────────────────────────────────────────────────────────── -->
    <template v-if="!loading && table.getRowModel().rows.length">
      <div
        v-for="row in table.getRowModel().rows"
        :key="row.id"
        class="oz-table__row row no-wrap items-center q-px-sm cursor-pointer"
        :class="rowClass?.(row.original)"
        @click="$emit('row-click', row.original)"
      >
        <div
          v-for="cell in row.getVisibleCells()"
          :key="cell.id"
          class="oz-table__td"
          :class="getAlignClass(cell.column)"
          :style="getColumnStyle(cell.column)"
        >
          <FlexRender
            :render="cell.column.columnDef.cell"
            :props="cell.getContext()"
          />
        </div>
      </div>
    </template>

    <!-- ── Loading ───────────────────────────────────────────────────────── -->
    <slot v-else-if="loading" name="loading" />

    <!-- ── Empty ─────────────────────────────────────────────────────────── -->
    <slot v-else name="empty" />
  </div>
</template>

<style lang="scss" scoped>
.oz-table {
  display: flex;
  flex-direction: column;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.oz-table__head {
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 36px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  letter-spacing: 2px;
  color: var(--o2-text-3);
  background: inherit;
}

.oz-table__th {
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Rows ────────────────────────────────────────────────────────────────── */
.oz-table__row {
  min-height: 52px;
  border-bottom: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.06));
  transition: background 0.15s ease;

  &:hover {
    background: var(--o2-table-header-bg);
  }

  /**
   * Error variant — apply via rowClass prop:
   *   rowClass: (row) => row.errors > 0 ? 'oz-table__row--error' : ''
   */
  &--error {
    border-left: 3px solid var(--q-negative);
    padding-left: 5px;
  }
}

.oz-table__td {
  padding: 8px;
  overflow: hidden;
}
</style>
