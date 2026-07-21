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
    primary-button-label="Save"
    secondary-button-label="Cancel"
    secondary-button-variant="outline"
    :neutral-button-label="pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutral-button-variant="outline-destructive"
    form-id="condition-form"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
    @keydown.stop
    :persistent="true"
  >
    <template #header-right>
      <button
        type="button"
        aria-label="Close drawer"
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


    <OForm id="condition-form" :form="form">
    <div class="w-full rounded-default stream-routing-container">
      <div>
        <div
          class="showLabelOnTop font-bold text-h7"
          data-test="add-condition-query-input-title"
        >
          <div></div>
          <!-- Wrapper for FilterGroup with pipeline-specific styling -->
          <div class="pipeline-filter-group-wrapper max-w-full overflow-x-visible!" @submit.stop.prevent>
            <FilterGroup
              v-if="
                conditionGroup &&
                (conditionGroup.conditions || conditionGroup.items)
              "
              :key="filterGroupKey"
              :stream-fields="filteredColumns"
              :group="conditionGroup"
              :depth="0"
              name-prefix="conditions"
              condition-input-width="w-32.5"
              :allow-custom-columns="true"
              module="pipelines"
              @add-condition="(updatedGroup) => updateGroup(updatedGroup)"
              @add-group="(updatedGroup) => updateGroup(updatedGroup)"
              @remove-group="(groupId) => removeConditionGroup(groupId)"
              @input:update="(name, field) => onInputUpdate(name, field)"
            />
            <div v-else class="p-3 text-text-muted">Loading conditions...</div>
          </div>
          <!-- Schema error for the bridged FilterGroup model (no OForm* field to
               render it, so surface the form-level `conditions` error here). -->
          <div
            v-if="conditionsError"
            class="text-xs text-input-error-text mt-1"
            data-test="add-condition-error"
          >
            {{ conditionsError }}
          </div>
          <div
            class="note-container bg-banner-warning-bg text-banner-warning-text w-full rounded-default p-3 my-3 flex flex-col gap-2"
            data-test="add-condition-note-container"
          >
            <div
              class="text-sm text-banner-warning-text"
              data-test="add-condition-note-heading"
            >
              Condition value Guidelines:
            </div>
            <div
              class="flex flex-col gap-1 text-sm text-banner-warning-text"
              data-test="add-condition-note-info"
            >
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  To check for an empty value, use
                  <span class="highlight font-bold text-text-link">""</span>. Example:
                  <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">app_name != ""</span>
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  To check for an Null value, use
                  <span class="highlight font-bold text-text-link">null</span>. Example:
                  <span class="code font-mono py-px px-1 rounded-default bg-code-bg text-code-text">app_name != null</span>
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="info" size="sm" class="shrink-0 mt-0.5 text-status-warning-text" />
                <span>
                  To add a custom column, type column name and press
                  <span class="highlight font-bold text-text-link">Enter</span>.
                </span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="warning" size="sm" class="shrink-0 mt-0.5 text-status-error-text" />
                <span>If conditions are not met, the record will be dropped.</span>
              </div>
              <div class="flex items-start gap-2">
                <OIcon name="warning" size="sm" class="shrink-0 mt-0.5 text-status-error-text" />
                <span>If the record does not have the specified field, it will be dropped.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { cloneDeep } from "lodash-es";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { makeConditionSchema, type ConditionForm } from "./Condition.schema";
import {
  getTimezoneOffset,
  getUUID,
  getTimezonesByOffset,
} from "@/utils/zincutils";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "../../ConfirmDialog.vue";
import { convertDateToTimestamp } from "@/utils/date";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import { toast } from "@/lib/feedback/Toast/useToast";
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
  filterType?: "group";
  logicalOperator?: "AND" | "OR";
  conditions?: (FilterCondition | ConditionGroup)[];
  // V1 properties (legacy)
  groupId?: string;
  label?: "and" | "or";
  items?: (FilterCondition | ConditionGroup)[];
}

