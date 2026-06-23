<template>
  <div
    data-test="test-function-section"
    class="tw:flex tw:items-center tw:flex-wrap tw:pb-2"
  >
    <div
      data-test="test-function-query-section"
      class="test-function-query-container tw:w-[100%]"
    >
      <FullViewContainer
          data-test="test-function-query-title-section"
          name="function"
          v-model:is-expanded="expandState.query"
          :label="t('common.query')"
        >
          <template #left>
            <OIcon
              v-if="!!sqlQueryErrorMsg"
              name="info-outline"
              class="tw:text-red-600 tw:mx-1 tw:cursor-pointer"
              size="sm"
            >
              <OTooltip
                side="right"
                align="center"
                :side-offset="10"
                :content="sqlQueryErrorMsg"
              />
            </OIcon>
          </template>
          <template #right>
            <OButton
              variant="primary"
              size="sm-action"
              :disabled="!selectedStream.name || !inputQuery || loading.events"
              @click="getResults"
            >
              <OIcon name="search" size="sm"  class="tw:mr-1" />
              {{ t('search.runQuery') }}
            </OButton>
          </template>
        </FullViewContainer>
        <div
          class="tw:flex tw:items-center tw:flex-wrap tw:py-2 tw:w-[100%]"
          :class="
            store.state.theme === 'dark' ? 'tw:bg-gray-950' : ' tw:bg-white'
          "
          v-show="expandState.query"
          data-test="test-function-query-editor-section"
        >
          <div class="function-stream-select-input tw:w-[120px] tw:pr-3">
            <div
              class="tw:text-[12px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-gray-200'
                  : 'tw:text-gray-700'
              "
            >
              {{ t("alerts.streamType") + " *" }}
            </div>

            <OSelect
              v-model="selectedStream.type"
              :options="streamTypes"
              labelKey="label"
              valueKey="value"
              @update:model-value="updateStreams()"
              style="width: 100px"
            />
          </div>
          <div class="function-stream-select-input tw:w-[300px]">
            <div
              class="tw:text-[12px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-gray-200'
                  : 'tw:text-gray-700'
              "
            >
              {{ t("alerts.stream_name") + " *" }}
            </div>
            <OSelect
              v-model="selectedStream.name"
              :options="filteredStreams"
              :loading="isFetchingStreams"
              :placeholder="t('pipeline.selectStream')"
              searchable
              style="min-width: 120px"
              @search="filterStreams"
              @update:model-value="updateQuery"
            />
          </div>
          <div class="functions-duration-input tw:w-[330px]">
            <div
              class="tw:text-[12px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-gray-200'
                  : 'tw:text-gray-700'
              "
            >
              {{ t("common.duration") + " *" }}
            </div>

            <DateTime
              label="Start Time"
              class="tw:py-1 tw:w-full"
              auto-apply
              :default-type="dateTime.type"
              :default-absolute-time="{
                startTime: dateTime.startTime,
                endTime: dateTime.endTime,
              }"
              :default-relative-time="dateTime.relativeTimePeriod"
              data-test="logs-search-bar-date-time-dropdown"
              @on:date-change="updateDateTime"
            />
          </div>

          <div
            class="tw:text-[12px] tw:w-[100%] tw:mt-1"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-200'
                : 'tw:text-gray-700'
            "
          >
            {{ t("common.query") + " *" }}
          </div>
          <div
            class="tw:border-[1px] tw:border-gray-200 tw:relative tw:w-[100%]"
          >
            <query-editor
              data-test="vrl-function-test-sql-editor"
              ref="queryEditorRef"
              editor-id="test-function-query-input-editor"
              class="monaco-editor"
              v-model:query="inputQuery"
              language="sql"
              :keywords="effectiveKeywords"
              :suggestions="effectiveSuggestions"
              @focus="onQueryEditorFocus"
              @blur="onQueryEditorBlur"
            />
            <div
              v-if="!inputQuery && queryEditorPlaceholderFlag"
              class="query-editor-placeholder-overlay"
            >
              <span class="query-editor-placeholder-typewriter">{{ queryEditorPlaceholder }}</span>
            </div>
            <div
              class="tw:text-red-500 tw:p-1 invalid-sql-error tw:min-h-[22px]"
            >
              <span v-show="!!sqlQueryErrorMsg" class="tw:text-[13px]">
                Error: {{ sqlQueryErrorMsg }}</span
              >
            </div>
          </div>
        </div>
    </div>
  </div>
  <div>
    <div>
      <FullViewContainer
        data-test="test-function-input-title-section"
        name="function"
        v-model:is-expanded="expandState.events"
        :label="t('common.events')"
        min-header-height="2.125rem"
      >
        <template #left>
          <div
            v-if="loading.events"
            class="text-weight-bold tw:flex tw:items-center tw:text-gray-500 tw:ml-2 tw:text-[13px]"
          >
            <OSpinner size="xs" />
            <div class="tw:relative tw:top-[2px]">
              {{ t("confirmDialog.loading") }}
            </div>
          </div>
          <OIcon
            v-if="!!eventsErrorMsg"
            name="info-outline"
            class="tw:text-red-600 tw:mx-1 tw:cursor-pointer"
            size="sm"
          >
            <OTooltip
              side="right"
              align="center"
              :side-offset="10"
              :content="eventsErrorMsg"
            />
          </OIcon>
        </template>
        <template #right>
           <!-- o2 ai context add button in the test function -->
           <O2AIContextAddBtn
            @send-to-ai-chat="sendToAiChat(JSON.stringify(inputEvents))"
            imageHeight="24px"
            imageWidth="24px"
            :class="'tw:px-2 tw:mr-4'"
            style="width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important;"
           />
          </template>
      </FullViewContainer>
      <div
        v-show="expandState.events"
        class="tw:border-[1px] tw:border-gray-200 tw:relative"
        data-test="test-function-input-editor-section"
      >
        <query-editor
          data-test="vrl-function-test-events-editor"
          ref="eventsEditorRef"
          editor-id="test-function-events-input-editor"
          class="monaco-editor test-function-input-editor"
          :style="{ height: `calc((100vh - (260px + ${heightOffset}px)) / 2)` }"
          v-model:query="inputEvents"
          language="json"
        />
      </div>
    </div>
    <div class="tw:mt-2">
      <FullViewContainer
        name="function"
        v-model:is-expanded="expandState.output"
        :label="t('common.output')"
        data-test="test-function-output-title-section"
        min-header-height="2.125rem"
      >
        <template #left>
          <div
            v-if="loading.output"
            class="tw:text-sm tw:font-medium text-weight-bold tw:flex tw:items-center tw:text-gray-500 tw:ml-2 tw:text-[13px]"
          >
            <OSpinner size="xs" />
            <div class="tw:relative tw:top-[2px]">
              {{ t("confirmDialog.loading") }}
            </div>
          </div>

          <OIcon
            v-if="!!outputEventsErrorMsg"
            name="info-outline"
            class="tw:text-red-600 tw:mx-1 tw:cursor-pointer"
            size="sm"
          >
            <OTooltip
              side="right"
              align="center"
              :side-offset="10"
              :content="outputEventsErrorMsg"
            />
          </OIcon>
        </template>
      </FullViewContainer>

      <div
        v-show="expandState.output"
        class="tw:border-[1px] tw:border-gray-200 tw:relative"
        data-test="test-function-output-editor-section"
      >
        <div
          v-if="!outputEvents"
          class="tw:absolute tw:z-10 tw:flex tw:flex-col tw:justify-center tw:items-center tw:w-full tw:h-full tw:opacity-90"
        >
          <OIcon
            name="lightbulb"
            size="xl"
            class="tw:text-orange-400"
          />
          <div
            class="tw:text-[15px] tw:text-gray-600"
            :class="
              store.state.theme === 'dark'
                ? 'tw:text-gray-200'
                : 'tw:text-gray-600'
            "
          >
            {{ outputMessage }}
          </div>
        </div>
        <query-editor
          data-test="vrl-function-test-events-output-editor"
          ref="outputEventsEditorRef"
          editor-id="test-function-events-output-editor"
          class="monaco-editor test-function-output-editor"
          :style="{ height: `calc((100vh - (260px + ${heightOffset}px)) / 2)` }"
          v-model:query="outputEvents"
          language="json"
          read-only
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {
  onBeforeMount,
  ref,
  defineExpose,
  computed,
  nextTick,
  onMounted,
  defineAsyncComponent,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import DateTime from "@/components/DateTime.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { debounce } from "lodash-es";
import useQuery from "@/composables/useQuery";
import { b64EncodeUnicode, getImageURL } from "@/utils/zincutils";
import searchService from "@/services/search";
import { useStore } from "vuex";
import { getConsumableRelativeTime } from "@/utils/date";
import AppTabs from "@/components/common/AppTabs.vue";
import jstransform from "@/services/jstransform";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const props = defineProps({
  vrlFunction: {
    type: Object,
    required: true,
  },
  heightOffset: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["function-error","sendToAiChat"]);

const QueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);

const inputQuery = ref<string>("");
const inputEvents = ref<string>("");
const outputEvents = ref<string>("");

const dummyEvents = {
  data: {
    results: [
      {
        event: {
          _timestamp: 1735128523652186,
          job: "test",
          level: "info",
          log: "test message for openobserve",
        },
      },
      {
        event: {
          log: "test message for openobserve",
        },
        message: "Error in event",
      },
    ],
  },
};

const originalOutputEvents = ref<any>("");

const eventsErrorMsg = ref<string>("");

const queryEditorRef = ref<InstanceType<typeof QueryEditor>>();

const { onFocus: _sqlOnFocus, onBlur: _sqlOnBlur, onQueryChange: _sqlOnQueryChange } =
  useSqlEditorDiagnostics({
    queryEditorRef,
    sqlMode: computed(() => true),
    query: inputQuery,
  });

const onQueryEditorFocus = () => {
  queryEditorPlaceholderFlag.value = false;
  _sqlOnFocus();
};
const onQueryEditorBlur = async () => {
  queryEditorPlaceholderFlag.value = true;
  await _sqlOnBlur();
};

const eventsEditorRef = ref<InstanceType<typeof QueryEditor>>();

const outputEventsEditorRef = ref<InstanceType<typeof QueryEditor>>();

const outputEventsErrorMsg = ref<string>("");

const loading = ref({
  events: false,
  output: false,
});

const dateTime = ref<any>({});

const selectedStream = ref<{
  name: string;
  type: "logs" | "metrics" | "traces";
}>({ name: "", type: "logs" });

const { getStreams, getStream } = useStreams();

const { buildQueryPayload } = useQuery();

const streamTypes = [
  { label: "Logs", value: "logs", icon: "description" },
  { label: "Metrics", value: "metrics", icon: "bar-chart" },
  { label: "Traces", value: "traces", icon: "activity" },
];

const isFetchingStreams = ref(false);

const store = useStore();

let parser: any = null;

const { t } = useI18n();

const expandState = ref({
  stream: true,
  functions: true,
  query: false,
  events: true,
  output: true,
});

const filteredStreams = ref<any[]>([]);
const streamFields = ref<any[]>([]);
const queryEditorPlaceholderFlag = ref(true);

// ─── Auto-suggestions (same composable as logs/pipeline query node) ───
const {
  autoCompleteData,
  effectiveKeywords,
  effectiveSuggestions,
  getSuggestions,
  updateFieldKeywords,
  updateStreamKeywords,
} = useSqlSuggestions();

// ─── Query editor typewriter placeholder ─────────────────────────────
const isSqlMode = computed(() => true);
const noStream = computed(() => !selectedStream.value.name);
const { placeholder: queryEditorPlaceholder } = useQueryPlaceholder(
  streamFields,
  ref({}),
  isSqlMode,
  noStream,
  { noStreamText: t("pipeline.queryEditorPlaceholder") },
);

const sqlQueryErrorMsg = ref<string>("");


const streams = ref([]);

onBeforeMount(async () => {
  await importSqlParser();
  await updateStreams();
});

onMounted(() => {
  setEventsEditor();
});

const setEventsEditor = () => {
  setTimeout(() => {
    inputEvents.value = JSON.stringify(
      JSON.parse(
        `[{"_timestamp":1735128523652186,"job":"test","level":"info","log":"test message for openobserve"},{"_timestamp":1735128522644223,"job":"test","level":"info","log":"test message for openobserve"}]`,
      ),
      null,
      2,
    );
  }, 300);
};

const outputMessage = computed(() => {
  if (!outputEvents.value) {
    return "Please click Test Function to see the events";
  }

  return "";
});

const areInputValid = () => {
  if (!inputQuery.value) {
    toast({
      variant: "error",
      message: "Please enter a query",
    });
    sqlQueryErrorMsg.value = "Please enter a query";
    return false;
  }

  return true;
};

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

const filterStreams = (val: string) => {
  filteredStreams.value = filterColumns(streams.value, val);
};

const filterColumns = (options: any[], val: string) => {
  if (val === "") return [...options];
  const value = val.toLowerCase();
  return options.filter(
    (column: any) => column.toLowerCase().indexOf(value) > -1,
  );
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
      streams.value = res.list.map((data: any) => data.name);
      // Show all streams on open (not just on search)
      filteredStreams.value = [...streams.value];
      // Keep FROM-clause auto-suggest in sync
      updateStreamKeywords(res.list.map((data: any) => ({ name: data.name })));
      return Promise.resolve();
    })
    .catch(() => Promise.reject())
    .finally(() => (isFetchingStreams.value = false));
};

