<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex flex-col h-full min-h-0 w-full" data-test="o-field-list">
    <!-- before-list slot (stream selectors, etc.) -->
    <div v-if="$slots['before-list']" class="shrink-0">
      <slot name="before-list" />
    </div>

    <!-- Search input -->
    <div v-if="showSearch" class="shrink-0 py-1.5">
      <OInput
        :model-value="searchModel"
        data-test="o-field-list-search"
        :placeholder="searchPlaceholder"
        clearable
        @update:model-value="onSearchChange"
      >
        <template #icon-left>
          <OIcon name="search" size="sm" class="o-field-list__search-icon" />
        </template>
      </OInput>
    </div>

    <!-- Scrollable field list body -->
    <div ref="scrollContainerRef" class="flex-1 overflow-y-auto overflow-x-hidden min-h-0" @scroll="onScroll">
      <!-- Loading state -->
      <div
        v-if="loading"
        class="w-full"
      >
        <slot name="loading" />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="paginatedFields.length === 0"
        class="flex items-center justify-center p-4 text-field-list-empty-text text-xs"
      >
        <slot name="empty" />
      </div>

      <!-- Field rows (hidden while loading) -->
      <template v-if="!loading">
      <template
        v-for="row in paginatedFields"
        :key="rowKey ? row[rowKey] : row.name"
      >
        <!-- Group header -->
        <div
          v-if="row.isGroup"
          class="o-field-list__group-header h-7 flex items-center justify-between text-[0.6875rem] font-semibold text-(--color-field-list-group-text) cursor-default select-none tracking-[0.01em] sticky top-0 z-[2] bg-transparent"
          :data-test="`o-field-list-group-${row.groupName}`"
        >
          <slot name="group-header" :row="row" :group-name="row.groupName">
            <span class="o-field-list__group-header-text">{{
              row.groupName
            }}</span>
          </slot>
        </div>

        <!-- Field row -->
        <div
          v-else
          class="o-field-list__row mt-[0.25rem] flex items-center w-full min-h-[24px] p-0 relative cursor-pointer rounded-[0.1875rem] text-xs leading-[0.8rem]"
          :class="{ 'o-field-list__row--draggable': draggable }"
          :data-test="`o-field-list-row-${row.name}`"
          :draggable="draggable && isDragEnabled(row, row._index ?? 0)"
          @click="(e: MouseEvent) => onRowClick(row, e)"
          @dblclick="(e: MouseEvent) => onRowDblClick(row, e)"
          @dragstart="(e: DragEvent) => onDragStart(row, e)"
          @dragend="(e: DragEvent) => onDragEnd(row, e)"
          @dragover.prevent
        >
          <div class="flex items-center gap-1 min-w-0 flex-1">
            <slot
              name="field-row"
              :row="row"
              :index="row._index"
              :draggable="draggable"
              :is-drag-enabled="isDragEnabled(row, row._index ?? 0)"
            >
              <OFieldRow>
                <OIcon
                  v-if="draggable"
                  name="drag-indicator"
                  size="sm"
                  :class="[
                    'shrink-0 inline-flex items-center justify-center w-4 text-[var(--color-field-list-drag-icon)]',
                    isDragEnabled(row, row._index ?? 0)
                      ? 'cursor-grab'
                      : 'cursor-not-allowed opacity-40',
                  ]"
                  data-test="o-field-list-drag-indicator"
                />
                <OFieldLabel :field="row" :show-type-icon="true" />
              </OFieldRow>
            </slot>
          </div>
          <div v-if="$slots['field-actions']" class="o-field-list__actions flex items-stretch shrink-0 invisible opacity-0 transition-[opacity,visibility] duration-[120ms] ease-[ease] absolute right-1 top-1/2 -translate-y-1/2 border border-(--color-field-list-actions-border) rounded-[0.1875rem] overflow-hidden bg-(--color-field-list-actions-bg)">
            <slot name="field-actions" :row="row" :index="row._index" />
          </div>
        </div>

        <!-- Expanded content -->
        <div
          v-if="isExpanded(row) && $slots.expansion"
          class="w-full pt-1 pb-[0.375rem] border border-[var(--color-field-list-expansion-border)] border-t-0 rounded-b-[0.1875rem] mb-[0.375rem] relative z-[1] box-border"
        >
          <slot name="expansion" :row="row" />
        </div>
      </template>
      </template><!-- end v-if="!loading" -->
    </div>

    <!-- After-list slot (pagination, toggles, etc.) -->
    <div v-if="$slots['after-list']" class="shrink-0">
      <slot name="after-list" v-bind="paginationSlotProps" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFieldRow from "./OFieldRow.vue";
