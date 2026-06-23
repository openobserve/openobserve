<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Cell, Row } from "@tanstack/vue-table";
import { computed, inject, ref } from "vue";
import { FlexRender } from "@tanstack/vue-table";
import { useSanitizedHtml } from "../composables/useSanitizedHtml";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import { copyToClipboard } from "@/utils/clipboard";

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
}>();

const emit = defineEmits<{
  "cell-click": [
    params: { columnId: string; row: any; value: any },
  ];
}>();

const meta = computed(() => props.cell.column.columnDef.meta as any);
const align = computed(() => meta.value?.align ?? "left");

// Record-name column → weight 500 (HANDOFF §8.2). Metadata columns stay 400.
// Only the default-rendered text path uses this; custom cells style their own.
const defaultTextClass = computed(() => [
  "tw:text-text-primary",
]);

const alignClass = computed(() => {
  if (align.value === "center") return "tw:text-center";
  if (align.value === "right") return "tw:text-right";
  return "tw:text-left";
});

const isAction = computed(() => meta.value?.isAction ?? false);

const slotAlignClass = computed(() => {
  // Action cells shrink to their content (inline-flex, no w-full) so the
  // column can be measured and sized to the buttons with no dead space.
  if (isAction.value) return "tw:inline-flex tw:items-center";
  // `min-w-0` lets the inner truncation wrapper actually shrink.
  if (align.value === "center") return "tw:flex tw:items-center tw:justify-center tw:w-full tw:min-w-0";
  if (align.value === "right") return "tw:flex tw:items-center tw:justify-end tw:w-full tw:min-w-0";
  return "tw:flex tw:items-center tw:w-full tw:min-w-0";
});

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
  if (rawValue.value === null || rawValue.value === undefined)
    return rawValue.value;
  return formatFn ? formatFn(rawValue.value, props.row.original) : rawValue.value;
});

const horizontalScroll = inject<{ value: boolean } | null>(
  "o2TableHorizontalScroll",
  null,
);

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
  return extra ? { ...base, ...extra } : base;
});

const highlightedHtml = computed(() => {
  if (!props.highlightText || !props.shouldHighlight || !props.getHighlightedHtml) {
    return null;
  }
  const raw = props.getHighlightedHtml(props.cell.column.id, displayValue.value);
  return raw ? sanitize(raw) : null;
});

// ── Tree mode: tw:inline chevron + indent for the designated tree column ──
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
</script>

