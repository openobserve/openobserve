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
  <q-page
    class="tracePage tw:h-[calc(100vh-var(--navbar-height))] tw:min-h-[calc(100vh - var(--navbar-height))]! tw:max-h-[calc(100vh - var(--navbar-height))]! tw:overflow-hidden!"
    id="tracePage"
    style="min-height: auto"
  >
    <div id="tracesSecondLevel" class="full-height">
      <q-splitter
        :class="[
          'traces-horizontal-splitter full-height',
          activeTab === 'service-graph' || activeTab === 'services-catalog' || activeTab === 'llm-insights'
            ? 'hide-splitter-separator'
            : '',
        ]"
        v-model="splitterModel"
        :disable="
          activeTab === 'service-graph' || activeTab === 'services-catalog' || activeTab === 'llm-insights'
        "
        horizontal
        :before-class="
          activeTab === 'service-graph' || activeTab === 'services-catalog' || activeTab === 'llm-insights'
            ? 'tw:max-h-[3.54rem]!'
            : ''
        "
        @update:model-value="onSplitterUpdate"
      >
        <template v-slot:before>
          <div
            class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem] q-pt-xs"
          >
            <!-- Search Bar with Tab Toggle - Always visible to show tabs -->
            <search-bar
              data-test="logs-search-bar"
              ref="searchBarRef"
              :fieldValues="fieldValues"
              :isLoading="searchObj.loading"
              :activeTab="activeTab"
              :isLLMSpanPresent="isLLMSpanPresent"
              class="card-container"
              @searchdata="searchData"
              @onChangeTimezone="refreshTimezone"
              @update:activeTab="activeTab = $event"
              @error-only-toggled="onErrorOnlyToggled"
              @filters-reset="onFiltersReset"
              @cancel-query="cancelSearch"
              @update:searchMode="onSearchModeChange"
              @service-graph-refresh="serviceGraphRef?.loadServiceGraph()"
              @services-catalog-refresh="
                servicesCatalogRef?.loadServicesCatalog()
              "
            />
          </div>
        </template>
        <template v-slot:after>
          <!-- Service Graph Tab Content -->
          <div
            v-if="
              activeTab === 'service-graph' && config.isEnterprise == 'true'
            "
            class="tw:px-[0.625rem] tw:pb-[0.625rem] tw:h-full tw:overflow-hidden"
          >
            <service-graph
              ref="serviceGraphRef"
              class="tw:h-full"
              @view-traces="handleServiceGraphViewTraces"
            />
          </div>

          <!-- Services Catalog Tab Content -->
          <div
            v-if="activeTab === 'services-catalog'"
            class="tw:px-[0.625rem] tw:pb-[0.625rem] tw:h-full tw:overflow-hidden"
          >
            <services-catalog
              ref="servicesCatalogRef"
              class="tw:h-full"
              @view-traces="handleServicesCatalogViewTraces"
            />
          </div>

          <!-- LLM Insights Tab Content -->
          <div
            v-if="activeTab === 'llm-insights'"
            class="tw:px-[0.625rem] tw:pb-[0.625rem] tw:h-full tw:overflow-hidden"
          >
            <LLMInsightsDashboard
              ref="llmInsightsRef"
              :streamName="selectedStreamName"
              :startTime="insightsTimeRange.startTime"
              :endTime="insightsTimeRange.endTime"
              class="tw:h-full"
            />
          </div>

          <!-- Search Tab Content -->
          <div
            v-if="activeTab === 'search'"
            id="tracesThirdLevel"
            class="traces-search-result-container relative-position tw:h-full"
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
                    class="card-container tw:h-full"
                    :key="searchObj.data.stream.streamLists"
                    @update:changeStream="onChangeStream"
                    @update:selectedFields="updateFieldVisibility"
                  />
                </div>
              </template>
              <template #separator>
                <OButton
                  data-test="logs-search-field-list-collapse-btn"
                  variant="sidebar-button"
                  size="sidebar-button"
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
                  @click="collapseFieldList"
                  ><template #icon-left>
                    <q-icon
                      :name="
                        searchObj.meta.showFields
                          ? 'chevron_left'
                          : 'chevron_right'
                      "
                    /> </template
                ></OButton>
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
                        <OButton
                          v-if="
                            searchObj.data.errorDetail ||
                            searchObj?.data?.errorMsg
                          "
                          @click="toggleErrorDetails"
                          variant="outline"
                          size="sm-action"
                          data-test="traces-search-error-details-btn"
                          >{{ t("search.histogramErrorBtnLabel") }}</OButton
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
                        <OButton
                          variant="primary"
                          size="sm-action"
                          :to="
                            '/streams?dialog=' +
                            searchObj.data.stream.selectedStream.label
                          "
                          as="RouterLink"
                          >Click here</OButton
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
                    data-test="traces-search-error-text"
                    class="text-center tw:py-[40px] tw:text-[20px] card-container tw:h-full"
                  >
                    <SanitizedHtmlRenderer
                      data-test="traces-search-detail-error-message"
                      :htmlContent="searchObj?.data?.errorMsg"
                      class="tw:pt-[1rem]"
                    />
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
                    data-test="traces-search-not-started-text"
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
                      @run-query="searchData"
                    />
                  </div>
                </div>
              </template>
            </q-splitter>
          </div>
        </template>
      </q-splitter>
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
import { cloneDeep, debounce } from "lodash-es";
import { computed } from "vue";
import useStreams from "@/composables/useStreams";
import { parseDurationWhereClause } from "@/composables/useDurationPercentiles";
import {
  applyFieldGrouping,
  buildSemanticIndex,
  CATEGORY,
  type FieldObj,
} from "@/utils/fieldCategories";
import {
  useServiceCorrelation,
  type KeyFieldsConfig,
  type FieldGroupingConfig,
} from "@/composables/useServiceCorrelation";
import { parseSpanKindWhereClause } from "@/utils/traces/constants";
import { logsUtils } from "@/composables/useLogs/logsUtils";
import { useTracesTableColumns } from "./composables/useTracesTableColumns";
import type { TraceSearchMode } from "@/ts/interfaces/traces/trace.types";
import { isLLMTrace } from "@/utils/llmUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { saveTracesStream, restoreTracesStream } from "@/utils/streamPersist";
import { useCorrelationFilters } from "@/composables/useCorrelationDefaultSlug";

