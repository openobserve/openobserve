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
  <div class="sessions_page flex min-h-0 flex-1 flex-col overflow-hidden">
    <template v-if="isSessionReplayEnabled">
      <div>
        <div class="bg-card-glass-bg border-border-default px-page-edge border-b py-1.5">
          <div class="flex items-start gap-1">
            <!-- Query editor (flex-grow to fill available space) -->
            <div class="relative min-w-0 flex-1">
              <QueryEditor
                ref="sessionQueryEditorRef"
                editor-id="session-replay-query-editor"
                :class="[
                  'border',
                  'solid',
                  'border-card-glass-border',
                  'p-1',
                  'rounded-default',
                  'overflow-y-auto',
                  queryEditorHeight,
                ]"
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
                class="query-editor-placeholder-overlay pointer-events-none absolute top-0 right-0 bottom-0 left-0 z-1 flex items-start pt-0.75 pr-2 pb-0 pl-[2.15rem] select-none"
              >
                <span class="query-editor-placeholder-typewriter">{{ editorPlaceholder }}</span>
              </div>
            </div>

            <!-- Controls on the right -->
            <div class="flex shrink-0 items-start gap-1">
              <SyntaxGuide />
              <DateTime
                auto-apply
                menu-align="end"
                :default-type="sessionState.data.datetime.valueType"
                :default-absolute-time="{
                  startTime: sessionState.data.datetime.startTime,
                  endTime: sessionState.data.datetime.endTime,
                }"
                :default-relative-time="sessionState.data.datetime.relativeTimePeriod"
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
                class="shrink-0"
              >
                {{ t("metrics.runQuery") }}
              </OButton>
              <OTableColumnToggle
                :columns="tableColumns"
                :column-visibility="columnVisibility"
                @update:column-visibility="setColumnVisibility"
              />
              <!-- Refresh button -->
              <OButton
                variant="outline"
                size="icon-toolbar"
                icon-left="refresh"
                :loading="isLoading.length > 0"
                data-test="rum-app-sessions-refresh-btn"
                class="shrink-0"
                @click="runQuery"
              >
                <OTooltip
                  side="bottom"
                  :content="t('common.refresh')"
                  shortcut-id="rumSessionsRefresh"
                />
              </OButton>
            </div>
            <!-- end controls -->
          </div>
          <!-- end flex row -->
        </div>
        <!-- end card-container -->
      </div>
      <!-- end toolbar wrapper -->

      <OSplitter
        class="logs-horizontal-splitter min-h-0 flex-1"
        v-model="splitterModel"
        unit="px"
        :horizontal="false"
      >
        <template #before>
          <div class="bg-surface-panel border-border-default h-full overflow-auto border-r py-1">
            <SearchFieldList
              :fields="streamFields"
              :time-stamp="{
                startTime: dateTime.startTime,
                endTime: dateTime.endTime,
              }"
              :stream-name="rumSessionStreamName"
              stream-type="logs"
              :enable-grouping="true"
              :query="completeQuery"
              :show-count="false"
              @event-emitted="handleSidebarEvent"
            />
          </div>
        </template>
        <template #after>
          <div class="flex h-full min-h-0 flex-col">
            <!-- KPI summary strip -->
            <div class="bg-card-glass-bg border-border-default border-b">
              <SessionsMetricsStrip
                :total="kpiMetrics.total"
                :error-sessions="kpiMetrics.errorSessions"
                :frustrated-sessions="kpiMetrics.frustratedSessions"
                :bounced-sessions="kpiMetrics.bouncedSessions"
                :bounce-base="kpiMetrics.bounceBase"
                :avg-duration-ms="kpiMetrics.avgDurationMs"
                :median-duration-ms="kpiMetrics.medianDurationMs"
                :sessions-delta-pct="kpiDeltas?.sessionsPct ?? null"
                :errors-delta="kpiDeltas?.errors ?? null"
                :frustrated-delta="kpiDeltas?.frustrated ?? null"
                :active-card="activeMetricCard"
                @select="handleMetricSelect"
              />

              <!-- One actionable insight for the current window, when one exists -->
              <div v-if="topInsight" class="px-page-edge pb-2">
                <SessionsInsightBanner
                  :insight="topInsight"
                  @apply="applyInsightFilter(topInsight)"
                  @filter="filterSessionsByInsightError(topInsight)"
                  @open-error-tracking="openInsightInErrorTracking(topInsight)"
                />
              </div>

              <!-- Segment filters -->
              <div
                class="px-page-edge flex flex-wrap items-center gap-4 pb-2"
                data-test="rum-app-sessions-segment-filters"
              >
                <OToggleGroup
                  :model-value="healthSegment"
                  type="single"
                  :label="t('rum.health')"
                  label-position="left"
                  @update:model-value="(v: any) => setHealthSegment(v)"
                >
                  <OToggleGroupItem value="all" size="xs" data-test="rum-app-sessions-health-all">{{
                    t("rum.all")
                  }}</OToggleGroupItem>
                  <OToggleGroupItem
                    value="errors"
                    size="xs"
                    data-test="rum-app-sessions-health-errors"
                    >{{ t("rum.withErrors") }} ·
                    {{ sessionsSummary.errorSessions }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="frustrated"
                    size="xs"
                    data-test="rum-app-sessions-health-frustrated"
                    >{{ t("rum.frustrated") }} ·
                    {{ sessionsSummary.frustratedSessions }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="clean"
                    size="xs"
                    data-test="rum-app-sessions-health-clean"
                    >{{ t("rum.clean") }} · {{ sessionsSummary.cleanSessions }}</OToggleGroupItem
                  >
                </OToggleGroup>

                <OToggleGroup
                  :model-value="typeSegment"
                  type="single"
                  :label="t('rum.type')"
                  label-position="left"
                  @update:model-value="(v: any) => setTypeSegment(v)"
                >
                  <OToggleGroupItem value="all" size="xs" data-test="rum-app-sessions-type-all">{{
                    t("rum.all")
                  }}</OToggleGroupItem>
                  <OToggleGroupItem
                    value="engaged"
                    size="xs"
                    data-test="rum-app-sessions-type-engaged"
                    >{{ t("rum.engaged") }} ·
                    {{ sessionsSummary.engagedSessions }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="bounced"
                    size="xs"
                    data-test="rum-app-sessions-type-bounced"
                    >{{ t("rum.bounced") }} ·
                    {{ sessionsSummary.bouncedSessions }}</OToggleGroupItem
                  >
                </OToggleGroup>

                <OToggleGroup
                  :model-value="deviceSegment"
                  type="single"
                  :label="t('rum.device')"
                  label-position="left"
                  @update:model-value="(v: any) => setDeviceSegment(v)"
                >
                  <OToggleGroupItem value="all" size="xs" data-test="rum-app-sessions-device-all">{{
                    t("rum.all")
                  }}</OToggleGroupItem>
                  <OToggleGroupItem
                    value="desktop"
                    size="xs"
                    data-test="rum-app-sessions-device-desktop"
                    >{{ t("rum.desktop") }} ·
                    {{ sessionsSummary.deviceCounts.desktop }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="mobile"
                    size="xs"
                    data-test="rum-app-sessions-device-mobile"
                    >{{ t("rum.mobile") }} ·
                    {{ sessionsSummary.deviceCounts.mobile }}</OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="tablet"
                    size="xs"
                    data-test="rum-app-sessions-device-tablet"
                    >{{ t("rum.tablet") }} ·
                    {{ sessionsSummary.deviceCounts.tablet }}</OToggleGroupItem
                  >
                </OToggleGroup>
              </div>
            </div>

            <div class="bg-card-glass-bg min-h-0 flex-1">
              <OTable
                :data="tableRows"
                :columns="tableColumns"
                :column-visibility="columnVisibility"
                :loading="isLoading.length > 0"
                row-key="session_id"
                pagination="none"
                virtual-scroll
                :dense="false"
                :row-height="54"
                class="h-full"
                data-test="rum-sessions-table"
                row-class="cursor-pointer"
                :get-row-status-color="getSessionStatusColor"
                @row-click="handleRowClick"
                @scroll-end="handleScrollEnd"
                :show-global-filter="false"
                :default-columns="false"
              >
                <template #empty>
                  <div
                    v-if="hasSegmentFilteredOutAllRows"
                    class="flex flex-col items-center gap-2 py-8"
                    data-test="rum-app-sessions-segment-empty"
                  >
                    <p>{{ t("rum.noMatchingSessions") }}</p>
                    <OButton
                      variant="outline"
                      size="sm"
                      data-test="rum-app-sessions-reset-segments-btn"
                      @click="resetSegments"
                    >
                      {{ t("rum.resetFilters") }}
                    </OButton>
                  </div>
                  <NoData v-else />
                </template>
                <template #cell-action_play>
                  <OIcon
                    name="play-circle-filled"
                    size="md"
                    class="session-play-icon text-icon-color hover:text-button-primary cursor-pointer"
                  />
                </template>
                <template #cell-session="{ row }">
                  <div class="flex min-w-0 flex-col justify-center gap-0.5">
                    <OUserCell :value="row.user_email || 'Unknown'" class="truncate font-medium" />
                    <div class="text-text-secondary flex items-center gap-1.5 text-xs">
                      <span
                        class="font-mono"
                        :title="row.session_id"
                        data-test="rum-app-sessions-session-id-text"
                        >{{ shortSessionId(row.session_id) }}</span
                      >
                      <span aria-hidden="true">·</span>
                      <OTimeCell
                        :value="row.zo_sql_timestamp"
                        unit="us"
                        :timezone="store.state.timezone"
                      />
                    </div>
                  </div>
                </template>
                <template #cell-activity="{ row }">
                  <SessionActivitySparkline
                    :session-id="row.session_id"
                    :start-time="row.start_time"
                    :end-time="row.end_time"
                    :is-bounce="row.is_bounce"
                    :has-frustration-field="!!schemaMapping['action_frustration_type']"
                  />
                </template>
                <template #cell-health="{ row }">
                  <SessionHealthCell
                    :error-count="row.error_count || 0"
                    :frustration-count="row.frustration_count || 0"
                  />
                </template>
                <template #cell-location="{ row }">
                  <SessionLocationColumn :column="row" />
                </template>
                <template #cell-duration="{ row }">
                  <div class="flex flex-col items-end gap-0.5">
                    <span class="font-medium tabular-nums">{{
                      formatSessionDuration(row.time_spent)
                    }}</span>
                    <small
                      v-if="row.is_bounce"
                      class="text-status-warning-text"
                      data-test="rum-app-sessions-bounced-text"
                      >{{ t("rum.bounced").toLowerCase() }}</small
                    >
                    <small
                      v-else-if="row.is_active"
                      class="text-status-success-text"
                      data-test="rum-app-sessions-active-text"
                      >{{ t("rum.active") }}</small
                    >
                  </div>
                </template>
              </OTable>
            </div>
          </div>
        </template>
      </OSplitter>
    </template>
    <template v-else>
      <div class="bg-card-glass-bg">
        <div class="enable-rum max-w-[64rem] p-4">
          <div class="pb-4">
            <div class="pb-3 text-left text-xl font-bold font-semibold">
              {{ t("rum.discoverSessionTitle") }}
            </div>
            <div class="text-base font-medium">
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
import { ref, onMounted, type Ref, onBeforeMount, defineAsyncComponent, computed } from "vue";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { rangesFromServerError, type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { durationFormatter, b64DecodeUnicode, b64EncodeUnicode } from "@/utils/zincutils";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import useSession from "@/composables/useSessionReplay";
import DateTime from "@/components/DateTime.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import SessionLocationColumn from "@/components/rum/sessionReplay/SessionLocationColumn.vue";
import SessionHealthCell from "@/components/rum/sessionReplay/SessionHealthCell.vue";
import SessionsMetricsStrip from "@/components/rum/sessionReplay/SessionsMetricsStrip.vue";
import SessionsInsightBanner from "@/components/rum/sessionReplay/SessionsInsightBanner.vue";
import SessionActivitySparkline from "@/components/rum/sessionReplay/SessionActivitySparkline.vue";
import { holdActivityQueries, releaseActivityQueries } from "@/composables/useSessionActivity";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import useStreams from "@/composables/useStreams";
import { applyFilterTerm, removeFieldCondition } from "@/utils/traces/filterUtils";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";

interface Session {
  timestamp: string;
  type: string;
  time_spent: number;
  error_count: string;
  frustration_count?: number;
  events?: number;
  end_time?: number;
  initial_view_name: string;
  id: string;
}

type HealthSegment = "all" | "errors" | "frustrated" | "clean";
type TypeSegment = "all" | "engaged" | "bounced";
type DeviceSegment = "all" | "desktop" | "mobile" | "tablet";

const HEALTH_SEGMENTS: HealthSegment[] = ["all", "errors", "frustrated", "clean"];
const TYPE_SEGMENTS: TypeSegment[] = ["all", "engaged", "bounced"];
const DEVICE_SEGMENTS: DeviceSegment[] = ["all", "desktop", "mobile", "tablet"];

interface WindowTotals {
  total: number;
  errorSessions: number;
  frustratedSessions: number;
  unhealthySessions: number;
}

interface SessionInsight {
  kind: "frustration" | "error" | "errorSpike";
  count: number;
  target?: string;
  view?: string;
  message?: string;
  rate?: number;
}

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

defineProps({
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
  if (lines === 1) return "h-8!";
  if (lines === 2) return "h-14!";
  return "h-20!"; // 3+ lines, capped at 5rem (approx 3 lines)
});

const isMounted = ref(false);
const editorFocused = ref(false);
const sessionQueryEditorRef = ref<any>(null);

// Server-error highlight ranges, forwarded to the filter editor by the composable.
const sqlErrorRanges = ref<SqlErrorRange[]>([]);

const {
  onFocus: _sqlOnFocus,
  onBlur: _sqlOnBlur,
  onQueryChange: _sqlOnQueryChange,
} = useSqlEditorDiagnostics({
  queryEditorRef: sessionQueryEditorRef,
  sqlMode: computed(() => false),
  query: computed(() => sessionState.data.editorValue ?? ""),
  streamName: computed(() => rumSessionStreamName),
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

const { columnVisibility, setColumnVisibility } = useExternalColumnToggle("rum-sessions-list");

const tableColumns = [
  {
    id: "action_play",
    header: "",
    accessorKey: "action_play",
    sortable: false,
    size: 56,
    meta: { align: "left" },
  },
  {
    id: "session",
    header: t("rum.userSession"),
    accessorFn: (row: any) => row["user_email"] || "Unknown",
    sortable: true,
    hideable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "activity",
    header: t("rum.activity"),
    accessorFn: (row: any) => row["events"] || 0,
    sortable: true,
    hideable: true,
    size: 220,
    meta: { align: "left" },
  },
  {
    id: "health",
    // Sorts by "badness": errors dominate, frustrations break ties.
    header: t("rum.health"),
    accessorFn: (row: any) => (row["error_count"] || 0) * 1000 + (row["frustration_count"] || 0),
    sortable: true,
    hideable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "location",
    header: t("rum.location"),
    accessorFn: (row: any) => row["country"] || "",
    sortable: true,
    hideable: true,
    size: 360,
    meta: { align: "left" },
  },
  {
    id: "duration",
    header: t("rum.duration"),
    accessorFn: (row: any) => row["time_spent"] || 0,
    sortable: true,
    hideable: true,
    size: COL.duration,
    meta: { align: "right" },
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
          // Frustration + insight fields — queries referencing them are only
          // built when the stream schema actually has them.
          "action_frustration_type",
          "action_target_name",
          "error_message",
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
        const priorityFieldsMap = new Map(priorityFields.map((field, index) => [field, index]));

        streamFields.value = [];

        stream.schema.forEach((field: any) => {
          if (fieldsToVerify.has(field.name)) schemaMapping.value[field.name] = field;

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
  sqlErrorRanges.value = [];

  const interval = getTimeInterval(dateTime.value.startTime, dateTime.value.endTime);
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

  // Activity sparklines are the lowest-priority calls — hold them until the
  // page query, replay query, and all window aggregates have settled.
  holdActivityQueries();

  // Window-level aggregates (KPI totals, deltas, insights) run in parallel
  // with the page query and share its WHERE clause + time range.
  const aggregatesSettled = fetchWindowAggregates(req, whereClause);

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

  const pageQuerySettled = searchService
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
          events: hit.events || 0,
          user_email: hit.user_email,
          country: hit.country,
          city: hit.city,
          country_iso_code: hit.country_iso_code?.toLowerCase(),
        };
      });

      const sessionIds = hits.map((hit: any) => hit.session_id);

      // Query 2: Get start/end times from _sessionreplay
      return getSessionTimeFromReplay(req, sessionIds);
    })
    .catch((err) => {
      rows.value = [];
      toast({
        message: err.response?.data?.message || "Error while fetching sessions",
        variant: "error",
      });

      // Locate the offending field in the filter and squiggle it in the editor.
      rangesFromServerError({
        code: err.response?.data?.code,
        message: err.response?.data?.message,
        errorDetail: err.response?.data?.error_detail,
        sqlMode: false,
        query: sessionState.data.editorValue,
        streamName: rumSessionStreamName,
      }).then((ranges) => {
        sqlErrorRanges.value = ranges;
      });
    })
    .finally(() => {
      isLoading.value.pop();
    });

  // Everything settled (success or failure) → let activity queries through.
  Promise.allSettled([pageQuerySettled, aggregatesSettled]).finally(() => {
    releaseActivityQueries();
  });
};

// Query 2: Get start/end times from _sessionreplay for the sessions
const getSessionTimeFromReplay = (req: any, sessionIds: string[]) => {
  if (sessionIds.length === 0) {
    rows.value = [];
    isLoading.value.pop();
    return Promise.resolve();
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
    return Promise.resolve();
  }

  const whereClause = `WHERE session_id IN (${sanitizedIds})`;

  req.query.sql = `
    SELECT
      min(start) as start_time,
      max(end) as end_time,
      min(user_agent_user_agent_family) as browser,
      min(user_agent_os_family) as os,
      min(user_agent_device_family) as device_family,
      min(ip) as ip,
      min(source) as source,
      session_id
    FROM "_sessionreplay"
    ${whereClause}
    GROUP BY session_id`;

  isLoading.value.push(true);
  return searchService
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
          sessionState.data.sessions[hit.session_id].start_time = hit.start_time;
          sessionState.data.sessions[hit.session_id].end_time = hit.end_time;
          sessionState.data.sessions[hit.session_id].browser = hit.browser;
          sessionState.data.sessions[hit.session_id].os = hit.os;
          sessionState.data.sessions[hit.session_id].device_family = hit.device_family;
          sessionState.data.sessions[hit.session_id].ip = hit.ip;
          sessionState.data.sessions[hit.session_id].source = hit.source;
          sessionState.data.sessions[hit.session_id].time_spent = hit.end_time - hit.start_time;
        }
      });
      rows.value = Object.values(sessionState.data.sessions);
    })
    .catch((err) => {
      toast({
        message: err.response?.data?.message || "Error while fetching session replay data",
        variant: "error",
      });
    })
    .finally(() => isLoading.value.pop());
};

