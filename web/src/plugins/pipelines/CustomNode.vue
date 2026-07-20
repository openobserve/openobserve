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

<script setup>
import useDragAndDrop from "./useDnD";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";
import { getTruncatedConditions as getTruncatedConditionsUtil } from "@/utils/conditionPreview";

import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";


const props = defineProps({
  id: {
    type: String,
  },
  data: {
    type: Object,
  },
  io_type: {
    type: String,
  },
});

const emit = defineEmits(["delete:node"]);
const {
  pipelineObj,
  deletePipelineNode,
  checkIfDefaultDestinationNode,
  openStepPicker,
} = useDragAndDrop();
const showButtons = ref(false);
const showDeleteTooltip = ref(false);
let hideButtonsTimeout = null;

// Check if current node has errors
const hasNodeError = computed(() => {
  const lastError = pipelineObj.currentSelectedPipeline?.last_error;
  if (!lastError || !lastError.node_errors) return false;

  // node_errors is a JSON object with node IDs as keys
  const nodeErrors = lastError.node_errors;
  return nodeErrors && nodeErrors[props.id];
});

// Get error info for current node
const getNodeErrorInfo = computed(() => {
  const lastError = pipelineObj.currentSelectedPipeline?.last_error;
  if (!lastError || !lastError.node_errors) return null;

  const nodeError = lastError.node_errors[props.id];
  if (!nodeError) return null;

  // node_errors is an object with structure: { node_id: { errors: [...], error_count: N, ... } }
  if (
    nodeError.errors &&
    Array.isArray(nodeError.errors) &&
    nodeError.errors.length > 0
  ) {
    const errorText = nodeError.errors.join("\n\n");
    if (nodeError.error_count > nodeError.errors.length) {
      return `${errorText}\n\n... and ${nodeError.error_count - nodeError.errors.length} more errors`;
    }
    return errorText;
  }

  return null;
});

// Edge color mapping for different node types
const getNodeColor = (ioType) => {
  const colorMap = {
    input: "#3b82f6", // Blue
    output: "#22c55e", // Green
    default: "#f59e0b", // Orange/Amber
  };
  return colorMap[ioType] || "var(--color-grey-500)";
};

// Function to update edge colors on node hover
const updateEdgeColors = (nodeId, color, reset = false) => {
  if (pipelineObj.currentSelectedPipeline?.edges) {
    pipelineObj.currentSelectedPipeline.edges.forEach((edge) => {
      if (edge.source === nodeId) {
        if (reset) {
          // Reset to default color
          edge.style = {
            ...edge.style,
            stroke: "var(--color-grey-500)",
            strokeWidth: 2,
          };
          edge.markerEnd = {
            ...edge.markerEnd,
            color: "var(--color-grey-500)",
          };
        } else {
          // Apply node color to both edge and arrow
          edge.style = {
            ...edge.style,
            stroke: color,
            strokeWidth: 2,
          };
          edge.markerEnd = {
            ...edge.markerEnd,
            color: color,
          };
        }
      }
    });
  }
};

// Node hover handlers
const handleNodeHover = (nodeId, ioType) => {
  const color = getNodeColor(ioType);
  updateEdgeColors(nodeId, color, false);

  // Clear any existing timeout
  if (hideButtonsTimeout) {
    window.clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }

  showButtons.value = true;
};

const handleNodeLeave = (nodeId) => {
  updateEdgeColors(nodeId, null, true);

  // Add delay before hiding buttons
  hideButtonsTimeout = window.setTimeout(() => {
    showButtons.value = false;
  }, 200);
};

// Handle mouse enter on action buttons to prevent hiding
const handleActionButtonsEnter = () => {
  if (hideButtonsTimeout) {
    window.clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }
};

// Handle mouse leave on action buttons to hide after delay
const handleActionButtonsLeave = () => {
  hideButtonsTimeout = window.setTimeout(() => {
    showButtons.value = false;
  }, 200);
};

// Handle delete tooltip show/hide
const handleDeleteTooltipEnter = () => {
  showDeleteTooltip.value = true;
};