// Load field keywords whenever the selected stream changes
watch(
  () => selectedStream.value.name,
  async (name) => {
    if (!name) {
      streamFields.value = [];
      updateFieldKeywords([]);
      return;
    }
    try {
      const stream = await getStream(name, selectedStream.value.type, true);
      streamFields.value = stream?.schema?.map((f: any) => ({
        ...f,
        dataType: f.type,
      })) || [];
      updateFieldKeywords(streamFields.value);
    } catch {
      // ignore — field suggestions are best-effort
    }
  },
);

// Feed auto-suggest on every query change and clear stale SQL markers
watch(inputQuery, (value) => {
  _sqlOnQueryChange();
  autoCompleteData.value.query = value;
  autoCompleteData.value.cursorIndex = queryEditorRef.value?.getCursorIndex() ?? -1;
  autoCompleteData.value.popup.open = queryEditorRef.value?.triggerAutoComplete;
  autoCompleteData.value.org = store.state.selectedOrganization.identifier;
  autoCompleteData.value.streamType = selectedStream.value.type;
  autoCompleteData.value.streamName = selectedStream.value.name;
  getSuggestions();
  debouncedSyncStreamFromQuery(value);
});

// Sync the stream-name dropdown from the SQL query the user is typing.
// Setting selectedStream.name directly (not via OSelect interaction) will NOT
// trigger @update:model-value="updateQuery", so there is no risk of overwriting
// the SQL the user typed.
const debouncedSyncStreamFromQuery = debounce(async (sql: string) => {
  if (!sql || !parser) return;
  try {
    const parsed = parser.parse(sql);
    const fromStream = parsed?.ast?.from?.[0]?.table as string | undefined;
    if (fromStream && fromStream !== selectedStream.value.name) {
      selectedStream.value.name = fromStream;
    }
  } catch {
    // ignore parse errors while user is mid-typing
  }
}, 600);

