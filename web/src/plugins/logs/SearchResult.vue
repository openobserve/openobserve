<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div class="col column oveflow-hidden">
    <div class="search-list" style="width: 100%">
      <BarChart
        ref="plotChart"
        v-if="searchObj.meta.showHistogram"
        @updated:chart="onChartUpdate"
      ></BarChart>

      <q-virtual-scroll
        id="searchGridComponent"
        type="table"
        ref="searchTableRef"
        :virtual-scroll-item-size="25"
        :virtual-scroll-sticky-size-start="0"
        :virtual-scroll-sticky-size-end="0"
        :virtual-scroll-slice-size="300"
        :virtual-scroll-slice-ratio-before="10"
        :items="searchObj.data.queryResults.hits"
        @virtual-scroll="onScroll"
      >
        <template v-slot:before>
          <thead class="thead-sticky text-left">
            <tr>
              <th
                v-for="(col, index) in searchObj.data.resultGrid.columns"
                :key="'result_' + index"
                class="table-header"
              >
                <q-chip
                  v-if="col.closable"
                  icon-remove="img:/src/assets/images/common/close_icon.svg"
                  class="q-ma-none table-head-chip"
                  removable
                  square
                  @remove="closeColumn(col)"
                >
                  {{ col.label }}
                </q-chip>

                <span v-else class="table-head-label">
                  {{ col.label }}
                </span>
              </th>
            </tr>
          </thead>
        </template>

        <template v-slot="{ item: row, index }">
          <q-tr
            :key="'expand_' + index"
            @click="expandRowDetail(row, index)"
            style="cursor: pointer"
          >
            <q-td
              v-for="column in searchObj.data.resultGrid.columns"
              :key="index + '-' + column.name"
            >
              <div
                :title="
                  column.prop(row, column.name).length > 100
                    ? column.prop(row, column.name)
                    : ''
                "
              >
                {{
                  column.name == "source"
                    ? column.prop(row)
                    : column.prop(row, column.name).length > 100
                    ? column.prop(row, column.name).substr(0, 100) + "..."
                    : column.prop(row, column.name)
                }}
              </div>
            </q-td>
          </q-tr></template
        >
      </q-virtual-scroll>
      <q-dialog
        v-model="searchObj.meta.showDetailTab"
        position="right"
        full-height
        seamless
        maximized
        @keyup="onCancel"
      >
        <DetailTable
          :key="
            'dialog_' + searchObj.meta.resultGrid.navigation.currentRowIndex
          "
          v-model="
            searchObj.data.queryResults.hits[
              searchObj.meta.resultGrid.navigation.currentRowIndex
            ]
          "
          style="margin-bottom: 15px"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          @showNextDetail="navigateRowDetail"
          @showPrevDetail="navigateRowDetail"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onChartUpdate"
        />
      </q-dialog>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import HighLight from "../../components/HighLight.vue";
import { byString } from "../../utils/json";
import DetailTable from "./DetailTable.vue";
import useLogs from "../../composables/useLogs";
import BarChart from "../../components/logBarChart.vue";

