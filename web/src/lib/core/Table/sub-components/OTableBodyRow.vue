<!-- Copyright 2026 OpenObserve Inc. -->

<script lang="ts">
// Every row registers its own window keydown listener, so they all see the
// same event — this shared set lets only the first responder act on it.
const handledNavEvents = new WeakSet<KeyboardEvent>();
</script>

<script setup lang="ts">
import type { Row, Table } from "@tanstack/vue-table";
import { computed, inject, ref, onMounted, onBeforeUnmount, useSlots } from "vue";
import OTableBodyCell from "./OTableBodyCell.vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";
import OTableExpandButton from "./OTableExpandButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import { TABLE_CHECKBOX_COL_SIZE as TABLE_CHECKBOX_COL_WIDTH } from "../OTable.types";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const props = defineProps<{
  row: Row<any>;
  table: Table<any>;
  clickable?: boolean;
  selectionEnabled?: boolean;
  selectionMultiple?: boolean;
  isRowSelected?: boolean;
  /** When provided, returning false for a row disables its selection checkbox
   *  (visual not-allowed cursor + ignored toggles). Used e.g. to block bulk
   *  selection of the root user in IAM. */
  isRowSelectable?: (row: any) => boolean;
  expansionEnabled?: boolean;
  canExpand?: boolean;
  isExpanded?: boolean;
  highlightText?: string;
  shouldHighlightColumn?: (columnId: string) => boolean;
  getHighlightedHtml?: (columnId: string, cellValue: any) => string | null;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  striped?: boolean;
  rowClassFn?: string | ((row: any) => string);
  rowStyleFn?: (row: any) => Record<string, any>;
  /** Virtual scroll: callback for measuring row DOM element height */
  measureEl?: (el: HTMLElement | null) => void;
  /** Variable-height mode (G8): the virtualizer's measureElement callback. When
   *  set, the row reports its real height (and is re-measured on reflow). */
  measureRowElement?: (el: Element | null) => void;
  /** Variable-height mode flag (G8). */
  dynamicRowHeight?: boolean;
  /** Virtual index of this row — written as `data-index` so the virtualizer can
   *  key the measurement in variable-height mode. */
  virtualIndex?: number;
  /** Status bar color — renders a 4px left border indicator per row */
  statusBarColor?: string;
  /** Enable hover-visible copy button on cells */
  enableCellCopy?: boolean;
  /** Per-cell inline style function */
  getCellStyle?: (params: { columnId: string; row: any; value: any }) => Record<string, any>;
  /** Pivot row-field cell merge (G17). */
  getPivotMerge?: (
    row: any,
    columnId: string,
  ) => { hideContent: boolean; hideBorder: boolean } | null;
  /** When true, renders a drag handle grip icon as the first cell. */
  enableRowReorder?: boolean;
  /** Per-row predicate: when false, the drag handle is hidden for this row. */
  rowDraggable?: boolean;
}>();

const emit = defineEmits<{
  "toggle-selection": [row: any];
  "toggle-expansion": [row: any];
  "row-click": [row: any, event: MouseEvent];
  "row-dblclick": [row: any, event: MouseEvent];
  "row-mouseenter": [row: any, event: MouseEvent];
  "row-mouseleave": [row: any];
  "cell-click": [params: { columnId: string; row: any; value: any }];
}>();

const slots = useSlots();

const rowRef = ref<HTMLElement | null>(null);

// Function ref for the row's <tr>: keeps rowRef in sync AND, in variable-height
// mode (G8), hands the element to the virtualizer's measureElement so its real
// height is measured (and re-measured on reflow via the virtualizer's observer).
function setRowRef(el: any) {
  rowRef.value = (el as HTMLElement) ?? null;
  if (props.dynamicRowHeight && props.measureRowElement && el) {
    props.measureRowElement(el);
  }
}

onMounted(() => {
  if (props.measureEl && rowRef.value) {
    props.measureEl(rowRef.value);
  }
});

