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
import useDragAndDrop from "./useDnD";
import { ref, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { defaultDestinationNodeWarningMessage } from "@/utils/pipelines/constants";
import { getTruncatedConditions as getTruncatedConditionsUtil } from "@/utils/conditionPreview";
import { formatNodeErrorText } from "@/utils/pipelines/nodeErrors";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";

// Shapes are derived from the pipeline runtime (`useDnD` reactive store + API
// payload). The shared store types `nodes`/`edges` as `any` and omits
// `last_error`, so these local interfaces narrow what this node card reads.
interface NodeData {
  node_type?: string;
  name?: string;
  after_flatten?: boolean;
  stream_type?: string;
  stream_name?: string | { label?: string };
  destination_name?: string;
  condition?: unknown;
  conditions?: unknown;
  [key: string]: unknown;
}

interface NodeErrorInfo {
  errors?: string[];
  error_count?: number;
  [key: string]: unknown;
}

interface PipelineNode {
  id: string;
  io_type?: string;
  data: NodeData;
  [key: string]: unknown;
}

interface PipelineEdge {
  source?: string;
  style?: Record<string, unknown>;
  markerEnd?: Record<string, unknown>;
  [key: string]: unknown;
}

interface NodeType {
  label: string;
  icon: string;
  subtype?: string;
  io_type?: string;
  [key: string]: unknown;
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
const { pipelineObj, deletePipelineNode, checkIfDefaultDestinationNode, openStepPicker } =
  useDragAndDrop();
const showButtons = ref(false);
const showDeleteTooltip = ref(false);
let hideButtonsTimeout: number | null = null;

// last_error is set at runtime but absent from the base pipeline literal type;
// narrow the dynamic value instead of asserting a shape.
const getLastError = (): {
  node_errors?: Record<string, NodeErrorInfo>;
} | null => {
  const pipeline: unknown = pipelineObj.currentSelectedPipeline;
  if (!pipeline || typeof pipeline !== "object" || !("last_error" in pipeline)) return null;
  const lastError: unknown = pipeline.last_error;
  if (!lastError || typeof lastError !== "object") return null;
  const nodeErrors = "node_errors" in lastError ? lastError.node_errors : undefined;
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
  if (!lastError || !lastError.node_errors || props.id === undefined) return null;

  const nodeError = lastError.node_errors[props.id];
  if (!nodeError) return null;

  // node_errors is an object with structure: { node_id: { errors: [...], error_count: N, ... } }
  //
  // `errors` arrives in two shapes at once — legacy rows hold plain strings,
  // rows written after the NodeErrors change hold [message, payload] tuples —
  // and the backend read path is untyped passthrough, so neither is converted
  // server-side. formatNodeErrorText owns that reconciliation; a bare join()
  // here rendered the tuple shape as "msg,[object Object]".
  return formatNodeErrorText(nodeError, (count) => t("pipeline.moreErrors", { count }));
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
const getNodeColor = (ioType: string | undefined) => {
  const colorMap: Record<string, string> = {
    input: "#3b82f6", // Blue    — pairs with --color-status-info-text
    output: "#22c55e", // Green   — pairs with --color-status-positive
    default: "#f59e0b", // Amber   — pairs with --color-status-warning-text
  };
  return (ioType && colorMap[ioType]) || "var(--color-grey-500)";
};

// Function to update edge colors on node hover
const updateEdgeColors = (nodeId: string | undefined, color: string | null, reset = false) => {
  if (pipelineObj.currentSelectedPipeline?.edges) {
    pipelineObj.currentSelectedPipeline.edges.forEach((edge: PipelineEdge) => {
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
const handleNodeHover = (nodeId: string | undefined, ioType: string | undefined) => {
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

// (The onFunctionClick/onConditionClick/onStreamOutputClick/onExternalDestinationClick
// handlers were removed — they drove the old context-menu "add connected node"
// feature that no longer exists, and were the only writers of the now-deleted
// userClickedNode/userSelectedNode. Adding a downstream node is done via the
// hover-`+` step picker (useDnD.addNodeAfter).)

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

// Condition preview reuses the shared util (also used by workflow nodes).
const getTruncatedConditions = (conditionData: unknown) =>
  getTruncatedConditionsUtil(conditionData);

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
    confirmDialogMeta.value.warningMessage = defaultDestinationNodeWarningMessage;
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

// The union `string | { label }` cannot be narrowed by `hasOwnProperty` in the
// template; resolve the display label in script instead.
const streamNameLabel = computed(() => {
  const name = props.data?.stream_name;
  if (name && typeof name === "object") return name.label;
  return name;
});

// Error count for this node, read from the runtime-only `last_error` payload.
const nodeErrorCount = computed<number | undefined>(() => {
  const lastError = getLastError();
  if (!lastError?.node_errors || props.id === undefined) return undefined;
  return lastError.node_errors[props.id]?.error_count;
});

function getIcon(data: NodeData | undefined, ioType: string | undefined) {
  const searchTerm = data?.node_type;
  // nodeTypes is declared as an empty literal (never[]) in the shared store;
  // narrow through unknown to its runtime element shape.
  const nodeTypes = pipelineObj.nodeTypes as unknown as NodeType[];
  const node = nodeTypes.find(
    (node: NodeType) => node.subtype === searchTerm && node.io_type === ioType,
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
      :data-test="`pipeline-node-${io_type}-${(data.node_type ?? '').replace(/_/g, '-')}-node`"
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
          class="flex w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
          align="left"
        >
          {{ data.name }} -
          <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
        </div>

        <template v-else-if="data.node_type == 'stream'">
          <div
            v-if="data.stream_name && data.stream_name.hasOwnProperty('label')"
            class="flex w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
          >
            {{ data.stream_type }} - {{ streamNameLabel }}
          </div>
          <div
            v-else
            class="flex w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
          >
            {{ data.stream_type }} - {{ data.stream_name }}
          </div>
        </template>

        <div
          v-else-if="data.node_type == 'query'"
          class="flex w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
        >
          {{ data.stream_type }} - {{ data.stream_name }}
        </div>

        <div
          v-else-if="data.node_type == 'remote_stream'"
          class="flex w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
        >
          {{ data.destination_name }}
        </div>

        <div
          v-else-if="data.node_type == 'condition'"
          class="w-auto text-left text-sm! leading-[1.4]! font-bold! text-wrap text-ellipsis"
        >
          {{ getTruncatedConditions(data.condition || data.conditions) }}
        </div>
      </template>

      <!-- Error badge (function nodes) + delete button, shared across types -->
      <template #actions>
        <div
          v-if="data.node_type == 'function' && hasNodeError"
          data-test="pipeline-node-error-badge"
          class="bg-status-negative error-badge absolute -top-3 -right-3 z-[15] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 border-white shadow-[0_0.125rem_0.375rem_color-mix(in_srgb,var(--color-status-negative)_50%,transparent)] transition-all duration-200"
          @click.stop="navigateToFunction(data.name)"
        >
          <OIcon name="error" size="sm" />
          <span
            data-test="pipeline-node-error-count"
            v-if="nodeErrorCount"
            class="bg-status-negative text-3xs absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border-[0.09375rem] border-solid border-white px-0.75 font-bold text-white shadow-[0_0.0625rem_0.1875rem_color-mix(in_srgb,var(--color-black)_40%,transparent)]"
          >
            {{ nodeErrorCount }}
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
          class="node-action-buttons absolute -top-7.5 right-0 z-10 flex gap-1.5 px-1.25 pt-1.25 pb-2.5 transition-all duration-300"
          :data-test="`pipeline-node-${io_type}-actions`"
          :style="{ '--node-color': getNodeColor(io_type) }"
          @mouseenter="handleActionButtonsEnter"
          @mouseleave="handleActionButtonsLeave"
        >
          <OButton
            variant="ghost"
            size="icon"
            @click.stop="deleteNode(id)"
            class="rounded-default! bg-surface-overlay/95! node-action-btn delete-btn h-5! w-5! min-w-5! border! border-(--node-color)! p-0! text-(--node-color)! transition-all! duration-200!"
            :data-test="`pipeline-node-${io_type}-delete-btn`"
            @mouseenter="handleDeleteTooltipEnter"
            @mouseleave="handleDeleteTooltipLeave"
          >
            <OIcon name="delete" size="sm" />
          </OButton>
          <div
            v-if="showDeleteTooltip"
            class="bg-status-negative rounded-default text-2xs pointer-events-none fixed left-3.75 z-[1000] px-2.5 py-1.5 whitespace-nowrap text-white shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-black)_30%,transparent)]"
          >
            Delete Node
            <div
              class="absolute top-full left-1/2 h-0 w-0 -translate-x-1/2 border-t-[5px] border-r-[5px] border-l-[5px] [border-top-color:#dc2626] border-r-transparent border-l-transparent"
            ></div>
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
            class="pl-plus-btn border-border-strong bg-surface-overlay text-text-muted hover:border-accent hover:text-accent hover:bg-accent/10 border-2 border-dashed hover:border-solid"
            :data-test="`pipeline-node-${io_type}-add-btn`"
            @click.stop="openStepPicker(id)"
          >
            <OIcon name="add" size="xs" />
          </button>
        </div>
      </template>
    </FlowNodeCard>
  </div>

  <ConfirmDialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    :warning-message="confirmDialogMeta.warningMessage"
    v-model="confirmDialogMeta.show"
  />
</template>

<style scoped>
/* keep(lib-override:vue-flow): the `:deep()` rules below style the Vue Flow
   handles that the shared FlowNodeCard child renders — child-component DOM this
   template cannot put a utility class on. Scoped (not global): every selector
   here is a DESCENDANT of this node, so nothing needs to escape the component.
   CustomNode renders in two places (the editor canvas and the list-row preview),
   so these must travel with the component rather than live in the editor.

   hover-`+` "add next step" affordance — positioned below the node card. Its
   colours live on the element as token utilities (see the template); only
   geometry is here. Two legacy dark overrides were dropped rather than ported:
   they keyed off Quasar's old body-level dark class, which this app never sets,
   so they had been dead for a while — and the tokens now flip with the theme
   on their own, which is what those rules were reaching for. */
.pl-plus {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-top: 0.75rem;
  transform: translateX(-50%);
  z-index: 5;
}
.pl-plus-btn {
  width: 1.625rem;
  height: 1.625rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.14s;
}

:deep(.node_handle_custom) {
  width: 1rem !important;
  height: 1rem !important;
  border: 0.1875rem solid color-mix(in srgb, var(--color-white) 90%, transparent);
  border-radius: 50% !important;
  background: var(--color-grey-500);
  box-shadow: 0 0.125rem 0.5rem color-mix(in srgb, var(--color-black) 15%, transparent);
  transition: all 0.3s ease;
}

:deep(.node_handle_custom::before) {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-grey-700);
  transition: all 0.3s ease;
}

/* Input nodes - info theme */
:deep(.handle_input) {
  background: var(--color-status-info-bg) !important;
}

:deep(.handle_input::before) {
  background: var(--color-status-info-text) !important;
}

/* Output nodes - success theme */
:deep(.handle_output) {
  background: var(--color-status-success-bg) !important;
}

:deep(.handle_output::before) {
  background: var(--color-status-positive) !important;
}

/* Transform nodes (default) - warning theme */
:deep(.handle_default) {
  background: var(--color-status-warning-bg) !important;
}

:deep(.handle_default::before) {
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
