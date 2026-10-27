<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Cell, Row } from "@tanstack/vue-table";
import type { VNode } from "vue";
import type { TooltipSide } from "@/lib/overlay/Tooltip/OTooltip.types";
import {
  Comment,
  Fragment,
  Text,
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  useSlots,
  watch,
} from "vue";
import { FlexRender } from "@tanstack/vue-table";
import { useSanitizedHtml } from "../composables/useSanitizedHtml";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { OTableTreeContextKey } from "../composables/useTableTree";
import {
  OTableCellActionsKey,
  OTableFocusToolbarKey,
  OTableOverflowTooltipKey,
  OTableToolbarOwnerKey,
} from "../OTable.types";
import { PIVOT_TABLE_TOTAL_COLUMN_WIDTH } from "@/utils/dashboard/constants";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18nTyped } from "@/types/i18n";
import { LAYER_ROOT_ATTR } from "@/lib/overlay/Drawer/drawerInset";

const slots = useSlots();

const { sanitize } = useSanitizedHtml();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function handleCopy(event: MouseEvent) {
  event.stopPropagation();
  // Copy what the user sees: the formatted display value (dashboard format fns
  // handle units, timestamps and no_value_replacement), not the raw cell value.
  const value = String(displayValue.value ?? "");
  const success = await copyToClipboard(value, t, { silent: true });
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
  compact?: boolean;
  bordered?: boolean;
  enableCellCopy?: boolean;
  getCellStyle?: (params: { columnId: string; row: any; value: any }) => Record<string, any>;
  /** Pivot row-field cell merge: hide the cell's content / inner border so a
   *  group of equal row-field values reads as one merged cell. */
  pivotMerge?: { hideContent: boolean; hideBorder: boolean } | null;
  /** Opt-in: the hover toolbar also opens on focus, with a roving tab stop and a touch kebab. */
  focusToolbar?: boolean;
}>();

const emit = defineEmits<{
  "cell-click": [params: { columnId: string; row: any; value: any }];
  "cell-contextmenu": [params: { columnId: string; row: any; value: any }];
}>();

const meta = computed(() => props.cell.column.columnDef.meta as any);
const align = computed(() => meta.value?.align ?? "left");

// Record-name column weight. Only the default-rendered text path uses this;
const defaultTextClass = computed(() => ["text-inherit"]);

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

// Slotted content truncates to one line unless `wrap` is on, mirroring the
// default (non-slot) behaviour.
const slotContentClass = computed(() =>
  props.wrap ? "min-w-0 flex-1 wrap-anywhere whitespace-normal" : "truncate min-w-0 flex-1",
);

const isPinned = computed(() => props.cell.column.getIsPinned?.() ?? false);

const pinOffset = computed(() => {
  if (!isPinned.value) return 0;
  if (isPinned.value === "left") return props.cell.column.getStart?.("left") ?? 0;
  if (isPinned.value === "right") return props.cell.column.getAfter?.("right") ?? 0;
  return 0;
});

const rawValue = computed(() => props.cell.getValue());

const displayValue = computed(() => {
  const formatFn = meta.value?.format as ((value: any, row: any) => any) | undefined;
  // Call `format` even for null/undefined: dashboard format fns turn empty cells
  // into the configured `no_value_replacement`.
  if (!formatFn) return rawValue.value;
  return formatFn(rawValue.value, props.row.original);
});

// ── Cell copy ─────────────────────────────────────────────────────
// Empty cells get no copy affordance (matches the pre-migration table).
const hasCopyableValue = computed(() => {
  const value = rawValue.value;
  if (value === null || value === undefined || value === "undefined") return false;
  return String(value).trim() !== "";
});

const showCellCopy = computed(
  () => !!props.enableCellCopy && !slots.default && hasCopyableValue.value,
);

// The button shares a flex row with the value instead of floating over it, so it
// can never overlap the text. Right-aligned (numeric) columns put the button on
// the left; left/center-aligned columns put it on the right.
const copyRowAlignClass = computed(() => {
  if (align.value === "center") return "justify-center";
  if (align.value === "right") return "justify-end";
  return "";
});

