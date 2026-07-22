<template>
  <div data-test="test-function-section" class="flex items-center flex-wrap pb-2">
    <div data-test="test-function-query-section" class="test-function-query-container w-full">
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
            class="text-status-error-text mx-1 cursor-pointer"
            size="sm"
          >
            <OTooltip side="right" align="center" :side-offset="10" :content="sqlQueryErrorMsg" />
          </OIcon>
        </template>
        <template #right>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="!selectedStream.name || !inputQuery || loading.events"
            @click="getResults"
          >
            <OIcon name="search" size="sm" class="mr-1" />
            {{ t("search.runQuery") }}
          </OButton>
        </template>
      </FullViewContainer>
      <div
        class="flex items-center flex-wrap gap-x-3 py-2 w-full bg-surface-base"
        v-show="expandState.query"
        data-test="test-function-query-editor-section"
      >
        <div class="function-stream-select-input w-25">
          <div class="text-xs text-text-label">
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
        <div class="function-stream-select-input w-75">
          <div class="text-xs text-text-label">
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
        <div class="functions-duration-input w-82.5">
          <div class="text-xs text-text-label">
            {{ t("common.duration") + " *" }}
          </div>

          <DateTime
            label="Start Time"
            class="py-1 w-full"
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

        <div class="text-xs w-full mt-1 text-text-label">
          {{ t("common.query") + " *" }}
        </div>
        <div class="relative w-full">
          <query-editor
            data-test="vrl-function-test-sql-editor"
            ref="queryEditorRef"
            editor-id="test-function-query-input-editor"
            class="w-full min-h-40"
            v-model:query="inputQuery"
            language="sql"
            :keywords="effectiveKeywords"
            :suggestions="effectiveSuggestions"
            @focus="onQueryEditorFocus"
            @blur="onQueryEditorBlur"
          />
          <div
            v-if="!inputQuery && queryEditorPlaceholderFlag"
            class="query-editor-placeholder-overlay absolute top-0 left-0 right-0 bottom-0 flex items-start p-[0.1875rem_0.5rem_0_2.15rem] pointer-events-none z-1 select-none"
          >
            <span
              class="query-editor-placeholder-typewriter font-mono text-[var(--text-sm)] [line-height:1.3125rem] text-text-placeholder whitespace-nowrap overflow-hidden text-ellipsis"
              >{{ queryEditorPlaceholder }}</span
            >
          </div>
          <div class="text-status-error-text p-1 invalid-sql-error min-h-5.5">
            <span v-show="!!sqlQueryErrorMsg" class="text-compact">
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
            class="font-bold flex items-center text-text-secondary ml-2 text-compact"
          >
            <OSpinner size="xs" />
            <div class="relative top-0.5">
              {{ t("confirmDialog.loading") }}
            </div>
          </div>
          <OIcon
            v-if="!!eventsErrorMsg"
            name="info-outline"
            class="text-status-error-text mx-1 cursor-pointer"
            size="sm"
          >
            <OTooltip side="right" align="center" :side-offset="10" :content="eventsErrorMsg" />
          </OIcon>
        </template>
        <template #right>
          <!-- o2 ai context add button in the test function -->
          <O2AIContextAddBtn
            @send-to-ai-chat="sendToAiChat(JSON.stringify(inputEvents))"
            imageHeight="24px"
            imageWidth="24px"
            :class="'px-2 mr-4'"
            style="
              width: 32px !important;
              height: 32px !important;
              min-width: 32px !important;
              min-height: 32px !important;
            "
          />
        </template>
      </FullViewContainer>
      <div
        v-show="expandState.events"
        class="relative"
        data-test="test-function-input-editor-section"
      >
        <query-editor
          data-test="vrl-function-test-events-editor"
          ref="eventsEditorRef"
          editor-id="test-function-events-input-editor"
          class="test-function-input-editor w-full min-h-40"
          :style="{ height: `calc((100vh - (260px + ${heightOffset}px)) / 2)` }"
          v-model:query="inputEvents"
          language="json"
        />
      </div>
    </div>
    <div class="mt-2">
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
            class="text-sm font-medium font-bold flex items-center text-text-secondary ml-2 text-compact"
          >
            <OSpinner size="xs" />
            <div class="relative top-0.5">
              {{ t("confirmDialog.loading") }}
            </div>
          </div>

          <OIcon
            v-if="!!outputEventsErrorMsg"
            name="info-outline"
            class="text-status-error-text mx-1 cursor-pointer"
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
        class="relative"
        data-test="test-function-output-editor-section"
      >
        <div
          v-if="!outputEvents"
          class="absolute z-10 flex flex-col justify-center items-center w-full h-full opacity-90"
        >
          <OIcon name="lightbulb" size="xl" class="text-status-warning-text" />
          <div class="text-sm text-text-secondary">
            {{ outputMessage }}
          </div>
        </div>
        <query-editor
          data-test="vrl-function-test-events-output-editor"
          ref="outputEventsEditorRef"
          editor-id="test-function-events-output-editor"
          class="test-function-output-editor w-full min-h-40"
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
  computed,
  nextTick,
  onMounted,
  defineAsyncComponent,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { isJsFunction } from "@/utils/functionLanguage";