const handleDeleteTooltipLeave = () => {
  showDeleteTooltip.value = false;
};

// Navigate to function page to fix the error
const navigateToFunction = (functionName) => {
  const errorInfo = getNodeErrorInfo.value;
  const query = {
    action: "update",
    name: functionName,
    org_identifier: store.state.selectedOrganization.identifier,
  };

  // Add error message to query if available
  if (errorInfo) {
    query.error = errorInfo;
  }

  router.push({
    name: "functionList",
    query,
  });
};

// (The onFunctionClick/onConditionClick/onStreamOutputClick/onExternalDestinationClick
// handlers were removed — they drove the old context-menu "add connected node"
// feature that no longer exists, and were the only writers of the now-deleted
// userClickedNode/userSelectedNode. Adding a downstream node is done via the
// hover-`+` step picker (useDnD.addNodeAfter).)

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const editNode = (id) => {
  //from id find the node from pipelineObj.currentSelectedPipelineData.nodes
  const fullNode = pipelineObj.currentSelectedPipeline.nodes.find(
    (node) => node.id === id,
  );
  pipelineObj.isEditNode = true;
  pipelineObj.currentSelectedNodeData = fullNode;
  pipelineObj.currentSelectedNodeID = id;
  pipelineObj.dialog.name = fullNode.data.node_type;
  pipelineObj.dialog.show = true;
};

const deleteNode = (id) => {
  openCancelDialog(id);
};
const functionInfo = (data) => {
  return pipelineObj.functions[data.name] || null;
};

// Condition preview reuses the shared util (also used by workflow nodes).
const getTruncatedConditions = (conditionData) =>
  getTruncatedConditionsUtil(conditionData);

const confirmDialogMeta = ref({
  show: false,
  title: "",
  message: "",
  data: null,
  warningMessage: "",
  onConfirm: () => {},
});

const openCancelDialog = (id) => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("common.delete");
  confirmDialogMeta.value.message = "Are you sure you want to delete node?";
  //here we will check if the destination node is added by default if yes then we will show a warning message to the user
  if (
    props.data?.hasOwnProperty("node_type") &&
    props.data.node_type === "stream" &&
    checkIfDefaultDestinationNode(id)
  ) {
    confirmDialogMeta.value.warningMessage =
      defaultDestinationNodeWarningMessage;
  } else {
    confirmDialogMeta.value.warningMessage = "";
  }
  confirmDialogMeta.value.onConfirm = () => {
    deletePipelineNode(id);
  };
};

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.title = "";
  confirmDialogMeta.value.message = "";
  confirmDialogMeta.value.onConfirm = () => {};
};

function getIcon(data, ioType) {
  const searchTerm = data.node_type;
  const node = pipelineObj.nodeTypes.find(
    (node) => node.subtype === searchTerm && node.io_type === ioType,
  );
  return node ? node.icon : undefined;
}
</script>