const copyValueClass = computed(() =>
  props.wrap ? "min-w-0 wrap-anywhere whitespace-normal" : "min-w-0 truncate",
);

const horizontalScroll = inject<{ value: boolean } | null>("o2TableHorizontalScroll", null);

// Keep right-pinned total cells in step with the sticky header and footer.
const stickyColTotals = inject<{ value: boolean } | null>("o2TableStickyColTotals", null);
const pivotTotalStyle = computed<Record<string, any>>(() => {
  if (!stickyColTotals?.value || !meta.value?._isTotalColumn) return {};
  const rightOffset = (meta.value._totalColRightIndex ?? 0) * PIVOT_TABLE_TOTAL_COLUMN_WIDTH;
  return {
    position: "sticky",
    right: `${rightOffset}px`,
    zIndex: 2,
    // Pinned width, so the column can't diverge from the fixed-width sticky
    // header under table-auto/w-full.
    width: `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    minWidth: `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    maxWidth: `${PIVOT_TABLE_TOTAL_COLUMN_WIDTH}px`,
    backgroundColor: "var(--color-table-cell-bg)",
    // Same left-edge separator as the header, so it runs down the whole column.
    boxShadow: "var(--shadow-sticky-right)",
  };
});

const isAutoWidth = computed(() => meta.value?.autoWidth === true);

const boundedFillTable = inject<{ value: boolean } | null>("o2TableBoundedFill", null);
// The clamp only counteracts `min-w-max`; a container-bounded table needs none.
const inBoundedFillTable = computed(
  () => !!boundedFillTable?.value && !!horizontalScroll?.value && !props.wrap,
);
const isBoundedFill = computed(
  () => meta.value?.fillRemaining === true && inBoundedFillTable.value,
);
// Sized siblings of a bounded filler pin to their own size and clip — otherwise
// a long value stretches the column (nothing else caps it when scrolling).
const isSizeClamped = computed(
  () =>
    inBoundedFillTable.value && !isAutoWidth.value && !isAction.value && !meta.value?.fixedWidth,
);