const updateDateTime = (value: any) => {
  dateTime.value = value;
};

const getResults = async () => {
  loading.value.events = true;

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

  // TODO: Handle the edge case when user enters limit in the query
  query.query.sql = inputQuery.value;

  query.query.from = 0;
  query.query.size = 10;

  searchService
    .search({
      org_identifier: store.state.selectedOrganization.identifier,
      query,
      page_type: "logs",
    })
    .then((res: any) => {
      expandState.value.stream = false;
      expandState.value.query = false;
      expandState.value.events = true;
      inputEvents.value = JSON.stringify(
        JSON.parse(JSON.stringify(res.data.hits)),
        null,
        2,
      );
      sqlQueryErrorMsg.value = "";
    })
    .catch((err: any) => {
      sqlQueryErrorMsg.value = err.response?.data?.message
        ? err.response?.data?.message
        : "Invalid SQL Query";

      // Show error only if it is not real time alert
      // This case happens when user enters invalid query and then switches to real time alert
      toast({
        variant: "error",
        message: "Invalid SQL Query : " + err.response?.data?.message,
      });
    })
    .finally(() => {
      loading.value.events = false;
    });
};
const isInputValid = () => {
  try {
    JSON.parse(inputEvents.value);
    return true;
  } catch (e: any) {
    eventsErrorMsg.value = `Invalid events: ${e?.message}`;
    toast({
      variant: "error",
      message: eventsErrorMsg.value,
    });
    return false;
  }
};

