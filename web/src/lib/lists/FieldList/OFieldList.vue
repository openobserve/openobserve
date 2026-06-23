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
          <OIcon name="search" size="sm" class="o-field-list__search-icon" />
        </template>
      </OInput>
    </div>

    <!-- Scrollable field list body -->
    <div ref="scrollContainerRef" class="o-field-list__body" @scroll="onScroll">
      <!-- Loading state -->
      <div
        v-if="loading"
        class="o-field-list__loading"
      >
        <slot name="loading" />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="paginatedFields.length === 0"
        class="o-field-list__empty"
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
          class="o-field-list__group-header tw:h-7"
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
          class="o-field-list__row tw:mt-[0.25rem]"
          :class="{ 'o-field-list__row--draggable': draggable }"
          :data-test="`o-field-list-row-${row.name}`"
          :draggable="draggable && isDragEnabled(row, row._index ?? 0)"
          @click="(e: MouseEvent) => onRowClick(row, e)"
          @dblclick="(e: MouseEvent) => onRowDblClick(row, e)"
          @dragstart="(e: DragEvent) => onDragStart(row, e)"
          @dragend="(e: DragEvent) => onDragEnd(row, e)"
          @dragover.prevent
        >
          <div class="o-field-list__field-content">
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
                    'o-field-list__drag-icon',
                    isDragEnabled(row, row._index ?? 0)
                      ? 'o-field-list__drag-icon--enabled'
                      : 'o-field-list__drag-icon--disabled',
                  ]"
                  data-test="o-field-list-drag-indicator"
                />
                <OFieldLabel :field="row" :show-type-icon="true" />
              </OFieldRow>
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
      </template><!-- end v-if="!loading" -->
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

<style scoped lang="scss">
// =============================================================
// OFieldList — compact data-panel variant
// Tokens mapped to O2 design system, small fonts for dense UI
// =============================================================

.o-field-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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

  &__loading {
    width: 100%;
  }

  &__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    color: var(--color-field-list-empty-text);
    font-size: 0.75rem;
  }

  // ---------- group header ----------
  // Sticky wrapper that keeps the stream name visible while scrolling its
  // fields. Background MUST be transparent — `--o2-card-background` resolves
  // to `#F0F1F2` (near-white) in dark mode, which leaked above the inner
  // band (`.field-group-header`) and showed as a bright white line. Padding
  // is removed for the same reason — the slot fills the full wrapper area.
  &__group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-field-list-group-text);
    cursor: default;
    user-select: none;
    letter-spacing: 0.01em;
    position: sticky;
    top: 0;
    z-index: 2;
    background-color: transparent;

    & + & {
      // Defensive: two adjacent group headers shouldn't double their separator.
      margin-top: 0;
    }
  }

  // Add a section break above every group header except the first one,
  // so consecutive streams render as visually distinct sections.
  // Pure margin — no border-top, because in dark mode the border-color token
  // resolves to `rgba(255, 255, 255, 0.40)` and renders as a glaring white
  // line above the header band.
  &__group-header:not(:first-child) {
    margin-top: 0.5rem;
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
    line-height: 0.8rem;

    // No background-color here — each slot consumer owns its own hover highlight.
    // __row:hover is kept solely to reveal __actions (PanelFieldList +X/+Y buttons).
    // Hovering any child (including expanded slot content) propagates :hover up to
    // __row, so __actions appear correctly without the background bleeding into
    // expansion panels or value rows.
    &:hover {
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
    gap: 0.25rem; // breathing room between drag handle, type icon, and field name
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
    color: var(--color-field-list-expand-icon);
  }

  // ---------- drag icon ----------
  &__drag-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    color: var(--color-field-list-drag-icon);

    &--enabled {
      cursor: grab;
    }

    &--disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
  }

  // ---------- row actions (overlay on hover) ----------
  // Renders as a single connected button group with a thin vertical separator
  // between each adder button (+X | +Y | +B | +F). One outer border wraps
  // the whole group; inner separators are border-rights on each child except
  // the last.
  //
  // Group background uses `--o2-bg-gray` (light gray in light mode, dark
  // gray in dark mode — properly theme-aware). This is required so disabled
  // chips don't render their faded label *on top of* the field name text
  // beneath the overlay (which happens when the background is transparent
  // and the field name slides under the chip area on long names).
  &__actions {
    display: flex;
    align-items: stretch;
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
    border: 1px solid var(--color-field-list-actions-border);
    border-radius: 0.1875rem;
    overflow: hidden;
    background-color: var(--color-field-list-actions-bg);

    // Make each chip flush (no individual border, no rounded corners),
    // and put a vertical separator between adjacent chips.
    // `!important` overrides Tailwind utility classes on the OButton root
    // (`tw:border-0`, `tw:rounded`, etc.) which otherwise win on specificity.
    :deep(> *) {
      border: 0 !important;
      border-radius: 0 !important;
      background-color: transparent !important;
    }
    :deep(> *:not(:first-child)) {
      border-left: 1px solid var(--color-field-list-actions-border) !important;
    }
  }

  // ---------- expansion panel ----------
  &__expansion {
    width: 100%;
    padding: 0.25rem 0 0.375rem;
    border: 1px solid var(--color-field-list-expansion-border);
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
