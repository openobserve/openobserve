<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Cell, Row } from "@tanstack/vue-table";
import { computed, inject, ref, useSlots } from "vue";
import { FlexRender } from "@tanstack/vue-table";
import { useSanitizedHtml } from "../composables/useSanitizedHtml";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import { OTableCellActionsKey } from "../OTable.types";
import { PIVOT_TABLE_TOTAL_COLUMN_WIDTH } from "@/utils/dashboard/constants";
import { copyToClipboard } from "@/utils/clipboard";

const slots = useSlots();

const { sanitize } = useSanitizedHtml();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function handleCopy(event: MouseEvent) {
  event.stopPropagation();
  const value = String(props.cell.getValue() ?? "");
  const success = await copyToClipboard(value, { silent: true });
  if (success) {
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  }
}

const props = defineProps<{
  cell: Cell<any, any>;
  row: Row<any>;
  rowSelected?: boolean;
  highlightText?: string;
  shouldHighlight?: boolean;
  getHighlightedHtml?: (columnId: string, cellValue: any) => string | null;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  enableCellCopy?: boolean;
  getCellStyle?: (params: {
    columnId: string;
    row: any;
    value: any;
  }) => Record<string, any>;
  /** Pivot row-field cell merge (G17): hide the cell's content / inner border so
   *  a group of equal row-field values reads as one merged cell. */
  pivotMerge?: { hideContent: boolean; hideBorder: boolean } | null;
}>();

const emit = defineEmits<{
  "cell-click": [
    params: { columnId: string; row: any; value: any },
  ];
}>();

const meta = computed(() => props.cell.column.columnDef.meta as any);
const align = computed(() => meta.value?.align ?? "left");

// Record-name column weight. Only the default-rendered text path uses this;
// custom cells style their own.
const defaultTextClass = computed(() => [
  "text-text-body",
]);

const alignClass = computed(() => {
  if (align.value === "center") return "text-center";
  if (align.value === "right") return "text-right";
  return "text-left";
});

const isAction = computed(() => meta.value?.isAction ?? false);

const slotAlignClass = computed(() => {
  // Action cells shrink to their content (inline-flex, no w-full) so the
  // column can be measured and sized to the buttons with no dead space.
  if (isAction.value) return "inline-flex items-center";
  // `min-w-0` lets the inner truncation wrapper actually shrink.
  if (align.value === "center") return "flex items-center justify-center w-full min-w-0";
  if (align.value === "right") return "flex items-center justify-end w-full min-w-0";
  return "flex items-center w-full min-w-0";
});

// Slotted cell content truncates to one line by default, but in `wrap` mode it
// must wrap (multi-line) — otherwise a slotted logs cell would clip instead of
// growing the row height. Mirrors the default (non-slot) wrap behaviour.
const slotContentClass = computed(() =>
  props.wrap
    ? "min-w-0 flex-1 break-words whitespace-normal"
    : "truncate min-w-0 flex-1",
);

const isPinned = computed(() => props.cell.column.getIsPinned?.() ?? false);

const pinOffset = computed(() => {
  if (!isPinned.value) return 0;
  if (isPinned.value === "left")
    return props.cell.column.getStart?.("left") ?? 0;
  if (isPinned.value === "right")
    return props.cell.column.getAfter?.("right") ?? 0;
  return 0;
});

const rawValue = computed(() => props.cell.getValue());

const displayValue = computed(() => {
  const formatFn = meta.value?.format as
    | ((value: any, row: any) => any)
    | undefined;
  // Call `format` even for null/undefined — dashboard format fns turn empty
  // cells into the configured `no_value_replacement` (they'd render blank
  // otherwise). When no format fn is set, pass the raw value through unchanged.
  if (!formatFn) return rawValue.value;
  return formatFn(rawValue.value, props.row.original);
});

const horizontalScroll = inject<{ value: boolean } | null>(
  "o2TableHorizontalScroll",
  null,
);