const SearchBar = defineAsyncComponent(() => import("./SearchBar.vue"));
const IndexList = defineAsyncComponent(() => import("./IndexList.vue"));
const SearchResult = defineAsyncComponent(() => import("./SearchResult.vue"));
const SanitizedHtmlRenderer = defineAsyncComponent(
  () => import("@/components/SanitizedHtmlRenderer.vue"),
);
const ServiceGraph = defineAsyncComponent(() => import("./ServiceGraph.vue"));
const ServicesCatalog = defineAsyncComponent(
  () => import("./ServicesCatalog.vue"),
);
const LLMInsightsDashboard = defineAsyncComponent(
  () => import("./LLMInsightsDashboard.vue"),
);

const store = useStore();
const activeTab = computed(() => {
  if (searchObj.meta.searchMode === "service-graph") return "service-graph";
  if (searchObj.meta.searchMode === "services-catalog")
    return "services-catalog";
  if (searchObj.meta.searchMode === "llm-insights") return "llm-insights";
  return "search";
});
const router = useRouter();
const $q = useQuasar();
const { t } = useI18n();
const {
  searchObj,
  resetSearchObj,
  getUrlQueryParams,
  copyTracesUrl,
  formatTracesMetaData,
  setServiceColors,
  loadLocalLogFilterField,
  updatedLocalLogFilterField,
} = useTraces();
const { fnParsedSQL } = logsUtils();

const correlationFilters = useCorrelationFilters({
  orgId: () => store.state.selectedOrganization.identifier,
  streamType: () => "traces",
  streamName: () => searchObj.data.stream.selectedStream.value,
  streamSchemaFields: () => searchObj.data.stream.selectedStreamFields,
  getQuery: () => searchObj.data.editorValue,
  setQuery: (whereClause: string) => {
    searchObj.data.editorValue = whereClause;
  },
  querySource: () => searchObj.data.editorValue,
});
correlationFilters.watchQuery();

