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
import { ref } from "vue";
import { useI18n } from "vue-i18n";
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
const showEditTooltip = ref(false)
const showDeleteTooltip = ref(false)
let hideButtonsTimeout = null

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
    clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }
  
  showButtons.value = true;
};

const handleNodeLeave = (nodeId) => {
  updateEdgeColors(nodeId, null, true);
  
  // Add delay before hiding buttons
  hideButtonsTimeout = setTimeout(() => {
    showButtons.value = false;
  }, 200);
};

const hanldeMouseOver = () => {
  console.log("mouse over")
}


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
    />

    <div
      v-if="data.node_type == 'function'"
      class="q-pa-none btn-fixed-width"
      style="
      padding: 5px 2px;
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
    >

    <q-tooltip :style="{ maxWidth: '300px', whiteSpace: 'pre-wrap' }">
  <div>
    <strong>Name:</strong> {{ functionInfo(data).name }}<br />
    <strong>Definition:</strong><br />
    <div style="border: 1px solid lightgray; padding: 4px; border-radius: 1px ;">
      {{ functionInfo(data).function }}
    </div>
  </div>
</q-tooltip>

      <div class="icon-container " style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1em"
          class="q-ma-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row"
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
      <div v-show="showButtons" class="node-action-buttons" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="clearTimeout(hideButtonsTimeout)" @mouseleave="hideButtonsTimeout = setTimeout(() => showButtons = false, 200)">
        <q-btn
          flat
          round
          dense
          icon="edit"
          size="0.6em"
          @click="editNode(id)"
          class="node-action-btn edit-btn"
          @mouseenter="showEditTooltip = true"
          @mouseleave="showEditTooltip = false"
        />
        <div v-if="showEditTooltip" class="custom-tooltip edit-tooltip" :style="{ backgroundColor: getNodeColor(io_type) }" style="left: 15px;">
          Edit Node
          <div class="tooltip-arrow" :style="{ borderTopColor: getNodeColor(io_type) }"></div>
        </div>
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click="deleteNode(id)"
          class="node-action-btn delete-btn"
          @mouseenter="showDeleteTooltip = true"
          @mouseleave="showDeleteTooltip = false"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 41px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'stream'"
      class=" q-pa-none btn-fixed-width"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 2px;

      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
     >
  

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1em"
          class="q-ma-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
        v-if=" data.stream_name &&  data.stream_name.hasOwnProperty('label')"
          class="row"
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
          class="row"
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
      <div v-show="showButtons" class="node-action-buttons" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="clearTimeout(hideButtonsTimeout)" @mouseleave="hideButtonsTimeout = setTimeout(() => showButtons = false, 200)">
        <q-btn
          flat
          round
          dense
          icon="edit"
          size="0.6em"
          @click="editNode(id)"
          class="node-action-btn edit-btn"
          @mouseenter="showEditTooltip = true"
          @mouseleave="showEditTooltip = false"
        />
        <div v-if="showEditTooltip" class="custom-tooltip edit-tooltip" :style="{ backgroundColor: getNodeColor(io_type) }" style="left: 15px;">
          Edit Node
          <div class="tooltip-arrow" :style="{ borderTopColor: getNodeColor(io_type) }"></div>
        </div>
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click="deleteNode(id)"
          class="node-action-btn delete-btn"
          @mouseenter="showDeleteTooltip = true"
          @mouseleave="showDeleteTooltip = false"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 41px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>
    <div
      v-if="data.node_type == 'remote_stream'"
      class=" q-pa-none btn-fixed-width"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 2px;

      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
     >


      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1em"
          class="q-ma-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row"
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
      <div v-show="showButtons" class="node-action-buttons" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="clearTimeout(hideButtonsTimeout)" @mouseleave="hideButtonsTimeout = setTimeout(() => showButtons = false, 200)">
        <q-btn
          flat
          round
          dense
          icon="edit"
          size="0.6em"
          @click="editNode(id)"
          class="node-action-btn edit-btn"
          @mouseenter="showEditTooltip = true"
          @mouseleave="showEditTooltip = false"
        />
        <div v-if="showEditTooltip" class="custom-tooltip edit-tooltip" :style="{ backgroundColor: getNodeColor(io_type) }" style="left: 15px;">
          Edit Node
          <div class="tooltip-arrow" :style="{ borderTopColor: getNodeColor(io_type) }"></div>
        </div>
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click="deleteNode(id)"
          class="node-action-btn delete-btn"
          @mouseenter="showDeleteTooltip = true"
          @mouseleave="showDeleteTooltip = false"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 41px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'query'"
      class=" q-pa-none btn-fixed-width"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
        padding: 5px 2px;

      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
     >
    <q-tooltip :style="{ maxWidth: '300px', whiteSpace: 'pre-wrap' }">
  <div>
    <strong>{{  data.query_condition.type == 'sql' ? 'SQL' : 'PromQL' }}:</strong> <pre style="max-width: 200px ; text-wrap: wrap;">{{  data.query_condition.type == 'sql' ? data.query_condition.sql : data.query_condition.promql }}</pre><br />
    <strong>Period:</strong> {{ data.trigger_condition.period }}<br />
    <strong>Frequency:</strong> {{ data.trigger_condition.frequency }} {{ data.trigger_condition.frequency_type }}<br />
    <strong>Operator:</strong> {{ data.trigger_condition.operator }}<br />
    <strong>Threshold:</strong> {{ data.trigger_condition.threshold }}<br />
    <strong>Cron:</strong> {{ data.trigger_condition.cron || 'None' }}<br />
    <strong>Silence:</strong> {{ data.trigger_condition.silence }}
  </div>
