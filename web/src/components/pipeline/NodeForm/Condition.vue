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
    :title="t('pipeline.conditionTitle')"
    :width="45"
    :show-close="false"
    data-test="add-condition-drawer"
    :primary-button-label="t('common.save')"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    :neutral-button-label="pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutral-button-variant="outline-destructive"
    @click:primary="saveCondition"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
    @keydown.stop
    :persistent="true"
  >
    <template #header-right>
      <button
        type="button"
        :aria-label="t('pipeline.closeDrawer')"
        data-test="o-drawer-close-btn"
        @mousedown.prevent
        @click="openCancelDialog"
        class="shrink-0 flex items-center justify-center h-7 w-7 rounded-default text-dialog-close-text hover:bg-dialog-close-hover-bg active:bg-dialog-close-active-bg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dialog-focus-ring cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </template>
    <div
      data-test="add-condition-section"
      class="stream-routing-section w-full min-h-full bg-surface-base"
    >


    <div class="w-full rounded-default stream-routing-container">
      <div>
        <div
          class="showLabelOnTop font-bold text-h7"
          data-test="add-condition-query-input-title"
        >
          <div></div>
          <!-- SHARED body: the same ConditionBuilder the workflow Condition node
               renders. It owns the FilterGroup, the V0/V1→V2 conversion, the zod
               schema and the inline error. Pipelines only supply the stream
               fields and these guidelines. -->
          <ConditionBuilder
            ref="builder"
            :fields="filteredColumns"
            :initial-conditions="initialConditions"
            module="pipelines"
            :allow-custom-columns="true"
            normalize-operators
          >
            <template #guidelines>
          <div
            class="note-container bg-banner-warning-bg border border-banner-warning-border text-banner-warning-text w-full rounded-default p-3 my-3 flex flex-col gap-2"
            data-test="add-condition-note-container"
          >
            <div
              class="text-sm text-banner-warning-text"
              data-test="add-condition-note-heading"
            >
              {{ t('pipeline.conditionValueGuidelines') }}
            </div>
            <div
              class="flex flex-col gap-1 text-sm text-banner-warning-text"
              data-test="add-condition-note-info"
            >
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  {{ t('pipeline.emptyValueGuideline') }}
                  <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- code literal representing an empty string value, must stay identical in every language -->
                  <span class="highlight font-bold text-text-link">""</span>{{ t('pipeline.exampleColon') }}
                  <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- SQL condition example, code must stay identical in every language -->
                  <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">app_name != ""</span>
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  {{ t('pipeline.nullValueGuideline') }}
                  <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- code literal representing the null keyword, must stay identical in every language -->
                  <span class="highlight font-bold text-text-link">null</span>{{ t('pipeline.exampleColon') }}
                  <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- SQL condition example, code must stay identical in every language -->
                  <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">app_name != null</span>
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  {{ t('pipeline.customColumnGuideline') }}
                  <span class="highlight font-bold text-text-link">{{ t('pipeline.enterKey') }}</span>.
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="warning" size="sm" class="shrink-0 mt-0.5 text-status-error-text" />
                <span>{{ t('pipeline.conditionsNotMetWarning') }}</span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="warning" size="sm" class="shrink-0 mt-0.5 text-status-error-text" />
                <span>{{ t('pipeline.missingFieldWarning') }}</span>
              </div>
            </div>
          </div>
            </template>
          </ConditionBuilder>
        </div>
      </div>
    </div>
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
import {
  computed,
  onMounted,
  ref,
  type Ref,
  onBeforeMount,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";
import {
  getUUID,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "../../ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import { toast } from "@/lib/feedback/Toast/useToast";

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
  filterType?: "group";
  logicalOperator?: "AND" | "OR";
  conditions?: (FilterCondition | ConditionGroup)[];
  // V1 properties (legacy)
  groupId?: string;
  label?: "and" | "or";
  items?: (FilterCondition | ConditionGroup)[];
}

const { t } = useI18n();


const store = useStore();

const { getStream } = useStreams();

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const internalOpen = ref(!!props.open);
watch(() => props.open, (v) => { internalOpen.value = !!v; });

function handleDrawerClose(v: boolean) {
  if (!v) {
    // Intercept any programmatic close (e.g. Escape key) with confirmation too
    openCancelDialog();
    return;
  }
  internalOpen.value = v;
}

const filteredColumns: any = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const selected = ref(null);
watch(selected, (newValue: any) => {
  pipelineObj.userSelectedNode = newValue;
});
let parser: any;

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

// The SHARED ConditionBuilder owns V0/V1 -> V2 conversion and the lowercase
// operator normalization; pipelines just hand it the saved rule.
const initialConditions = computed(() =>
  pipelineObj.isEditNode
    ? (pipelineObj.currentSelectedNodeData?.data?.conditions ?? null)
    : null,
);

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

  if (pipelineObj.userSelectedNode) {
    pipelineObj.userSelectedNode = {};
  }
});

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

// The shared ConditionBuilder owns the condition tree + its OForm/zod schema.
// We only hold a ref to it (for submit() and the cancel dirty-check).
const builder = ref<any>(null);

// Snapshot of the rule as first rendered, for the "discard changes?" prompt.
const originalConditionGroup = ref<any>(null);
onMounted(() => {
  originalConditionGroup.value = JSON.parse(
    JSON.stringify(builder.value?.conditionGroup ?? null),
  );
});

