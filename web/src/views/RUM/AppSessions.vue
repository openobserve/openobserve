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

<template>
  <div class="sessions_page">
    <template v-if="isSessionReplayEnabled">
      <div class="tw:pb-[0.625rem] tw:px-[0.625rem]">
        <div class="card-container">
          <div
            class="text-right tw:p-[0.375rem] flex align-center justify-between"
          >
            <syntax-guide />
            <div class="flex align-center justify-end metrics-date-time">
              <date-time
                auto-apply
                :default-type="sessionState.data.datetime.valueType"
                :default-absolute-time="{
                  startTime: sessionState.data.datetime.startTime,
                  endTime: sessionState.data.datetime.endTime,
                }"
                :default-relative-time="
                  sessionState.data.datetime.relativeTimePeriod
                "
                data-test="logs-search-bar-date-time-dropdown"
                class="q-mr-sm"
                @on:date-change="updateDateChange"
              />
              <q-btn
                data-test="metrics-explorer-run-query-button"
                data-cy="metrics-explorer-run-query-button"
                dense
                :title="t('metrics.runQuery')"
                class="q-pa-none tw:mr-none! o2-run-query-button o2-color-primary tw:h-[33px] element-box-shadow"
                @click="runQuery"
                no-caps
              >
                {{ t("metrics.runQuery") }}
              </q-btn>
            </div>
          </div>
          <div class="tw:pb-[0.375rem] tw:px-[0.375rem]">
            <query-editor
              editor-id="session-replay-query-editor"
              class="monaco-editor tw:border tw:solid tw:border-[var(--o2-border-color)] tw:p-[0.25rem] tw:rounded-[0.375rem] tw:overflow-hidden tw:h-[4rem]"
              v-model:query="sessionState.data.editorValue"
              :debounce-time="300"
            />
          </div>
        </div>
      </div>
      <q-splitter
        class="tw:pl-[0.625rem]! tw:h-[calc(100%-8.125rem)]"
        v-model="splitterModel"
        unit="px"
        vertical
      >
        <template #before>
          <div class="card-container tw:p-[0.325rem] tw:h-full">
            <FieldList
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
          <div class="tw:pr-[0.625rem] tw:h-full">
            <div class="card-container tw:h-full">
              <template v-if="isLoading.length">
                <div
                  class="q-pb-lg flex items-center justify-center text-center tw:h-full"
                >
                  <div>
                    <q-spinner-hourglass
                      color="primary"
                      size="2.5rem"
                      class="tw:mx-auto tw:block"
                    />
                    <div class="text-center full-width">
                      {{ t("rum.loadingSessions") }}
                    </div>
                  </div>
                </div>
              </template>
              <template v-else>
                <AppTable
                  :columns="columns"
                  :rows="rows"
                  class="app-table-container tw:h-full"
                  :bordered="false"
                  @event-emitted="handleTableEvents"
                  data-test="rum-sessions-table"
                >
                  <template v-slot:frustration_count_column="slotProps">
                    <FrustrationBadge
                      :count="slotProps.column.row.frustration_count || 0"
                    />
                  </template>
                  <template v-slot:session_location_column="slotProps">
                    <SessionLocationColumn :column="slotProps.column.row" />
                  </template>
                </AppTable>
              </template>
            </div>
          </div>
        </template>
      </q-splitter>
    </template>
    <template v-else>
      <div class="tw:pb-[0.625rem] tw:px-[0.625rem]">
        <div class="card-container">
          <div class="q-pa-lg enable-rum tw:max-w-[64rem]">
            <div class="q-pb-lg">
              <div class="text-left text-h6 text-bold q-pb-md">
                {{ t("rum.discoverSessionTitle") }}
              </div>
              <div class="text-subtitle1">
                {{ t("rum.discoverSessionMessage") }}
              </div>
              <div>
                <div></div>
              </div>
            </div>
            <q-btn
              class="bg-primary rounded text-white"
              no-caps
              :title="t('common.getStartedRUM')"
              @click="getStarted"
            >
              {{ t("common.getStarted") }}
            </q-btn>
          </div>
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
import { useI18n } from "vue-i18n";
import AppTable from "@/components/rum/AppTable.vue";
import {
  formatDuration,
  b64DecodeUnicode,
  b64EncodeUnicode,
} from "@/utils/zincutils";
import FieldList from "@/components/common/sidebar/FieldList.vue";
import { onBeforeRouteUpdate, useRouter } from "vue-router";
import { useStore } from "vuex";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { date, useQuasar } from "quasar";
import useSession from "@/composables/useSessionReplay";
import DateTime from "@/components/DateTime.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import SessionLocationColumn from "@/components/rum/sessionReplay/SessionLocationColumn.vue";
import FrustrationBadge from "@/components/rum/FrustrationBadge.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import useStreams from "@/composables/useStreams";

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