<template>
  <div class="">
    <FlowNodeCard
      :icon="getIcon(data, io_type)"
      :io-type="io_type"
      :has-input="io_type === 'output' || io_type === 'default'"
      :has-output="io_type === 'input' || io_type === 'default'"
      :input-handle-test="`pipeline-node-${io_type}-input-handle`"
      :output-handle-test="`pipeline-node-${io_type}-output-handle`"
      :data-test="`pipeline-node-${io_type}-${data.node_type.replace(/_/g, '-')}-node`"
      :data-node-type="data.node_type"
      class="btn-fixed-width"
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <!-- Per-type label content -->
      <template #body>
        <div
          v-if="data.node_type == 'function'"
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          align="left"
          style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
        >
          {{ data.name }} -
          <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
        </div>

        <template v-else-if="data.node_type == 'stream'">
          <div
            v-if="data.stream_name && data.stream_name.hasOwnProperty('label')"
            class="flex text-[15px]! font-bold! leading-[1.4]!"
            style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
          >
            {{ data.stream_type }} - {{ data.stream_name.label }}
          </div>
          <div
            v-else
            class="flex text-[15px]! font-bold! leading-[1.4]!"
            style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
          >
            {{ data.stream_type }} - {{ data.stream_name }}
          </div>
        </template>

        <div
          v-else-if="data.node_type == 'query'"
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>

        <div
          v-else-if="data.node_type == 'remote_stream'"
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
        >
          {{ data.destination_name }}
        </div>

        <div
          v-else-if="data.node_type == 'condition'"
          class="text-[15px]! font-bold! leading-[1.4]!"
          style="text-align: left; text-wrap: wrap; width: auto; text-overflow: ellipsis"
        >
          {{ getTruncatedConditions(data.condition || data.conditions) }}
        </div>

      </template>

      <!-- Error badge (function nodes) + delete button, shared across types -->
      <template #actions>
        <div
          v-if="data.node_type == 'function' && hasNodeError"
          data-test="pipeline-node-error-badge"
          class="absolute top-[-12px] right-[-12px] w-[20px] h-[20px] bg-[#ef4444] border-2 border-white rounded-full flex items-center justify-center cursor-pointer z-[15] shadow-[0_2px_6px_rgba(239,68,68,0.5)] transition-all duration-200 error-badge"
          @click.stop="navigateToFunction(data.name)"
        >
          <OIcon name="error" size="sm" />
          <span
            data-test="pipeline-node-error-count"
            v-if="
              pipelineObj.currentSelectedPipeline?.last_error?.node_errors?.[id]
                ?.error_count
            "
            class="absolute top-[-6px] right-[-6px] bg-[#dc2626] text-white text-[9px] font-bold min-w-[14px] h-[14px] rounded-[7px] flex items-center justify-center px-[3px] border-[1.5px] border-solid border-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
          >
            {{
              pipelineObj.currentSelectedPipeline.last_error.node_errors[id]
                .error_count
            }}
          </span>
          <OTooltip side="top" align="center" :sideOffset="10" max-width="600px">
            <template #content>
              <div style="max-height: 300px; overflow-y: auto">
                {{ getNodeErrorInfo || "Error occurred" }}
              </div>
            </template>
          </OTooltip>
        </div>

        <div
          v-show="showButtons"
          class="absolute top-[-30px] right-0 flex gap-[6px] transition-all duration-300 z-10 pt-[5px] px-[5px] pb-[10px] node-action-buttons"
          :data-test="`pipeline-node-${io_type}-actions`"
          :style="{ '--node-color': getNodeColor(io_type) }"
          @mouseenter="handleActionButtonsEnter"
          @mouseleave="handleActionButtonsLeave"
        >
          <OButton
            variant="ghost"
            size="icon"
            @click.stop="deleteNode(id)"
            class="min-w-[20px]! w-[20px]! h-[20px]! p-0! rounded! bg-[rgba(255,255,255,0.95)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! node-action-btn delete-btn"
            :data-test="`pipeline-node-${io_type}-delete-btn`"
            @mouseenter="handleDeleteTooltipEnter"
            @mouseleave="handleDeleteTooltipLeave"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
          <div
            v-if="showDeleteTooltip"
            class="fixed bg-[#dc2626] text-white py-[6px] px-[10px] rounded-md text-[11px] z-[1000] shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none whitespace-nowrap"
            style="left: 15px"
          >
            Delete Node
            <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] [border-top-color:#dc2626]"></div>
          </div>
        </div>
      </template>

      <!-- hover-`+` "add next step" — non-terminal (non-output) nodes only. -->
      <template #footer>
        <div
          v-show="showButtons && io_type !== 'output'"
          class="pl-plus nodrag"
          :data-test="`pipeline-node-${io_type}-add`"
          @pointerdown.stop
          @click.stop
          @mouseenter="handleActionButtonsEnter"
          @mouseleave="handleActionButtonsLeave"
        >
          <button
            type="button"
            class="pl-plus-btn"
            :data-test="`pipeline-node-${io_type}-add-btn`"
            @click.stop="openStepPicker(id)"
          >
            <OIcon name="add" size="xs" />
          </button>
        </div>
      </template>
    </FlowNodeCard>
  </div>

  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    :warning-message="confirmDialogMeta.warningMessage"
    v-model="confirmDialogMeta.show"
  />
</template>

<style>
/* hover-`+` "add next step" affordance — positioned below the node card. */
.pl-plus {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-top: 12px;
  transform: translateX(-50%);
  z-index: 5;
}
.pl-plus-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px dashed var(--color-border-strong);
  background: #fff;
  color: var(--color-grey-500);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.14s;
}
.pl-plus-btn:hover {
  border-style: solid;
  border-color: #5a61cc;
  color: #5a61cc;
  background: #eceefb;
}
.body--dark .pl-plus-btn {
  background: rgba(30, 34, 45, 0.95);
  border-color: rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.7);
}
.body--dark .pl-plus-btn:hover {
  border-color: #818cf8;
  color: #818cf8;
  background: rgba(129, 140, 248, 0.15);
}

