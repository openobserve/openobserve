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

<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import type { PropType } from "vue";
import useDragAndDrop from "./useDnD";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

// Data payload carried by a pipeline node (shape varies by node_type).
interface NodeData {
  node_type?: string;
  name?: string;
  after_flatten?: boolean;
  stream_type?: string;
  stream_name?: string | { label?: string; value?: string };
  destination_name?: string;
  sampling_rate?: number;
  condition?: unknown;
  conditions?: unknown;
}

interface PipelineNode {
  id: string;
  io_type?: string;
  data: NodeData;
}

interface PipelineEdge {
  source: string;
  style?: Record<string, unknown>;
  markerEnd?: Record<string, unknown>;
}

interface NodeErrorInfo {
  errors?: string[];
  error_count?: number;
}

interface NodeType {
  subtype?: string;
  io_type?: string;
  icon?: string;
}

// One condition group / node in a saved condition tree (multiple legacy formats).
interface ConditionNode {
  filterType?: string;
  conditions?: ConditionNode[];
  column?: string;
  operator?: string;
  value?: string | number | boolean | null;
  logicalOperator?: string;
  or?: ConditionNode[];
  and?: ConditionNode[];
  not?: ConditionNode;
  items?: ConditionNode[];
  label?: string;
}

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  data: {
    type: Object as PropType<NodeData>,
    required: true,
  },
  io_type: {
    type: String,
  },
});

defineEmits(["delete:node"]);
const {
  pipelineObj,
  deletePipelineNode,
  checkIfDefaultDestinationNode,
} = useDragAndDrop();
const showButtons = ref(false);
const showDeleteTooltip = ref(false);
let hideButtonsTimeout: ReturnType<typeof window.setTimeout> | null = null;

// last_error is set at runtime but absent from the base pipeline literal type;
// narrow the dynamic value instead of asserting a shape.
const getLastError = (): {
  node_errors?: Record<string, NodeErrorInfo>;
} | null => {
  const pipeline: unknown = pipelineObj.currentSelectedPipeline;
  if (!pipeline || typeof pipeline !== "object" || !("last_error" in pipeline))
    return null;
  const lastError: unknown = pipeline.last_error;
  if (!lastError || typeof lastError !== "object") return null;
  const nodeErrors =
    "node_errors" in lastError ? lastError.node_errors : undefined;
  return { node_errors: nodeErrors as Record<string, NodeErrorInfo> };
};

// Check if current node has errors
const hasNodeError = computed(() => {
  const lastError = getLastError();
  if (!lastError || !lastError.node_errors) return false;

  // node_errors is a JSON object with node IDs as keys
  const nodeErrors = lastError.node_errors;
  return nodeErrors && props.id !== undefined && nodeErrors[props.id];
});

// Get error info for current node
const getNodeErrorInfo = computed(() => {
  const lastError = getLastError();
  if (!lastError || !lastError.node_errors || props.id === undefined)
    return null;

  const nodeError = lastError.node_errors[props.id];
  if (!nodeError) return null;

  // node_errors is an object with structure: { node_id: { errors: [...], error_count: N, ... } }
  if (
    nodeError.errors &&
    Array.isArray(nodeError.errors) &&
    nodeError.errors.length > 0
  ) {
    const errorText = nodeError.errors.join("\n\n");
    const errorCount = nodeError.error_count ?? 0;
    if (errorCount > nodeError.errors.length) {
      return `${errorText}\n\n... and ${errorCount - nodeError.errors.length} more errors`;
    }
    return errorText;
  }

  return null;
});

// stream_name is either a plain string or a { label, value } object.
const streamNameLabel = computed(() => {
  const streamName = props.data.stream_name;
  return typeof streamName === "object" ? streamName?.label : "";
});

// Error count for the current node's badge (read via the typed last_error view).
const nodeErrorCount = computed(() => {
  const lastError = getLastError();
  if (!lastError?.node_errors || props.id === undefined) return undefined;
  return lastError.node_errors[props.id]?.error_count;
});