const q = useQuasar();

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

const isMounted = ref(false);

const schemaMapping: Ref<{ [key: string]: boolean }> = ref({});
const { getStream } = useStreams();

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
]);

const columns = ref([
  {
    name: "action_play",
    field: "",
    label: "",
    type: "action",
    icon: "play_circle_filled",
    class: "session-play-icon",
    style: { width: "3.5rem" },
  },
  {
    name: "timestamp",
    field: (row: any) => getFormattedDate(row["timestamp"] / 1000),
    label: t("rum.timestamp"),
    align: "left",
    sortable: true,
  },
  {
    name: "user_email",
    field: (row: any) => row["user_email"] || "Unknown",
    label: t("login.userEmail"),
    align: "left",
    sortable: true,
  },
  {
    name: "time_spent",
    field: (row: any) => formatDuration(row["time_spent"]),
    label: t("rum.timeSpent"),
    align: "left",
    sortable: true,
    sort: (a: any, b: any, rowA: Session, rowB: Session) => {
      return (
        parseInt(rowA.time_spent.toString()) -
        parseInt(rowB.time_spent.toString())
      );
    },
  },
  {
    name: "error_count",
    field: (row: any) => row["error_count"],
    prop: (row: any) => row["error_count"],
    label: t("rum.errorCount"),
    align: "left",
    sortable: true,
  },
  {
    name: "frustration_count",
    field: (row: any) => row["frustration_count"] || 0,
    prop: (row: any) => row["frustration_count"] || 0,
    label: t("rum.frustrationCount"),
    align: "left",
    sortable: true,
    slot: true,
    slotName: "frustration_count_column",
  },
  {
    name: "location",
    field: (row: any) => formatDuration(row["time_spent"]),
    label: t("rum.location"),
    align: "left",
    slot: true,
    slotName: "session_location_column",
    sortable: true,
    sort: (a: any, b: any, rowA: Session, rowB: Session) => {
      return (
        parseInt(rowA.time_spent.toString()) -
        parseInt(rowB.time_spent.toString())
      );
    },
  },
]);

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
          "session_id",
          "env",
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
      q.notify({
        message: err.response?.data?.message || "Error while fetching sessions",
        color: "negative",
        position: "bottom",
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

  const whereClause = `WHERE session_id IN (${sessionIds.map((id) => `'${id}'`).join(", ")})`;

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
      q.notify({
        message:
          err.response?.data?.message ||
          "Error while fetching session replay data",
        position: "bottom",
        color: "negative",
        timeout: 4000,
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
const router = useRouter();

const handleTableEvents = (event: string, payload: any) => {
  const eventMapping: { [key: string]: (payload: any) => void } = {
    "cell-click": handleCellClick,
    scroll: handleScroll,
  };
  eventMapping[event](payload);
};

const handleScroll = (scrollData: any) => {
  if (!isLoading.value.length) {
    const totalFetchedSessions = Object.keys(sessionState.data.sessions).length;
    if (totalFetchedSessions / scrollData.to < 1.3) {
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
    if (sessionState.data.editorValue.length) {
      sessionState.data.editorValue += " and " + value;
    } else {
      sessionState.data.editorValue += value;
    }
  }
};

const getFormattedDate = (timestamp: number) =>
  date.formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");

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

  .q-item__label span {
    /* text-transform: capitalize; */
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

      .q-icon {
        font-size: 0.9375rem;
        color: #ffffff;
      }
    }
  }

  .app-table-container {
    .session-play-icon {
      .q-icon {
        &:hover {
          color: var(--q-primary);
        }
      }
    }
  }
}
</style>
