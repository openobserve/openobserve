<!-- Copyright 2026 OpenObserve Inc.

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
  <q-page class="tracePage" id="tracePage" style="min-height: auto">
    <div id="tracesSecondLevel">
      <div
        class="tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs"
        :class="
          activeTab === 'service-graph' ? 'tw:min-h-[45px]' : 'tw:min-h-[82px]'
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
          @error-only-toggled="onErrorOnlyToggled"
          @filters-reset="onFiltersReset"
          @cancel-query="cancelSearch"
          @update:searchMode="onSearchModeChange"
        />
      </div>

      <!-- Service Graph Tab Content -->
      <div
        v-if="activeTab === 'service-graph' && config.isEnterprise == 'true'"
        class="tw:px-[0.625rem] tw:pb-[0.625rem] tw:h-[calc(100vh-90px)] tw:overflow-hidden"
      >
        <service-graph
          class="tw:h-full"
          @view-traces="handleServiceGraphViewTraces"
        />
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
                :active-include-field-values="activeIncludeFilterValues"
                :active-exclude-field-values="activeExcludeFilterValues"
                data-test="traces-search-index-list"
                class="card-container"
                :key="searchObj.data.stream.streamLists"
                @update:changeStream="onChangeStream"
                @update:selectedFields="updateFieldVisibility"
              />
            </div>
          </template>
          <template #separator>
            <q-btn
              data-test="logs-search-field-list-collapse-btn"
              :icon="
                searchObj.meta.showFields ? 'chevron_left' : 'chevron_right'
              "
              :title="
                searchObj.meta.showFields
                  ? t('traces.collapseFields')
                  : t('traces.openFields')
              "
              :class="
                searchObj.meta.showFields
                  ? 'splitter-icon-collapse'
                  : 'splitter-icon-expand'
              "
              color="primary"
              size="sm"
              dense
              round
              @click="collapseFieldList"
            />
          </template>
          <template #after>
            <div class="tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
              <div
                v-if="
                  searchObj.data.errorMsg !== '' &&
                  parseInt(searchObj.data.errorCode) !== 0 &&
                  searchObj.loading == false
                "
                class="card-container tw:h-full"
              >
                <div class="text-center tw:pt-[2rem]">
                  <!-- Actual error case -->
                  <div
                    data-test="traces-search-error-message"
                    class="tw:text-[1.3rem] q-pt-lg"
                  >
                    {{ t("traces.errorRetrievingTraces") }}
                    <q-btn
                      v-if="
                        searchObj.data.errorDetail || searchObj?.data?.errorMsg
                      "
                      @click="toggleErrorDetails"
                      size="sm"
                      class="o2-secondary-button q-ml-sm"
                      data-test="traces-search-error-details-btn"
                      >{{ t("search.histogramErrorBtnLabel") }}</q-btn
                    >
                  </div>
                  <!-- Collapsible error detail — shown below results when toggled -->
                  <div class="text-center">
                    <div class="tw:my-none tw:text-[1rem]! tw:px-[2rem]!">
                      <span v-if="disableMoreErrorDetails">
                        <SanitizedHtmlRenderer
                          data-test="traces-search-detail-error-message"
                          :htmlContent="searchObj?.data?.errorMsg"
                          class="tw:pt-[1rem]"
                        />
                        <div
                          v-if="searchObj?.data?.errorDetail"
                          class="error-display__message tw:pt-[1rem]! tw:text-[var(--o2-text-2)]!"
                        >
                          {{ searchObj.data.errorDetail }}
                        </div>
                      </span>
                    </div>
                  </div>
                  <!-- FTS not configured -->
                  <div
                    data-test="traces-search-error-20003"
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
                  <q-item-label>{{
                    searchObj.data.additionalErrorMsg
                  }}</q-item-label>
                </div>
              </div>
              <div
                v-else-if="
                  searchObj.data.errorMsg !== '' &&
                  parseInt(searchObj.data.errorCode) == 0 &&
                  !searchObj.loading
                "
                data-test="traces-search-result-not-found-text"
                class="text-center tw:py-[40px] tw:text-[20px] card-container tw:h-full"
              >
                <q-icon name="info" color="primary" size="md" />
                {{ searchObj.data.errorMsg }}
              </div>
              <div
                v-else-if="!isStreamSelected"
                class="card-container tw:h-full"
              >
                <div
                  data-test="logs-search-no-stream-selected-text"
                  class="text-center tw:mx-[10%] tw:py-[40px] tw:mt-0 tw:text-[20px]"
                >
                  <q-icon name="info" color="primary" size="md" />
                  {{ t("search.noStreamSelectedMessage") }}
                </div>
              </div>
              <div
                data-test="traces-search-result-not-found-text"
                v-else-if="
                  isStreamSelected &&
                  !searchObj.searchApplied &&
                  !searchObj.data.queryResults?.hits?.length
                "
                class="text-center tw:py-[40px] tw:text-[20px] card-container tw:h-full"
              >
                <q-icon name="info" color="primary" size="md" />
                {{ t("search.applySearch") }}
              </div>
              <div
                v-else
                data-test="logs-search-search-result"
                class="tw:h-full!"
              >
                <search-result
                  ref="searchResultRef"
                  @update:datetime="setHistogramDate"
                  @update:scroll="getMoreData"
                  @update:sort="runQueryOnSort"
                  @shareLink="copyTracesUrl"
                  @metrics:filters-updated="onMetricsFiltersUpdated"
                />
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
  onUnmounted,
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
import {
  contextRegistry,
  createTracesContextProvider,
} from "@/composables/contextProviders";