import OFieldLabel from "./OFieldLabel.vue";
import { type FieldItem } from "./OFieldList.types";

const props = withDefaults(
  defineProps<{
    fields: FieldItem[];
    search?: string;
    searchPlaceholder?: string;
    loading?: boolean;
    currentPage?: number;
    pageSize?: number;
    pageSizeOptions?: number[];
    rowKey?: string;
    showSearch?: boolean;
    showPagination?: boolean;
    expandedIds?: string[];
    draggable?: boolean;
    dragEnabledFn?: (row: FieldItem, index: number) => boolean;
    sortFn?: (a: FieldItem, b: FieldItem) => number;
  }>(),
  {
    search: "",
    searchPlaceholder: "Search fields",
    loading: false,
    currentPage: 1,
    pageSize: 50,
    pageSizeOptions: () => [50, 100, 250],
    rowKey: "name",
    showSearch: true,
    showPagination: true,
    expandedIds: () => [],
    draggable: false,
    dragEnabledFn: undefined,
    sortFn: undefined,
  },
);

const emit = defineEmits<{
  "update:search": [value: string];
  "update:currentPage": [page: number];
  "update:expandedIds": [ids: string[]];
  "row-click": [row: FieldItem, event: MouseEvent];
  "row-dblclick": [row: FieldItem, event: MouseEvent];
  "scroll-end": [scrollInfo: any];
  "drag-start": [row: FieldItem, event: DragEvent];
  "drag-end": [row: FieldItem, event: DragEvent];
}>();

const scrollContainerRef = ref<HTMLElement | null>(null);
const searchModel = ref(props.search);
const internalCurrentPage = ref(props.currentPage);

// ── Sync external changes ──────────────────────────────────────────

watch(
  () => props.search,
  (val) => {
    searchModel.value = val ?? "";
  },
);

watch(
  () => props.currentPage,
  (val) => {
    internalCurrentPage.value = val ?? 1;
  },
);

// ── Search ──────────────────────────────────────────────────────────

function onSearchChange(value: string) {
  searchModel.value = value;
  // Reset to first page when search changes
  internalCurrentPage.value = 1;
  emit("update:currentPage", 1);
  emit("update:search", value);
}

// ── Filtering ───────────────────────────────────────────────────────

const filteredFields = computed(() => {
  const term = searchModel.value?.trim().toLowerCase();
  let result: FieldItem[];
  if (!term) {
    result = props.fields;
  } else {
    result = props.fields.filter((row) => {
      if (row.isGroup) {
        // A grouped consumer (GroupedFieldList) that hides collapsed field rows
        // stamps the header with `matchesSearch` so a collapsed-but-matching
        // group keeps its header and stays re-expandable. Fall back to scanning
        // the visible child rows when the flag is absent.
        if (typeof (row as any).matchesSearch === "boolean") {
          return (row as any).matchesSearch;
        }
        return props.fields.some(
          (f) =>
            !f.isGroup &&
            (f.group === row.group || f.stream === row.groupName) &&
            f.name.toLowerCase().includes(term),
        );
      }
      return row.name.toLowerCase().includes(term);
    });
  }

  if (props.sortFn) {
    result = [...result].sort(props.sortFn);
  }

  return result;
});

// ── Pagination ──────────────────────────────────────────────────────

const totalRows = computed(() => filteredFields.value.length);

const totalPages = computed(() => {
  if (!props.showPagination) return 1;
  return Math.max(1, Math.ceil(totalRows.value / props.pageSize));
});

const paginatedFields = computed(() => {
  if (!props.showPagination) return filteredFields.value;
  const start = (internalCurrentPage.value - 1) * props.pageSize;
  return filteredFields.value.slice(start, start + props.pageSize);
});

const isFirstPage = computed(() => internalCurrentPage.value <= 1);
const isLastPage = computed(
  () => internalCurrentPage.value >= totalPages.value,
);

function setPageSize(size: number) {
  internalCurrentPage.value = 1;
  emit("update:currentPage", 1);
}

