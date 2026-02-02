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
  <div
    data-test="add-stream-query-routing-section "
    class="full-width stream-routing-section tw:h-full"
    :class="[
      store.state.theme === 'dark' ? 'bg-dark' : 'bg-white',
      { 'fullscreen-mode': isFullscreenMode },
    ]"
  >
    <q-separator />

    <div class="stream-routing-container q-px-md">
      <q-form ref="queryFormRef">
        <div class="full-width">
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
            v-model:trigger="streamRoute.trigger_condition"
            v-model:sql="streamRoute.query_condition.sql"
            v-model:promql="streamRoute.query_condition.promql"
            v-model:delay="streamRoute.delay"
            v-model:promql_condition="
              streamRoute.query_condition.promql_condition
            "
            v-model:query_type="streamRoute.query_condition.type"
            v-model:aggregation="streamRoute.query_condition.aggregation"
            v-model:stream_type="streamRoute.stream_type"
            v-model:isAggregationEnabled="isAggregationEnabled"
            v-model:streamType="streamRoute.stream_type"
            @validate-sql="validateSqlQuery"
            @submit:form="saveQueryData"
            @cancel:form="openCancelDialog"
            @delete:node="openDeleteDialog"
            @update:fullscreen="updateFullscreenMode"
            @update:stream_type="updateStreamType"
            @expandLog="toggleExpandLog"
            @update:delay="updateDelay"
            class="q-mt-sm"
          />
        </div>
      </q-form>
    </div>
  </div>
  <confirm-dialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>
<script lang="ts" setup>
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  type Ref,
  onActivated,
} from "vue";
import { useI18n } from "vue-i18n";
import { getTimezoneOffset, getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useQuasar } from "quasar";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

import ScheduledPipeline from "@/components/pipeline/NodeForm/ScheduledPipeline.vue";

const VariablesInput = defineAsyncComponent(
  () => import("@/components/alerts/VariablesInput.vue"),
);

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

const q = useQuasar();

const router = useRouter();

const store = useStore();

const { getStream, getStreams } = useStreams();

const { buildQueryPayload } = useQuery();

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const isUpdating = ref(false);

const filteredColumns: any = ref([]);

const isValidSqlQuery = ref(true);

const validatingSqlQuery = ref(false);

const expandedLogs = ref([]);
const validateSqlQueryPromise = ref<Promise<unknown>>();

const scheduledPipelineRef = ref<any>(null);

const filteredStreams: Ref<any[]> = ref([]);

const indexOptions = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const isAggregationEnabled = ref(false);

const queryFormRef = ref<any>(null);

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const nodeLink = ref({
  from: "",
  to: "",
});

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

onMounted(() => {
  if (pipelineObj.isEditNode) {
    // Deep copy to avoid modifying the original node data
    streamRoute.value = JSON.parse(JSON.stringify(pipelineObj.currentSelectedNodeData?.data)) as StreamRoute;
  }

  originalStreamRouting.value = JSON.parse(JSON.stringify(streamRoute.value));

  updateStreamFields();
});

onActivated(() => {
  if (pipelineObj.isEditNode) {
    // Deep copy to avoid modifying the original node data
    streamRoute.value = JSON.parse(JSON.stringify(pipelineObj.currentSelectedNodeData?.data)) as StreamRoute;
  }

  originalStreamRouting.value = JSON.parse(JSON.stringify(streamRoute.value));
});

const streamTypes = ["logs", "metrics", "traces"];

const streamRoute: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const originalStreamRouting: Ref<StreamRoute> = ref(getDefaultStreamRoute());

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

const filterStreams = (val: string, update: any) => {
  filteredStreams.value = filterColumns(indexOptions.value, val, update);
};

const isValidStreamName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(streamRoute.value.name);
});

