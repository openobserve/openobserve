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
  <div
    class="rounded-default tracePage h-full max-h-full! min-h-full! overflow-hidden!"
    id="tracePage"
    style="min-height: auto"
  >
    <div id="tracesSecondLevel" class="h-full">
      <OSplitter
        :class="[
          'traces-horizontal-splitter h-full',
          activeTab === 'service-graph' || activeTab === 'services-catalog'
            ? 'hide-splitter-separator'
            : '',
        ]"
        v-model="splitterModel"
        :disable="activeTab === 'service-graph' || activeTab === 'services-catalog'"
        :horizontal="true"
        unit="px"
        :limits="[85, 400]"
        :separatorStyle="{ height: '9px', marginTop: '-5px', marginBottom: '-5px', zIndex: '10' }"
        :before-class="
          activeTab === 'service-graph' || activeTab === 'services-catalog'
            ? 'z-auto overflow-visible max-h-[3.125rem]!'
            : 'z-auto overflow-visible'
        "
        @update:model-value="onSplitterUpdate"
      >
        <template v-slot:before>
          <!-- px-1 (4px): the search bar's own 6px internal inset (toolbar p-1.5)
               + 4px = 10px, aligning the bar with the 10px field-list & results
               panels below (matches the Logs page). -->
          <div class="h-full w-full">
            <!-- Search Bar with Tab Toggle - Always visible to show tabs -->
            <SearchBar
              data-test="logs-search-bar"
              ref="searchBarRef"
              :fieldValues="fieldValues"
              :isLoading="searchObj.loading"
              :activeTab="activeTab"
              class="bg-card-glass-bg"
              @searchdata="searchData"
              @onChangeTimezone="refreshTimezone"
              @update:activeTab="activeTab = $event"
              @error-only-toggled="onErrorOnlyToggled"
              @filters-reset="onFiltersReset"
              @cancel-query="cancelSearch"
              @update:searchMode="onSearchModeChange"
              @service-graph-refresh="serviceGraphRef?.loadServiceGraph()"
              @services-catalog-refresh="servicesCatalogRef?.loadServicesCatalog()"
            />
          </div>
        </template>
        <template v-slot:after>
          <div class="h-full overflow-hidden">
            <!-- Service Graph Tab Content -->
            <div
              v-if="activeTab === 'service-graph' && config.isEnterprise == 'true'"
              class="h-full overflow-hidden"
            >
              <ServiceGraph
                ref="serviceGraphRef"
                class="h-full"
                @view-traces="handleServiceGraphViewTraces"
                @request:stream-change="onChildStreamChangeRequest"
                @jump-to-stream-data="onJumpToPanelStreamData"
              />
            </div>

            <!-- Services Catalog Tab Content -->
            <div v-if="activeTab === 'services-catalog'" class="h-full overflow-hidden">
              <ServicesCatalog
                ref="servicesCatalogRef"
                class="h-full"
                @view-traces="handleServicesCatalogViewTraces"
                @request:stream-change="onChildStreamChangeRequest"
                @jump-to-stream-data="onJumpToPanelStreamData"
              />
            </div>

            <!-- Search Tab Content -->
            <div
              v-if="activeTab === 'search'"
              id="tracesThirdLevel"
              class="traces-search-result-container relative-position h-full"
            >
              <!-- Note: Splitter max-height to be dynamically calculated with JS -->
              <OSplitter
                v-model="searchObj.config.splitterModel"
                :limits="searchObj.config.splitterLimit"
                separatorClass="w-px"
                @update:model-value="onSplitterUpdate"
                class="h-full w-full"
              >
                <template #before>
                  <div class="border-border-default bg-surface-panel h-full border-r">
                    <IndexList
                      v-show="searchObj.meta.showFields"
                      ref="indexListRef"
                      :field-list="searchObj.data.stream.selectedStreamFields"
                      :active-include-field-values="activeIncludeFilterValues"
                      :active-exclude-field-values="activeExcludeFilterValues"
                      data-test="traces-search-index-list"
                      class="h-full"
                      :key="searchObj.data.stream.streamLists"
                      @update:changeStream="onChangeStream"
                      @update:selectedFields="updateFieldVisibility"
                    />
                  </div>
                </template>
                <template #after>
                  <div class="h-full pb-2.5">
                    <!-- No trace streams in org yet -->
                    <TracesNoDataState
                      v-if="
                        !searchObj.loadingStream &&
                        searchObj.data.stream.streamLists.length === 0 &&
                        !searchObj.loading
                      "
                      :ai-enabled="isAiEnabled"
                      data-test="traces-no-streams-in-org-text"
                      @ask-ai="onAskAiSetupTracing"
                    />
                    <!-- Stable loading state while streams load / auto-run fires,
                       so the empties don't flash in between. -->
                    <div
                      v-else-if="searchObj.loadingStream"
                      class="bg-card-glass-bg text-text-secondary flex h-full flex-col items-center justify-center gap-2"
                      data-test="traces-search-loading"
                    >
                      <OSpinner size="lg" />
                      <span class="text-sm">{{ t("traces.fetchingTraces") }}</span>
                    </div>
                    <div
                      v-else-if="
                        searchObj.data.errorMsg !== '' &&
                        parseInt(searchObj.data.errorCode) !== 0 &&
                        searchObj.loading == false
                      "
                      class="bg-card-glass-bg h-full"
                    >
                      <div class="pt-8 text-center">
                        <!-- Actual error case -->
                        <div data-test="traces-search-error-message" class="pt-4 text-xl">
                          {{ t("traces.errorRetrievingTraces") }}
                          <OButton
                            v-if="searchObj.data.errorDetail || searchObj?.data?.errorMsg"
                            @click="toggleErrorDetails"
                            variant="outline"
                            size="sm-action"
                            data-test="traces-search-error-details-btn"
                            >{{ t("search.histogramErrorBtnLabel") }}</OButton
                          >
                        </div>
                        <!-- Collapsible error detail — shown below results when toggled -->
                        <div class="text-center">
                          <div class="my-none px-8! text-base!">
                            <span v-if="disableMoreErrorDetails">
                              <SanitizedHtmlRenderer
                                data-test="traces-search-detail-error-message"
                                :htmlContent="searchObj?.data?.errorMsg"
                                class="pt-4"
                              />
                              <div
                                v-if="searchObj?.data?.errorDetail"
                                class="error-display__message text-text-secondary! pt-4!"
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
                            :to="'/streams?dialog=' + searchObj.data.stream.selectedStream.label"
                            as="RouterLink"
                            >{{ t("traces.index.clickHere") }}</OButton
                          >
                          {{ t("traces.configureFullTextSearch") }}
                        </div>
                        <span class="text-sm">{{ searchObj.data.additionalErrorMsg }}</span>
                      </div>
                    </div>
                    <div
                      v-else-if="
                        searchObj.data.errorMsg !== '' &&
                        parseInt(searchObj.data.errorCode) == 0 &&
                        !searchObj.loading
                      "
                      data-test="traces-search-error-text"
                      class="bg-card-glass-bg h-full py-10 text-center text-xl"
                    >
                      <SanitizedHtmlRenderer
                        data-test="traces-search-detail-error-message"
                        :htmlContent="searchObj?.data?.errorMsg"
                        class="pt-4"
                      />
                    </div>
                    <div v-else-if="!isStreamSelected">
                      <TracesNoStreamState
                        :org-id="store.state.selectedOrganization?.identifier"
                        data-test="traces-no-stream-selected-text"
                        @select-stream="onSelectTracesStream"
                        @pick-stream="onPickTracesStream"
                      />
                    </div>
                    <div
                      v-else-if="
                        isStreamSelected &&
                        !searchObj.searchApplied &&
                        !searchObj.data.queryResults?.hits?.length
                      "
                    >
                      <OEmptyState
                        preset="no-query-applied"
                        size="hero"
                        data-test="traces-search-not-started-text"
                        @action="() => searchData()"
                      />
                    </div>
                    <div v-else data-test="logs-search-search-result" class="h-full!">
                      <SearchResult
                        ref="searchResultRef"
                        :show-error-only="showErrorOnly"
                        :ai-enabled="isAiEnabled"
                        :stream-doc-time-range="streamDocTimeRange"
                        :query-window-us="queryWindowUs"
                        @update:datetime="setHistogramDate"
                        @update:scroll="getMoreData"
                        @update:sort="runQueryOnSort"
                        @shareLink="copyTracesUrl"
                        @metrics:filters-updated="onMetricsFiltersUpdated"
                        @run-query="searchData"
                        @remove-filter="onRemoveTracesFilter"
                        @jump-to-stream-data="onJumpToTracesStreamData"
                        @error-only-toggled="onErrorOnlyToggled"
                        @ask-ai="onAskAiTracing"
                        @send-to-ai-chat="sendToAiChat"
                      />
                    </div>
                  </div>
                </template>
              </OSplitter>
            </div>
          </div>
        </template>
      </OSplitter>
    </div>

    <ODialog
      v-model:open="streamChangeDialog.show"
      :title="t('traces.index.changeStreamTitle')"
      size="sm"
      :primary-button-label="t('traces.index.switchStream')"
      :secondary-button-label="t('traces.index.cancel')"
      @click:primary="applyStreamChange(streamChangeDialog.pendingStream)"
      @click:secondary="streamChangeDialog.show = false"
    >
      <p>{{ t("traces.index.changeStreamMessage") }}</p>
    </ODialog>
  </div>
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
import { subtractRelativeTime } from "@/utils/date";
import { copyToClipboard } from "@/utils/clipboard";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import useTraces from "@/composables/useTraces";
import { contextRegistry, createTracesContextProvider } from "@/composables/contextProviders";

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
import { chartColor } from "@/utils/chartTheme";
import useHttpStreaming from "@/composables/useStreamingSearch";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import { logsErrorMessage } from "@/utils/common";
import { rangesFromServerError } from "@/utils/query/sqlDiagnostics";
import useNotifications from "@/composables/useNotifications";
import { getConsumableRelativeTime } from "@/utils/date";
import { cloneDeep } from "lodash-es";
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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import TracesNoDataState from "@/plugins/traces/TracesNoDataState.vue";
import TracesNoStreamState from "@/plugins/traces/TracesNoStreamState.vue";
import { saveTracesStream, restoreTracesStream } from "@/utils/streamPersist";
import { useCorrelationFilters } from "@/composables/useCorrelationDefaultSlug";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const SearchBar = defineAsyncComponent(() => import("./SearchBar.vue"));
const IndexList = defineAsyncComponent(() => import("./IndexList.vue"));
const SearchResult = defineAsyncComponent(() => import("./SearchResult.vue"));
const SanitizedHtmlRenderer = defineAsyncComponent(
  () => import("@/components/SanitizedHtmlRenderer.vue"),
);
const ServiceGraph = defineAsyncComponent(() => import("./ServiceGraph.vue"));
const ServicesCatalog = defineAsyncComponent(() => import("./ServicesCatalog.vue"));

