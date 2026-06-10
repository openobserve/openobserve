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
  <div class="sessions_page tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden">
    <div>
      <div class="card-container tw:border-b tw:border-border-default tw:py-[0.375rem] tw:px-[0.375rem]">
        <div class="tw:flex tw:items-start tw:gap-1">
          <!-- Query editor (flex-grow to fill available space) -->
          <div class="tw:flex-1 tw:min-w-0 tw:relative">
            <query-editor
              ref="errorQueryEditorRef"
              editor-id="rum-errors-query-editor"
              :class="['monaco-editor', 'tw:border', 'tw:solid', 'tw:border-[var(--o2-border-color)]', 'tw:p-[0.25rem]', 'tw:rounded-[0.375rem]', 'tw:overflow-y-auto', errorEditorHeight]"
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
              class="query-editor-placeholder-overlay"
            >
              <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
            </div>
          </div>

          <!-- Controls on the right -->
          <div class="tw:flex tw:items-start tw:gap-1 tw:shrink-0">
            <syntax-guide />
            <date-time
              auto-apply
              menu-align="end"
              :default-type="errorTrackingState.data.datetime?.valueType"
              :default-absolute-time="{
                startTime: errorTrackingState.data.datetime.startTime,
                endTime: errorTrackingState.data.datetime.endTime,
              }"
              :default-relative-time="
                errorTrackingState.data.datetime.relativeTimePeriod
              "
              data-test="logs-search-bar-date-time-dropdown"
              @on:date-change="updateDateChange"
            />
            <!-- Run query button -->
            <OButton
              data-test="errors-run-query-button"
              variant="primary"
              size="sm-toolbar"
              :title="t('metrics.runQuery')"
              @click="runQuery"
              class="tw:shrink-0"
            >
              {{ t("metrics.runQuery") }}
            </OButton>
          </div><!-- end controls -->
        </div><!-- end flex row -->
      </div><!-- end card-container -->
    </div><!-- end toolbar wrapper -->
    <OSplitter
      class="logs-horizontal-splitter tw:flex-1 tw:min-h-0"
      v-model="splitterModel"
      unit="px"
      :horizontal="false"
    >
      <template #before>
        <div class="card-container tw:p-[0.325rem] tw:h-full tw:overflow-auto tw:border-r tw:border-border-default">
          <SearchFieldList
            :fields="streamFields"
            :time-stamp="{
              startTime: dateTime.startTime,
              endTime: dateTime.endTime,
            }"
            :stream-name="errorTrackingState.data.stream.errorStream"
            :query="errorTrackingState.data.editorValue"
            @event-emitted="handleSidebarEvent"
          />
        </div>
      </template>
      <template #after>
        <div class="card-container tw:h-full tw:overflow-hidden">
          <OTable
            :data="tableErrors"
            :columns="tableColumns"
            :loading="isLoading.length"
            row-key="_rowKey"
            pagination="none"
            virtual-scroll
            :dense="false"
            :row-height="86"
            :show-global-filter="false"
            horizontal-scroll
            class="tw:h-full"
            data-test="rum-app-errors-table"
            row-class="tw:cursor-pointer"
            @row-click="handleRowClick"
          >
            <template #empty>
              <NoData />
            </template>
            <template #cell-error="{ row }">
              <ErrorDetail :column="row" />
            </template>
          </OTable>
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
} from "vue";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { b64DecodeUnicode, b64EncodeUnicode } from "@/utils/zincutils";
import { useRouter } from "vue-router";
import ErrorDetail from "@/components/rum/ErrorDetail.vue";
import useErrorTracking from "@/composables/useErrorTracking";
import useQuery from "@/composables/useQuery";
import { useStore } from "vuex";
import searchService from "@/services/search";
import DateTime from "@/components/DateTime.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import { cloneDeep } from "lodash-es";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import { useI18n } from "vue-i18n";
import useStreams from "@/composables/useStreams";
import {
  applyFilterTerm,
  removeFieldCondition,
} from "@/utils/traces/filterUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
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

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef: errorQueryEditorRef,
    sqlMode: computed(() => false),
    query: computed(() => errorTrackingState.data.editorValue ?? ""),
    streamName: computed(() => errorTrackingState.data.stream.errorStream),
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
const { getTimeInterval, buildQueryPayload, parseQuery } = useQuery();
const { errorTrackingState } = useErrorTracking();
const store = useStore();
const isLoading: Ref<true[]> = ref([]);
const isMounted = ref(false);
const { getStream } = useStreams();
const totalErrorsCount = ref(0);
const schemaMapping: Ref<{ [key: string]: boolean }> = ref({});

const tableErrors = computed(() => {
  const errors = errorTrackingState.data.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e: any, i: number) => ({
    _rowKey: e.latest_error_id || e.zo_sql_timestamp || `err_${i}`,
    ...e,
  }));
});

// Dynamic editor height based on content lines
const errorEditorHeight = computed(() => {
  const lines = (errorTrackingState.data.editorValue.match(/\n/g) || []).length + 1;
  if (lines === 1) return 'tw:h-[2rem]!';
  if (lines === 2) return 'tw:h-[3.5rem]!';
  return 'tw:h-[5rem]!'; // 3+ lines, capped at 5rem (approx 3 lines)
});

const tableColumns = [
  {
    id: "error",
    header: t("rum.error"),
    accessorKey: "error",
    sortable: true,
    size: COL.description,
    meta: { align: "left" }
  },
  {
    id: "events",
    header: t("rum.events"),
    accessorKey: "events",
    sortable: true,
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "initial_view_name",
    header: t("rum.viewURL"),
    accessorKey: "view_url",
    sortable: true,
    size: COL.url,
    meta: { align: "left" },
  },
];

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

