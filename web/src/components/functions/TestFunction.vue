<template>
  <div class="tw-flex tw-items-center tw-pb-3">
    <span class="tw-text-[16px]">Test Function on</span>
    <app-tabs
      class="test-function-option-tabs tw-border tw-text-gray-700 tw-border-gray-300 tw-w-max tw-ml-2"
      style="border-radius: 4px; overflow: hidden"
      data-test="test-function-option-tabs"
      :tabs="tabs"
      :active-tab="activeTab"
      @update:active-tab="updateActiveTab"
    />
  </div>
  <div
    v-if="activeTab === 'stream'"
    class="tw-flex tw-items-center tw-flex-wrap q-pb-sm"
  >
    <div class="function-stream-select-input tw-w-[35%] q-pr-md">
      <div class="tw-text-[12px] tw-text-gray-700">
        {{ t("alerts.streamType") + " *" }}
      </div>
      <q-select
        v-model="selectedStream.type"
        :options="streamTypes"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-xs showLabelOnTop no-case"
        emit-value
        stack-label
        outlined
        filled
        dense
        @update:model-value="updateStreams()"
        style="min-width: 120px"
      />
    </div>
    <div class="functions-duration-input tw-w-[65%]">
      <div class="tw-text-[12px] tw-text-gray-700">
        {{ t("common.duration") + " *" }}
      </div>
      <DateTime label="Start Time" class="q-py-sm tw-w-full" />
    </div>
    <div class="function-stream-select-input tw-w-[100%]">
      <div class="tw-text-[12px] tw-text-gray-700">
        {{ t("alerts.stream_name") + " *" }}
      </div>
      <q-select
        v-model="selectedStream.name"
        :options="streams"
        :popup-content-style="{ textTransform: 'lowercase' }"
        color="input-border"
        bg-color="input-bg"
        class="q-py-xs showLabelOnTop no-case"
        stack-label
        outlined
        filled
        dense
        :loading="isFetchingStreams"
        style="min-width: 120px"
        @filter="filterStreams"
        @update:model-value="updateQuery"
      />
    </div>

    <div class="test-function-query-container tw-w-[100%] tw-mt-1">
      <FullViewContainer
        name="function"
        v-model:is-expanded="expandState.query"
        :label="t('common.query') + '*'"
      >
        <template #left>
          <q-icon
            v-if="!!sqlQueryErrorMsg"
            name="info"
            class="tw-text-red-600 tw-mx-1 tw-cursor-pointer"
            size="16px"
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              :offset="[10, 10]"
            >
              {{ sqlQueryErrorMsg }}
            </q-tooltip>
          </q-icon>
        </template>
        <template #right>
          <q-btn
            :label="t('search.runQuery')"
            class="test-function-run-query-btn text-bold tw-ml-[12px] no-border"
            padding="sm md"
            icon="search"
            no-caps
            dense
            size="xs"
            color="primary"
            @click="getResults"
          />
        </template>
      </FullViewContainer>
      <div
        v-show="expandState.query"
        class="tw-border-[1px] tw-border-gray-200 tw-relative"
      >
        <query-editor
          data-test="vrl-function-test-sql-editor"
          ref="queryEditorRef"
          editor-id="test-function-query-input-editor"
          class="monaco-editor"
          v-model:query="inputQuery"
          language="sql"
        />
        <div class="text-negative q-pa-xs invalid-sql-error tw-min-h-[22px]">
          <span v-show="!!sqlQueryErrorMsg" class="tw-text-[13px]">
            Error: {{ sqlQueryErrorMsg }}</span
          >
        </div>
      </div>
    </div>
  </div>
  <div>
    <div>
      <FullViewContainer
        name="function"
        v-model:is-expanded="expandState.events"
        :label="t('common.events')"
      />
      <div
        v-show="expandState.events"
        class="tw-border-[1px] tw-border-gray-200 tw-relative"
      >
        <div
          v-if="activeTab === 'stream' && !inputEvents"
          class="tw-absolute tw-z-10 tw-flex tw-flex-col tw-justify-center tw-items-center tw-w-full tw-h-full tw-bg-white tw-opacity-90"
        >
          <q-icon
            :name="outlinedLightbulb"
            size="40px"
            class="tw-text-orange-400"
          />
          <div class="tw-text-[15px] tw-text-gray-600">
            {{ eventsMessage }}
          </div>
        </div>
        <query-editor
          data-test="vrl-function-test-events-editor"
          ref="eventsEditorRef"
          editor-id="test-function-events-input-editor"
          class="monaco-editor"
          v-model:query="inputEvents"
          language="json"
        />
      </div>
    </div>
    <div class="q-mt-sm">
      <FullViewContainer
        name="function"
        v-model:is-expanded="expandState.output"
        :label="t('common.output')"
      />

      <div
        v-show="expandState.output"
        class="tw-border-[1px] tw-border-gray-200 tw-relative"
      >
        <div
          v-if="!outputEvents"
          class="tw-absolute tw-z-10 tw-flex tw-flex-col tw-justify-center tw-items-center tw-w-full tw-h-full tw-bg-white tw-opacity-90"
        >
          <q-icon
            :name="outlinedLightbulb"
            size="40px"
            class="tw-text-orange-400"
          />
          <div class="tw-text-[15px] tw-text-gray-600">
            {{ outputMessage }}
          </div>
        </div>
        <pre class="test-output-container tw-p-2 tw-text-sm tw-text-gray-600">{{
          outputEvents
        }}</pre>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeMount, ref, defineProps, defineExpose, computed } from "vue";
