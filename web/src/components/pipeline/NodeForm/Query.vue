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
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.query')"
    :width="isFullscreenMode ? 100 : 97"
    :show-close="true"
    bleed
    @keydown.stop
  >
    <template #header-right>
      <OButton
        v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
        variant="ghost"
        size="icon-toolbar"
        @click="scheduledPipelineRef?.toggleAIChat()"
        data-test="menu-link-ai-item"
        class="bg-[image:var(--color-gradient-ai-subtle)]! transition-[background,box-shadow] duration-300 hover:bg-[image:var(--color-gradient-ai)]! hover:shadow-[0_0.25rem_0.75rem_0_rgba(139,92,246,0.35)]"
        :class="
          store.state.isAiChatEnabled
            ? 'ai-btn-active bg-[image:var(--color-gradient-ai-subtle)]!'
            : ''
        "
      >
        <img
          :src="scheduledPipelineRef?.getBtnLogo"
          class="header-icon ai-icon opacity-70 transition-[transform] duration-[0.6s] ease-[ease]"
          :class="store.state.isAiChatEnabled ? 'opacity-100!' : ''"
        />
      </OButton>
      <div class="flex items-center app-tabs-container">
        <AppTabs
          data-test="scheduled-pipeline-tabs"
          :tabs="scheduledPipelineRef?.tabOptions ?? []"
          v-model:active-tab="activeTab"
          class="tabs-selection-container"
          @update:active-tab="scheduledPipelineRef?.updateTab()"
        />
      </div>
      <DateTime
        style="height: 34px !important; border-radius: 3px"
        menu-align="end"
        @on:date-change="(d) => scheduledPipelineRef?.updateDateChange(d)"
      />
      <OButton
        data-test="logs-search-bar-refresh-btn"
        data-cy="search-bar-refresh-button"
        variant="primary"
        size="sm-action"
        :disabled="!scheduledPipelineRef?.selectedStreamName"
        @click="onRunQuery"
      >
        {{ t("search.runQuery") }}
        <OTooltip
          v-if="!scheduledPipelineRef?.selectedStreamName"
          :content="t('search.selectStreamFirst')"
          side="bottom"
        />
      </OButton>
      <OButton
        data-test="add-function-fullscreen-btn"
        variant="ghost"
        size="icon-xs-sq"
        @click="scheduledPipelineRef?.handleFullScreen()"
      >
        <template #icon-left>
          <OIcon
            name="open-in-full"
            size="sm"
            v-if="!scheduledPipelineRef?.isFullscreen"
            class="size-3.5 shrink-0"
          />
          <OIcon name="close-fullscreen" size="sm" v-else class="size-3.5 shrink-0" />
        </template>
      </OButton>
    </template>
    <div
      data-test="add-stream-query-routing-section"
      class="w-full h-full stream-routing-section bg-surface-base"
      :class="{ 'fullscreen-mode': isFullscreenMode }"
    >
      <!-- ── OWNER pattern ──────────────────────────────────────────────
         Query OWNS <OForm> (created with useOForm) and hands it to <OForm :form>.
         ScheduledPipeline is rendered INSIDE as a DESCENDANT: it injects the form
         and renders the validated scalar controls as OForm* `name=` fields. The
         form is the SINGLE source of truth — no v-model:trigger/sql/… mirror.
         The SQL editor stays bare so validateSqlQuery() remains a pre-submit
         guard inside saveQueryData (the form's onSubmit). -->
      <OForm :form="form" class="w-full h-full rounded-default stream-routing-container">
        <scheduled-pipeline
          ref="scheduledPipelineRef"
          :columns="filteredColumns"
          :conditions="[]"
          :alertData="streamRoute"
          :disableThreshold="true"
          :disableVrlFunction="true"
          :isValidSqlQuery="isValidSqlQuery"
          :disableQueryTypeSelection="true"
          :expandedLogs="expandedLogs"
          :validatingSqlQuery="validatingSqlQuery"
          @validate-sql="validateSqlQuery"
          @submit:form="submitForm"
          @cancel:form="openCancelDialog"
          @delete:node="openDeleteDialog"
          @update:fullscreen="updateFullscreenMode"
          @update:stream_type="updateStreamType"
          @expandLog="toggleExpandLog"
          @update:delay="updateDelay"
        />
      </OForm>
    </div>
  </ODrawer>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import { computed, onMounted, ref, watch, type Ref, onActivated, provide } from "vue";
import { rangesFromServerError, type SqlErrorRange } from "@/utils/query/sqlDiagnostics";
import { useI18n } from "vue-i18n";
import { getTimezoneOffset, getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import DateTime from "@/components/DateTime.vue";
import config from "@/aws-exports";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

import ScheduledPipeline from "@/components/pipeline/NodeForm/ScheduledPipeline.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { makeQuerySchema, type QueryForm } from "./Query.schema";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface RouteCondition {
  column: string;
  operator: string;
  value: any;
  id: string;
}

interface StreamRoute {
  name: string;
  stream_type: string;
  conditions: RouteCondition[];
  query_condition: {
    sql: string;
    promql: string | null;
    promql_condition: {
      column: string;
      operator: string;
      value: any;
    } | null;
    type: string;
    aggregation: {
      group_by: string[];
    } | null;
  };
  trigger_condition: {
    period: number;
    frequency_type: string;
    frequency: string;
    cron: string;
    timezone: any;
  };
  delay: number;
  context_attributes: any;
  description: string;
  enabled: boolean;
}

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  streamName: {
    type: String,
    required: true,
  },
  streamType: {
    type: String,
    required: true,
  },
  editingRoute: {
    type: Object,
    required: false,
    default: () => null,
  },
  streamRoutes: {
    type: Object,
    required: true,
    default: () => ({}),
  },
});

