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
    <template v-if="isSessionReplayEnabled">
      <div>
        <div class="card-container tw:border-b tw:border-border-default tw:py-[0.375rem] tw:px-[0.375rem]">
          <div class="tw:flex tw:items-start tw:gap-1">
            <!-- Query editor (flex-grow to fill available space) -->
            <div class="tw:flex-1 tw:min-w-0 tw:relative">
              <query-editor
                ref="sessionQueryEditorRef"
                editor-id="session-replay-query-editor"
                :class="['monaco-editor', 'tw:border', 'tw:solid', 'tw:border-[var(--o2-border-color)]', 'tw:p-[0.25rem]', 'tw:rounded-[0.375rem]', 'tw:overflow-y-auto', queryEditorHeight]"
                v-model:query="sessionState.data.editorValue"
                :debounce-time="300"
                :keywords="effectiveKeywords"
                :suggestions="effectiveSuggestions"
                @focus="onQueryEditorFocus"
                @blur="onQueryEditorBlur"
                @update:query="updateAutoComplete"
              />
              <div
                v-if="!sessionState.data.editorValue && !editorFocused"
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
                :default-type="sessionState.data.datetime.valueType"
                :default-absolute-time="{
                  startTime: sessionState.data.datetime.startTime,
                  endTime: sessionState.data.datetime.endTime,
                }"
                :default-relative-time="
                  sessionState.data.datetime.relativeTimePeriod
                "
                data-test="logs-search-bar-date-time-dropdown"
                @on:date-change="updateDateChange"
              />
              <!-- Run query button -->
              <OButton
                data-test="sessions-run-query-button"
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
              :stream-name="rumSessionStreamName"
              :query="completeQuery"
              :show-count="false"
              @event-emitted="handleSidebarEvent"
            />
          </div>
        </template>
        <template #after>
          <div class="tw:h-full">
            <div class="card-container tw:h-full">
                <OTable
                  :data="tableRows"
                  :columns="tableColumns"
                  :loading="isLoading.length > 0"
                  row-key="session_id"
                  pagination="none"
                  virtual-scroll
                  :dense="false"
                  :row-height="54"
                  class="tw:h-full"
                  data-test="rum-sessions-table"
                  row-class="tw:cursor-pointer"
                  @row-click="handleRowClick"
                  @scroll-end="handleScrollEnd"
                  :show-global-filter="false"
                  :default-columns="false"
                >
                  <template #empty>
                    <NoData />
                  </template>
                  <template #cell-action_play="{ row }">
                    <OIcon
                      name="play-circle-filled"
                      size="md"
                      class="tw:cursor-pointer session-play-icon tw:text-[var(--o2-icon-color)] hover:tw:text-[var(--o2-primary-btn-bg)]"
                    />
                  </template>
                  <template #cell-frustration_count="{ row }">
                    <FrustrationBadge
                      :count="row.frustration_count || 0"
                    />
                  </template>
                  <template #cell-location="{ row }">
                    <SessionLocationColumn :column="row" />
                  </template>
                </OTable>
            </div>
          </div>
        </template>
      </OSplitter>
    </template>
    <template v-else>
      <div class="card-container">
        <div class="tw:p-4 enable-rum tw:max-w-[64rem]">
          <div class="tw:pb-4">
            <div class="tw:text-left tw:text-xl tw:font-semibold tw:font-bold tw:pb-3">
              {{ t("rum.discoverSessionTitle") }}
            </div>
            <div class="tw:text-base tw:font-medium">
              {{ t("rum.discoverSessionMessage") }}
            </div>
            <div>
              <div></div>
            </div>
          </div>
          <OButton
            variant="primary"
            size="sm-action"
            :title="t('common.getStartedRUM')"
            @click="getStarted"
          >
            {{ t("common.getStarted") }}
          </OButton>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  type Ref,
  onBeforeMount,
  defineAsyncComponent,
  computed,
} from "vue";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import {
  formatDuration,
  b64DecodeUnicode,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import { onBeforeRouteUpdate, useRouter } from "vue-router";
import { useStore } from "vuex";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { formatDate } from "@/utils/date";
import useSession from "@/composables/useSessionReplay";
import DateTime from "@/components/DateTime.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import SessionLocationColumn from "@/components/rum/sessionReplay/SessionLocationColumn.vue";
import FrustrationBadge from "@/components/rum/FrustrationBadge.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import useStreams from "@/composables/useStreams";
import {
  applyFilterTerm,
  removeFieldCondition,
} from "@/utils/traces/filterUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface Session {
  timestamp: string;
  type: string;
  time_spent: number;
  error_count: string;
  frustration_count?: number;
  initial_view_name: string;
  id: string;
}

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