const cellStyle = computed(() => {
  const base: Record<string, any> = {};
  if (isAutoWidth.value) {
    // Elastic column: no width (absorbs the table's leftover space), but honour
    // minSize so it can't collapse — it pushes the table to scroll instead.
    // While WRAPPING the floor has to go: the pre-migration table gave the fill
    // column `flex: 1 1 0; min-width: 0` so it shrank to the row and the text
    // wrapped. Keeping minSize here pins the column open and nothing ever wraps.
    const min = props.cell.column.columnDef.minSize;
    if (min && !props.wrap) base.minWidth = `${min}px`;
    // `max-width: 0` keeps the filler's text out of the intrinsic-width sum, so
    // it takes the leftover instead of sizing to its longest value; min-width
    // still floors it. Never `width: 100%` — the percentage resolves against a
    // table sized from its own cells and the column runs away to ~500000px.
    if (isBoundedFill.value) base.maxWidth = "0";
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
    } else if (isSizeClamped.value) {
      // min: auto layout can't squeeze it; max: its content can't stretch it.
      base.minWidth = sizeVar;
      base.maxWidth = sizeVar;
    } else if (props.wrap) {
      // Wrapping drops the table's `min-w-max`, so auto layout would otherwise
      // squeeze these sized columns to fit the container. The pre-migration
      // table pinned them with `flex-shrink: 0` and let the ROW scroll instead;
      // only the fill column was allowed to shrink.
      base.minWidth = sizeVar;
    }
  }
  if (isPinned.value === "left") {
    base.position = "sticky";
    base.left = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "var(--shadow-sticky-left)";
  }
  if (isPinned.value === "right") {
    base.position = "sticky";
    base.right = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "var(--shadow-sticky-right)";
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
  () => !!treeCtx?.value?.enabled && treeCtx.value.treeColumnId === props.cell.column.id,
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
const treeChevronX = computed(() => 8 + (treeMeta.value?.depth ?? 0) * 16 + 9);
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

const { t } = useI18nTyped();

// Right-click. Emitted as plain values (not the TanStack cell) so a consumer's
// context menu keeps rendering correctly even after the virtualizer recycles
// the row underneath it. The event is NOT prevented — the consumer decides
// whether to open a menu or leave the native one alone.
function handleContextMenu() {
  emit("cell-contextmenu", {
    columnId: props.cell.column.id,
    row: props.row.original,
    value: props.cell.getValue(),
  });
}

// ── Cell hover-actions ────────────────────────────────────────────
// The shared single-active-cell context tracks which cell the pointer is over,
// keyed by `cell.id` (already `${row.id}_${column.id}`).
const hasCellActions = computed(() => !!slots["cell-hover-actions"]);
const cellActionsCtx = inject(OTableCellActionsKey, null);
const isCellActionActive = computed(() => cellActionsCtx?.activeCellKey.value === props.cell.id);

// Anchored to the cell's top edge (not the pointer) with an arrow pointing back at
// the row, so the toolbar can't be read as belonging to the row it is drawn over.
// The cell is one row tall and clips overflow, hence <body> teleport + inline coords.
const cellEl = ref<HTMLElement | null>(null);
const cellActionsEl = ref<HTMLElement | null>(null);
const cellActionsX = ref(0);
const cellActionsY = ref(0);
const cellActionsBelow = ref(false);
const cellActionsPointerX = ref(0);
const cellActionsArrowX = ref(0);

const cellActionsBeside = ref(false);

const cellActionsStyle = computed(() => ({
  // px because these are viewport coordinates read off getBoundingClientRect.
  left: `${cellActionsX.value}px`,
  top: `${cellActionsY.value}px`,
  transform: cellActionsBeside.value
    ? "translate(0, -50%)"
    : cellActionsBelow.value
      ? "translate(-50%, 0)"
      : "translate(-50%, -100%)",
}));

// Clip the rotated square to the half outside the bar plus a ~1.5px sliver that hides
// the bar's border; the full square would notch any filled control (the AI chip) 3px in.
const cellActionsArrowClass = computed(() =>
  cellActionsBelow.value
    ? "-top-1 border-t border-s [clip-path:polygon(0_0,100%_0,100%_26%,26%_100%,0_100%)]"
    : "-bottom-1 border-e border-b [clip-path:polygon(0_100%,100%_100%,100%_0,74%_0,0_74%)]",
);

// Arrow centre within the bar (`-ms-1` offsets its box), so it stays under the pointer
// after the bar is clamped to the window.
const cellActionsArrowStyle = computed(() => ({ left: `${cellActionsArrowX.value}px` }));

function onCellActionsEnter(event: MouseEvent) {
  if (!hasCellActions.value) return;
  cellActionsPointerX.value = event.clientX ?? 0;
  cellActionsX.value = cellActionsPointerX.value;
  // Pre-placed so the toolbar doesn't flash at the window origin before measurement.
  cellActionsY.value = cellEl.value?.getBoundingClientRect().top ?? event.clientY ?? 0;
  cellActionsBelow.value = false;
  // Beside the cell from the first frame, never under the pointer it was opened by.
  const rect = focusToolbarOn.value ? cellEl.value?.getBoundingClientRect() : undefined;
  if (rect) {
    cellActionsBeside.value = true;
    cellActionsX.value = rect.right;
    cellActionsY.value = rect.top + rect.height / 2;
  }
  cellActionsCtx?.setActiveCell(props.cell.id);
}
function onCellActionsLeave() {
  // Keyboard focus inside the cell or its toolbar keeps it open when the pointer drifts away.
  if (focusToolbarOn.value && focusWithin(document.activeElement)) return;
  if (hasCellActions.value) cellActionsCtx?.setActiveCell(null);
}

const overflowTooltipCtx = inject(OTableOverflowTooltipKey, null);
function onCellEnter(event: MouseEvent) {
  if (!isAction.value && meta.value?.cellOverflowTooltip !== false && cellEl.value) {
    overflowTooltipCtx?.enter(cellEl.value, cellActionsSide);
  }
  onCellActionsEnter(event);
}
function onCellLeave() {
  overflowTooltipCtx?.leave();
  onCellActionsLeave();
}
// The toolbar lives outside the <td>, so the cell's mouseleave has already fired by
// the time the pointer reaches it — re-assert the active cell to cancel the clear.
function onCellActionsHoverEnter() {
  cellActionsCtx?.setActiveCell(props.cell.id);
}

// Consumers typically render actions for only some columns, so the slot is empty on
// most cells. The toolbar now has a visible surface, and an empty one would read as a
// stray box floating next to the pointer — so only show it once the slot yields
// something. `v-if` inside the slot leaves comment placeholders, hence the walk.
function hasRenderedContent(nodes: VNode[] | undefined): boolean {
  return !!nodes?.some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Fragment) return hasRenderedContent(node.children as VNode[]);
    if (node.type === Text) return String(node.children ?? "").trim().length > 0;
    return true;
  });
}