const store = useStore();
const activeTab = computed(() => {
  if (searchObj.meta.searchMode === "service-graph") return "service-graph";
  if (searchObj.meta.searchMode === "services-catalog") return "services-catalog";
  return "search";
});
const router = useRouter();
const { t } = useI18n();
// Bubbles AI-chat requests up to MainLayout, which opens the O2AIChat panel.
const emit = defineEmits(["sendToAiChat"]);
const {
  searchObj,
  resetSearchObj,
  getUrlQueryParams,
  copyTracesUrl,
  formatTracesMetaData,
  setServiceColors,
  loadLocalLogFilterField,
  updatedLocalLogFilterField,
  loadTracesParser,
  tracesParser,
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
const splitterModel = ref(90);
const fieldValues = ref({});
const { showErrorNotification } = useNotifications();
const disableMoreErrorDetails = ref(false);
const toggleErrorDetails = () => {
  disableMoreErrorDetails.value = !disableMoreErrorDetails.value;
};
const indexListRef = ref(null);
const { getStreams, getStream } = useStreams();
const { loadSemanticGroups, loadKeyFields, loadFieldGrouping } = useServiceCorrelation();
const chartRedrawTimeout = ref(null);
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
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
const tracesPartitionMap: Record<string, { partition: number; chunks: Record<number, number> }> =
  {};

const selectedStreamName = computed(() => searchObj.data.stream.selectedStream.value);

const isLLMSpanPresent = ref(false);

function getQueryTransform() {
  try {
    searchObj.data.stream.functions = [];
    TransformService.list(1, 100000, "name", false, "", store.state.selectedOrganization.identifier)
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
    showErrorNotification(t("traces.index.errorGettingFunctions"));
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
        correlationFilters.restore();

        // Restore filter chips from the editor value. The single mount search is
        // owned by loadPageData() (after getStreamList resolves), so we do NOT
        // trigger a search here.
        if (searchObj.data.editorValue && searchObj.data.stream.selectedStreamFields.length)
          nextTick(() => {
            restoreFilters(searchObj.data.editorValue);
          });
      })
      .catch((e) => {
        searchObj.loadingStream = false;
        toast({
          variant: "error",
          message: t("traces.index.errorPullingIndex", { message: e.message }),
        });
      })
      .finally(() => {
        searchObj.loadingStream = false;
      });
  } catch (e) {
    searchObj.loadingStream = false;
    console.error("Error while getting streams", e);
    showErrorNotification(t("traces.index.errorGettingStreams"));
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
    showErrorNotification(t("traces.index.errorLoadingStreams"));
  }
}