const props = defineProps({
  isSessionReplayEnabled: {
    type: Boolean,
    default: false,
  },
});

const streamFields: Ref<any[]> = ref([]);
const { getTimeInterval, buildQueryPayload, parseQuery } = useQuery();


const { sessionState } = useSession();
const store = useStore();
const isLoading = ref<boolean[]>([]);
const { t } = useI18n();
const dateTime = ref({
  startTime: 0,
  endTime: 0,
  relativeTimePeriod: "",
  valueType: "relative",
});
const rumSessionStreamName = "_rumdata";

// Computed query that includes session_has_replay filter
const completeQuery = computed(() => {
  let whereClause = "session_has_replay IS NOT NULL AND session_id is not null";
  if (sessionState.data.editorValue.length) {
    whereClause += " AND (" + sessionState.data.editorValue.trim() + ")";
  }
  return whereClause;
});

// Dynamic editor height based on content lines
const queryEditorHeight = computed(() => {
  const lines = (sessionState.data.editorValue.match(/\n/g) || []).length + 1;
  if (lines === 1) return 'tw:h-[2rem]!';
  if (lines === 2) return 'tw:h-[3.5rem]!';
  return 'tw:h-[5rem]!'; // 3+ lines, capped at 5rem (approx 3 lines)
});

const isMounted = ref(false);
const editorFocused = ref(false);
const sessionQueryEditorRef = ref<any>(null);

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef: sessionQueryEditorRef,
    sqlMode: computed(() => false),
    query: computed(() => sessionState.data.editorValue ?? ""),
    streamName: computed(() => rumSessionStreamName),
  });

const onQueryEditorFocus = () => {
  editorFocused.value = true;
  _sqlOnFocus();
};
const onQueryEditorBlur = async () => {
  editorFocused.value = false;
  await _sqlOnBlur();
};

const schemaMapping: Ref<{ [key: string]: boolean }> = ref({});
const { getStream } = useStreams();

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
  autoCompleteData.value.cursorIndex = sessionQueryEditorRef.value?.getCursorIndex?.();
  autoCompleteData.value.popup.open = sessionQueryEditorRef.value?.triggerAutoComplete;
  autoCompleteData.value.org = store.state.selectedOrganization.identifier;
  autoCompleteData.value.streamType = "logs";
  autoCompleteData.value.streamName = rumSessionStreamName;
  getSuggestions();
};

// Dynamic placeholder based on actual stream fields
const _sqlMode = computed(() => false);
const _noStream = computed(() => !rumSessionStreamName);
const { placeholder: editorPlaceholder } = useQueryPlaceholder(
  streamFields,
  computed(() => ({})),
  _sqlMode,
  _noStream,
);

const userDataSet = new Set([
  "user_agent_device_family",
  "user_agent_user_agent_major",
  "user_agent_user_agent_minor",
  "user_agent_user_agent_family",
  "user_agent_os_major",
  "user_agent_os_minor",
  "user_agent_os_patch",
  "user_agent_user_agent_patch",
  "user_agent_os_family",
  "user_agent_device_brand",
  "ip",
  "geo_info_location_timezone",
  "geo_info_location_metro_code",
  "geo_info_country",
  "geo_info_city",
  "geo_info_location_accuracy_radius",
  "sdk_version",
  "application_id",
  "env",
  "service",
  "oosource",
  "oo_evp_origin",
  "oo_evp_origin_version",
  "source",
  "api",
  "usr_email",
  "session_id",
  "view_id",
  "view_url",
  "resource_url",
]);

