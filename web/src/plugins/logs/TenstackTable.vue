<template>
  <div >
    <div ref="parentRef" class="container tw-overflow-x-auto">
      <table class="tw-w-full tw-table-auto">
        <thead class="tw-sticky">
          <tr
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              :style="{ width: `${header.getSize()}` }"
              class="tw-px-2 tw-relative table-head"
            >
              <div
                @dblclick="header.column.resetSize()"
                @mousedown="header.getResizeHandler()"
                @touchstart="header.getResizeHandler()"
                :class="[
                  'resizer',
                  columnResizeDirection,
                  header.column.getIsResizing() ? 'isResizing' : '',
                ]"
                :style="{}"
              />

              <div
                v-if="!header.isPlaceholder"
                :class="[
                  'text-left',
                  header.column.getCanSort()
                    ? 'cursor-pointer select-none'
                    : '',
                ]"
                @click="
                  getSortingHandler(
                    $event,
                    header.column.getToggleSortingHandler()
                  )
                "
              >
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
                <span v-if="header.column.getIsSorted() === 'asc'"> 🔼</span>
                <span v-if="header.column.getIsSorted() === 'desc'"> 🔽</span>


                <div
                    class="tw-invisible tw-items-center tw-absolute tw-right-0 tw-top-0 tw-bg-white tw-px-2 column-actions"
                    :class="
                      store.state.theme === 'dark' ? 'field_overlay_dark' : ''
                    "
                    v-if="(header.column.columnDef.meta as any).closable || (header.column.columnDef.meta as any).showWrap"
                  >
                    <span
                      v-if="(header.column.columnDef.meta as any).showWrap"
                      style="font-weight: normal"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-white'
                          : 'text-grey-9'
                      "
                      >{{ t("common.wrap") }}</span
                    >
                    <q-toggle
                      v-if="(header.column.columnDef.meta as any).showWrap"
                      class="text-normal q-ml-xs q-mr-sm"
                      :data-test="`logs-search-result-table-th-remove-${header.column.columnDef.header}-btn`"
                      v-model="(header.column.columnDef.meta as any).wrapContent"
                      color="primary"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-white'
                          : 'text-grey-7'
                      "
                      size="xs"
                      dense
                    />

                    <q-icon
                      v-if="(header.column.columnDef.meta as any).closable"
                      :data-test="`logs-search-result-table-th-remove-${header.column.columnDef.header}-btn`"
                      name="cancel"
                      class="q-ma-none close-icon cursor-pointer"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-white'
                          : 'text-grey-7'
                      "
                      :title="t('common.close')"
                      size="18px"
                      @click="closeColumn(header.column.columnDef)"
                    >
                    </q-icon>
                  </div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody class="tw-relative">
          <template             
            v-for="virtualRow in virtualRows"
            :key="JSON.stringify(formattedRows[virtualRow.index].original)"
          >
          <tr
            :style="{
              transform: `translateY(${virtualRow.start}px)`,
              position: 'absolute',
            }"
            class="tw-flex tw-w-max tw-items-center tw-justify-start tw-border-b "
            :class="store.state.theme === 'dark' ? 'w-border-gray-800' : 'w-border-gray-100'"
          >
            <td
              v-for="cell, cellIndex in formattedRows[virtualRow.index].getVisibleCells()"
              :key="cell.id"
              class="tw-py-1 tw-px-2 tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap tw-flex tw-items-center tw-justify-start"
              :style="{
                width: cell.column.getSize(),
                height: '26px'
              }"
            >
            <q-btn
                  v-if="cellIndex == 0"
                  :icon="
                    formattedRows[virtualRow.index].getIsExpanded()
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  data-test="table-row-expand-menu"
                  @click.stop="formattedRows[virtualRow.index].toggleExpanded()"
                ></q-btn>
              <FlexRender
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </td>
          </tr>
          <tr v-if="formattedRows[virtualRow.index].getIsExpanded()"             
          :style="{
              transform: `translateY(${virtualRow.start + 26})`,
              position: 'relative',
              width: '100%'
            }" >
            <td colspan="4">
              <json-preview
                :value="rows[virtualRow.index]"
                show-copy-button
                class="tw-border-b  tw-py-1"
                :class="store.state.theme === 'dark' ? 'w-border-gray-800' : 'w-border-gray-100'"
                @copy="copyLogToClipboard"
                @add-field-to-table="addFieldToTable"
                @add-search-term="addSearchTerm"
              />
            </td>
          </tr>
        </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineEmits, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  FlexRender,
  type ColumnDef,
  type SortingState,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/vue-table";