import TransformService from "@/services/jstransform";
import {
  b64EncodeUnicode,
  verifyOrganizationStatus,
  b64DecodeUnicode,
  formatTimeWithSuffix,
  timestampToTimezoneDate,
  escapeSingleQuotes,
  getUUID,
  generateTraceContext,
} from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import useNotifications from "@/composables/useNotifications";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
import { computed } from "vue";
import useStreams from "@/composables/useStreams";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useTracesTableColumns } from "./composables/useTracesTableColumns";
import { isLLMTrace } from "@/utils/llmUtils";

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
const {
  searchObj,
  resetSearchObj,
  getUrlQueryParams,
  copyTracesUrl,
  formatTracesMetaData,
  loadLocalLogFilterField,
  updatedLocalLogFilterField,
} = useTraces();
const { fnParsedSQL } = logsUtils();
let refreshIntervalID = 0;
const searchResultRef = ref(null);
const searchBarRef = ref(null);
let parser: any;
const fieldValues = ref({});
const { showErrorNotification } = useNotifications();
const disableMoreErrorDetails = ref(false);
const toggleErrorDetails = () => {
  disableMoreErrorDetails.value = !disableMoreErrorDetails.value;
};
const indexListRef = ref(null);
const { getStreams, getStream } = useStreams();
const chartRedrawTimeout = ref(null);
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
  useHttpStreaming();
// AI copilot context provider for traces page
const setupContextProvider = () => {
  const provider = createTracesContextProvider(searchObj, store);
  contextRegistry.register("traces", provider);
  contextRegistry.setActive("traces");
};

const cleanupContextProvider = () => {
  contextRegistry.unregister("traces");
  contextRegistry.setActive("");
};
const { buildColumns } = useTracesTableColumns();

// Track the current search stream so we can cancel it when a new search starts
let currentSearchTraceId: string | null = null;
// Track the count query stream so it can be cancelled independently
let currentCountTraceId: string | null = null;
// The processed WHERE clause from the last buildSearch() call — used for the count query
let builtWhereClause = "";
/**
 * Tracks per-request streaming partition state.
 * Each backend partition emits a search_response_metadata event; each chunk
 * within that partition emits a search_response_hits event.
 * We decide replace vs append using the same pattern as useSearchResponseHandler.
 */