.node_handle_custom {
  width: 16px !important;
  height: 16px !important;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50% !important;
  background: var(--color-grey-500);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.node_handle_custom::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-grey-700);
  transition: all 0.3s ease;
}

/* Input nodes - Blue theme */
.handle_input {
  background: #dbeafe !important;
}

.handle_input::before {
  background: #3b82f6 !important;
}

/* Output nodes - Green theme */
.handle_output {
  background: #dcfce7 !important;
}

.handle_output::before {
  background: #22c55e !important;
}

/* Transform nodes (default) - Orange theme */
.handle_default {
  background: #fef3c7 !important;
}

.handle_default::before {
  background: #f59e0b !important;
}

.vue-flow__node-custom {
  padding: 10px;
  border-radius: 3px;
  width: 150px;
  font-size: 12px;
  text-align: center;
  border-width: 1px;
  border-style: solid;
  color: var(--vf-node-text);
  background-color: var(--vf-node-bg);
  border-color: var(--vf-node-color);
}

.node-action-btn:hover {
  background: var(--node-color) !important;
  color: white !important;
  transform: scale(1.1) !important;
}

.delete-btn:hover {
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3) !important;
  background: #ef4444 !important;
  border-color: #ef4444 !important;
}

.error-badge:hover {
  transform: scale(1.2);
  box-shadow: 0 3px 10px rgba(239, 68, 68, 0.7);
  z-index: 20;
}

/* Pipeline error tooltip styling - increased specificity to override global theme styles */
.body--dark .pipeline-error-tooltip,
.body--light .pipeline-error-tooltip,
.pipeline-error-tooltip {
  background-color: #ef4444 !important;
  color: white !important;
  font-size: 12px !important;
  white-space: pre-wrap !important;
  word-wrap: break-word !important;
  line-height: 1.5 !important;
  padding: 10px 14px !important;
}

.body--dark .pipeline-error-tooltip div,
.body--light .pipeline-error-tooltip div,
.pipeline-error-tooltip div {
  max-height: 300px;
  overflow-y: auto;
}

.body--dark .pipeline-error-tooltip div::-webkit-scrollbar,
.body--light .pipeline-error-tooltip div::-webkit-scrollbar,
.pipeline-error-tooltip div::-webkit-scrollbar {
  width: 6px;
}

.body--dark .pipeline-error-tooltip div::-webkit-scrollbar-track,
.body--light .pipeline-error-tooltip div::-webkit-scrollbar-track,
.pipeline-error-tooltip div::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.body--dark .pipeline-error-tooltip div::-webkit-scrollbar-thumb,
.body--light .pipeline-error-tooltip div::-webkit-scrollbar-thumb,
.pipeline-error-tooltip div::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

.body--dark .pipeline-error-tooltip div::-webkit-scrollbar-thumb:hover,
.body--light .pipeline-error-tooltip div::-webkit-scrollbar-thumb:hover,
.pipeline-error-tooltip div::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}
</style>
