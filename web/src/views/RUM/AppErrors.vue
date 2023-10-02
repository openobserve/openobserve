<template>
  <div class="sessions_page">
    <div class="text-right q-py-sm flex align-center justify-between">
      <syntax-guide class="q-mr-sm" />
      <div class="flex align-center justify-end metrics-date-time q-mr-md">
        <date-time
          auto-apply
          :default-type="errorTrackingState.data.datetime.type"
          :default-absolute-time="{
            startTime: errorTrackingState.data.datetime.startTime,
            endTime: errorTrackingState.data.datetime.endTime,
          }"
          :default-relative-time="
            errorTrackingState.data.datetime.relativeTimePeriod
          "
          data-test="logs-search-bar-date-time-dropdown"
          class="q-mr-md"
          @on:date-change="updateDateChange"
        />
        <q-btn
          data-test="metrics-explorer-run-query-button"
          data-cy="metrics-explorer-run-query-button"
          dense
          flat
          title="Run query"
          class="q-pa-none search-button"
          @click="runQuery"
        >
          Run query
        </q-btn>
      </div>
    </div>
    <query-editor
      editorId="session-replay-query-editor"
      class="monaco-editor"
      v-model:query="errorTrackingState.data.editorValue"
      :debounce-time="300"
    />
    <q-splitter
      class="logs-horizontal-splitter full-height"
      v-model="splitterModel"
      unit="px"
      vertical
    >
      <template #before>
        <FieldList
          :fields="streamFields"
          :time-stamp="{
            startTime: dateTime.startTime,
            endTime: dateTime.endTime,
          }"
          :stream-name="errorTrackingState.data.stream.errorStream"
          @event-emitted="handleSidebarEvent"
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
        <template v-if="isLoading.length">
          <div
            class="q-pb-lg flex items-center justify-center text-center"
            style="height: calc(100vh - 200px)"
          >
            <div>
              <q-spinner-hourglass
                color="primary"
                size="40px"
                style="margin: 0 auto; display: block"
              />
              <div class="text-center full-width">
                Hold on tight, we're fetching your application errors.
              </div>
            </div>
          </div>
        </template>
        <AppTable
          v-else
          :columns="columns"
          :rows="errorTrackingState.data.errors"
          class="app-table-container"
          @event-emitted="handleTableEvent"
        >
          <template v-slot:error_details="slotProps">
            <ErrorDetail :column="slotProps.column.row" />
          </template>
        </AppTable>
      </template>
    </q-splitter>
  </div>
</template>

<script setup lang="ts">
interface SessionColumn {
  name: string;
  field: (row: any) => any;
  prop: (row: any) => any;
  label: string;
  align: string;
  sortable: boolean;
}

