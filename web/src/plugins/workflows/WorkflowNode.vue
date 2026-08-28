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
  workflow interactions: click-to-edit, hover-delete (trigger deletable too), and the
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
    :class="{
      'wf-node-disabled': isDisabled,
      'wf-result-active': isActiveResult,
      'wf-needs-setup': needsSetupHighlight,
    }"
    @click="onClick"
    @mouseenter="handleNodeHover"
    @mouseleave="handleNodeLeave"
  >
    <!-- Two-line body: the custom NAME (bold) on top when renamed, then a single
         muted line combining the TYPE and config DETAIL as "Type · detail". Without
         a name the type is the bold title and the detail the muted subtitle — so the
         config preview (condition rule / selected function) is never hidden. -->
    <template #body>
      <!-- Capped width so a very long name / function body ellipsises instead of
           stretching the card across the canvas. -->
      <div class="flex max-w-[18rem] min-w-0 flex-col">
        <span class="truncate leading-tight">
          {{ customName || typeTitle }}
        </span>
        <span
          v-if="showSubtitle"
          class="text-text-secondary flex min-w-0 items-baseline gap-1 text-xs leading-tight font-normal"
        >
          <!-- When a custom name is the title, prefix the subtitle with the type. -->
          <span v-if="customName" class="shrink-0"
            >{{ typeTitle }}{{ hasDetail ? " · " : "" }}</span
          >
          <template v-if="funcTag">
            <span class="min-w-0 truncate" data-test="workflow-node-detail">{{ data.name }}</span>
            <span class="shrink-0">-</span>
            <strong class="shrink-0">{{ data.after_flatten ? raw("[RAF]") : raw("[RBF]") }}</strong>
          </template>
          <span v-else-if="configDetail" class="min-w-0 truncate" data-test="workflow-node-detail">
            {{ configDetail }}
          </span>
        </span>
      </div>
    </template>

    <!-- hover actions (disable + delete) — the trigger is deletable too, so the
         user can swap its kind (deleting it brings back the start node). -->
    <template #actions>
      <!-- Always-visible status glyphs (not hover-gated): a "Disabled" badge when
           the step is muted (T6) and a note glyph when it carries a comment (T3).
           Sit at the card's top-left so they never collide with the hover actions
           (top-right) or the test badge (top-right corner). -->
      <div class="absolute -top-2.5 left-1 z-10 flex items-center gap-1">
        <OBadge
          v-if="isDisabled"
          variant="default"
          size="xs"
          :data-test="`workflow-node-${data?.node_type}-disabled-badge`"
        >
          {{ t("workflow.node.disabledBadge") }}
        </OBadge>
        <!-- Placeholder / "Configure Later" marker — e.g. a Destination saved with
             no destination selected. Draft + Test still work; Publish is blocked. -->
        <OBadge
          v-if="isIncomplete"
          variant="warning"
          size="xs"
          :data-test="`workflow-node-${data?.node_type}-incomplete-badge`"
        >
          {{ t("workflow.node.incompleteBadge") }}
        </OBadge>
        <div
          v-if="commentText"
          class="bg-surface-overlay/95 border-border-default text-text-secondary flex h-4 w-4 items-center justify-center rounded-full border"
          :data-test="`workflows-node-comment-indicator`"
        >
          <OIcon name="note-add" size="xs" />
          <OTooltip side="top" align="center" :side-offset="8" max-width="20rem">
            <template #content>
              <div class="p-2 text-left text-xs whitespace-pre-wrap">{{ commentText }}</div>
            </template>
          </OTooltip>
        </div>
      </div>

      <div
        v-show="showButtons"
        class="absolute -top-7.5 right-0 z-10 flex gap-1.5 px-1.25 pt-1.25 pb-2.5"
        :data-test="`workflow-node-${data?.node_type}-actions`"
        @mouseenter="handleActionsEnter"
        @mouseleave="handleActionsLeave"
      >
        <!-- Disable / enable toggle (T6) — one click mutes or restores the step
             without opening the config drawer. Sibling to the delete button. -->
        <OButton
          variant="ghost"
          size="icon"
          class="rounded-default! bg-surface-overlay/95! h-5! w-5! min-w-5! border! p-0!"
          :class="
            isDisabled
              ? 'border-status-positive! text-status-positive!'
              : 'border-status-warning-text! text-status-warning-text!'
          "
          :data-test="`workflows-node-disable-toggle`"
          @click.stop="onToggleDisabled"
        >
          <OIcon :name="isDisabled ? 'play-circle' : 'pause-circle-filled'" size="sm" />
          <OTooltip
            :content="isDisabled ? t('workflow.node.enable') : t('workflow.node.disable')"
            side="top"
            align="center"
            :side-offset="8"
          />
        </OButton>
        <OButton
          variant="ghost"
          size="icon"
          class="rounded-default! bg-surface-overlay/95! border-status-negative! text-status-negative! h-5! w-5! min-w-5! border! p-0!"
          :data-test="`workflow-node-${data?.node_type}-delete-btn`"
          @click.stop="requestDeleteNode(id)"
        >
          <OIcon name="delete" size="sm" />
          <!-- Same OTooltip the test badges below use — the delete button simply
               never had one. Preferred over the pipeline node's hand-rolled
               tooltip div: reka-ui/Floating UI handles the Vue Flow node's
               transformed ancestor, so it can't drift the way a bare `fixed`
               element does. -->
          <OTooltip
            :content="t('workflow.deleteNodeTitle')"
            side="top"
            align="center"
            :side-offset="8"
          />
        </OButton>
      </div>

      <!-- Test result badge — passed (green tick) / not-verified (grey) / errored
           (red, hover for messages, click to open the step drawer). -->
      <div
        v-if="testStatus === 'ok'"
        class="wf-test-badge wf-test-pop nodrag bg-status-positive cursor-pointer text-white transition-transform duration-150 hover:scale-110"
        :data-test="`workflow-node-${data?.node_type}-test-ok`"
        @pointerdown.stop
        @click.stop="openResult"
      >
        <OIcon name="check" size="xs" />
        <OTooltip side="top" align="center" :side-offset="8" max-width="20rem">
          <template #content>
            <div class="p-2 text-left text-xs">
              {{ t("workflow.test.stepResult.viewHint") }}
            </div>
          </template>
        </OTooltip>
      </div>
      <div
        v-else-if="testStatus === 'skipped'"
        class="wf-test-badge wf-test-pop nodrag bg-badge-default-solid-bg text-badge-default-solid-text cursor-pointer transition-transform duration-150 hover:scale-110"
        :data-test="`workflow-node-${data?.node_type}-test-skipped`"
        @pointerdown.stop
        @click.stop="openResult"
      >
        <OIcon name="remove" size="xs" />
        <OTooltip side="top" align="center" :side-offset="8" max-width="20rem">
          <template #content>
            <div class="p-2 text-left text-xs">
              {{ t("workflow.test.notVerified") }}
            </div>
          </template>
        </OTooltip>
      </div>
      <div
        v-else-if="testStatus === 'error'"
        class="wf-test-badge wf-test-pop nodrag bg-status-negative cursor-pointer text-white transition-transform duration-150 hover:scale-110"
        :data-test="`workflow-node-${data?.node_type}-test-error`"
        @pointerdown.stop
        @click.stop="openResult"
      >
        <OIcon name="error" size="xs" />
        <span v-if="errorCount > 1" class="wf-test-count text-status-negative bg-white">{{
          errorCount
        }}</span>
        <OTooltip side="top" align="center" :side-offset="8" max-width="22.5rem">
          <template #content>
            <div class="flex flex-col gap-1 p-2 text-left">
              <div v-for="(m, i) in errorMessages" :key="i" class="text-xs leading-[1.35]">
                {{ m }}
              </div>
            </div>
          </template>
        </OTooltip>
      </div>
    </template>
  </FlowNodeCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import useWorkflowCanvas, {
  nodeMeta,
  workflowObj,
  nodeConfigDetail,
  triggerDef,
  nodeCustomName,
  nodeComment,
  isNodeDisabled,
  isNodeIncomplete,
  toggleNodeDisabled,
} from "./useWorkflowCanvas";

