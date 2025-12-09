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
const { pipelineObj, deletePipelineNode,onDragStart,onDrop, checkIfDefaultDestinationNode } = useDragAndDrop();
const menu = ref(false)
const showButtons = ref(false)
const showDeleteTooltip = ref(false)
let hideButtonsTimeout = null

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
  if (nodeError.errors && Array.isArray(nodeError.errors) && nodeError.errors.length > 0) {
    const errorText = nodeError.errors.join('\n\n');
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
    input: '#3b82f6',      // Blue
    output: '#22c55e',     // Green  
    default: '#f59e0b'     // Orange/Amber
  };
  return colorMap[ioType] || '#6b7280';
};

// Function to update edge colors on node hover
const updateEdgeColors = (nodeId, color, reset = false) => {
  if (pipelineObj.currentSelectedPipeline?.edges) {
    pipelineObj.currentSelectedPipeline.edges.forEach(edge => {
      if (edge.source === nodeId) {
        if (reset) {
          // Reset to default color
          edge.style = { 
            ...edge.style, 
            stroke: '#6b7280', 
            strokeWidth: 2 
          };
          edge.markerEnd = {
            ...edge.markerEnd,
            color: '#6b7280'
          };
        } else {
          // Apply node color to both edge and arrow
          edge.style = { 
            ...edge.style, 
            stroke: color, 
            strokeWidth: 2 
          };
          edge.markerEnd = {
            ...edge.markerEnd,
            color: color
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



const onFunctionClick = (data,event,id) =>{
  pipelineObj.userSelectedNode = data;
  const dataToOpen  =   {
    label: "Function",
    subtype: "function",
    io_type: "default",
    icon: "img:" + functionImage,
    tooltip: "Function Node",
    isSectionHeader: false,
  };
  pipelineObj.userClickedNode = id;
  onDragStart(event,dataToOpen)
  onDrop(event,{x:100,y:100});
  menu.value = false
}

const onConditionClick = (data,event,id) =>{
  data.label = id;
  pipelineObj.userSelectedNode = data;

  const dataToOpen  =   {
    label: "Condition",
    subtype: "condition",
    io_type: "default",
    icon: "img:" + conditionImage,
    tooltip: "Condition Node",
    isSectionHeader: false,
  }
  pipelineObj.userClickedNode = id
  onDragStart(event,dataToOpen)
  onDrop(event,{x:100,y:100});
  menu.value = false
}

const onStreamOutputClick = (data,event,id) =>{
  pipelineObj.userSelectedNode = data;

  if(!id){
    pipelineObj.userClickedNode = data.label;
  }
  else{
    pipelineObj.userClickedNode = id;
  }
  const dataToOpen  =    
  {
    label: "Stream",
    subtype: "stream",
    io_type: "output",
    icon: "img:" + streamOutputImage,
    tooltip: "Destination: Stream Node",
    isSectionHeader: false,
  }
  // pipelineObj.userClickedNode = id
  onDragStart(event,dataToOpen)
  onDrop(event,{x:100,y:100});
  menu.value = false
}
const onExternalDestinationClick = (data,event,id) =>{
  pipelineObj.userSelectedNode = data;

  if(!id){
    pipelineObj.userClickedNode = data.label;
  }
  else{
    pipelineObj.userClickedNode = id;
  }
  const dataToOpen  =    
  {
    label: "Remote",
    subtype: "remote_stream",
    io_type: "output",
    icon: "img:" + externalOutputImage,
    tooltip: "Destination: Remote Node",
    isSectionHeader: false,
  }
  // pipelineObj.userClickedNode = id
  onDragStart(event,dataToOpen)
  onDrop(event,{x:100,y:100});
  menu.value = false
}

const { t } = useI18n();
const router = useRouter();
const store = useStore();


const editNode = (id) => {
  //from id find the node from pipelineObj.currentSelectedPipelineData.nodes
  const fullNode = pipelineObj.currentSelectedPipeline.nodes.find(
    (node) => node.id === id
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
const  functionInfo = (data) =>  {

      return pipelineObj.functions[data.name] || null;
  }

const getTruncatedConditions = (conditionData) => {
  // Handle null/undefined
  if (!conditionData) return '';

  // Build preview string recursively
  const buildPreviewString = (node) => {
    if (!node) return '';

    // V2 Format: Group
    if (node.filterType === 'group' && node.conditions && Array.isArray(node.conditions)) {
      if (node.conditions.length === 0) return '';

      const parts = [];
      node.conditions.forEach((item, index) => {
        let conditionStr = '';

        if (item.filterType === 'group') {
          // Nested group
          const nestedPreview = buildPreviewString(item);
          if (nestedPreview) {
            conditionStr = `(${nestedPreview})`;
          }
        } else if (item.filterType === 'condition') {
          // Condition
          const column = item.column || 'field';
          const operator = item.operator || '=';
          const value = item.value !== undefined && item.value !== null && item.value !== ''
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

      return parts.join(' ');
    }

    // V1 Backend Format: OR node
    if (node.or && Array.isArray(node.or)) {
      const parts = node.or.map(item => {
        const nested = buildPreviewString(item);
        return nested ? `(${nested})` : '';
      }).filter(Boolean);
      return parts.join(' or ');
    }

    // V1 Backend Format: AND node
    if (node.and && Array.isArray(node.and)) {
      const parts = node.and.map(item => {
        const nested = buildPreviewString(item);
        return nested ? `(${nested})` : '';
      }).filter(Boolean);
      return parts.join(' and ');
    }

    // V1 Backend Format: NOT node
    if (node.not) {
      const nested = buildPreviewString(node.not);
      return nested ? `not (${nested})` : '';
    }

    // V1 Frontend Format: items array
    if (node.items && Array.isArray(node.items)) {
      const operator = node.label?.toLowerCase() || 'and';
      const parts = node.items.map(item => buildPreviewString(item)).filter(Boolean);
      return parts.join(` ${operator} `);
    }

    // Single condition
    if (node.column && node.operator) {
      const column = node.column || 'field';
      const operator = node.operator || '=';
      const value = node.value !== undefined && node.value !== null && node.value !== ''
        ? `'${node.value}'`
        : "''";
      return `${column} ${operator} ${value}`;
    }

    // V0 Format: Array
    if (Array.isArray(node)) {
      const parts = node.filter(c => c.column && c.operator).map(c => {
        const column = c.column || 'field';
        const operator = c.operator || '=';
        const value = c.value !== undefined && c.value !== null && c.value !== ''
          ? `'${c.value}'`
          : "''";
        return `${column} ${operator} ${value}`;
      });
      return parts.join(' and ');
    }

    return '';
  };

  const previewText = buildPreviewString(conditionData);

  // Truncate to 20 characters
  return previewText.length > 20 ? previewText.substring(0, 20) + '...' : previewText;
}

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
  if(props.data?.hasOwnProperty('node_type') && props.data.node_type === 'stream' && checkIfDefaultDestinationNode(id)){
    confirmDialogMeta.value.warningMessage = defaultDestinationNodeWarningMessage
  }
  else{
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
      class="q-pa-none btn-fixed-width"
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


      <div class="icon-container " style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1.5em"
          class="q-my-sm q-mr-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row node-label-text"
          align="left"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.name }} - <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
        </div>
      </div>

      <!-- Error Badge for Function Nodes -->
      <div
        v-if="hasNodeError"
        class="error-badge"
        @click.stop="navigateToFunction(data.name)"
      >
        <q-icon name="error" size="sm" />
        <span v-if="pipelineObj.currentSelectedPipeline?.last_error?.node_errors?.[id]?.error_count" class="error-count">
          {{ pipelineObj.currentSelectedPipeline.last_error.node_errors[id].error_count }}
        </span>
        <q-tooltip
          anchor="top middle"
          self="bottom middle"
          :offset="[0, 10]"
          max-width="600px"
          class="pipeline-error-tooltip"
        >
          <div style="max-height: 300px; overflow-y: auto;">
            {{ getNodeErrorInfo || 'Error occurred' }}
          </div>
        </q-tooltip>
      </div>

      <div v-show="showButtons" class="node-action-buttons" :data-test="`pipeline-node-${io_type}-actions`" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="handleActionButtonsEnter" @mouseleave="handleActionButtonsLeave">

        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click.stop="deleteNode(id)"
          class="node-action-btn delete-btn"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 15px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'stream'"
      class=" q-pa-none btn-fixed-width"
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
  

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
           size="1.5em"
          class="q-my-sm q-mr-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
        v-if=" data.stream_name &&  data.stream_name.hasOwnProperty('label')"
          class="row node-label-text"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.stream_type }} - {{   data.stream_name.label }}
        </div>
        <div
        v-else
          class="row node-label-text"
          style="
            text-align: left;
            text-wrap: wrap;
            width: auto;
            text-overflow: ellipsis;
          "
        >
          {{ data.stream_type }} - {{    data.stream_name }}
        </div>
      </div>
      <div v-show="showButtons" class="node-action-buttons" :data-test="`pipeline-node-${io_type}-actions`" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="handleActionButtonsEnter" @mouseleave="handleActionButtonsLeave">
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click.stop="deleteNode(id)"
          class="node-action-btn delete-btn"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 15px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>
    <div
      v-if="data.node_type == 'remote_stream'"
      class=" q-pa-none btn-fixed-width"
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


      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1.5em"
          class="q-my-sm q-mr-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row node-label-text"
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
      <div v-show="showButtons" class="node-action-buttons" :data-test="`pipeline-node-${io_type}-actions`" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="handleActionButtonsEnter" @mouseleave="handleActionButtonsLeave">
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click.stop="deleteNode(id)"
          class="node-action-btn delete-btn"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 15px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'query'"
      class=" q-pa-none btn-fixed-width"
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

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1.5em"
          class="q-my-sm q-mr-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row node-label-text"
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

      <div v-show="showButtons" class="node-action-buttons" :data-test="`pipeline-node-${io_type}-actions`" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="handleActionButtonsEnter" @mouseleave="handleActionButtonsLeave">
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click.stop="deleteNode(id)"
          class="node-action-btn delete-btn"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 15px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'condition'"
      class=" q-pa-none btn-fixed-width"
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

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1.5em"
          class="q-my-sm q-mr-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
    class="node-label-text"
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

      <div v-show="showButtons" class="node-action-buttons" :data-test="`pipeline-node-${io_type}-actions`" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="handleActionButtonsEnter" @mouseleave="handleActionButtonsLeave">
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click.stop="deleteNode(id)"
          class="node-action-btn delete-btn"
          :data-test="`pipeline-node-${io_type}-delete-btn`"
          @mouseenter="handleDeleteTooltipEnter"
          @mouseleave="handleDeleteTooltipLeave"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 15px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
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

<style lang="scss">
.node_handle_custom {
  width: 16px !important;
  height: 16px !important;
  border: 3px solid rgba(255, 255, 255, 0.9);
  border-radius: 50% !important;
  background: #6b7280;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  position: relative;

  &::before {
    content: '';
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

}

// Input nodes - Blue theme
.handle_input {
  background: #dbeafe !important;
  
  &::before {
    background: #3b82f6 !important;
  }
  
}

// Output nodes - Green theme  
.handle_output {
  background: #dcfce7 !important;
  
  &::before {
    background: #22c55e !important;
  }
  
}

// Transform nodes (default) - Orange theme
.handle_default {
  background: #fef3c7 !important;
  
  &::before {
    background: #f59e0b !important;
  }
  
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

// Remove only transform effects but keep visual styling
.o2vf_node_input,
.o2vf_node_output,
.o2vf_node_default,
.custom-btn {
  &:hover {
    transform: none !important;
  }
}

.menu-list{
  margin: 0px 10px;
  background-color: white;
}

// Node action buttons - hover to show with matching colors
.node-action-buttons {
  position: absolute;
  top: -30px;
  right: 0px;
  display: flex;
  gap: 6px;
  transition: all 0.3s ease;
  z-index: 10;
  padding: 5px 5px 10px 5px;
}

.node-action-btn {
  min-width: 20px !important;
  width: 20px !important;
  height: 20px !important;
  padding: 0 !important;
  border-radius: 4px !important;
  background: rgba(255, 255, 255, 0.95) !important;
  border: 1px solid var(--node-color) !important;
  color: var(--node-color) !important;
  transition: all 0.2s ease !important;
  
  .q-icon {
    font-size: 1.3em !important;
  }
  
  &:hover {
    background: var(--node-color) !important;
    color: white !important;
    transform: scale(1.1) !important;
  }
}


.delete-btn:hover {
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3) !important;
  background: #ef4444 !important;
  border-color: #ef4444 !important;
}

// Custom tooltips with arrow pointers
.custom-tooltip {
  position: fixed;
  background: #dc2626;
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  white-space: nowrap;
}


.delete-tooltip {
  background: #dc2626;
}

.tooltip-arrow {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid;
}

.delete-arrow {
  border-top-color: #dc2626;
}

// Pipeline error tooltip styling
.pipeline-error-tooltip {
  background: #ef4444 !important;
  color: white !important;
  font-size: 12px !important;
  white-space: pre-wrap !important;
  word-wrap: break-word !important;
  line-height: 1.5 !important;
  padding: 10px 14px !important;

  div {
    max-height: 300px;
    overflow-y: auto;

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.3);
      border-radius: 3px;

      &:hover {
        background: rgba(255, 255, 255, 0.5);
      }
    }
  }
}

// Error badge styling
.error-badge {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 20px;
  height: 20px;
  background: #ef4444;
  border: 2px solid white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 15;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.5);
  transition: all 0.2s ease;

  &:hover {
    transform: scale(1.2);
    box-shadow: 0 3px 10px rgba(239, 68, 68, 0.7);
    z-index: 20;
  }

  .q-icon {
    font-size: 0.9em !important;
    color: white !important;
  }

  .error-count {
    position: absolute;
    top: -6px;
    right: -6px;
    background: #dc2626;
    color: white;
    font-size: 9px;
    font-weight: bold;
    min-width: 14px;
    height: 14px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    border: 1.5px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
}

// Node label text styling
.node-label-text {
  font-size: 15px !important;
  font-weight: 900 !important;
  line-height: 1.4 !important;
}

// Function Details Dialog Styles
.function-details-dialog {
  .q-dialog__inner {
    padding: 0;
  }
}

// Condition Details Dialog Styles
.condition-details-dialog {
  .q-dialog__inner {
    padding: 0;
  }
}

// Query Details Dialog Styles
.query-details-dialog {
  .q-dialog__inner {
    padding: 0;
  }
}

.function-details-card {
  border-radius: 0;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
}

.function-info {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.function-name-section,
.function-timing-section,
.function-definition-section {
  .text-subtitle1 {
    color: #1976d2;
    margin-bottom: 8px;
    display: block;
  }
}

.function-name {
  font-size: 16px;
  font-weight: 500;
  color: #333;
  padding: 8px 12px;
  background-color: #f5f5f5;
  border-radius: 4px;
  border-left: 4px solid #1976d2;
}

.function-timing {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 4px;
  border-left: 4px solid #28a745;
}

.function-definition {
  background-color: #f5f5f5;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  overflow: hidden;
}

.function-code {
  color: #333;
  background-color: transparent;
  margin: 0;
  padding: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-x: auto;
}

// Dark mode support
.body--dark {
  .function-details-card {
    background-color: #1e1e1e;
    color: #ffffff;
    
    .q-card-section {
      background-color: #1e1e1e;
    }
  }
  
  .function-name {
    background-color: #2d2d2d;
    color: #ffffff;
    border-left-color: #64b5f6;
  }
  
  .function-timing {
    background-color: #2d2d2d;
    color: #ffffff;
    border-left-color: #4caf50;
  }
  
  .function-definition {
    background-color: #2d2d2d;
    border-color: #444;
  }
  
  .function-code {
    color: #ffffff;
  }
  
  .function-definition-section .text-subtitle1,
  .function-name-section .text-subtitle1,
  .function-timing-section .text-subtitle1 {
    color: #64b5f6;
  }
}

// Condition Details Styles
.condition-info {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.conditions-list-section {
  .text-subtitle1 {
    color: #1976d2;
    margin-bottom: 12px;
    display: block;
  }
}

.conditions-container {
  background-color: #f5f5f5;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  padding: 16px;
}

.condition-item {
  margin-bottom: 12px;
  
  &:last-child {
    margin-bottom: 0;
  }
}

.condition-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background-color: #ffffff;
  border-radius: 4px;
  border-left: 4px solid #1976d2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.condition-field {
  font-weight: 600;
  color: #1976d2;
  min-width: 80px;
}

.condition-operator {
  font-weight: 500;
  color: #666;
  background-color: #e3f2fd;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 12px;
}

.condition-value {
  font-weight: 500;
  color: #333;
  background-color: #f0f0f0;
  padding: 2px 8px;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
}

.and-operator {
  display: flex;
  justify-content: center;
  margin: 8px 0;
}

.and-text {
  background-color: #28a745;
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 12px;
  text-align: center;
  min-width: 40px;
}

// Dark mode support for conditions
.body--dark {
  .conditions-container {
    background-color: #2d2d2d;
    border-color: #444;
  }
  
  .condition-row {
    background-color: #3a3a3a;
    border-left-color: #64b5f6;
  }
  
  .condition-field {
    color: #64b5f6;
  }
  
  .condition-operator {
    background-color: #1e3a8a;
    color: #bfdbfe;
  }
  
  .condition-value {
    background-color: #4a4a4a;
    color: #ffffff;
  }
  
  .conditions-list-section .text-subtitle1 {
    color: #64b5f6;
  }
}

// Query Details Styles
.query-info {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.query-type-section,
.query-content-section,
.trigger-details-section {
  .text-subtitle1 {
    color: #1976d2;
    margin-bottom: 12px;
    display: block;
  }
}

.query-type {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  padding: 8px 12px;
  background-color: #e3f2fd;
  border-radius: 4px;
  border-left: 4px solid #1976d2;
  text-align: center;
  max-width: 100px;
}

.query-content {
  background-color: #f5f5f5;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.query-code {
  color: #333;
  background-color: transparent;
  margin: 0;
  padding: 16px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-x: auto;
  min-height: 80px;
  border: none;
  resize: none;
}

.trigger-details {
  background-color: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.trigger-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #e9ecef;
  
  &:last-child {
    border-bottom: none;
  }
}

.trigger-label {
  font-weight: 600;
  color: #495057;
  min-width: 80px;
}

.trigger-value {
  font-weight: 500;
  color: #333;
  background-color: #ffffff;
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid #dee2e6;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
}

// Dark mode support for query dialog
.body--dark {
  .query-type {
    background-color: #1e3a8a;
    color: #bfdbfe;
    border-left-color: #64b5f6;
  }
  
  .query-content {
    background-color: #2d2d2d;
    border-color: #444;
  }
  
  .query-code {
    color: #ffffff;
    background-color: #2d2d2d;
  }
  
  .trigger-details {
    background-color: #2d2d2d;
    border-color: #444;
  }
  
  .trigger-row {
    border-bottom-color: #444;
  }
  
  .trigger-label {
    color: #e9ecef;
  }
  
  .trigger-value {
    background-color: #3a3a3a;
    border-color: #555;
    color: #ffffff;
  }
  
  .query-type-section .text-subtitle1,
  .query-content-section .text-subtitle1,
  .trigger-details-section .text-subtitle1 {
    color: #64b5f6;
  }
}

</style>
