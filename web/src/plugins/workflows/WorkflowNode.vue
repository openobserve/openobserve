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
      <div v-if="isConfiguredFunction" class="tw:flex tw:gap-1">
        {{ data.name }} -
        <strong>{{ data.after_flatten ? "[RAF]" : "[RBF]" }}</strong>
      </div>
      <div v-else class="tw:whitespace-nowrap">{{ nodeLabel }}</div>
    </template>

    <!-- hover actions (delete) — trigger is fixed -->
    <template #actions>
      <div
        v-show="showButtons && meta?.category !== 'trigger'"
        class="tw:absolute tw:top-[-30px] tw:right-0 tw:flex tw:gap-[6px] tw:z-10 tw:pt-[5px] tw:px-[5px] tw:pb-[10px]"
        :data-test="`workflow-node-${data?.node_type}-actions`"
        @mouseenter="handleActionsEnter"
        @mouseleave="handleActionsLeave"
      >
        <OButton
          variant="ghost"
          size="icon"
          class="tw:min-w-[20px]! tw:w-[20px]! tw:h-[20px]! tw:p-0! tw:rounded! tw:bg-[rgba(255,255,255,0.95)]! tw:border! tw:border-[#dc2626]! tw:text-[#dc2626]!"
          :data-test="`workflow-node-${data?.node_type}-delete-btn`"
          @click.stop="requestDeleteNode(id)"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
      </div>

      <!-- Test result badge — staged reveal after a run: queued (dot) → running
           (spinner) → passed (green tick) / errored (red, hover for messages).
           Mirrors the pipeline function error badge. -->
      <div
        v-if="testStatus === 'pending'"
        class="wf-test-badge wf-test-pending"
        :data-test="`workflow-node-${data?.node_type}-test-pending`"
      >
        <span class="wf-test-dot"></span>
      </div>
      <div
        v-else-if="testStatus === 'running'"
        class="wf-test-badge wf-test-running"
        :data-test="`workflow-node-${data?.node_type}-test-running`"
      >
        <span class="wf-test-spinner"></span>
      </div>
      <div
        v-else-if="testStatus === 'ok'"
        class="wf-test-badge wf-test-ok wf-test-pop"
        :data-test="`workflow-node-${data?.node_type}-test-ok`"
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
            <div class="tw:p-2 tw:text-left tw:text-[12px]">
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
            <div class="tw:p-2 tw:text-left tw:flex tw:flex-col tw:gap-1">
              <div
                v-for="(m, i) in errorMessages"
                :key="i"
                class="tw:text-[12px] tw:leading-[1.35]"
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
import { workflowNodeImage } from "./nodeIcons";

const props = defineProps<{
  id: string;
  data: any;
}>();

const { t } = useI18n();
const { editNode, requestDeleteNode, openStepPicker } = useWorkflowCanvas();

// Test result badge state — read from the last Test run. Null (no run, or this
// node was skipped for a `from_node` run) → no badge. During the staged reveal a
// node is "pending" (queued) then "running" (spinner) before it settles to its
// final "ok" / "error".
const testResult = computed<any>(() => workflowObj.testRun?.result);
// Final (settled) status. A node passes (✓) only when it ran, has no error, AND
// no upstream node errored — otherwise it's "skipped" (not verified), since the
// backend gives us errors only, not per-node success.
const finalStatus = (): "ok" | "error" | "skipped" => {
  const r = testResult.value;
  if (r.errors?.[props.id]) return "error";
  if (r.blockedNodeIds?.includes(props.id)) return "skipped";
  return "ok";
};
const testStatus = computed<
  "pending" | "running" | "ok" | "error" | "skipped" | null
>(() => {
  const r = testResult.value;
  if (!r || !r.ranNodeIds?.includes(props.id)) return null;
  const prog = workflowObj.testRun?.progress;
  if (prog) {
    const pos = prog.order.indexOf(props.id);
    if (pos > prog.index) return "pending";
    if (pos === prog.index) return "running";
    // pos < index → already settled; fall through to the final status
  }
  return finalStatus();
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
  const img = workflowNodeImage(props.data?.node_type);
  return img ? `img:${img}` : meta.value?.icon || "help";
});

// Hover-action visibility (pipeline pattern): a short delay before hiding, and
// the action buttons cancel the hide while hovered — so moving the cursor from
// the node onto the delete button doesn't make it vanish.
let hideButtonsTimeout: any = null;
const handleNodeHover = () => {
  if (hideButtonsTimeout) {
    clearTimeout(hideButtonsTimeout);
    hideButtonsTimeout = null;
  }
  showButtons.value = true;
};
const handleNodeLeave = () => {
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

const onClick = () => editNode(props.id);

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
.wf-test-pending {
  background: #fff;
  border-color: #d1d5db;
}
.wf-test-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
}
.wf-test-running {
  background: #6366f1;
}
.wf-test-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  animation: wf-spin 0.7s linear infinite;
}
@keyframes wf-spin {
  to {
    transform: rotate(360deg);
  }
}
/* settle pop when a node resolves to ✓ / ✗ */
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
  background: #9ca3af;
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
  border: 2px dashed var(--o2-border-strong, #d9dce4);
  background: #fff;
  color: #6b7280;
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
