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

<template>
  <div class="sessions_page flex flex-col flex-1 min-h-0 overflow-hidden">
    <div>
      <div class="bg-card-glass-bg border-b border-border-default py-1.5 px-page-edge">
        <div class="flex items-start gap-1">
          <!-- Query editor (flex-grow to fill available space) -->
          <div class="flex-1 min-w-0 relative">
            <query-editor
              ref="errorQueryEditorRef"
              editor-id="rum-errors-query-editor"
              :class="[
                'border',
                'solid',
                'border-card-glass-border',
                'p-1',
                'rounded-default',
                'overflow-y-auto',
                errorEditorHeight,
              ]"
              v-model:query="errorTrackingState.data.editorValue"
              :debounce-time="300"
              :keywords="effectiveKeywords"
              :suggestions="effectiveSuggestions"
              @focus="onQueryEditorFocus"
              @blur="onQueryEditorBlur"
              @update:query="updateAutoComplete"
            />
            <div
              v-if="!errorTrackingState.data.editorValue && !editorFocused"
              class="query-editor-placeholder-overlay absolute top-0 left-0 right-0 bottom-0 flex items-start py-0.75 pr-2 pb-0 pl-[2.15rem] pointer-events-none z-1 select-none"
            >
              <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
            </div>
          </div>

          <!-- Controls on the right -->
          <div class="flex items-start gap-1 shrink-0">
            <syntax-guide />
            <date-time
              auto-apply
              menu-align="end"
              :default-type="errorTrackingState.data.datetime?.valueType"
              :default-absolute-time="{
                startTime: errorTrackingState.data.datetime.startTime,
                endTime: errorTrackingState.data.datetime.endTime,
              }"
              :default-relative-time="errorTrackingState.data.datetime.relativeTimePeriod"
              data-test="logs-search-bar-date-time-dropdown"
              @on:date-change="updateDateChange"
            />
            <!-- Run query button (also bound to the refresh shortcut) -->
            <OButton
              data-test="errors-run-query-button"
              variant="primary"
              size="sm-toolbar"
              :loading="isLoadingIssues"
              @click="runQuery"
              class="shrink-0"
            >
              {{ t("metrics.runQuery") }}
              <OTooltip
                side="bottom"
                :content="t('metrics.runQuery')"
                shortcut-id="rumErrorsRefresh"
              />
            </OButton>
            <OTableColumnToggle
              :columns="tableColumns"
              :column-visibility="columnVisibility"
              @update:column-visibility="setColumnVisibility"
            />
          </div>
          <!-- end controls -->
        </div>
        <!-- end flex row -->
      </div>
      <!-- end bg-card-glass-bg -->
    </div>
    <!-- end toolbar wrapper -->
    <OSplitter
      class="logs-horizontal-splitter flex-1 min-h-0"
      v-model="splitterModel"
      unit="px"
      :horizontal="false"
    >
      <template #before>
        <div class="bg-surface-panel py-1 h-full overflow-auto border-r border-border-default">
          <SearchFieldList
            :fields="streamFields"
            :time-stamp="{
              startTime: dateTime.startTime,
              endTime: dateTime.endTime,
            }"
            :stream-name="errorTrackingState.data.stream.errorStream"
            stream-type="logs"
            :enable-grouping="true"
            :query="errorTrackingState.data.editorValue"
            @event-emitted="handleSidebarEvent"
          />
        </div>
      </template>
      <template #after>
        <div class="h-full flex flex-col min-h-0">
          <!-- Errors-over-time chart + KPI summary -->
          <div class="grid grid-cols-1 lg:grid-cols-5 gap-2 px-page-edge pt-1.5 h-44 shrink-0">
            <ErrorsOverTimeChart
              class="lg:col-span-3"
              :buckets="chartSeries"
              :deploy="latestDeploy"
              :spike-factor="deploySpikeFactor"
              :focus="typeFilter"
              :loading="isLoadingChart"
            />
            <ErrorsKpiCards class="lg:col-span-2" :kpis="kpis" :loading="isLoadingKpis" />
          </div>

          <!-- Status / type / service filters -->
          <div class="px-page-edge py-1.5">
            <ErrorsFilterBar
              :status="statusFilter"
              :type="typeFilter"
              :service="serviceFilter"
              :services="serviceOptions"
              :counts="filterCounts"
              @update:status="onStatusFilterChange"
              @update:type="onTypeFilterChange"
              @update:service="onServiceFilterChange"
            />
          </div>

          <div class="bg-card-glass-bg flex-1 min-h-0 overflow-hidden">
            <OTable
              :data="visibleIssues"
              :columns="tableColumns"
              :default-columns="false"
              :column-visibility="columnVisibility"
              :loading="!!isLoading.length || isLoadingIssues"
              row-key="_rowKey"
              pagination="none"
              virtual-scroll
              :dense="false"
              :row-height="60"
              :show-global-filter="false"
              class="h-full"
              data-test="rum-app-errors-table"
              row-class="cursor-pointer"
              @row-click="handleRowClick"
            >
              <template #empty>
                <NoData />
              </template>
              <template #cell-issue="{ row }">
                <ErrorIssueCell :issue="row" />
              </template>
              <template #cell-trend="{ row }">
                <ErrorTrendCell
                  :buckets="trendBuckets[issueKey(row)] ?? null"
                  :status="row.status"
                  :handling="row.error_handling"
                  @visible="fetchTrend(row)"
                />
              </template>
              <template #cell-events="{ row }">
                <div class="flex flex-col items-end">
                  <span
                    class="font-semibold tabular-nums"
                    data-test="rum-app-errors-events-count"
                    >{{ addCommasToNumber(row.events) }}</span
                  >
                  <small>{{ t("rum.eventsUnit") }}</small>
                </div>
              </template>
              <template #cell-users="{ row }">
                <span class="tabular-nums" data-test="rum-app-errors-users-count">{{
                  row.users_affected != null ? addCommasToNumber(row.users_affected) : "—"
                }}</span>
              </template>
              <template #cell-seen="{ row }">
                <div class="flex flex-col">
                  <span data-test="rum-app-errors-last-seen">{{
                    formatRelativeTime(row.zo_sql_timestamp)
                  }}</span>
                  <small data-test="rum-app-errors-first-seen">{{
                    t("rum.firstSeenAgo", {
                      time: formatRelativeTime(row.first_seen),
                    })
                  }}</small>
                </div>
              </template>
              <template #cell-status="{ row }">
                <OTag
                  :label="row.status === 'new' ? t('rum.statusNew') : t('rum.statusOngoing')"
                  :variant="row.status === 'new' ? 'error' : 'error-outline'"
                  size="sm"
                  :title="row.status === 'new' ? t('rum.statusNewTooltip') : undefined"
                  data-test="rum-app-errors-status-badge"
                />
              </template>
            </OTable>
          </div>
        </div>
      </template>
    </OSplitter>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeMount,
  onMounted,
  ref,
  type Ref,
  defineAsyncComponent,
  watch,
} from "vue";
import { rangesFromServerError, type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { b64DecodeUnicode, b64EncodeUnicode } from "@/utils/zincutils";
import { useRouter } from "vue-router";
import ErrorIssueCell from "@/components/rum/errorTracking/list/ErrorIssueCell.vue";
import ErrorTrendCell from "@/components/rum/errorTracking/list/ErrorTrendCell.vue";
import ErrorsOverTimeChart from "@/components/rum/errorTracking/list/ErrorsOverTimeChart.vue";
import ErrorsKpiCards from "@/components/rum/errorTracking/list/ErrorsKpiCards.vue";
import ErrorsFilterBar, {
  type IssueStatusFilter,
  type IssueTypeFilter,
} from "@/components/rum/errorTracking/list/ErrorsFilterBar.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import useErrorTracking from "@/composables/useErrorTracking";
import useErrorIssuesData from "@/composables/rum/useErrorIssuesData";
import { issueKey, formatRelativeTime } from "@/utils/rum/errorIssueUtils";
import { addCommasToNumber } from "@/utils/formatters";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import { cloneDeep } from "lodash-es";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import { applyFilterTerm, removeFieldCondition } from "@/utils/traces/filterUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import NoData from "@/components/shared/grid/NoData.vue";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));
const { t } = useI18n();
const dateTime = ref({
  startTime: 0,
  endTime: 0,
  relativeTimePeriod: "",
  valueType: "relative",
});
const streamFields: Ref<any[]> = ref([]);
const splitterModel = ref(250);
const editorFocused = ref(false);
const errorQueryEditorRef = ref<any>(null);

// Server-error highlight ranges, forwarded to the filter editor by the composable.
const sqlErrorRanges = ref<SqlErrorRange[]>([]);

const {
  onFocus: _sqlOnFocus,
  onBlur: _sqlOnBlur,
  onQueryChange: _sqlOnQueryChange,
} = useSqlEditorDiagnostics({
  queryEditorRef: errorQueryEditorRef,
  sqlMode: computed(() => false),
  query: computed(() => errorTrackingState.data.editorValue ?? ""),
  streamName: computed(() => errorTrackingState.data.stream.errorStream),
  externalErrors: sqlErrorRanges,
});

const onQueryEditorFocus = () => {
  editorFocused.value = true;
  _sqlOnFocus();
};
const onQueryEditorBlur = async () => {
  editorFocused.value = false;
  await _sqlOnBlur();
};

// Autosuggestions — field names, operators, filter values
const {
  autoCompleteData,
  effectiveKeywords,
  effectiveSuggestions,
  getSuggestions,
  updateFieldKeywords,
} = useSqlSuggestions();

const updateAutoComplete = (value: string) => {
  _sqlOnQueryChange();
  autoCompleteData.value.query = value;
  autoCompleteData.value.cursorIndex = errorQueryEditorRef.value?.getCursorIndex?.();
  autoCompleteData.value.popup.open = errorQueryEditorRef.value?.triggerAutoComplete;
  autoCompleteData.value.org = store.state.selectedOrganization.identifier;
  autoCompleteData.value.streamType = "logs";
  autoCompleteData.value.streamName = errorTrackingState.data.stream.errorStream;
  getSuggestions();
};

// Dynamic placeholder based on actual error stream fields
const _sqlMode = computed(() => false);
const _noStream = computed(() => !errorTrackingState.data.stream.errorStream);
const { placeholder: editorPlaceholder } = useQueryPlaceholder(
  streamFields,
  computed(() => ({})),
  _sqlMode,
  _noStream,
);
const { errorTrackingState } = useErrorTracking();
const {
  issues,
  trendBuckets,
  chartSeries,
  latestDeploy,
  deploySpikeFactor,
  kpis,
  isLoadingIssues,
  isLoadingChart,
  isLoadingKpis,
  fetchAll,
  fetchTrend,
  lastQueryError,
} = useErrorIssuesData();

// Turn the last issues-search server error into editor squiggles (filter mode).
watch(lastQueryError, async (err) => {
  if (!err) {
    sqlErrorRanges.value = [];
    return;
  }
  sqlErrorRanges.value = await rangesFromServerError({
    code: err.code,
    message: err.message,
    errorDetail: err.error_detail,
    sqlMode: false,
    query: errorTrackingState.data.editorValue,
    streamName: errorTrackingState.data.stream.errorStream,
  });
});
const store = useStore();
const isLoading: Ref<true[]> = ref([]);
const isMounted = ref(false);
const { getStream } = useStreams();
const schemaMapping: Ref<{ [key: string]: boolean }> = ref({});

const tableErrors = computed(() =>
  issues.value.map((issue: any, i: number) => ({
    _rowKey: issue.latest_error_id || issue.zo_sql_timestamp || `err_${i}`,
    ...issue,
  })),
);

// ── Status / type / service filters ────────────────────────────────
const statusFilter = ref<IssueStatusFilter>("all");
const typeFilter = ref<IssueTypeFilter>("all");
const serviceFilter = ref("");
// Accumulated across runs so the list survives service-filtered queries.
const serviceOptions: Ref<string[]> = ref([]);

const filterCounts = computed(() => {
  const counts = { new: 0, ongoing: 0, unhandled: 0, handled: 0 };
  for (const issue of issues.value) {
    counts[issue.status === "new" ? "new" : "ongoing"]++;
    counts[issue.error_handling === "handled" ? "handled" : "unhandled"]++;
  }
  return counts;
});

// Chips filter client-side over the grouped result set; the chart and KPI
// cards intentionally keep showing the whole (SQL-filtered) stream.
const visibleIssues = computed(() =>
  tableErrors.value.filter((issue: any) => {
    if (statusFilter.value !== "all" && issue.status !== statusFilter.value) {
      return false;
    }
    if (typeFilter.value !== "all") {
      const handling = issue.error_handling === "handled" ? "handled" : "unhandled";
      if (handling !== typeFilter.value) return false;
    }
    return true;
  }),
);

const collectServiceOptions = () => {
  const merged = new Set(serviceOptions.value);
  for (const issue of issues.value) {
    if (issue.service) merged.add(issue.service);
  }
  serviceOptions.value = Array.from(merged).sort();
};

const onStatusFilterChange = (value: IssueStatusFilter) => {
  statusFilter.value = value;
  updateUrlQueryParams();
};

const onTypeFilterChange = (value: IssueTypeFilter) => {
  typeFilter.value = value;
  updateUrlQueryParams();
};

const onServiceFilterChange = (value: string) => {
  serviceFilter.value = value;
  runQuery();
};

// Dynamic editor height based on content lines
const errorEditorHeight = computed(() => {
  const lines = (errorTrackingState.data.editorValue.match(/\n/g) || []).length + 1;
  if (lines === 1) return "h-8!";
  if (lines === 2) return "h-14!";
  return "h-20!"; // 3+ lines, capped at 5rem (approx 3 lines)
});

const { columnVisibility, setColumnVisibility } =
  useExternalColumnToggle("rum-error-tracking-list");

const tableColumns = [
  {
    id: "issue",
    header: t("rum.issueColumn"),
    accessorKey: "error_message",
    sortable: false,
    hideable: true,
    // autoWidth: the issue cell absorbs leftover width and truncates long
    // messages instead of expanding the table into a horizontal scrollbar.
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "trend",
    header: t("rum.trendColumn"),
    accessorKey: "events",
    sortable: false,
    hideable: true,
    size: 170,
    meta: { align: "left" },
  },
  {
    id: "events",
    header: t("rum.events"),
    accessorKey: "events",
    sortable: true,
    hideable: true,
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "users",
    header: t("rum.usersColumn"),
    accessorKey: "users_affected",
    sortable: true,
    hideable: true,
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "seen",
    header: t("rum.seenColumn"),
    accessorKey: "zo_sql_timestamp",
    sortable: true,
    hideable: true,
    size: 150,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("rum.statusColumn"),
    accessorKey: "status",
    sortable: true,
    hideable: true,
    size: COL.status,
    meta: { align: "left" },
  },
] satisfies OTableColumnDef[];

const userDataSet = new Set([
  "user_agent_device_brand",
  "geo_info_city",
  "resource_method",
  "geo_info_location_metro_code",
  "resource_status_code",
  "resource_duration",
  "resource_url",
  "error_source",
  "geo_info_location_timezone",
  "error_source_type",
  "application_id",
  "display_viewport_width",
  "error_type",
  "action_type",
  "user_agent_user_agent_minor",
  "type",
  "service",
  "api",
  "privacy_replay_level",
  "view_url",
  "usr_id",
  "user_agent_user_agent_family",
  "user_agent_user_agent_patch",
  "user_agent_os_minor",
  "geo_info_location_accuracy_radius",
  "source",
  "oo_evp_origin",
  "session_has_replay",
  "version",
  "env",
  "sdk_version",
  "user_agent_os_major",
  "user_agent_os_patch",
  "view_referrer",
  "usr_email",
  "usr_name",
  "user_agent_os_family",
  "oo_evp_origin_version",
  "ip",
  "oosource",
  "user_agent_user_agent_major",
  "geo_info_country",
  "error_stack",
  "error_handling",
  "user_agent_device_family",
]);

const router = useRouter();

onBeforeMount(() => {
  restoreUrlQueryParams();
});

onMounted(async () => {
  isMounted.value = true;
  await getStreamFields();
  runQuery();
});

const handleSidebarEvent = (event: string, value: any) => {
  if (event === "add-field") {
    errorTrackingState.data.editorValue = applyFilterTerm(
      value,
      errorTrackingState.data.editorValue,
    );
  } else if (event === "remove-field") {
    errorTrackingState.data.editorValue = removeFieldCondition(
      errorTrackingState.data.editorValue,
      value,
    );
  }
};

const getStreamFields = () => {
  isLoading.value.push(true);
  return new Promise((resolve) => {
    getStream(errorTrackingState.data.stream.errorStream, "logs", true)
      .then((stream) => {
        streamFields.value = [];
        stream.schema.forEach((field: any) => {
          // TODO OK: Convert this to set
          schemaMapping.value[field.name] = true;

          if (userDataSet.has(field.name)) {
            streamFields.value.push({
              ...field,
              showValues: true,
            });
          }
        });

        // Feed all schema fields (not just userDataSet) into autosuggestion engine
        updateFieldKeywords(stream.schema);
      })
      .finally(() => {
        resolve(true);
        isLoading.value.pop();
      });
  });
};

const updateDateChange = (date: any) => {
  if (JSON.stringify(date) === JSON.stringify(dateTime.value)) return;
  dateTime.value = {
    startTime: date.startTime,
    endTime: date.endTime,
    relativeTimePeriod: date.relativeTimePeriod
      ? date.relativeTimePeriod
      : errorTrackingState.data.datetime.relativeTimePeriod,
    valueType: date.relativeTimePeriod ? "relative" : "absolute",
  };
  errorTrackingState.data.datetime = dateTime.value;
  if (!isLoading.value.length && date.valueType === "relative") runQuery();
};

const runQuery = () => {
  errorTrackingState.data.resultGrid.currentPage = 0;
  updateUrlQueryParams();
  fetchAll({
    startTime: dateTime.value.startTime,
    endTime: dateTime.value.endTime,
    schema: schemaMapping.value,
    userQuery: errorTrackingState.data.editorValue,
    service: serviceFilter.value,
  }).then(collectServiceOptions);
};

const handleErrorTypeClick = async (payload: any) => {
  errorTrackingState.data.selectedError = cloneDeep(payload.row);
  await nextTick();
  router.push({
    name: "ErrorViewer",
    params: { id: payload.row.latest_error_id },
    query: {
      timestamp: payload.row.zo_sql_timestamp,
    },
  });
};

const handleRowClick = (row: any) => {
  handleErrorTypeClick({ row });
};

// Severity spine flush against the row's left edge — same mechanism and
// colors as the sessions table, for cross-page consistency.
const getIssueStatusColor = (row: any) => {
  if (row.error_handling === "handled") return "var(--color-severity-warning-color)";
  return "var(--color-severity-error-color)";
};

function restoreUrlQueryParams() {
  const queryParams = router.currentRoute.value.query;

  const date = {
    startTime: Number(queryParams.from) as number,
    endTime: Number(queryParams.to) as number,
    relativeTimePeriod: (queryParams.period as string) || "",
    valueType: queryParams.period ? "relative" : "absolute",
  };

  if (date && ((date.startTime && date.endTime) || date.relativeTimePeriod)) {
    errorTrackingState.data.datetime = date;
  }

  if (queryParams.query) {
    errorTrackingState.data.editorValue = b64DecodeUnicode(queryParams.query as string) || "";
  }

  if (queryParams.status === "new" || queryParams.status === "ongoing") {
    statusFilter.value = queryParams.status;
  }
  if (queryParams.type === "unhandled" || queryParams.type === "handled") {
    typeFilter.value = queryParams.type;
  }
  if (typeof queryParams.service === "string" && queryParams.service) {
    serviceFilter.value = queryParams.service;
  }
}

function updateUrlQueryParams() {
  if (!isMounted.value) return;

  const date = errorTrackingState.data.datetime;
  const query: any = {};

  if (date.valueType == "relative") {
    query["period"] = date.relativeTimePeriod;
  } else {
    query["from"] = date.startTime;
    query["to"] = date.endTime;
  }

  query["query"] = b64EncodeUnicode(errorTrackingState.data.editorValue);

  if (statusFilter.value !== "all") query["status"] = statusFilter.value;
  if (typeFilter.value !== "all") query["type"] = typeFilter.value;
  if (serviceFilter.value) query["service"] = serviceFilter.value;

  query["org_identifier"] = store.state.selectedOrganization.identifier;
  router.push({ query });
}

useShortcuts([
  {
    id: "rumErrorsRefresh",
    handler: () => {
      if (!isInputFocused()) runQuery();
    },
  },
]);
</script>