const processTestResults = async (results: any) => {
  expandState.value.query = false;
  expandState.value.output = true;
  originalOutputEvents.value = JSON.stringify(results?.data?.results);

  // Clear any previous function error shown in the parent
  emit("function-error", "");

  const processedEvents =
    results?.data?.results.map((event: any) => event.event || event.events) ||
    [];

  outputEvents.value = JSON.stringify(
    JSON.parse(JSON.stringify(processedEvents)),
    null,
    2,
  );

  await nextTick();
  setTimeout(() => {
    highlightSpecificEvent();
  }, 1000);
};

const handleTestError = (err: any) => {
  const rawErrMsg = err.response?.data?.message || "Error in testing function";
  const isJSFunction = String(props.vrlFunction.transType) === '1';

  // Display the raw error message from the backend without modification
  // The backend now extracts detailed error information from rquickjs
  outputEventsErrorMsg.value = isJSFunction
    ? "JavaScript error - see details below"
    : "Error while transforming results";

  toast({
    variant: "error",
    message: rawErrMsg,
    timeout: 5000,
  });

  outputEvents.value = rawErrMsg;

  // Emit error to parent for display in error section
  emit("function-error", rawErrMsg);
};

const testFunction = async () => {
  loading.value.output = true;
  eventsErrorMsg.value = "";
  outputEventsErrorMsg.value = "";

  if (!isInputValid()) {
    return;
  }
  const payload = {
    function: props.vrlFunction.function,
    events: JSON.parse(inputEvents.value),
    trans_type: props.vrlFunction.transType ? parseInt(props.vrlFunction.transType) : undefined,
  };
  jstransform
    .test(store.state.selectedOrganization.identifier, payload)
    .then((res: any) => {
      processTestResults(res);
    })
    .catch((err: any) => {
      handleTestError(err);
    })
    .finally(() => {
      loading.value.output = false;
    });
};