const { t } = useI18n();

const store = useStore();

const { getStream } = useStreams();

const { buildQueryPayload } = useQuery();

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const internalOpen = ref(!!props.open);
watch(
  () => props.open,
  (v) => {
    internalOpen.value = !!v;
  },
);

function handleDrawerClose(v: boolean) {
  internalOpen.value = v;
  if (!v) {
    setTimeout(() => emit("cancel:hideform"), 300);
  }
}

const filteredColumns: any = ref([]);

const isValidSqlQuery = ref(true);

const validatingSqlQuery = ref(false);

const expandedLogs = ref([]);
const validateSqlQueryPromise = ref<Promise<unknown>>();

const scheduledPipelineRef = ref<any>(null);

// Reactive bridge for AppTabs v-model:active-tab — reads/writes into the child ref
const activeTab = computed({
  get: () => scheduledPipelineRef.value?.tab ?? "custom",
  set: (v) => {
    if (scheduledPipelineRef.value) scheduledPipelineRef.value.tab = v;
  },
});

function onRunQuery() {
  if (scheduledPipelineRef.value) {
    scheduledPipelineRef.value.expandState.output = true;
    scheduledPipelineRef.value.expandState.query = false;
    scheduledPipelineRef.value.runQuery();
  }
}

const originalStreamFields: Ref<any[]> = ref([]);

// `isAggregationEnabled` is a reactive view of the form-owned flag. The
// aggregation toggle in ScheduledPipeline writes it via the form, so this read
// stays in sync (single source of truth — no mirror).
const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const isFullscreenMode = ref(false);

const updateFullscreenMode = (val: boolean) => {
  isFullscreenMode.value = val;
};

const getDefaultStreamRoute: any = () => {
  if (pipelineObj.isEditNode) {
    return pipelineObj.currentSelectedNodeData.data;
  }

  const frequency = store.state?.zoConfig?.min_auto_refresh_interval
    ? Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60)
    : 15;

  return {
    name: "",
    conditions: [{ column: "", operator: "", value: "", id: getUUID() }],
    stream_type: "logs",
    query_condition: {
      sql: "",
      type: "sql",
      aggregation: null,
      promql_condition: {
        column: "",
        operator: "",
        value: "",
      },
    },
    trigger_condition: {
      period: 15,
      frequency_type: "minutes",
      cron: "",
      frequency: frequency <= 15 ? 15 : frequency,
      timezone: "UTC",
    },
    delay: 0,
    context_attributes: [
      {
        key: "",
        value: "",
        id: getUUID(),
      },
    ],
    description: "",
    enabled: true,
  };
};

