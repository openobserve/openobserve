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
  TracesTable — Generic TanStack Table + TanStack Virtual wrapper

  Column sizing contract (via ColumnDef.meta):
    meta.grow     — flex: 1 1 0 (fills remaining space).
                    Pair with meta.minWidth (px) or ColumnDef.minSize.
    meta.align    — 'left' | 'center' | 'right'  (default: 'left')
    column.size   — fixed pixel width when grow is not set (TanStack default: 150)

  Row styling:
    rowClass prop — (row: T) => string | string[] | Record<string, boolean>
    Use 'oz-table__row--error' to render the red left-border error variant.

  Slots:
    #loading              — shown while loading=true
    #empty                — shown when rows is empty and loading=false
    #cell-{columnId}      — scoped slot for a specific column cell.
                            Slot props: { item: T, cell: Cell<T, unknown> }
                            Falls back to FlexRender if the slot is not provided.

  Events:
    row-click   — emitted when the user clicks a row
    load-more   — emitted when the user scrolls within 300px of the bottom
                  (use this to trigger server-side fetching of more pages)
-->
<template>
  <div
    ref="scrollerRef"
    class="tw:flex tw:flex-col tw:h-full tw:overflow-y-auto tw:overflow-x-auto"
    @scroll.passive="handleScroll"
  >
    <!-- ── Sticky header ─────────────────────────────────────────────────── -->
    <div
      class="tw:sticky tw:top-0 tw:z-[2] tw:min-h-[2.25rem] tw:min-w-max tw:shrink-0 tw:tracking-[0.125rem] tw:text-[var(--o2-text-3)] tw:bg-[var(--o2-card-bg-solid)]! tw:border-b tw:border-[var(--o2-border-color)]! row no-wrap items-center q-px-sm"
    >
      <div
        v-for="header in table.getHeaderGroups()[0].headers"
        :key="header.id"
        class="tw:px-2 tw:truncate text-caption text-weight-bold"
        :class="getAlignClass(header.column)"
        :style="getColumnStyle(header.column)"
      >
        <FlexRender
          :render="header.column.columnDef.header"
          :props="header.getContext()"
        />
      </div>
    </div>

    <!-- ── Virtual rows ───────────────────────────────────────────────────── -->
    <template v-if="!loading && allRows.length">
      <div
        class="tw:relative tw:w-full"
        :style="{ height: `${rowVirtualizer.getTotalSize()}px` }"
      >
        <div
          v-for="virtualRow in rowVirtualizer.getVirtualItems()"
          :key="virtualRow.key"
          class="oz-table__row tw:absolute tw:top-0 tw:left-0 tw:w-full tw:min-w-max tw:bg-[var(--o2-card-bg)] row no-wrap items-center q-px-sm cursor-pointer tw:border-b tw:border-[var(--o2-border-2)]!"
          :class="rowClass?.(allRows[virtualRow.index].original)"
          :style="{
            height: `${virtualRow.size}px`,
            transform: `translateY(${virtualRow.start}px)`,
          }"
          @click="$emit('row-click', allRows[virtualRow.index].original)"
        >
          <div
            v-for="cell in allRows[virtualRow.index].getVisibleCells()"
            :key="cell.id"
            class="tw:p-2 tw:overflow-hidden"
            :class="getAlignClass(cell.column)"
            :style="getColumnStyle(cell.column)"
          >
            <slot
              :name="`cell-${cell.column.id}`"
              :item="allRows[virtualRow.index].original"
              :cell="cell"
            >
              <FlexRender
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </slot>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Loading ───────────────────────────────────────────────────────── -->
    <slot v-else-if="loading" name="loading" />

    <!-- ── Empty ─────────────────────────────────────────────────────────── -->
    <slot v-else name="empty" />
  </div>
</template>

<!-- Module augmentation must live in a non-setup script block -->
<script lang="ts">
declare module "@tanstack/vue-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** flex: 1 1 0 — column grows to fill remaining space */
    grow?: boolean;
    /** base width in px when grow is true (falls back to ColumnDef.minSize) */
    width?: number;
    /** text alignment for both header and cell */
    align?: "left" | "center" | "right";
  }
}
export default {};
</script>

<script setup lang="ts" generic="T = Record<string, any>">
import { ref, computed } from "vue";
import {
  useVueTable,
  getCoreRowModel,
  FlexRender,
  type ColumnDef,
  type Column,
} from "@tanstack/vue-table";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { debounce } from "quasar";

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
  /** Fired when the user scrolls within 300px of the bottom. */
  "load-more": [];
}>();

// ─────────────────────────────────────────────────────────────────────────────
// Table instance
// ─────────────────────────────────────────────────────────────────────────────
const table = useVueTable({
  get data() {
    return props.rows.slice();
  },
  get columns() {
    return props.columns;
  },
  getCoreRowModel: getCoreRowModel(),
});

const allRows = computed(() => table.getRowModel().rows);

// ─────────────────────────────────────────────────────────────────────────────
// Virtual scroll
// ─────────────────────────────────────────────────────────────────────────────
const ROW_HEIGHT = 52; // matches the fixed row height in CSS

const scrollerRef = ref<HTMLElement | null>(null);

const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: allRows.value.length,
    getScrollElement: () => scrollerRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })),
);

const handleScroll = debounce(function () {
  const el = scrollerRef.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
    emit("load-more");
  }
}, 300);

// ─────────────────────────────────────────────────────────────────────────────
// Column sizing helpers
// ─────────────────────────────────────────────────────────────────────────────
function getColumnStyle(column: Column<T, unknown>): Record<string, string> {
  const meta = column.columnDef.meta;

  if (meta?.grow) {
    const min = meta.width ?? column.columnDef.minSize ?? 100;
    return { flex: "1 1 0", width: `${min}px`, overflow: "hidden" };
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

<style lang="scss" scoped>
/* ── Rows ────────────────────────────────────────────────────────────────── */
.oz-table__row {
  transition: background 0.15s ease;

  &:hover {
    background: color-mix(
      in srgb,
      var(--o2-theme-color) 15%,
      rgb(255, 255, 255)
    ) !important;
  }

  /**
   * Error variant — apply via rowClass prop:
   *   rowClass: (row) => row.errors > 0 ? 'oz-table__row--error' : ''
   */
  &--error {
    border-left: 0.1875rem solid var(--q-negative);
    padding-left: 0.3125rem;
  }
}

body.body--dark {
  .oz-table__row {
    &:hover {
      background: color-mix(
        in srgb,
        var(--o2-theme-color) 10%,
        rgb(39, 39, 39)
      ) !important;
    }
  }
}
</style>