interface Session {
  timestamp: string;
  type: string;
  time_spent: string;
  error_count: string;
  initial_view_name: string;
  id: string;
}
import { h, onBeforeMount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { date } from "quasar";
import AppTable from "@/components/AppTable.vue";
import { formatDuration } from "@/utils/zincutils";
import IndexList from "@/plugins/traces/IndexList.vue";
import { useRouter } from "vue-router";
import ErrorDetail from "@/components/rum/ErrorDetail.vue";
import useErrorTracking from "@/composables/useErrorTracking";
import useQuery from "@/composables/useQuery";
import { useStore } from "vuex";
import searchService from "@/services/search";
import DateTime from "@/components/DateTime.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import { cloneDeep } from "lodash-es";
import streamService from "@/services/stream";
import FieldList from "@/components/common/sidebar/FieldList.vue";

const { t } = useI18n();
const dateTime = ref({
  startTime: 0,
  endTime: 0,
});
const streamFields = ref([]);
const splitterModel = ref(250);
const { getTimeInterval, buildQueryPayload, parseQuery } = useQuery();
const { errorTrackingState } = useErrorTracking();
const store = useStore();
const isLoading = ref([]);
const columns = ref([
  {
    name: "error",
    field: (row: any) => row["error"],
    prop: (row: any) => row["error"],
    label: "Error",
    align: "left",
    sortable: true,
    slot: true,
    slotName: "error_details",
  },
  {
    name: "events",
    field: (row: any) => row["events"],
    prop: (row: any) => row["events"],
    label: "Events",
    align: "left",
    sortable: true,
  },
  {
    name: "initial_view_name",
    field: (row: any) => row["view_url"],
    prop: (row: any) => row["view_url"],
    label: "View Url",
    align: "left",
    sortable: true,
  },
]);

const rows = ref<Session[]>([]);
const router = useRouter();

onBeforeMount(async () => {
  await getStreamFields();
});

const handleSidebarEvent = (event, value) => {
  if (event === "add-field") {
    if (errorTrackingState.data.editorValue.length) {
      errorTrackingState.data.editorValue += " and " + value;
    } else {
      errorTrackingState.data.editorValue += value;
    }
  }
};

const getStreamFields = () => {
  isLoading.value.push(true);
  return new Promise((resolve) => {
    streamService
      .schema(
        store.state.selectedOrganization.identifier,
        errorTrackingState.data.stream.errorStream,
        "logs"
      )
      .then((res) => {
        streamFields.value = res.data.schema.map((field: any) => ({
          ...field,
          showValues: true,
        }));
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
    dateTime.value.endTime
  );
  const parsedQuery = parseQuery(errorTrackingState.data.editorValue, false);
  const queryPayload = {
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

  req.query.sql = `select min(${
    store.state.zoConfig.timestamp_column
  }) as zo_sql_timestamp, error_type, error_message, service, MIN(
        CASE
            WHEN error_stack IS NOT NULL THEN error_stack
            ELSE error_handling_stack
        END
    ) AS error_stack, COUNT(*) as events, error_handling, min(error_id) as error_id, min(view_url) as view_url, min(session_id) as session_id from '_rumdata' ${
      errorTrackingState.data.editorValue.length
        ? " where type='error' and " + errorTrackingState.data.editorValue
        : " where type='error' "
    } group by error_type, error_message, service, error_stack, error_handling order by zo_sql_timestamp DESC`;
  req.query.sql_mode = "full";
  delete req.aggs;
  isLoading.value.push(true);
  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query: req,
      page_type: "logs",
    })
    .then((res) => {
      errorTrackingState.data.errors = res.data.hits;
    })
    .finally(() => isLoading.value.pop());
};

const updateDateChange = (date) => {
  dateTime.value = date;
  errorTrackingState.data.datetime = date;
  if (!isLoading.value.length) getErrorLogs();
};

const runQuery = () => {
  errorTrackingState.data.resultGrid.currentPage = 0;
  errorTrackingState.data.errors = {};
  getErrorLogs();
};

const handleErrorTypeClick = (payload) => {
  errorTrackingState.data.selectedError = cloneDeep(payload.row);
  router.push({
    name: "ErrorViewer",
    params: { id: payload.row.error_id },
    query: {
      timestamp: payload.row.zo_sql_timestamp,
    },
  });
};

const handleTableEvent = (event, payload) => {
  const eventMapping = {
    "cell-click": handleErrorTypeClick,
  };
  eventMapping[event](payload);
};
</script>

<style scoped lang="scss">
.sessions_page {
  .monaco-editor {
    height: 80px !important;
  }
}

.app-table-container {
  height: calc(100vh - 224px) !important;
}
</style>
<style lang="scss">
.sessions_page {
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

  .search-button {
    width: 96px;
    line-height: 29px;
    font-weight: bold;
    text-transform: initial;
    font-size: 11px;
    color: white;

    .q-btn__content {
      background: $secondary;
      border-radius: 3px 3px 3px 3px;

      .q-icon {
        font-size: 15px;
        color: #ffffff;
      }
    }
  }
}
</style>