function getLineRanges(object: any) {
  try {
    if (!outputEventsEditorRef.value) return;
    const model = outputEventsEditorRef.value.getModel(); // Get Monaco Editor model
    const contentLines = model.getLinesContent(); // Get content as an array of lines
    const ranges = [];

    // Convert object to JSON string for comparison
    const serializedObject = JSON.stringify(object.event, null, 4);
    const serializedLines = serializedObject.split("\n");

    let startLine = -1;

    // Iterate over the editor content lines
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i];

      // Check if the current line matches the first line of the serialized object
      if (line.trim() === serializedLines[0].trim()) {
        let isMatch = true;

        // Check subsequent lines to ensure the entire object matches
        for (let j = 0; j < serializedLines.length; j++) {
          let editorLine = contentLines[i + j]?.trim();
          const objectLine = serializedLines[j]?.trim();

          if (editorLine === "},") {
            editorLine = "}";
          }

          if (editorLine !== objectLine) {
            isMatch = false;
            break;
          }
        }

        if (isMatch) {
          startLine = i;
          break; // Exit the loop once a match is found
        }
      }
    }

    if (startLine !== -1) {
      const endLine = startLine + serializedLines.length - 1;
      ranges.push({
        startLine: startLine + 1,
        endLine: endLine + 1,
        error: `Error: Failed to apply VRL Function.\n${object.message}`,
      }); // Monaco uses 1-based indexing
    }

    return ranges;
  } catch (e) {
    console.log("Error in getLineRanges", e);
  }
}

function highlightSpecificEvent() {
  try {
    const errorEvents = JSON.parse(originalOutputEvents.value).filter(
      (event: any) => event.message?.trim(),
    );
    const errorEventRanges: any[] = [];

    errorEvents.forEach((event: any) => {
      const ranges = getLineRanges(event);
      if (ranges && ranges.length > 0) {
        errorEventRanges.push(ranges[0]);
      }
    });
    if (errorEventRanges.length) {
      outputEventsErrorMsg.value = "Failed to apply VRL Function on few events";
    }

    if (outputEventsEditorRef.value)
      outputEventsEditorRef.value.addErrorDiagnostics(errorEventRanges);
  } catch (e) {
    console.log("Error in highlightSpecificEvent", e);
  }
}

const sendToAiChat = (value: any) => {
  emit("sendToAiChat", value);
};

defineExpose({
  testFunction,
  sendToAiChat,
  store
});
</script>

<style lang="scss" scoped>
.monaco-editor {
  width: 100%;
  min-height: 10rem;
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

// .test-function-input-editor,
// .test-function-output-editor {
//   height: calc((100vh - (260px + 75px)) / 2) !important;
// }

.test-function-option-tabs {
  :deep(.rum-tab) {
    width: auto !important;
    font-size: 12px;
    padding: 3px 10px;
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

    .OIcon.on-right {
      margin-left: auto;
    }
  }
}
</style>