import { useI18n } from "vue-i18n";
import QueryEditor from "@/components/QueryEditor.vue";
import DateTime from "@/components/DateTime.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import useStreams from "@/composables/useStreams";
import { outlinedLightbulb } from "@quasar/extras/material-icons-outlined";
import useQuery from "@/composables/useQuery";
import { b64EncodeUnicode } from "@/utils/zincutils";
import searchService from "@/services/search";
import { useStore } from "vuex";
import { event, useQuasar } from "quasar";
import { getConsumableRelativeTime } from "@/utils/date";
import AppTabs from "@/components/common/AppTabs.vue";

const inputQuery = ref<string>("");
const inputEvents = ref<string>("");
const outputEvents = ref<string>("");

const queryEditorRef = ref<InstanceType<typeof QueryEditor>>();

const eventsEditorRef = ref<InstanceType<typeof QueryEditor>>();

const dateTime = ref<any>({});

const tabs = [
  { label: "Stream/Query", value: "stream" },
  { label: "Data", value: "data" },
];

const activeTab = ref("stream");

const selectedStream = ref<{
  name: string;
  type: "logs" | "metrics" | "traces";
}>({ name: "", type: "logs" });

const { getStreams } = useStreams();

const { buildQueryPayload } = useQuery();

const streamTypes = [
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
];

const isFetchingStreams = ref(false);

const store = useStore();

let parser: any = null;

const { t } = useI18n();

const expandState = ref({
  functions: true,
  query: false,
  events: false,
  output: false,
});

const filteredStreams = ref<any[]>([]);

const sqlQueryErrorMsg = ref<string>("");

const q = useQuasar();

const streams = ref([]);

onBeforeMount(async () => {
  await importSqlParser();
  await updateStreams();
});

const eventsMessage = computed(() => {
  if (activeTab.value === "stream" && !selectedStream.value.name) {
    return "Please select a stream and Run Query to see the events";
  }

  if (activeTab.value === "stream" && !inputQuery.value) {
    return "Please enter Query and click Run Query to see the events";
  }

  if (activeTab.value === "stream" && !inputEvents.value) {
    return "Click Run Query to see the events";
  }

  return "";
});

const outputMessage = computed(() => {
  if (activeTab.value === "stream" && eventsMessage.value) {
    return eventsMessage.value;
  }

  if (!outputEvents.value) {
    return "Please click Test Function to see the events";
  }

  return "";
});

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

