<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, inject } from "vue";
import type { Column } from "@tanstack/vue-table";
import { TABLE_CHECKBOX_COL_SIZE, type OTableColumnDef } from "../OTable.types";

const props = defineProps<{
  /** Number of skeleton rows. Default: 10 */
  rows?: number;
  /** Tanstack Column instances (in visible/order/pinning state). */
  tableColumns: Column<any, any>[];
  /** Render placeholder for the selection checkbox column */
  selectionEnabled?: boolean;
  /** Render placeholder for the expand chevron column */
  expansionEnabled?: boolean;
  /** Render placeholder for the drag-handle column */
  enableRowReorder?: boolean;
  /** Mirror the loaded body's row divider so the skeleton is the same height. */
  bordered?: boolean;
}>();

// Same injection OTableBodyCell uses — under horizontal scroll the real cells
// may grow past their size var, so capping maxWidth here (when the body doesn't)
// would make columns visibly widen the moment data arrives.
const horizontalScroll = inject<{ value: boolean } | null>("o2TableHorizontalScroll", null);

const BASE_WIDTHS = [55, 70, 60, 45, 65, 50, 75, 40, 58, 68, 48, 62];
const JITTER = [0, 6, -4, 3, -2, 5, -3, 2, -5, 4, -1, 6];

const cellWidth = (r: number, c: number): number => {
  const base = BASE_WIDTHS[c % BASE_WIDTHS.length] ?? 60;
  const jit = JITTER[(r + c) % JITTER.length] ?? 0;
  return Math.max(25, Math.min(85, base + jit));
};

const rowCount = computed(() => props.rows ?? 10);
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "-");

// Read columnDef as our richer OTableColumnDef shape.
const defOf = (col: Column<any, any>): OTableColumnDef =>
  col.columnDef as unknown as OTableColumnDef;

// `isAction` lives on meta after useTableCore's column conversion. useTableCore
// also treats a column literally named "actions" as one (isRigidColumn), so the
// skeleton must too — otherwise such a column renders as a text bar in a
// ~80px cell and then snaps to icon buttons on load.
const isActionCol = (col: Column<any, any>): boolean => {
  const def = defOf(col);
  return !!def.isAction || !!(def.meta as any)?.isAction || col.id === "actions";
};

const isSpacerCol = (col: Column<any, any>): boolean => !!(defOf(col).meta as any)?.spacer;

// Mirror OTableBodyCell's horizontal padding exactly: the invisible spacer must
// be able to reach 0 width, and compact columns are px-1.
const cellPadClass = (col: Column<any, any>): string => {
  const meta = (defOf(col).meta as any) ?? {};
  if (meta.spacer) return "px-0";
  return meta.compactPadding ? "px-1" : "px-2";
};

// Mirror OTableBodyCell's width + sticky-pinning behaviour exactly.
const cellStyle = (col: Column<any, any>): Record<string, any> => {
  const style: Record<string, any> = {};
  const meta = (defOf(col).meta as any) ?? {};
  const def = defOf(col);
  // Auto-width columns (meta.autoWidth) flex to fill remaining space —
  // OTableBodyCell skips the width style for these, and we must too, but it
  // still honours minSize so the elastic column can't collapse.
  const isAutoWidth = meta.autoWidth === true;
  if (isAutoWidth) {
    if (def.minSize) style.minWidth = `${def.minSize}px`;
  } else {
    const sizeVar = `var(--header-${safeId(col.id)}-size)`;
    style.width = sizeVar;
    // Rigid columns (index, actions) pin min+max so their width never depends
    // on siblings — without minWidth the skeleton's actions cell can be
    // squeezed below its budget and then jump wider on load.
    if (meta.fixedWidth) {
      style.minWidth = sizeVar;
      style.maxWidth = sizeVar;
    } else if (!horizontalScroll?.value) {
      style.maxWidth = sizeVar;
    }
  }
  const pin = col.getIsPinned?.();
  if (pin === "left") {
    style.position = "sticky";
    style.left = `${col.getStart?.("left") ?? 0}px`;
    style.zIndex = 1;
    style.background = "var(--color-table-cell-bg)";
    style.boxShadow = "2px 0 4px -2px var(--color-border-default)";
  } else if (pin === "right") {
    style.position = "sticky";
    style.right = `${col.getAfter?.("right") ?? 0}px`;
    style.zIndex = 1;
    style.background = "var(--color-table-cell-bg)";
    style.boxShadow = "-2px 0 4px -2px var(--color-border-default)";
  }
  return style;
};

const actionCountFor = (col: Column<any, any>): number => {
  const n = Number((defOf(col).meta as any)?.actionCount);
  if (Number.isFinite(n) && n > 0) return Math.min(6, Math.floor(n));
  return 2;
};

