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
  Function node body — a thin wrapper over the shared FunctionPicker (same body
  the pipeline function form uses). Picks a saved VRL function to reshape the
  alert payload, with the After-Flattening (RAF/RBF) toggle, or creates one
  inline. Data payload -> NodeData::Function { name, after_flatten }.

  Dummy-node model (C1): there is NO "Set up later" toggle. Leaving the picker
  empty simply saves the node as a PLACEHOLDER (empty function name, flagged
  `meta.incomplete`) — an unconfigured node IS a dummy node. Draft + test still
  run; Publish is blocked until a function is set. WorkflowNodeDrawer's Save calls
  submit(), which sets `incomplete` from whether a function was picked.
-->
<template>
  <div data-test="workflow-function-body" class="flex min-h-0 w-full flex-1 flex-col gap-2">
    <!-- Config pane header (shared) — hidden in the inline "Create New Function"
         editor, which owns the whole width. The info icon RIGHT AFTER the title
         explains before- vs after-flattening (same pattern as the Condition node). -->
    <WorkflowConfigHeader v-if="!workflowObj.dialog.expand">
      <span
        class="text-text-secondary hover:text-text-body inline-flex cursor-help items-center"
        data-test="workflow-function-flatten-info"
      >
        <OIcon name="info" size="sm" />
        <OTooltip side="right" align="start" :side-offset="8" max-width="22rem">
          <template #content>
            <div class="flex flex-col gap-1.5 p-1 text-left">
              <div class="text-xs font-semibold">
                {{ t("workflow.node.functionFlattenTitle") }}
              </div>
              <div class="text-xs leading-snug">
                <span class="font-semibold">{{ t("flow.function.rbf") }}</span>
                {{ t("flow.function.rbfDesc") }}
              </div>
              <div class="text-xs leading-snug">
                <span class="font-semibold">{{ t("flow.function.raf") }}</span>
                {{ t("flow.function.rafDesc") }}
              </div>
            </div>
          </template>
        </OTooltip>
      </span>
    </WorkflowConfigHeader>
    <!-- Optional: an empty selection saves a placeholder (dummy node). Wrapped so the
         picker/editor fills the space below the header. -->
    <div class="flex min-h-0 flex-1 flex-col">
      <FunctionPicker
        ref="picker"
        :initial-name="savedData.name || ''"
        :initial-after-flatten="savedData.after_flatten ?? false"
        :sample-events="sampleEvents"
        language="javascript"
        optional
        create-button
        :default-code="JS_DEFAULT_CODE"
        @expand="onExpand"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onBeforeUnmount } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FunctionPicker from "@/components/flow/forms/FunctionPicker.vue";
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import {
  workflowObj,
  currentTriggerKind,
  setNodeIncomplete,
} from "@/plugins/workflows/useWorkflowCanvas";
import { triggerDef } from "@/plugins/workflows/triggers";

const { t } = useI18nTyped();
const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);

// Seed code for a brand-new workflow function. Workflow functions are
// JavaScript: the whole trigger event arrives as `row`; mutate it in place.
// Kept trigger-agnostic (the event shape differs per kind — alert vs incident);
// the concrete fields are visible in the Events panel below. Fuller guidance
// lives in the "JavaScript Tip" info tooltip.
const JS_DEFAULT_CODE = `// \`row\` is the trigger event: { meta: {...}, data: [ ...records ] }.
// Mutate it in place — e.g. row.meta.processed = true;
`;

// Seed the inline function editor's "Events" panel with the CURRENT trigger's
// sample (alert vs incident), so the author sees the real payload shape. No
// trigger (it was deleted) -> no sample.
const kind = currentTriggerKind();
const sampleEvents = kind ? triggerDef(kind).buildSample() : [];

// Inline "Create New Function" widens the drawer + hides its footer (the
// AddFunction toolbar owns save/cancel).
const onExpand = (v: boolean) => {
  workflowObj.dialog.expand = v;
};
onBeforeUnmount(() => {
  workflowObj.dialog.expand = false;
});

// Drawer "Save": the picker is optional, so submit() resolves a payload even with
// no function selected (empty name = placeholder). It only returns null while the
// inline "Create New Function" editor is open. Flag the node incomplete when no
// function was picked — that drives the node's warning badge and blocks Publish.
const submit = async () => {
  const node = workflowObj.currentSelectedNodeData;
  const payload = (await picker.value?.submit()) ?? null;
  if (!payload) return null;
  setNodeIncomplete(node, !payload.name);
  return payload;
};

defineExpose({ submit });
</script>
