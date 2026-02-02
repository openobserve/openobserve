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
    data-test="add-condition-section"
    class="stream-routing-section full-width"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md tw:flex tw:items-center tw:justify-between ">
      {{ t("pipeline.conditionTitle") }}
      <div>
          <q-btn round flat icon="cancel" @click="openCancelDialog">
          </q-btn>
        </div>
    </div>
    <q-separator />

    <div class="stream-routing-container q-px-md q-pt-md q-pr-xl">
      <q-form ref="routeFormRef" @submit.prevent="saveCondition">
        <div
          class="q-pt-sm showLabelOnTop text-bold text-h7"
          data-test="add-condition-query-input-title"
        >
        <div>
  </div>
          <!-- Wrapper for FilterGroup with pipeline-specific styling -->
          <div class="pipeline-filter-group-wrapper" @submit.stop.prevent>
            <FilterGroup
              v-if="conditionGroup && (conditionGroup.conditions || conditionGroup.items)"
              :key="filterGroupKey"
              :stream-fields="filteredColumns"
              :group="conditionGroup"
              :depth="0"
              condition-input-width="tw:w-[130px]"
              :allow-custom-columns="true"
              module="pipelines"
              @add-condition="(updatedGroup) => updateGroup(updatedGroup)"
              @add-group="(updatedGroup) => updateGroup(updatedGroup)"
              @remove-group="(groupId) => removeConditionGroup(groupId)"
              @input:update="(name, field) => onInputUpdate(name, field)"
            />
            <div v-else class="q-pa-md text-grey-7">
              Loading conditions...
            </div>
          </div>
          <q-card class="note-container " >

          <q-card-section class="q-pa-sm ">
            <div class="note-heading ">Condition value Guidelines:</div>
            <q-banner  inline dense class="note-info " >
              <div>
                <q-icon name="info" color="orange" class="q-mr-sm" />
                <span>To check for an empty value, use <span class="highlight">""</span>. Example:
                  <span class="code">app_name != ""</span>
                </span>
              </div>
              <div>
                <q-icon name="info" color="orange"class="q-mr-sm" />
                <span>To check for an Null value, use <span class="highlight">null</span>. Example:
                  <span class="code">app_name != null</span>
                </span>
              </div>
              <div>
                <q-icon name="info" color="orange" class="q-mr-sm" />
                <span>To add a custom column, type column name and press <span class="highlight">Enter</span>.</span>
              </div>
              <div>
                <q-icon name="warning" color="red" class="q-mr-sm" />
                <span>If conditions are not met, the record will be dropped.</span>
              </div>
              <div>
                <q-icon name="warning" color="red" class="q-mr-sm" />
                <span>If the record does not have the specified field, it will be dropped.</span>
              </div>
            </q-banner>
          </q-card-section>
          </q-card>


        </div>

        <div
          class="flex justify-start full-width"
          :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
        >
        <q-btn
          v-if="pipelineObj.isEditNode"
            data-test="add-condition-delete-btn"
            class="o2-secondary-button tw:h-[36px] q-mr-md"
            color="negative"
            flat
            type="button"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openDeleteDialog"
          >
          <q-icon name="delete" class="q-mr-xs" />
          {{ t('pipeline.deleteNode') }}
        </q-btn>
          <q-btn
            data-test="add-condition-cancel-btn"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            flat
            type="button"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            no-caps
            @click="openCancelDialog"
          />
          <q-btn
            data-test="add-condition-save-btn"
            :label="t('alerts.save')"
            class="no-border q-ml-md o2-primary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            flat
            no-caps
            type="submit"
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
  onBeforeMount,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import {
  getTimezoneOffset,
  getUUID,
  getTimezonesByOffset,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "../../ConfirmDialog.vue";
import { useQuasar } from "quasar";
import useQuery from "@/composables/useQuery";
import searchService from "@/services/search";
import { convertDateToTimestamp } from "@/utils/date";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  updateGroup as updateGroupUtil,
  removeConditionGroup as removeConditionGroupUtil,
  ensureIds,
  type V2Group,
} from "@/utils/alerts/alertDataTransforms";


