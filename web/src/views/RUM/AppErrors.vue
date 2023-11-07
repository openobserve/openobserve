<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="sessions_page">
    <div class="text-right q-py-sm flex align-center justify-between">
      <syntax-guide class="q-mr-sm" />
      <div class="flex align-center justify-end metrics-date-time q-mr-md">
        <date-time
          auto-apply
          :default-type="errorTrackingState.data.datetime?.valueType"
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
      editor-id="rum-errors-query-editor"
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
import { nextTick, onBeforeMount, onMounted, ref, type Ref } from "vue";
import AppTable from "@/components/AppTable.vue";
import { b64DecodeUnicode, b64EncodeUnicode } from "@/utils/zincutils";
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
import { useI18n } from "vue-i18n";

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
const isLoading: Ref<true[]> = ref([]);
const isMounted = ref(false);
const columns = ref([
  {
    name: "error",
    field: (row: any) => row["error"],
    prop: (row: any) => row["error"],
    label: t("rum.error"),
    align: "left",
    sortable: true,
    slot: true,
    slotName: "error_details",
  },
  {
    name: "events",
    field: (row: any) => row["events"],
    prop: (row: any) => row["events"],
    label: t("rum.events"),
    align: "left",
    sortable: true,
  },
  {
    name: "initial_view_name",
    field: (row: any) => row["view_url"],
    prop: (row: any) => row["view_url"],
    label: t("rum.viewURL"),
    align: "left",
    sortable: true,
  },
]);

const router = useRouter();

onBeforeMount(() => {
  restoreUrlQueryParams();
});

onMounted(async () => {
  isMounted.value = true;
  await getStreamFields();
  updateUrlQueryParams();
});

const handleSidebarEvent = (event: string, value: any) => {
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

  req.query.sql = `select max(${
    store.state.zoConfig.timestamp_column
  }) as zo_sql_timestamp, type, error_message, service, MIN(CASE WHEN error_stack IS NOT NULL THEN error_stack ELSE error_handling_stack END ) AS error_stack, COUNT(*) as events, error_handling, max(error_id) as error_id, max(view_url) as view_url, max(session_id) as session_id from '_rumdata' where type='error'${
    errorTrackingState.data.editorValue.length
      ? " and " + errorTrackingState.data.editorValue
      : ""
  } GROUP BY type, error_message, service, error_stack, error_handling order by zo_sql_timestamp DESC`;

  req.query.sql.replace("\n", " ");
  req.query.sql_mode = "full";
  delete req.aggs;
  isLoading.value.push(true);

  updateUrlQueryParams();

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

const updateDateChange = (date: any) => {
  dateTime.value = date;
  errorTrackingState.data.datetime = date;
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
    params: { id: payload.row.error_id },
    query: {
      timestamp: payload.row.zo_sql_timestamp,
    },
  });
};

const handleTableEvent = (event: string, payload: any) => {
  const eventsToHandle = ["cell-click"];
  if (eventsToHandle.indexOf(event) === -1) return;

  const eventMapping: { [key: string]: (payload: any) => Promise<void> } = {
    "cell-click": handleErrorTypeClick,
  };
  eventMapping[event](payload);
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
