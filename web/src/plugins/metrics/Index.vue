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

<!-- eslint-disable vue/attribute-hyphenation -->
<!-- eslint-disable vue/v-on-event-hyphenation -->
<template>
  <q-page class="metrics-page" id="logPage">
    <div class="row scroll" style="width: 100%">
      <!-- Note: Splitter max-height to be dynamically calculated with JS -->
      <q-splitter
        v-model="searchObj.config.splitterModel"
        :limits="searchObj.config.splitterLimit"
        style="width: 100%"
      >
        <template #before>
          <metric-list
            data-test="logs-search-index-list"
            :key="searchObj.data.metrics.metricList"
          />
        </template>
        <template #separator>
          <q-avatar
            color="primary"
            text-color="white"
            size="20px"
            icon="drag_indicator"
            style="top: 10px"
          />
        </template>
        <template #after>
          <div
            class="text-right q-px-lg q-py-sm flex align-center justify-end metrics-date-time"
          >
            <date-time
              data-test="logs-search-bar-date-time-dropdown"
              @date-change="updateDateTime"
            />
            <auto-refresh-interval
              class="q-pr-sm"
              v-model="searchObj.meta.refreshInterval"
            />
            <q-btn
              data-test="metrics-explorer-run-query-button"
              data-cy="metrics-explorer-run-query-button"
              dense
              flat
              title="Run query"
              class="q-pa-none search-button"
              @click="searchData"
              :disable="
                searchObj.loading || searchObj.data.streamResults.length == 0
              "
            >
              Run query
            </q-btn>
          </div>
          <div>
            <div class="row query-editor-container">
              <div
                class="col q-pa-sm"
                style="border-top: 1px solid #dbdbdb; height: 150px"
              >
                <div class="q-pb-xs text-bold">PromQL:</div>
                <query-editor
                  id="metrics-query-editor"
                  ref="metricsQueryEditorRef"
                  class="monaco-editor"
                  :show-auto-complete="false"
                  v-model:query="searchObj.data.query"
                  @update-query="updateQueryValue"
                  @run-query="searchData"
                />
              </div>
            </div>
          </div>
          <div v-if="searchObj.loading">
            <q-spinner-dots
              color="primary"
              size="40px"
              style="margin: 0 auto; display: block"
            />
          </div>
          <div
            v-else-if="
              searchObj.data.errorMsg !== '' && searchObj.loading == false
            "
          >
            <h5 class="text-center">
              <div
                data-test="logs-search-result-not-found-text"
                v-if="searchObj.data.errorCode == 0"
              >
                Result not found.
              </div>
              <div
                data-test="logs-search-error-message"
                v-html="searchObj.data.errorMsg"
              ></div>
              <br />
              <q-item-label>{{
                searchObj.data.additionalErrorMsg
              }}</q-item-label>
            </h5>
          </div>
          <div v-else-if="!!!searchObj.data.metrics.selectedMetrics.length">
            <h5
              data-test="logs-search-no-stream-selected-text"
              class="text-center"
            >
              No metrics selected.
            </h5>
          </div>
          <div
            v-else-if="
              searchObj.data.queryResults.hasOwnProperty('total') &&
              !!!searchObj.data.queryResults.hits.length &&
              !searchObj.loading
            "
          >
            <h5 class="text-center">No result found.</h5>
          </div>
          <template v-if="searchObj.data.metrics.metricList.length">
            <div class="flex justify-end q-px-sm">
              <q-btn
                class="q-px-sm"
                no-caps
                dense
                color="primary"
                @click="addToDashboard"
                >Add to dashboard</q-btn
              >
            </div>
            <div style="height: 500px">
              <chart-render
                v-if="chartData"
                :height="6"
                :data="chartData"
                :selected-time-date="dashboardPanelData.meta.dateTime"
              />
            </div>
          </template>
        </template>
      </q-splitter>
    </div>
    <q-dialog
      v-model="showAddToDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <add-to-dashboard @save="addPanelToDashboard"></add-to-dashboard>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  onMounted,
  ref,
  onDeactivated,
  onActivated,
  onBeforeMount,
} from "vue";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import MetricList from "./MetricList.vue";
import MetricsViewer from "./MetricsViewer.vue";
import useMetrics from "@/composables/useMetrics";
import { Parser } from "node-sql-parser";