// ── OForm ──────────────────────────────────────────────────────
// The form's defaultValues are the streamRoute object — so the form is the
// SINGLE source of truth for the whole route. ScheduledPipeline (descendant)
// reads/writes the validated slices via the injected form; the schema gates
// submit. `min` is the org min_auto_refresh_interval (seconds) fed to the schema
// factory.
const min = Number(store.state?.zoConfig?.min_auto_refresh_interval) || 1;

const form = useOForm<QueryForm>({
  defaultValues: getDefaultStreamRoute() as unknown as QueryForm,
  schema: makeQuerySchema(min, t),
  onSubmit: () => saveQueryData(),
});

// `streamRoute` is a reactive VIEW of the form-owned values (the single source
// of truth) — NOT a mirror copy. Reads (template, tests, payload build) and the
// helper mutations below go through the form.
const streamRoute = form.useStore((s: any) => s.values as StreamRoute);

// Server-error highlight ranges for the SQL editor. Provided here (parent) and
// injected by the descendant ScheduledPipeline where the editor + composable live.
const sqlErrorRanges = ref<SqlErrorRange[]>([]);
provide("pipelineSqlErrorRanges", sqlErrorRanges);

const originalStreamRouting: Ref<StreamRoute> = ref(
  JSON.parse(JSON.stringify(getDefaultStreamRoute())),
);

// Reactive view of the form-owned aggregation-enabled state derived from the
// presence of an aggregation object (matches ScheduledPipeline's toggle).
const isAggregationEnabled = computed(() => !!streamRoute.value?.query_condition?.aggregation);

onMounted(() => {
  if (pipelineObj.isEditNode) {
    // Deep copy to avoid modifying the original node data, then seed the form.
    form.reset(JSON.parse(JSON.stringify(pipelineObj.currentSelectedNodeData?.data)) as QueryForm);
  }

  originalStreamRouting.value = JSON.parse(JSON.stringify(streamRoute.value));

  updateStreamFields();
});

onActivated(() => {
  if (pipelineObj.isEditNode) {
    form.reset(JSON.parse(JSON.stringify(pipelineObj.currentSelectedNodeData?.data)) as QueryForm);
  }

  originalStreamRouting.value = JSON.parse(JSON.stringify(streamRoute.value));
});

const streamTypes = ["logs", "metrics", "traces"];

// Exposed computed for unit tests. The live drawer does not edit
// streamRoute.name, so it is intentionally NOT a schema field (see Query.schema).
const isValidStreamName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  return roleNameRegex.test(streamRoute.value.name);
});

const updateStreamFields = async () => {
  let streamCols: any = [];
  const streams: any = await getStream(props.streamName, props.streamType, true);

  if (streams && Array.isArray(streams.schema)) {
    streamCols = streams.schema.map((column: any) => ({
      label: column.name,
      value: column.name,
      type: column.type,
    }));
  }
  originalStreamFields.value = [...streamCols];
  filteredColumns.value = [...streamCols];
};

const closeDialog = () => {
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  if (JSON.stringify(originalStreamRouting.value) === JSON.stringify(streamRoute.value)) {
    closeDialog();
    return;
  }

  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel routing changes?";
  dialog.value.okCallback = () => {
    // Restore original data onto the form (single source of truth).
    form.reset(JSON.parse(JSON.stringify(originalStreamRouting.value)) as QueryForm);
    closeDialog();
  };
};

const getDefaultPromqlCondition = () => {
  return {
    column: "value",
    operator: ">=",
    value: 0,
  };
};

// Drive submission through the form so the schema gates the save.
const submitForm = () => {
  form.handleSubmit();
};