function firstPage() {
  internalCurrentPage.value = 1;
  emit("update:currentPage", 1);
}

function prevPage() {
  if (internalCurrentPage.value > 1) {
    internalCurrentPage.value--;
    emit("update:currentPage", internalCurrentPage.value);
  }
}

function nextPage() {
  if (internalCurrentPage.value < totalPages.value) {
    internalCurrentPage.value++;
    emit("update:currentPage", internalCurrentPage.value);
  }
}

function lastPage() {
  internalCurrentPage.value = totalPages.value;
  emit("update:currentPage", totalPages.value);
}

const paginationSlotProps = computed(() => ({
  currentPage: internalCurrentPage.value,
  pageSize: props.pageSize,
  totalPages: totalPages.value,
  totalRows: totalRows.value,
  isFirstPage: isFirstPage.value,
  isLastPage: isLastPage.value,
  setPageSize,
  firstPage,
  prevPage,
  nextPage,
  lastPage,
}));

// ── Expansion ───────────────────────────────────────────────────────

const localExpandedIds = ref<Set<string>>(new Set(props.expandedIds ?? []));

watch(
  () => props.expandedIds,
  (ids) => {
    localExpandedIds.value = new Set(ids ?? []);
  },
);

function isExpanded(row: FieldItem): boolean {
  return localExpandedIds.value.has(row.name);
}

// ── Drag-and-drop ───────────────────────────────────────────────────

function isDragEnabled(row: FieldItem, index: number): boolean {
  if (!props.draggable) return false;
  if (row.isGroup) return false;
  if (props.dragEnabledFn) return props.dragEnabledFn(row, index);
  return true;
}

function onDragStart(row: FieldItem, event: DragEvent) {
  if (!isDragEnabled(row, row._index ?? 0)) {
    event.preventDefault();
    return;
  }
  emit("drag-start", row, event);
}

function onDragEnd(row: FieldItem, event: DragEvent) {
  emit("drag-end", row, event);
}

// ── Row events ──────────────────────────────────────────────────────

function onRowClick(row: FieldItem, event: MouseEvent) {
  if (row.isGroup) return;
  emit("row-click", row, event);
}

function onRowDblClick(row: FieldItem, event: MouseEvent) {
  if (row.isGroup) return;
  emit("row-dblclick", row, event);
}

// ── Scroll handling ─────────────────────────────────────────────────

let scrollTimer: ReturnType<typeof setTimeout> | null = null;
function onScroll(event: Event) {
  const el = event.target as HTMLElement;
  if (!el) return;

  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (atBottom) {
      emit("scroll-end", { scrollTop: el.scrollTop });
    }
  }, 150);
}

// ── Expose ──────────────────────────────────────────────────────────

function scrollToTop() {
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = 0;
  }
}

defineExpose({ scrollToTop });
</script>

<style>
/* =============================================================
   OFieldList — compact data-panel variant
   Tokens mapped to O2 design system, small fonts for dense UI
   ============================================================= */

/* Defensive: two adjacent group headers shouldn't double their separator. */
.o-field-list__group-header + .o-field-list__group-header {
  margin-top: 0;
}

/* Add a section break above every group header except the first one,
   so consecutive streams render as visually distinct sections.
   Pure margin — no border-top, because in dark mode the border-color token
   resolves to `rgba(255, 255, 255, 0.40)` and renders as a glaring white
   line above the header band. */
.o-field-list__group-header:not(:first-child) {
  margin-top: 0.5rem;
}

/* No background-color here — each slot consumer owns its own hover highlight.
   __row:hover is kept solely to reveal __actions (PanelFieldList +X/+Y buttons).
   Hovering any child (including expanded slot content) propagates :hover up to
   __row, so __actions appear correctly without the background bleeding into
   expansion panels or value rows. */
.o-field-list__row:hover .o-field-list__actions {
  visibility: visible;
  opacity: 1;
}

/* Make each chip flush (no individual border, no rounded corners),
   and put a vertical separator between adjacent chips.
   `!important` overrides Tailwind utility classes on the OButton root
   (`border-0`, `rounded`, etc.) which otherwise win on specificity. */
.o-field-list__actions > * {
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
}
.o-field-list__actions > *:not(:first-child) {
  border-left: 1px solid var(--color-field-list-actions-border) !important;
}
</style>