import JsonPreview from "./JsonPreview.vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

const props = defineProps({
  rows: {
    type: Array,
    required: true,
  },
  columns: {
    type: Array,
    required: true,
  },
});

const {t} = useI18n();

const emits = defineEmits(["copy", "addSearchTerm", "addFieldToTable", "closeColumn"]);

const sorting = ref<SortingState>([]);

const store = useStore();

const getSortingHandler = (e: Event, fn: any) => {
  return fn(e);
};

const setSorting = (sortingUpdater: any) => {
  const newSortVal = sortingUpdater(sorting.value);

  sorting.value = newSortVal;
};

const columnResizeMode = "onChange";

const columnResizeDirection = "ltr";

const table = useVueTable({
  get data() {
    return props.rows || [];
  },
  get columns() {
    return props.columns as ColumnDef<any>[]
  }, 
  state: {
    get sorting() {
      return sorting.value;
    },
  },
  onSortingChange: setSorting,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  debugTable: true,
  debugHeaders: true,
  debugColumns: true,
  columnResizeMode,
  columnResizeDirection,
});

const formattedRows = computed(() => {
  return table.getRowModel().rows;
});

const parentRef = ref<HTMLElement | null>(null);

const rowVirtualizerOptions = computed(() => {
  return {
    count: formattedRows.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => 26,
    overscan: 5,
    measureElement:
      typeof window !== 'undefined' &&
      navigator.userAgent.indexOf('Firefox') === -1
        ? (element: any) => element?.getBoundingClientRect().height
        : undefined,
  };
});

const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());

const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

const copyLogToClipboard = (value: any) => {
  emits("copy", value);
    };
    const addSearchTerm = (value: string) => {
      emits("addSearchTerm", value);
    };
    const addFieldToTable = (value: string) => {
      emits("addFieldToTable", value);
    };

    const closeColumn = (data: any) => {
      emits("closeColumn", data);
    }
</script>
<style scoped lang="scss">
.resizer {
  position: absolute;
  top: 0;
  height: 100%;
  width: 5px;
  background: rgba(0, 0, 0, 0.5);
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}

.resizer.ltr {
  right: 0;
}

.resizer.rtl {
  left: 0;
}

.resizer.isResizing {
  background: blue;
  opacity: 1;
}

@media (hover: hover) {
  .resizer {
    opacity: 0;
  }

  *:hover > .resizer {
    opacity: 1;
  }
}

.container {
  height: 600px;
  overflow: auto;
}

.cursor-pointer {
  cursor: pointer;
}

.select-none {
  user-select: none;
}

.text-left {
  text-align: left;
}

table {
  border-collapse: collapse;
  border-spacing: 0;
  font-family: monospace;
  font-size: 12px !important;
}

thead {
  background: lightgray;
}

.table-row{
  border-bottom: 1px solid gray;
}


th {

  text-align: left;

  &:hover{
    .column-actions {
      visibility: visible !important;
    }
  }
}

td {
  font-family: monospace;
}

.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
  background: #f5f5f5;
}

.q-table--dark .thead-sticky tr > *,
.q-table--dark .tfoot-sticky tr > * {
  background: #565656;
}


</style>

<!-- <template>
  <div ref="parentRef" class="tw-overflow-x-auto">
    <table class="tw-min-w-full tw-divide-gray-200">
      <thead class="tw-bg-gray-50">
        <tr>
          <th v-for="header in headers" :key="header.column.id" scope="col">
            {{ header.column.columnDef.header }}
          </th>
        </tr>
      </thead>
      <tbody class="tw-bg-white tw-divide-gray-200">
        <tr v-for="virtualRow in virtualRows" :key="virtualRow.key">
          <td
            v-for="cell in rowsModel[virtualRow.index].getVisibleCells()"
            :key="cell.id"
            class="tw-px-2 tw-py-1"
          >
            <FlexRender
              :render="cell.column.columnDef.cell"
              :props="cell.getContext()"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  FlexRender,
  ColumnDef,
  SortingState,
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
} from "@tanstack/vue-table";
import {
  defineProps,
  ref,
  computed,
  onBeforeMount,
  watch,
  reactive,
} from "vue";
import rowsJson from "@/utils/test_logs.json";

