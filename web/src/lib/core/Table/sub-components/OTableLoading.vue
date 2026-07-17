<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";
import type { Column } from "@tanstack/vue-table";
import { TABLE_CHECKBOX_COL_SIZE, TABLE_CHECKBOX_COL_PAD_LEFT, type OTableColumnDef } from "../OTable.types";

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
}>();

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

// `isAction` lives on meta after useTableCore's column conversion.
const isActionCol = (col: Column<any, any>): boolean => {
  const def = defOf(col);
  return !!def.isAction || !!(def.meta as any)?.isAction;
};

// Mirror OTableBodyCell's width + sticky-pinning behaviour exactly.
const cellStyle = (col: Column<any, any>): Record<string, any> => {
  const style: Record<string, any> = {};
  // Auto-width columns (meta.autoWidth) flex to fill remaining space —
  // OTableBodyCell skips the width style for these, and we must too.
  const isAutoWidth = (defOf(col).meta as any)?.autoWidth === true;
  if (!isAutoWidth) {
    const sizeVar = `var(--header-${safeId(col.id)}-size)`;
    style.width = sizeVar;
    style.maxWidth = sizeVar;
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

const actionDimsFor = (col: Column<any, any>): string => {
  const s = (defOf(col).meta as any)?.actionSize;
  if (s === "button") return "h-7 w-7 rounded-md";
  if (s === "pill") return "h-5 w-12 rounded-md";
  return "h-[22px] w-[22px] rounded-md"; // icon (Vercel/GitHub style)
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
      class="o2-skel-row opacity-0 [animation:o2-skel-row-in_320ms_ease-out_forwards]"
      :style="{
        animationDelay: `${(r - 1) * 40}ms`,
        height: 'var(--o2-table-row-height)',
      }"
    >
      <!-- Expand chevron placeholder — matches OTableBodyRow exactly -->
      <td
        v-if="expansionEnabled"
        class="w-4 min-w-4 px-0 text-center align-middle"
      />

      <!-- Selection checkbox placeholder — matches OTableBodyRow exactly -->
      <td
        v-if="selectionEnabled"
        class="text-left align-middle"
        :style="{ width: TABLE_CHECKBOX_COL_SIZE + 'px', minWidth: TABLE_CHECKBOX_COL_SIZE + 'px', maxWidth: TABLE_CHECKBOX_COL_SIZE + 'px', paddingLeft: TABLE_CHECKBOX_COL_PAD_LEFT + 'px' }"
      >
        <span
          class="inline-block h-3.5 w-3.5 rounded-[3px] border border-[var(--color-skeleton-base)]"
          aria-hidden="true"
        />
      </td>

      <!-- Drag handle placeholder -->
      <td
        v-if="enableRowReorder"
        class="w-4 min-w-4 px-0 text-center align-middle"
      />

      <!-- Data cells — class & style mirror OTableBodyCell exactly -->
      <td
        v-for="(col, c) in tableColumns"
        :key="col.id"
        :class="[
          'px-2 align-middle',
          alignClassFor(col),
          isActionCol(col) ? 'w-0 whitespace-nowrap' : '',
        ]"
        :style="cellStyle(col)"
      >
        <!-- Action column → inline group of N icon-sized placeholders -->
        <span
          v-if="isActionCol(col)"
          class="inline-flex items-center gap-1 align-middle"
        >
          <span
            v-for="a in actionCountFor(col)"
            :key="`a-${r}-${c}-${a}`"
            :class="['o2-skel-pill inline-block shrink-0 [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)] [background-size:200%_100%] [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite]', actionDimsFor(col)]"
            aria-hidden="true"
          />
        </span>
        <!-- Data column → chunky rounded bar with shimmer; td text-align positions it -->
        <span
          v-else
          class="o2-skel-pill inline-block h-3 rounded-md align-middle [background:linear-gradient(90deg,var(--color-skeleton-base)_0%,var(--color-skeleton-highlight)_50%,var(--color-skeleton-base)_100%)] [background-size:200%_100%] [animation:o2-skel-shimmer_1.5s_ease-in-out_infinite]"
          :style="{ width: `${cellWidth(r - 1, c)}%` }"
          aria-hidden="true"
        />
      </td>
    </tr>
  </tbody>
</template>

<style>
@keyframes o2-skel-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes o2-skel-row-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

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