interface StreamRoute {
  name: string;
  query_condition: any | null;
}

const { t } = useI18n();


const router = useRouter();

const store = useStore();

const { getStream, getStreams } = useStreams();

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

const isUpdating = ref(false);

const filteredColumns: any = ref([]);

const scheduledAlertRef = ref<any>(null);

const filteredStreams: Ref<any[]> = ref([]);

const indexOptions = ref([]);

const originalStreamFields: Ref<any[]> = ref([]);

const isAggregationEnabled = ref(false);

const showTimezoneWarning = ref(false);

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const selected = ref(null);
watch(selected, (newValue: any) => {
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

// Backend returns operators in lowercase (e.g. "contains", "not_contains").
// Normalize them to the canonical casing expected by FilterCondition's triggerOperators.
const OPERATOR_NORMALIZE_MAP: Record<string, string> = {
  contains: "Contains",
  notcontains: "NotContains",
  not_contains: "NotContains",
};

const normalizeConditionOperators = (group: any): any => {
  if (!group || group.filterType !== "group" || !Array.isArray(group.conditions)) return group;
  group.conditions = group.conditions.map((item: any) => {
    if (item.filterType === "group") return normalizeConditionOperators(item);
    if (item.filterType === "condition" && item.operator) {
      const normalized = OPERATOR_NORMALIZE_MAP[item.operator.toLowerCase()];
      if (normalized) item.operator = normalized;
    }
    return item;
  });
  return group;
};

// Initialize condition group - V2: Auto-convert V0/V1 to V2 format
// Supports three versions:
// - V0: Flat array of conditions with implicit AND between all (no groups)
// - V1: Tree-based structure with {and: [...]} or {or: [...]} or {label, items, groupId}
// - V2: Linear structure with filterType, logicalOperator per condition
const getDefaultConditionGroup = (): ConditionGroup => {
  if (
    pipelineObj.isEditNode &&
    pipelineObj.currentSelectedNodeData?.data?.conditions
  ) {
    try {
      // Create a deep copy to avoid mutating the original pipelineObj data
      const conditions = JSON.parse(
        JSON.stringify(pipelineObj.currentSelectedNodeData.data.conditions),
      );
      const version = detectConditionsVersion(conditions);

      if (version === 0) {
        // V0: Flat array format - convert to V2
        // V0 had implicit AND between all conditions (no groups)
        const converted = convertV0ToV2(conditions);
        return normalizeConditionOperators(ensureIds(converted) as any);
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
        return normalizeConditionOperators(ensureIds(converted) as any);
      } else {
        // V2: Use as-is, but ensure all groupIds and ids exist recursively
        return normalizeConditionOperators(ensureIds(conditions) as any);
      }
    } catch (error) {
      console.error("Error converting condition to group format:", error);
    }
  }
  // Default empty V2 group
  return {
    filterType: "group",
    logicalOperator: "AND",
    groupId: getUUID(),
    conditions: [
      {
        filterType: "condition",
        column: "",
        operator: "=",
        value: "",
        values: [],
        logicalOperator: "AND",
        id: getUUID(),
      },
    ],
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

  if (pipelineObj.userSelectedNode) {
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

// Initial conditions tree — loads existing node data synchronously via
// getDefaultConditionGroup(). Seeds the form; after creation the form OWNS it.
const initialConditions = getDefaultConditionGroup();

// Deep-copy snapshot for the dirty-check on Cancel.
const originalConditionGroup: Ref<ConditionGroup> = ref(
  JSON.parse(JSON.stringify(initialConditions)),
);

// Simple incrementing key to force re-render when needed
const filterGroupKey = ref(0);

// ── OForm wiring (Rule ③ OWNER pattern) ──────────────────────────────────────
// This component OWNS <OForm>. FilterGroup renders in FORM MODE (name-prefix=
// "conditions"): FilterCondition name-binds each leaf's column/operator/value
// straight into the form, and structural changes (add/remove/toggle/reorder) are
// written to the form by updateGroup/removeConditionGroup below — mirroring
// alerts' useAlertForm. SINGLE source of truth (form.useStore); no mirror ref, no
// value-sync bridge. The schema's superRefine ("at least one condition") gates
// submit (R3/R4).
const form = useOForm<ConditionForm>({
  defaultValues: { conditions: initialConditions },
  schema: makeConditionSchema(t),
  onSubmit: () => saveCondition(),
});

// Reactive READ-VIEW of the form-owned conditions tree, exposed as a WRITABLE
// computed: reads come from form.useStore (drives FilterGroup's `:group`), and
// any imperative write (restore-on-cancel) goes straight through the form via
// setFieldValue. Still a SINGLE source of truth — no mirror ref, no copy.
const conditionGroupStore = form.useStore(
  (s: any) => s.values.conditions ?? getDefaultConditionGroup(),
);
const conditionGroup = computed({
  get: () => conditionGroupStore.value,
  set: (v: any) => form.setFieldValue("conditions", v),
});

// Watch for label changes specifically to force re-render
watch(
  () => (conditionGroup.value as any)?.label,
  () => {
    filterGroupKey.value++;
  },
);

// Surface the form-level `conditions` error (no OForm* field renders it).
const conditionsErrors = form.useStore(
  (s: any) => s.fieldMeta?.conditions?.errors ?? [],
);
const conditionsError = computed(() =>
  conditionsErrors.value.length
    ? String(firstFieldError(conditionsErrors.value))
    : "",
);

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

// Group management functions - Using shared utilities from alertDataTransforms
// These functions are called when FilterGroup emits add-condition, add-group, or remove-group events

// Structural change from FilterGroup (add-condition / add-group). The transform
// utils MUTATE their context in place, and the form store is readonly, so run
// them on a CLONE of the form's current conditions, then write the result back
// with setFieldValue (mirrors alerts' useAlertForm.updateGroup).
const updateGroup = (updatedGroup: any) => {
  const cloned = cloneDeep((form.state.values as any).conditions);
  const tempContext = {
    formData: { query_condition: { conditions: cloned } },
  };
  updateGroupUtil(updatedGroup, tempContext as any);
  form.setFieldValue(
    "conditions",
    tempContext.formData.query_condition.conditions,
  );
};

const removeConditionGroup = (targetGroupId: string) => {
  const cloned = cloneDeep((form.state.values as any).conditions);
  const tempContext = {
    formData: { query_condition: { conditions: cloned } },
  };
  removeConditionGroupUtil(targetGroupId, cloned, tempContext as any);
  form.setFieldValue(
    "conditions",
    tempContext.formData.query_condition.conditions,
  );
};

const onInputUpdate = (_name?: string, _field?: any) => {
  // Leaf values are name-bound in form mode (FilterCondition writes them straight
  // into the form), so there is no bridge to run here. Kept for the template's
  // @input:update wiring / the bare-mode event surface.
};

const closeDialog = () => {
  // Restore the original condition group when canceling. conditionGroup is now a
  // readonly form read-view, so write the restore THROUGH the form.
  form.setFieldValue(
    "conditions",
    JSON.parse(JSON.stringify(originalConditionGroup.value)),
  );
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

// @submit handler — OForm only calls it once the schema passes (at least one
// condition via superRefine over the bridged `conditions` field), so the schema
// gates the save. Reads the live `conditionGroup` (the bridged source of truth).
const saveCondition = async () => {
  try {
    // V2: Send directly to backend (no transformation needed)
    // The conditionGroup is already in V2 format which matches backend
    let conditionData = {
      node_type: "condition",
      version: 2, // Numeric version for consistency with alerts
      // Detach from the readonly form read-view before handing to addNode.
      conditions: cloneDeep((form.state.values as any).conditions),
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
    // Update originalConditionGroup to the newly saved state
    originalConditionGroup.value = JSON.parse(
      JSON.stringify(conditionGroup.value),
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
