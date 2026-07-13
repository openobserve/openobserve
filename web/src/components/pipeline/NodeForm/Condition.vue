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

<!--
  Pipeline "Condition" (filter) node form. The drawer chrome + save/cancel/delete
  and the stream-schema field fetch (getFields) live here; the FilterGroup body +
  V0/V1/V2 conversion + validation is the SHARED ConditionBuilder, so it stays in
  sync with the workflow condition form.
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
    @click:primary="saveCondition"
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
        class="tw:shrink-0 tw:flex tw:items-center tw:justify-center tw:h-7 tw:w-7 tw:rounded-md tw:text-dialog-close-text tw:hover:bg-dialog-close-hover-bg tw:active:bg-dialog-close-active-bg tw:transition-colors tw:duration-150 tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-dialog-focus-ring tw:cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </template>
    <div
      data-test="add-condition-section"
      class="stream-routing-section tw:w-full tw:min-h-full"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >
      <div class="tw:w-full tw:rounded-lg tw:px-3 stream-routing-container">
        <div
          class="showLabelOnTop text-h7"
          data-test="add-condition-query-input-title"
        >
          <ConditionBuilder
            ref="builder"
            :fields="filteredColumns"
            :initial-conditions="initialConditions"
            :normalize-operators="true"
          >
            <template #guidelines>
              <div
                class="note-container tw:bg-[#f9f290] tw:text-[#2d3748] tw:w-full tw:rounded-md tw:p-3 tw:my-3 tw:flex tw:flex-col tw:gap-2"
                data-test="add-condition-note-container"
              >
                <div
                  class="tw:text-sm tw:text-gray-800"
                  data-test="add-condition-note-heading"
                >
                  Condition value Guidelines:
                </div>
                <div
                  class="tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-gray-800"
                  data-test="add-condition-note-info"
                >
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                    <span>
                      To check for an empty value, use
                      <span class="highlight tw:font-bold tw:text-[#007bff]">""</span>. Example:
                      <span class="code tw:font-mono tw:py-[1px] tw:px-[4px] tw:rounded-[3px] tw:bg-[rgba(0,0,0,0.06)] tw:text-[#b30059]">app_name != ""</span>
                    </span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                    <span>
                      To check for an Null value, use
                      <span class="highlight tw:font-bold tw:text-[#007bff]">null</span>. Example:
                      <span class="code tw:font-mono tw:py-[1px] tw:px-[4px] tw:rounded-[3px] tw:bg-[rgba(0,0,0,0.06)] tw:text-[#b30059]">app_name != null</span>
                    </span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <OIcon name="info" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-amber-500" />
                    <span>
                      To add a custom column, type column name and press
                      <span class="highlight tw:font-bold tw:text-[#007bff]">Enter</span>.
                    </span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <OIcon name="warning" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-red-500" />
                    <span>If conditions are not met, the record will be dropped.</span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <OIcon name="warning" size="sm" class="tw:shrink-0 tw:mt-0.5 tw:text-red-500" />
                    <span>If the record does not have the specified field, it will be dropped.</span>
                  </div>
                </div>
              </div>
            </template>
          </ConditionBuilder>
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
import { onMounted, onBeforeMount, ref, watch, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useStore } from "vuex";
import useStreams from "@/composables/useStreams";
import ConfirmDialog from "../../ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import { toast } from "@/lib/feedback/Toast/useToast";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";

const { t } = useI18n();
const store = useStore();
const { getStream } = useStreams();
const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits(["update:node", "cancel:hideform", "delete:node"]);

const internalOpen = ref(!!props.open);
watch(
  () => props.open,
  (v) => {
    internalOpen.value = !!v;
  },
);

function handleDrawerClose(v: boolean) {
  if (!v) {
    // Intercept any programmatic close (e.g. Escape) with the discard check too.
    openCancelDialog();
    return;
  }
  internalOpen.value = v;
}

// The condition builder owns the rule; this form loads the saved rule (edit
// mode) into it and reads it back on save.
const builder = ref<any>(null);
const initialConditions =
  pipelineObj.isEditNode
    ? pipelineObj.currentSelectedNodeData?.data?.conditions ?? null
    : null;
