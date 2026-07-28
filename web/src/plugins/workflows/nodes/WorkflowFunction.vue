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
  WorkflowNodeDrawer's Save calls submit(), which returns that payload or null.
-->
<template>
  <FunctionPicker
    ref="picker"
    :initial-name="savedData.name || ''"
    :initial-after-flatten="savedData.after_flatten ?? true"
    :sample-events="sampleEvents"
    language="javascript"
    :default-code="JS_DEFAULT_CODE"
    @expand="onExpand"
  />
</template>

<script lang="ts" setup>
import { ref, onBeforeUnmount } from "vue";
import FunctionPicker from "@/components/flow/forms/FunctionPicker.vue";
import { workflowObj, currentTriggerKind } from "@/plugins/workflows/useWorkflowCanvas";
import { triggerDef } from "@/plugins/workflows/triggers";

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

// Called by WorkflowNodeDrawer on Save — returns the data payload or null.
// The picker validates through its zod schema (async) and renders required /
// already-associated inline on the field, returning null when invalid.
const submit = async () => (await picker.value?.submit()) ?? null;

defineExpose({ submit });
</script>