const VariablesInput = defineAsyncComponent(
  () => import("@/components/alerts/VariablesInput.vue"),
);

// V1 interfaces (legacy support)
interface FilterCondition {
  column: string;
  operator: string;
  value: any;
  ignore_case: boolean;
  id: string;
}

interface ConditionGroup {
  // V2 properties
  filterType?: 'group';
  logicalOperator?: 'AND' | 'OR';
  conditions?: (FilterCondition | ConditionGroup)[];
  // V1 properties (legacy)
  groupId?: string;
  label?: 'and' | 'or';
  items?: (FilterCondition | ConditionGroup)[];
}

interface StreamRoute {
  name: string;
  query_condition: any | null;
}

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

const validateSqlQueryPromise = ref<Promise<unknown>>();

const scheduledAlertRef = ref<any>(null);

const filteredStreams: Ref<any[]> = ref([]);

const indexOptions = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const isValidName: Ref<boolean> = ref(true);

const isAggregationEnabled = ref(false);

const routeFormRef = ref<any>(null);

const showTimezoneWarning = ref(false);

const { addNode, pipelineObj , deletePipelineNode} = useDragAndDrop();

const selected = ref(null);
watch(selected, (newValue:any) => {
      pipelineObj.userSelectedNode = newValue; 
});
let parser: any;

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

const getDefaultStreamRoute: any = () => {
  if (pipelineObj.isEditNode) {
    return pipelineObj.currentSelectedNodeData.data;
  }
  return {
    name: "",
    destination: {
      org_id: "",
      stream_name: "",
      stream_type: "logs",
    },
    is_real_time: true,
    query_condition: {
      sql: "",
      type: "sql",
      aggregation: null,
    },
    trigger_condition: {
      period: 15,
      frequency_type: "minutes",
      cron: "",
      frequency: 15,
      timezone: "UTC",
    },
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

// Initialize condition group - V2: Auto-convert V0/V1 to V2 format
// Supports three versions:
// - V0: Flat array of conditions with implicit AND between all (no groups)
// - V1: Tree-based structure with {and: [...]} or {or: [...]} or {label, items, groupId}
// - V2: Linear structure with filterType, logicalOperator per condition
const getDefaultConditionGroup = (): ConditionGroup => {
  if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData?.data?.conditions) {
    try {
      // Create a deep copy to avoid mutating the original pipelineObj data
      const conditions = JSON.parse(JSON.stringify(pipelineObj.currentSelectedNodeData.data.conditions));
      const version = detectConditionsVersion(conditions);

      if (version === 0) {
        // V0: Flat array format - convert to V2
        // V0 had implicit AND between all conditions (no groups)
        const converted = convertV0ToV2(conditions);
        return ensureIds(converted) as any;
      } else if (version === 1) {
        // V1: Convert to V2
        let converted;
        if (conditions.and || conditions.or) {
          // V1 Backend format
          converted = convertV1BEToV2(conditions);
        } else if (conditions.label && conditions.items) {
          // V1 Frontend format
          converted = convertV1ToV2(conditions);
        }
        return ensureIds(converted) as any;
      } else {
        // V2: Use as-is, but ensure all groupIds and ids exist recursively
        return ensureIds(conditions) as any;
      }
    } catch (error) {
      console.error("Error converting condition to group format:", error);
    }
  }
  // Default empty V2 group
  return {
    filterType: 'group',
    logicalOperator: 'AND',
    groupId: getUUID(),
    conditions: [{
      filterType: 'condition',
      column: '',
      operator: '=',
      value: '',
      values: [],
      logicalOperator: 'AND',
      id: getUUID(),
    }]
  } as any;
};

onBeforeMount(async () => {
  await importSqlParser();
});

onMounted(async () => {
  await importSqlParser();

  // Add a small delay to ensure pipeline is loaded
  setTimeout(async () => {
    await getFields();

    // If still no fields, provide fallback empty array
    if (!filteredColumns.value || filteredColumns.value.length === 0) {
      filteredColumns.value = [];
    }
  }, 100);

  if(pipelineObj.userSelectedNode){
    pipelineObj.userSelectedNode = {};
  }
});

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

const streamTypes = ["logs", "enrichment_tables"];

const streamRoute: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const originalStreamRouting: Ref<StreamRoute> = ref(getDefaultStreamRoute());

const conditionGroup: Ref<ConditionGroup> = ref(getDefaultConditionGroup());

// Create a deep copy to preserve the original state for comparison
const originalConditionGroup: Ref<ConditionGroup> = ref(JSON.parse(JSON.stringify(getDefaultConditionGroup())));

// Simple incrementing key to force re-render when needed
const filterGroupKey = ref(0);

// Watch for label changes specifically to force re-render
watch(() => conditionGroup.value.label, () => {
  filterGroupKey.value++;
});

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
  return roleNameRegex.test(streamRoute.value?.name);
});