const tableColumns = [
  {
    id: "action_play",
    header: "",
    accessorKey: "action_play",
    sortable: false,
    size: 56,
    meta: { align: "center" },
  },
  {
    id: "timestamp",
    header: t("rum.timestamp"),
    accessorFn: (row: any) => getFormattedDate(row["timestamp"] / 1000),
    sortable: true,
    size: 240,
    meta: { align: "left" },
  },
  {
    id: "user_email",
    header: t("login.userEmail"),
    accessorFn: (row: any) => row["user_email"] || "Unknown",
    sortable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "time_spent",
    header: t("rum.timeSpent"),
    accessorFn: (row: any) => formatDuration(row["time_spent"]),
    sortable: true,
    size: COL.duration,
    meta: { align: "left" },
  },
  {
    id: "error_count",
    header: t("rum.errorCount"),
    accessorKey: "error_count",
    sortable: true,
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "frustration_count",
    header: t("rum.frustrationCount"),
    accessorFn: (row: any) => row["frustration_count"] || 0,
    sortable: true,
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "location",
    header: t("rum.location"),
    accessorFn: (row: any) => formatDuration(row["time_spent"]),
    sortable: true,
    size: 360,
    meta: { align: "left" },
  },
];

onBeforeMount(() => {
  restoreUrlQueryParams();
});

onMounted(async () => {
  if (router.currentRoute.value.name === "Sessions") {
    isMounted.value = true;
    await getStreamFields();
    getSessions();
  }
});



const getStreamFields = () => {
  isLoading.value.push(true);
  return new Promise((resolve) => {
    getStream(rumSessionStreamName, "logs", true)
      .then((stream) => {
        const fieldsToVerify = new Set([
          "geo_info_city",
          "geo_info_country",
          "geo_info_country_iso_code",
          "usr_email",
          "usr_id",
          "usr_name",
        ]);

        // Define priority fields that should appear at the top
        const priorityFields = [
          "application_id",
          "usr_email",
          "env",
          "view_url",
          "resource_url",
          "session_id",
        ];
        const priorityFieldsMap = new Map(
          priorityFields.map((field, index) => [field, index]),
        );

        streamFields.value = [];

        stream.schema.forEach((field: any) => {
          if (fieldsToVerify.has(field.name))
            schemaMapping.value[field.name] = field;

          if (userDataSet.has(field.name)) {
            streamFields.value.push({
              ...field,
              showValues: true,
            });
          }
        });

        // Sort fields: priority fields first, then alphabetically
        streamFields.value.sort((a, b) => {
          const aPriority = priorityFieldsMap.get(a.name);
          const bPriority = priorityFieldsMap.get(b.name);

          // If both are priority fields, sort by priority order
          if (aPriority !== undefined && bPriority !== undefined) {
            return aPriority - bPriority;
          }
          // If only a is priority, it comes first
          if (aPriority !== undefined) return -1;
          // If only b is priority, it comes first
          if (bPriority !== undefined) return 1;
          // Otherwise, sort alphabetically
          return a.name.localeCompare(b.name);
        });

        // Feed full schema into autosuggestion (all fields, not just userDataSet subset)
        updateFieldKeywords(stream.schema);
      })
      .finally(() => {
        isLoading.value.pop();
        resolve(true);
      });
  });
};

