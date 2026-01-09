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

<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page class="tracePage" id="tracePage"
style="min-height: auto">
    <div id="tracesSecondLevel">
      <div
        class="tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs"
        :class="
          activeTab === 'service-maps' ? 'tw:min-h-[45px]' : 'tw:min-h-[82px]'
        "
      >
        <!-- Search Bar with Tab Toggle - Always visible to show tabs -->
        <search-bar
          data-test="logs-search-bar"
          ref="searchBarRef"
          :fieldValues="fieldValues"
          :isLoading="searchObj.loading"
          :activeTab="activeTab"
          class="card-container"
          @searchdata="searchData"
          @onChangeTimezone="refreshTimezone"
          @update:activeTab="activeTab = $event"
        />
      </div>

      <!-- Service Maps Tab Content -->
      <div
        v-if="activeTab === 'service-maps' && store.state.zoConfig.service_graph_enabled"
        class="tw:px-[0.625rem] tw:pb-[0.625rem] tw:h-[calc(100vh-98px)] tw:overflow-hidden"
      >
        <service-graph class="tw:h-full" />
      </div>

      <!-- Search Tab Content -->
      <div
        v-if="activeTab === 'search'"
        id="tracesThirdLevel"
        class="traces-search-result-container relative-position"
      >
        <!-- Note: Splitter max-height to be dynamically calculated with JS -->
        <q-splitter
          v-model="searchObj.config.splitterModel"
          :limits="searchObj.config.splitterLimit"
          style="width: 100%"
          @update:model-value="onSplitterUpdate"
          class="tw:h-full"
        >
          <template #before>
            <div class="tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
              <index-list
                v-show="searchObj.meta.showFields"
                ref="indexListRef"
                :field-list="searchObj.data.stream.selectedStreamFields"
                data-test="logs-search-index-list"
                class="card-container"
                :key="searchObj.data.stream.streamLists"
                @update:changeStream="onChangeStream"
              />
            </div>
          </template>
          <template #separator>
            <q-btn
              data-test="logs-search-field-list-collapse-btn"
              :icon="searchObj.meta.showFields ? 'chevron_left' : 'chevron_right'"
              :title="
                searchObj.meta.showFields ? t('traces.collapseFields') : t('traces.openFields')
              "
              :class="searchObj.meta.showFields ? 'splitter-icon-collapse' : 'splitter-icon-expand'"
              color="primary"
              size="sm"
              dense
              round
              @click="collapseFieldList"
            />
          </template>
          <template #after>
            <div
              class="tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]"
            >
              <div class="card-container tw:h-full">
                <div
                  v-if="
                    searchObj.data.errorMsg !== '' && searchObj.loading == false
                  "
                >
                  <h5 class="text-center">
                    <div
                      data-test="logs-search-result-not-found-text"
                      v-if="
                        searchObj.data.stream.streamLists.length &&
                        searchObj.data.errorCode == 0
                      "
                    >
                      {{ t("traces.noTracesFound") }}
                    </div>
                    <SanitizedHtmlRenderer
                      data-test="logs-search-error-message"
                      :htmlContent="`${searchObj.data.errorMsg}
                  ${searchObj.data.errorDetail ? `<h6 style='font-size: 14px; margin: 0;'>${searchObj.data.errorDetail}</h6>` : ''}`"
                    />
                    <div
                      data-test="logs-search-error-20003"
                      v-if="parseInt(searchObj.data.errorCode) == 20003"
                    >
                      <q-btn
                        no-caps
                        unelevated
                        size="sm"
                        bg-secondary
                        class="no-border bg-secondary text-white"
                        :to="
                          '/streams?dialog=' +
                          searchObj.data.stream.selectedStream.label
                        "
                        >Click here</q-btn
                      >
                      {{ t("traces.configureFullTextSearch") }}
                    </div>
                    <br />
                    <q-item-label>{{
                      searchObj.data.additionalErrorMsg
                    }}</q-item-label>
                  </h5>
                </div>
                <div v-else-if="!isStreamSelected">
                  <div
                    data-test="logs-search-no-stream-selected-text"
                    class="text-center tw:mx-[10%] tw:py-[40px] tw:mt-0 tw:text-[20px]"
                  >
                    <q-icon name="info" color="primary" size="md" />
                    {{ t("search.noStreamSelectedMessage") }}
                </div>
                </div>
                <div
                  data-test="logs-search-result-not-found-text"
                  v-else-if="
                    isStreamSelected &&
                    !searchObj.searchApplied &&
                    !searchObj.data.queryResults?.hits?.length
                  "
                  class="text-center tw:mx-[10%] tw:py-[40px] tw:text-[20px]"
                >
                  <q-icon name="info"
color="primary" size="md" />
                  {{ t("search.applySearch") }}
                </div>

                <div data-test="logs-search-search-result">
                  <search-result
                    ref="searchResultRef"
                    @update:datetime="setHistogramDate"
                    @update:scroll="getMoreData"
                    @shareLink="copyTracesUrl"
                  />
                </div>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts" setup>
// @ts-nocheck
import {
  defineComponent,
  ref,
  onDeactivated,
  onActivated,
  onBeforeMount,
  nextTick,
  defineAsyncComponent,
  watch,
} from "vue";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import useTraces from "@/composables/useTraces";

import searchService from "@/services/search";
import TransformService from "@/services/jstransform";
import {
  b64EncodeUnicode,
  verifyOrganizationStatus,
  b64DecodeUnicode,
  formatTimeWithSuffix,
  timestampToTimezoneDate,
} from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import useNotifications from "@/composables/useNotifications";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import { computed } from "vue";
import useStreams from "@/composables/useStreams";

const SearchBar = defineAsyncComponent(() => import("./SearchBar.vue"));
const IndexList = defineAsyncComponent(() => import("./IndexList.vue"));
const SearchResult = defineAsyncComponent(() => import("./SearchResult.vue"));
const SanitizedHtmlRenderer = defineAsyncComponent(
  () => import("@/components/SanitizedHtmlRenderer.vue"),
);
const ServiceGraph = defineAsyncComponent(() => import("./ServiceGraph.vue"));

const store = useStore();
const activeTab = ref("search");
const router = useRouter();
const $q = useQuasar();
const { t } = useI18n();
const { searchObj, resetSearchObj, getUrlQueryParams, copyTracesUrl } =
  useTraces();
let refreshIntervalID = 0;
const searchResultRef = ref(null);
const searchBarRef = ref(null);
let parser: any;
const fieldValues = ref({});
const { showErrorNotification } = useNotifications();
const serviceColorIndex = ref(0);
const colors = ref(["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2"]);
const indexListRef = ref(null);
const { getStreams, getStream } = useStreams();
const chartRedrawTimeout = ref(null);

searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;

const selectedStreamName = computed(
  () => searchObj.data.stream.selectedStream.value,
);

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

function getQueryTransform() {
  try {
    searchObj.data.stream.functions = [];
    TransformService.list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    )
      .then((res) => {
        res.data.list.map((data: any) => {
          let args: any = [];
          for (let i = 0; i < parseInt(data.num_args); i++) {
            args.push("'${1:value}'");
          }

          let itemObj = {
            name: data.name,
            args: "(" + args.join(",") + ")",
          };
          if (!data.stream_name) {
            searchObj.data.stream.functions.push(itemObj);
          }
        });
      })
      .catch((err) => console.log(err));

    return;
  } catch (e) {
    searchObj.loading = false;
    showErrorNotification("Error while getting functions");
  }
}

async function getStreamList() {
  try {
    getStreams("traces", false)
      .then(async (res) => {
        searchObj.data.streamResults = res;

        if (res.list.length > 0) {
          if (config.isCloud == "true") {
            getQueryTransform();
          }

          //extract stream data from response
          loadStreamLists();
        } else {
          searchObj.loading = false;
          searchObj.data.errorMsg = "";
          searchObj.data.stream.streamLists = [];
          searchObj.data.stream.selectedStream = { label: "", value: "" };
          searchObj.data.stream.selectedStreamFields = [];
          searchObj.data.queryResults = {};
          searchObj.data.sortedQueryResults = [];
          searchObj.data.histogram = {
            layout: {},
            data: [],
          };
        }

        await extractFields();

        if (
          searchObj.data.editorValue &&
          searchObj.data.stream.selectedStreamFields.length
        )
          nextTick(() => {
            restoreFilters(searchObj.data.editorValue);
          });
      })
      .catch((e) => {
        searchObj.loadingStream = false;
        $q.notify({
          type: "negative",
          message:
            "Error while pulling index for selected organization" + e.message,
          timeout: 2000,
        });
      })
      .finally(() => {
        searchObj.loadingStream = false;
      });
  } catch (e) {
    searchObj.loadingStream = false;
    console.error("Error while getting streams", e);
    showErrorNotification("Error while getting streams");
  }
}

function loadStreamLists() {
  try {
    const queryParams = router.currentRoute.value.query;
    searchObj.data.stream.streamLists = [];
    if (searchObj.data.streamResults.list.length > 0) {
      let lastUpdatedStreamTime = 0;
      let selectedStreamItemObj = {};
      searchObj.data.streamResults.list.map((item: any) => {
        let itemObj = {
          label: item.name,
          value: item.name,
        };
        searchObj.data.stream.streamLists.push(itemObj);

        if (queryParams.stream === item.name) {
          selectedStreamItemObj = itemObj;
        } else if (
          !queryParams.stream &&
          item.stats.doc_time_max >= lastUpdatedStreamTime
        ) {
          lastUpdatedStreamTime = item.stats.doc_time_max;
          selectedStreamItemObj = itemObj;
        }
      });

      if (selectedStreamItemObj.label != undefined) {
        searchObj.data.stream.selectedStream = selectedStreamItemObj;
      } else {
        searchObj.data.stream.selectedStream = {};
        searchObj.loading = false;
        searchObj.data.queryResults = {};
        searchObj.data.sortedQueryResults = [];
        searchObj.data.stream.selectedStreamFields = [];
        searchObj.data.histogram = {
          layout: {},
          data: [],
        };
      }
    } else {
      searchObj.loading = false;
    }
  } catch (e) {
    searchObj.loading = false;
    showErrorNotification("Error while loading streams");
  }
}

function getConsumableDateTime() {
  try {
    if (searchObj.data.datetime.tab == "relative") {
      let period = "";
      let periodValue = 0;
      // quasar does not support arithmetic on weeks. convert to days.

      if (
        searchObj.data.datetime.relative.period.label.toLowerCase() == "weeks"
      ) {
        period = "days";
        periodValue = searchObj.data.datetime.relative.value * 7;
      } else {
        period = searchObj.data.datetime.relative.period.label.toLowerCase();
        periodValue = searchObj.data.datetime.relative.value;
      }
      const subtractObject = '{"' + period + '":' + periodValue + "}";

      let endTimeStamp = new Date();
      if (searchObj.data.resultGrid.currentPage > 0) {
        endTimeStamp = searchObj.data.resultGrid.currentDateTime;
      } else {
        searchObj.data.resultGrid.currentDateTime = endTimeStamp;
      }

      const startTimeStamp = date.subtractFromDate(
        endTimeStamp,
        JSON.parse(subtractObject),
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
            searchObj.data.datetime.absolute.startTime,
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
            searchObj.data.datetime.absolute.endTime,
        );
      }
      const rVal = {
        start_time: start,
        end_time: end,
      };
      return rVal;
    }
  } catch (e) {
    searchObj.loading = false;
    console.error("Error while getting consumable date time");
  }
}

const getDefaultRequest = () => {
  return {
    query: {
      sql: `select min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp, min(start_time/1000) as trace_start_time, max(end_time/1000) as trace_end_time, min(service_name) as service_name, min(operation_name) as operation_name, count(trace_id) as spans, SUM(CASE WHEN span_status='ERROR' THEN 1 ELSE 0 END) as errors, max(duration) as duration, trace_id [QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE] group by trace_id order by zo_sql_timestamp DESC`,
      start_time: (new Date().getTime() - 900000) * 1000,
      end_time: new Date().getTime() * 1000,
      from: 0,
      size: 0,
    },
    encoding: "base64",
  };
};

function buildSearch() {
  try {
    let query = searchObj.data.editorValue.trim();
    var req = getDefaultRequest();
    req.query.from =
      searchObj.data.resultGrid.currentPage *
      searchObj.meta.resultGrid.rowsPerPage;
    req.query.size = parseInt(searchObj.meta.resultGrid.rowsPerPage, 10);

    let timestamps: any =
      searchObj.data.datetime.type === "relative"
        ? getConsumableRelativeTime(searchObj.data.datetime.relativeTimePeriod)
        : cloneDeep(searchObj.data.datetime);

    req.query.start_time = timestamps.startTime;
    req.query.end_time = timestamps.endTime;

    let parseQuery = query.split("|");
    let queryFunctions = "";
    let whereClause = "";

    if (parseQuery.length > 1) {
      queryFunctions = "," + parseQuery[0].trim();
      whereClause = parseQuery[1].trim();
    } else {
      whereClause = parseQuery[0].trim();
    }

    if (whereClause.trim() != "") {
      whereClause = whereClause
        .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
        .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
        .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

      whereClause = whereClause
        .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
        .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

      req.query.sql = req.query.sql.replace(
        "[WHERE_CLAUSE]",
        " WHERE " + whereClause,
      );
    } else {
      req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", "");
    }

    req.query.sql = req.query.sql.replace("[QUERY_FUNCTIONS]", queryFunctions);

    req.query.sql = req.query.sql.replace(
      "[INDEX_NAME]",
      searchObj.data.stream.selectedStream.value,
    );

    req.query.sql = b64EncodeUnicode(req.query.sql);

    const queryParams = getUrlQueryParams();

    router.push({ query: queryParams });
    return req;
  } catch (e) {
    console.error("Error while constructing the search query", e);
    searchObj.loading = false;
    showErrorNotification(
      "An error occurred while constructing the search query.",
    );
  }
}

const showTraceDetailsError = () => {
  showErrorNotification(
    `Trace ${router.currentRoute.value.query.trace_id} not found`,
  );
  const query = cloneDeep(router.currentRoute.value.query);
  delete query.trace_id;
  router.push({
    name: "traces",
    query: {
      ...query,
    },
  });
  return;
};

const buildTraceSearchQuery = (trace: string) => {
  const req = getDefaultRequest();
  req.query.from = 0;
  req.query.size = 1000;
  req.query.start_time = trace.trace_start_time - 30000000;
  req.query.end_time = trace.trace_end_time + 30000000;

  req.query.sql = b64EncodeUnicode(
    `SELECT * FROM ${selectedStreamName.value} WHERE trace_id = '${trace.trace_id}' ORDER BY start_time`,
  );

  return req;
};

const updateFieldValues = (data) => {
  const excludedFields = [store.state.zoConfig.timestamp_column];
  data.forEach((item) => {
    // Create set for each field values and add values to corresponding set
    Object.keys(item).forEach((key) => {
      if (excludedFields.includes(key)) {
        return;
      }

      if (fieldValues.value[key] == undefined) {
        fieldValues.value[key] = new Set();
      }

      if (!fieldValues.value[key].has(item[key])) {
        fieldValues.value[key].add(item[key]);
      }
    });
  });
};

async function getQueryData() {
  try {
    if (searchObj.data.stream.selectedStream.value == "") {
      return false;
    }
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";

    searchObj.searchApplied = true;

    if (searchObj.data.resultGrid.currentPage == 0) {
      searchObj.loading = true;
      // searchObj.data.stream.selectedFields = [];
      // searchObj.data.stream.addToFilter = "";
      searchObj.data.queryResults = {};
      // searchObj.data.resultGrid.columns = [];
      searchObj.data.sortedQueryResults = [];
      // searchObj.data.streamResults = [];
      searchObj.data.histogram = {
        layout: {},
        data: [],
      };
      // searchObj.data.editorValue = "";
    }
    // dismiss = Notify();
    let queryReq;

    if (!searchObj.data.resultGrid.currentPage) {
      queryReq = buildSearch();
      searchObj.data.queryPayload = queryReq;
    } else {
      queryReq = searchObj.data.queryPayload;
    }

    if (queryReq == null) {
      // dismiss();
      return false;
    }

    searchObj.data.errorCode = 0;
    queryReq.query.from =
      searchObj.data.resultGrid.currentPage *
      searchObj.meta.resultGrid.rowsPerPage;

    let dismiss = null;
    if (searchObj.data.resultGrid.currentPage) {
      dismiss = $q.notify({
        type: "positive",
        message: t("traces.fetchingMoreTraces"),
        actions: [
          {
            icon: "cancel",
            color: "white",
            handler: () => {
              /* ... */
            },
          },
        ],
      });
    }

    let filter = searchObj.data.editorValue.trim();

    // Add RED metrics filters to the query
    const metricsFilters: string[] = [];
    searchObj.meta.metricsRangeFilters.forEach((rangeFilter) => {
      if (rangeFilter.panelTitle === "Duration") {
        if (rangeFilter.start !== null && rangeFilter.end !== null) {
          metricsFilters.push(
            `duration >= ${rangeFilter.start} and duration <= ${rangeFilter.end}`,
          );
        } else {
          metricsFilters.push(
            `duration ${rangeFilter.start ? ">=" : "<="} ${rangeFilter.start || rangeFilter.end}`,
          );
        }
      }
      // Note: Rate and Error filters are not applicable to individual trace queries
      // They are aggregation metrics, not span-level filters
    });

    // Add Error Only filter
    if (searchObj.meta.showErrorOnly) {
      metricsFilters.push("span_status = 'ERROR'");
    }

    // Combine editor filter with metrics filters
    const allFilters = [filter, ...metricsFilters].filter(
      (f) => f.trim().length > 0,
    );
    const combinedFilter = allFilters.join(" AND ");

    if (queryReq.query.from === 0) searchResultRef.value.getDashboardData();

    searchService
      .get_traces({
        org_identifier: searchObj.organizationIdentifier,
        start_time: queryReq.query.start_time,
        end_time: queryReq.query.end_time,
        filter: combinedFilter || "",
        size: queryReq.query.size,
        from: queryReq.query.from,
        stream_name: selectedStreamName.value,
      })
      .then(async (res) => {
        searchObj.loading = false;

        if (
          filter &&
          filter.includes("trace_id") &&
          res.data.hits.length === 1 &&
          res.data.hits[0].start_time &&
          res.data.hits[0].end_time
        ) {
          const startTime = Math.floor(res.data.hits[0].start_time / 1000);
          const endTime = Math.ceil(res.data.hits[0].end_time / 1000);
          // If the trace is not in the current time range, update the time range
          if (
            !(
              startTime >= queryReq.query.start_time &&
              endTime <= queryReq.query.end_time
            )
          ) {
            updateNewDateTime(startTime, endTime);
          }
        }

        const formattedHits = getTracesMetaData(res.data.hits);
        if (res.data.from > 0) {
          searchObj.data.queryResults.from = res.data.from;
          searchObj.data.queryResults.hits.push(...formattedHits);
        } else {
          searchObj.data.queryResults = {
            ...res.data,
            hits: formattedHits,
          };
        }

        updateFieldValues(res.data.hits);

        //update grid columns
        updateGridColumns();
      })
      .catch((err) => {
        searchObj.loading = false;
        // dismiss();
        if (err.response != undefined) {
          if (err.response.data.error) {
            searchObj.data.errorMsg = err.response.data.error;
          } else if (err.response.data.message) {
            searchObj.data.errorMsg = err.response.data.message;
          }
        } else if (err.message) {
          searchObj.data.errorMsg = err.message;
        }

        if (err.response?.data?.code) {
          const customMessage = logsErrorMessage(err.response.data.code);
          searchObj.data.errorCode = err.response.data.code;
          if (customMessage != "") {
            searchObj.data.errorMsg = t(customMessage);
          }
        }

        if (err.response?.data?.code && err.response?.data?.message) {
          searchObj.data.errorMsg = err.response.data.message;
          searchObj.data.errorCode = err.response.data.code;
        }

        if (err.response?.data?.code && err.response?.data?.error_detail) {
          searchObj.data.errorDetail = err.response.data.error_detail;
          searchObj.data.errorCode = err.response.data.code;
        }

        // $q.notify({
        //   message: searchObj.data.errorMsg,
        //   color: "negative",
        // });
      })
      .finally(() => {
        if (dismiss) dismiss();
      });
  } catch (e) {
    console.error("Error while fetching traces", e?.message);
    searchObj.loading = false;
    showErrorNotification("Search request failed");
  }
}

/**
 *
 * @param startTime - start time in microseconds
 * @param endTime - end time in microseconds
 */
const updateNewDateTime = (startTime: number, endTime: number) => {
  searchBarRef.value?.updateNewDateTime({
    startTime: startTime,
    endTime: endTime,
  });
  $q.notify({
    type: "positive",
    message: t("traces.timeRangeUpdated"),
    timeout: 5000,
  });
};

const getTracesMetaData = (traces) => {
  if (!traces.length) return [];

  return traces.map((trace) => {
    const _trace = {
      trace_id: trace.trace_id,
      trace_start_time: Math.round(trace.start_time / 1000),
      trace_end_time: Math.round(trace.end_time / 1000),
      service_name: trace.first_event.service_name,
      operation_name: trace.first_event.operation_name,
      spans: trace.spans[0],
      errors: trace.spans[1],
      duration: trace.duration,
      services: {},
      zo_sql_timestamp: new Date(trace.start_time / 1000).getTime(),
    };
    trace.service_name.forEach((service) => {
      if (!searchObj.meta.serviceColors[service.service_name]) {
        if (serviceColorIndex.value >= colors.value.length) generateNewColor();

        searchObj.meta.serviceColors[service.service_name] =
          colors.value[serviceColorIndex.value];

        serviceColorIndex.value++;
      }
      _trace.services[service.service_name] = service.count;
    });
    return _trace;
  });
};

function generateNewColor() {
  // Generate a color in HSL format
  const hue = colors.value.length * (360 / 50);
  const lightness = 50 + (colors.value.length % 2) * 15;
  colors.value.push(`hsl(${hue}, 100%, ${lightness}%)`);
  return colors;
}

async function extractFields() {
  try {
    searchObj.data.stream.selectedStreamFields = [];
    if (searchObj.data.streamResults.list.length > 0) {
      const schema = [];
      const ignoreFields = [store.state.zoConfig.timestamp_column];
      let ftsKeys;

      const stream = await getStream(
        searchObj.data.stream.selectedStream.value,
        "traces",
        true,
      );
      searchObj.data.datetime.queryRangeRestrictionInHour = -1;
      if (
        (stream.settings.max_query_range > 0 ||
          store.state.zoConfig.max_query_range > 0) &&
        (searchObj.data.datetime.queryRangeRestrictionInHour >
          stream.settings.max_query_range ||
          stream.settings.max_query_range == 0 ||
          searchObj.data.datetime.queryRangeRestrictionInHour == -1) &&
        searchObj.data.datetime.queryRangeRestrictionInHour != 0
      ) {
        searchObj.data.datetime.queryRangeRestrictionInHour =
          stream.settings.max_query_range > 0
            ? stream.settings.max_query_range
            : store.state.zoConfig.max_query_range;
        searchObj.data.datetime.queryRangeRestrictionMsg = t(
          "search.queryRangeRestrictionMsg",
          {
            range:
              searchObj.data.datetime.queryRangeRestrictionInHour > 1
                ? searchObj.data.datetime.queryRangeRestrictionInHour + " hours"
                : searchObj.data.datetime.queryRangeRestrictionInHour + " hour",
          },
        );
      }
      schema.push(...stream.schema);
      ftsKeys = new Set([...stream.settings.full_text_search_keys]);

      const idFields = {
        trace_id: 1,
        span_id: 1,
        reference_parent_span_id: 1,
        reference_parent_trace_id: 1,
        start_time: 1,
        end_time: 1,
      };

      const importantFields = {
        duration: 1,
        service_name: 1,
        operation_name: 1,
        span_status: 1,
        trace_id: 1,
        span_id: 1,
        reference_parent_span_id: 1,
        reference_parent_trace_id: 1,
        start_time: 1,
      };

      // Ignoring timestamp as start time is present
      let fields: any = {};
      Object.keys(importantFields).forEach((rowName) => {
        if (fields[rowName] == undefined) {
          fields[rowName] = {};
          searchObj.data.stream.selectedStreamFields.push({
            name: rowName,
            ftsKey: ftsKeys.has(rowName),
            showValues: !idFields[rowName],
            label: rowName === "duration" ? "duration (µs)" : rowName,
          });
        }
      });

      schema.forEach((row: any) => {
        // let keys = deepKeys(row);
        // for (let i in row) {
        if (!importantFields[row.name] && !ignoreFields.includes(row.name)) {
          if (fields[row.name] == undefined) {
            fields[row.name] = {};
            searchObj.data.stream.selectedStreamFields.push({
              name: row.name,
              ftsKey: ftsKeys.has(row.name),
              showValues: !idFields[row.name],
            });
          }
        }
      });
    }
  } catch (e) {
    searchObj.loading = false;
    console.error("Error while extracting fields", e);
  }
}

function updateGridColumns() {
  try {
    searchObj.data.resultGrid.columns = [];

    searchObj.data.stream.selectedFields = [];

    searchObj.meta.resultGrid.manualRemoveFields = false;

    searchObj.data.resultGrid.columns.push({
      name: "@timestamp",
      accessorfn: (row: any) =>
        timestampToTimezoneDate(
          row["trace_start_time"],
          store.state.timezone,
          "yyyy-MM-dd HH:mm:ss.SSS",
        ),
      prop: (row: any) =>
        timestampToTimezoneDate(
          row["trace_start_time"],
          store.state.timezone,
          "yyyy-MM-dd HH:mm:ss.SSS",
        ),
      label: "Start Time",
      align: "left",
      sortable: true,
    });

    searchObj.data.resultGrid.columns.push({
      name: "operation_name",
      field: (row: any) => row.operation_name,
      prop: (row: any) => row.operation_name,
      label: "Operation",
      align: "left",
      sortable: true,
    });

    searchObj.data.resultGrid.columns.push({
      name: "service_name",
      field: (row: any) => row.service_name,
      prop: (row: any) => row.service_name,
      label: "Service",
      align: "left",
      sortable: true,
    });

    searchObj.data.resultGrid.columns.push({
      name: "duration",
      field: (row: any) => row.duration,
      prop: (row: any) => row.duration,
      label: "Duration",
      align: "left",
      sortable: true,
      format: (val) => formatTimeWithSuffix(val),
    });

    searchObj.loading = false;
  } catch (e) {
    searchObj.loading = false;
    console.error("Error while updating grid columns");
  }
}

function generateHistogramData() {
  const unparsed_x_data: any[] = [];
  const xData: string[] = [];
  const yData: number[] = [];

  var trace1 = {
    x: xData,
    y: yData,
    name: "Trace",
    type: "scatter",
    mode: "markers",
    hovertemplate: "%{x} <br> %{y}", // hovertemplate for custom tooltip
  };

  var data = [trace1];

  var layout = {
    title: {
      text: "",
      font: {
        size: 12,
        color: store.state.theme === "dark" ? "#fff" : "#181a1b",
      },
    },
    margin: {
      l: 50,
      r: 50,
      t: 22,
      b: 50,
    },
    font: {
      size: 12,
      color: store.state.theme === "dark" ? "#fff" : "#181a1b",
    },
    xaxis: { type: "date" },
    yaxis: { ticksuffix: "ms" },
    scattergap: 0.7,
    height: 150,
    paper_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    plot_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    autosize: true,
  };

  if (searchObj.data?.queryResults?.hits?.length) {
    searchObj.data.queryResults.hits.forEach(
      (bucket: {
        zo_sql_timestamp: string | number | Date;
        duration: number | Date;
      }) => {
        unparsed_x_data.push(bucket.zo_sql_timestamp);
        let histDate = new Date(Math.floor(bucket.zo_sql_timestamp / 1000));
        xData.push(Math.floor(histDate.getTime()));
        yData.push(Number((bucket.duration / 1000).toFixed(2)));
      },
    );
  }

  searchObj.data.histogram = {
    data: data,
    layout: layout,
  };

  // if (searchResultRef.value?.reDrawChart) {
  //   searchResultRef.value.reDrawChart();
  // }
}

async function loadPageData() {
  searchObj.loadingStream = true;
  if (!searchObj.data?.queryResults?.hits?.length)
    searchObj.data.resultGrid.currentPage = 0;

  // resetSearchObj();
  searchObj.organizationIdentifier =
    store.state.selectedOrganization.identifier;

  searchObj.data.errorMsg = "";

  //get stream list
  await getStreamList();
}

function refreshStreamData() {
  // searchObj.loading = true;
  // this.searchObj.data.resultGrid.currentPage = 0;
  // resetSearchObj();
  // searchObj.organizationIdentifier =
  //   store.state.selectedOrganization.identifier;
  // //get stream list
  // getStreamList();
}

onBeforeMount(async () => {
  restoreUrlQueryParams();
  // Restore active tab from URL query params
  const queryParams = router.currentRoute.value.query;
  if (queryParams.tab === 'service-maps') {
    // Only allow service-maps tab if service graph is enabled
    if (store.state.zoConfig.service_graph_enabled) {
      activeTab.value = 'service-maps';
    } else {
      // If service graph is disabled, default to search tab
      activeTab.value = 'search';
    }
  }
  await importSqlParser();
  if (searchObj.loading == false) {
    await loadPageData();
  }
});

onDeactivated(() => {
  clearInterval(refreshIntervalID);
});

onActivated(() => {
  const params = router.currentRoute.value.query;
  if (params.reload === "true") {
    restoreUrlQueryParams();
    loadPageData();
  }
  if (
    searchObj.organizationIdentifier !=
    store.state.selectedOrganization.identifier
  ) {
    restoreUrlQueryParams();
    loadPageData();
  }

  if (router.currentRoute.value.path.indexOf("/traces") > -1) {
    setTimeout(() => {
      // if (searchResultRef.value) searchResultRef.value?.reDrawChart();
    }, 300);
  }
});

const runQueryFn = () => {
  searchObj.data.resultGrid.currentPage = 0;
  searchObj.runQuery = false;
  getQueryData();
};

function restoreUrlQueryParams() {
  const queryParams = router.currentRoute.value.query;

  const date = {
    startTime: queryParams.from,
    endTime: queryParams.to,
    relativeTimePeriod: queryParams.period || null,
    type: queryParams.period ? "relative" : "absolute",
  };

  if (date && ((date.startTime && date.endTime) || date.relativeTimePeriod)) {
    searchObj.data.datetime = date;
  }

  if (queryParams.query) {
    searchObj.data.editorValue = b64DecodeUnicode(queryParams.query);
  }

  if (
    queryParams.stream &&
    searchObj.data.stream.selectedStream.value !== queryParams.stream
  ) {
    searchObj.data.stream.selectedStream = {
      label: queryParams.stream,
      value: queryParams.stream,
    };
  }
}

const onSplitterUpdate = () => {
  window.dispatchEvent(new Event("resize"));
};

const refreshTimezone = () => {
  updateGridColumns();
  generateHistogramData();

  // searchResultRef.value?.reDrawChart();
};

const restoreFiltersFromQuery = (node: any) => {
  if (!node) return;
  if (node.type === "binary_expr") {
    if (node.left.column) {
      let values = [];
      if (node.operator === "IN") {
        values = node.right.value.map(
          (_value: { value: string }) => _value.value,
        );
      }
      searchObj.data.stream.fieldValues[node.left.column].selectedValues =
        values;
    }
  }

  // Recurse through AND/OR expressions
  if (
    node.type === "binary_expr" &&
    (node.operator === "AND" || node.operator === "OR")
  ) {
    restoreFiltersFromQuery(node.left);
    restoreFiltersFromQuery(node.right);
  }
};

const restoreFilters = (query: string) => {
  // const filters = searchObj.data.stream.filters;

  const defaultQuery = `SELECT * FROM '${selectedStreamName.value}' WHERE `;

  const parsedQuery = parser.astify(defaultQuery + query);

  restoreFiltersFromQuery(parsedQuery.where);
};

const setHistogramDate = async (date: any) => {
  searchBarRef.value.dateTimeRef.setCustomDate("absolute", date);
};

const isStreamSelected = computed(() => {
  return searchObj.data.stream.selectedStream.value.trim().length > 0;
});

const searchData = () => {
  if (
    !(
      searchObj.data.stream.streamLists.length &&
      searchObj.data.stream.selectedStream?.label
    )
  ) {
    return;
  }

  runQueryFn();

  if (config.isCloud == "true") {
    segment.track("Button Click", {
      button: "Search Data",
      user_org: store.state.selectedOrganization.identifier,
      user_id: store.state.userInfo.email,
      stream_name: searchObj.data.stream.selectedStream.value,
      show_query: searchObj.meta.showQuery,
      show_histogram: searchObj.meta.showHistogram,
      sqlMode: searchObj.meta.sqlMode,
      showFields: searchObj.meta.showFields,
      page: "Search Logs",
    });
  }
};

const getMoreData = () => {
  if (searchObj.meta.refreshInterval == 0) {
    getQueryData();

    if (config.isCloud == "true") {
      segment.track("Button Click", {
        button: "Get More Data",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        stream_name: searchObj.data.stream.selectedStream.value,
        page: "Search Logs",
      });
    }
  }
};

const onChangeStream = () => {
  runQueryFn();
  extractFields();
};

const collapseFieldList = () => {
  if (searchObj.meta.showFields) searchObj.meta.showFields = false;
  else searchObj.meta.showFields = true;
};

const showFields = computed(() => {
  return searchObj.meta.showFields;
});
const showHistogram = computed(() => {
  return searchObj.meta.showHistogram;
});
const showQuery = computed(() => {
  return searchObj.meta.showQuery;
});
const moveSplitter = computed(() => {
  return searchObj.config.splitterModel;
});
const changeStream = computed(() => {
  return searchObj.data.stream.selectedStream;
});
const changeRelativeDate = computed(() => {
  return (
    searchObj.data.datetime.relative.value +
    searchObj.data.datetime.relative.period.value
  );
});
const updateSelectedColumns = computed(() => {
  return searchObj.data.stream.selectedFields.length;
});
const runQuery = computed(() => {
  return searchObj.runQuery;
});

watch(showFields, () => {
  if (searchObj.meta.showHistogram == true && searchObj.meta.sqlMode == false) {
    // Clear any existing timeout
    if (chartRedrawTimeout.value) {
      clearTimeout(chartRedrawTimeout);
    }
    chartRedrawTimeout.value = setTimeout(() => {
      // if (searchResultRef.value) searchResultRef.value?.reDrawChart();
    }, 100);
  }
  if (searchObj.config.splitterModel > 0) {
    searchObj.config.lastSplitterPosition = searchObj.config.splitterModel;
  }

  searchObj.config.splitterModel = searchObj.meta.showFields
    ? searchObj.config.lastSplitterPosition
    : 0;
});

// watch(showHistogram, () => {
//   if (searchObj.meta.showHistogram) {
//     setTimeout(() => {
//       if (this.searchResultRef) this.searchResultRef.reDrawChart();
//     }, 100);
//   }
// });

watch(moveSplitter, () => {
  if (searchObj.meta.showFields == false) {
    searchObj.meta.showFields = searchObj.config.splitterModel > 0;
  }
});

// watch(
//   changeStream,
//   (stream, oldStream) => {
//     if (stream.value === oldStream.value) return;
//     if (searchObj.data.stream.selectedStream.hasOwnProperty("value")) {
//       if (oldStream.value) {
//         searchObj.data.query = "";
//         searchObj.data.advanceFiltersQuery = "";
//       }
//       setTimeout(() => {
//         runQueryFn();
//         extractFields();
//       }, 500);
//     }
//   },
//   {
//     immediate: false,
//   },
// );

watch(updateSelectedColumns, () => {
  searchObj.meta.resultGrid.manualRemoveFields = true;
  setTimeout(() => {
    updateGridColumns();
  }, 300);
});

// Watch for active tab changes and update URL
watch(activeTab, (newTab) => {
  const query = { ...router.currentRoute.value.query };
  if (newTab === 'service-maps') {
    // Only set service-maps tab if service graph is enabled
    if (store.state.zoConfig.service_graph_enabled) {
      query.tab = 'service-maps';
    } else {
      // If service graph is disabled, force back to search tab
      activeTab.value = 'search';
      delete query.tab;
    }
  } else {
    delete query.tab;
  }
  router.replace({ query });
});
</script>

<style lang="scss" scoped>
.traces-search-result-container {
  height: calc(100vh - 144px) !important;
}
</style>
<style lang="scss">
.tracePage {
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
  #tracesSearchGridComponent:hover::-webkit-scrollbar {
    height: 13px;
    width: 13px;
  }

  .index-table ::-webkit-scrollbar-track,
  #tracesSearchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #tracesSearchGridComponent::-webkit-scrollbar-thumb {
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
}
</style>