const filterStreams = (val: string, update: any) => {
  filteredStreams.value = filterColumns(streams.value, val, update);
};

const filterColumns = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
    return filteredOptions;
  }
  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter(
      (column: any) => column.toLowerCase().indexOf(value) > -1,
    );
  });
  return filteredOptions;
};

const updateQuery = () => {
  inputQuery.value = `SELECT * FROM "${selectedStream.value.name}"`;
  expandState.value.query = true;
};

const updateStreams = async (resetStream = true) => {
  if (resetStream) selectedStream.value.name = "";

  if (!selectedStream.value.type) return Promise.resolve();

  isFetchingStreams.value = true;
  return getStreams(selectedStream.value.type, false)
    .then((res: any) => {
      console.log("selectedStreams", res.list);

      streams.value = res.list.map((data: any) => {
        return data.name;
      });

      return Promise.resolve();
    })
    .catch(() => Promise.reject())
    .finally(() => (isFetchingStreams.value = false));
};

const getResults = async () => {
  const timestamps: any =
    dateTime.value.type === "relative"
      ? getConsumableRelativeTime(dateTime.value.relativeTimePeriod)
      : dateTime.value;

  const query = buildQueryPayload({
    sqlMode: true,
    streamName: selectedStream.value.name,
    timestamps,
  });

  delete query.aggs;

  // We get 15 minutes time range for the query, so reducing it by 13 minutes to get 2 minute data
  query.query.start_time = query.query.start_time + 780000000;

  // TODO: Handle the edge case when user enters limit in the query
  query.query.sql = inputQuery.value;

  query.query.from = 0;
  query.query.size = 10;

  console.log("query", query);

  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query,
      page_type: "logs",
    })
    .then((res: any) => {
      expandState.value.events = true;
      inputEvents.value = JSON.stringify(res.data.hits, null, 2);
      sqlQueryErrorMsg.value = "";
    })
    .catch((err: any) => {
      sqlQueryErrorMsg.value = err.response?.data?.message
        ? err.response?.data?.message
        : "Invalid SQL Query";

      // Show error only if it is not real time alert
      // This case happens when user enters invalid query and then switches to real time alert
      q.notify({
        type: "negative",
        message: "Invalid SQL Query : " + err.response?.data?.message,
        timeout: 3000,
      });
    });
};

const updateActiveTab = (tab: string) => {
  activeTab.value = tab;
  if (tab === "data" && !inputEvents.value) {
    expandState.value.events = true;
    inputEvents.value = JSON.stringify(JSON.parse(JSON.stringify([])));
  }
};

defineExpose({
  getResults,
});
</script>

<style lang="scss" scoped>
.monaco-editor,
.test-output-container {
  width: 100%;
  min-height: 15rem;
  border-radius: 5px;
}

.test-function-option-tabs {
  :deep(.rum-tab) {
    width: auto !important;
    font-size: 12px;
    padding: 4px 12px;
    border: none !important;
  }

  :deep(.active) {
    background-color: $primary !important;
    color: white !important;
  }
}
.test-function-query-container {
  :deep(.test-function-run-query-btn) {
    padding: 2px 8px !important;
    font-size: 11px !important;
    margin: 1px 2px !important;

    .q-icon {
      margin-right: 4px !important;
      font-size: 13px;
    }
  }
}

.function-stream-select-input {
  :deep(.q-field--auto-height .q-field__control) {
    height: 32px;
    min-height: auto;

    .q-field__control-container {
      height: 32px;

      .q-field__native {
        min-height: 32px !important;
        height: 32px !important;
      }
    }

    .q-field__marginal {
      height: 32px;
      min-height: auto;
    }
  }
}

.functions-duration-input {
  :deep(.date-time-button) {
    width: 100%;

    .q-icon.on-right {
      margin-left: auto;
    }
  }
}
</style>