const getSessions = () => {
  sessionState.data.sessions = {};

  const interval = getTimeInterval(
    dateTime.value.startTime,
    dateTime.value.endTime,
  );
  const parsedQuery = parseQuery(sessionState.data.editorValue, false);

  const queryPayload: any = {
    from: Object.keys(sessionState.data.sessions).length,
    size: sessionState.data.resultGrid.size,
    timestamp_column: store.state.zoConfig.timestamp_column,
    timestamps: {
      startTime: dateTime.value.startTime,
      endTime: dateTime.value.endTime,
    },
    timeInterval: interval.interval,
    sqlMode: false,
    currentPage: sessionState.data.resultGrid.currentPage,
    selectedStream: "_rumdata",
    parsedQuery,
    streamName: "_rumdata",
  };

  const req = buildQueryPayload(queryPayload);

  // Build optional fields based on schema
  let geoFields = "";
  if (schemaMapping.value["geo_info_city"]) {
    geoFields += "min(geo_info_city) as city,";
  }
  if (schemaMapping.value["geo_info_country"]) {
    geoFields += "min(geo_info_country) as country,";
  }
  if (schemaMapping.value["geo_info_country_iso_code"]) {
    geoFields += "min(geo_info_country_iso_code) as country_iso_code,";
  }
  if (schemaMapping.value["usr_email"]) {
    geoFields += "max(usr_email) as user_email,";
  }

  // Build frustration count field with null check
  let frustrationCountField = "0 AS frustration_count";
  if (schemaMapping.value["action_frustration_type"]) {
    frustrationCountField =
      "SUM(CASE WHEN type='action' AND action_frustration_type IS NOT NULL THEN 1 ELSE 0 END) AS frustration_count";
  }

  // Build WHERE clause with session replay filter
  let whereClause = "session_has_replay IS NOT NULL";
  if (sessionState.data.editorValue.length) {
    whereClause += " AND (" + sessionState.data.editorValue.trim() + ")";
  }

  // Query 1: Get sessions with all metrics from _rumdata (supports usr_email, usr_id, session_id filters)
  req.query.sql = `
    SELECT
      min(${store.state.zoConfig.timestamp_column}) as zo_sql_timestamp,
      min(type) as type,
      SUM(CASE WHEN type='error' THEN 1 ELSE 0 END) AS error_count,
      ${frustrationCountField},
      SUM(CASE WHEN type!='null' THEN 1 ELSE 0 END) AS events,
      ${geoFields}
      session_id
    FROM "_rumdata"
    WHERE ${whereClause}
    GROUP BY session_id
    ORDER BY zo_sql_timestamp DESC
    LIMIT ${sessionState.data.resultGrid.size}`;
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
      const hits = res.data.hits;

      if (hits.length === 0) {
        rows.value = [];
        return;
      }

      // Store all session data from _rumdata
      hits.forEach((hit: any) => {
        sessionState.data.sessions[hit.session_id] = {
          session_id: hit.session_id,
          zo_sql_timestamp: hit.zo_sql_timestamp,
          timestamp: hit.zo_sql_timestamp,
          type: hit.type,
          error_count: hit.error_count,
          frustration_count: hit.frustration_count || 0,
          user_email: hit.user_email,
          country: hit.country,
          city: hit.city,
          country_iso_code: hit.country_iso_code?.toLowerCase(),
        };
      });

      const sessionIds = hits.map((hit: any) => hit.session_id);

      // Query 2: Get start/end times from _sessionreplay
      getSessionTimeFromReplay(req, sessionIds);
    })
    .catch((err) => {
      rows.value = [];
      toast({
        message: err.response?.data?.message || "Error while fetching sessions",
        variant: "error",
      });
    })
    .finally(() => {
      isLoading.value.pop();
    });
};

