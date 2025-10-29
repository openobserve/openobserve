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
    class="full-width stream-routing-section"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <div class="stream-routing-title q-pb-sm q-pl-md tw-flex tw-items-center tw-justify-between ">
      {{ t("pipeline.conditionTitle") }}
      <div>
          <q-btn v-close-popup="true" round flat icon="cancel" >
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
              v-if="conditionGroup && conditionGroup.items"
              :key="filterGroupKey"
              :stream-fields="filteredColumns"
              :group="conditionGroup"
              :depth="0"
              @add-condition="(updatedGroup) => { console.log('add-condition event received'); updateGroup(updatedGroup); }"
              @add-group="(updatedGroup) => { console.log('add-group event received'); updateGroup(updatedGroup); }"
              @remove-group="(groupId) => { console.log('remove-group event received'); removeConditionGroup(groupId); }"
              @input:update="(name, field) => { console.log('input:update event received'); onInputUpdate(name, field); }"
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
            class="o2-secondary-button tw-h-[36px] q-mr-md"
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
            class="o2-secondary-button tw-h-[36px]"
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
            class="no-border q-ml-md o2-primary-button tw-h-[36px]"
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
  transformFEToBE,
  retransformBEToFE,
} from "@/utils/alerts/alertDataTransforms";


const VariablesInput = defineAsyncComponent(
  () => import("@/components/alerts/VariablesInput.vue"),
);

interface FilterCondition {
  column: string;
  operator: string;
  value: any;
  ignore_case: boolean;
  id: string;
}

interface ConditionGroup {
  groupId: string;
  label: 'and' | 'or';
  items: (FilterCondition | ConditionGroup)[];
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

// Initialize condition group - convert from backend format if editing
const getDefaultConditionGroup = (): ConditionGroup => {
  if (pipelineObj.isEditNode && pipelineObj.currentSelectedNodeData?.data?.condition) {
    try {
      // Convert backend ConditionList format to FilterGroup format
      const converted = retransformBEToFE(pipelineObj.currentSelectedNodeData.data.condition);
      if (converted) {
        return converted;
      }
    } catch (error) {
      console.error("Error converting condition to group format:", error);
    }
  }
  // Default empty group
  return {
    groupId: getUUID(),
    label: 'and',
    items: [{
      column: '',
      operator: '=',
      value: '',
      ignore_case: true,
      id: getUUID(),
    }]
  };
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
      console.warn("No fields found, using empty array");
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

const originalConditionGroup: Ref<ConditionGroup> = ref(getDefaultConditionGroup());

// Debug: log the initial condition group and columns
console.log("Initial conditionGroup:", conditionGroup.value);
console.log("Initial filteredColumns:", filteredColumns.value);

// Watch for filteredColumns changes
watch(filteredColumns, (newVal) => {
  console.log("filteredColumns updated:", newVal);
}, { deep: true });

// Watch for conditionGroup changes
watch(conditionGroup, (newVal) => {
  console.log("conditionGroup updated:", JSON.parse(JSON.stringify(newVal)));
}, { deep: true });

// Simple incrementing key to force re-render when needed
const filterGroupKey = ref(0);

// Watch for label changes specifically to force re-render
watch(() => conditionGroup.value.label, () => {
  console.log("Label changed, incrementing key to force re-render");
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
  const streams: any = await getStream(streamName, streamType, true);

  if (streams && Array.isArray(streams.schema)) {
    streamCols = streams.schema.map((column: any) => ({
      label: column.name,
      value: column.name,
      type: column.type,
    }));
  }
  originalStreamFields.value = [...originalStreamFields.value, ...streamCols];
  filteredColumns.value = [...filteredColumns.value, ...streamCols];
};

const getFields = async () => {
  try {
    console.log("getFields: Starting to fetch fields");
    console.log("getFields: currentSelectedPipeline", pipelineObj.currentSelectedPipeline);

    // find input node - check all nodes
    const allNodes = pipelineObj.currentSelectedPipeline?.nodes || [];
    console.log("getFields: All nodes", allNodes);

    const inputStreamNode : any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "stream",
    );

    const inputQueryNode :any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "query",
    );

    // Also check for stream nodes that are not input but have stream data
    const anyStreamNode: any = allNodes.find(
      (node: any) => node.data?.node_type === "stream" && node.data?.stream_name
    );

    if (inputStreamNode) {
      console.log("getFields: Found inputStreamNode", inputStreamNode);
      await updateStreamFields(
        inputStreamNode.data?.stream_name.value || inputStreamNode.data?.stream_name,
        inputStreamNode.data?.stream_type,
      );
    } else if (inputQueryNode) {
      console.log("getFields: Found inputQueryNode", inputQueryNode);
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
      console.log("getFields: Found anyStreamNode", anyStreamNode);
      await updateStreamFields(
        anyStreamNode.data?.stream_name.value || anyStreamNode.data?.stream_name,
        anyStreamNode.data?.stream_type,
      );
    } else {
      console.error("getFields: No input node found, allNodes:", allNodes);
      // Set empty array so FilterCondition at least shows
      filteredColumns.value = [];
    }
    console.log("getFields: After fetch, filteredColumns =", filteredColumns.value);
  } catch (e) {
    console.error("getFields: Error", e);
  }
};

// Group management functions
const updateGroup = (updatedGroup: any) => {
  console.log("updateGroup called with:", updatedGroup);
  console.log("updateGroup - groupId:", updatedGroup.groupId);
  console.log("updateGroup - label:", updatedGroup.label);
  console.log("updateGroup - items count:", updatedGroup.items?.length);
  console.log("Current conditionGroup before update - items count:", conditionGroup.value.items?.length);

  // If the updated group has the same groupId as the root, replace entirely
  if (updatedGroup.groupId === conditionGroup.value.groupId) {
    console.log("Updating root group");
    conditionGroup.value = updatedGroup;
  } else {
    // Otherwise, it's a nested group - find and update it recursively
    console.log("Updating nested group with id:", updatedGroup.groupId);
    const updateNestedGroup = (group: any, updated: any): boolean => {
      if (!group.items || !Array.isArray(group.items)) return false;

      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        // Check if this item is a group and has the matching groupId
        if (item.groupId && item.groupId === updated.groupId) {
          console.log("Found matching nested group at index", i);
          group.items[i] = updated;
          return true;
        }
        // Recursively check nested groups
        if (item.groupId && item.items) {
          if (updateNestedGroup(item, updated)) {
            return true;
          }
        }
      }
      return false;
    };

    // Create a copy to trigger reactivity
    const updatedRoot = JSON.parse(JSON.stringify(conditionGroup.value));
    if (updateNestedGroup(updatedRoot, updatedGroup)) {
      conditionGroup.value = updatedRoot;
      console.log("Nested group updated successfully");
    } else {
      console.error("Could not find nested group to update");
    }
  }