const updateStreamFields = async (streamName : any, streamType : any) => {
  let streamCols: any = [];

  // Fetch stream details including schema and settings
  const streams: any = await getStream(streamName, streamType, true);

  // Map all schema fields to column objects with label, value, and type
  if (streams && Array.isArray(streams.schema)) {
    streamCols = streams.schema.map((column: any) => ({
      label: column.name,
      value: column.name,
      type: column.type,
    }));
  }

  // Check if User Defined Schema (UDS) fields are configured
  // If defined_schema_fields exists and is not empty, we should filter to show only those fields
  // This allows users to limit which fields are visible in pipeline conditions to only the important ones
  if (
    streams?.settings?.defined_schema_fields &&
    Array.isArray(streams.settings.defined_schema_fields) &&
    streams.settings.defined_schema_fields.length > 0
  ) {
    const definedFields = streams.settings.defined_schema_fields;

    // Get special system field names from config
    // These are OpenObserve internal fields that should always be available
    const timestampColumn = store.state.zoConfig?.timestamp_column || '_timestamp';
    const allFieldsName = store.state.zoConfig?.all_fields_name;

    // Filter the columns to include:
    // 1. System fields (timestamp and all_fields) - always needed for OpenObserve functionality
    // 2. User-defined schema fields - only the fields user explicitly configured as important
    streamCols = streamCols.filter((col: any) => {
      // Always include timestamp column (e.g., '_timestamp') - required for time-based queries
      // Always include all fields column (e.g., '_all') - used for full-text search
      if (col.value === timestampColumn || col.value === allFieldsName) {
        return true;
      }
      // Include field only if it's in the defined_schema_fields list
      return definedFields.includes(col.value);
    });
  }
  // If defined_schema_fields is not present or empty, show all schema fields (default behavior)

  // Append the filtered/unfiltered columns to existing fields
  // Note: Using spread to add to existing arrays as this function may be called multiple times
  originalStreamFields.value = [...originalStreamFields.value, ...streamCols];
  filteredColumns.value = [...filteredColumns.value, ...streamCols];
};

const getFields = async () => {
  try {
    const allNodes = pipelineObj.currentSelectedPipeline?.nodes || [];

    const inputStreamNode : any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "stream",
    );

    const inputQueryNode :any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "query",
    );

    const anyStreamNode: any = allNodes.find(
      (node: any) => node.data?.node_type === "stream" && node.data?.stream_name
    );

    if (inputStreamNode) {
      await updateStreamFields(
        inputStreamNode.data?.stream_name.value || inputStreamNode.data?.stream_name,
        inputStreamNode.data?.stream_type,
      );
    } else if (inputQueryNode) {
      const filteredQuery: any = inputQueryNode?.data?.query_condition.sql
        .split("\n")
        .filter((line: string) => line.length > 0 && !line.trim().startsWith("--"))
        .join("\n");
        if(filteredQuery){
          const parsedSql = parser.astify(filteredQuery);
          if (parsedSql && parsedSql.from) {
            const streamNames = parsedSql.from.map((item : any) => item.table);
            for (const streamName of streamNames) {
              await updateStreamFields(streamName, inputQueryNode?.data?.stream_type);
            }
          }
        }
    } else if (anyStreamNode) {
      await updateStreamFields(
        anyStreamNode.data?.stream_name.value || anyStreamNode.data?.stream_name,
        anyStreamNode.data?.stream_type,
      );
    } else {
      filteredColumns.value = [];
    }
  } catch (e) {
    console.error("Error fetching fields:", e);
  }
};