// Query 2: Get start/end times from _sessionreplay for the sessions
const getSessionTimeFromReplay = (req: any, sessionIds: string[]) => {
  if (sessionIds.length === 0) {
    rows.value = [];
    isLoading.value.pop();
    return;
  }

  // Sanitize session IDs to prevent SQL injection
  // Only allow alphanumeric characters, hyphens, and underscores
  const sanitizedIds = sessionIds
    .filter((id) => /^[a-zA-Z0-9_-]+$/.test(id))
    .map((id) => id.replace(/'/g, "''")) // Escape single quotes
    .map((id) => `'${id}'`)
    .join(", ");

  if (!sanitizedIds) {
    rows.value = [];
    isLoading.value.pop();
    return;
  }

  const whereClause = `WHERE session_id IN (${sanitizedIds})`;

  req.query.sql = `
    SELECT
      min(start) as start_time,
      max(end) as end_time,
      min(user_agent_user_agent_family) as browser,
      min(user_agent_os_family) as os,
      min(ip) as ip,
      min(source) as source,
      session_id
    FROM "_sessionreplay"
    ${whereClause}
    GROUP BY session_id`;

  isLoading.value.push(true);
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
      res.data.hits.forEach((hit: any) => {
        if (sessionState.data.sessions[hit.session_id]) {
          sessionState.data.sessions[hit.session_id].start_time =
            hit.start_time;
          sessionState.data.sessions[hit.session_id].end_time = hit.end_time;
          sessionState.data.sessions[hit.session_id].browser = hit.browser;
          sessionState.data.sessions[hit.session_id].os = hit.os;
          sessionState.data.sessions[hit.session_id].ip = hit.ip;
          sessionState.data.sessions[hit.session_id].source = hit.source;
          sessionState.data.sessions[hit.session_id].time_spent =
            hit.end_time - hit.start_time;
        }
      });
      rows.value = Object.values(sessionState.data.sessions);
    })
    .catch((err) => {
      toast({
        message:
          err.response?.data?.message ||
          "Error while fetching session replay data",
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
      : sessionState.data.datetime.relativeTimePeriod,
    valueType: date.relativeTimePeriod ? "relative" : "absolute",
  };
  sessionState.data.datetime = dateTime.value;
  if (date.valueType === "relative" && isMounted.value) getSessions();
};

const splitterModel = ref(250);

const rows = ref<Session[]>([]);

const tableRows = computed(() => rows.value);

const router = useRouter();

const handleRowClick = (row: any) => {
  if (!row.session_id) return;
  handleCellClick({ columnName: "action_play", row });
};

const handleScrollEnd = () => {
  if (!isLoading.value.length) {
    const totalFetchedSessions = Object.keys(sessionState.data.sessions).length;
    if (totalFetchedSessions > 0 && totalFetchedSessions % sessionState.data.resultGrid.size === 0) {
      sessionState.data.resultGrid.currentPage++;
      // getSessions();
    }
  }
};

const handleCellClick = (payload: any) => {
  if (payload.columnName !== "action_play") return;
  sessionState.data.selectedSession =
    sessionState.data.sessions[payload.row.session_id];
  router.push({
    name: "SessionViewer",
    params: { id: payload.row.session_id },
    query: {
      start_time: payload.row.start_time * 1000,
      end_time: payload.row.end_time * 1000,
    },
  });
};

const handleSidebarEvent = (event: string, value: any) => {
  if (event === "add-field") {
    sessionState.data.editorValue = applyFilterTerm(
      value,
      sessionState.data.editorValue,
    );
  } else if (event === "remove-field") {
    sessionState.data.editorValue = removeFieldCondition(
      sessionState.data.editorValue,
      value,
    );
  }
};

const getFormattedDate = (timestamp: number) =>
  formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");

const runQuery = () => {
  sessionState.data.resultGrid.currentPage = 0;
  sessionState.data.sessions = {};
  if (dateTime.value.valueType === "relative") {
    const newDate = getConsumableRelativeTime(
      dateTime.value.relativeTimePeriod,
    );

    if (newDate?.startTime && newDate?.endTime) {
      dateTime.value.startTime = newDate?.startTime;
      dateTime.value.endTime = newDate?.endTime;
    }
  }

  getSessions();
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
    sessionState.data.datetime = date;
  }

  if (queryParams.query) {
    sessionState.data.editorValue =
      b64DecodeUnicode(queryParams.query as string) || "";
  }
}

function updateUrlQueryParams() {
  if (!isMounted.value) return;

  const date = sessionState.data.datetime;
  const query: any = {};

  if (date.valueType == "relative") {
    query["period"] = date.relativeTimePeriod;
  } else {
    query["from"] = date.startTime;
    query["to"] = date.endTime;
  }

  query["query"] = b64EncodeUnicode(sessionState.data.editorValue);

  query["org_identifier"] = store.state.selectedOrganization.identifier;
  router.push({ query });
}

const getStarted = () => {
  router.push({
    name: "rumMonitoring",
  });
};
</script>
<style scoped lang="scss">
.sessions_page {
}
</style>
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
    height: 100%;
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
      border-radius: 0.1875rem 0.1875rem 0.1875rem 0.1875rem;
}
  }

  .app-table-container {
    .session-play-icon {
      .OIcon {
        &:hover {
          color: var(--q-primary);
        }
      }
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
