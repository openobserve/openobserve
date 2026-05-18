<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="o-field-list" data-test="o-field-list">
    <!-- before-list slot (stream selectors, etc.) -->
    <div v-if="$slots['before-list']" class="o-field-list__before">
      <slot name="before-list" />
    </div>

    <!-- Search input -->
    <div v-if="showSearch" class="o-field-list__search">
      <OInput
        :model-value="searchModel"
        data-test="o-field-list-search"
        :placeholder="searchPlaceholder"
        clearable
        @update:model-value="onSearchChange"
      >
        <template #icon-left>
          <OIcon name="search" size="1rem" class="o-field-list__search-icon" />
        </template>
      </OInput>
    </div>

    <!-- Scrollable field list body -->
    <div ref="scrollContainerRef" class="o-field-list__body" @scroll="onScroll">
      <!-- Loading state -->
      <div
        v-if="loading && paginatedFields.length === 0"
        class="o-field-list__loading"
      >
        <slot name="loading" />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!loading && paginatedFields.length === 0"
        class="o-field-list__empty"
      >
        <slot name="empty" />
      </div>

      <!-- Field rows -->
      <template
        v-for="row in paginatedFields"
        :key="rowKey ? row[rowKey] : row.name"
      >
        <!-- Group header -->
        <div
          v-if="row.isGroup"
          class="o-field-list__group-header"
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
          class="o-field-list__row"
          :data-test="`o-field-list-row-${row.name}`"
          @click="(e: MouseEvent) => onRowClick(row, e)"
          @dblclick="(e: MouseEvent) => onRowDblClick(row, e)"
        >
          <div class="o-field-list__field-content">
            <slot name="field-row" :row="row" :index="row._index">
              <OIcon
                :name="getTypeIcon(row.type)"
                size="sm"
                class="o-field-list__type-icon"
              />
              <span class="o-field-list__field-name">{{ row.name }}</span>
            </slot>
          </div>
          <div v-if="$slots['field-actions']" class="o-field-list__actions">
            <slot name="field-actions" :row="row" :index="row._index" />
          </div>
        </div>

        <!-- Expanded content -->
        <div
          v-if="isExpanded(row) && $slots.expansion"
          class="o-field-list__expansion"
        >
          <slot name="expansion" :row="row" />
        </div>
      </template>
    </div>

    <!-- After-list slot (pagination, toggles, etc.) -->
    <div v-if="$slots['after-list']" class="o-field-list__after">
      <slot name="after-list" v-bind="paginationSlotProps" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  },
);

const emit = defineEmits<{
  "update:search": [value: string];
  "update:currentPage": [page: number];
  "update:expandedIds": [ids: string[]];
  "row-click": [row: FieldItem, event: MouseEvent];
  "row-dblclick": [row: FieldItem, event: MouseEvent];
  "scroll-end": [scrollInfo: any];
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
  if (!term) return props.fields;

  return props.fields.filter((row) => {
    if (row.isGroup) {
      return props.fields.some(
        (f) =>
          !f.isGroup &&
          f.stream === row.groupName &&
          f.name.toLowerCase().includes(term),
      );
    }
    return row.name.toLowerCase().includes(term);
  });
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

// ── Type icon helper ────────────────────────────────────────────────

function getTypeIcon(type: string | undefined): string {
  if (!type) return "text-fields";
  switch (type.toLowerCase()) {
    case "utf8":
    case "string":
    case "text":
      return "text-fields";
    case "boolean":
    case "bool":
      return "toggle-off";
    case "int64":
    case "float64":
    case "int":
    case "float":
    case "number":
      return "tag";
    default:
      return "text-fields";
  }
}

// ── Expose ──────────────────────────────────────────────────────────

function scrollToTop() {
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTop = 0;
  }
}

defineExpose({ scrollToTop });
</script>

<style scoped lang="scss">
// =============================================================
// OFieldList — compact data-panel variant
// Tokens mapped to O2 design system, small fonts for dense UI
// =============================================================

.o-field-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;

  &__before {
    flex-shrink: 0;
  }

  // ---------- search ----------
  &__search {
    flex-shrink: 0;
    padding: 0.375rem 0;
  }

  // ---------- body / list ----------
  &__body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  &__loading,
  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    color: var(--o2-text-muted);
    font-size: 0.75rem;
  }

  // ---------- group header ----------
  &__group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0 0.125rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--o2-text-secondary);
    cursor: default;
    user-select: none;
    letter-spacing: 0.01em;
  }

  // ---------- row ----------
  &__row {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 24px;
    padding: 0;
    position: relative;
    cursor: pointer;
    border-radius: 0.1875rem;
    font-size: 0.75rem;
    transition: background-color 0.1s ease;

    &:hover {
      background-color: var(--o2-hover-accent);

      .o-field-list__actions {
        visibility: visible;
        opacity: 1;
      }
    }
  }

  // ---------- field content ----------
  &__field-content {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  // ---------- expand chevron ----------
  &__expand-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1rem;
    color: var(--o2-text-muted);
  }

  // ---------- type icon ----------
  &__type-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    color: var(--o2-text-muted);
  }

  // ---------- field name (truncated) ----------
  &__field-name {
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    color: var(--o2-text-primary);
  }

  // ---------- row actions (overlay on hover) ----------
  &__actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
    visibility: hidden;
    opacity: 0;
    transition:
      opacity 0.12s ease,
      visibility 0.12s ease;
    position: absolute;
    right: 0.25rem;
    top: 50%;
    transform: translateY(-50%);
    background-color: var(--o2-hover-accent);
    padding: 0.125rem 0.25rem;
    border-radius: 0.1875rem;
    box-shadow: 0 0 0 1px var(--o2-border-color);
  }

  // ---------- expansion panel ----------
  &__expansion {
    width: 100%;
    padding: 0.25rem 0 0.375rem;
    background-color: var(--o2-card-background);
    border: 1px solid var(--o2-border-color);
    border-top: none;
    border-radius: 0 0 0.1875rem 0.1875rem;
    margin-bottom: 0.375rem;
    position: relative;
    z-index: 1;
    box-sizing: border-box;
  }

  // ---------- footer ----------
  &__after {
    flex-shrink: 0;
  }
}
</style>
