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
import { Handle } from "@vue-flow/core";
import useDragAndDrop from "./useDnD";
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { getImageURL } from "@/utils/zincutils";
import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";

import config from "@/aws-exports";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const functionImage = getImageURL("images/pipeline/function.svg");
const streamOutputImage = getImageURL("images/pipeline/outputStream.svg");
const conditionImage = getImageURL("images/pipeline/condition.svg");
const externalOutputImage = getImageURL("images/pipeline/externalOutput.svg");

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
  onDragStart,
  onDrop,
  checkIfDefaultDestinationNode,
} = useDragAndDrop();
const menu = ref(false);
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

// Edge color mapping for different node types.
//
// TODO(design-tokens): these are the same three node-TYPE roles the handle CSS
// below now takes from --color-status-{info,positive,warning} — but they CANNOT
// be CSS custom-property references here. vue-flow builds its arrowhead marker
// id from this value (getMarkerId → `color=<value>&type=…`) and then references
// it as `url(#<id>)`; a custom-property reference puts parentheses inside that
// url(), which terminates it early and breaks the arrowhead. Resolving the token
// to a literal (getComputedStyle on :root) at call time is the fix, and would
// also give these edges the dark-mode step they currently lack.
const getNodeColor = (ioType) => {
  const colorMap = {
    input: "#3b82f6", // Blue    — pairs with --color-status-info-text
    output: "#22c55e", // Green   — pairs with --color-status-positive
    default: "#f59e0b", // Amber   — pairs with --color-status-warning-text
  };
  return colorMap[ioType] || "#6b7280";
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

const onFunctionClick = (data, event, id) => {
  pipelineObj.userSelectedNode = data;
  const dataToOpen = {
    label: "Function",
    subtype: "function",
    io_type: "default",
    icon: "img:" + functionImage,
    tooltip: "Function Node",
    isSectionHeader: false,
  };
  pipelineObj.userClickedNode = id;
  onDragStart(event, dataToOpen);
  onDrop(event, { x: 100, y: 100 });
  menu.value = false;
};

const onConditionClick = (data, event, id) => {
  data.label = id;
  pipelineObj.userSelectedNode = data;

  const dataToOpen = {
    label: "Condition",
    subtype: "condition",
    io_type: "default",
    icon: "img:" + conditionImage,
    tooltip: "Condition Node",
    isSectionHeader: false,
  };
  pipelineObj.userClickedNode = id;
  onDragStart(event, dataToOpen);
  onDrop(event, { x: 100, y: 100 });
  menu.value = false;
};

const onStreamOutputClick = (data, event, id) => {
  pipelineObj.userSelectedNode = data;

  if (!id) {
    pipelineObj.userClickedNode = data.label;
  } else {
    pipelineObj.userClickedNode = id;
  }
  const dataToOpen = {
    label: "Stream",
    subtype: "stream",
    io_type: "output",
    icon: "img:" + streamOutputImage,
    tooltip: "Destination: Stream Node",
    isSectionHeader: false,
  };
  // pipelineObj.userClickedNode = id
  onDragStart(event, dataToOpen);
  onDrop(event, { x: 100, y: 100 });
  menu.value = false;
};
const onExternalDestinationClick = (data, event, id) => {
  pipelineObj.userSelectedNode = data;

  if (!id) {
    pipelineObj.userClickedNode = data.label;
  } else {
    pipelineObj.userClickedNode = id;
  }
  const dataToOpen = {
    label: "Remote",
    subtype: "remote_stream",
    io_type: "output",
    icon: "img:" + externalOutputImage,
    tooltip: "Destination: Remote Node",
    isSectionHeader: false,
  };
  // pipelineObj.userClickedNode = id
  onDragStart(event, dataToOpen);
  onDrop(event, { x: 100, y: 100 });
  menu.value = false;
};

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

const getTruncatedConditions = (conditionData) => {
  // Handle null/undefined
  if (!conditionData) return "";

  // Build preview string recursively
  const buildPreviewString = (node) => {
    if (!node) return "";

    // V2 Format: Group
    if (
      node.filterType === "group" &&
      node.conditions &&
      Array.isArray(node.conditions)
    ) {
      if (node.conditions.length === 0) return "";

      const parts = [];
      node.conditions.forEach((item, index) => {
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
    if (node.or && Array.isArray(node.or)) {
      const parts = node.or
        .map((item) => {
          const nested = buildPreviewString(item);
          return nested ? `(${nested})` : "";
        })
        .filter(Boolean);
      return parts.join(" or ");
    }

    // V1 Backend Format: AND node
    if (node.and && Array.isArray(node.and)) {
      const parts = node.and
        .map((item) => {
          const nested = buildPreviewString(item);
          return nested ? `(${nested})` : "";
        })
        .filter(Boolean);
      return parts.join(" and ");
    }

    // V1 Backend Format: NOT node
    if (node.not) {
      const nested = buildPreviewString(node.not);
      return nested ? `not (${nested})` : "";
    }

    // V1 Frontend Format: items array
    if (node.items && Array.isArray(node.items)) {
      const operator = node.label?.toLowerCase() || "and";
      const parts = node.items
        .map((item) => buildPreviewString(item))
        .filter(Boolean);
      return parts.join(` ${operator} `);
    }

    // Single condition
    if (node.column && node.operator) {
      const column = node.column || "field";
      const operator = node.operator || "=";
      const value =
        node.value !== undefined && node.value !== null && node.value !== ""
          ? `'${node.value}'`
          : "''";
      return `${column} ${operator} ${value}`;
    }

    // V0 Format: Array
    if (Array.isArray(node)) {
      const parts = node
        .filter((c) => c.column && c.operator)
        .map((c) => {
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
  <!-- Input Handle (Target) -->
  <div class="">
    <Handle
      v-if="io_type == 'output' || io_type === 'default'"
      id="input"
      type="target"
      :position="'top'"
      :class="`node_handle_custom handle_${io_type}`"
      :data-test="`pipeline-node-${io_type}-input-handle`"
    />

    <div
      v-if="data.node_type == 'function'"
      :data-test="`pipeline-node-${io_type}-function-node`"
      data-node-type="function"
      class="btn-fixed-width py-1.25 px-0 w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          class="flex text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
          align="left"
        >
          {{ data.name }} -
          <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
        </div>
      </div>

      <!-- Error Badge for Function Nodes -->
      <div
        v-if="hasNodeError"
        data-test="pipeline-node-error-badge"
        class="absolute -top-3 -right-3 w-5 h-5 bg-status-negative border-2 border-white rounded-full flex items-center justify-center cursor-pointer z-[15] shadow-[0_0.125rem_0.375rem_color-mix(in_srgb,var(--color-error-500)_50%,transparent)] transition-all duration-200 hover:scale-120 hover:shadow-[0_0.1875rem_0.625rem_color-mix(in_srgb,var(--color-error-500)_70%,transparent)] hover:z-20"
        @click.stop="navigateToFunction(data.name)"
      >
        <OIcon name="error" size="sm" />
        <span
          data-test="pipeline-node-error-count"
          v-if="
            pipelineObj.currentSelectedPipeline?.last_error?.node_errors?.[id]
              ?.error_count
          "
          class="absolute -top-1.5 -right-1.5 bg-status-negative text-button-destructive-foreground text-3xs font-bold min-w-3.5 h-3.5 rounded-full flex items-center justify-center px-0.75 border-[1.5px] border-solid border-white shadow-[0_1px_0.1875rem_color-mix(in_srgb,var(--color-black)_40%,transparent)]"
        >
          {{
            pipelineObj.currentSelectedPipeline.last_error.node_errors[id]
              .error_count
          }}
        </span>
        <OTooltip side="top" align="center" :sideOffset="10" max-width="600px">
          <template #content>
            <div class="max-h-75 overflow-y-auto">
              {{ getNodeErrorInfo || "Error occurred" }}
            </div>
          </template>
        </OTooltip>
      </div>

      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'stream'"
      :data-test="`pipeline-node-${io_type}-stream-node`"
      data-node-type="stream"
      class="btn-fixed-width py-1.25 px-0 w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          v-if="data.stream_name && data.stream_name.hasOwnProperty('label')"
          class="flex text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          {{ data.stream_type }} - {{ data.stream_name.label }}
        </div>
        <div
          v-else
          class="flex text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>
      </div>
      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>
    <div
      v-if="data.node_type == 'remote_stream'"
      :data-test="`pipeline-node-${io_type}-remote-stream-node`"
      data-node-type="remote_stream"
      class="btn-fixed-width py-1.25 px-0 w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          class="flex text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          {{ data.destination_name }}
        </div>
      </div>
      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'query'"
      :data-test="`pipeline-node-${io_type}-query-node`"
      data-node-type="query"
      class="btn-fixed-width py-1.25 px-0 w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          class="flex text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>
      </div>

      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'condition'"
      :data-test="`pipeline-node-${io_type}-condition-node`"
      data-node-type="condition"
      class="p-0 btn-fixed-width w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          class="text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          {{ getTruncatedConditions(data.condition || data.conditions) }}
        </div>
      </div>

      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>

    <!-- LLM Evaluation Node -->
    <div
      v-if="data.node_type == 'llm_evaluation'"
      :data-test="`pipeline-node-${io_type}-llm-evaluation-node`"
      data-node-type="llm_evaluation"
      class="p-0 btn-fixed-width w-fit flex items-center border-none cursor-pointer"
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
      <div class="o2-scroll-container overflow-auto rounded-default">
        <div
          class="text-sm! font-bold! leading-[1.4]! text-left text-wrap w-auto text-ellipsis"
        >
          <span>{{ data.name || "LLM Evaluation" }}</span>
          <span
            v-if="data.sampling_rate"
            class="text-[0.85em] text-text-secondary ml-2"
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
                <div class="mt-2 text-xs text-text-secondary">
                  {{ t("pipeline.llmEvaluationDescription") }}
                </div>
              </div>
            </template>
          </OTooltip>
        </div>
      </div>

      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 flex gap-1.5 transition-all duration-300 z-10 pt-1.25 px-1.25 pb-2.5 node-action-buttons"
        :data-test="`pipeline-node-${io_type}-actions`"
        :style="{ '--node-color': getNodeColor(io_type) }"
        @mouseenter="handleActionButtonsEnter"
        @mouseleave="handleActionButtonsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          @click.stop="deleteNode(id)"
          class="min-w-5! w-5! h-5! p-0! rounded-default! bg-[color-mix(in_srgb,var(--color-white)_95%,transparent)]! border! border-(--node-color)! text-(--node-color)! transition-all! duration-200! hover:bg-error-500! hover:border-error-500! hover:text-white! hover:scale-110! hover:shadow-[0_0.125rem_0.5rem_color-mix(in_srgb,var(--color-error-500)_30%,transparent)]!"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
        <div
          v-if="showDeleteTooltip"
          class="fixed left-3.75 bg-status-negative text-button-destructive-foreground py-1.5 px-2.5 rounded-default text-2xs z-[1000] shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)] pointer-events-none whitespace-nowrap"
        >
          Delete Node
          <div class="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-status-negative"></div>
        </div>
      </div>
    </div>

    <Handle
      v-if="io_type === 'input' || io_type === 'default'"
      id="output"
      type="source"
      :position="'bottom'"
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

<style scoped>
/* keep(lib-override:vue-flow): styles vue-flow Handle DOM (classes are built dynamically as `handle_${io_type}`, also targeted by PipelineView's tooltip preview) and the vue-flow-generated .vue-flow__node-custom wrapper; !important is required to beat vue-flow core CSS */
/* Node-TYPE colours use the SAME status tokens PipelineView's read-only tooltip
   preview already applies to these exact classes (see its :deep(.handle_input)
   rules): input = info, output = positive/success, transform = warning. */
.node_handle_custom {
  width: 1rem !important;
  height: 1rem !important;
  border: 0.1875rem solid color-mix(in srgb, var(--color-white) 90%, transparent);
  border-radius: 50% !important;
  background: var(--color-border-strong);
  box-shadow: 0 0.125rem 0.5rem color-mix(in srgb, var(--color-black) 15%, transparent);
  transition: all 0.3s ease;
}

.node_handle_custom::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transition: all 0.3s ease;
}

/* Input nodes - info theme */
.handle_input {
  background: var(--color-status-info-bg) !important;
}

.handle_input::before {
  background: var(--color-status-info-text) !important;
}

/* Output nodes - success theme */
.handle_output {
  background: var(--color-status-success-bg) !important;
}

.handle_output::before {
  background: var(--color-status-positive) !important;
}

/* Transform nodes (default) - warning theme */
.handle_default {
  background: var(--color-status-warning-bg) !important;
}

.handle_default::before {
  background: var(--color-status-warning-text) !important;
}

:global(.vue-flow__node-custom) {
  padding: 0.625rem;
  border-radius: 0.1875rem;
  width: 9.375rem;
  font-size: var(--text-xs);
  text-align: center;
  border-width: 1px;
  border-style: solid;
  color: var(--vf-node-text);
  background-color: var(--vf-node-bg);
  border-color: var(--vf-node-color);
}
</style>