function getConsumableDateTime() {
  try {
    if (searchObj.data.datetime.tab == "relative") {
      let period = "";
      let periodValue = 0;
      // arithmetic on weeks is not supported; convert to days.

      if (searchObj.data.datetime.relative.period.label.toLowerCase() == "weeks") {
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

      const startTimeStamp = subtractRelativeTime(endTimeStamp, JSON.parse(subtractObject));

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
          searchObj.data.datetime.absolute.date.to + " " + searchObj.data.datetime.absolute.endTime,
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
    req.query.from = searchObj.data.resultGrid.currentPage * searchObj.meta.resultGrid.rowsPerPage;
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
        tracesParser.value,
        searchObj.data.stream.selectedStream.value,
      );
      if (typeof durationParseResult === "string") {
        whereClause = durationParseResult;
      }

      // Convert span_kind display labels (e.g. 'Server') to numeric OTEL keys (e.g. '2').
      whereClause = parseSpanKindWhereClause(
        whereClause,
        tracesParser.value,
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
      req.query.sql = req.query.sql.replace("[WHERE_CLAUSE]", " WHERE " + whereClause);
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
    showErrorNotification(t("traces.index.errorConstructingQuery"));
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
          const count = isSpansMode ? (hits[0]?.span_count ?? 0) : (hits[0]?.trace_count ?? 0);
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
    t("traces.index.traceNotFound", {
      traceId: router.currentRoute.value.query.trace_id,
    }),
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
  const excludedFields = [store.state.zoConfig.timestamp_column, "_start_time_ns", "_end_time_ns"];
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

async function getQueryData(isPagination: boolean = false, isSort: boolean = false) {
  try {
    if (searchObj.data.stream.selectedStream.value == "") {
      return false;
    }
    searchObj.data.errorMsg = "";
    searchObj.data.errorDetail = "";
    searchObj.data.sqlSyntaxErrorRanges = [];

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
      searchObj.data.resultGrid.currentPage * searchObj.meta.resultGrid.rowsPerPage;

    queryReq.query.size = searchObj.meta.resultGrid.rowsPerPage;

    // Filters are already in editorValue (set by metrics dashboard brush selections).
    // Mirror buildSearch: split on | so only the WHERE-clause portion (after the pipe)
    // is passed to parseDurationWhereClause, not the query-functions prefix.
    const editorParts = searchObj.data.editorValue.trim().split("|");
    let filter = (editorParts.length > 1 ? editorParts[1] : editorParts[0]).trim();
    const filterParseResult = parseDurationWhereClause(
      filter,
      tracesParser.value,
      searchObj.data.stream.selectedStream.value,
    );
    if (typeof filterParseResult === "string") {
      filter = filterParseResult;
    }

    // Convert span_kind display labels (e.g. 'Server') to numeric OTEL keys (e.g. '2').
    filter = parseSpanKindWhereClause(
      filter,
      tracesParser.value,
      searchObj.data.stream.selectedStream.value,
    );

    const combinedFilter = filter;

    if (!isPagination && !isSort) searchResultRef?.value?.getDashboardData();

    // Cancel any in-flight stream before starting a new one
    if (currentSearchTraceId) {
      if (tracesPartitionMap[currentSearchTraceId]) delete tracesPartitionMap[currentSearchTraceId];

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
    const sortOrd = (searchObj.meta.resultGrid.sortOrder || "desc").toUpperCase();
    const schemaFieldNames = searchObj.data.stream.selectedStreamFields.map((f: any) => f.name);
    const validSortCol = (() => {
      if (schemaFieldNames.length === 0) return sortCol;
      return sortCol === "start_time" || schemaFieldNames.includes(sortCol)
        ? sortCol
        : "start_time";
    })();

    // Spans are physically stored sorted by the timestamp column, and the
    // backend has a dedicated optimizer for timestamp-sorted segments. A span's
    // `start_time` is monotonically equivalent to the timestamp column, so
    // ordering by the timestamp column yields the same visible order while
    // avoiding the costly full re-sort that `ORDER BY start_time` forces.
    const orderByCol =
      validSortCol === "start_time" ? store.state.zoConfig.timestamp_column : validSortCol;

    const spansQueryReq = (() => {
      if (!isSpansMode) return null;
      const whereClause = combinedFilter ? ` WHERE ${combinedFilter}` : "";
      const spansSql = `SELECT * FROM "${selectedStreamName.value}"${whereClause} ORDER BY ${orderByCol} ${sortOrd}`;
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
            const chunkCount = tracesPartitionMap[searchTraceId]?.chunks[partition] ?? 0;
            const isChunkedHits = chunkCount > 1;
            // appendResult: true when on a later partition or a later chunk within
            // the current partition (mirrors useSearchResponseHandler logic)
            const appendResult = partition > 1 || isChunkedHits;

            const formattedHits =
              searchObj.meta.searchMode === "traces" ? formatTracesMetaData(rawHits) : rawHits;

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
            if (searchObj.meta.searchMode === "spans" || searchObj.meta.searchMode === "traces") {
              loadLocalLogFilterField(searchObj.meta.searchMode);
              rebuildColumns();
            }
          }
        },
        error: (_payload: any, err: any) => {
          searchObj.loading = false;

          const errData = err?.content || err;
          const { message, trace_id, code, error_detail } = errData ?? {};

          let errorMsg = message || err?.message || t("traces.index.errorProcessingRequest");
          if (code) {
            searchObj.data.errorCode = code;
            const customMessage = logsErrorMessage(code);
            if (customMessage) errorMsg = t(customMessage);
          }
          if (trace_id) {
            errorMsg += ` <br><span class='text-base font-medium'>TraceID: ${trace_id}</span>`;
          }
          searchObj.data.errorMsg = errorMsg;
          searchObj.data.errorDetail = error_detail || "";

          // Locate the offending token in the query and squiggle it in the
          // editor (shares the central engine + externalErrors ref with Logs).
          rangesFromServerError({
            code,
            message,
            errorDetail: error_detail,
            sqlMode: searchObj.meta.sqlMode,
            query: searchObj.data.editorValue,
            streamName: searchObj.data.stream.selectedStream?.value,
          }).then((ranges) => {
            searchObj.data.sqlSyntaxErrorRanges = ranges;
          });

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
          correlationFilters.save().catch((e) => console.error("[correlation:save] error:", e));
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
    searchObj.data.errorMsg = e?.message || t("traces.index.searchRequestFailed");
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
  toast({
    variant: "success",
    message: t("traces.timeRangeUpdated"),
    timeout: 5000,
  });
};

async function extractFields() {
  try {
    searchObj.data.stream.selectedStreamFields = [];
    // Cleared here so a stream with no stats doesn't inherit the previous one's.
    selectedStreamStats.value = null;

    if (!searchObj.data.stream?.selectedStream?.value) return;

    if (searchObj.data.streamResults.list.length > 0) {
      const schema = [];
      const ignoreFields = [
        store.state.zoConfig.timestamp_column,
        "_start_time_ns",
        "_end_time_ns",
      ];
      let ftsKeys;

      const stream = await getStream(searchObj.data.stream.selectedStream.value, "traces", true);
      // Mirror the real stats (doc_time_min/max) into streamResults so that
      // TracesNoEventsState can compute streamDocTimeRange correctly.
      const streamResultEntry = searchObj.data.streamResults.list?.find(
        (s: any) => s.name === searchObj.data.stream.selectedStream.value,
      );
      if (streamResultEntry && stream?.stats) {
        streamResultEntry.stats = stream.stats;
      }
      // Capture the authoritative stats for the selected stream so the empty
      // state's "jump to latest data" works even if streamResults.list (from
      // the streams name-list) is missing stats. This is the same value the
      // query uses, fetched via getStream(force) above.
      selectedStreamStats.value = stream?.stats ?? streamResultEntry?.stats ?? null;
      searchObj.data.datetime.queryRangeRestrictionInHour = -1;
      if (
        (stream.settings.max_query_range > 0 || store.state.zoConfig.max_query_range > 0) &&
        (searchObj.data.datetime.queryRangeRestrictionInHour > stream.settings.max_query_range ||
          stream.settings.max_query_range == 0 ||
          searchObj.data.datetime.queryRangeRestrictionInHour == -1) &&
        searchObj.data.datetime.queryRangeRestrictionInHour != 0
      ) {
        searchObj.data.datetime.queryRangeRestrictionInHour =
          stream.settings.max_query_range > 0
            ? stream.settings.max_query_range
            : store.state.zoConfig.max_query_range;
        searchObj.data.datetime.queryRangeRestrictionMsg = t("search.queryRangeRestrictionMsg", {
          range:
            searchObj.data.datetime.queryRangeRestrictionInHour > 1
              ? searchObj.data.datetime.queryRangeRestrictionInHour + " hours"
              : searchObj.data.datetime.queryRangeRestrictionInHour + " hour",
        });
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
      const schemaTypeMap = new Map(schema.map((row: any) => [row.name, row.type]));
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
        const isEnterprise = config.isEnterprise === "true" || config.isCloud === "true";
        const [semanticAliases, keyFieldsConfig, fieldGrouping] = await Promise.all([
          isEnterprise ? loadSemanticGroups() : Promise.resolve([]),
          loadKeyFields(),
          loadFieldGrouping(),
        ]);
        const grouping = (fieldGrouping as FieldGroupingConfig).prefix_aliases
          ? (fieldGrouping as FieldGroupingConfig)
          : null;
        const semanticIndex =
          semanticAliases.length > 0 ? buildSemanticIndex(semanticAliases, grouping) : null;
        const keySpec = (keyFieldsConfig as KeyFieldsConfig)["traces"] ?? {
          fields: [],
          groups: [],
        };
        const keyFieldSet = new Set(keySpec.fields.map((f: string) => f.toLowerCase()));
        const keyGroupSet = new Set(keySpec.groups.map((g: string) => g.toLowerCase()));

        searchObj.data.stream.selectedStreamFields = applyFieldGrouping(
          searchObj.data.stream.selectedStreamFields as FieldObj[],
          semanticIndex,
          keyFieldSet,
          keyGroupSet,
        );
      } catch (groupErr) {
        console.warn("Field grouping failed for traces, using flat list", groupErr);
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
        color: chartColor("--color-text-heading"),
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
      color: chartColor("--color-text-heading"),
    },
    xaxis: { type: "date" },
    yaxis: { ticksuffix: "ms" },
    scattergap: 0.7,
    height: 150,
    paper_bgcolor: chartColor("--color-surface-base"),
    plot_bgcolor: chartColor("--color-surface-base"),
    autosize: true,
  };

  if (searchObj.data?.queryResults?.hits?.length) {
    searchObj.data.queryResults.hits.forEach(
      (bucket: { zo_sql_timestamp: string | number | Date; duration: number | Date }) => {
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
  if (!searchObj.data?.queryResults?.hits?.length) searchObj.data.resultGrid.currentPage = 0;

  // resetSearchObj();
  searchObj.organizationIdentifier = store.state.selectedOrganization.identifier;

  searchObj.data.errorMsg = "";

  //get stream list
  await getStreamList();
  if (searchObj.data.stream.selectedStream.value) {
    searchData();
  }
}

onBeforeMount(async () => {
  if (
    searchObj.organizationIdentifier &&
    searchObj.organizationIdentifier !== store.state.selectedOrganization.identifier
  ) {
    resetSearchObj();
  }
  setupContextProvider();
  restoreUrlQueryParams();
  await loadTracesParser();
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

  if (searchObj.organizationIdentifier != store.state.selectedOrganization.identifier) {
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
    startTime: typeof queryParams.from === "string" ? Number(queryParams.from) : queryParams.from,
    endTime: typeof queryParams.to === "string" ? Number(queryParams.to) : queryParams.to,
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
    (["service-graph", "traces", "spans", "services-catalog"] as const).includes(
      tab as "service-graph" | "traces" | "spans" | "services-catalog",
    )
  ) {
    if (tab === "service-graph" && config.isEnterprise !== "true") return;
    searchObj.meta.searchMode = tab as TraceSearchMode;
  }

  if (queryParams.stream && searchObj.data.stream.selectedStream.value !== queryParams.stream) {
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
        values = node.right.value.map((_value: { value: string }) => _value.value);
      }
      if (searchObj.data.stream.fieldValues?.[node?.left?.column]?.selectedValues)
        searchObj.data.stream.fieldValues[node.left.column].selectedValues = values;
    }
  }

  // Recurse through AND/OR expressions
  if (node.type === "binary_expr" && (node.operator === "AND" || node.operator === "OR")) {
    restoreFiltersFromQuery(node.left);
    restoreFiltersFromQuery(node.right);
  }
};

const restoreFilters = (query: string) => {
  // const filters = searchObj.data.stream.filters;

  const defaultQuery = `SELECT * FROM "${selectedStreamName.value}" WHERE `;

  const parsedQuery = tracesParser.value.astify(defaultQuery + query);

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
  // Add error filter only if span_status='ERROR' is currently active and not already present
  if (showErrorOnly.value && !allFilters.includes("span_status = 'ERROR'")) {
    allFilters.push("span_status = 'ERROR'");
  }
  // Apply each filter term independently so replace-or-append works per field.
  // applyFilters owns the single trigger: it emits `searchdata` (one search) only
  // in live mode. The brush also sets a time range programmatically, which the
  // DateTime picker stamps userChangedValue=false, so it never adds a competing
  // search — this filter apply is the sole trigger.
  if (searchBarRef.value?.applyFilters) {
    searchBarRef.value.applyFilters(allFilters);
  } else {
    console.warn("SearchBar not ready for filter application");
  }
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
const onSearchModeChange = (mode: "traces" | "spans" | "service-graph" | "services-catalog") => {
  searchObj.meta.searchMode = mode;
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

const onRemoveTracesFilter = () => {
  searchObj.data.editorValue = "";
  searchBarRef.value?.updateQuery?.();
  searchObj.runQuery = true;
};

const onJumpToTracesStreamData = (fromUs: number, toUs: number) => {
  searchBarRef.value?.dateTimeRef?.setAbsoluteTime(fromUs, toUs);
  searchObj.data.datetime.startTime = fromUs;
  searchObj.data.datetime.endTime = toUs;
  searchObj.data.datetime.type = "absolute";
  runQueryFn();
};

// Jump handler for the service-graph / services-catalog empty states. Mirrors
// the datetime + picker sync above, but does not run the traces query — each
// panel reloads itself from its own watch on the shared datetime.
const onJumpToPanelStreamData = (fromUs: number, toUs: number) => {
  searchBarRef.value?.dateTimeRef?.setAbsoluteTime(fromUs, toUs);
  searchObj.data.datetime.startTime = fromUs;
  searchObj.data.datetime.endTime = toUs;
  searchObj.data.datetime.type = "absolute";
  searchObj.data.datetime.relativeTimePeriod = null;
};

const onSelectTracesStream = () => {
  const trigger = document.querySelector<HTMLElement>(
    '[data-test="log-search-index-list-select-stream"] button',
  );
  trigger?.click();
};

const onPickTracesStream = (streamName: string) => {
  const match = searchObj.data.stream.streamLists.find(
    (s: any) => s.value === streamName || s.label === streamName,
  );
  if (match) {
    searchObj.data.stream.selectedStream = match;
    searchObj.runQuery = true;
  }
};

const isAiEnabled = computed(
  () => config.isEnterprise === "true" && !!store.state.zoConfig.ai_enabled,
);

// Authoritative doc time range for the selected stream, captured from
// getStream(force) in extractFields. Drives the empty-state "jump to latest
// data" card. Held in the parent (like the logs page) so it never depends on
// the streams name-list response carrying stats.
const selectedStreamStats = ref<{
  doc_time_min: number;
  doc_time_max: number;
} | null>(null);

const streamDocTimeRange = computed<{ min: number; max: number } | undefined>(() => {
  const selected = searchObj.data?.stream?.selectedStream?.value;
  if (!selected) return undefined;

  let min = Infinity;
  let max = -Infinity;

  const consider = (st: any) => {
    if (!st) return;
    // Ignore non-positive values: the schema endpoint can return a stats
    // object with doc_time_min/max = 0, which must not mask the real stats
    // coming from the streams name-list.
    if (st.doc_time_min > 0 && st.doc_time_min < min) min = st.doc_time_min;
    if (st.doc_time_max > 0 && st.doc_time_max > max) max = st.doc_time_max;
  };

  // Primary: streams name-list stats — the same source the logs page uses.
  for (const s of searchObj.data?.streamResults?.list ?? []) {
    if (s.name === selected) consider(s.stats);
  }
  // Fallback/merge: stats captured from getStream(force) in extractFields.
  consider(selectedStreamStats.value);

  if (!isFinite(min) || !isFinite(max)) return undefined;
  return { min, max };
});

const queryWindowUs = computed<{ start: number; end: number } | undefined>(() => {
  const dt = searchObj.data.datetime;
  if (dt?.type === "absolute" && dt.startTime && dt.endTime) {
    return { start: Number(dt.startTime), end: Number(dt.endTime) };
  }
  if (dt?.type === "relative" && dt.relativeTimePeriod) {
    const r = getConsumableRelativeTime(dt.relativeTimePeriod);
    if (r) return { start: r.startTime, end: r.endTime };
  }
  return undefined;
});

// Relay AI-chat requests from row cell actions (carrying an explicit message)
// straight up to MainLayout's O2AIChat panel.
const sendToAiChat = (value: any, append: boolean = true) => {
  emit("sendToAiChat", value, append);
};

// "Ask AI" from the no-events / error empty state: build a natural-language
// prompt describing the failed traces query, then open the AI chat with it.
// Mirrors the logs page's onAskAiFixQuery.
const onAskAiTracing = () => {
  const filter = searchObj.data.editorValue?.trim() || "(none)";

  // errorMsg may contain HTML (e.g. a <br><span>TraceID…</span>) — strip to text.
  const el = document.createElement("div");
  el.innerHTML = searchObj.data.errorMsg || "";
  const errorText = (el.textContent ?? "").trim();
  const errorContext = errorText ? ` Error: ${errorText}.` : "";

  const outcome = errorContext
    ? `The traces query produced an error.${errorContext}`
    : `The traces query ran successfully but returned no results.`;

  const mode = searchObj.meta.searchMode === "spans" ? "spans" : "traces";
  const stream = searchObj.data.stream.selectedStream?.value || "unknown";
  const timeRange = searchObj.data.datetime.relativeTimePeriod || "custom";

  emit(
    "sendToAiChat",
    `${outcome} I am searching ${mode}. The filter expression is: ${filter}. This is a WHERE-clause filter — not a full SQL query. Stream: ${stream}. Time range: ${timeRange}. Can you help me adjust the filter to get results?`,
    false,
  );
};

// "Ask AI" from the no-streams empty state: open the AI chat asking how to
// start sending traces, instead of navigating away to the ingestion page.
const onAskAiSetupTracing = () => {
  emit(
    "sendToAiChat",
    `I don't have any trace streams in OpenObserve yet and want to start sending traces. How do I instrument my services to send traces (e.g. via OpenTelemetry / OTLP)?`,
    false,
  );
};

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

const showErrorOnly = computed(
  () => activeIncludeFilterValues.value["span_status"]?.includes("ERROR") ?? false,
);

const searchData = () => {
  if (!(searchObj.data.stream.streamLists.length && searchObj.data.stream.selectedStream?.label)) {
    return;
  }

  if (activeTab.value === "service-graph" || activeTab.value === "services-catalog") return;

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

const streamChangeDialog = ref({ show: false, pendingStream: "" });

const applyStreamChange = async (newStream: string) => {
  searchObj.data.stream.selectedStream = {
    label: newStream,
    value: newStream,
  };
  searchObj.data.editorValue = "";
  streamChangeDialog.value.show = false;
  await onChangeStream();
};

const onChildStreamChangeRequest = (newStream: string) => {
  if (searchObj.data.editorValue?.trim()) {
    streamChangeDialog.value = { show: true, pendingStream: newStream };
  } else {
    applyStreamChange(newStream);
  }
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
  return searchObj.data.datetime.relative.value + searchObj.data.datetime.relative.period.value;
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
      saveTracesStream(store.state.selectedOrganization.identifier, streamValue);
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

// Auto-run in live mode is driven by explicit triggers at each user-intent
// handler (filter add/remove, manual date change, redirect, metrics brush), not
// by watching `searchObj.data.query`.

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
    const serviceField = data.serviceType ? "infer_service_name" : "service_name";
    let filterQuery = `${serviceField} = '${escapedServiceName}'`;
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
    if (data.callerService) {
      const escapedCaller = escapeSingleQuotes(data.callerService);
      filterQuery += ` AND service_name = '${escapedCaller}'`;
    }
    if (data.resourceFilter?.value) {
      const escapedValue = escapeSingleQuotes(data.resourceFilter.value);
      if (data.resourceFilter.fields?.length) {
        // Fallback chain: (field1 = 'val' OR field2 = 'val')
        const clauses = data.resourceFilter.fields
          .map((f: string) => `${f} = '${escapedValue}'`)
          .join(" OR ");
        filterQuery += ` AND (${clauses})`;
      } else if (data.resourceFilter.field) {
        filterQuery += ` AND ${data.resourceFilter.field} = '${escapedValue}'`;
      }
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

/**
 * Handler for the services catalog `view-traces` event.
 *
 * Normalizes the payload (which may be a plain service name string for backward
 * compatibility, or a full object with `serviceName`, `serviceType`,
 * `resourceFilter`, etc.) and delegates to {@link handleServiceGraphViewTraces}
 * to populate the search bar and run the filtered traces query.
 *
 * @param data - Service name string (legacy) or structured filter object.
 *               Structured objects may include `serviceName`, `serviceType`,
 *               `operationName`, `nodeName`, `podName`, `callerService`,
 *               `resourceFilter`, `errorsOnly`, `minDurationMicros`,
 *               `maxDurationMicros`, `mode`, and `stream`.
 */
const handleServicesCatalogViewTraces = (data: string | Record<string, any>) => {
  // Normalize plain string to object then delegate to the full handler
  const payload = typeof data === "string" ? { serviceName: data, mode: "traces" } : data;
  handleServiceGraphViewTraces(payload);
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

// ── Keyboard shortcuts ────────────────────────────────────────────────────
useShortcuts([
  {
    id: "tracesSearch",
    handler: () => runQueryFn(),
  },
  {
    id: "tracesRefresh",
    handler: () => {
      if (isInputFocused()) return;
      runQueryFn();
    },
  },
  {
    id: "tracesFocusQuery",
    handler: () => {
      // The traces query editor is Monaco — focus its inner textarea.
      const el = document.querySelector<HTMLElement>(
        '[data-test="logs-search-bar"] .monaco-editor textarea, [data-test="logs-search-bar"] textarea, [data-test="logs-search-bar"] .cm-editor',
      );
      el?.focus();
    },
  },
  {
    id: "tracesCopyUrl",
    handler: () => copyTracesUrl(),
  },
]);
</script>

<style scoped>
/* keep(scrollbar): native ::-webkit-scrollbar sizing/shadows on the child field-list
   & result-grid scrollers, plus a field-label font-size override on child FieldRow
   DOM — all reached through child components, so not expressible as utilities here. */
.tracePage :deep(.index-table :hover::-webkit-scrollbar),
.tracePage :deep(#tracesSearchGridComponent:hover::-webkit-scrollbar) {
  height: 0.8125rem;
  width: 0.8125rem;
}

.tracePage :deep(.index-table ::-webkit-scrollbar-track),
.tracePage :deep(#tracesSearchGridComponent::-webkit-scrollbar-track) {
  -webkit-box-shadow: inset 0 0 0.375rem color-mix(in srgb, var(--color-black) 30%, transparent);
  border-radius: 0.625rem;
}

.tracePage :deep(.index-table ::-webkit-scrollbar-thumb),
.tracePage :deep(#tracesSearchGridComponent::-webkit-scrollbar-thumb) {
  border-radius: 0.625rem;
  -webkit-box-shadow: inset 0 0 0.375rem color-mix(in srgb, var(--color-black) 50%, transparent);
}

.tracePage :deep(.index-menu .field_list .field_overlay .field_label) {
  font-size: var(--text-xs) !important;
}
</style>
