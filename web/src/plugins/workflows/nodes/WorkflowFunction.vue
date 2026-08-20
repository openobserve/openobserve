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

  "Set up later" (same as the Destination node) is a section-level toggle: turning
  it on greys out the picker and lets the node be saved as a PLACEHOLDER (empty
  function name, flagged `meta.incomplete`). Draft + test still run; Publish is
  blocked until a function is set. WorkflowNodeDrawer's Save calls submit().
-->
<template>
  <div data-test="workflow-function-body" class="flex w-full flex-col gap-4">
    <!-- Section-level "Set up later" toggle — left-aligned with the picker below and
         separated by a divider, so it reads as a parent choice. Hidden while the
         inline create editor is expanded (it owns the full drawer). -->
    <div
      v-if="!workflowObj.dialog.expand"
      class="border-border-default flex flex-col gap-1.5 border-b pb-4"
    >
      <OSwitch
        v-model="setUpLater"
        :label="t('workflow.node.functionSetUpLater')"
        data-test="workflow-function-set-up-later"
      />
      <div class="text-text-secondary text-xs leading-snug">
        {{
          setUpLater
            ? t("workflow.node.functionSetUpLaterActive")
            : t("workflow.node.functionSetUpLaterPrompt")
        }}
      </div>
    </div>

    <!-- Greyed + faded while "Set up later" is on so it's clearly governed by the
         toggle above. -->
    <FunctionPicker
      ref="picker"
      class="transition-opacity"
      :class="{ 'pointer-events-none opacity-50': setUpLater }"
      :initial-name="savedData.name || ''"
      :initial-after-flatten="savedData.after_flatten ?? false"
      :sample-events="sampleEvents"
      language="javascript"
      :default-code="JS_DEFAULT_CODE"
      @expand="onExpand"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onBeforeUnmount } from "vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { useI18nTyped } from "@/types/i18n";
import FunctionPicker from "@/components/flow/forms/FunctionPicker.vue";
import {
  workflowObj,
  currentTriggerKind,
  setNodeIncomplete,
  isNodeIncomplete,
} from "@/plugins/workflows/useWorkflowCanvas";
import { triggerDef } from "@/plugins/workflows/triggers";

const { t } = useI18nTyped();

const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);

// Selected state for the "Set up later" toggle. Defaults ON when reopening a node
// already saved as a placeholder (flagged incomplete); otherwise OFF.
const setUpLater = ref(isNodeIncomplete(workflowObj.currentSelectedNodeData));

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

// Drawer "Save":
//  • Set up later ON  → commit a PLACEHOLDER (empty function name, flag incomplete).
//  • Set up later OFF → require a real function via the picker (null blocks Save
//    with the picker's inline error, or means the inline create form is open).
const submit = async () => {
  const node = workflowObj.currentSelectedNodeData;
  if (setUpLater.value) {
    setNodeIncomplete(node, true);
    return { name: "", after_flatten: savedData.after_flatten ?? false };
  }
  const payload = (await picker.value?.submit()) ?? null;
  if (!payload) return null;
  setNodeIncomplete(node, false);
  return payload;
};

defineExpose({ submit, setUpLater });
</script>
