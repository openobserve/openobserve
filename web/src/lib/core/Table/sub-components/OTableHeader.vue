<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { HeaderGroup, Table } from "@tanstack/vue-table";
import { FlexRender } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import { VueDraggableNext as VueDraggable } from "vue-draggable-next";
import OTableSelectCheckbox from "./OTableSelectCheckbox.vue";

const props = defineProps<{
  headerGroups: HeaderGroup<any>[];
  table: Table<any>;
  columnOrder: string[];
  selectionMultiple?: boolean;
  isAllSelected?: boolean;
  isIndeterminate?: boolean;
  expansionEnabled?: boolean;
  enableColumnReorder?: boolean;
  enableColumnResize?: boolean;
  isResizing?: boolean;
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
  sort: [columnId: string];
  "column-close": [columnId: string];
  "update:columnOrder": [order: string[]];
  "drag-start": [event: any];
  "drag-end": [];
}>();

const drag = ref(false);

function handleSort(columnId: string, toggleHandler?: (event: Event) => void, event?: MouseEvent) {
  const meta = (props.table.getColumn(columnId)?.columnDef?.meta as any);
  if (!meta?.sortable) return;
  emit("sort", columnId);
  if (event) toggleHandler?.(event);
}

function handleColumnClose(columnId: string) {
  emit("column-close", columnId);
}

function onResizeStart(event: MouseEvent | TouchEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function handleDragStart(event: any) {
  emit("drag-start", event);
}

function handleDragEnd() {
  emit("drag-end");
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
    <!-- Drag-reorder wrapper -->
    <VueDraggable
      v-if="enableColumnReorder"
      :model-value="columnOrder"
      :element="'table'"
      :animation="200"
      :sort="!isResizing"
      handle=".table-head"
      tag="tr"
      :class="[
        columnOrder.length > 1 ? 'tw:cursor-move' : '',
      ]"
      :style="{
        minWidth: '100%',
      }"
      @start="handleDragStart"
      @end="handleDragEnd"
      @update:model-value="(val: string[]) => emit('update:columnOrder', val)"
    >
      <!-- Expand placeholder -->
      <th
        v-if="expansionEnabled"
        class="tw:w-0 tw:px-0"
        data-test="o2-table-th-expand"
      />

      <!-- Selection checkbox header -->
      <th
        v-if="selectionMultiple"
        class="tw:w-0"
        data-test="o2-table-th-select"
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
          'tw:px-2 tw:text-left tw:font-medium tw:text-text-secondary tw:text-sm tw:select-none tw:relative',
          bordered ? 'tw:border-r tw:border-border-default' : '',
          'table-head',
          'tw:h-9',
          'tw:group',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          width: `calc(var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, '-')}-size) * 1px)`,
        }"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:h-full">
          <!-- Sortable header -->
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1 tw:overflow-hidden"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <!-- Sort icons -->
            <template v-if="sortBy !== undefined && getSortIcon">
              <q-icon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow_upward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow_downward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
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

          <!-- Non-sortable header -->
          <div v-else class="tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>

          <!-- Close column button (visible on header hover) -->
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-close-${header.id}`"
            class="tw:opacity-0 group-hover:tw:opacity-100 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:text-text-primary tw:p-0 tw:leading-none tw:transition-opacity"
            @click.stop="handleColumnClose(header.id)"
          >
            <q-icon name="cancel" size="1rem" />
          </button>
        </div>

        <!-- Column resize handle -->
        <div
          v-if="header.column.getCanResize()"
          :class="[
            'resizer',
            'tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-1 tw:cursor-col-resize tw:hover:bg-[var(--color-table-resize-handle)] tw:hover:opacity-100 tw:opacity-0 tw:transition-opacity',
            header.column.getIsResizing() ? 'isResizing tw:bg-[var(--color-table-resize-handle)]!' : '',
          ]"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="header.getResizeHandler()?.($event)"
          @touchstart.prevent.stop="header.getResizeHandler()?.($event)"
        />
      </th>
    </VueDraggable>

    <!-- Non-draggable header (when reorder disabled) -->
    <tr v-if="!enableColumnReorder">
      <th
        v-if="expansionEnabled"
        class="tw:w-0 tw:px-0"
        data-test="o2-table-th-expand"
      />
      <th
        v-if="selectionMultiple"
        class="tw:w-0"
        data-test="o2-table-th-select"
      >
        <OTableSelectCheckbox
          :model-value="isAllSelected ?? false"
          :indeterminate="isIndeterminate ?? false"
          row-id="all"
          @update:model-value="emit('toggle-all-rows')"
        />
      </th>
      <th
        v-for="header in headerGroup.headers"
        :key="header.id"
        :data-test="`o2-table-th-${header.id}`"
        :class="[
          'tw:px-2 tw:text-left tw:font-medium tw:text-text-secondary tw:text-sm tw:select-none tw:relative',
          bordered ? 'tw:border-r tw:border-border-default' : '',
          'tw:h-9 tw:group',
          (header.column.columnDef.meta as any)?.headerClass ?? '',
        ]"
        :style="{
          width: `calc(var(--header-${header.id.replace(/[^a-zA-Z0-9]/g, '-')}-size) * 1px)`,
        }"
      >
        <div class="tw:flex tw:items-center tw:gap-1 tw:h-full">
          <div
            v-if="(header.column.columnDef.meta as any)?.sortable"
            class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:flex-1 tw:overflow-hidden"
            data-test="o2-table-th-sort-trigger"
            @click="(e: MouseEvent) => handleSort(header.id, header.column.getToggleSortingHandler(), e)"
          >
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
            <template v-if="sortBy !== undefined && getSortIcon">
              <q-icon
                v-if="getSortIcon(header.id) === 'asc'"
                name="arrow_upward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
                data-test="o2-table-sort-icon-active"
              />
              <q-icon
                v-else-if="getSortIcon(header.id) === 'desc'"
                name="arrow_downward"
                size="0.85rem"
                class="tw:text-[var(--color-table-sort-icon-active)]"
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
          <div v-else class="tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
            <FlexRender
              v-if="!header.isPlaceholder"
              :render="header.column.columnDef.header"
              :props="header.getContext()"
            />
          </div>
          <button
            v-if="(header.column.columnDef.meta as any)?.closable"
            type="button"
            :data-test="`o2-table-th-close-${header.id}`"
            class="tw:opacity-0 group-hover:tw:opacity-100 tw:bg-transparent tw:border-0 tw:cursor-pointer tw:text-text-secondary tw:hover:text-text-primary tw:p-0 tw:leading-none tw:transition-opacity"
            @click.stop="handleColumnClose(header.id)"
          >
            <q-icon name="cancel" size="1rem" />
          </button>
        </div>
        <div
          v-if="header.column.getCanResize()"
          :class="[
            'resizer',
            'tw:absolute tw:right-0 tw:top-0 tw:h-full tw:w-1 tw:cursor-col-resize tw:hover:bg-[var(--color-table-resize-handle)] tw:hover:opacity-100 tw:opacity-0 tw:transition-opacity',
            header.column.getIsResizing() ? 'isResizing tw:bg-[var(--color-table-resize-handle)]!' : '',
          ]"
          @dblclick="header.column.resetSize()"
          @mousedown.prevent.stop="header.getResizeHandler()?.($event)"
          @touchstart.prevent.stop="header.getResizeHandler()?.($event)"
        />
      </th>
    </tr>
  </thead>
</template>