// Short-circuit on the inactive cells: building throwaway vnodes for every cell of
// every render would cost far more than the one hovered cell it answers for.
const hasCellActionsContent = computed(() => {
  if (!isCellActionActive.value) return false;
  return hasRenderedContent(
    slots["cell-hover-actions"]?.({
      row: props.row.original,
      column: props.cell.column.columnDef,
      value: rawValue.value,
      active: true,
    }),
  );
});

// Read when the table's cut-off tooltip opens, so it can take the side this toolbar leaves free.
function cellActionsSide(): TooltipSide | null {
  if (!hasCellActions.value || !isCellActionActive.value || !hasCellActionsContent.value) {
    return null;
  }
  return cellActionsBelow.value ? "bottom" : "top";
}

// Fixed coordinates don't follow a scrolling row, so drop the toolbar instead of
// letting it hang over unrelated content.
function onScrollDismiss() {
  // Arrow keys scroll the focused cell into view; the toolbar follows it instead of vanishing.
  if (focusToolbarOn.value && focusWithin(document.activeElement)) {
    anchorToCell();
    void placeCellActions();
    return;
  }
  cellActionsCtx?.setActiveCell(null);
}

watch(isCellActionActive, async (active) => {
  if (!active) {
    window.removeEventListener("scroll", onScrollDismiss, true);
    return;
  }
  window.addEventListener("scroll", onScrollDismiss, { capture: true, passive: true });
  await placeCellActions();
});

async function placeCellActions() {
  await nextTick();
  const bar = cellActionsEl.value?.getBoundingClientRect();
  const cellRect = cellEl.value?.getBoundingClientRect();
  if (!bar || !cellRect) return;
  cellActionsBeside.value = focusToolbarOn.value;
  if (cellActionsBeside.value) {
    cellActionsY.value = cellRect.top + cellRect.height / 2;
    // A wide cell holds the bar at its own end, so the next cell's value stays readable.
    const inside = cellRect.width >= bar.width * 2;
    cellActionsX.value =
      !inside && cellRect.right + bar.width <= window.innerWidth
        ? cellRect.right
        : cellRect.right - bar.width;
    return;
  }
  // The sticky header, not the window edge, is the ceiling: flip below rather than cover it.
  const headerBottom =
    cellEl.value?.closest("table")?.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
  cellActionsBelow.value = cellRect.top - bar.height < Math.max(headerBottom, 0);
  cellActionsY.value = cellActionsBelow.value ? cellRect.bottom : cellRect.top;
  const half = bar.width / 2;
  cellActionsX.value = Math.min(
    Math.max(cellActionsPointerX.value, half),
    window.innerWidth - half,
  );
  // Keep the arrow clear of the bar's corner radius once the bar has been clamped.
  cellActionsArrowX.value = Math.min(
    Math.max(cellActionsPointerX.value - (cellActionsX.value - half), 10),
    Math.max(bar.width - 10, 10),
  );
}