// Pivot: right-pinned total columns (P1-A3) — keep body total cells in step with
// the sticky header + grand-total footer on horizontal scroll.
const stickyColTotals = inject<{ value: boolean } | null>(
  "o2TableStickyColTotals",
  null,
);
const pivotTotalStyle = computed<Record<string, any>>(() => {
  if (!stickyColTotals?.value || !meta.value?._isTotalColumn) return {};
  const rightOffset =
    (meta.value._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  return {
    position: "sticky",
    right: `${rightOffset}px`,
    zIndex: 2,
    width: `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    backgroundColor: "var(--color-table-cell-bg)",
  };
});

const isAutoWidth = computed(() => meta.value?.autoWidth === true);

const cellStyle = computed(() => {
  const base: Record<string, any> = {};
  if (isAutoWidth.value) {
    // Elastic column: no width (absorbs the table's leftover space), but honour
    // minSize so it can't collapse — it pushes the table to scroll instead.
    const min = props.cell.column.columnDef.minSize;
    if (min) base.minWidth = `${min}px`;
  } else {
    const sizeVar = `var(--header-${props.cell.column.id.replace(/[^a-zA-Z0-9]/g, "-")}-size)`;
    base.width = sizeVar;
    // Rigid columns (index, actions) pin min+max to the size var so their width
    // never depends on — or is squeezed by — the sibling data columns.
    if (meta.value?.fixedWidth) {
      base.minWidth = sizeVar;
      base.maxWidth = sizeVar;
    } else if (!horizontalScroll?.value) {
      base.maxWidth = sizeVar;
    }
  }
  if (isPinned.value === "left") {
    base.position = "sticky";
    base.left = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "2px 0 4px -2px var(--color-border-default)";
  }
  if (isPinned.value === "right") {
    base.position = "sticky";
    base.right = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "-2px 0 4px -2px var(--color-border-default)";
  }
  const extra = props.getCellStyle?.({
    columnId: props.cell.column.id,
    row: props.row.original,
    value: rawValue.value,
  });
  const merged = extra ? { ...base, ...extra } : base;
  // Right-pinned pivot total columns win (sticky position + fixed width).
  return { ...merged, ...pivotTotalStyle.value };
});

const highlightedHtml = computed(() => {
  if (!props.highlightText || !props.shouldHighlight || !props.getHighlightedHtml) {
    return null;
  }
  const raw = props.getHighlightedHtml(props.cell.column.id, displayValue.value);
  return raw ? sanitize(raw) : null;
});

// ── Tree mode: inline chevron + indent for the designated tree column ──
const treeCtx = inject(OTableTreeContextKey, null);
const isTreeColumn = computed(
  () =>
    !!treeCtx?.value?.enabled &&
    treeCtx.value.treeColumnId === props.cell.column.id,
);
const treeMeta = computed(() => {
  if (!isTreeColumn.value) return null;
  return treeCtx?.value?.getMeta(props.row.original) ?? null;
});
const treeIndentPx = computed(() => (treeMeta.value?.depth ?? 0) * 16);
/**
 * X-offset of the chevron centre, relative to this td's left edge.
 * Used to position connector pseudo-elements at the correct depth.
 *   td padding-left (8px) + depth indent + half chevron (9px)
 * For child rows we want the horizontal stub to start at the *parent's*
 * chevron x, which is `depth - 1` indents in.
 */
const treeChevronX = computed(
  () => 8 + (treeMeta.value?.depth ?? 0) * 16 + 9,
);
const treeParentChevronX = computed(
  () => 8 + Math.max((treeMeta.value?.depth ?? 0) - 1, 0) * 16 + 9,
);

function onTreeToggle(event: MouseEvent) {
  event.stopPropagation();
  if (!treeCtx?.value || !treeMeta.value?.hasChildren) return;
  treeCtx.value.toggle(props.row.original);
}

function handleClick() {
  emit("cell-click", {
    columnId: props.cell.column.id,
    row: props.row.original,
    value: props.cell.getValue(),
  });
}

// ── Cell hover-actions (G13) ──────────────────────────────────────
// A `#cell-actions` overlay renders inside every data cell; the shared
// single-active-cell context (provided by OTable) tracks which cell the pointer
// is over so the consumer's overlay can mount its (heavy) menu for only that one
// cell. TanStack's `cell.id` is already `${row.id}_${column.id}`, so it uniquely
// keys the cell.
const hasCellActions = computed(() => !!slots["cell-hover-actions"]);
const cellActionsCtx = inject(OTableCellActionsKey, null);
const isCellActionActive = computed(
  () => cellActionsCtx?.activeCellKey.value === props.cell.id,
);
function onCellActionsEnter() {
  if (hasCellActions.value) cellActionsCtx?.setActiveCell(props.cell.id);
}
function onCellActionsLeave() {
  if (hasCellActions.value) cellActionsCtx?.setActiveCell(null);
}
</script>

<template>
  <td
    :data-test="`o2-table-cell-${cell.column.id}`"
    :class="[
      // Base text color for the whole cell so custom `#cell-*` slots (which skip
      // the default text wrapper) still inherit the theme-aware primary color
      // instead of falling back to a grey inherited value in dark mode. Inner
      // links/badges override this with their own color.
      'text-text-body',
      meta?.spacer ? 'px-0 align-middle' : (meta?.compactPadding ? 'px-1 align-middle' : 'px-2 align-middle'),
      (bordered && !pivotMerge?.hideBorder) ? 'border-b border-table-row-divider' : '',
      alignClass,
      isAction ? 'w-0 whitespace-nowrap' : '',
       isPinned
        ? (rowSelected
            ? 'bg-table-row-selected-bg group-hover/row:bg-table-row-hover-bg transition-colors duration-150'
            : 'bg-table-cell-bg group-hover/row:bg-table-row-hover-bg transition-colors duration-150')
        : '',
      wrap
        ? 'break-words whitespace-normal'
        : horizontalScroll?.value
          ? 'whitespace-nowrap'
          : isAction
            ? 'whitespace-nowrap overflow-hidden'
            : 'whitespace-nowrap overflow-hidden text-ellipsis',
      meta?.cellClass ?? '',
      (isTreeColumn || hasCellActions) ? 'relative' : '',
      isTreeColumn && treeMeta?.isParent && treeMeta?.isExpanded ? 'o2-tree-parent-expanded' : '',
      isTreeColumn && treeMeta && (treeMeta.parentId !== null) ? 'o2-tree-child' : '',
      isTreeColumn && treeMeta?.isLastChild ? 'o2-tree-last-child' : '',
      isTreeColumn && treeMeta && (treeMeta.parentId !== null) && !treeMeta.hasChildren ? 'o2-tree-leaf' : '',
    ]"
    :style="[
      cellStyle,
      isTreeColumn
        ? {
            '--tree-x': treeChevronX + 'px',
            '--tree-parent-x': treeParentChevronX + 'px',
          }
        : {},
    ]"
    @click="handleClick"
    @mouseenter="onCellActionsEnter"
    @mouseleave="onCellActionsLeave"
  >
    <!-- Tree-mode wrapper: indent + chevron + cell content -->
    <div
      v-if="isTreeColumn"
      class="flex items-center gap-1 min-w-0"
      :style="{ paddingLeft: `${treeIndentPx}px` }"
    >
      <span
        v-if="treeMeta?.hasChildren || (treeMeta && treeMeta.parentId !== null)"
        class="inline-flex items-center justify-center w-4.5 h-4.5 shrink-0"
      >
        <button
          v-if="treeMeta?.hasChildren"
          type="button"
          class="inline-flex items-center justify-center w-4.5 h-4.5 p-0 bg-transparent border-0 rounded-default cursor-pointer text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body"
          :data-test="`o2-table-tree-toggle-${cell.column.id}`"
          :aria-expanded="treeMeta?.isExpanded ? 'true' : 'false'"
          @click="onTreeToggle"
        >
          <OIcon
            :name="treeMeta?.isExpanded ? 'expand-more' : 'chevron-right'"
            size="sm"
          />
        </button>
        <span
          v-else
          class="size-1.75 bg-theme-accent opacity-75 rounded-default ring-2 ring-table-cell-bg z-3 relative"
          aria-hidden="true"
        />
      </span>
      <div class="flex-1 min-w-0">
        <div v-if="$slots.default" :class="slotAlignClass">
          <div v-if="!isAction" :class="slotContentClass"><slot /></div>
          <slot v-else />
        </div>
        <FlexRender
          v-else-if="cell.column.columnDef.cell"
          :render="cell.column.columnDef.cell"
          :props="cell.getContext()"
        />
        <span
          v-else-if="highlightedHtml"
          :class="defaultTextClass"
          v-html="highlightedHtml"
        />
        <span v-else :class="defaultTextClass">
          {{ displayValue }}
        </span>
      </div>
    </div>

    <!-- Pivot-merged cells hide their content (the group's first row shows it). -->
    <template v-else-if="!pivotMerge?.hideContent">
      <div v-if="$slots.default" :class="slotAlignClass">
        <!-- Non-action slot content truncates with an ellipsis by default. -->
        <div v-if="!isAction" :class="slotContentClass"><slot /></div>
        <slot v-else />
      </div>
      <!-- Custom cell render via TanStack FlexRender -->
      <FlexRender
        v-else-if="cell.column.columnDef.cell"
        :render="cell.column.columnDef.cell"
        :props="cell.getContext()"
      />
      <!-- Highlighted HTML (safe: composable escapes user content before wrapping) -->
      <span
        v-else-if="highlightedHtml"
        :class="defaultTextClass"
        v-html="highlightedHtml"
      />
      <!-- Default: plain text -->
      <span v-else :class="defaultTextClass">
        {{ displayValue }}
      </span>
    </template>

    <!-- Cell copy button (visible on hover) -->
    <button
      v-if="enableCellCopy && !$slots.default"
      type="button"
      :data-test="`o2-table-cell-copy-${cell.column.id}`"
      class="absolute right-1 opacity-0 group-hover:opacity-100 bg-surface-base border border-border-default rounded-default cursor-pointer p-0.5 text-text-muted hover:text-text-body leading-none transition-opacity"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>

    <!-- Per-cell hover-action overlay (G13). `active` is true only for the cell
         the pointer currently hovers (debounced in OTable) so consumers mount
         their action menu lazily. Spans the cell's right edge full-height so it
         anchors BOTH flow content (plain buttons, flex-centered right) AND
         self-positioned content (e.g. CellActions' own `absolute right-0` lands
         at the cell's right edge, not on a tiny point-box). -->
    <div
      v-if="hasCellActions"
      class="o2-table-cell-hover-actions absolute inset-y-0 right-0 z-2 flex items-center"
      :data-test="`o2-table-cell-hover-actions-${cell.column.id}`"
    >
      <slot
        name="cell-hover-actions"
        :row="row.original"
        :column="cell.column.columnDef"
        :value="rawValue"
        :active="isCellActionActive"
      />
    </div>
  </td>
</template>

<style scoped>
/* keep(generated-content): tree connector lines (parent ↓ children) drawn as
   ::before/::after pseudo-elements positioned off inline --tree-x vars. */

/* Vertical line going down from below the chevron, on expanded parent rows */
.o2-tree-parent-expanded::after {
  content: "";
  position: absolute;
  left: var(--tree-x, 0);
  top: calc(50% + 0.5625rem);
  bottom: 0;
  width: 0.09375rem;
  background-color: var(--color-theme-accent);
  opacity: 0.55;
  z-index: 1;
}

/* Vertical + horizontal connector on child rows.
 * The vertical line sits at the *parent's* chevron x (one indent in from this row).
 * The horizontal stub runs from there to this row's own chevron x.
 */
.o2-tree-child::before {
  content: "";
  position: absolute;
  left: var(--tree-parent-x, 0);
  top: 0;
  bottom: 0;
  width: 0.09375rem;
  background-color: var(--color-theme-accent);
  opacity: 0.55;
  z-index: 1;
}
.o2-tree-child.o2-tree-last-child::before {
  bottom: 50%;
}
.o2-tree-child::after {
  content: "";
  position: absolute;
  left: var(--tree-parent-x, 0);
  top: 50%;
  /* Parent-row child (has its own chevron): stop the stub 0.5625rem before the
     chevron center so the line doesn't run into the icon. */
  width: calc(var(--tree-x, 0) - var(--tree-parent-x, 0) - 0.5625rem);
  height: 0.09375rem;
  background-color: var(--color-theme-accent);
  opacity: 0.55;
  z-index: 1;
}
/* Leaf children (no chevron, endpoint marker dot instead): run the stub all
   the way to the dot's centre so the line visually touches it. */
.o2-tree-child.o2-tree-leaf::after {
  width: calc(var(--tree-x, 0) - var(--tree-parent-x, 0));
}
</style>