</q-tooltip>

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1em"
          class="q-ma-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
          class="row"
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

      <div v-show="showButtons" class="node-action-buttons" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="clearTimeout(hideButtonsTimeout)" @mouseleave="hideButtonsTimeout = setTimeout(() => showButtons = false, 200)">
        <q-btn
          flat
          round
          dense
          icon="edit"
          size="0.6em"
          @click="editNode(id)"
          class="node-action-btn edit-btn"
          @mouseenter="showEditTooltip = true"
          @mouseleave="showEditTooltip = false"
        />
        <div v-if="showEditTooltip" class="custom-tooltip edit-tooltip" :style="{ backgroundColor: getNodeColor(io_type) }" style="left: 15px;">
          Edit Node
          <div class="tooltip-arrow" :style="{ borderTopColor: getNodeColor(io_type) }"></div>
        </div>
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click="deleteNode(id)"
          class="node-action-btn delete-btn"
          @mouseenter="showDeleteTooltip = true"
          @mouseleave="showDeleteTooltip = false"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 41px;">
          Delete Node
          <div class="tooltip-arrow delete-arrow"></div>
        </div>
      </div>
    </div>

    <div
      v-if="data.node_type == 'condition'"
      class=" q-pa-none btn-fixed-width"
      style="
        width: fit-content;
        display: flex;
        align-items: center;
        border: none;
        cursor: pointer;
      "
      @mouseenter="handleNodeHover(id, io_type)"
      @mouseleave="handleNodeLeave(id)"
     >

      <div class="icon-container" style="display: flex; align-items: center">
        <!-- Icon -->
        <q-icon
          :name="getIcon(data, io_type)"
          size="1em"
          class="q-ma-sm"
        />
      </div>

      <!-- Separator -->
      <q-separator vertical class="q-mr-sm" />

      <!-- Label -->
      <div class="container">
        <div
    style="
      text-align: left;
      text-wrap: wrap;
      width: auto;
      text-overflow: ellipsis;
    "
  >
    <span v-for="(condition, index) in data.conditions" :key="index" style="margin-right: 8px; display: inline-block;">
      {{ condition.column }} {{ condition.operator }} {{ condition.value }}<span v-if="index < data.conditions.length - 1">,</span>
    </span>
  </div>
      </div>

      <div v-show="showButtons" class="node-action-buttons" :style="{ '--node-color': getNodeColor(io_type) }" @mouseenter="clearTimeout(hideButtonsTimeout)" @mouseleave="hideButtonsTimeout = setTimeout(() => showButtons = false, 200)">
        <q-btn
          flat
          round
          dense
          icon="edit"
          size="0.6em"
          @click="editNode(id)"
          class="node-action-btn edit-btn"
          @mouseenter="showEditTooltip = true"
          @mouseleave="showEditTooltip = false"
        />
        <div v-if="showEditTooltip" class="custom-tooltip edit-tooltip" :style="{ backgroundColor: getNodeColor(io_type) }" style="left: 15px;">
          Edit Node
          <div class="tooltip-arrow" :style="{ borderTopColor: getNodeColor(io_type) }"></div>
        </div>
        
        <q-btn
          flat
          round
          dense
          icon="delete"
          size="0.6em"
          @click="deleteNode(id)"
          class="node-action-btn delete-btn"
          @mouseenter="showDeleteTooltip = true"
          @mouseleave="showDeleteTooltip = false"
        />
        <div v-if="showDeleteTooltip" class="custom-tooltip delete-tooltip" style="left: 41px;">
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

.edit-btn:hover {
  box-shadow: 0 2px 8px rgba(var(--node-color), 0.3) !important;
}

.delete-btn:hover {
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3) !important;
  background: #ef4444 !important;
  border-color: #ef4444 !important;
}

// Custom tooltips with arrow pointers
.custom-tooltip {
  position: absolute;
  top: -35px;
  left: 50%;
  transform: translateX(-50%);
  background: #dc2626;
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
  z-index: 20;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.edit-tooltip {
  color: white;
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

</style>