const rowClass = computed(() => {
  if (typeof props.rowClassFn === "function") {
    return props.rowClassFn(props.row.original);
  }
  return props.rowClassFn ?? "";
});

const rowStyle = computed(() => {
  return props.rowStyleFn?.(props.row.original) ?? {};
});

const isStriped = computed(() => {
  return props.striped && props.row.index % 2 === 1;
});

const hasExpansionSlot = computed(() => !!slots.expansion);

// ── Tree mode ────────────────────────────────────────────────────
const treeCtx = inject(OTableTreeContextKey, null);
const treeMeta = computed(() => {
  if (!treeCtx?.value?.enabled) return null;
  return treeCtx.value.getMeta(props.row.original);
});
const isTreeParent = computed(() => !!treeMeta.value?.isParent);
const isTreeExpanded = computed(() => !!treeMeta.value?.isExpanded);
const showTreeWarning = computed(
  () =>
    treeCtx?.value?.enabled &&
    isTreeParent.value &&
    isTreeExpanded.value &&
    treeCtx.value.hasWarning(props.row.original) &&
    !!slots["tree-warning"],
);

/**
 * Horizontal offset (px) of the tree-column chevron from the row's left edge.
 * Used to align the warning row's content + connector line under the chevron.
 */
const treeConnectorX = computed(() => {
  const expansionWidth = props.expansionEnabled ? 32 : 0; // w-8
  const selectionWidth = props.selectionEnabled ? TABLE_CHECKBOX_COL_WIDTH : 0;
  const dragWidth = props.enableRowReorder ? 16 : 0; // w-4
  const cellPaddingLeft = 8; // px-2
  const halfChevron = 9; // 18px / 2
  const parentDepth = treeMeta.value?.depth ?? 0;
  return (
    expansionWidth + selectionWidth + dragWidth + cellPaddingLeft + parentDepth * 16 + halfChevron
  );
});

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, select, textarea, label, [role='button']")) {
    return;
  }
  emit("row-click", props.row.original, event);
}

function onDblclick(event: MouseEvent) {
  emit("row-dblclick", props.row.original, event);
}

// ── Row hover keyboard shortcuts ──────────────────────────────────
// Same pattern as PanelContainer.vue — direct keydown on window, gated
// by isHovered so only the currently hovered row responds.
// Pages just need data-row-action="edit|delete|pause" on their action buttons.
const isHovered = ref(false);
const isFocused = ref(false);

const ROW_ACTION_KEYS: Record<string, string> = {
  e: "edit",
  d: "duplicate",
  i: "inspect",
  p: "pause",
  r: "resume",
  v: "view",
  x: "export",
};

const handleKeydown = (e: KeyboardEvent) => {
  if ((!isHovered.value && !isFocused.value) || isInputFocused()) return;
  const rowEl = rowRef.value?.closest("tr");
  const active = document.activeElement;
  if (active && active !== rowEl && active !== document.body) return;
  if (handledNavEvents.has(e)) return;
  handledNavEvents.add(e);

  // Arrow up/down — move focus to the adjacent row
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const tr = rowRef.value?.closest("tr");
    if (!tr) return;
    let sibling = e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
    while (sibling && !sibling.matches("tr[data-test^='o2-table-row-']")) {
      sibling = e.key === "ArrowDown" ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    if (sibling instanceof HTMLElement) {
      e.preventDefault();
      isHovered.value = false;
      if (sibling.hasAttribute("tabindex")) sibling.focus();
      else sibling.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    }
    return;
  }

  // Enter triggers the row's click handler (same as a mouse click)
  if (e.key === "Enter") {
    e.preventDefault();
    rowRef.value?.closest("tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }

  const action =
    e.key === "Delete" || e.key === "Backspace" ? "delete" : ROW_ACTION_KEYS[e.key.toLowerCase()];

  if (!action) return;

  const btn = rowRef.value?.querySelector<HTMLElement>(`[data-row-action='${action}']`);
  if (btn) {
    e.preventDefault();
    btn.click();
  }
};

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));