// Group management functions - Using shared utilities from alertDataTransforms
// These functions are called when FilterGroup emits add-condition, add-group, or remove-group events

const updateGroup = (updatedGroup: any) => {
  // Create a context object that matches the alert utility's expected structure
  // The utility expects: context.formData.query_condition.conditions
  // We need to create a temporary wrapper and then extract the updated value
  const tempContext = {
    formData: {
      query_condition: {
        conditions: conditionGroup.value
      }
    }
  };

  // Call the shared utility
  updateGroupUtil(updatedGroup, tempContext as any);

  // Extract the updated value back
  conditionGroup.value = tempContext.formData.query_condition.conditions;
};

const removeConditionGroup = (targetGroupId: string) => {
  // Create a context object that matches the alert utility's expected structure
  const tempContext = {
    formData: {
      query_condition: {
        conditions: conditionGroup.value
      }
    }
  };

  // Call the shared utility
  removeConditionGroupUtil(targetGroupId, conditionGroup.value, tempContext as any);

  // Extract the updated value back
  conditionGroup.value = tempContext.formData.query_condition.conditions;
};

const onInputUpdate = (name: string, field: any) => {
  // Handle input updates from FilterCondition component
};

const closeDialog = () => {
  // Restore the original condition group when canceling
  conditionGroup.value = JSON.parse(JSON.stringify(originalConditionGroup.value));
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  try {
    try {
      if (
        JSON.stringify(originalConditionGroup.value) ===
        JSON.stringify(conditionGroup.value)
      ) {
        closeDialog();
        return;
      }
    } catch (e) {
      // If comparison fails, just show the dialog
    }

    dialog.value.show = true;
    dialog.value.title = "Discard Changes";
    dialog.value.message = "Are you sure you want to cancel condition changes?";
    dialog.value.okCallback = closeDialog;
  } catch (e) {
    closeDialog();
  }
};

