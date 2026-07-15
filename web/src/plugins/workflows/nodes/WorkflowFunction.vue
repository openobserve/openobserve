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
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSample } from "@/plugins/workflows/testSample";

const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);

// Seed code for a brand-new workflow function. Workflow functions are
// JavaScript: the whole fired-alert event arrives as `row`; mutate it and
// return it. The example (in comments) mirrors the sample payload fields.
const JS_DEFAULT_CODE = `// Transform the fired-alert payload before it continues to the next step.
// \`row\` is the whole event: { meta: {...}, data: [ ...records ] }.
// Mutate it and return it.
//
// Example — derive a severity from the alert, then enrich each record that
// tripped it:
//   row.meta.severity =
//     row.meta.alert_count >= 100 ? "critical" : "warning";
//
//   row.data = row.data.map((record) => {
//     record.env = "production";
//     if (record.status_code >= 500) record.needs_attention = true;
//     return record;
//   });
//
//   // drop a field you don't want forwarded downstream
//   delete row.meta.alert_operator;

return row;`;

// Seed the inline function editor's "Events" panel with the same fired-alert
// sample the Test drawer uses, so the VRL author sees the real payload shape.
const sampleEvents = buildTestSample();

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