function onRowMouseenter(e: MouseEvent) {
  isHovered.value = true;
  emit("row-mouseenter", props.row.original, e);
}
function onRowMouseleave() {
  isHovered.value = false;
  emit("row-mouseleave", props.row.original);
}

// focus/blur don't bubble — fires for the <tr> only, not inner action buttons.
function onRowFocus() {
  isFocused.value = true;
}
function onRowBlur() {
  isFocused.value = false;
}
</script>

<template>
  <tr
    :ref="setRowRef"
    :data-test="`o2-table-row-${row.index}`"
    :data-index="dynamicRowHeight ? virtualIndex : undefined"
    :tabindex="clickable ? 0 : undefined"
    :class="[
      'group/row',
      'transition-colors duration-150',
      clickable ? 'cursor-pointer' : '',
      'hover:bg-table-row-hover-bg',
      clickable ? 'focus-visible:bg-table-row-hover-bg focus:outline-none' : '',
      isRowSelected ? 'bg-table-row-selected-bg' : '',
      !isRowSelected && isStriped ? 'bg-table-row-striped-bg' : '',
      statusBarColor ? 'o2-table-row-with-status' : '',
      rowClass,
    ]"
    :style="{
      height: 'var(--table-row-height, 2.25rem)',
      ...(statusBarColor ? { '--row-status-color': statusBarColor } : {}),
      ...rowStyle,
    }"
    :data-status-bar="statusBarColor ? 'true' : undefined"
    @click="onClick"
    @dblclick="onDblclick"
    @mouseenter="onRowMouseenter"
    @mouseleave="onRowMouseleave"
    @focus="onRowFocus"
    @blur="onRowBlur"
  >
    <!-- Expand button cell -->
    <td
      v-if="expansionEnabled"
      :class="[
        'w-4 min-w-4 px-0 text-center align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
      data-test="o2-table-expand-cell"
    >
      <OTableExpandButton
        v-if="canExpand !== false"
        :expanded="isExpanded ?? false"
        :row-id="String(row.index)"
        @toggle="emit('toggle-expansion', row.original)"
      />
    </td>

    <!-- Selection checkbox cell -->
    <td
      v-if="selectionEnabled"
      :class="[
        'text-left align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
        isRowSelectable && !isRowSelectable(row.original) ? 'cursor-not-allowed' : '',
      ]"
      :style="{
        width: TABLE_CHECKBOX_COL_WIDTH + 'px',
        minWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
        maxWidth: TABLE_CHECKBOX_COL_WIDTH + 'px',
        paddingLeft: 'var(--spacing-table-edge)',
      }"
      data-test="o2-table-select-cell"
    >
      <div class="flex items-center justify-start">
        <OTableSelectCheckbox
          :model-value="isRowSelected ?? false"
          :row-id="String(row.index)"
          :disabled="isRowSelectable ? !isRowSelectable(row.original) : false"
          @update:model-value="emit('toggle-selection', row.original)"
        />
      </div>
    </td>

    <!-- Drag handle cell -->
    <td
      v-if="enableRowReorder"
      :class="[
        'w-4 min-w-4 px-0 text-center align-middle',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
      class="o2-table-drag-handle"
      data-test="o2-table-row-drag-handle"
    >
      <OIcon
        name="drag-indicator"
        size="xs"
        :class="[rowDraggable === false ? 'invisible' : '']"
        class="text-text-secondary cursor-grab transition-opacity"
      />
    </td>

    <!-- Data cells -->
    <OTableBodyCell
      v-for="cell in row.getVisibleCells()"
      :key="cell.id"
      :cell="cell"
      :row="row"
      :row-selected="isRowSelected"
      :highlight-text="highlightText"
      :should-highlight="shouldHighlightColumn?.(cell.column.id) ?? false"
      :get-highlighted-html="getHighlightedHtml"
      :wrap="wrap"
      :dense="dense"
      :bordered="bordered"
      :enable-cell-copy="enableCellCopy"
      :get-cell-style="getCellStyle"
      :pivot-merge="getPivotMerge ? getPivotMerge(row.original, cell.column.id) : null"
      @cell-click="emit('cell-click', $event)"
    >
      <template v-if="slots[`cell-${cell.column.id}`]" #default>
        <slot
          :name="`cell-${cell.column.id}`"
          :row="row.original"
          :value="cell.getValue()"
          :column="cell.column.columnDef"
          :index="row.index"
        />
      </template>
      <!-- Per-cell hover-action overlay (G13) — forwarded to every cell -->
      <template v-if="slots['cell-hover-actions']" #cell-hover-actions="caProps">
        <slot name="cell-hover-actions" v-bind="caProps" />
      </template>
    </OTableBodyCell>
  </tr>

  <!-- Tree-mode warning row (rendered between parent and its children) -->
  <tr
    v-if="showTreeWarning"
    :data-test="`o2-table-tree-warning-${row.index}`"
    class="bg-warning-surface"
  >
    <td
      :colspan="
        row.getVisibleCells().length +
        (expansionEnabled ? 1 : 0) +
        (selectionEnabled ? 1 : 0) +
        (enableRowReorder ? 1 : 0)
      "
      :class="[
        'o2-table-tree-warning-cell relative',
        bordered ? 'border-table-row-divider border-b' : '',
      ]"
      :style="{ '--tree-connector-x': treeConnectorX + 'px' }"
    >
      <div class="relative z-1 flex items-center justify-center">
        <slot name="tree-warning" :row="row.original" />
      </div>
    </td>
  </tr>

  <!-- Expanded row content -->
  <tr
    v-if="hasExpansionSlot && isExpanded"
    :data-test="`o2-table-expanded-row-${row.index}`"
    class="bg-table-row-expanded-bg"
  >
    <td
      :colspan="
        row.getVisibleCells().length +
        (expansionEnabled ? 1 : 0) +
        (selectionEnabled ? 1 : 0) +
        (enableRowReorder ? 1 : 0)
      "
      :class="bordered ? 'border-table-row-divider border-b' : ''"
    >
      <slot name="expansion" :row="row.original" />
    </td>
  </tr>
