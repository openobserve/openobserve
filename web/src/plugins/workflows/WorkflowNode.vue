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
  Workflow canvas node — a thin wrapper over the shared FlowNodeCard. The card
  frame/handles/icon/label are shared with pipelines; this component adds the
  workflow interactions: click-to-edit, hover-delete (trigger is fixed), and the
  hover-`+` "add next step" affordance (Condition is a single-output filter, so
  one output — no true/false branch).
-->
<template>
  <FlowNodeCard
    :icon="nodeIcon"
    :io-type="meta?.ioType || 'default'"
    :has-input="meta?.ioType !== 'input'"
    :has-output="meta?.ioType !== 'output'"
    :data-test="`workflow-node-${data?.node_type}`"
    @click="onClick"
    @mouseenter="handleNodeHover"
    @mouseleave="handleNodeLeave"
  >
    <!-- Per-type body — rendered via #body (typography is inherited from
         FlowNodeCard) so it stays identical to the pipeline custom node:
         Function shows a bold [RAF]/[RBF] tag, everything else shows its
         config-detail line. -->
    <template #body>
      <div v-if="isConfiguredFunction" class="flex gap-1">
        {{ data.name }} -
        <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
      </div>
      <div v-else class="whitespace-nowrap">{{ nodeLabel }}</div>
    </template>

    <!-- hover actions (delete) — trigger is fixed -->
    <template #actions>
      <div
        v-show="showButtons && meta?.category !== 'trigger'"
        class="absolute top-[-30px] right-0 flex gap-[6px] z-10 pt-[5px] px-[5px] pb-[10px]"
        :data-test="`workflow-node-${data?.node_type}-actions`"
        @mouseenter="handleActionsEnter"
        @mouseleave="handleActionsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          class="min-w-[20px]! w-[20px]! h-[20px]! p-0! rounded! bg-[rgba(255,255,255,0.95)]! border! border-[#dc2626]! text-[#dc2626]!"
          :data-test="`workflow-node-${data?.node_type}-delete-btn`"
          @click.stop="requestDeleteNode(id)"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
      </div>

      <!-- Test result badge — passed (green tick) / not-verified (grey) / errored
           (red, hover for messages, click to open the step drawer). -->
      <div
        v-if="testStatus === 'ok'"
        class="wf-test-badge wf-test-ok wf-test-pop nodrag"
        :data-test="`workflow-node-${data?.node_type}-test-ok`"
        @pointerdown.stop
        @click.stop
      >
        <OIcon name="check" size="xs" />
      </div>
      <div
        v-else-if="testStatus === 'skipped'"
        class="wf-test-badge wf-test-skipped wf-test-pop nodrag"
        :data-test="`workflow-node-${data?.node_type}-test-skipped`"
        @pointerdown.stop
        @click.stop
      >
        <OIcon name="remove" size="xs" />
        <OTooltip side="top" align="center" :side-offset="8" max-width="320px">
          <template #content>
            <div class="p-2 text-left text-[12px]">
              {{ t("workflow.test.notVerified") }}
            </div>
          </template>
        </OTooltip>
      </div>
      <div
        v-else-if="testStatus === 'error'"
        class="wf-test-badge wf-test-error wf-test-pop nodrag"
        :data-test="`workflow-node-${data?.node_type}-test-error`"
        @pointerdown.stop
        @click.stop="openResult"
      >
        <OIcon name="error" size="xs" />
        <span v-if="errorCount > 1" class="wf-test-count">{{ errorCount }}</span>
        <OTooltip side="top" align="center" :side-offset="8" max-width="360px">
          <template #content>
            <div class="p-2 text-left flex flex-col gap-1">
              <div
                v-for="(m, i) in errorMessages"
                :key="i"
                class="text-[12px] leading-[1.35]"
              >
                {{ m }}
              </div>
            </div>
          </template>
        </OTooltip>
      </div>
    </template>

    <!-- hover-`+` add-next affordance (shown on hover). Terminal (action) nodes
         have none. -->
    <template #footer>
      <div
        v-for="p in pluses"
        v-show="showButtons"
        :key="p.handle"
        class="wf-plus nodrag"
        :class="p.cls"
        @pointerdown.stop
        @click.stop
        @mouseenter="handleActionsEnter"
        @mouseleave="handleActionsLeave"
      >
        <button
          type="button"
          class="wf-plus-btn"
          :data-test="`workflow-node-${data?.node_type}-add-${p.handle}`"
          @click.stop="openStepPicker(id, p.handle)"
        >
          <OIcon name="add" size="xs" />
        </button>
        <span v-if="p.tag" class="wf-plus-tag" :class="`wf-plus-tag-${p.handle}`">
          {{ p.tag }}
        </span>
      </div>
    </template>
  </FlowNodeCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import useWorkflowCanvas, {
  nodeMeta,
  workflowObj,
  nodeConfigDetail,
} from "./useWorkflowCanvas";

const props = defineProps<{
  id: string;
  data: any;
}>();

const { t } = useI18n();
const { editNode, requestDeleteNode, openStepPicker } = useWorkflowCanvas();

// Test result badge state — read from the last Test run. Null (no run, or this
// node wasn't part of a `from_node` run) → no badge. A node passes (✓) only when
// it ran, has no error, AND no upstream node errored — otherwise it's "skipped"
// (not verified), since the backend gives us errors only, not per-node success.
const testResult = computed<any>(() => workflowObj.testRun?.result);
const testStatus = computed<"ok" | "error" | "skipped" | null>(() => {
  const r = testResult.value;
  if (!r || !r.ranNodeIds?.includes(props.id)) return null;
  if (r.errors?.[props.id]) return "error";
  if (r.blockedNodeIds?.includes(props.id)) return "skipped";
  return "ok";
});
// NodeErrors.errors serializes as an array of [message, value?] tuples.
const errorMessages = computed<string[]>(() => {
  const raw = testResult.value?.errors?.[props.id];
  if (!Array.isArray(raw?.errors)) return [];
  return raw.errors.map((e: any) => (Array.isArray(e) ? String(e[0]) : String(e)));
});
const errorCount = computed<number>(() => {
  const raw = testResult.value?.errors?.[props.id];
  return raw?.error_count ?? errorMessages.value.length;
});
const showButtons = ref(false);
const meta = computed(() => nodeMeta(props.data?.node_type));

// A configured function node renders its own bold "name - [RAF]/[RBF]" body
// (see #body) to match the pipeline custom node. Everything else — including a
// not-yet-configured function — uses the plain `nodeLabel` line below.
const isConfiguredFunction = computed(
  () => props.data?.node_type === "function" && !!props.data?.name,
);

// Node label — the config detail IS the label (icon conveys the type), matching
// the pipeline custom node exactly: Condition -> rule preview, Destination ->
// destination name. Falls back to the type title for the trigger and any
// not-yet-configured node.
const nodeLabel = computed(() => {
  const data = props.data;
  const type = data?.node_type;
  const fallback = meta.value ? t(meta.value.titleKey) : type;
  if (type === "workflow_trigger") return fallback;
  return nodeConfigDetail(data, 28) || fallback;
});
// Icon for this node type: the pipeline node image as an "img:<url>" string
// (rendered by OIcon exactly like pipeline canvas nodes), or the OIcon glyph name.
const nodeIcon = computed(() => {
  const img = meta.value?.image;
  return img ? `img:${img}` : meta.value?.icon || "help";
});

// Tint this node's outgoing edge with its role colour on hover, and reset to the
// resting grey on leave — pipeline parity (mirrors CustomNode.updateEdgeColors).
// Reset grey references makeEdge's EDGE_COLOR token so a hovered-then-reset edge
// matches a freshly-added one. (var() resolves for both the stroke and the SVG
// arrowhead marker.)
const RESET_EDGE_COLOR = "var(--color-grey-500)";
const NODE_ROLE_COLOR: Record<string, string> = {
  input: "#3b82f6", // blue (trigger)
  default: "#f59e0b", // amber (logic)
  output: "#22c55e", // green (action)
};
const updateEdgeColors = (nodeId: string, color: string) => {
  workflowObj.currentSelectedWorkflow.edges?.forEach((edge: any) => {
    if (edge.source !== nodeId) return;
    edge.style = { ...edge.style, stroke: color, strokeWidth: 2 };
    edge.markerEnd = { ...edge.markerEnd, color };
  });
};

// Hover-action visibility (pipeline pattern): a short delay before hiding, and
// the action buttons cancel the hide while hovered — so moving the cursor from
// the node onto the delete button doesn't make it vanish.
let hideButtonsTimeout: any = null;
const handleNodeHover = () => {
  if (hideButtonsTimeout) {
    clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }
  // No hover add/delete affordances on the read-only Runs inspection canvas.
  showButtons.value = !workflowObj.readOnly;
  updateEdgeColors(props.id, NODE_ROLE_COLOR[meta.value?.ioType || "default"] || RESET_EDGE_COLOR);
};
const handleNodeLeave = () => {
  updateEdgeColors(props.id, RESET_EDGE_COLOR);
  hideButtonsTimeout = setTimeout(() => {
    showButtons.value = false;
  }, 200);
};
const handleActionsEnter = () => {
  if (hideButtonsTimeout) {
    clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }
};
const handleActionsLeave = () => {
  hideButtonsTimeout = setTimeout(() => {
    showButtons.value = false;
  }, 200);
};

// The `+` affordance under a node: none for a terminal action node, one
// otherwise. The Condition is a filter, so it has a single output too.
const pluses = computed(() => {
  if (!meta.value || meta.value.ioType === "output") return [];
  return [{ handle: "out", cls: "wf-plus-out", tag: "" }];
});

// On the read-only Runs canvas the node body isn't editable — the error badge
// (openResult) is the only affordance. In the editor, click opens the config.
const onClick = () => {
  if (workflowObj.readOnly) return;
  editNode(props.id);
};

// Open the per-node Input/Output result drawer (from the ✓ / error badge).
const openResult = () => {
  workflowObj.testRun.resultDrawer = { show: true, nodeId: props.id };
};
</script>

<style scoped>
/* Test result badge — corner circle on the node (the VueFlow node wrapper is the
   positioned ancestor). Green tick = passed, red = errored (hover for messages). */
.wf-test-badge {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
  z-index: 16;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
}
/* pop when a node's badge appears */
.wf-test-pop {
  animation: wf-pop 0.22s ease;
}
@keyframes wf-pop {
  0% {
    transform: scale(0.5);
    opacity: 0.4;
  }
  60% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
.wf-test-ok {
  background: #22c55e;
  color: #fff;
}
.wf-test-skipped {
  background: var(--color-grey-400);
  color: #fff;
  cursor: help;
}
.wf-test-error {
  background: #ef4444;
  color: #fff;
  cursor: pointer;
  transition: transform 0.14s ease;
}
.wf-test-error:hover {
  transform: scale(1.12);
}
.wf-test-count {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  background: #fff;
  color: #ef4444;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}

/* hover-`+` add affordance — positioned below the node card (the VueFlow node
   wrapper is the positioned ancestor). */
.wf-plus {
  position: absolute;
  top: 100%;
  margin-top: 12px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 5;
}
.wf-plus-out {
  left: 50%;
}
.wf-plus-btn {
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
.wf-plus-btn:hover {
  border-style: solid;
  border-color: #5a61cc;
  color: #5a61cc;
  background: #eceefb;
}
.dark .wf-plus-btn {
  background: rgba(30, 34, 45, 0.95);
  border-color: rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.7);
}
.dark .wf-plus-btn:hover {
  border-color: #818cf8;
  color: #818cf8;
  background: rgba(129, 140, 248, 0.15);
}
.wf-plus-tag {
  margin-top: 4px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 5px;
}
</style>