import streamService from "@/services/stream";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import DateTime from "@/components/DateTime.vue";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { verifyOrganizationStatus } from "@/utils/zincutils";
import QueryEditor from "@/components/dashboards/QueryEditor.vue";
import ChartRender from "@/components/dashboards/addPanel/ChartRender.vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { cloneDeep } from "lodash-es";
import AddToDashboard from "./AddToDashboard.vue";
import { addPanel } from "@/utils/commons";

export default defineComponent({
  name: "AppMetrics",
  components: {
    MetricList,
    DateTime,
    AutoRefreshInterval,
    QueryEditor,
    ChartRender,
    AddToDashboard,
  },
  methods: {
    searchData() {
      if (!this.searchObj.loading) {
        this.runQuery();
      }

      if (config.isCloud == "true") {
        segment.track("Button Click", {
          button: "Refresh Metrics",
          user_org: this.store.state.selectedOrganization.identifier,
          user_id: this.store.state.userInfo.email,
          stream_name: this.searchObj.data.metrics.selectedMetrics[0],
          page: "Metrics explorer",
        });
      }
    },
  },
  setup() {
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();
    const { t } = useI18n();
    const { searchObj, resetSearchObj } = useMetrics();
    let dismiss = null;
    let refreshIntervalID = 0;
    const searchResultRef = ref(null);
    const searchBarRef = ref(null);
    const parser = new Parser();
    const metricsQueryEditorRef = ref(null);
    const { dashboardPanelData, resetDashboardPanelData } =
      useDashboardPanelData();

    const chartData = ref({});

    searchObj.organizationIdetifier =
      store.state.selectedOrganization.identifier;

    const updateStreams = () => {
      if (searchObj.data.streamResults?.list?.length) {
        const streamType = "metrics";
        streamService
          .nameList(
            store.state.selectedOrganization.identifier,
            streamType,
            true
          )
          .then((response: any) => {
            searchObj.data.streamResults = response.data;
            searchObj.data.metrics.metricList = [];
            response.data.list.map((item: any) => {
              let itemObj = {
                label: item.name,
                value: item.name,
              };
              searchObj.data.metrics.metricList.push(itemObj);
            });
          });
      } else {
        loadPageData();
      }
    };
    const showAddToDashboardDialog = ref(false);

    onBeforeMount(() => {
      dashboardPanelData.data.queryType = "promql";
      dashboardPanelData.data.fields.stream_type = "metrics";
      dashboardPanelData.data.customQuery = true;
    });

    function ErrorException(message) {
      searchObj.loading = false;
      $q.notify({
        type: "negative",
        message: message,
        timeout: 10000,
        actions: [
          {
            icon: "close",
            color: "white",
            handler: () => {
              /* ... */
            },
          },
        ],
      });
    }

    function Notify() {
      return $q.notify({
        type: "positive",
        message: "Waiting for response...",
        timeout: 10000,
        actions: [
          {
            icon: "close",
            color: "white",
            handler: () => {
              /* ... */
            },
          },
        ],
      });
    }

    function getStreamList() {
      try {
        streamService
          .nameList(
            store.state.selectedOrganization.identifier,
            "metrics",
            true
          )
          .then((res) => {
            searchObj.data.streamResults = res.data;

            if (res.data.list.length > 0) {
              //extract stream data from response
              loadStreamLists();
            } else {
              searchObj.loading = false;
              searchObj.data.errorMsg =
                "No stream found in selected organization!";
              searchObj.data.metrics.metricList = [];
              searchObj.data.queryResults = {};
              searchObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {},
              };
            }
          })
          .catch((e) => {
            searchObj.loading = false;
            $q.notify({
              type: "negative",
              message:
                "Error while pulling index for selected organization" +
                e.message,
              timeout: 2000,
            });
          });
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function loadStreamLists() {
      try {
        searchObj.data.metrics.metricList = [];
        searchObj.data.metrics.selectedMetrics = [];
        if (searchObj.data.streamResults.list.length) {
          let lastUpdatedStreamTime = 0;
          let selectedStreamItemObj = {};
          searchObj.data.streamResults.list.map((item: any) => {
            let itemObj = {
              label: item.name,
              value: item.name,
            };
            searchObj.data.metrics.metricList.push(itemObj);

            if (item.stats.doc_time_max >= lastUpdatedStreamTime) {
              lastUpdatedStreamTime = item.stats.doc_time_max;
              selectedStreamItemObj = itemObj;
            }
          });
          if (selectedStreamItemObj.label != undefined) {
            searchObj.data.metrics.selectedMetrics = [];
            searchObj.data.metrics.selectedMetrics.push(
              selectedStreamItemObj.value
            );
          } else {
            searchObj.loading = false;
            searchObj.data.queryResults = {};
            searchObj.data.metrics.selectedMetrics = [];
            searchObj.data.histogram = {
              xData: [],
              yData: [],
              chartParams: {},
            };
          }
        } else {
          searchObj.loading = false;
        }
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function getConsumableDateTime() {
      try {
        if (searchObj.data.datetime.tab == "relative") {
          let period = "";
          let periodValue = 0;
          // quasar does not support arithmetic on weeks. convert to days.

          if (
            searchObj.data.datetime.relative.period.label.toLowerCase() ==
            "weeks"
          ) {
            period = "days";
            periodValue = searchObj.data.datetime.relative.value * 7;
          } else {
            period =
              searchObj.data.datetime.relative.period.label.toLowerCase();
            periodValue = searchObj.data.datetime.relative.value;
          }
          const subtractObject = '{"' + period + '":' + periodValue + "}";

          let endTimeStamp = new Date();

          const startTimeStamp = date.subtractFromDate(
            endTimeStamp,
            JSON.parse(subtractObject)
          );

          return {
            start_time: startTimeStamp,
            end_time: endTimeStamp,
          };
        } else {
          let start, end;
          if (
            searchObj.data.datetime.absolute.date.from == "" &&
            searchObj.data.datetime.absolute.startTime == ""
          ) {
            start = new Date();
          } else {
            start = new Date(
              searchObj.data.datetime.absolute.date.from +
                " " +
                searchObj.data.datetime.absolute.startTime
            );
          }
          if (
            searchObj.data.datetime.absolute.date.to == "" &&
            searchObj.data.datetime.absolute.endTime == ""
          ) {
            end = new Date();
          } else {
            end = new Date(
              searchObj.data.datetime.absolute.date.to +
                " " +
                searchObj.data.datetime.absolute.endTime
            );
          }
          const rVal = {
            start_time: start,
            end_time: end,
          };
          return rVal;
        }
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function buildSearch() {
      try {
        var req: any = {
          sql: searchObj.data.query,
          start_time: (new Date().getTime() - 900000) * 1000,
          end_time: new Date().getTime() * 1000,
        };

        var timestamps: any = getConsumableDateTime();
        if (
          timestamps.start_time != "Invalid Date" &&
          timestamps.end_time != "Invalid Date"
        ) {
          const startISOTimestamp: any =
            new Date(timestamps.start_time.toISOString()).getTime() * 1000;
          const endISOTimestamp: any =
            new Date(timestamps.end_time.toISOString()).getTime() * 1000;
          req.start_time = startISOTimestamp;
          req.end_time = endISOTimestamp;
        } else {
          return false;
        }

        return req;
      } catch (e) {
        throw new ErrorException(e.message);
      }
    }

    function runQuery() {
      try {
        if (
          !searchObj.data.metrics.selectedMetrics.length ||
          !searchObj.data.query
        ) {
          return false;
        }

        // dismiss = Notify();

        chartData.value = cloneDeep(dashboardPanelData.data);
      } catch (e) {
        throw new ErrorException("Request failed.", e.message);
      }
    }

    const getDefaultTrace = (trace: any) => {
      return {
        x: [],
        y: [],
        unparsed_x: [],
        name: trace.name || "",
        type: trace.type || "line",
        marker: {
          color: trace.color || "#5960b2",
          opacity: trace.opacity || 0.8,
        },
      };
    };

    function generateHistogramData() {
      const unparsed_x_data: any[] = [];
      const xData: string[] = [];

      const minTrace = getDefaultTrace({
        name: "Min",
        color: "#7fc845",
        opacity: 0.8,
      });
      const maxTrace = getDefaultTrace({
        name: "Max",
        color: "#458cc8",
        opacity: 0.8,
      });
      const avgTrace = getDefaultTrace({
        name: "Avg",
        color: "#c85e45",
        opacity: 0.8,
      });

      if (searchObj.data.queryResults.hits.length) {
        searchObj.data.queryResults.hits.forEach(
          (bucket: {
            avg: number;
            max: number;
            min: number;
            zo_timestamp: string | Date | number;
          }) => {
            unparsed_x_data.push(bucket.zo_timestamp);
            let histDate = new Date(bucket.zo_timestamp + "Z");
            xData.push(Math.floor(histDate.getTime()));
            minTrace.y.push(parseInt(bucket.min, 10));
            maxTrace.y.push(parseInt(bucket.max, 10));
            avgTrace.y.push(parseInt(bucket.avg, 10));
          }
        );
      }

      minTrace.x = xData;
      minTrace.unparsed_x = unparsed_x_data;

      maxTrace.x = xData;
      maxTrace.unparsed_x = unparsed_x_data;

      avgTrace.x = xData;
      avgTrace.unparsed_x = unparsed_x_data;

      const chartParams = {
        title:
          "Showing " +
          Math.min(
            searchObj.data.queryResults.size,
            searchObj.data.queryResults.total
          ) +
          " out of " +
          searchObj.data.queryResults.total.toLocaleString() +
          " hits in " +
          searchObj.data.queryResults.took +
          " ms. (Scan Size: " +
          searchObj.data.queryResults.scan_size +
          "MB)",
      };
      searchObj.data.histogram = {
        data: [minTrace, maxTrace, avgTrace],
        layout: chartParams,
      };
      if (searchResultRef.value?.reDrawChart) {
        setTimeout(() => {
          searchResultRef.value.reDrawChart();
        }, 500);
      }
    }

    function loadPageData() {
      // searchObj.loading = true;
      resetSearchObj();
      searchObj.organizationIdetifier =
        store.state.selectedOrganization.identifier;

      //get stream list
      getStreamList();
    }

    onMounted(() => {
      if (searchObj.loading == false) {
        loadPageData();

        refreshData();
      }
    });

    onDeactivated(() => {
      clearInterval(refreshIntervalID);
    });

    onActivated(() => {
      if (!searchObj.loading) updateStreams();
      refreshData();

      if (
        searchObj.organizationIdetifier !=
        store.state.selectedOrganization.identifier
      ) {
        loadPageData();
      }

      setTimeout(() => {
        if (searchResultRef.value) searchResultRef.value.reDrawChart();
      }, 1500);
    });

    const refreshData = () => {
      if (
        searchObj.meta.refreshInterval > 0 &&
        router.currentRoute.value.name == "metrics"
      ) {
        clearInterval(refreshIntervalID);

        refreshIntervalID = setInterval(() => {
          if (!searchObj.loading) runQuery();
        }, parseInt(searchObj.meta.refreshInterval) * 1000);

        $q.notify({
          message: `Live mode is enabled`,
          color: "positive",
          position: "top",
          timeout: 1000,
        });
      } else {
        clearInterval(refreshIntervalID);
      }
    };

    const setQuery = () => {};

    const updateDateTime = (value: any) => {
      searchObj.data.datetime = value;

      const timestamp = getConsumableDateTime(searchObj.data.datetime);
      console.log(timestamp);
      dashboardPanelData.meta.dateTime = timestamp;

      if (config.isCloud == "true" && value.userChangedValue) {
        let dateTimeVal;
        if (value.tab === "relative") {
          dateTimeVal = value.relative;
        } else {
          dateTimeVal = value.absolute;
        }

        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: dateTimeVal,
          metric_name: searchObj.data.metrics.selectedMetrics[0],
          page: "Search Metrics",
        });
      }
    };

    const updateQueryValue = (value) => {
      const { metricName, labels } = parsePromQlQuery(value);
      console.log(metricName, labels);
      dashboardPanelData.data.query = value;
    };

    const parsePromQlQuery = (query) => {
      // Extract metric name
      const metricNameMatch = query.match(/(\w+)\{/);
      const metricName = metricNameMatch ? metricNameMatch[1] : null;

      // Extract labels
      const labelsMatch = query.match(/\{(.+?)\}/);
      const labels = {};
      if (labelsMatch) {
        const labelsStr = labelsMatch[1];
        const labelPairs = labelsStr.match(/(\w+)="([^"]*)"/g);
        labelPairs.forEach((pair) => {
          const [key, value] = pair.match(/(\w+)="([^"]*)"/).slice(1);
          labels[key] = value;
        });
      }

      return { metricName, labels };
    };

    const addToDashboard = () => {
      showAddToDashboardDialog.value = true;
    };

    const addPanelToDashboard = (dashboardId) => {
      console.log("add panel to dashboard");
      dismiss = $q.notify({
        message: "Please wait while we add the panel to the dashboard",
        type: "ongoing",
        position: "bottom",
      });
      addPanel(store, dashboardId, dashboardPanelData.data)
        .then(() => {
          showAddToDashboardDialog.value = false;
          $q.notify({
            message: "Panel added to dashboard",
            type: "positive",
            position: "bottom",
            timeout: 3000,
          });
        })
        .catch((err) => {
          console.log(err);
          $q.notify({
            message: "Error while adding panel",
            type: "negative",
            position: "bottom",
            timeout: 2000,
          });
        })
        .finally(() => {
          dismiss();
        });
    };
    return {
      store,
      router,
      parser,
      searchObj,
      searchBarRef,
      loadPageData,
      runQuery,
      searchResultRef,
      getConsumableDateTime,
      refreshData,
      setQuery,
      updateDateTime,
      verifyOrganizationStatus,
      metricsQueryEditorRef,
      updateQueryValue,
      dashboardPanelData,
      chartData,
      addToDashboard,
      showAddToDashboardDialog,
      addPanelToDashboard,
    };
  },
  computed: {
    showQuery() {
      return this.searchObj.meta.showQuery;
    },
    changeOrganization() {
      return this.store.state.selectedOrganization.identifier;
    },
    selectedMetrics() {
      return this.searchObj.data.metrics.selectedMetrics;
    },
    changeRelativeDate() {
      return (
        this.searchObj.data.datetime.relative.value +
        this.searchObj.data.datetime.relative.period.value
      );
    },
    changeRefreshInterval() {
      return this.searchObj.meta.refreshInterval;
    },
  },
  watch: {
    changeOrganization() {
      // Fetch and update selected metrics
      this.verifyOrganizationStatus(
        this.store.state.organizations,
        this.router
      );
      this.loadPageData();
    },
    selectedMetrics: {
      deep: true,
      handler: function () {
        if (this.searchObj.data.metrics.selectedMetrics.length) {
          setTimeout(() => {
            this.runQuery();
          }, 500);
        }
      },
    },
    changeRelativeDate() {
      if (this.searchObj.data.datetime.tab == "relative") {
        this.runQuery();
      }
    },
    changeRefreshInterval() {
      this.refreshData();
    },
  },
});
</script>

<style lang="scss">
.query-editor-container {
  .monaco-editor {
    height: calc(100% - 40px) !important;
  }
}
div.plotly-notifier {
  visibility: hidden;
}
.metrics-page {
  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 12px !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .q-item__label span {
    /* text-transform: capitalize; */
  }

  .index-table :hover::-webkit-scrollbar,
  #searchGridComponent:hover::-webkit-scrollbar {
    height: 13px;
    width: 13px;
  }

  .index-table ::-webkit-scrollbar-track,
  #searchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #searchGridComponent::-webkit-scrollbar-thumb {
    border-radius: 10px;
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .q-table__top {
    padding: 0px !important;
  }

  .q-table__control {
    width: 100%;
  }

  .q-field__control-container {
    padding-top: 0px !important;
  }

  .refresh-button {
    .q-icon {
      font-size: 18px;
      padding-right: 2px;
    }
  }

  .metrics-date-time {
    .date-time-button {
      height: 100%;
      padding: 0 8px;
      background-color: #ffffff !important;
    }
  }

  .search-button {
    width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;

    .q-btn__content {
      background: $primary;
      border-radius: 0px 3px 3px 0px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }
}
</style>