const tracesPartitionMap: Record<
  string,
  { partition: number; chunks: Record<number, number> }
> = {};

searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;

const selectedStreamName = computed(
  () => searchObj.data.stream.selectedStream.value,
);

const isLLMSpanPresent = ref(false);

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
    const previouslySelectedStream = searchObj.data.stream.selectedStream.value;
    searchObj.data.stream.streamLists = [];
    if (searchObj.data.streamResults.list.length > 0) {
      let lastUpdatedStreamTime = 0;
      let selectedStreamItemObj = {};
      let foundPriorityMatch = false;
      searchObj.data.streamResults.list.map((item: any) => {
        let itemObj = {
          label: item.name,
          value: item.name,
        };
        searchObj.data.stream.streamLists.push(itemObj);

        if (queryParams.stream === item.name) {
          selectedStreamItemObj = itemObj;
          foundPriorityMatch = true;
        } else if (
          !foundPriorityMatch &&
          !queryParams.stream &&
          previouslySelectedStream === item.name
        ) {
          selectedStreamItemObj = itemObj;
          foundPriorityMatch = true;
        } else if (
          !foundPriorityMatch &&
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
      // Convert human-readable duration suffixes (e.g. '1.50ms') to raw µs.
      const durationParseResult = parseDurationWhereClause(
        whereClause,
        parser,
        searchObj.data.stream.selectedStream.value,
      );
      if (typeof durationParseResult === "string") {
        whereClause = durationParseResult;
      }

      whereClause = whereClause
        .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
        .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
        .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

      whereClause = whereClause
        .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
        .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

      builtWhereClause = whereClause;
      req.query.sql = req.query.sql.replace(
        "[WHERE_CLAUSE]",
        " WHERE " + whereClause,
      );
    } else {
      builtWhereClause = "";
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

function fetchTracesCount() {
  const queryReq = searchObj.data.queryPayload;
  if (!queryReq || !selectedStreamName.value) return;

  const streamName = selectedStreamName.value;
  const whereClause = builtWhereClause ? ` WHERE ${builtWhereClause}` : "";
  const isSpansMode = searchObj.meta.searchMode === "spans";

  const countSql = isSpansMode
    ? `select count(*) as span_count, count(*) FILTER (WHERE span_status = 'ERROR') as error_count FROM "${streamName}"${whereClause}`
    : `select approx_distinct(trace_id) as trace_count, (approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR')) as error_count FROM "${streamName}"${whereClause}`;

  if (currentCountTraceId) {
    cancelStreamQueryBasedOnRequestId({
      trace_id: currentCountTraceId,
      org_id: searchObj.organizationIdentifier,
    });
  }
  currentCountTraceId = generateTraceContext().traceId;

  fetchQueryDataWithHttpStream(
    {
      queryReq: {
        query: {
          sql: b64EncodeUnicode(countSql),
          start_time: queryReq.query.start_time,
          end_time: queryReq.query.end_time,
          from: 0,
          size: 1,
        },
        encoding: "base64",
      },
      type: "search",
      pageType: "traces",
      searchType: "ui",
      traceId: currentCountTraceId,
      org_id: searchObj.organizationIdentifier,
    },
    {
      data: (_payload: any, response: any) => {
        const hits: any[] = response.content?.results?.hits || [];
        if (hits.length > 0) {
          const count = isSpansMode
            ? (hits[0]?.span_count ?? 0)
            : (hits[0]?.trace_count ?? 0);
          searchObj.data.queryResults.total = count;
          searchObj.data.queryResults.errorCount = hits[0]?.error_count ?? 0;
          searchObj.meta.resultGrid.showPagination = count > 0;
        }
      },
      error: (_payload: any, _err: any) => {
        console.error("Failed to fetch traces count");
        currentCountTraceId = null;
      },
      complete: (_payload: any) => {
        currentCountTraceId = null;
      },
      reset: (_payload: any) => {},
    },
  );
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

async function getQueryData(
  isPagination: boolean = false,
  isSort: boolean = false,
) {
  try {
    if (searchObj.data.stream.selectedStream.value == "") {
      return false;
    }
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";

    searchObj.searchApplied = true;
    searchObj.loading = true;

    if (!isPagination) {
      searchObj.data.sortedQueryResults = [];
      searchObj.data.histogram = {
        layout: {},
        data: [],
      };
    }

    let queryReq;

    if (!isPagination) {
      queryReq = buildSearch();
      searchObj.data.queryPayload = queryReq;
      // Reset hits for a fresh search
      searchObj.data.queryResults = {
        hits: [],
        total: 0,
        from: 0,
        size: queryReq.query.size,
        took: 0,
      };
      searchObj.meta.resultGrid.showPagination = false;
    } else {
      queryReq = searchObj.data.queryPayload;
    }

    if (queryReq == null) {
      return false;
    }

    searchObj.data.errorCode = 0;
    queryReq.query.from =
      searchObj.data.resultGrid.currentPage *
      searchObj.meta.resultGrid.rowsPerPage;

    queryReq.query.size = searchObj.meta.resultGrid.rowsPerPage;

    // Filters are already in editorValue (set by metrics dashboard brush selections).
    // Mirror buildSearch: split on | so only the WHERE-clause portion (after the pipe)
    // is passed to parseDurationWhereClause, not the query-functions prefix.
    const editorParts = searchObj.data.editorValue.trim().split("|");
    let filter = (
      editorParts.length > 1 ? editorParts[1] : editorParts[0]
    ).trim();
    const filterParseResult = parseDurationWhereClause(
      filter,
      parser,
      searchObj.data.stream.selectedStream.value,
    );
    if (typeof filterParseResult === "string") {
      filter = filterParseResult;
    }

    const combinedFilter = filter;

    if (!isPagination && !isSort) searchResultRef?.value?.getDashboardData();

    // Cancel any in-flight stream before starting a new one
    if (currentSearchTraceId) {
      if (tracesPartitionMap[currentSearchTraceId])
        delete tracesPartitionMap[currentSearchTraceId];

      cancelStreamQueryBasedOnRequestId({
        trace_id: currentSearchTraceId,
        org_id: searchObj.organizationIdentifier,
      });
      currentSearchTraceId = null;
    }

    // Generate a unique ID for this search request
    const searchTraceId = getUUID().replace(/-/g, "");
    currentSearchTraceId = searchTraceId;
    tracesPartitionMap[searchTraceId] = { partition: 0, chunks: {} };

    const isSpansMode = searchObj.meta.searchMode === "spans";
    const spansQueryReq = (() => {
      if (!isSpansMode) return null;
      const sortCol =
        searchObj.meta.resultGrid.sortBy === "duration"
          ? "duration"
          : "start_time";
      const sortOrd = (
        searchObj.meta.resultGrid.sortOrder || "desc"
      ).toUpperCase();
      const whereClause = combinedFilter ? ` WHERE ${combinedFilter}` : "";
      const spansSql = `SELECT * FROM "${selectedStreamName.value}"${whereClause} ORDER BY ${sortCol} ${sortOrd}`;
      return {
        query: {
          sql: b64EncodeUnicode(spansSql),
          from: queryReq.query.from,
          size: queryReq.query.size,
          start_time: queryReq.query.start_time,
          end_time: queryReq.query.end_time,
        },
        encoding: "base64",
      };
    })();

    fetchQueryDataWithHttpStream(
      {
        queryReq: isSpansMode
          ? spansQueryReq
          : {
              stream_name: selectedStreamName.value,
              filter: combinedFilter || "",
              start_time: queryReq.query.start_time,
              end_time: queryReq.query.end_time,
              from: queryReq.query.from,
              size: queryReq.query.size,
              sort_by: searchObj.meta.resultGrid.sortBy || "start_time",
              sort_order: searchObj.meta.resultGrid.sortOrder || "desc",
            },
        type: isSpansMode ? "search" : "traces",
        ...(isSpansMode ? { pageType: "traces", searchType: "ui" } : {}),
        traceId: searchTraceId,
        org_id: searchObj.organizationIdentifier,
      },
      {
        data: (_payload: any, response: any) => {
          // Each metadata event signals a new backend partition — advance the counter
          if (response.type === "search_response_metadata") {
            tracesPartitionMap[searchTraceId].partition++;
          }

          if (
            response.type === "search_response_metadata" ||
            response.type === "search_response_hits"
          ) {
            // Track individual hit chunks within the current partition
            if (response.type === "search_response_hits") {
              const p = tracesPartitionMap[searchTraceId].partition;
              tracesPartitionMap[searchTraceId].chunks[p] =
                (tracesPartitionMap[searchTraceId].chunks[p] ?? 0) + 1;
            }

            const rawHits: any[] = response.content?.results?.hits || [];
            if (rawHits.length === 0) return;

            // // Handle single-trace-id filter: auto-adjust time range on first hit batch
            // if (
            //   filter &&
            //   filter.includes("trace_id") &&
            //   rawHits.length === 1 &&
            //   rawHits[0].start_time &&
            //   rawHits[0].end_time
            // ) {
            //   const startTime = Math.floor(rawHits[0].start_time / 1000);
            //   const endTime = Math.ceil(rawHits[0].end_time / 1000);
            //   if (
            //     !(
            //       startTime >= queryReq.query.start_time &&
            //       endTime <= queryReq.query.end_time
            //     )
            //   ) {
            //     updateNewDateTime(startTime, endTime);
            //   }
            // }

            const partition = tracesPartitionMap[searchTraceId]?.partition ?? 1;
            const chunkCount =
              tracesPartitionMap[searchTraceId]?.chunks[partition] ?? 0;
            const isChunkedHits = chunkCount > 1;
            // appendResult: true when on a later partition or a later chunk within
            // the current partition (mirrors useSearchResponseHandler logic)
            const appendResult = partition > 1 || isChunkedHits;

            const formattedHits =
              searchObj.meta.searchMode === "traces"
                ? formatTracesMetaData(rawHits)
                : rawHits;

            isLLMSpanPresent.value =
              (!appendResult ? false : isLLMSpanPresent.value) ||
              formattedHits.some((hit: any) => isLLMTrace(hit));

            // Replace hits on the first partition of a pagination fetch (clears the
            // previous page) or on the very first data chunk of a fresh search
            if ((isPagination && partition === 1) || !appendResult) {
              searchObj.data.queryResults.hits = formattedHits;
            } else {
              searchObj.data.queryResults.hits.push(...formattedHits);
            }
            searchObj.data.queryResults.from = queryReq.query.from;

            updateFieldValues(rawHits);

            // load the field stored in localstorage and rebuild the columns
            loadLocalLogFilterField(searchObj.meta.searchMode);
            rebuildColumns();
          }
        },
        error: (_payload: any, err: any) => {
          searchObj.loading = false;

          const errData = err?.content || err;
          const { message, trace_id, code, error_detail } = errData ?? {};

          let errorMsg = message || err?.message || "Search request failed";
          if (code) {
            searchObj.data.errorCode = code;
            const customMessage = logsErrorMessage(code);
            if (customMessage) errorMsg = t(customMessage);
          }
          if (trace_id) {
            errorMsg += ` <br><span class='text-subtitle1'>TraceID: ${trace_id}</span>`;
          }
          searchObj.data.errorMsg = errorMsg;
          searchObj.data.errorDetail = error_detail || "";
          currentSearchTraceId = null;
          delete tracesPartitionMap[searchTraceId];
        },
        complete: (_payload: any) => {
          searchObj.loading = false;
          currentSearchTraceId = null;
          delete tracesPartitionMap[searchTraceId];
          if (!isPagination) {
            fetchTracesCount();
          }
        },
        reset: (_payload: any) => {
          searchObj.data.queryResults = {};
          searchObj.data.sortedQueryResults = [];
        },
      },
    );
  } catch (e: any) {
    console.error("Error while fetching traces", e?.message);
    searchObj.loading = false;
    searchObj.data.errorMsg = e?.message || "Search request failed";
    searchObj.data.errorDetail = "";
  }
}

const updateFieldVisibility = async (field: any) => {
  const idx = searchObj.data.stream.selectedFields.indexOf(field.name);
  if (idx === -1) {
    searchObj.data.stream.selectedFields.push(field.name);
  } else {
    searchObj.data.stream.selectedFields.splice(idx, 1);
  }

  updatedLocalLogFilterField(searchObj.meta.searchMode);

  await nextTick();
  rebuildColumns();
};

const rebuildColumns = () => {
  searchObj.data.resultGrid.columns = buildColumns(
    isLLMSpanPresent.value,
    searchObj.meta.searchMode ?? "traces",
    searchObj.data.stream.selectedFields,
  );
};

const cancelSearch = () => {
  // Cancel dashboard panel queries (RenderDashboardCharts via usePanelDataLoader)
  window.dispatchEvent(new Event("cancelQuery"));
  if (!currentSearchTraceId) return;
  cancelStreamQueryBasedOnRequestId({
    trace_id: currentSearchTraceId,
    org_id: searchObj.organizationIdentifier,
  });
  currentSearchTraceId = null;
  searchObj.loading = false;
};

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
        span_status: 1,
        operation_name: 1,
        span_kind: 1,
        trace_id: 1,
        span_id: 1,
        reference_parent_span_id: 1,
        reference_parent_trace_id: 1,
        start_time: 1,
      };

      // Ignoring timestamp as start time is present
      let fields: any = {};
      const schemaTypeMap = new Map(
        schema.map((row: any) => [row.name, row.type]),
      );
      Object.keys(importantFields).forEach((rowName) => {
        if (fields[rowName] == undefined) {
          fields[rowName] = {};
          searchObj.data.stream.selectedStreamFields.push({
            name: rowName,
            ftsKey: ftsKeys.has(rowName),
            showValues: !idFields[rowName],
            label: rowName === "duration" ? "duration (µs)" : rowName,
            dataType: schemaTypeMap.get(rowName),
            isSchemaField: true,
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
              dataType: row.type,
              isSchemaField: true,
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

onBeforeMount(async () => {
  setupContextProvider();
  restoreUrlQueryParams();
  // Restore active tab from URL query params
  const queryParams = router.currentRoute.value.query;
  if (queryParams.tab === "service-graph" && config.isEnterprise == "true") {
    activeTab.value = "service-graph";
  }
  await importSqlParser();
  if (!searchObj.loading) {
    await loadPageData();
  }
});

onDeactivated(() => {
  cleanupContextProvider();
  clearInterval(refreshIntervalID);
});

onUnmounted(() => {
  cleanupContextProvider();
});

onActivated(() => {
  setupContextProvider();
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

const runQueryOnSort = () => {
  searchObj.data.resultGrid.currentPage = 0;
  searchObj.runQuery = false;
  getQueryData(false, true);
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
    queryParams.search_mode === "spans" ||
    queryParams.search_mode === "traces"
  ) {
    searchObj.meta.searchMode = queryParams.search_mode as "traces" | "spans";
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
  // updateGridColumns();
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
      if (
        searchObj.data.stream.fieldValues?.[node?.left?.column]?.selectedValues
      )
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

  const defaultQuery = `SELECT * FROM "${selectedStreamName.value}" WHERE `;

  const parsedQuery = parser.astify(defaultQuery + query);

  restoreFiltersFromQuery(parsedQuery.where);
};

const setHistogramDate = async (date: any) => {
  searchBarRef.value.dateTimeRef.setCustomDate("absolute", date);
};

// Handler for metrics dashboard brush selection filters
// Simply replace the query editor content with metrics filters
// User can manually add their own filters before clicking "Run Query"
const onMetricsFiltersUpdated = (filters: string[]) => {
  const allFilters = [...filters];
  // Add error filter only if toggle is on and not already present from Error panel brush
  if (
    searchObj.meta.showErrorOnly &&
    !allFilters.includes("span_status = 'ERROR'")
  ) {
    allFilters.push("span_status = 'ERROR'");
  }
  // Apply each filter term independently so replace-or-append works per field
  searchBarRef.value?.applyFilters(allFilters);
};

// Handler for Error Only toggle — only adds/removes span_status condition,
// leaving all other filters (field sidebar, duration, etc.) intact.
const onErrorOnlyToggled = (value: boolean) => {
  if (value) {
    searchBarRef.value?.applyFilters(["span_status = 'ERROR'"]);
  } else {
    searchBarRef.value?.removeFilterByField("span_status");
  }
};

// Handler for Search Mode toggle (Traces / Spans)
const onSearchModeChange = (mode: "traces" | "spans") => {
  searchObj.meta.searchMode = mode;
  searchObj.data.resultGrid.currentPage = 0;
  searchObj.data.queryResults = {
    hits: [],
    total: 0,
    from: 0,
    size: searchObj.meta.resultGrid.rowsPerPage,
    took: 0,
    errorCount: 0,
  };
  getQueryData();
};

// Handler for Reset Filters button
// Clears all filters including brush selections
const onFiltersReset = () => {
  // Brush selections already cleared in SearchBar.vue
  // metricsRangeFilters.clear() was called
  // No additional action needed here
};

const isStreamSelected = computed(() => {
  return searchObj.data.stream.selectedStream.value.trim().length > 0;
});

/**
 * Extracts a plain column name from a DataFusion SQL AST column node.
 * The parser can represent column names as either a plain string or a nested
 * object ({ expr: { value: "name" } }), so we handle both shapes.
 */
const extractTracesColName = (col: any): string | null => {
  if (typeof col === "string") return col.replace(/^"|"$/g, "");
  if (col?.expr?.value != null) return String(col.expr.value);
  return null;
};

/**
 * Wraps the traces WHERE clause (stored in editorValue) into a full SQL
 * statement so that fnParsedSQL can parse it.
 *
 * The traces query editor only stores the WHERE portion of the query,
 * optionally pipe-separated (e.g. "| status='200' and duration>100").
 * fnParsedSQL requires a complete SELECT statement, so we synthesise one.
 *
 * Returns an empty string when there is no active WHERE clause.
 */
const buildTracesWhereSQL = (): string => {
  const query = searchObj.data.editorValue?.trim();
  if (!query) return "";
  const parts = query.split("|");
  const whereClause = (parts.length > 1 ? parts[1] : parts[0]).trim();
  if (!whereClause) return "";
  const streamName = searchObj.data.stream.selectedStream?.value || "stream";
  return `SELECT * FROM "${streamName}" WHERE ${whereClause}`;
};

/**
 * Derives which field values are currently *included* in the active query.
 * Returns a map of { fieldName: [value, ...] } by walking the SQL WHERE AST
 * and collecting:
 *   - equality conditions  (field = 'value')
 *   - IS NULL conditions   (field IS NULL  → sentinel key "null")
 *
 * Used to pre-check the corresponding checkboxes (blue) in the field sidebar.
 */
const activeIncludeFilterValues = computed((): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  try {
    const fullSql = buildTracesWhereSQL();
    if (!fullSql) return result;
    const parsed = fnParsedSQL(fullSql);
    if (!parsed?.where) return result;
    const walkNode = (node: any) => {
      if (!node) return;
      const op = node.operator?.toUpperCase();
      if (op === "OR" || op === "AND") {
        walkNode(node.left);
        walkNode(node.right);
      } else if (op === "=") {
        if (node.left?.type === "column_ref") {
          const colName = extractTracesColName(node.left.column);
          if (colName && node.right?.value != null) {
            const val = String(node.right.value);
            if (!result[colName]) result[colName] = [];
            if (!result[colName].includes(val)) result[colName].push(val);
          }
        }
      } else if (op === "IS") {
        // IS NULL — the field values API returns null rows with key "null"
        if (node.left?.type === "column_ref") {
          const colName = extractTracesColName(node.left.column);
          if (colName) {
            if (!result[colName]) result[colName] = [];
            if (!result[colName].includes("null")) result[colName].push("null");
          }
        }
      }
    };
    walkNode(parsed.where);
  } catch {
    // ignore parse errors
  }
  return result;
});

/**
 * Derives which field values are currently *excluded* from the active query.
 * Returns a map of { fieldName: [value, ...] } by walking the SQL WHERE AST
 * and collecting:
 *   - inequality conditions  (field != 'value' / field <> 'value')
 *   - IS NOT NULL conditions (field IS NOT NULL → sentinel key "null")
 *
 * Used to pre-check the corresponding checkboxes (red) in the field sidebar.
 */
const activeExcludeFilterValues = computed((): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  try {
    const fullSql = buildTracesWhereSQL();
    if (!fullSql) return result;
    const parsed = fnParsedSQL(fullSql);
    if (!parsed?.where) return result;
    const walkNode = (node: any) => {
      if (!node) return;
      const op = node.operator?.toUpperCase();
      if (op === "OR" || op === "AND") {
        walkNode(node.left);
        walkNode(node.right);
      } else if (op === "!=" || op === "<>") {
        if (node.left?.type === "column_ref") {
          const colName = extractTracesColName(node.left.column);
          if (colName && node.right?.value != null) {
            const val = String(node.right.value);
            if (!result[colName]) result[colName] = [];
            if (!result[colName].includes(val)) result[colName].push(val);
          }
        }
      } else if (op === "IS NOT") {
        // IS NOT NULL — the field values API returns null rows with key "null"
        if (node.left?.type === "column_ref") {
          const colName = extractTracesColName(node.left.column);
          if (colName) {
            if (!result[colName]) result[colName] = [];
            if (!result[colName].includes("null")) result[colName].push("null");
          }
        }
      }
    };
    walkNode(parsed.where);
  } catch {
    // ignore parse errors
  }
  return result;
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

  // Clear brush selections when running query
  // The filters are now part of the query, so brush selections should be cleared
  searchObj.meta.metricsRangeFilters.clear();

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
    getQueryData(true);

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
// const updateSelectedColumns = computed(() => {
//   return searchObj.data.stream.selectedFields.length;
// });
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

// Handler for service graph view traces event
const handleServiceGraphViewTraces = (data: any) => {
  // Switch to search tab
  activeTab.value = "search";

  // Set the selected stream in dropdown
  if (data.stream) {
    searchObj.data.stream.selectedStream = {
      label: data.stream,
      value: data.stream,
    };
  }

  // Set the filter query (just the WHERE condition, no SELECT or ORDER BY)
  if (data.serviceName) {
    const escapedServiceName = escapeSingleQuotes(data.serviceName);
    const filterQuery = `service_name = '${escapedServiceName}'`;
    searchObj.data.editorValue = filterQuery;
    searchObj.data.query = filterQuery;
    searchObj.meta.sqlMode = false; // Traces doesn't use SQL mode
  }

  // Set the time range
  if (data.timeRange) {
    searchObj.data.datetime = {
      startTime: data.timeRange.startTime,
      endTime: data.timeRange.endTime,
      relativeTimePeriod: null,
      type: "absolute",
    };
  }

  // Run the query
  nextTick(() => {
    runQueryFn();
  });
};

// watch(updateSelectedColumns, () => {
//   searchObj.meta.resultGrid.manualRemoveFields = true;
//   setTimeout(() => {
//     // updateGridColumns();
//   }, 300);
// });

// Watch for active tab changes and update URL
watch(activeTab, (newTab) => {
  const query = { ...router.currentRoute.value.query };
  if (newTab === "service-graph") {
    query.tab = "service-graph";
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