const saveCondition = async () => {
  try {
    // V2: Check if there are any valid conditions (use 'conditions' array)
    const conditionsArray = (conditionGroup.value as any).conditions || [];
    const hasValidConditions = conditionsArray.some((item: any) => {
      // Check for nested groups (V2 format)
      if (item.filterType === 'group' && item.conditions) return true;
      // Check for valid conditions
      return item.column && item.operator;
    });

    if (!hasValidConditions) {
      q.notify({
        type: "negative",
        message: "Please add at least one condition",
        timeout: 3000,
      });
      return;
    }

    // V2: Send directly to backend (no transformation needed)
    // The conditionGroup is already in V2 format which matches backend
    let conditionData = {
      node_type: "condition",
      version: 2, // Numeric version for consistency with alerts
      conditions: conditionGroup.value,
    };

    // Ensure currentSelectedNodeData has proper structure
    if (!pipelineObj.currentSelectedNodeData.position) {
      pipelineObj.currentSelectedNodeData.position = { x: 250, y: 250 };
    }

    // Fix userClickedNode if it's an object instead of string ID
    if (pipelineObj.userClickedNode && typeof pipelineObj.userClickedNode === 'object') {
      if (pipelineObj.userClickedNode.id) {
        pipelineObj.userClickedNode = pipelineObj.userClickedNode.id;
      } else {
        pipelineObj.userClickedNode = null;
      }
    }

    addNode(conditionData);
    // Update originalConditionGroup to the newly saved state
    originalConditionGroup.value = JSON.parse(JSON.stringify(conditionGroup.value));
    emit("cancel:hideform");
  } catch (error) {
    console.error("Error saving condition:", error);
    q.notify({
      type: "negative",
      message: "Error saving condition: " + (error as Error).message,
      timeout: 5000,
    });
    emit("cancel:hideform");
  }
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

const validateSqlQuery = () => {
  const query = buildQueryPayload({
    sqlMode: true,
    streamName: streamRoute.value.name as string,
  });

  delete query.aggs;

  query.query.sql = streamRoute.value.query_condition?.sql || '';

  validateSqlQueryPromise.value = new Promise((resolve, reject) => {
    searchService
      .search({
        org_identifier: store.state.selectedOrganization.identifier,
        query,
        page_type: "logs",
      })
      .then((res: any) => {
        isValidSqlQuery.value = true;
        resolve("");
      })
      .catch((err: any) => {
        if (err.response.data.code === 500) {
          isValidSqlQuery.value = false;
          q.notify({
            type: "negative",
            message: "Invalid SQL Query : " + err.response.data.message,
            timeout: 3000,
          });
          reject("");
        } else isValidSqlQuery.value = true;

        resolve("");
      });
  });
};</script>

<style scoped>
.stream-routing-title {
  font-size: 18px;
  padding-top: 16px;
}
.stream-routing-container {
  min-width: 45vw;
  border-radius: 8px;
  max-width: 47vw;
  /* box-shadow: 0px 0px 10px 0px #d2d1d1; */
}

.stream-routing-section {
  min-height: 100%;
}
.previous-drop-down{
  width: 600px;
}

.note-container {
  background-color: #F9F290 ;
  border-radius: 4px;
  border: 1px solid #F5A623;
  color: #865300;
  width: 100%;
  margin-bottom: 20px;
  margin-top: 10px;
}

.note-container .highlight {
  font-weight: bold;
  color: #007bff; /* Blue color to highlight key terms */
}

.note-container .emphasis {
  font-style: italic;
  color: #555; /* Subtle dark gray for emphasis */
}

.note-container .code {
  font-family: monospace;
  padding: 2px 4px;
  border-radius: 3px;
  color: #d63384; /* Soft pinkish-red for code */


}

.note-heading{
  font-size: medium;
}

.note-info{
  font-size: small;
  color: #865300;
  background-color: #F9F290 ;
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: space-between;
}

/* Pipeline-specific FilterGroup styling for narrow sidepanel */
.pipeline-filter-group-wrapper {
  max-width: 100%;
  overflow-x: visible !important;
}

/* Override FilterGroup styles for pipeline context */
.pipeline-filter-group-wrapper :deep(.group-container) {
  white-space: normal !important;
  overflow-x: visible !important;
  max-width: 100%;
}

/* Make condition rows wrap and fit in narrow space */
.pipeline-filter-group-wrapper :deep(.tw:whitespace-nowrap) {
  white-space: normal !important;
}

/* Reduce margins for nested groups in pipeline */
.pipeline-filter-group-wrapper :deep([style*="margin-left"]) {
  margin-left: 10px !important;
}

/* Make condition inputs more compact */
.pipeline-filter-group-wrapper :deep(.tw:flex-no-wrap) {
  flex-wrap: wrap !important;
  gap: 0.25rem;
}

/* Ensure conditions fit width */
.pipeline-filter-group-wrapper :deep(.conditions-input) {
  min-width: 120px !important;
  max-width: 200px;
}

/* Make FilterGroup responsive for sidepanel */
.pipeline-filter-group-wrapper :deep(.xl\\:tw:w-fit) {
  width: 100% !important;
  max-width: 100% !important;
}

/* Ensure group borders don't overflow */
.pipeline-filter-group-wrapper :deep(.group-border) {
  max-width: calc(100% - 20px);
}

/* Ensure buttons are clickable and prevent form submission */
.pipeline-filter-group-wrapper :deep(.q-btn) {
  pointer-events: auto !important;
  position: relative;
  z-index: 1;
}

/* Prevent FilterGroup buttons from triggering form submit */
.pipeline-filter-group-wrapper :deep(.q-btn:not([type="submit"])) {
  /* This is already handled by buttons not having type="submit" */
}

/* Ensure FilterGroup container doesn't interfere with clicks */
.pipeline-filter-group-wrapper :deep(.group-container) {
  pointer-events: auto;
}

.pipeline-filter-group-wrapper :deep(.q-tabs) {
  pointer-events: auto;
}

</style>