// Snapshot of the initialised rule (post V0/V1→V2), for the cancel-discard check.
let originalGroupSnapshot = "";

// --- field fetch (pipeline-specific: the condition columns are the input
//     stream's schema) --------------------------------------------------------
const filteredColumns: any = ref([]);
const originalStreamFields: Ref<any[]> = ref([]);
let parser: any;

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const importSqlParser = async () => {
  const useSqlParser: any = await import("@/composables/useParser");
  const { sqlParser }: any = useSqlParser.default();
  parser = await sqlParser();
};

const updateStreamFields = async (streamName: any, streamType: any) => {
  let streamCols: any = [];
  const streams: any = await getStream(streamName, streamType, true);

  if (streams && Array.isArray(streams.schema)) {
    streamCols = streams.schema.map((column: any) => ({
      label: column.name,
      value: column.name,
      type: column.type,
    }));
  }

  // Honour User Defined Schema (UDS): if defined_schema_fields is set, show only
  // those fields (plus the timestamp + all-fields system columns).
  if (
    streams?.settings?.defined_schema_fields &&
    Array.isArray(streams.settings.defined_schema_fields) &&
    streams.settings.defined_schema_fields.length > 0
  ) {
    const definedFields = streams.settings.defined_schema_fields;
    const timestampColumn =
      store.state.zoConfig?.timestamp_column || "_timestamp";
    const allFieldsName = store.state.zoConfig?.all_fields_name;
    streamCols = streamCols.filter((col: any) => {
      if (col.value === timestampColumn || col.value === allFieldsName) {
        return true;
      }
      return definedFields.includes(col.value);
    });
  }

  originalStreamFields.value = [...originalStreamFields.value, ...streamCols];
  filteredColumns.value = [...filteredColumns.value, ...streamCols];
};

const getFields = async () => {
  try {
    const allNodes = pipelineObj.currentSelectedPipeline?.nodes || [];

    const inputStreamNode: any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "stream",
    );
    const inputQueryNode: any = allNodes.find(
      (node: any) => node.io_type === "input" && node.data.node_type === "query",
    );
    const anyStreamNode: any = allNodes.find(
      (node: any) => node.data?.node_type === "stream" && node.data?.stream_name,
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

onBeforeMount(async () => {
  await importSqlParser();
});

onMounted(async () => {
  // Snapshot the initialised rule up front (the builder is already mounted) so
  // the cancel-discard check is reliable even before the async work below runs.
  originalGroupSnapshot = JSON.stringify(builder.value?.conditionGroup ?? {});

  await importSqlParser();

  // Small delay to ensure the pipeline graph is loaded before reading streams.
  setTimeout(async () => {
    await getFields();
    if (!filteredColumns.value || filteredColumns.value.length === 0) {
      filteredColumns.value = [];
    }
  }, 100);
});

const closeDialog = () => {
  internalOpen.value = false;
  setTimeout(() => emit("cancel:hideform"), 300);
};

const openCancelDialog = () => {
  try {
    if (JSON.stringify(builder.value?.conditionGroup) === originalGroupSnapshot) {
      closeDialog();
      return;
    }
  } catch (e) {
    // fall through to the discard dialog
  }
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel condition changes?";
  dialog.value.okCallback = closeDialog;
};

const saveCondition = () => {
  try {
    const payload = builder.value?.getPayload();
    if (!payload) return; // builder surfaced its own validation

    const conditionData = { node_type: "condition", ...payload };

    if (!pipelineObj.currentSelectedNodeData.position) {
      pipelineObj.currentSelectedNodeData.position = { x: 250, y: 250 };
    }

    addNode(conditionData);
    originalGroupSnapshot = JSON.stringify(builder.value?.conditionGroup ?? {});
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
  deletePipelineNode(pipelineObj.currentSelectedNodeID);
  emit("cancel:hideform");
};
</script>

<style>
/* Pipeline-side FilterGroup width overrides live in ConditionBuilder now. */
</style>