<template>
  <td
    :data-test="`o2-table-cell-${cell.column.id}`"
    :class="[
      // Base text color for the whole cell so custom `#cell-*` slots (which skip
      // the default text wrapper) still inherit the theme-aware primary color
      // instead of falling back to a grey inherited value in dark mode. Inner
      // links/badges override this with their own color.
      'tw:text-text-primary',
      meta?.spacer ? 'tw:px-0 tw:align-middle' : (meta?.compactPadding ? 'tw:px-1 tw:align-middle' : 'tw:px-2 tw:align-middle'),
      bordered ? 'tw:border-b tw:border-[var(--color-table-row-divider)]' : '',
      alignClass,
      isAction ? 'tw:w-0 tw:whitespace-nowrap' : '',
       isPinned
        ? (rowSelected
            ? 'tw:bg-[var(--color-table-row-selected-bg)] tw:group-hover/row:bg-table-row-hover-bg tw:transition-colors tw:duration-150'
            : 'tw:bg-[var(--color-table-cell-bg)] tw:group-hover/row:bg-[var(--color-table-row-hover-bg)] tw:transition-colors tw:duration-150')
        : '',
      wrap
        ? 'tw:break-words tw:whitespace-normal'
        : horizontalScroll?.value
          ? 'tw:whitespace-nowrap'
          : isAction
            ? 'tw:whitespace-nowrap tw:overflow-hidden'
            : 'tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis',
      meta?.cellClass ?? '',
      isTreeColumn ? 'o2-tree-cell' : '',
      isTreeColumn && treeMeta?.isParent && treeMeta?.isExpanded ? 'o2-tree-parent-expanded' : '',
      isTreeColumn && treeMeta && (treeMeta.parentId !== null) ? 'o2-tree-child' : '',
      isTreeColumn && treeMeta?.isLastChild ? 'o2-tree-last-child' : '',
      isTreeColumn && treeMeta && (treeMeta.parentId !== null) && !treeMeta.hasChildren ? 'o2-tree-leaf' : '',
    ]"
    :style="[
      cellStyle,
      isTreeColumn
        ? {
            '--o2-tree-x': treeChevronX + 'px',
            '--o2-tree-parent-x': treeParentChevronX + 'px',
          }
        : {},
    ]"
    @click="handleClick"
  >
    <!-- Tree-mode wrapper: indent + chevron + cell content -->
    <div
      v-if="isTreeColumn"
      class="tw:flex tw:items-center tw:gap-1 tw:min-w-0"
      :style="{ paddingLeft: `${treeIndentPx}px` }"
    >
      <span
        v-if="treeMeta?.hasChildren || (treeMeta && treeMeta.parentId !== null)"
        class="o2-table-tree-chevron-slot"
      >
        <button
          v-if="treeMeta?.hasChildren"
          type="button"
          class="o2-table-tree-chevron"
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
          class="o2-table-tree-endpoint"
          aria-hidden="true"
        />
      </span>
      <div class="tw:flex-1 tw:min-w-0">
        <div v-if="$slots.default" :class="slotAlignClass">
          <div v-if="!isAction" class="tw:truncate tw:min-w-0 tw:flex-1"><slot /></div>
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

    <template v-else>
      <div v-if="$slots.default" :class="slotAlignClass">
        <!-- Non-action slot content truncates with an ellipsis by default. -->
        <div v-if="!isAction" class="tw:truncate tw:min-w-0 tw:flex-1"><slot /></div>
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
      class="tw:absolute tw:right-1 tw:opacity-0 group-hover:tw:opacity-100 tw:bg-[var(--color-surface-base)] tw:border tw:border-[var(--color-border-default)] tw:rounded tw:cursor-pointer tw:p-0.5 tw:text-[var(--color-text-muted)] tw:hover:text-[var(--color-text-primary)] tw:leading-none tw:transition-opacity"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="handleCopy"
    >
      <OIcon :name="copied ? 'check' : 'content-copy'" size="xs" />
    </button>
  </td>
</template>

<style scoped>
.o2-table-tree-chevron-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.o2-table-tree-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-secondary, #6b7280);
}
.o2-table-tree-chevron:hover {
  background: var(--color-table-row-hover-bg, rgba(0, 0, 0, 0.05));
  color: var(--color-text-primary);
}
/* Small square endpoint marker on leaf child rows, sits at the line junction */
.o2-table-tree-endpoint {
  width: 7px;
  height: 7px;
  background-color: var(--q-primary, #6366f1);
  opacity: 0.75;
  border-radius: 1px;
  box-shadow: 0 0 0 2px var(--color-table-cell-bg, #fff);
  z-index: 3;
  position: relative;
}

/* ── Tree connector lines (parent ↓ children) ────────────────── */
.o2-tree-cell {
  position: relative;
}

/* Vertical line going down from below the chevron, on expanded parent rows */
.o2-tree-parent-expanded::after {
  content: "";
  position: absolute;
  left: var(--o2-tree-x);
  top: calc(50% + 9px);
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary, #6366f1);
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
  left: var(--o2-tree-parent-x);
  top: 0;
  bottom: 0;
  width: 1.5px;
  background-color: var(--q-primary, #6366f1);
  opacity: 0.55;
  z-index: 1;
}
.o2-tree-child.o2-tree-last-child::before {
  bottom: 50%;
}
.o2-tree-child::after {
  content: "";
  position: absolute;
  left: var(--o2-tree-parent-x);
  top: 50%;
  /* Parent-row child (has its own chevron): stop the stub 9px before the
     chevron center so the line doesn't run into the icon. */
  width: calc(var(--o2-tree-x) - var(--o2-tree-parent-x) - 9px);
  height: 1.5px;
  background-color: var(--q-primary, #6366f1);
  opacity: 0.55;
  z-index: 1;
}
/* Leaf children (no chevron, endpoint marker dot instead): run the stub all
   the way to the dot's centre so the line visually touches it. */
.o2-tree-child.o2-tree-leaf::after {
  width: calc(var(--o2-tree-x) - var(--o2-tree-parent-x));
}
</style>