const props = defineProps({
  rows: {
    type: Array,
    required: true,
  },
  columns: {
    type: Array,
    required: true,
  },
});

// const tableColumns = [
//   {
//     header: "Name",
//     accessorKey: "name",
//     id: "name",
//   },
//   {
//     header: "Age",
//     accessorKey: "age",
//     id: "age",
//   },
//   {
//     header: "Address",
//     accessorKey: "address",
//     id: "address",
//   },
// ];

// const tableRows = [
//   {
//     name: "John Doe",
//     age: 28,
//     address: "123 Main St",
//   },
//   {
//     name: "Jane Smith",
//     age: 34,
//     address: "456 Maple Ave",
//   },
// ];

const columnHelper = createColumnHelper();

const initialColumns = [
  columnHelper.accessor("_timestamp", {
    header: "timestamp (Asia/Calcutta)",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("source", {
    header: "source",
    cell: (info) => info.getValue(),
  }),
];

const tableRows = ref<any[]>(rowsJson.slice(10));

const tableColumns = reactive<{ [key: string]: string }[]>([...initialColumns]);

onBeforeMount(() => {
  console.log("rows and columns");
  // getRows();
  // getColumns();
});

// watch(
//   () => props.rows,
//   () => {
//     tableRows.value = [];
//     getRows();
//   }
// );

// watch(
//   () => props.columns,
//   () => {
//     tableColumns = [];
//     getColumns();
//     console.log("columns >>>>>>>>>>>>>>>>", tableColumns);
//     if (!tableColumns.length) {
//       tableColumns = [...initialColumns];
//     }
//   }
// );

const getRows = () => {
  tableRows.value = rowsJson.slice(10) || [];
  // tableRows.value = (rowsJson.slice(5000) || []).map((row: any) => {
  //   const _row: { [key: string]: string } = {};
  //   props.columns.forEach((column: any) => {
  //     _row[column.name === "@timestamp" ? "_timestamp" : column.name] =
  //       column.field(row);
  //   });
  //   return _row;
  // });
};

// const getColumns = () => {
//   tableColumns = (props.columns || []).map((column: any) => {
//     return {
//       header: column.label,
//       id: column.name === "@timestamp" ? "_timestamp" : column.name,
//       accessorKey: column.name === "@timestamp" ? "_timestamp" : column.name,
//     };
//   });

//   console.log("tableColumns", tableColumns, table.getHeaderGroups());
// };

const table = useVueTable({
  columns: tableColumns,
  data: tableRows.value,
  getCoreRowModel: getCoreRowModel(),
  debugTable: true,
  debugHeaders: true,
  debugColumns: true,
});

const state = ref({
  ...table.initialState,
  pagination: {
    pageIndex: 0,
    pageSize: 15,
  },
});

// const setState = (updater) => {
//   console.log("updater", updater);
//   state.value = updater instanceof Function ? updater(state.value) : updater;
// };

// console.log("state", state.value);

// //Use the table.setOptions API to merge our fully controlled state onto the table instance
// table.setOptions((prev) => ({
//   ...prev, //preserve any other options that we have set up above
//   get state() {
//     return state.value;
//   },
//   onStateChange: setState, //any state changes will be pushed up to our own state management
// }));

const parentRef = ref<HTMLElement | null>(null);

const headers = ref(table.getHeaderGroups()[0]?.headers);

const rowsModel = ref(table.getRowModel()?.rows);

const rowVirtualizerOptions = computed(() => {
  return {
    count: tableRows.value.length,
    estimateSize: () => 29, //estimate row height for accurate scrollbar dragging
    getScrollElement: () => parentRef.value,
    //measure dynamic row height, except in firefox because it measures table border height incorrectly
    measureElement:
      typeof window !== "undefined" &&
      navigator.userAgent.indexOf("Firefox") === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 5,
  };
});

const rowVirtualizer = useVirtualizer(rowVirtualizerOptions);

const virtualRows = computed(() => {
  return rowVirtualizer.value.getVirtualItems();
});

console.log("virtual rows", virtualRows.value.length);
</script>

<style>
/* Import Tailwind CSS */
@import "tailwindcss/tailwind.css";
</style> -->