</template>

<style scoped>
/* keep(complex-state): per-row status spine on the row's first cell (a
   `> td:first-child` child-combinator target — an extra <td> would add a
   phantom column and misalign cells under table-fixed). Drawn as a stacked
   ::before rather than an inset box-shadow so the expand button — which is
   `size-6` inside a `w-4` cell, so it overflows the spine and paints a hover/
   active background — can no longer cover it (QA issue 2239 item 7: "clicking
   the arrow hides the blue line"). pointer-events:none keeps it click-through. */
.o2-table-row-with-status > td:first-child {
  position: relative;
  /* Inset the cell content past the 0.25rem status spine so the expand chevron
     isn't jammed against the coloured left border (QA #2239: arrow too close to
     the vertical status line vs main). Scoped to status rows so non-logs tables
     keep their default expand-column alignment. */
  padding-left: 0.5rem;
}
.o2-table-row-with-status > td:first-child::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0.25rem;
  background: var(--row-status-color, transparent);
  z-index: 2;
  pointer-events: none;
}

/* keep(generated-content): continuation of the tree connector vertical line
   through the warning row, drawn as an ::after off the inline connector-x var. */
.o2-table-tree-warning-cell::after {
  content: "";
  position: absolute;
  left: var(--tree-connector-x, 0);
  top: 0;
  bottom: 0;
  width: 0.09375rem;
  background-color: var(--color-theme-accent);
  opacity: 0.55;
  z-index: 0;
}
</style>