export default defineComponent({
  name: "SearchResult",
  components: {
    HighLight,
    BarChart,
    DetailTable,
  },
  emits: ["update:scroll", "update:datetime", "remove:searchTerm"],
  methods: {
    closeColumn(col: any) {
      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.name);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = this.searchObj.data.stream.selectedFields.indexOf(
        col.name
      );

      this.searchObj.data.stream.selectedFields.splice(SFIndex, 1);
    },
    onChartUpdate({ start, end }: { start: any; end: any }) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.runQuery = true;
      this.searchObj.data.datetime.tab = "absolute";
      this.searchObj.data.datetime.absolute.date.from = start.split(" ")[0];
      this.searchObj.data.datetime.absolute.date.to = end.split(" ")[0];
      this.searchObj.data.datetime.absolute.startTime =
        start.split(" ")[1].split(":")[0] +
        ":" +
        start.split(" ")[1].split(":")[1];
      this.searchObj.data.datetime.absolute.endTime =
        end.split(" ")[1].split(":")[0] + ":" + end.split(" ")[1].split(":")[1];

      // this.searchObj.runQuery = true;
      this.$emit("update:datetime");
    },
    onScroll(info: any) {
      this.searchObj.meta.scrollInfo = info;
      // console.log(
      //   info.ref.items.length,
      //   this.searchObj.data.resultGrid.currentPage,
      //   this.searchObj.data.queryResults.from /
      //     this.searchObj.meta.resultGrid.rowsPerPage
      // );
      if (
        info.ref.items.length / info.index <= 2 &&
        this.searchObj.loading == false &&
        this.searchObj.data.resultGrid.currentPage <=
          this.searchObj.data.queryResults.from /
            this.searchObj.meta.resultGrid.rowsPerPage
      ) {
        this.searchObj.data.resultGrid.currentPage += 1;
        this.$emit("update:scroll");
      }
    },
    onCancel() {
      if (this.searchObj.meta.showDetailTab) {
        this.searchObj.meta.showDetailTab = false;
      }
    },
  },
  setup(props, { emit }) {
    // Accessing nested JavaScript objects and arrays by string path
    // https://stackoverflow.com/questions/6491463/accessing-nested-javascript-objects-and-arrays-by-string-path
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();

    const { searchObj } = useLogs();
    const totalHeight = ref(0);

    const searchTableRef: any = ref(null);

    const plotChart: any = ref(null);

    const reDrawChart = () => {
      plotChart.value.reDraw(
        searchObj.data.histogram.xData,
        searchObj.data.histogram.yData,
        searchObj.data.histogram.chartParams
      );
      plotChart.value.forceReLayout();
    };

    const changeMaxRecordToReturn = (val: any) => {
      // searchObj.meta.resultGrid.pagination.rowsPerPage = val;
    };

    const expandRowDetail = (props: any, index: number) => {
      searchObj.meta.showDetailTab = true;
      searchObj.meta.resultGrid.navigation.currentRowIndex = index;
    };

    const getRowIndex = (next: boolean, prev: boolean, oldIndex: number) => {
      if (next) {
        return oldIndex + 1;
      } else {
        return oldIndex - 1;
      }
    };

    const navigateRowDetail = (isNext: boolean, isPrev: boolean) => {
      const newIndex = getRowIndex(
        isNext,
        isPrev,
        Number(searchObj.meta.resultGrid.navigation.currentRowIndex)
      );
      searchObj.meta.resultGrid.navigation.currentRowIndex = newIndex;
    };

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const removeSearchTerm = (term: string) => {
      emit("remove:searchTerm", term);
    };

    removeSearchTerm;

    return {
      t,
      plotChart,
      searchObj,
      byString,
      searchTableRef,
      addSearchTerm,
      removeSearchTerm,
      expandRowDetail,
      changeMaxRecordToReturn,
      navigateRowDetail,
      totalHeight,
      reDrawChart,
    };
  },
});
</script>

<style lang="scss" scoped>
.max-result {
  width: 170px;
}

.search-list {
  width: 100%;

  .chart {
    width: 100%;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  }

  .my-sticky-header-table {
    .q-table__top,
    .q-table__bottom,
    thead tr:first-child th {
      /* bg color is important for th; just specify one */
      background-color: white;
    }

    thead tr th {
      position: sticky;
      z-index: 1;
    }

    thead tr:first-child th {
      top: 0;
    }

    /* this is when the loading indicator appears */
    &.q-table--loading thead tr:last-child th {
      /* height of all previous header rows */
      top: 48px;
    }
  }

  .q-table__top {
    padding-left: 0;
    padding-top: 0;
  }

  .q-table thead tr,
  .q-table tbody td,
  .q-table th,
  .q-table td {
    height: 25px;
    padding: 0px 5px;
    font-size: 0.75rem;
  }

  .q-table__bottom {
    width: 100%;
  }

  .q-table__bottom {
    min-height: 40px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .q-td {
    overflow: hidden;
    min-width: 100px;

    .expanded {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      word-break: break-all;
    }
  }

  .highlight {
    background-color: rgb(255, 213, 0);
  }

  .table-header {
    // text-transform: capitalize;

    .table-head-chip {
      background-color: $accent;
      padding: 0px;

      .q-chip__content {
        margin-right: 0.5rem;
        font-size: 0.75rem;
        color: $dark;
      }

      .q-chip__icon--remove {
        height: 1rem;
        width: 1rem;
        opacity: 1;
        margin: 0;

        &:hover {
          opacity: 0.7;
        }
      }

      .q-table th.sortable {
        cursor: pointer;
        text-transform: capitalize;
        font-weight: bold;
      }
    }

    &.isClosable {
      padding-right: 26px;
      position: relative;

      .q-table-col-close {
        transform: translateX(26px);
        position: absolute;
        margin-top: 2px;
        color: grey;
        transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
      }
    }

    .q-table th.sortable {
      cursor: pointer;
      text-transform: capitalize;
      font-weight: bold;
    }
  }
}
.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
  background: #f5f5f5;
  color: #090909;
}
.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}
</style>