// ── Window aggregates: KPI totals, previous-window deltas, insight clusters ──

const buildAggregateReq = (
  baseReq: any,
  sql: string,
  window?: { startTime: number; endTime: number },
) => {
  const clone = JSON.parse(JSON.stringify(baseReq));
  clone.query.sql = sql;
  clone.query.from = 0;
  clone.query.size = 10;
  delete clone.aggs;
  if (window) {
    clone.query.start_time = window.startTime;
    clone.query.end_time = window.endTime;
  }
  return clone;
};

const runAggregateQuery = (req: any) =>
  searchService
    .search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      },
      "RUM",
    )
    .then((res: any) => res.data?.hits || []);

// Returns a promise that settles when ALL aggregate queries finish — used to
// release the activity-sparkline gate so those queries go last.
const fetchWindowAggregates = (baseReq: any, whereClause: string) => {
  windowTotals.value = null;
  previousWindowTotals.value = null;
  frustrationCluster.value = null;
  errorCluster.value = null;

  const pending: Promise<unknown>[] = [];

  const hasFrustrationField = !!schemaMapping.value["action_frustration_type"];
  const frustratedSessionsExpr = hasFrustrationField
    ? "COUNT(DISTINCT CASE WHEN type='action' AND action_frustration_type IS NOT NULL THEN session_id END)"
    : "0";
  const unhealthyExpr = hasFrustrationField
    ? "COUNT(DISTINCT CASE WHEN type='error' OR (type='action' AND action_frustration_type IS NOT NULL) THEN session_id END)"
    : "COUNT(DISTINCT CASE WHEN type='error' THEN session_id END)";

  const summarySql = `
    SELECT
      COUNT(DISTINCT session_id) AS total,
      COUNT(DISTINCT CASE WHEN type='error' THEN session_id END) AS error_sessions,
      ${frustratedSessionsExpr} AS frustrated_sessions,
      ${unhealthyExpr} AS unhealthy_sessions
    FROM "_rumdata"
    WHERE ${whereClause}`;

  const toTotals = (hit: any): WindowTotals => ({
    total: hit?.total || 0,
    errorSessions: hit?.error_sessions || 0,
    frustratedSessions: hit?.frustrated_sessions || 0,
    unhealthySessions: hit?.unhealthy_sessions || 0,
  });

  pending.push(
    runAggregateQuery(buildAggregateReq(baseReq, summarySql))
      .then((hits) => {
        windowTotals.value = hits.length ? toTotals(hits[0]) : null;
      })
      .catch(() => {
        windowTotals.value = null;
      }),
  );

  const windowLengthUs = baseReq.query.end_time - baseReq.query.start_time;
  if (windowLengthUs > 0) {
    pending.push(
      runAggregateQuery(
        buildAggregateReq(baseReq, summarySql, {
          startTime: baseReq.query.start_time - windowLengthUs,
          endTime: baseReq.query.start_time,
        }),
      )
        .then((hits) => {
          previousWindowTotals.value = hits.length ? toTotals(hits[0]) : null;
        })
        .catch(() => {
          previousWindowTotals.value = null;
        }),
    );
  }

  if (hasFrustrationField && schemaMapping.value["action_target_name"]) {
    const clusterSql = `
      SELECT
        action_target_name AS target,
        MIN(view_url) AS view,
        COUNT(DISTINCT session_id) AS sessions_count
      FROM "_rumdata"
      WHERE ${whereClause}
        AND type='action'
        AND action_frustration_type IS NOT NULL
        AND action_target_name IS NOT NULL AND action_target_name != ''
      GROUP BY action_target_name
      ORDER BY sessions_count DESC
      LIMIT 1`;
    pending.push(
      runAggregateQuery(buildAggregateReq(baseReq, clusterSql))
        .then((hits) => {
          frustrationCluster.value = hits.length
            ? {
                kind: "frustration",
                count: hits[0].sessions_count || 0,
                target: hits[0].target,
                view: hits[0].view,
              }
            : null;
        })
        .catch(() => {
          frustrationCluster.value = null;
        }),
    );
  }

  if (schemaMapping.value["error_message"]) {
    const errorSql = `
      SELECT
        error_message AS message,
        COUNT(DISTINCT session_id) AS sessions_count
      FROM "_rumdata"
      WHERE ${whereClause}
        AND type='error'
        AND error_message IS NOT NULL AND error_message != ''
      GROUP BY error_message
      ORDER BY sessions_count DESC
      LIMIT 1`;
    pending.push(
      runAggregateQuery(buildAggregateReq(baseReq, errorSql))
        .then((hits) => {
          errorCluster.value = hits.length
            ? {
                kind: "error",
                count: hits[0].sessions_count || 0,
                message: hits[0].message,
              }
            : null;
        })
        .catch(() => {
          errorCluster.value = null;
        }),
    );
  }

  return Promise.allSettled(pending);
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

const healthSegment = ref<HealthSegment>("all");
const typeSegment = ref<TypeSegment>("all");
const deviceSegment = ref<DeviceSegment>("all");

// Window-level aggregates (no LIMIT) so the KPI strip reflects the true
// totals, not just the fetched page. Null until the summary query resolves.
const windowTotals = ref<WindowTotals | null>(null);
const previousWindowTotals = ref<WindowTotals | null>(null);
const frustrationCluster = ref<SessionInsight | null>(null);
const errorCluster = ref<SessionInsight | null>(null);

// A session with ≤1 event or under 10s of activity counts as a bounce; a
// session whose last replay event is within the last 5 minutes is still live.
const BOUNCE_MAX_MS = 10_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;

// Heuristic bucketing of the UA device/os family into the segment values.
const classifyDevice = (family?: string, os?: string): DeviceSegment => {
  const f = (family || "").toLowerCase();
  const o = (os || "").toLowerCase();
  if (f.includes("tablet") || f.includes("ipad")) return "tablet";
  if (f.includes("phone") || f.includes("mobile") || o === "ios" || o === "android")
    return "mobile";
  return "desktop";
};

const enrichedRows = computed(() =>
  rows.value.map((row: any) => ({
    ...row,
    is_bounce: (row.events ?? 0) <= 1 || (row.time_spent ?? 0) < BOUNCE_MAX_MS,
    is_active: !!row.end_time && Date.now() - row.end_time <= ACTIVE_WINDOW_MS,
    device_type: classifyDevice(row.device_family, row.os),
  })),
);

const sessionsSummary = computed(() => {
  const all = enrichedRows.value;
  const total = all.length;
  const durations = all
    .map((row: any) => row.time_spent || 0)
    .sort((a: number, b: number) => a - b);
  const errorSessions = all.filter((row: any) => (row.error_count || 0) > 0).length;
  const frustratedSessions = all.filter((row: any) => (row.frustration_count || 0) > 0).length;
  const cleanSessions = all.filter(
    (row: any) => !((row.error_count || 0) > 0) && !((row.frustration_count || 0) > 0),
  ).length;
  const bouncedSessions = all.filter((row: any) => row.is_bounce).length;
  const avgDurationMs = total
    ? durations.reduce((sum: number, d: number) => sum + d, 0) / total
    : 0;
  const mid = Math.floor(durations.length / 2);
  const medianDurationMs = !total
    ? 0
    : durations.length % 2
      ? durations[mid]
      : (durations[mid - 1] + durations[mid]) / 2;

  const deviceCounts = {
    desktop: all.filter((row: any) => row.device_type === "desktop").length,
    mobile: all.filter((row: any) => row.device_type === "mobile").length,
    tablet: all.filter((row: any) => row.device_type === "tablet").length,
  };

  return {
    total,
    errorSessions,
    frustratedSessions,
    cleanSessions,
    bouncedSessions,
    engagedSessions: total - bouncedSessions,
    avgDurationMs,
    medianDurationMs,
    deviceCounts,
  };
});

// KPI strip metrics — window-accurate totals when the summary query resolved,
// page-derived fallback otherwise. Duration/bounce stay page-scoped (they need
// per-session data that only exists for fetched rows).
const kpiMetrics = computed(() => ({
  total: windowTotals.value?.total ?? sessionsSummary.value.total,
  errorSessions: windowTotals.value?.errorSessions ?? sessionsSummary.value.errorSessions,
  frustratedSessions:
    windowTotals.value?.frustratedSessions ?? sessionsSummary.value.frustratedSessions,
  bouncedSessions: sessionsSummary.value.bouncedSessions,
  bounceBase: sessionsSummary.value.total,
  avgDurationMs: sessionsSummary.value.avgDurationMs,
  medianDurationMs: sessionsSummary.value.medianDurationMs,
}));

// Change vs the previous window of the same length. Null when the previous
// window has no sessions (a delta against nothing reads as noise).
const kpiDeltas = computed(() => {
  const current = windowTotals.value;
  const previous = previousWindowTotals.value;
  if (!current || !previous || previous.total === 0) return null;
  return {
    sessionsPct: ((current.total - previous.total) / previous.total) * 100,
    errors: current.errorSessions - previous.errorSessions,
    frustrated: current.frustratedSessions - previous.frustratedSessions,
  };
});

// One insight at a time, most actionable first: a frustration cluster beats an
// error cluster beats a rate spike. Hidden entirely when nothing clears the bar.
const MIN_CLUSTER_SESSIONS = 3;
const MIN_SPIKE_ERROR_SESSIONS = 5;

const topInsight = computed<SessionInsight | null>(() => {
  if (frustrationCluster.value && frustrationCluster.value.count >= MIN_CLUSTER_SESSIONS)
    return frustrationCluster.value;
  if (errorCluster.value && errorCluster.value.count >= MIN_CLUSTER_SESSIONS)
    return errorCluster.value;

  const current = windowTotals.value;
  const previous = previousWindowTotals.value;
  if (
    current &&
    previous &&
    previous.errorSessions > 0 &&
    current.errorSessions >= MIN_SPIKE_ERROR_SESSIONS &&
    current.errorSessions >= previous.errorSessions * 2
  ) {
    return {
      kind: "errorSpike",
      count: current.errorSessions,
      rate: Math.round((current.errorSessions / previous.errorSessions) * 10) / 10,
    };
  }
  return null;
});

const applyInsightFilter = (insight: SessionInsight) => {
  setHealthSegment(insight.kind === "frustration" ? "frustrated" : "errors");
};

const escapeSqlString = (value: string) => value.replace(/'/g, "''");

// Error cluster CTA: narrow the sessions query to THIS error — the health
// segment alone would show every error session, not the clustered one.
const filterSessionsByInsightError = (insight: SessionInsight) => {
  if (!insight.message) return;
  const condition = `error_message='${escapeSqlString(insight.message)}'`;
  const existing = sessionState.data.editorValue.trim();
  if (!existing.includes(condition)) {
    sessionState.data.editorValue = existing ? `${existing} AND ${condition}` : condition;
  }
  runQuery();
};

// Jump to Error Tracking pre-filtered to this error, carrying the time range.
const openInsightInErrorTracking = (insight: SessionInsight) => {
  const query: any = {
    org_identifier: store.state.selectedOrganization.identifier,
  };
  const date = sessionState.data.datetime;
  if (date.valueType === "relative" && date.relativeTimePeriod) {
    query.period = date.relativeTimePeriod;
  } else {
    query.from = date.startTime;
    query.to = date.endTime;
  }
  if (insight.message) {
    query.query = b64EncodeUnicode(`error_message='${escapeSqlString(insight.message)}'`);
  }
  router.push({ name: "ErrorTracking", query });
};

const tableRows = computed(() =>
  enrichedRows.value.filter((row: any) => {
    if (healthSegment.value === "errors" && !((row.error_count || 0) > 0)) return false;
    if (healthSegment.value === "frustrated" && !((row.frustration_count || 0) > 0)) return false;
    if (
      healthSegment.value === "clean" &&
      ((row.error_count || 0) > 0 || (row.frustration_count || 0) > 0)
    )
      return false;
    if (typeSegment.value === "bounced" && !row.is_bounce) return false;
    if (typeSegment.value === "engaged" && row.is_bounce) return false;
    if (deviceSegment.value !== "all" && row.device_type !== deviceSegment.value) return false;
    return true;
  }),
);

const hasSegmentFilteredOutAllRows = computed(
  () => rows.value.length > 0 && tableRows.value.length === 0,
);

const activeMetricCard = computed(() => {
  if (healthSegment.value === "errors") return "errors";
  if (healthSegment.value === "frustrated") return "frustrated";
  if (typeSegment.value === "bounced") return "bounced";
  return "";
});

const setHealthSegment = (value: HealthSegment | undefined | null) => {
  healthSegment.value = value && HEALTH_SEGMENTS.includes(value) ? value : "all";
  updateUrlQueryParams();
};

const setTypeSegment = (value: TypeSegment | undefined | null) => {
  typeSegment.value = value && TYPE_SEGMENTS.includes(value) ? value : "all";
  updateUrlQueryParams();
};

const setDeviceSegment = (value: DeviceSegment | undefined | null) => {
  deviceSegment.value = value && DEVICE_SEGMENTS.includes(value) ? value : "all";
  updateUrlQueryParams();
};

const resetSegments = () => {
  healthSegment.value = "all";
  typeSegment.value = "all";
  deviceSegment.value = "all";
  updateUrlQueryParams();
};

const handleMetricSelect = (card: string) => {
  if (card === "sessions") {
    resetSegments();
  } else if (card === "errors") {
    setHealthSegment(healthSegment.value === "errors" ? "all" : "errors");
  } else if (card === "frustrated") {
    setHealthSegment(healthSegment.value === "frustrated" ? "all" : "frustrated");
  } else if (card === "bounced") {
    setTypeSegment(typeSegment.value === "bounced" ? "all" : "bounced");
  }
};

const shortSessionId = (id?: string) => {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
};

const formatSessionDuration = (ms?: number) => {
  if (!ms || ms <= 0) return "0s";
  if (ms < 1000) return "<1s";
  return durationFormatter(Math.round(ms / 1000));
};

// Spine colors match the logs page severity colors (statusParser STATUS_COLORS)
// so "error red" reads the same across modules.
const getSessionStatusColor = (row: any) => {
  if ((row.error_count || 0) > 0) return "var(--color-severity-error-color)";
  if ((row.frustration_count || 0) > 0) return "var(--color-severity-warning-color)";
  return undefined;
};

const router = useRouter();

const handleRowClick = (row: any) => {
  if (!row.session_id) return;
  handleCellClick({ columnName: "action_play", row });
};

const handleScrollEnd = () => {
  if (!isLoading.value.length) {
    const totalFetchedSessions = Object.keys(sessionState.data.sessions).length;
    if (
      totalFetchedSessions > 0 &&
      totalFetchedSessions % sessionState.data.resultGrid.size === 0
    ) {
      sessionState.data.resultGrid.currentPage++;
      // getSessions();
    }
  }
};

const handleCellClick = (payload: any) => {
  if (payload.columnName !== "action_play") return;
  sessionState.data.selectedSession = sessionState.data.sessions[payload.row.session_id];
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
    sessionState.data.editorValue = applyFilterTerm(value, sessionState.data.editorValue);
  } else if (event === "remove-field") {
    sessionState.data.editorValue = removeFieldCondition(sessionState.data.editorValue, value);
  }
};

const runQuery = () => {
  sessionState.data.resultGrid.currentPage = 0;
  sessionState.data.sessions = {};
  if (dateTime.value.valueType === "relative") {
    const newDate = getConsumableRelativeTime(dateTime.value.relativeTimePeriod);

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
    sessionState.data.editorValue = b64DecodeUnicode(queryParams.query as string) || "";
  }

  if (queryParams.health && HEALTH_SEGMENTS.includes(queryParams.health as HealthSegment)) {
    healthSegment.value = queryParams.health as HealthSegment;
  }

  if (queryParams.session_type && TYPE_SEGMENTS.includes(queryParams.session_type as TypeSegment)) {
    typeSegment.value = queryParams.session_type as TypeSegment;
  }

  if (queryParams.device && DEVICE_SEGMENTS.includes(queryParams.device as DeviceSegment)) {
    deviceSegment.value = queryParams.device as DeviceSegment;
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

  if (healthSegment.value !== "all") query["health"] = healthSegment.value;
  if (typeSegment.value !== "all") query["session_type"] = typeSegment.value;
  if (deviceSegment.value !== "all") query["device"] = deviceSegment.value;

  query["org_identifier"] = store.state.selectedOrganization.identifier;
  router.push({ query });
}

const getStarted = () => {
  router.push({
    name: "rumMonitoring",
  });
};

useShortcuts([
  {
    id: "rumSessionsRefresh",
    handler: () => {
      if (!isInputFocused()) runQuery();
    },
  },
]);
</script>
