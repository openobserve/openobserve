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
        <template #prepend>
          <OIcon name="search" size="1rem" class="o-field-list__search-icon" />
        </template>
      </OInput>
    </div>

    <!-- Field list via OTable -->
    <OTable
      ref="tableRef"
      :data="filteredFields"
      :columns="columns"
      :row-key="rowKey"
      :pagination="showPagination ? 'client' : 'none'"
      :current-page="currentPage"
      :page-size="pageSize"
      :page-size-options="pageSizeOptions"
      :virtual-scroll="virtualScroll"
      :dense="dense"
      :bordered="false"
      :striped="false"
      :sticky-header="false"
      :show-global-filter="false"
      :expansion="expansion"
      :expanded-ids="expandedIds"
      :loading="loading"
      @update:current-page="(page: number) => emit('update:currentPage', page)"
      @update:expanded-ids="(ids: string[]) => emit('update:expandedIds', ids)"
      @row-click="onRowClick"
      @row-dblclick="onRowDblClick"
      @scroll-end="(info: any) => emit('scroll-end', info)"
    >
      <!-- Field row rendering -->
      <template #cell-name="{ row }">
        <div
          v-if="row.isGroup"
          class="o-field-list__group-header"
          :data-test="`o-field-list-group-${row.groupName}`"
        >
          <slot name="group-header" :row="row" :group-name="row.groupName">
            <span class="o-field-list__group-header-text">{{ row.groupName }}</span>
          </slot>
        </div>
        <div
          v-else
          class="o-field-list__row"
          :data-test="`o-field-list-row-${row.name}`"
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
      </template>

      <!-- Expansion for field values panel -->
      <template v-if="$slots.expansion" #expansion="{ row }">
        <slot name="expansion" :row="row" />
      </template>

      <!-- Custom empty state -->
      <template v-if="$slots.empty" #empty>
        <slot name="empty" />
      </template>

      <!-- After-list slot (pagination, toggles, etc.) -->
      <template v-if="$slots['after-list']" #bottom="bottomProps">
        <slot name="after-list" v-bind="bottomProps" />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  OFieldListDefaultColumn,
  type FieldItem,
} from "./OFieldList.types";

const props = withDefaults(defineProps<{
  fields: FieldItem[];
  search?: string;
  searchPlaceholder?: string;
  loading?: boolean;
  currentPage?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  virtualScroll?: boolean;
  rowKey?: string;
  dense?: boolean;
  showSearch?: boolean;
  showPagination?: boolean;
  expansion?: "none" | "single";
  expandedIds?: string[];
}>(), {
  search: "",
  searchPlaceholder: "Search fields",
  loading: false,
  currentPage: 1,
  pageSize: 50,
  pageSizeOptions: () => [50, 100, 250],
  virtualScroll: false,
  rowKey: "name",
  dense: true,
  showSearch: true,
  showPagination: true,
  expansion: "none",
  expandedIds: () => [],
});

const emit = defineEmits<{
  "update:search": [value: string];
  "update:expandedIds": [ids: string[]];
  "row-click": [row: FieldItem, event: MouseEvent];
  "row-dblclick": [row: FieldItem, event: MouseEvent];
  "scroll-end": [scrollInfo: any];
}>();

const tableRef = ref<InstanceType<typeof OTable> | null>(null);
const searchModel = ref(props.search);

// Single column definition — reactive for TanStack Table
const columns = computed(() => [OFieldListDefaultColumn]);

// Sync external search changes
watch(
  () => props.search,
  (val) => {
    searchModel.value = val ?? "";
  },
);

function onSearchChange(value: string) {
  searchModel.value = value;
  emit("update:search", value);
}

// Filter fields: group headers always visible, others filtered by name
const filteredFields = computed(() => {
  const term = searchModel.value?.trim().toLowerCase();
  if (!term) return props.fields;

  return props.fields.filter((row) => {
    if (row.isGroup) {
      // Keep group header if any of its non-group children pass the filter.
      // Children are identified by the group name matching.
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

function onRowClick(row: FieldItem, event: MouseEvent) {
  if (row.isGroup) return;
  emit("row-click", row, event);
}

function onRowDblClick(row: FieldItem, event: MouseEvent) {
  if (row.isGroup) return;
  emit("row-dblclick", row, event);
}

// Expose scrollToTop for imperative use
function scrollToTop() {
  tableRef.value?.scrollToTop?.();
}

defineExpose({ scrollToTop, tableRef });
</script>

<style scoped lang="scss">
.o-field-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;

  &__before {
    flex-shrink: 0;
  }

  &__search {
    flex-shrink: 0;
    padding: 0 0.375rem;
    margin-bottom: 0.25rem;
  }

  &__group-header {
    padding: 0.5rem 0.625rem 0.25rem;
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--o2-text-secondary);
    cursor: default;
    user-select: none;
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 25px;
    padding: 0 0.625rem;
    position: relative;
    cursor: pointer;
    border-radius: 0.25rem;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--o2-hover-accent);

      .o-field-list__actions {
        visibility: visible;
        opacity: 1;
      }
    }
  }

  &__field-content {
    display: flex;
    align-items: center;
    min-width: 0;
    flex: 1;
  }

  &__type-icon {
    flex-shrink: 0;
    margin-right: 0.375rem;
    color: var(--o2-text-muted);
  }

  &__field-name {
    font-size: 0.825rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.15s ease, visibility 0.15s ease;
    position: absolute;
    right: 0.375rem;
    top: 50%;
    transform: translateY(-50%);
    background: inherit;
  }
}
</style>
