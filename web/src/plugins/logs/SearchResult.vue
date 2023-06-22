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
    <div class="search-list" ref="searchListContainer" style="width: 100%">
      <BarChart
        data-test="logs-search-result-bar-chart"
        ref="plotChart"
        v-show="
          searchObj.meta.showHistogram &&
          !searchObj.meta.sqlMode &&
          searchObj.data.stream.streamType !== 'enrichment_tables'
        "
        @updated:chart="onChartUpdate"
      ></BarChart>

      <q-virtual-scroll
        data-test="logs-search-result-logs-table"
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
                :data-test="`log-search-result-table-th-${col.label}`"
              >
                <q-chip
                  v-if="col.closable"
                  :data-test="`logs-search-result-table-th-remove-${col.label}-btn`"
                  icon-remove="
                    cancel
                  "
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
            :data-test="`logs-search-result-detail-${
              row[store.state.zoConfig.timestamp_column]
            }`"
            :key="'expand_' + index"
            @click="expandRowDetail(row, index)"
            style="cursor: pointer"
            class="pointer"
            :style="
              row[store.state.zoConfig.timestamp_column] ==
              searchObj.data.searchAround.indexTimestamp
                ? 'background-color:lightgray'
                : ''
            "
          >
            <q-td
              v-for="column in searchObj.data.resultGrid.columns"
              :key="index + '-' + column.name"
              class="field_list"
              style="cursor: pointer"
            >
              <div class="flex row items-center no-wrap">
                <q-btn
                  v-if="column.name === '@timestamp'"
                  :icon="
                    expandedLogs[index.toString()]
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  @click.stop="expandLog(row, index)"
                ></q-btn>
                <high-light
                  :content="
                    column.name == 'source'
                      ? column.prop(row)
                      : searchObj.data.resultGrid.columns.length > 2 &&
                        column.prop(row, column.name).length > 100
                      ? column.prop(row, column.name).substr(0, 100) + '...'
                      : column.name != '@timestamp'
                      ? row[column.name]
                      : column.prop(row, column.name)
                  "
                  :query-string="
                    searchObj.meta.sqlMode
                      ? searchObj.data.query.split('where')[1]
                      : searchObj.data.query
                  "
                  :title="
                    column.prop(row, column.name).length > 100 &&
                    column.name != 'source'
                      ? column.prop(row, column.name)
                      : ''
                  "
                ></high-light>
              </div>
              <div
                v-if="column.closable && row[column.name]"
                class="field_overlay"
                :title="row.name"
              >
                <q-btn
                  :icon="'img:' + getImageURL('images/common/equals.svg')"
                  class="q-mr-xs"
                  size="6px"
                  @click.prevent.stop="
                    addSearchTerm(`${column.name}='${row[column.name]}'`)
                  "
                  title="Include Term"
                  round
                />
                <q-btn
                  :icon="'img:' + getImageURL('images/common/not_equals.svg')"
                  size="6px"
                  @click.prevent.stop="
                    addSearchTerm(`${column.name}!='${row[column.name]}'`)
                  "
                  title="Exclude Term"
                  round
                />
              </div>
            </q-td>
          </q-tr>
          <q-tr v-if="expandedLogs[index.toString()]">
            <td :colspan="searchObj.data.resultGrid.columns.length">
              <div class="q-py-xs flex justify-start q-px-md copy-log-btn">
                <q-btn
                  label="Copy to clipboard"
                  dense
                  size="sm"
                  no-caps
                  class="q-px-sm"
                  icon="content_copy"
                  @click="copyLogToClipboard(row)"
                />
              </div>
              <div class="q-pl-md">
                {
                <div
                  class="log_json_content "
                  v-for="key in Object.keys(row)"
                  :key="key"
                >
                  <q-btn-dropdown
                    data-test="log-details-include-exclude-field-btn"
                    size="0.5rem"
                    flat
                    outlined
                    filled
                    dense
                    class="q-ml-sm pointer"
                    :name="'img:' + getImageURL('images/common/add_icon.svg')"
                  >
                    <q-list>
                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-include-field-btn"
                            @click="addSearchTerm(`${key}='${row[key]}'`)"
                            ><q-btn
                              title="Add to search query"
                              :icon="
                                'img:' + getImageURL('images/common/equals.svg')
                              "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            ></q-btn
                            >Include Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>

                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-exclude-field-btn"
                            @click="addSearchTerm(`${key}!='${row[key]}'`)"
                            ><q-btn
                              title="Add to search query"
                              :icon="
                                'img:' +
                                getImageURL('images/common/not_equals.svg')
                              "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            ></q-btn
                            >Exclude Search Term</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                      <q-item clickable v-close-popup>
                        <q-item-section>
                          <q-item-label
                            data-test="log-details-exclude-field-btn"
                            @click="addFieldToTable(key)"
                            ><q-btn
                              title="Add field to table"
                              :icon="
                                'img:' +
                                getImageURL('images/common/visibility_on.svg')
                              "
                              size="6px"
                              round
                              class="q-mr-sm pointer"
                            ></q-btn
                            >Add field to table</q-item-label
                          >
                        </q-item-section>
                      </q-item>
                    </q-list>
                  </q-btn-dropdown>

                  <span class="q-pl-xs">{{ key }} : {{ row[key] }},</span>
                </div>
                }
              </div>
            </td>
          </q-tr>
        </template>
      </q-virtual-scroll>
      <q-dialog
        v-model="searchObj.meta.showDetailTab"
        position="right"
        full-height
        maximized
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
          :stream-type="searchObj.data.stream.streamType"
          style="margin-bottom: 15px"
          :currentIndex="searchObj.meta.resultGrid.navigation.currentRowIndex"
          :totalLength="parseInt(searchObj.data.queryResults.hits.length)"
          @showNextDetail="navigateRowDetail"
          @showPrevDetail="navigateRowDetail"
          @add:searchterm="addSearchTerm"
          @remove:searchterm="removeSearchTerm"
          @search:timeboxed="onTimeBoxed"
        />
      </q-dialog>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from "vue";
import { copyToClipboard, useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import HighLight from "../../components/HighLight.vue";
import { byString } from "../../utils/json";
import DetailTable from "./DetailTable.vue";
import useLogs from "../../composables/useLogs";
import BarChart from "../../components/logBarChart.vue";
import { getImageURL } from "../../utils/zincutils";

export default defineComponent({
  name: "SearchResult",
  components: {
    HighLight,
    BarChart,
    DetailTable,
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "remove:searchTerm",
    "search:timeboxed",
    "expandlog",
  ],
  props: {
    expandedLogs: {
      type: Object,
      default: () => ({}),
    },
  },
  methods: {
    closeColumn(col: any) {
      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.name);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = this.searchObj.data.stream.selectedFields.indexOf(
        col.name
      );

      this.searchObj.data.stream.selectedFields.splice(SFIndex, 1);
      this.searchObj.organizationIdetifier =
        this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
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
        start.split(" ")[1].split(":")[1] +
        ":" +
        start.split(" ")[1].split(":")[2];
      this.searchObj.data.datetime.absolute.endTime =
        end.split(" ")[1].split(":")[0] +
        ":" +
        end.split(" ")[1].split(":")[1] +
        ":" +
        end.split(" ")[1].split(":")[2];

      this.searchObj.runQuery = true;
      this.$emit("update:datetime");
    },
    onScroll(info: any) {
      this.searchObj.meta.scrollInfo = info;
      if (
        info.ref.items.length / info.index <= 1.3 &&
        this.searchObj.loading == false &&
        this.searchObj.data.resultGrid.currentPage <=
          this.searchObj.data.queryResults.hits.length /
            this.searchObj.meta.resultGrid.rowsPerPage
      ) {
        this.$emit("update:scroll");
      }
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      this.$emit("search:timeboxed", obj);
    },
  },
  setup(props, { emit }) {
    // Accessing nested JavaScript objects and arrays by string path
    // https://stackoverflow.com/questions/6491463/accessing-nested-javascript-objects-and-arrays-by-string-path
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const searchListContainer = ref(null);

    const { searchObj, updatedLocalLogFilterField } = useLogs();
    const totalHeight = ref(0);

    const searchTableRef: any = ref(null);

    const plotChart: any = ref(null);
    const expandedLogs: any = ref({});

    const reDrawChart = () => {
      if (
        // eslint-disable-next-line no-prototype-builtins
        searchObj.data.histogram.hasOwnProperty("xData") &&
        searchObj.data.histogram.xData.length > 0
      ) {
        plotChart.value.reDraw(
          searchObj.data.histogram.xData,
          searchObj.data.histogram.yData,
          searchObj.data.histogram.chartParams
        );
        plotChart.value.forceReLayout();
      }
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

    const expandLog = async (row: any, index: number) => {
      emit("expandlog", index);
    };

    const getWidth = computed(() => {
      console.log("get search width", searchListContainer);
      return "";
    });

    function addFieldToTable(fieldName: string) {
      if (searchObj.data.stream.selectedFields.includes(fieldName)) {
        searchObj.data.stream.selectedFields =
          searchObj.data.stream.selectedFields.filter(
            (v: any) => v !== fieldName
          );
      } else {
        searchObj.data.stream.selectedFields.push(fieldName);
      }
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;
      updatedLocalLogFilterField();
    }

    const copyLogToClipboard = (log: any) => {
      copyToClipboard(JSON.stringify(log)).then(() =>
        $q.notify({
          type: "positive",
          message: "Content Copied Successfully!",
          timeout: 1000,
        })
      );
    };

    return {
      t,
      store,
      plotChart,
      searchObj,
      updatedLocalLogFilterField,
      byString,
      searchTableRef,
      addSearchTerm,
      removeSearchTerm,
      expandRowDetail,
      changeMaxRecordToReturn,
      navigateRowDetail,
      totalHeight,
      reDrawChart,
      expandLog,
      getImageURL,
      addFieldToTable,
      searchListContainer,
      getWidth,
      copyLogToClipboard,
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
      background-color: #f5f5f5;
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

  .log_json_content {
    white-space: pre-wrap;
    font-family: monospace;
  }
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

.q-table--dark .table-header {
    // text-transform: capitalize;

    .table-head-chip {
      background-color: #565656;
    }
  }

.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}

.field_list {
  padding: 0px;
  margin-bottom: 0.125rem;
  position: relative;
  overflow: visible;
  cursor: default;
  font-size: 12px;
  font-family: monospace;

  .field_overlay {
    position: absolute;
    height: 100%;
    right: 0;
    top: 0;
    background-color: #ffffff;
    border-radius: 6px;
    padding: 0 6px;
    visibility: hidden;
    display: flex;
    align-items: center;
    transition: all 0.3s linear;

    .q-icon {
      cursor: pointer;
      opacity: 0;
      transition: all 0.3s linear;
      margin: 0 1px;
    }
  }

  &:hover {
    .field_overlay {
      visibility: visible;

      .q-icon {
        opacity: 1;
      }
    }
  }
}
</style>

<style lang="scss">
.search-list {
  .copy-log-btn {
    .q-btn .q-icon {
      font-size: 12px !important;
    }
  }
}
</style>