const props = defineProps<{
  id: string;
  data: any;
}>();

const { t } = useI18nTyped();
const { editNode, requestDeleteNode } = useWorkflowCanvas(t);

// This node's live record in the shared graph — the source for meta-backed
// display (custom name, comment, disabled). Reactive: mutating meta re-renders.
const node = computed<any>(() =>
  (workflowObj.currentSelectedWorkflow?.nodes || []).find((n: any) => n.id === props.id),
);
// Custom name (T2), comment (T3) and disabled (T6) all round-trip via node.meta.
const customName = computed(() => nodeCustomName(node.value));
const commentText = computed(() => nodeComment(node.value));
const isDisabled = computed(() => isNodeDisabled(node.value));
// Placeholder / "Configure Later" — e.g. a Destination saved with no destination.
const isIncomplete = computed(() => isNodeIncomplete(node.value));
const onToggleDisabled = () => toggleNodeDisabled(props.id);

// This node is the one whose results are open in the NDV — highlight it on the
// canvas so it's clear which node's Input/Output is on screen (matters when the NDV
// navigates prev/next between steps).
const isActiveResult = computed(
  () => !!workflowObj.testRun.result && workflowObj.currentSelectedNodeID === props.id,
);

// This node was flagged by Publish validation as needing setup (incomplete/dummy) —
// flash a warning ring so the user sees exactly which steps block publishing.
const needsSetupHighlight = computed(() => workflowObj.incompleteHighlight.includes(props.id));