onBeforeUnmount(() => window.removeEventListener("scroll", onScrollDismiss, true));

const TOOLBAR_CONTROLS =
  "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

const focusCtx = inject(OTableFocusToolbarKey, null);
const focusToolbarOn = computed(() => !!props.focusToolbar || !!focusCtx?.enabled.value);
const isFirstVisibleCell = computed(() => props.row.getVisibleCells()[0]?.id === props.cell.id);
// The touch kebab in the row's first cell; a v-for, not a v-if, so an empty list leaves the default render byte-identical.
const rowMenus = computed(() =>
  focusToolbarOn.value && hasCellActions.value && isFirstVisibleCell.value ? [props.cell.id] : [],
);
const cellTabIndex = computed(() => {
  if (!focusToolbarOn.value) return undefined;
  const current = focusCtx?.current.value ?? null;
  if (current) return current === props.cell.id ? 0 : -1;
  return focusCtx?.fallback.value === props.cell.id ? 0 : -1;
});
let skipFocusOpen = false;

if (focusToolbarOn.value) provide(OTableToolbarOwnerKey, () => cellEl.value);

const tableOf = () => cellEl.value?.closest("table") ?? null;

onMounted(() => {
  if (focusToolbarOn.value && isFirstVisibleCell.value) focusCtx?.refresh(tableOf());
});

onBeforeUnmount(() => {
  if (!focusToolbarOn.value) return;
  const table = tableOf();
  if (focusCtx?.current.value === props.cell.id) focusCtx.current.value = null;
  if (isFirstVisibleCell.value) focusCtx?.refresh(table);
});

// A popover a toolbar door opened (the locked gate's reason) lives in a portal; focus there is still the toolbar's.
function focusWithin(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (cellEl.value?.contains(target) || cellActionsEl.value?.contains(target)) return true;
  return target instanceof Element && !!target.closest("[data-o-popover-content]");
}

function anchorToCell() {
  const rect = cellEl.value?.getBoundingClientRect();
  if (!rect) return;
  cellActionsPointerX.value = rect.left + rect.width / 2;
  cellActionsBeside.value = true;
  cellActionsX.value = rect.right;
  cellActionsY.value = rect.top + rect.height / 2;
}

function toolbarControls(): HTMLElement[] {
  return [...(cellActionsEl.value?.querySelectorAll<HTMLElement>(TOOLBAR_CONTROLS) ?? [])];
}

function focusCell(reopen: boolean) {
  skipFocusOpen = !reopen;
  cellEl.value?.focus();
  skipFocusOpen = false;
}

function onCellFocusIn(event: FocusEvent) {
  if (!focusToolbarOn.value) return;
  if (focusCtx) focusCtx.current.value = props.cell.id;
  if (event.target !== cellEl.value || skipFocusOpen || !hasCellActions.value) return;
  anchorToCell();
  cellActionsBelow.value = false;
  cellActionsCtx?.setActiveCell(props.cell.id);
}

function onCellFocusOut(event: FocusEvent) {
  if (!focusToolbarOn.value || focusWithin(event.relatedTarget)) return;
  if (isCellActionActive.value) cellActionsCtx?.setActiveCell(null);
}