const updateStreamFields = async (streamName: any, streamType: any) => {
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
    const timestampColumn =
      store.state.zoConfig?.timestamp_column || "_timestamp";
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

    const inputStreamNode: any = allNodes.find(
      (node: any) =>
        node.io_type === "input" && node.data.node_type === "stream",
    );

    const inputQueryNode: any = allNodes.find(
      (node: any) =>
        node.io_type === "input" && node.data.node_type === "query",
    );

    const anyStreamNode: any = allNodes.find(
      (node: any) =>
        node.data?.node_type === "stream" && node.data?.stream_name,
    );

    if (inputStreamNode) {
      await updateStreamFields(
        inputStreamNode.data?.stream_name.value ||
          inputStreamNode.data?.stream_name,
        inputStreamNode.data?.stream_type,
      );
    } else if (inputQueryNode) {
      const filteredQuery: any = inputQueryNode?.data?.query_condition.sql
        .split("\n")
        .filter(
          (line: string) => line.length > 0 && !line.trim().startsWith("--"),
        )
        .join("\n");
      if (filteredQuery) {
        const parsedSql = parser.astify(filteredQuery);
        if (parsedSql && parsedSql.from) {
          const streamNames = parsedSql.from.map((item: any) => item.table);
          for (const streamName of streamNames) {
            await updateStreamFields(
              streamName,
              inputQueryNode?.data?.stream_type,
            );
          }
        }
      }
    } else if (anyStreamNode) {
      await updateStreamFields(
        anyStreamNode.data?.stream_name.value ||
          anyStreamNode.data?.stream_name,
        anyStreamNode.data?.stream_type,
      );
    } else {
      filteredColumns.value = [];
    }
  } catch (e) {
    console.error("Error fetching fields:", e);
  }
};


const closeDialog = () => {
  // The builder holds its own deep clone of the rule, so the saved node data was
  // never mutated — closing simply drops it (no restore needed).
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
  internalOpen.value = false;
  setTimeout(() => emit("cancel:hideform"), 300);
};

const openCancelDialog = () => {
  try {
    try {
      if (
        JSON.stringify(originalConditionGroup.value) ===
        JSON.stringify(builder.value?.conditionGroup)
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

// @submit handler — OForm only calls it once the schema passes (at least one
// condition via superRefine over the bridged `conditions` field), so the schema
// gates the save. Reads the live `conditionGroup` (the bridged source of truth).
const saveCondition = async () => {
  try {
    // The shared builder validates against the zod schema ("at least one
    // complete condition") and renders the error inline, returning null when the
    // rule is empty/incomplete — so an invalid rule simply never gets here.
    const payload = await builder.value?.submit();
    if (!payload) return;

    const conditionData = {
      node_type: "condition",
      version: payload.version, // 2
      conditions: payload.conditions,
    };

    // Ensure currentSelectedNodeData has proper structure
    if (!pipelineObj.currentSelectedNodeData.position) {
      pipelineObj.currentSelectedNodeData.position = { x: 250, y: 250 };
    }

    // Fix userClickedNode if it's an object instead of string ID
    if (
      pipelineObj.userClickedNode &&
      typeof pipelineObj.userClickedNode === "object"
    ) {
      if (pipelineObj.userClickedNode.id) {
        pipelineObj.userClickedNode = pipelineObj.userClickedNode.id;
      } else {
        pipelineObj.userClickedNode = null;
      }
    }

    addNode(conditionData);
    // Snapshot the newly saved state for the discard-changes comparison.
    originalConditionGroup.value = JSON.parse(
      JSON.stringify(payload.conditions),
    );
    emit("cancel:hideform");
  } catch (error) {
    console.error("Error saving condition:", error);
    toast({
      variant: "error",
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

</script>

<style scoped>
/* keep(lib-override): retarget the shared FilterGroup component's internal DOM
   (.filter-group-box / .group-container / .group-border / .conditions-input and its
   inline margin-left styling) for the pipeline drawer context — not addressable via
   template utilities. */

/* Force the root group box to span the full drawer width (FilterGroup defaults to w-fit).
   Also drop its `mt-4`: as the first element in the drawer body it has no preceding
   label to space from, and that margin collapses to the body's content edge, adding a
   1rem gap on top of the drawer's own 0.75rem inset. Root box only (`>`) — nested groups
   and alerts' FilterGroup keep their mt-4. */
.pipeline-filter-group-wrapper > :deep(.filter-group-box) {
  width: 100% !important;
  margin-top: 0 !important;
}

.pipeline-filter-group-wrapper :deep(.group-container) {
  white-space: normal !important;
  overflow-x: visible !important;
  max-width: 100%;
  pointer-events: auto;
}

/* Reduce margins for nested groups in pipeline */
.pipeline-filter-group-wrapper :deep([style*="margin-left"]) {
  margin-left: 0.625rem !important;
}

/* Ensure conditions fit width */
.pipeline-filter-group-wrapper :deep(.conditions-input) {
  min-width: 7.5rem !important;
  max-width: 12.5rem;
}

/* Ensure group borders don't overflow */
.pipeline-filter-group-wrapper :deep(.group-border) {
  max-width: calc(100% - 1.25rem);
}
</style>