// Test result badge state — read from the last Test run. Null (no run, or this
// node wasn't part of a `from_node` run) → no badge. A node is a real ✓ only when
// records ACTUALLY reached it (it's in the per-node `inputs` map) and it didn't
// error. A node the run reached but that received 0 records — e.g. an upstream
// condition filtered everything out — is "skipped" (grey), NOT a false pass.
const testResult = computed<any>(() => workflowObj.testRun?.result);
const testStatus = computed<"ok" | "error" | "skipped" | null>(() => {
  const r = testResult.value;
  if (!r || !r.ranNodeIds?.includes(props.id)) return null;
  if (r.errors?.[props.id]) return "error";
  // Live Test run carries the per-node `inputs` map: ✓ only if this node got
  // records; otherwise it ran but processed nothing → grey.
  if (r.inputs) return r.inputs[props.id]?.length ? "ok" : "skipped";
  // History run (no `inputs` map): fall back to the blocked-downstream logic.
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

// Type title — the muted eyebrow, ALWAYS shown so the node's kind stays visible
// even after a rename. The trigger resolves its KIND's title (Alert Trigger,
// Incident Trigger, …) from the registry so new kinds label themselves.
const typeTitle = computed(() => {
  const data = props.data;
  if (data?.node_type === "workflow_trigger") return t(triggerDef(data?.trigger_kind).nodeTitleKey);
  return meta.value ? t(meta.value.titleKey) : data?.node_type || "";
});
// A configured function renders its "name - [RAF]/[RBF]" tag as the detail line
// (regardless of a custom name, so the selected function is never hidden).
const funcTag = computed(() => props.data?.node_type === "function" && !!props.data?.name);
// Config detail for non-function steps — Condition -> rule preview, Destination ->
// destination name. Trigger + function have no text detail here (function uses the
// [RAF] tag above; the trigger's kind title IS the eyebrow).
const configDetail = computed(() => {
  const type = props.data?.node_type;
  if (type === "workflow_trigger" || type === "function") return "";
  return nodeConfigDetail(props.data, 28) || "";
});
// Whether there's a config detail to show (function tag or a preview string).
const hasDetail = computed(() => funcTag.value || !!configDetail.value);
// The muted second line shows whenever a custom name is the title (to surface the
// type + detail), or — without a name — only when there's a detail to show.
const showSubtitle = computed(() => !!customName.value || hasDetail.value);
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

// Adding the next step / a fan-out branch is now the canvas-level append `+` under
// (or beside) each node — see WorkflowCanvas.appendPoints — so the source handle is
// just a connection point again (no click-to-add). The source dot still drags to
// wire edges manually.

// Clicking the node body opens its NDV in both modes — read-only on the Runs
// canvas (see canvasReadOnly in WorkflowNodeDrawer), editable in the editor.
const onClick = () => {
  editNode(props.id);
};

// Clicking a node's ✓/✗ badge opens the node's NDV — the SAME Input · Config · Output
// panel a node-click opens, now populated with this run's Input/Output (testRun.result
// is set). One UI everywhere: the editor and the read-only Runs view both inspect a
// step through the NDV (read-only there — see canvasReadOnly in WorkflowNodeDrawer),
// so there's no separate results dock.
const openResult = () => {
  editNode(props.id);
};
</script>

<style scoped>
/* keep(keyframes): the pop animation and its @keyframes have no utility
   equivalent. Everything else here is GEOMETRY only — every colour moved to
   token utilities on the elements themselves (bg-status-*, border-border-strong,
   bg-surface-overlay, hover:*-accent), so this block holds no colour at all. */

/* Test result badge — corner circle on the node (the VueFlow node wrapper is the
   positioned ancestor). Colour comes from the template. */
.wf-test-badge {
  position: absolute;
  top: -0.625rem;
  right: -0.625rem;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-width: 0.125rem;
  border-style: solid;
  border-color: currentColor;
  z-index: 16;
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
.wf-test-count {
  position: absolute;
  top: -0.4375rem;
  right: -0.4375rem;
  min-width: 0.9375rem;
  height: 0.9375rem;
  padding: 0 0.1875rem;
  border-radius: 0.5rem;
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 0.9375rem;
  text-align: center;
}

/* The hover-`+` add affordance (`.wf-plus*`) that used to sit below the card is
   gone — clicking the source handle opens the step picker instead, so the button
   and its geometry rules went with it (same change as the pipeline node). */
</style>