// The cell next to this one in a row or column; rows without a focusable cell there (expansions) are skipped.
function neighbourCell(key: string): HTMLElement | null {
  const td = cellEl.value;
  const tr = td?.parentElement;
  if (!td || !tr) return null;
  const isCell = (el: Element | null | undefined): el is HTMLElement =>
    el instanceof HTMLElement && el.hasAttribute("data-o2-focus-cell");
  if (key === "ArrowRight" || key === "ArrowLeft") {
    let el = key === "ArrowRight" ? td.nextElementSibling : td.previousElementSibling;
    while (el && !isCell(el))
      el = key === "ArrowRight" ? el.nextElementSibling : el.previousElementSibling;
    return isCell(el) ? el : null;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const index = Array.prototype.indexOf.call(tr.children, td);
  let row = key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
  while (row && !isCell(row.children[index]))
    row = key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
  const next = row?.children[index];
  return isCell(next) ? next : null;
}

function onCellKeydown(event: KeyboardEvent) {
  if (!focusToolbarOn.value || event.target !== cellEl.value) return;
  if (event.key === "Escape" && isCellActionActive.value) {
    event.stopPropagation();
    cellActionsCtx?.setActiveCell(null);
    return;
  }
  if (event.key === "Tab" && !event.shiftKey) {
    const first = toolbarControls()[0];
    if (!first) return leaveTable(event);
    event.preventDefault();
    first.focus();
    return;
  }
  const next = neighbourCell(event.key);
  if (!next) return;
  event.preventDefault();
  // OTable's container keyboard handler would otherwise move a second step from the new cell.
  event.stopPropagation();
  next.focus();
}

// Tab walks the toolbar in reading order; past its ends focus goes back to the cell, and on out of the table.
function onToolbarKeydown(event: KeyboardEvent) {
  if (!focusToolbarOn.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    focusCell(false);
    cellActionsCtx?.setActiveCell(null);
    return;
  }
  if (event.key !== "Tab") return;
  const controls = toolbarControls();
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey && index === 0) {
    event.preventDefault();
    focusCell(false);
  } else if (!event.shiftKey && index === controls.length - 1) {
    leaveTable(event);
  }
}