import DateTime from "@/components/DateTime.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import useStreams from "@/composables/useStreams";
import useSqlSuggestions from "@/composables/useSuggestions";
import { useSqlEditorDiagnostics } from "@/composables/useSqlEditorDiagnostics";
import { useQueryPlaceholder } from "@/components/logs/useQueryPlaceholder";
import { debounce } from "lodash-es";
import useQuery from "@/composables/useQuery";
import { rangesFromServerError, type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import searchService from "@/services/search";
import { useStore } from "vuex";
import { getConsumableRelativeTime } from "@/utils/date";
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
  // Optional sample events to seed the "Events" editor with. When omitted, the
  // generic log sample is used (pipelines / functions page). Workflows pass the
  // fired-alert sample payload so the VRL author sees the real structure.
  sampleEvents: {
    type: Array,
    default: undefined,
  },
});

const emit = defineEmits(["function-error", "sendToAiChat"]);

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const inputQuery = ref<string>("");
const inputEvents = ref<string>("");
const outputEvents = ref<string>("");

const originalOutputEvents = ref<any>("");

const eventsErrorMsg = ref<string>("");

const queryEditorRef = ref<InstanceType<typeof QueryEditor>>();

// Server-error highlight ranges, forwarded to the SQL editor by the composable.
const sqlErrorRanges = ref<SqlErrorRange[]>([]);

const {
  onFocus: _sqlOnFocus,
  onBlur: _sqlOnBlur,
  onQueryChange: _sqlOnQueryChange,
} = useSqlEditorDiagnostics({
  queryEditorRef,
  sqlMode: computed(() => true),
  query: inputQuery,
  externalErrors: sqlErrorRanges,
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

// The language the user picked on the Transform Type toggle. Every "failed to
// apply …" message interpolates this — hardcoding "VRL" told JS authors their
// JavaScript function failed as VRL. Reactive so flipping the toggle re-labels
// an error already on screen.
const functionLanguage = computed(() =>
  isJsFunction(props.vrlFunction) ? t("function.javascript") : t("function.vrl"),
);

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
    // Caller-supplied sample (e.g. the workflow alert payload) takes precedence;
    // otherwise fall back to the generic log sample.
    const sample =
      props.sampleEvents && props.sampleEvents.length
        ? props.sampleEvents
        : JSON.parse(
            `[{"_timestamp":1735128523652186,"job":"test","level":"info","log":"test message for openobserve"},{"_timestamp":1735128522644223,"job":"test","level":"info","log":"test message for openobserve"}]`,
          );
    inputEvents.value = JSON.stringify(sample, null, 2);
  }, 300);
};