// @submit handler — OForm only calls it once the schema passes (period ≥ 1,
// frequency/cron validity, group_by rows when aggregation enabled). The SQL
// editor is bare, so the async SQL validity stays a pre-submit guard here.
// Builds the payload from the validated form values (single source of truth).
const saveQueryData = async () => {
  // Validate SQL query (Monaco is bare — schema can't cover it).
  try {
    await validateSqlQuery();
    await validateSqlQueryPromise.value;
  } catch (e) {
    return false; // Don't close dialog on SQL validation failure
  }

  const formData = streamRoute.value;
  const period = parseInt(String(formData.trigger_condition.period));

  let queryPayload: any = {
    node_type: "query", // required
    stream_type: formData.stream_type, // required
    org_id: store.state.selectedOrganization.identifier, // required
    query_condition: {
      type: formData.query_condition.type,
      conditions: null,
      sql: formData.query_condition.sql,
      promql: formData.query_condition.promql || null,
      promql_condition: null,
      aggregation: formData.query_condition.aggregation,
      vrl_function: null,
      search_event_type: "derivedstream",
    },
    trigger_condition: {
      period: period || 1,
      operator: "=",
      threshold: 0,
      frequency: parseInt(formData.trigger_condition.frequency),
      cron: formData.trigger_condition.cron,
      frequency_type: formData.trigger_condition.frequency_type,
      silence: 0,
      timezone: formData.trigger_condition.timezone,
    },
    // OFormInput (type="number") stores its value as a STRING, so coerce to an
    // integer here — same as period/frequency above. The backend expects i32;
    // sending the raw "-1" string fails deserialization ("invalid type: string").
    delay: parseInt(String(formData.delay)) || 0,
  };

  if (formData.trigger_condition.frequency_type === "cron") {
    queryPayload.tz_offset = getTimezoneOffset(formData.trigger_condition.timezone) || 0;
  }

  if (formData.query_condition.type == "promql") {
    if (queryPayload?.query_condition) {
      queryPayload.query_condition.sql = "";
    }
    queryPayload.query_condition.promql_condition = getDefaultPromqlCondition();
  }

  // All validations passed - add node and close dialog
  addNode(queryPayload);
  emit("cancel:hideform");
  return undefined;
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete stream routing?";
  dialog.value.okCallback = deleteRoute;
};

const deleteRoute = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);

  emit("cancel:hideform");
};

const addVariable = () => {
  const next = [
    ...(streamRoute.value.context_attributes || []),
    { key: "", value: "", id: getUUID() },
  ];
  form.setFieldValue("context_attributes", next, { dontUpdateMeta: true });
};

const removeVariable = (variable: any) => {
  const next = (streamRoute.value.context_attributes || []).filter(
    (_variable: any) => _variable.id !== variable.id,
  );
  form.setFieldValue("context_attributes", next, { dontUpdateMeta: true });
};