// Tab out of the roving set lands after the table, never on the next row's checkbox or chevron.
function leaveTable(event: KeyboardEvent): void {
  const table = tableOf();
  if (!table) return;
  const after = Array.from(document.querySelectorAll<HTMLElement>(TOOLBAR_CONTROLS)).find(
    (el) =>
      !table.contains(el) &&
      !cellActionsEl.value?.contains(el) &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0 &&
      !!(table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  if (!after) return;
  event.preventDefault();
  if (focusCtx) focusCtx.current.value = props.cell.id;
  after.focus();
}
</script>

<template>
  <td
    ref="cellEl"
    :data-test="`o2-table-cell-${cell.column.id}`"
    :class="[
      // Base text color for the whole cell so custom `#cell-*` slots (which skip
      // the default text wrapper) still inherit the theme-aware primary color
      // instead of falling back to a grey inherited value in dark mode. Inner
      // links/badges override this with their own color.
      'text-text-body',
      meta?.spacer || compact
        ? 'px-0 align-middle'
        : meta?.compactPadding
          ? 'px-1 align-middle'
          : 'px-2 align-middle',
      bordered && !pivotMerge?.hideBorder ? 'border-table-row-divider border-b' : '',
      alignClass,
      isAction ? 'w-0 whitespace-nowrap' : '',
      isPinned
        ? rowSelected
          ? 'bg-table-row-selected-bg group-hover/row:bg-table-row-hover-bg transition-colors duration-150'
          : 'bg-table-cell-bg group-hover/row:bg-table-row-hover-bg transition-colors duration-150'
        : '',
      wrap
        ? 'wrap-anywhere whitespace-normal'
        : horizontalScroll?.value
          ? isBoundedFill || isSizeClamped
            ? 'overflow-hidden text-ellipsis whitespace-nowrap'
            : 'whitespace-nowrap'
          : isAction
            ? 'overflow-hidden whitespace-nowrap'
            : 'overflow-hidden text-ellipsis whitespace-nowrap',
      meta?.cellClass ?? '',
      isTreeColumn ? 'relative' : '',
      enableCellCopy ? 'group/cell' : '',
      isTreeColumn && treeMeta?.isParent && treeMeta?.isExpanded ? 'o2-tree-parent-expanded' : '',
      isTreeColumn && treeMeta && treeMeta.parentId !== null ? 'o2-tree-child' : '',
      isTreeColumn && treeMeta?.isLastChild ? 'o2-tree-last-child' : '',
      isTreeColumn && treeMeta && treeMeta.parentId !== null && !treeMeta.hasChildren
        ? 'o2-tree-leaf'
        : '',
      focusToolbarOn
        ? 'focus-visible:outline-focus-ring-accent outline-none focus-visible:outline-2 focus-visible:-outline-offset-2'
        : '',
      rowMenus.length ? 'relative max-md:pe-12 pointer-coarse:pe-12' : '',
    ]"
    :tabindex="cellTabIndex"
    :data-o2-focus-cell="focusToolbarOn ? '' : undefined"
    :data-o2-row-first="focusToolbarOn && isFirstVisibleCell ? '' : undefined"
    :data-o2-cell-id="focusToolbarOn ? cell.id : undefined"
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
    @contextmenu="handleContextMenu"
    @mouseenter="onCellEnter"
    @mouseleave="onCellLeave"
    @focusin="onCellFocusIn"
    @focusout="onCellFocusOut"
    @keydown="onCellKeydown"
  >
    <!-- Tree-mode wrapper: indent + chevron + cell content -->
    <div
      v-if="isTreeColumn"
      class="flex min-w-0 items-center gap-1"
      :style="{ paddingLeft: `${treeIndentPx}px` }"
    >
      <span
        v-if="treeMeta?.hasChildren || (treeMeta && treeMeta.parentId !== null)"
        class="inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center"
      >
        <button
          v-if="treeMeta?.hasChildren"
          type="button"
          class="rounded-default text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body inline-flex h-4.5 w-4.5 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
          :data-test="`o2-table-tree-toggle-${cell.column.id}`"
          :aria-expanded="treeMeta?.isExpanded ? 'true' : 'false'"
          @click="onTreeToggle"
        >
          <OIcon :name="treeMeta?.isExpanded ? 'expand-more' : 'chevron-right'" size="sm" />
        </button>
        <span
          v-else
          class="bg-theme-accent rounded-default ring-table-cell-bg relative z-3 size-1.75 opacity-75 ring-2"
          aria-hidden="true"
        />
      </span>
      <div class="min-w-0 flex-1">
        <div v-if="$slots.default" :class="slotAlignClass">
          <div v-if="!isAction" :class="slotContentClass" data-o2-cell-clip><slot /></div>
          <slot v-else />
        </div>
        <FlexRender
          v-else-if="cell.column.columnDef.cell"
          :render="cell.column.columnDef.cell"
          :props="cell.getContext()"
        />
        <span v-else-if="highlightedHtml" :class="defaultTextClass" v-html="highlightedHtml" />
        <span v-else :class="defaultTextClass">
          {{ displayValue }}
        </span>
      </div>
    </div>

    <!-- Pivot-merged cells hide their content (the group's first row shows it). -->
    <template v-else-if="!pivotMerge?.hideContent">
      <div v-if="$slots.default" :class="slotAlignClass">
        <!-- Non-action slot content truncates with an ellipsis by default. -->
        <div v-if="!isAction" :class="slotContentClass" data-o2-cell-clip><slot /></div>
        <slot v-else />
      </div>
      <!-- Copy-enabled cell: value and copy button share a flex row, so the
           button sits beside the text instead of covering it. -->
      <div
        v-else-if="showCellCopy"
        class="flex w-full min-w-0 items-center"
        :class="copyRowAlignClass"
      >
        <FlexRender
          v-if="cell.column.columnDef.cell"
          :render="cell.column.columnDef.cell"
          :props="cell.getContext()"
        />
        <span
          v-else-if="highlightedHtml"
          :class="[defaultTextClass, copyValueClass]"
          data-o2-cell-clip
          v-html="highlightedHtml"
        />
        <span v-else :class="[defaultTextClass, copyValueClass]" data-o2-cell-clip>
          {{ displayValue }}
        </span>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          :data-test="`o2-table-cell-copy-${cell.column.id}`"
          :data-copied="copied ? 'true' : undefined"
          class="h-4! min-h-0! w-4! shrink-0 opacity-0 transition-opacity group-hover/cell:opacity-100 max-md:opacity-100"
          :class="align === 'right' ? 'order-first me-1' : 'ms-1'"
          :title="copied ? t('common.copiedExclaim') : t('common.copy')"
          @click="handleCopy"
        >
          <OIcon :name="copied ? 'check' : 'content-copy'" size="sm" />
        </OButton>
        <!-- Inline actions right of the copy button -->
        <slot
          name="copy-actions"
          :column-id="cell.column.id"
          :row="row.original"
          :value="rawValue"
        />
      </div>
      <!-- Custom cell render via TanStack FlexRender -->
      <FlexRender
        v-else-if="cell.column.columnDef.cell"
        :render="cell.column.columnDef.cell"
        :props="cell.getContext()"
      />
      <!-- Highlighted HTML (safe: composable escapes user content before wrapping) -->
      <span v-else-if="highlightedHtml" :class="defaultTextClass" v-html="highlightedHtml" />
      <!-- Default: plain text -->
      <span v-else :class="defaultTextClass">
        {{ displayValue }}
      </span>
    </template>

    <div
      v-for="menuKey in rowMenus"
      :key="menuKey"
      class="absolute inset-y-0 end-0 hidden items-center pe-1 max-md:flex pointer-coarse:flex"
      data-o2-row-menu
      @click.stop
    >
      <slot
        name="cell-hover-actions"
        :row="row.original"
        :column="cell.column.columnDef"
        :value="rawValue"
        :active="false"
        :menu="true"
      />
    </div>

    <!-- Hover-action toolbar, floated clear of the hovered row and teleported out of
         the cell, which is one row tall and clips overflow. The wrapper's padding is
         the gap the user sees AND the hover bridge from the row up to the buttons —
         without it the pointer would cross bare table on the way and activate the
         row above. -->
    <Teleport v-if="hasCellActions && isCellActionActive && hasCellActionsContent" to="body">
      <div
        ref="cellActionsEl"
        :[LAYER_ROOT_ATTR]="focusToolbarOn ? '' : undefined"
        class="o2-table-cell-hover-actions fixed z-1000"
        :class="[
          cellActionsBeside ? 'ps-1' : cellActionsBelow ? 'pt-1.5' : 'pb-1.5',
          focusToolbarOn ? 'max-md:hidden pointer-coarse:hidden' : '',
        ]"
        :style="cellActionsStyle"
        :data-test="`o2-table-cell-hover-actions-${cell.column.id}`"
        @mouseenter="onCellActionsHoverEnter"
        @mouseleave="onCellActionsLeave"
        @keydown="onToolbarKeydown"
        @focusout="onCellFocusOut"
      >
        <div class="relative">
          <!-- empty:hidden covers what the vnode walk can't see: slot content that IS a
               component but renders nothing, e.g. the AI button on a non-AI build. -->
          <div
            class="peer bg-surface-overlay border-border-default rounded-default flex items-center gap-1 border border-solid px-1 py-0.5 shadow-lg empty:hidden"
          >
            <slot
              name="cell-hover-actions"
              :row="row.original"
              :column="cell.column.columnDef"
              :value="rawValue"
              :active="isCellActionActive"
            />
          </div>
          <!-- The bar sits clear of the hovered row, so this arrow is the only thing
               tying it to the row it acts on. -->
          <span
            class="bg-surface-overlay border-border-default absolute -ms-1 size-2 rotate-45 border-solid peer-empty:hidden"
            :class="[cellActionsArrowClass, cellActionsBeside ? 'hidden' : '']"
            :style="cellActionsArrowStyle"
            :data-test="`o2-table-cell-hover-arrow-${cell.column.id}`"
            aria-hidden="true"
          />
        </div>
      </div>
    </Teleport>
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