const outputMessage = computed(() => {
  if (!outputEvents.value) {
    return t("function.clickTestFunctionHint");
  }

  return "";
});

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
  return options.filter((column: any) => column.toLowerCase().indexOf(value) > -1);
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
      streamFields.value =
        stream?.schema?.map((f: any) => ({
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
  // Ref may be unmounted; fall back to a no-op to match popup.open's non-optional type.
  autoCompleteData.value.popup.open = queryEditorRef.value?.triggerAutoComplete ?? (() => {});
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
      page_type: selectedStream.value.type,
    })
    .then((res: any) => {
      expandState.value.stream = false;
      expandState.value.query = false;
      expandState.value.events = true;
      inputEvents.value = JSON.stringify(JSON.parse(JSON.stringify(res.data.hits)), null, 2);
      sqlQueryErrorMsg.value = "";
      sqlErrorRanges.value = [];
    })
    .catch((err: any) => {
      sqlQueryErrorMsg.value = err.response?.data?.message
        ? err.response?.data?.message
        : "Invalid SQL Query";

      // Locate the offending token in the SQL and squiggle it in the editor.
      rangesFromServerError({
        code: err.response?.data?.code,
        message: err.response?.data?.message,
        errorDetail: err.response?.data?.error_detail,
        sqlMode: true,
        query: inputQuery.value,
        streamName: selectedStream.value?.name,
      }).then((ranges) => {
        sqlErrorRanges.value = ranges;
      });

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

  const rows = results?.data?.results || [];

  // Only a *syntax* error fails the request outright; a runtime throw comes back
  // on a 200 with the message attached per event. Forward those to the parent's
  // error section — emitting "" here unconditionally cleared it, so a runtime
  // error showed nowhere but a hover tooltip while the editor displayed the
  // untransformed events, which reads as success. Deduped: every event usually
  // trips the same throw.
  const rowErrors = [...new Set(rows.map((row: any) => row?.message?.trim()).filter(Boolean))];
  emit("function-error", rowErrors.join("\n"));

  const processedEvents = rows.map((event: any) => event.event || event.events);

  outputEvents.value = JSON.stringify(JSON.parse(JSON.stringify(processedEvents)), null, 2);

  await nextTick();
  setTimeout(() => {
    highlightSpecificEvent();
  }, 1000);
};

const handleTestError = (err: any) => {
  const rawErrMsg = err.response?.data?.message || "Error in testing function";

  // Display the raw error message from the backend without modification
  // The backend now extracts detailed error information from rquickjs
  outputEventsErrorMsg.value = isJsFunction(props.vrlFunction)
    ? t("function.testErrorJs")
    : t("function.testErrorVrl");

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
        error: `${t("function.testApplyFailedEvent", {
          language: functionLanguage.value,
        })}\n${object.message}`,
      }); // Monaco uses 1-based indexing
    }

    return ranges;
  } catch (e) {
    console.log("Error in getLineRanges", e);
  }
  return undefined;
}

function highlightSpecificEvent() {
  try {
    const errorEvents = JSON.parse(originalOutputEvents.value).filter((event: any) =>
      event.message?.trim(),
    );
    const errorEventRanges: any[] = [];

    errorEvents.forEach((event: any) => {
      const ranges = getLineRanges(event);
      if (ranges && ranges.length > 0) {
        errorEventRanges.push(ranges[0]);
      }
    });
    if (errorEventRanges.length) {
      outputEventsErrorMsg.value = t("function.testApplyFailedSome", {
        language: functionLanguage.value,
      });
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
  store,
});
</script>

<style scoped>
/* keep(lib-override): compact run-query button + full-width date-time button (child DOM) */
.test-function-query-container :deep(.test-function-run-query-btn) {
  padding: 0.125rem 0.5rem !important;
  font-size: var(--text-2xs) !important;
  margin: 1px 0.125rem !important;
}

.functions-duration-input :deep(.date-time-button) {
  width: 100%;
}
</style>