const validateSqlQuery = async () => {
  validatingSqlQuery.value = true;
  if (streamRoute.value.query_condition.type == "promql") {
    isValidSqlQuery.value = true;
    validatingSqlQuery.value = false;
    return;
  }
  const query = buildQueryPayload({
    sqlMode: true,
    streamName: streamRoute.value.name as string,
  });

  delete query.aggs;

  // We get 15 minutes time range for the query, so reducing it by 14 minutes and 55 seconds to get 5 seconds of data as the query is just for validation purpose

  query.query.start_time = query.query.start_time + 895000000;

  //before assigning the sql , we need to check if the sql does limit is applied or not
  //if yes we need to change the limit to 100 because for validating we dont need to send the original limit
  //if no we can directly assign the sql to the query
  //we dont need to change the actual query instead of we need to change the query that we are sending for validation purpose

  query.query.sql = normalizeLimit(streamRoute.value.query_condition.sql, 100);

  //encoding is not required for the pipeline queries
  if (store.state.zoConfig.sql_base64_enabled && query?.encoding) {
    delete query.encoding;
  }

  validateSqlQueryPromise.value = new Promise((resolve, reject) => {
    searchService
      .search({
        org_identifier: store.state.selectedOrganization.identifier,
        query,
        page_type: streamRoute.value.stream_type, //use the selected stream type
        validate: true,
      })
      .then(() => {
        isValidSqlQuery.value = true;
        validatingSqlQuery.value = false;
        sqlErrorRanges.value = [];
        resolve("");
      })
      .catch((err: any) => {
        validatingSqlQuery.value = false;
        if (err) {
          isValidSqlQuery.value = false;
          const message = err?.response?.data?.message
            ? `Invalid SQL Query: ${err?.response?.data?.message}`
            : "Invalid SQL Query";
          toast({
            variant: "error",
            message: `${message}`,
          });

          // Locate the offending token in the SQL and squiggle it in the editor.
          rangesFromServerError({
            code: err?.response?.data?.code,
            message: err?.response?.data?.message,
            errorDetail: err?.response?.data?.error_detail,
            sqlMode: true,
            query: streamRoute.value.query_condition.sql,
            streamName: streamRoute.value.name as string,
          }).then((ranges) => {
            sqlErrorRanges.value = ranges;
          });

          reject(message);
        } else {
          isValidSqlQuery.value = true;
          resolve("");
        }
      });
  });
};
const updateStreamType = (val: string) => {
  form.setFieldValue("stream_type", val, { dontUpdateMeta: true });
};
const updateQueryType = (val: string) => {
  form.setFieldValue("query_condition.type", val, { dontUpdateMeta: true });
  if (val == "promql") {
    form.setFieldValue("query_condition.sql", "", { dontUpdateMeta: true });
  }
};

const toggleExpandLog = () => {
  expandedLogs.value = [];
};

const updateDelay = (val: any) => {
  form.setFieldValue("delay", parseInt(val), { dontUpdateMeta: true });
};
//this is used to normalize the limit in the sql query
//if the limit is greater than maxLimit then it will set the limit to maxLimit
//if the limit is less than maxLimit then it will set the limit to the original limit
//if there is no limit in the sql query then it will return the sql query as is
const normalizeLimit = (sql: string, maxLimit = 100): string => {
  try {
    // regex will detect the LIMIT and OFFSET in the sql query
    // it will capture multiple LIMIT and OFFSET in the sql query
    const regex = /\bLIMIT\s+(\d+)(\s+OFFSET\s+\d+)?/gi;
    //if the sql has a LIMIT, replace it with the normalized limit; otherwise return as is.
    //using match instead of test — test can fail with multiple LIMITs in one query due to lastIndex effects
    if (sql.match(regex)) {
      return sql.replace(regex, (match, limit, offset) => {
        const num = parseInt(limit, 10);
        return `LIMIT ${num > maxLimit ? maxLimit : num}${offset || ""}`;
      });
    }

    // no LIMIT just return as it is the same query that user have written
    return sql;
  } catch (error) {
    console.error("Error normalizing SQL limit:", error);
    return sql; // fallback to original SQL
  }
};

// Exposed for unit tests (behavioural surface). `form` is the single source of
// truth; `streamRoute` is its reactive view.
defineExpose({
  form,
  streamRoute,
  originalStreamRouting,
  isValidSqlQuery,
  validatingSqlQuery,
  isAggregationEnabled,
  isFullscreenMode,
  expandedLogs,
  streamTypes,
  scheduledPipelineRef,
  dialog,
  filteredColumns,
  originalStreamFields,
  isValidStreamName,
  getDefaultStreamRoute,
  getDefaultPromqlCondition,
  updateStreamFields,
  updateStreamType,
  updateQueryType,
  updateDelay,
  updateFullscreenMode,
  toggleExpandLog,
  addVariable,
  removeVariable,
  validateSqlQuery,
  normalizeLimit,
  openCancelDialog,
  openDeleteDialog,
  closeDialog,
  deleteRoute,
  saveQueryData,
  submitForm,
});
</script>