// Edge color mapping for different node types
const getNodeColor = (ioType: string | undefined) => {
  const colorMap: Record<string, string> = {
    input: "#3b82f6", // Blue
    output: "#22c55e", // Green
    default: "#f59e0b", // Orange/Amber
  };
  return (ioType && colorMap[ioType]) || "#6b7280";
};

// Function to update edge colors on node hover
const updateEdgeColors = (
  nodeId: string | undefined,
  color: string | null,
  reset = false,
) => {
  if (pipelineObj.currentSelectedPipeline?.edges) {
    pipelineObj.currentSelectedPipeline.edges.forEach((edge: PipelineEdge) => {
      if (edge.source === nodeId) {
        if (reset) {
          // Reset to default color
          edge.style = {
            ...edge.style,
            stroke: "#6b7280",
            strokeWidth: 2,
          };
          edge.markerEnd = {
            ...edge.markerEnd,
            color: "#6b7280",
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
const handleNodeHover = (
  nodeId: string | undefined,
  ioType: string | undefined,
) => {
  const color = getNodeColor(ioType);
  updateEdgeColors(nodeId, color, false);

  // Clear any existing timeout
  if (hideButtonsTimeout) {
    window.clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }

  showButtons.value = true;
};

const handleNodeLeave = (nodeId: string | undefined) => {
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
const navigateToFunction = (functionName: string | undefined) => {
  const errorInfo = getNodeErrorInfo.value;
  const query: {
    action: string;
    name: string | undefined;
    org_identifier: string;
    error?: string;
  } = {
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

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const editNode = (id: string) => {
  //from id find the node from pipelineObj.currentSelectedPipelineData.nodes
  const fullNode = pipelineObj.currentSelectedPipeline.nodes.find(
    (node: PipelineNode) => node.id === id,
  );
  pipelineObj.isEditNode = true;
  pipelineObj.currentSelectedNodeData = fullNode;
  pipelineObj.currentSelectedNodeID = id;
  pipelineObj.dialog.name = fullNode.data.node_type;
  pipelineObj.dialog.show = true;
};

const deleteNode = (id: string) => {
  openCancelDialog(id);
};

const getTruncatedConditions = (conditionData: unknown) => {
  // Handle null/undefined
  if (!conditionData) return "";

  // Build preview string recursively
  const buildPreviewString = (node: unknown): string => {
    if (!node) return "";

    // V0 Format: Array (checked first so the rest narrows to a single node)
    if (Array.isArray(node)) {
      const parts = node
        .filter((c: ConditionNode) => c.column && c.operator)
        .map((c: ConditionNode) => {
          const column = c.column || "field";
          const operator = c.operator || "=";
          const value =
            c.value !== undefined && c.value !== null && c.value !== ""
              ? `'${c.value}'`
              : "''";
          return `${column} ${operator} ${value}`;
        });
      return parts.join(" and ");
    }

    if (typeof node !== "object") return "";
    const conditionNode = node as ConditionNode;

    // V2 Format: Group
    if (
      conditionNode.filterType === "group" &&
      conditionNode.conditions &&
      Array.isArray(conditionNode.conditions)
    ) {
      if (conditionNode.conditions.length === 0) return "";

      const parts: string[] = [];
      conditionNode.conditions.forEach((item: ConditionNode, index: number) => {
        let conditionStr = "";

        if (item.filterType === "group") {
          // Nested group
          const nestedPreview = buildPreviewString(item);
          if (nestedPreview) {
            conditionStr = `(${nestedPreview})`;
          }
        } else if (item.filterType === "condition") {
          // Condition
          const column = item.column || "field";
          const operator = item.operator || "=";
          const value =
            item.value !== undefined && item.value !== null && item.value !== ""
              ? `'${item.value}'`
              : "''";
          conditionStr = `${column} ${operator} ${value}`;
        }

        // Add logical operator before condition (except for first)
        if (index > 0 && item.logicalOperator) {
          parts.push(`${item.logicalOperator.toLowerCase()} ${conditionStr}`);
        } else {
          parts.push(conditionStr);
        }
      });

      return parts.join(" ");
    }

    // V1 Backend Format: OR node
    if (conditionNode.or && Array.isArray(conditionNode.or)) {
      const parts = conditionNode.or
        .map((item: ConditionNode) => {
          const nested = buildPreviewString(item);
          return nested ? `(${nested})` : "";
        })
        .filter(Boolean);
      return parts.join(" or ");
    }

    // V1 Backend Format: AND node
    if (conditionNode.and && Array.isArray(conditionNode.and)) {
      const parts = conditionNode.and
        .map((item: ConditionNode) => {
          const nested = buildPreviewString(item);
          return nested ? `(${nested})` : "";
        })
        .filter(Boolean);
      return parts.join(" and ");
    }

    // V1 Backend Format: NOT node
    if (conditionNode.not) {
      const nested = buildPreviewString(conditionNode.not);
      return nested ? `not (${nested})` : "";
    }

    // V1 Frontend Format: items array
    if (conditionNode.items && Array.isArray(conditionNode.items)) {
      const operator = conditionNode.label?.toLowerCase() || "and";
      const parts = conditionNode.items
        .map((item: ConditionNode) => buildPreviewString(item))
        .filter(Boolean);
      return parts.join(` ${operator} `);
    }

    // Single condition
    if (conditionNode.column && conditionNode.operator) {
      const column = conditionNode.column || "field";
      const operator = conditionNode.operator || "=";
      const value =
        conditionNode.value !== undefined &&
        conditionNode.value !== null &&
        conditionNode.value !== ""
          ? `'${conditionNode.value}'`
          : "''";
      return `${column} ${operator} ${value}`;
    }

    return "";
  };

  const previewText = buildPreviewString(conditionData);

  // Truncate to 20 characters
  return previewText.length > 20
    ? previewText.substring(0, 20) + "..."
    : previewText;
};

const confirmDialogMeta = ref({
  show: false,
  title: "",
  message: "",
  data: null,
  warningMessage: "",
  onConfirm: () => {},
});

const openCancelDialog = (id: string) => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("common.delete");
  confirmDialogMeta.value.message = "Are you sure you want to delete node?";
  //here we will check if the destination node is added by default if yes then we will show a warning message to the user
  if (
    Object.prototype.hasOwnProperty.call(props.data ?? {}, "node_type") &&
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

function getIcon(data: NodeData | undefined, ioType: string | undefined) {
  const searchTerm = data?.node_type;
  // nodeTypes is declared as an empty literal (never[]) in the shared store;
  // narrow through unknown to its runtime element shape.
  const nodeTypes = pipelineObj.nodeTypes as unknown as NodeType[];
  const node = nodeTypes.find(
    (node: NodeType) =>
      node.subtype === searchTerm && node.io_type === ioType,
  );
  return node ? node.icon : undefined;
}
</script>

<template>
  <!-- Input Handle (Target) -->
  <div class="">
    <Handle
      v-if="io_type == 'output' || io_type === 'default'"
      id="input"
      type="target"
      :position="Position.Top"
      :class="`node_handle_custom handle_${io_type}`"
      :data-test="`pipeline-node-${io_type}-input-handle`"
    />

    <div
      v-if="data.node_type == 'function'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-function-node`"
      data-node-type="function"
      style="
        padding: 5px 0px;
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          align="left"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.name }} -
          <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
        </div>
      </div>

      <!-- Error Badge for Function Nodes -->
      <div
        v-if="hasNodeError"
        data-test="pipeline-node-error-badge"
        class="absolute top-[-12px] right-[-12px] w-[20px] h-[20px] bg-[#ef4444] border-2 border-white rounded-full flex items-center justify-center cursor-pointer z-[15] shadow-[0_2px_6px_rgba(239,68,68,0.5)] transition-all duration-200 error-badge"
        @click.stop="navigateToFunction(data.name)"
      >
        <OIcon name="error" size="sm" />
        <span
          data-test="pipeline-node-error-count"
          v-if="nodeErrorCount"
          class="absolute top-[-6px] right-[-6px] bg-[#dc2626] text-white text-[9px] font-bold min-w-[14px] h-[14px] rounded-[7px] flex items-center justify-center px-[3px] border-[1.5px] border-solid border-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
        >
          {{ nodeErrorCount }}
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
    </div>

    <div
      v-if="data.node_type == 'stream'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-stream-node`"
      data-node-type="stream"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 0px;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          v-if="data.stream_name && Object.prototype.hasOwnProperty.call(data.stream_name, 'label')"
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.stream_type }} - {{ streamNameLabel }}
        </div>
        <div
          v-else
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>
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
    </div>
    <div
      v-if="data.node_type == 'remote_stream'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-remote-stream-node`"
      data-node-type="remote_stream"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 0px;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.destination_name }}
        </div>
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
    </div>

    <div
      v-if="data.node_type == 'query'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-query-node`"
      data-node-type="query"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 0px;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          class="flex text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>
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
    </div>

    <div
      v-if="data.node_type == 'condition'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-condition-node`"
      data-node-type="condition"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          class="text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ getTruncatedConditions(data.condition || data.conditions) }}
        </div>
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
    </div>

    <!-- LLM Evaluation Node -->
    <div
      v-if="data.node_type == 'llm_evaluation'"
      class="p-0 btn-fixed-width"
      :data-test="`pipeline-node-${io_type}-llm-evaluation-node`"
      data-node-type="llm_evaluation"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
      @click="editNode(id)"
    >
      <div class="icon-container flex items-center">
        <!-- Icon -->
        <OIcon
          :name="getIcon(data, io_type)"
          size="md"
          class="my-2 mr-2"
        />
      </div>

      <!-- Separator -->
      <OSeparator vertical class="mr-2" />

      <!-- Label -->
      <div class="o2-scroll-container">
        <div
          class="text-[15px]! font-bold! leading-[1.4]!"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          <span>{{ data.name || "LLM Evaluation" }}</span>
          <span
            v-if="data.sampling_rate"
            style="font-size: 0.85em; color: #666; margin-left: 8px"
          >
            ({{ (data.sampling_rate * 100).toFixed(0) }}%)
          </span>
          <OTooltip
            side="top"
            align="center"
            :sideOffset="10"
            max-width="400px"
          >
            <template #content>
              <div class="p-2">
                <div class="font-bold mb-2">
                  {{ t("pipeline.llmEvaluationNodeTitle") }}
                </div>
                <div>
                  <strong>{{ t("pipeline.nameLabel") }}:</strong>
                  {{ data.name || "evaluate" }}
                </div>
                <div v-if="data.sampling_rate">
                  <strong>{{ t("pipeline.samplingLabel") }}:</strong>
                  {{ (data.sampling_rate * 100).toFixed(1) }}%
                  {{ t("pipeline.samplingOfTraces") }}
                </div>
                <div v-else>
                  <strong>{{ t("pipeline.samplingLabel") }}:</strong>
                  {{ t("pipeline.samplingAllTraces") }}
                </div>
                <div class="mt-2 text-xs text-gray-400">
                  {{ t("pipeline.llmEvaluationDescription") }}
                </div>
              </div>
            </template>
          </OTooltip>
        </div>
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
    </div>

    <Handle
      v-if="io_type === 'input' || io_type === 'default'"
      id="output"
      type="source"
      :position="Position.Bottom"
      :class="`node_handle_custom handle_${io_type}`"
      :data-test="`pipeline-node-${io_type}-output-handle`"
    />
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
.node_handle_custom {
  width: 16px !important;
  height: 16px !important;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50% !important;
  background: #6b7280;
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
  background: #374151;
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