let refreshIntervalID = 0;
const searchResultRef = ref(null);
const searchBarRef = ref(null);
const serviceGraphRef = ref<any>(null);
const servicesCatalogRef = ref<any>(null);
const llmInsightsRef = ref<any>(null);
const splitterModel = ref(15);
let parser: any;
const fieldValues = ref({});
const { showErrorNotification } = useNotifications();
const disableMoreErrorDetails = ref(false);
const toggleErrorDetails = () => {
  disableMoreErrorDetails.value = !disableMoreErrorDetails.value;
};
const indexListRef = ref(null);
const { getStreams, getStream } = useStreams();
const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } =
  useServiceCorrelation();
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

const selectedStreamName = computed(
  () => searchObj.data.stream.selectedStream.value,
);

// Snapshot the current datetime as microseconds. Refreshed in-place by
// `searchData` when the LLM Insights tab is active — no nonce, no
// `Date.now()`-as-reactive-dep trick.
const insightsTimeRange = ref({ startTime: 0, endTime: 0 });

function recomputeInsightsTimeRange() {
  const dt = searchObj.data.datetime;
  if (!dt) {
    insightsTimeRange.value = { startTime: 0, endTime: 0 };
    return;
  }
  if (dt.type === "relative") {
    const relativePeriod: any = dt.relativeTimePeriod;
    insightsTimeRange.value = relativePeriod
      ? getConsumableRelativeTime(relativePeriod) || { startTime: 0, endTime: 0 }
      : { startTime: 0, endTime: 0 };
    return;
  }
  insightsTimeRange.value = {
    startTime:
      typeof dt.startTime === "number"
        ? dt.startTime
        : new Date(dt.startTime).getTime() * 1000,
    endTime:
      typeof dt.endTime === "number"
        ? dt.endTime
        : new Date(dt.endTime).getTime() * 1000,
  };
}

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
    return getStreams("traces", false)
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
        const queryBeforeRestore = searchObj.data.editorValue;
        correlationFilters.restore();
        const filterWasRestored =
          !queryBeforeRestore && !!searchObj.data.editorValue;

        if (
          searchObj.data.editorValue &&
          searchObj.data.stream.selectedStreamFields.length
        )
          nextTick(() => {
            restoreFilters(searchObj.data.editorValue);
            if (filterWasRestored) searchData();
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
    const persistedStream =
      store.state.zoConfig?.auto_query_enabled && !queryParams.stream
        ? restoreTracesStream(store.state.selectedOrganization.identifier)
        : "";
    searchObj.data.stream.streamLists = [];
    if (searchObj.data.streamResults.list.length > 0) {
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
          !previouslySelectedStream &&
          persistedStream === item.name
        ) {
          selectedStreamItemObj = itemObj;
          foundPriorityMatch = true;
        }
      });

      if (selectedStreamItemObj.label != undefined) {
        searchObj.data.stream.selectedStream = selectedStreamItemObj;
      } else {
        searchObj.data.stream.selectedStream = {
          label: "",
          value: "",
        };
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

      // Convert span_kind display labels (e.g. 'Server') to numeric OTEL keys (e.g. '2').
      whereClause = parseSpanKindWhereClause(
        whereClause,
        parser,
        searchObj.data.stream.selectedStream.value,
      );

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
  const excludedFields = [
    store.state.zoConfig.timestamp_column,
    "_start_time_ns",
    "_end_time_ns",
  ];
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

    // Convert span_kind display labels (e.g. 'Server') to numeric OTEL keys (e.g. '2').
    filter = parseSpanKindWhereClause(
      filter,
      parser,
      searchObj.data.stream.selectedStream.value,
    );

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
    const sortCol = searchObj.meta.resultGrid.sortBy || "start_time";
    const sortOrd = (
      searchObj.meta.resultGrid.sortOrder || "desc"
    ).toUpperCase();
    const schemaFieldNames = searchObj.data.stream.selectedStreamFields.map(
      (f: any) => f.name,
    );
    const validSortCol = (() => {
      if (schemaFieldNames.length === 0) return sortCol;
      return sortCol === "start_time" || schemaFieldNames.includes(sortCol)
        ? sortCol
        : "start_time";
    })();

    const spansQueryReq = (() => {
      if (!isSpansMode) return null;
      const whereClause = combinedFilter ? ` WHERE ${combinedFilter}` : "";
      const spansSql = `SELECT * FROM "${selectedStreamName.value}"${whereClause} ORDER BY ${validSortCol} ${sortOrd}`;
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

    if (validSortCol !== sortCol) {
      searchObj.meta.resultGrid.sortBy = "start_time";
    }

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

            if (searchObj.meta.searchMode === "spans") {
              setServiceColors(rawHits);
            }

            isLLMSpanPresent.value =
              (!appendResult ? false : isLLMSpanPresent.value) ||
              formattedHits.some((hit: any) => isLLMTrace(hit));

            // Replace hits on the first partition of a pagination fetch (clears the
            // previous page) or on the very first data chunk of a fresh search
            if ((isPagination && partition === 1) || !appendResult) {
              searchObj.data.queryResults.hits = formattedHits;
            } else {
              searchObj.data.queryResults.hits = [
                ...searchObj.data.queryResults.hits,
                ...formattedHits,
              ];
            }
            searchObj.data.queryResults.from = queryReq.query.from;

            updateFieldValues(rawHits);

            // load the field stored in localstorage and rebuild the columns
            if (
              searchObj.meta.searchMode === "spans" ||
              searchObj.meta.searchMode === "traces"
            ) {
              loadLocalLogFilterField(searchObj.meta.searchMode);
              rebuildColumns();
            }
          }
        },
        error: (_payload: any, err: any) => {
          searchObj.loading = false;

          const errData = err?.content || err;
          const { message, trace_id, code, error_detail } = errData ?? {};

          let errorMsg =
            message || err?.message || "Error while processing request";
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
          correlationFilters
            .save()
            .catch((e) => console.error("[correlation:save] error:", e));
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

    if (!searchObj.data.stream?.selectedStream?.value) return;

    if (searchObj.data.streamResults.list.length > 0) {
      const schema = [];
      const ignoreFields = [
        store.state.zoConfig.timestamp_column,
        "_start_time_ns",
        "_end_time_ns",
      ];
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
        fields[rowName] = {};
        searchObj.data.stream.selectedStreamFields.push({
          name: rowName,
          ftsKey: ftsKeys.has(rowName),
          showValues: !idFields[rowName],
          dataType: schemaTypeMap.get(rowName),
          isSchemaField: true,
        });
      });

      schema.forEach((row: any) => {
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

      // Apply field grouping
      try {
        const isEnterprise =
          config.isEnterprise === "true" || config.isCloud === "true";
        const [semanticAliases, keyFieldsConfig, fieldGrouping] =
          await Promise.all([
            isEnterprise ? loadSemanticGroups() : Promise.resolve([]),
            loadKeyFields(),
            loadFieldGrouping(),
          ]);
        const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
          ? (fieldGrouping as FieldGroupingConfig)
          : null;
        const semanticIndex =
          semanticAliases.length > 0
            ? buildSemanticIndex(semanticAliases, grouping)
            : null;
        const keySpec = (keyFieldsConfig as KeyFieldsConfig)["traces"] ?? {
          fields: [],
          groups: [],
        };
        const keyFieldSet = new Set(
          keySpec.fields.map((f: string) => f.toLowerCase()),
        );
        const keyGroupSet = new Set(
          keySpec.groups.map((g: string) => g.toLowerCase()),
        );

        searchObj.data.stream.selectedStreamFields = applyFieldGrouping(
          searchObj.data.stream.selectedStreamFields as FieldObj[],
          semanticIndex,
          keyFieldSet,
          keyGroupSet,
        );
      } catch (groupErr) {
        console.warn(
          "Field grouping failed for traces, using flat list",
          groupErr,
        );
      }
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
  // Always seed the LLM Insights datetime snapshot so the dashboard's
  // first onMounted has a real (non-zero) window to read from props.
  recomputeInsightsTimeRange();
  if (searchObj.data.stream.selectedStream.value) {
    searchData();
  }
}

onBeforeMount(async () => {
  if (
    searchObj.organizationIdentifier &&
    searchObj.organizationIdentifier !==
      store.state.selectedOrganization.identifier
  ) {
    resetSearchObj();
  }
  setupContextProvider();
  restoreUrlQueryParams();
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

onActivated(async () => {
  setupContextProvider();

  const savedAutoRun = localStorage.getItem("oo_toggle_auto_run");
  if (savedAutoRun !== null) {
    searchObj.meta.liveMode = savedAutoRun === "true";
  }

  const params = router.currentRoute.value.query;
  if (params.reload === "true") {
    restoreUrlQueryParams();
    await loadPageData();
  }

  if (
    searchObj.organizationIdentifier !=
    store.state.selectedOrganization.identifier
  ) {
    resetSearchObj();
    restoreUrlQueryParams();
    await loadPageData();
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

  const tab = typeof queryParams.tab === "string" ? queryParams.tab : undefined;
  if (
    tab !== undefined &&
    (
      ["service-graph", "traces", "spans", "llm-insights", "services-catalog"] as const
    ).includes(tab as "service-graph" | "traces" | "spans" | "llm-insights" | "services-catalog")
  ) {
    if (tab === "service-graph" && config.isEnterprise !== "true") return;
    searchObj.meta.searchMode = tab as TraceSearchMode;
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

// Handler for Search Mode toggle (Service Graph / Traces / Spans / Services Catalog)
const onSearchModeChange = (
  mode: "traces" | "spans" | "llm-insights" | "service-graph" | "services-catalog",
) => {
  searchObj.meta.searchMode = mode;
  // Refresh the datetime snapshot on every tab-enter so the dashboard's
  // first onMounted has the up-to-date window for relative ranges.
  if (mode === "llm-insights") {
    recomputeInsightsTimeRange();
    return;
  }
  if (mode === "service-graph" || mode === "services-catalog") return;
  if (
    mode === "traces" &&
    searchObj.meta.resultGrid.sortBy !== "start_time" &&
    searchObj.meta.resultGrid.sortBy !== "duration"
  ) {
    searchObj.meta.resultGrid.sortBy = "start_time";
  }
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
  return searchObj.data.stream?.selectedStream?.value?.trim()?.length > 0;
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
  // LLM Insights uses its own stream selector + cache. We refresh the
  // dashboard by recomputing the datetime snapshot then calling its
  // exposed refresh() method directly — no nonce, no watcher chain.
  // The auto-trigger path is already gated by the user's "Auto-run on
  // change" / live-mode toggle in SearchBar, so the toggle controls
  // whether time changes propagate here (matching the behaviour of every
  // other Traces sub-tab).
  if (activeTab.value === "llm-insights") {
    recomputeInsightsTimeRange();
    // Pass the freshly computed start/end directly — Vue propagates the
    // `insightsTimeRange` ref update to the dashboard's `props.startTime`
    // only on the next tick, so the child reading `props` here would
    // fetch with the *previous* window.
    llmInsightsRef.value?.refresh?.(
      insightsTimeRange.value.startTime,
      insightsTimeRange.value.endTime,
    );
    return;
  }

  if (
    !(
      searchObj.data.stream.streamLists.length &&
      searchObj.data.stream.selectedStream?.label
    )
  ) {
    return;
  }

  if (
    activeTab.value === "service-graph" ||
    activeTab.value === "services-catalog"
  )
    return;

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

const onChangeStream = async () => {
  await extractFields();
  runQueryFn();
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

watch(
  () => searchObj.data.stream.selectedStream.value,
  (streamValue: string) => {
    if (store.state.zoConfig?.auto_query_enabled && streamValue) {
      saveTracesStream(
        store.state.selectedOrganization.identifier,
        streamValue,
      );
    }
  },
);

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

// Live mode: when auto_query_enabled is true in zoConfig, always sync from
// localStorage so the module-level singleton reflects the user's preference
// even after navigating between pages. Defaults to true when no preference
// has been saved yet. zoConfig may not be populated yet at mount time;
// watch for it to arrive.
watch(
  () => store.state.zoConfig?.auto_query_enabled,
  (enabled) => {
    if (enabled) {
      const saved = localStorage.getItem("oo_toggle_auto_run");
      searchObj.meta.liveMode = saved === null ? true : saved === "true";
    }
  },
  { immediate: true },
);

// Debounced auto-run on query text changes in live mode.
const debouncedAutoRunOnQuery = debounce(() => {
  if (
    searchObj.meta.liveMode &&
    store.state.zoConfig?.auto_query_enabled &&
    !searchObj.loading
  ) {
    searchData();
  }
}, 500);

// Debounced auto-run on datetime changes in live mode.
// Traces has no existing auto-run on datetime, so no guard needed.
const debouncedAutoRunOnDatetime = debounce(() => {
  // LLM Insights owns its refresh lifecycle explicitly: the dashboard's
  // toolbar has a dedicated refresh button, the parent calls
  // `recomputeInsightsTimeRange()` on tab-enter, and `searchData` is
  // wired through `llmInsightsRef.refresh()`. Bailing here prevents the
  // double-fetch caused by the LLM-tab date-picker's mount-time
  // `on:date-change` emit (re-writes `searchObj.data.datetime`, which
  // would otherwise trigger a second `searchData` 500ms after mount).
  if (activeTab.value === "llm-insights") return;

  // Absolute time is handled by SearchBar's triggerAbsoluteQueryDebounced (2500ms).
  // Only auto-run here for relative time to avoid double-triggering.
  if (
    searchObj.data.datetime.type === "relative" &&
    searchObj.meta.liveMode &&
    store.state.zoConfig?.auto_query_enabled &&
    !searchObj.loading
  ) {
    searchData();
  }
}, 500);

watch(
  () => searchObj.data.query,
  () => {
    debouncedAutoRunOnQuery();
  },
);

watch(
  () => [
    searchObj.data.datetime.type,
    searchObj.data.datetime.startTime,
    searchObj.data.datetime.endTime,
    searchObj.data.datetime.relativeTimePeriod,
  ],
  () => {
    debouncedAutoRunOnDatetime();
  },
  { deep: true },
);

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
  searchObj.meta.searchMode = data.mode;

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
    let filterQuery = `service_name = '${escapedServiceName}'`;
    if (data.operationName) {
      const escapedOpName = escapeSingleQuotes(data.operationName);
      filterQuery += ` AND operation_name = '${escapedOpName}'`;
    }
    if (data.nodeName) {
      const escapedNodeName = escapeSingleQuotes(data.nodeName);
      filterQuery += ` AND service_k8s_node_name = '${escapedNodeName}'`;
    }
    if (data.podName) {
      const escapedPodName = escapeSingleQuotes(data.podName);
      filterQuery += ` AND service_k8s_pod_name = '${escapedPodName}'`;
    }
    if (data.resourceFilter?.field && data.resourceFilter?.value) {
      const escapedValue = escapeSingleQuotes(data.resourceFilter.value);
      filterQuery += ` AND ${data.resourceFilter.field} = '${escapedValue}'`;
    }
    if (data.errorsOnly) {
      filterQuery += ` AND span_status = 'ERROR'`;
    }
    if (data.minDurationMicros && data.minDurationMicros > 0) {
      filterQuery += ` AND duration >= ${data.minDurationMicros}`;
    }
    if (data.maxDurationMicros && data.maxDurationMicros > 0) {
      filterQuery += ` AND duration <= ${data.maxDurationMicros}`;
    }
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

// Handler for services catalog row click — switches to traces mode filtered by service
const handleServicesCatalogViewTraces = (serviceName: string) => {
  const escapedName = escapeSingleQuotes(serviceName);
  searchObj.data.editorValue = `service_name = '${escapedName}'`;
  searchObj.data.query = searchObj.data.editorValue;
  searchObj.meta.sqlMode = false;
  searchObj.meta.searchMode = "traces";
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
watch(
  () => searchObj.meta.searchMode,
  (mode) => {
    const query = { ...router.currentRoute.value.query };
    if (mode !== "spans") {
      query.tab = mode;
    } else {
      delete query.tab;
    }
    router.replace({ query });
  },
);
</script>

<style lang="scss" scoped></style>
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

  .traces-horizontal-splitter .q-splitter__before {
    z-index: auto;
    overflow: visible;
  }

  .traces-horizontal-splitter.hide-splitter-separator
    > .q-splitter__separator {
    background: transparent !important;
    border: none !important;
  }
}
</style>
