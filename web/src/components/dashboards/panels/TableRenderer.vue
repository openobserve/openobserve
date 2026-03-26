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
  <div class="table-wrapper">
    <TenstackTable
      ref="tableRef"
      :data="data"
      :value-mapping="valueMapping"
      :wrap="wrapCells"
      :show-pagination="showPagination"
      :rows-per-page="rowsPerPage"
      :enable-cell-copy="true"
      data-test="dashboard-panel-table"
      @click:dataRow="(row: any, _idx: number, evt?: MouseEvent) => $emit('row-click', evt ?? null, row)"
    >
      <!-- Pass through the bottom slot with the full scope -->
      <template v-if="$slots.bottom" #bottom="scope">
        <slot name="bottom" v-bind="scope" />
      </template>
    </TenstackTable>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import TenstackTable from "@/components/TenstackTable.vue";
import { TABLE_ROWS_PER_PAGE_DEFAULT_VALUE } from "@/utils/dashboard/constants";

export default defineComponent({
  name: "TableRenderer",
  components: { TenstackTable },
  props: {
    data: {
      required: true,
      type: Object,
      default: () => ({ rows: [], columns: {} }),
    },
    wrapCells: {
      required: false,
      type: Boolean,
      default: false,
    },
    valueMapping: {
      required: false,
      type: Array,
      default: () => [],
    },
    showPagination: {
      required: false,
      type: Boolean,
      default: false,
    },
    rowsPerPage: {
      required: false,
      type: Number,
      default: TABLE_ROWS_PER_PAGE_DEFAULT_VALUE,
    },
  },
  emits: ["row-click"],
  setup() {
    const tableRef = ref<any>(null);

    const downloadTableAsCSV = (title?: string) => {
      tableRef.value?.downloadCsv(title);
    };

    const downloadTableAsJSON = (title?: string) => {
      tableRef.value?.downloadJson(title);
    };

    return { tableRef, downloadTableAsCSV, downloadTableAsJSON };
  },
});
</script>

<style lang="scss" scoped>
.table-wrapper {
  height: 100%;
  width: 100%;
  position: relative;
}

@media print {
  .table-wrapper {
    overflow: hidden !important;
    max-height: 100% !important;
    page-break-inside: avoid;
  }
}
</style>