  console.log("conditionGroup after update - items count:", conditionGroup.value.items?.length);
  console.log("conditionGroup after update - full:", conditionGroup.value);
};

const removeConditionGroup = (targetGroupId: string) => {
  console.log("removeConditionGroup called for groupId:", targetGroupId);

  if (!conditionGroup.value?.items || !Array.isArray(conditionGroup.value.items)) {
    console.error("conditionGroup.value.items is not an array");
    return;
  }

  const filterEmptyGroups = (items: any[]): any[] => {
    return items.filter((item: any) => {
      if (item.groupId === targetGroupId) {
        return false;
      }

      if (item.items && Array.isArray(item.items)) {
        item.items = filterEmptyGroups(item.items);
        return item.items.length > 0;
      }

      return true;
    });
  };

  conditionGroup.value.items = filterEmptyGroups(conditionGroup.value.items);
  console.log("conditionGroup after removing group:", JSON.parse(JSON.stringify(conditionGroup.value)));
};

const onInputUpdate = (name: string, field: any) => {
  console.log("onInputUpdate called with:", name, field);
  // Handle input updates from FilterCondition component
  // This is called when individual condition fields are modified
};

const closeDialog = () => {
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};  
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  try {
    console.log("openCancelDialog: Checking for changes");

    // Try to safely compare, fallback to just closing if comparison fails
    try {
      if (
        JSON.stringify(originalConditionGroup.value) ===
        JSON.stringify(conditionGroup.value)
      ) {
        console.log("openCancelDialog: No changes detected, closing directly");
        closeDialog();
        return;
      }
    } catch (e) {
      console.error("openCancelDialog: Error comparing groups", e);
      // If comparison fails, just show the dialog
    }

    console.log("openCancelDialog: Changes detected, showing confirmation dialog");
    dialog.value.show = true;
    dialog.value.title = "Discard Changes";
    dialog.value.message = "Are you sure you want to cancel condition changes?";
    dialog.value.okCallback = closeDialog;
  } catch (e) {
    console.error("openCancelDialog: Unexpected error", e);
    // Force close if there's any error
    closeDialog();
  }
};

