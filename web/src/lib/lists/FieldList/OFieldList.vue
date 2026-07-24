<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="flex h-full min-h-0 w-full flex-col" data-test="o-field-list">
    <!-- before-list slot (stream selectors, etc.) -->
    <div v-if="$slots['before-list']" class="shrink-0">
      <slot name="before-list" />
    </div>

    <!-- Search input. The horizontal inset is the page-edge grid line, baked in
         here so every field list (logs, traces, RUM, dashboards) lines up with
         the page header instead of each panel supplying its own gutter — that's
         how this drifted to four different values. `searchClass` remains as an
         escape hatch for a panel that genuinely needs to differ. -->
    <div v-if="showSearch" class="px-page-edge shrink-0 py-1.5" :class="searchClass">
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
    <div
      ref="scrollContainerRef"
      class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      @scroll="onScroll"
    >
      <!-- Loading state -->
      <div v-if="loading" class="w-full">
        <slot name="loading" />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="paginatedFields.length === 0"
        class="text-field-list-empty-text flex items-center justify-center p-4 text-xs"
      >
        <slot name="empty" />
      </div>

      <!-- Field rows (hidden while loading) -->
      <template v-if="!loading">
        <template v-for="row in paginatedFields" :key="rowKey ? row[rowKey] : row.name">
          <!-- Group header -->
          <div
            v-if="row.isGroup"
            class="o-field-list__group-header px-page-edge text-2xs text-field-list-group-text bg-surface-panel sticky top-0 z-2 flex h-7 cursor-default items-center justify-between font-semibold tracking-[0.01em] select-none"
            :data-test="`o-field-list-group-${row.groupName}`"
          >
            <slot name="group-header" :row="row" :group-name="row.groupName">
              <span class="o-field-list__group-header-text">{{ row.groupName }}</span>
            </slot>
          </div>

          <!-- Field row -->
          <div
            v-else
            class="o-field-list__row group px-page-edge rounded-default relative mt-1 flex min-h-6 w-full cursor-pointer items-center text-xs leading-[0.8rem]"
            :class="{ 'o-field-list__row--draggable': draggable }"
            :data-test="`o-field-list-row-${row.name}`"
            :draggable="draggable && isDragEnabled(row, row._index ?? 0)"
            @click="(e: MouseEvent) => onRowClick(row, e)"
            @dblclick="(e: MouseEvent) => onRowDblClick(row, e)"
            @dragstart="(e: DragEvent) => onDragStart(row, e)"
            @dragend="(e: DragEvent) => onDragEnd(row, e)"
            @dragover.prevent
          >
            <div class="flex min-w-0 flex-1 items-center gap-1">
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
                      'text-field-list-drag-icon inline-flex w-4 shrink-0 items-center justify-center',
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
            <div
              v-if="$slots['field-actions']"
              class="o-field-list__actions border-field-list-actions-border rounded-default bg-field-list-actions-bg invisible absolute top-1/2 right-1 flex shrink-0 -translate-y-1/2 items-stretch overflow-hidden border opacity-0 transition-[opacity,visibility] duration-[120ms] ease-[ease] group-hover:visible group-hover:opacity-100"
            >
              <slot name="field-actions" :row="row" :index="row._index" />
            </div>
          </div>

          <!-- Expanded content -->
          <div
            v-if="isExpanded(row) && $slots.expansion"
            class="border-field-list-expansion-border rounded-b-default relative z-1 mb-1.5 box-border w-full border border-t-0 pt-1 pb-1.5"
          >
            <slot name="expansion" :row="row" />
          </div>
        </template> </template
      ><!-- end v-if="!loading" -->
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
    /** Extra classes for the search block — see the template note on gutters. */
    searchClass?: string;
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
    searchClass: "",
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

function onSearchChange(value: string | number) {
  const search = String(value);
  searchModel.value = search;
  // Reset to first page when search changes
  internalCurrentPage.value = 1;
  emit("update:currentPage", 1);
  emit("update:search", search);
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
const isLastPage = computed(() => internalCurrentPage.value >= totalPages.value);

function setPageSize() {
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

<style scoped>
/* keep(lib-override:OButton): the __actions rules flatten SLOT content (OButton
   roots rendered by consumers) — they need `!important` to beat the button's own
   utilities. Slotted nodes carry the CONSUMER's scope id, not ours, so the child
   selectors go through `:deep()`; the block itself is scoped (the wrapper is our
   own element, so it still gets our scope id). The group-header sibling-combinator
   spacing is co-located here (adjacent/`:not(:first-child)` selectors aren't
   expressible per-element as utilities). Row-hover reveal of __actions is handled
   by `group`/`group-hover` utilities in the template. */

/* Defensive: two adjacent group headers shouldn't double their separator. */
.o-field-list__group-header + .o-field-list__group-header {
  margin-top: 0;
}

/* Add a section break above every group header except the first one,
   so consecutive streams render as visually distinct sections.
   Pure margin — no border-top, because in dark mode the border-color token
   resolves to a translucent white that renders as a glaring line above the band. */
.o-field-list__group-header:not(:first-child) {
  margin-top: 0.5rem;
}

/* Make each chip flush (no individual border, no rounded-default corners),
   and put a vertical separator between adjacent chips. */
.o-field-list__actions > :deep(*) {
  border: 0 !important;
  border-radius: 0 !important;
  background-color: transparent !important;
}
.o-field-list__actions > :deep(*:not(:first-child)) {
  border-left: 1px solid var(--color-field-list-actions-border) !important;
}
</style>
