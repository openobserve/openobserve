<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Header, HeaderGroup, Table } from "@tanstack/vue-table";
import { FlexRender } from "@tanstack/vue-table";
import { computed } from "vue";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";

const props = defineProps<{
  headerGroups: HeaderGroup<any>[];
  table: Table<any>;
  selectionMultiple?: boolean;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  expansionEnabled?: boolean;
  enableColumnReorder?: boolean;
  enableColumnResize?: boolean;
  sortingEnabled?: boolean;
  sortBy?: string;
  sortOrder?: string;
  sortFieldMap?: Record<string, string>;
  getSortIcon?: (columnId: string) => "asc" | "desc" | "none";
  stickyHeader?: boolean;
  bordered?: boolean;
}>();

const emit = defineEmits<{
  "toggle-all-rows": [];
  "sort": [columnId: string];
  "column-close": [columnId: string];
}>();

function handleSort(header: Header<any, any>, event: MouseEvent) {
  const meta = header.column.columnDef.meta as any;
  if (!meta?.sortable) return;
  emit("sort", header.column.id);
  // Also trigger TanStack's client-side toggle if available
  header.column.getToggleSortingHandler()?.(event);
}

function handleColumnClose(columnId: string) {
  emit("column-close", columnId);
}

function onResizeStart(header: Header<any, any>, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  header.getResizeHandler()?.(event);
}
</script>

<template>
  <thead
    v-for="headerGroup in headerGroups"
    :key="headerGroup.id"
    :class="[
      stickyHeader ? 'tw:sticky tw:top-0 tw:z-10' : '',
    ]"
    data-test="o2-table-header"
  >
    <tr>
      <!-- Expand placeholder header cell -->
      <th
        v-if="expansionEnabled"
        class="tw:w-0 tw:px-0"
        data-test="o2-table-th-expand"
        :style="{ background: 'inherit' }"
      />

      <!-- Selection checkbox header cell -->
      <th
        v-if="selectionMultiple"
        class="tw:w-0"
        data-test="o2-table-th-select"
        :style="{ background: 'inherit' }"
      >
        <OTableSelectCheckbox
          :model-value="isAllSelected ?? false"
          :indeterminate="isIndeterminate ?? false"
          row-id="all"
          @update:model-value="emit('toggle-all-rows')"
        />
      </th>

      <!-- Column headers -->
      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          'tw:px-2 tw:text-left tw:font-medium tw:text-text-secondary tw:text-sm tw:select-none',
          bordered ? 'tw:border-r tw:border-border-default' : '',
          'tw:h-9',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          background: 'var(--o2-table-header-bg)',
          width: `calc(var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, '-')}-size) * 1px)`,
        }"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:h-full">
          <!-- Sortable header: clickable label + sort icon -->
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1"
            data-test="o2-table-th-sort-trigger"
            @click="handleSort(header, $event)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <!-- Server-side sort icons -->
            <template v-if="sortBy !== undefined && getSortIcon">
              <q-icon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow_upward"
                size="0.85rem"
                class="tw:text-primary-color"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow_downward"
                size="0.85rem"
                class="tw:text-primary-color"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else
                name="unfold_more"
                size="0.85rem"
                class="tw:opacity-40"
                data-test="o2-table-sort-icon-inactive"
              />
            </template>
          </div>

          <!-- Non-sortable header: just label -->
          <div v-else class="tw:flex-1">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

          <!-- Close column button -->
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-close-${header.id}`"
            class="tw:opacity-0 group-hover:opacity-100 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:text-text-primary tw:p-0 tw:leading-none"
            @click.stop="handleColumnClose(header.id)"
          >
            <q-icon name="cancel" size="1rem" />
          </button>
        </div>

        <!-- Column resize handle -->
        <div
          v-if="header.column.getCanResize()"
          class="tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-1 tw:cursor-col-resize tw:hover:bg-primary-color tw:opacity-0 hover:tw:opacity-100 tw:transition-opacity"
          @mousedown="onResizeStart(header, $event)"
          @dblclick.stop="header.column.resetSize()"
        />
      </th>
    </tr>
  </thead>
</template>