const updateStreamFields = async () => {
  let streamCols: any = [];
  const streams: any = await getStream(
    props.streamName,
    props.streamType,
    true,
  );

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
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  if (
    JSON.stringify(originalStreamRouting.value) ===
    JSON.stringify(streamRoute.value)
  ) {
    closeDialog();
    return;
  }

  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel routing changes?";
  dialog.value.okCallback = () => {
    // Restore original data when canceling
    streamRoute.value = JSON.parse(JSON.stringify(originalStreamRouting.value));
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

// TODO OK : Add check for duplicate routing name
const saveQueryData = async () => {
  // Validate inputs
  if (!scheduledPipelineRef.value.validateInputs()) {
    return false; // Don't close dialog on validation failure
  }

  // Validate SQL query
  try {
    await validateSqlQuery();
    await validateSqlQueryPromise.value;
  } catch (e) {
    return false; // Don't close dialog on SQL validation failure
  }

  //this is not needed as we are using validateInputs in scheduledPipeline.vue

  // queryFormRef.value.validate().then((valid: any) => {
  //   if (!valid) {
  //     return false;
  //   }
  // });

  const formData = streamRoute.value;
  if (typeof formData.trigger_condition.period === "string") {
    formData.trigger_condition.period = parseInt(
      formData.trigger_condition.period,
    );
  }

  let queryPayload: any = {
    node_type: "query", // required
    stream_type: formData.stream_type, // required
    org_id: store.state.selectedOrganization.identifier, // required
    query_condition: {
      // same as before
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
      // same as before
      period: formData.trigger_condition.period || 1,
      operator: "=",
      threshold: 0,
      frequency: parseInt(formData.trigger_condition.frequency),
      cron: formData.trigger_condition.cron,
      frequency_type: formData.trigger_condition.frequency_type,
      silence: 0,
      timezone: formData.trigger_condition.timezone,
    },
    delay: formData.delay,
  };

  if (formData.trigger_condition.frequency_type === "cron") {
    queryPayload.tz_offset =
      getTimezoneOffset(formData.trigger_condition.timezone) || 0;
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
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete stream routing?";
  dialog.value.okCallback = deleteRoute;
};

const deleteRoute = () => {
  // emit("delete:node", {
  //   data: {
  //     ...props.editingRoute,
  //     name: props.editingRoute.name,
  //   },
  //   type: "streamRoute",
  // });

  // emit("delete:node", {
  //   data: {
  //     ...props.editingRoute,
  //     name: props.editingRoute.name + ":" + "condition",
  //   },
  //   type: "condition",
  // });
  deletePipelineNode(pipelineObj.currentSelectedNodeID);

  emit("cancel:hideform");
};

const addVariable = () => {
  streamRoute.value.context_attributes.push({
    key: "",
    value: "",
    id: getUUID(),
  });
};

const removeVariable = (variable: any) => {
  streamRoute.value.context_attributes =
    streamRoute.value.context_attributes.filter(
      (_variable: any) => _variable.id !== variable.id,
    );
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

  query.query.sql = normalizeLimit(streamRoute.value.query_condition.sql,100);

  //removed the encoding as it is not required for the pipeline queries
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
      .then((res: any) => {
        isValidSqlQuery.value = true;
        validatingSqlQuery.value = false;
        resolve("");
      })
      .catch((err: any) => {
        validatingSqlQuery.value = false;
        if (err) {
          isValidSqlQuery.value = false;
          const message = err?.response?.data?.message
            ? `Invalid SQL Query: ${err?.response?.data?.message}`
            : "Invalid SQL Query";
          q.notify({
            type: "negative",
            message: `${message}`,
            timeout: 3000,
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
  streamRoute.value.stream_type = val;
};
const updateQueryType = (val: string) => {
  streamRoute.value.query_condition.type = val;
  if (val == "promql") {
    streamRoute.value.query_condition.sql = "";
  }
};

const toggleExpandLog = (index: number) => {
  expandedLogs.value = [];
};

const updateDelay = (val: any) => {
  streamRoute.value.delay = parseInt(val);
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
     //here we will test if the sql query has LIMIT and OFFSET
    //if it has LIMIT then we will replace the LIMIT with the normalized limit
    //if it has no LIMIT then we will return the sql query as is
    //if it has LIMIT but no OFFSET then we will return the sql query with the normalized
    //we have moved to match instead of test because sometimes it fails when there are multiple limit with in the same query 
    //due to last index effects
    if (sql.match(regex)) {
      return sql.replace(regex, (match, limit, offset) => {
        const num = parseInt(limit, 10);
        return `LIMIT ${num > maxLimit ? maxLimit : num}${offset || ''}`;
      });
    }

    // no LIMIT just return as it is the same query that user have written
    return sql;
  } catch (error) {
    console.error("Error normalizing SQL limit:", error);
    return sql; // fallback to original SQL
  }
};

</script>

<style scoped>
.stream-routing-title {
  font-size: 20px;
}
.stream-routing-container {
  width: 100%;
  border-radius: 8px;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}

.stream-routing-section {
  min-height: 100%;
  width: 97vw !important;
  padding-left: 1rem;

  &.fullscreen-mode {
    width: 100vw !important;
  }
}
</style>