// TODO OK : Add check for duplicate routing name
const saveCondition = async () => {
  try {
    console.log("saveCondition: Starting save");
    console.log("saveCondition: pipelineObj.currentSelectedNodeData", pipelineObj.currentSelectedNodeData);
    console.log("saveCondition: pipelineObj.isEditNode", pipelineObj.isEditNode);

    // Check if there are any valid conditions
    const hasValidConditions = conditionGroup.value.items.some((item: any) => {
      if (item.groupId && item.items) return true; // It's a nested group
      return item.column && item.operator; // It's a condition with required fields
    });

    if (!hasValidConditions) {
      q.notify({
        type: "negative",
        message: "Please add at least one condition",
        timeout: 3000,
      });
      return;
    }

    // Transform FilterGroup format to backend ConditionList format
    const backendCondition = transformFEToBE(conditionGroup.value);

    console.log("saveCondition: backendCondition", backendCondition);

    let conditionData = {
      node_type: "condition",
      condition: backendCondition, // Send as 'condition' (singular) with ConditionList format
    };

    console.log("saveCondition: conditionData to add", conditionData);
    console.log("saveCondition: Calling addNode with", conditionData);

    // Ensure currentSelectedNodeData has proper structure before adding
    if (!pipelineObj.currentSelectedNodeData.position) {
      console.error("saveCondition: No position set on currentSelectedNodeData!");
      pipelineObj.currentSelectedNodeData.position = { x: 250, y: 250 }; // Default position
    }

    if (!pipelineObj.currentSelectedNodeData.id) {
      console.error("saveCondition: No id set on currentSelectedNodeData!");
    }

    // Fix userClickedNode if it's an object instead of string ID
    if (pipelineObj.userClickedNode && typeof pipelineObj.userClickedNode === 'object') {
      console.warn("saveCondition: userClickedNode is an object, extracting ID");
      if (pipelineObj.userClickedNode.id) {
        pipelineObj.userClickedNode = pipelineObj.userClickedNode.id;
      } else {
        console.error("saveCondition: userClickedNode has no id, clearing it");
        pipelineObj.userClickedNode = null;
      }
    }

    console.log("saveCondition: Fixed userClickedNode =", pipelineObj.userClickedNode);

    addNode(conditionData);

    console.log("saveCondition: After addNode, nodes =", pipelineObj.currentSelectedPipeline?.nodes);

    // Log the newly added node specifically
    const addedNode = pipelineObj.currentSelectedPipeline?.nodes[pipelineObj.currentSelectedPipeline?.nodes.length - 1];
    console.log("saveCondition: Newly added node", addedNode);

    emit("cancel:hideform");
  } catch (error) {
    console.error("saveCondition: Error occurred", error);
    q.notify({
      type: "negative",
      message: "Error saving condition: " + (error as Error).message,
      timeout: 5000,
    });
    // Still close the form on error
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
  width: 720px;
  border-radius: 8px;
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
.pipeline-filter-group-wrapper :deep(.tw-whitespace-nowrap) {
  white-space: normal !important;
}

/* Reduce margins for nested groups in pipeline */
.pipeline-filter-group-wrapper :deep([style*="margin-left"]) {
  margin-left: 10px !important;
}

/* Make condition inputs more compact */
.pipeline-filter-group-wrapper :deep(.tw-flex-no-wrap) {
  flex-wrap: wrap !important;
  gap: 0.25rem;
}

/* Ensure conditions fit width */
.pipeline-filter-group-wrapper :deep(.conditions-input) {
  min-width: 120px !important;
  max-width: 200px;
}

/* Make FilterGroup responsive for sidepanel */
.pipeline-filter-group-wrapper :deep(.xl\\:tw-w-fit) {
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