// The visual pill drawn INSIDE the fixed footprint below. The footprint itself
// is always the real button box (w-8 h-8 = ACTION_ICON_BTN in useTableCore), so
// the cell's geometry matches the loaded row exactly; only the shimmer inside is
// smaller, which reads as an icon rather than a heavy solid block.
const actionDimsFor = (col: Column<any, any>): string => {
  const s = (defOf(col).meta as any)?.actionSize;
  if (s === "button") return "h-5 w-5 rounded-default";
  if (s === "pill") return "h-4 w-10 rounded-default";
  return "h-4.5 w-4.5 rounded-default"; // icon
};

const alignClassFor = (col: Column<any, any>): string => {
  const a = (defOf(col).meta as any)?.align;
  if (a === "center") return "text-center";
  if (a === "right") return "text-right";
  return "text-left";
};
</script>

<template>
  <tbody
    data-test="o2-table-skeleton-body"
    aria-busy="true"
    aria-live="polite"
    aria-label="Loading data"
  >
    <tr
      v-for="r in rowCount"
      :key="`o2-skel-${r}`"
      class="o2-skel-row [animation:o2-skel-row-in_320ms_ease-out_forwards] opacity-0"
      :style="{
        animationDelay: `${(r - 1) * 40}ms`,
        height: 'var(--table-row-height, 2.25rem)',
      }"
    >
      <!-- Expand chevron placeholder — matches OTableBodyRow exactly -->
      <td v-if="expansionEnabled" class="w-4 min-w-4 px-0 text-center align-middle" />

      <!-- Selection checkbox placeholder — matches OTableBodyRow exactly -->
      <td
        v-if="selectionEnabled"
        class="text-left align-middle"
        :style="{
          width: TABLE_CHECKBOX_COL_SIZE + 'px',
          minWidth: TABLE_CHECKBOX_COL_SIZE + 'px',
          maxWidth: TABLE_CHECKBOX_COL_SIZE + 'px',
          paddingLeft: 'var(--spacing-table-edge)',
        }"
      >
        <span
          class="rounded-default border-skeleton-base inline-block h-3.5 w-3.5 border"
          aria-hidden="true"
        />
      </td>

      <!-- Drag handle placeholder -->
      <td v-if="enableRowReorder" class="w-4 min-w-4 px-0 text-center align-middle" />

      <!-- Data cells — class, data-test & style mirror OTableBodyCell exactly.
           The data-test prefix matters: OTable's edge-inset rule is keyed on
           `td[data-test^="o2-table-cell-"]`, so without it the skeleton would
           miss the 1rem first/last-cell inset and every row would shift
           horizontally the moment loading finished. -->
      <td
        v-for="(col, c) in tableColumns"
        :key="col.id"
        :data-test="`o2-table-cell-${col.id}`"
        :class="[
          cellPadClass(col),
          'align-middle',
          alignClassFor(col),
          isActionCol(col) ? 'w-0 whitespace-nowrap' : '',
          bordered ? 'border-table-row-divider border-b' : '',
        ]"
        :style="cellStyle(col)"
      >
        <!-- Action column → N placeholders, each in the REAL button footprint
             (w-8 h-8) so the cell measures identically to the loaded row. -->
        <span v-if="isActionCol(col)" class="inline-flex items-center gap-1 align-middle">
          <span
            v-for="a in actionCountFor(col)"
            :key="`a-${r}-${c}-${a}`"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <span
              :class="[
                'o2-skel-pill inline-block [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]',
                actionDimsFor(col),
              ]"
            />
          </span>
        </span>
        <!-- The invisible spacer column must stay empty: it collapses to 0 width
             in the loaded table, so drawing a bar in it would reserve width the
             real table never uses. -->
        <template v-else-if="isSpacerCol(col)" />
        <!-- Data column → chunky rounded-default bar with shimmer; td text-align positions it -->
        <span
          v-else
          class="o2-skel-pill rounded-default inline-block h-3 [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite] [background-size:200%_100%] align-middle [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)]"
          :style="{ width: `${cellWidth(r - 1, c)}%` }"
          aria-hidden="true"
        />
      </td>
    </tr>
  </tbody>
</template>

<style scoped>
/* keep(keyframes): reduced-motion opt-out for the skeleton animations. The
   `o2-skel-shimmer` / `o2-skel-row-in` keyframes themselves now live in
   styles/keyframes.css (shared with TenstackTable + OTablePagination) because
   the template starts them from `[animation:…]` utilities. This cancel rule
   stays as CSS: a `motion-reduce:animate-none` utility does not reliably
   outrank the arbitrary `[animation:…]` utility it has to override. Both
   selectors are this component's own elements, so scoping is safe. */
@media (prefers-reduced-motion: reduce) {
  .o2-skel-row {
    opacity: 1;
    animation: none;
    transform: none;
  }
  .o2-skel-pill {
    animation: none;
  }
}
</style>
