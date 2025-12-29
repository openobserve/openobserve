<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <!-- 
    Create a table like SearchResults.vue component.
    1. Props for columns, rows and loading
    2. use virtual scroll
    3. Column should have boolean property to close column. closable: true
    4. Column should have boolean property to hide column. hidden: true
    5. Component should have highlight property to highlight search text
    6. Rows should have boolean property to expand row. expandable: true
   -->
  <div :style="{ height: height, marginTop: 0 }" class="app-table-container">
    <q-table
      flat
      :bordered="bordered"
      ref="qTableRef"
      :rows="rows"
      :columns="columns as []"
      :table-colspan="9"
      :row-key="rowKey"
      :virtual-scroll="virtualScroll"
      :virtual-scroll-item-size="48"
      :rows-per-page-options="[0]"
      :pagination="_pagination"
      :hide-header="hideHeader"
      :filter="filter && filter.value"
      :filter-method="filter && filter.method"
      @virtual-scroll="onScroll"
      :style="tableStyle"
      v-model:selected="selectedRows"
      :selection="selection"
    >
      <template #no-data>
        <NoData class="q-mb-lg" />
      </template>
      <template v-slot:header-selection="scope" v-if="selection === 'multiple'">
        <q-checkbox
          v-model="scope.selected"
          size="sm"
          class="o2-table-checkbox"

        />
      </template>
      <template v-slot:header="props">
        <q-tr :props="props" class="!tw:bg-[var(--o2-table-header-bg)]">
          <!-- Add checkbox header when selection is enabled -->
          <q-th auto-width v-if="selection === 'multiple'">
            <q-checkbox
              v-model="props.selected"
              size="sm"
              class="o2-table-checkbox"
            />
          </q-th>
          <q-th
            v-for="col in props.cols"
            :key="col.name"
            :class="col.classes || ''"
            :props="props"
            :style="col.style"
            class="tw:bg-[var(--o2-table-header-bg)]!"
          >
            {{ col.label }}
          </q-th>
        </q-tr>
      </template>
       <template #top="scope" v-if="!hideTopPagination">
        <div class="tw:flex tw:items-center tw:justify-between tw:w-full q-py-xs  ">
          <span class="tw:font-bold tw:text-[14px] tw:w-full q-pa-none">
          {{ rows.length }} {{ title }}
        </span>
        <QTablePagination
          :scope="scope"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="top"
          @update:changeRecordPerPage="changePagination"
          style="padding: 0px;"
        />
        </div>
       </template>
      <template v-slot:body-selection="scope" v-if="selection === 'multiple'">
        <q-td auto-width>
          <q-checkbox
            v-model="scope.selected"
            size="sm"
            class="o2-table-checkbox"
          />
        </q-td>
      </template>
      <template v-slot:body="props">
        <q-tr :props="props" :key="`m_${props.row.index}`">
          <!-- Add checkbox column when selection is enabled -->
          <q-td auto-width v-if="selection === 'multiple'">
            <q-checkbox
              v-model="props.selected"
              size="sm"
              class="o2-table-checkbox"
            />
          </q-td>
          <q-td
            v-for="col in props.cols"
            :class="col.class || ''"
            :key="col.name"
            :props="props"
            @click="handleDataClick(col.name, props.row)"
          >
            <template v-if="col.slot">
              <slot
                :name="col.slotName"
                :column="{ ...props }"
                :columnName="col.name"
              />
            </template>
            <template v-else-if="col.type === 'action'">
              <q-icon :name="col.icon" size="24px" class="cursor-pointer" />
            </template>
            <template v-else>
              {{ col.value }}
            </template>
          </q-td>
        </q-tr>
        <q-tr
          v-show="props.row.expand"
          :props="props"
          :key="`e_${props.row.index + 'entity'}`"
          class="q-virtual-scroll--with-prev"
          style="transition: display 2s ease-in"
        >
          <q-td colspan="100%" style="padding: 0; border-bottom: none">
            <slot :name="props.row.slotName" :row="props" />
          </q-td>
        </q-tr>
      </template>
      <template  #bottom="scope">
        <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
          <div class="tw:flex tw:items-center tw:gap-2">
            <div v-if="showBottomPaginationWithTitle" class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md">
              {{ resultTotal }} {{ title }}
            </div>
            <slot name="bottom-actions" :scope="scope"></slot>
          </div>
          <QTablePagination
            :scope="scope"
            :position="'bottom'"
            :resultTotal="resultTotal"
            :perPageOptions="perPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </div>
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts">
import type { QTable } from "quasar";
import type { Ref } from "vue";
import { ref } from "vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import { computed,watch  } from "vue";
import NoData from "./shared/grid/NoData.vue";
const props = defineProps({
  columns: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    required: false,
    default: false,
  },
  highlight: {
    type: Boolean,
    required: false,
    default: false,
  },
  highlightText: {
    type: String,
    default: "",
  },
  title: {
    type: String,
    default: "",
  },
  virtualScroll: {
    type: Boolean,
    default: true,
  },
  height: {
    type: String,
    default: "100%",
  },
  pagination: {
    type: Boolean,
    default: false,
  },
  rowsPerPage: {
    type: Number,
    default: 20,
  },
  dense: {
    type: Boolean,
    default: false,
  },
  hideHeader: {
    type: Boolean,
    default: false,
  },
  filter: {
    type: Object,
    default: () => null,
  },
  bordered: {
    type: Boolean,
    default: true,
  },
  tableStyle: {
    type: String,
    default: "",
  },
  hideTopPagination: {
    type: Boolean,
    default: false,
  },
  showBottomPaginationWithTitle: {
    type: Boolean,
    default: false,
  },
  selection: {
    type: String,
    default: "none",
  },
  rowKey: {
    type: String,
    default: "index",
  },
  selected: {
    type: Array,
    default: () => [],
  },
  theme: {
    type: String,
    default: "light",
  },
});

const emit = defineEmits(["event-emitted", "update:selected"]);

const perPageOptions: any = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 }
];

const resultTotal = ref<number>(0);
const selectedPerPage = ref<number>(20);

const qTableRef: Ref<InstanceType<typeof QTable> | null> = ref(null);

const selectedRows = computed({
  get: () => props.selected,
  set: (val) => emit("update:selected", val),
});

const showPagination = computed(() => {
  return props.pagination;
});

const _pagination: any = ref({
  rowsPerPage: props.rowsPerPage,
});
const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  _pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(_pagination.value);
};
const handleDataClick = (columnName: string, row: any) => {
  emit("event-emitted", "cell-click", { columnName, row });
};

const onScroll = (e: any) => {
  try {
    emit("event-emitted", "scroll", e);
  } catch (e) {
    console.log("error", e);
  }
};
watch(
  () => props.rows,
  (newRows) => {
    resultTotal.value = newRows.length;
  },
  { immediate: true } // Ensures it runs on initial load
);

</script>

<style lang="scss">
.app-table-container {
  .thead-sticky,
  .tfoot-sticky {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
  }

  .q-table__bottom {
    .q-table__control {
      padding-top: 0;
      padding-bottom: 0;
    }
  }
}
</style>
