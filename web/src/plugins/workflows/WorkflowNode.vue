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
    :label="meta ? t(meta.titleKey) : data?.node_type"
    :io-type="meta?.ioType || 'default'"
    :has-input="meta?.ioType !== 'input'"
    :has-output="meta?.ioType !== 'output'"
    :data-test="`workflow-node-${data?.node_type}`"
    @click="onClick"
    @mouseenter="handleNodeHover"
    @mouseleave="handleNodeLeave"
  >
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
import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import useWorkflowCanvas, { nodeMeta } from "./useWorkflowCanvas";
import { workflowNodeImage } from "./nodeIcons";

const props = defineProps<{
  id: string;
  data: any;
}>();

const { t } = useI18n();
const { editNode, requestDeleteNode, openStepPicker } = useWorkflowCanvas();
const showButtons = ref(false);
const meta = computed(() => nodeMeta(props.data?.node_type));
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
</script>

<style scoped>
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