const getErrorLogs = () => {
  const interval = getTimeInterval(
    dateTime.value.startTime,
    dateTime.value.endTime,
  );
  const parsedQuery = parseQuery(errorTrackingState.data.editorValue, false);
  const queryPayload: any = {
    from: Object.keys(errorTrackingState.data.errors).length,
    size: errorTrackingState.data.resultGrid.size,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime: dateTime.value.startTime,
      endTime: dateTime.value.endTime,
    },
    timeInterval: interval.interval,
    sqlMode: false,
    currentPage: errorTrackingState.data.resultGrid.currentPage,
    selectedStream: errorTrackingState.data.stream.errorStream,
    parsedQuery,
    streamName: errorTrackingState.data.stream.errorStream,
  };
  const req = buildQueryPayload(queryPayload);

  let errorFields = "";
  let errorWhereClause = "";

  if (schemaMapping.value["error_message"]) {
    errorFields += "error_message, ";
    errorWhereClause += "error_message, ";
  }
  if (schemaMapping.value["error_handling"]) {
    errorFields += "error_handling, ";
    errorWhereClause += "error_handling, ";
  }

  if (schemaMapping.value["error_type"]) {
    errorFields += "error_type, ";
    errorWhereClause += "error_type, ";
  }

  if (schemaMapping.value["error_id"]) {
    errorWhereClause += `FIRST_VALUE(error_id ORDER BY ${store.state.zoConfig.timestamp_column} DESC) as latest_error_id, `;
  }

  schemaMapping.value["error_stack"] = false;
  schemaMapping.value["error_handling_stack"] = false;

  if (
    schemaMapping.value["error_handling_stack"] &&
    schemaMapping.value["error_stack"]
  ) {
    errorWhereClause +=
      "MIN(CASE WHEN error_stack IS NOT NULL THEN error_stack WHEN error_handling_stack IS NOT NULL THEN error_handling_stack ELSE NULL END ) AS error_stack, ";
    errorFields += "error_stack, ";
  } else if (schemaMapping.value["error_handling_stack"]) {
    errorWhereClause +=
      "MIN(CASE WHEN error_handling_stack IS NOT NULL THEN error_handling_stack ELSE NULL END ) AS error_stack, ";
    errorFields += "error_stack, ";
  } else if (schemaMapping.value["error_stack"]) {
    errorWhereClause +=
      "MIN(CASE WHEN error_stack IS NOT NULL THEN error_stack ELSE NULL END ) AS error_stack, ";
    errorFields += "error_stack, ";
  }

  req.query.sql = `select max(${
    store.state.zoConfig.timestamp_column
  }) as zo_sql_timestamp, service, COUNT(*) as events, ${errorWhereClause} max(view_url) as view_url, max(session_id) as session_id from "_rumdata" where type='error'${
    errorTrackingState.data.editorValue.length
      ? " and " + errorTrackingState.data.editorValue
      : ""
  } GROUP BY ${errorFields} service order by zo_sql_timestamp DESC`;

  req.query.sql.replaceAll("\n", " ");
  delete req.aggs;
  isLoading.value.push(true);

  updateUrlQueryParams();

  searchService
    .search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      },
      "RUM",
    )
    .then((res) => {
      errorTrackingState.data.errors = res.data.hits;
      totalErrorsCount.value = res.data.hits.reduce(
        (acc: number, curr: any) => {
          return acc + curr.events;
        },
        0,
      );
    })
    .catch((err) => {
      toast({
        message:
          err.response?.data?.message || "Error while fetching error events",
        variant: "error",
      });
    })
    .finally(() => isLoading.value.pop());
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
  errorTrackingState.data.errors = {};
  getErrorLogs();
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
    errorTrackingState.data.editorValue =
      b64DecodeUnicode(queryParams.query as string) || "";
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

  query["org_identifier"] = store.state.selectedOrganization.identifier;
  router.push({ query });
}
</script>

<style scoped lang="scss"></style>
<style lang="scss">
.sessions_page {
  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 0.75rem !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .index-table :hover::-webkit-scrollbar,
  #tracesSearchGridComponent:hover::-webkit-scrollbar {
    height: 0.8125rem;
    width: 0.8125rem;
  }

  .index-table ::-webkit-scrollbar-track,
  #tracesSearchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 0.625rem;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #tracesSearchGridComponent::-webkit-scrollbar-thumb {
    border-radius: 0.625rem;
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .q-table__top {
    padding: 0 !important;
  }

  .q-table__control {
    width: 100%;
  }

  .q-field__control-container {
    padding-top: 0 !important;
  }

  .search-button {
    width: 6rem;
    line-height: 1.8125rem;
    font-weight: bold;
    text-transform: initial;
    font-size: 0.6875rem;
    color: white;

    .q-btn__content {
      background: $secondary;
      border-radius: 0.1875rem 0.1875rem 0.1875rem 0.1875rem;
}
  }
}

.query-editor-placeholder-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  padding: 0.1875rem 0.5rem 0 2.15rem;
  pointer-events: none;
  z-index: 1;
  user-select: none;

  .query-editor-placeholder-typewriter {
    font-family: monospace;
    font-size: var(--text-base);
    line-height: 1.3125rem;
    color: #a0aec0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.body--dark .query-editor-placeholder-overlay {
  .query-editor-placeholder-typewriter {
    color: #718096;
  }
}
</style>
