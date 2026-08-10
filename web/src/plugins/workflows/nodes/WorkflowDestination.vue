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
  "Send To Destination" node body — a thin wrapper over the shared
  DestinationPicker (same body the pipeline external-destination form uses).
  Pick an existing Pipeline (remote) Destination or create one inline.

  Payload -> NodeData::Destination { destination_id, template_override }
  (node_type `destination`). `destination_id` is the Pipeline Destination's NAME
  (the shared picker returns it as `destination_name`; we remap here — pipelines
  keep the RemoteStream shape). `template_override` is null in v1 (uses the
  destination's own template).

  WorkflowNodeDrawer's Save calls submit() → { destination_id, template_override }
  or null. While the inline create form is open the drawer hides its own footer —
  it reads `createNewDestination` (exposed below, synced from the picker's expand).
-->
<template>
  <div data-test="workflow-destination-body" class="w-full">
    <!-- Workflows only support Custom HTTP destinations for now, so lock the inline
         create form to Custom and skip its type-selection step. `optional` lets the
         node be saved with NO destination — a placeholder to configure later (draft
         + test still work; Publish is blocked until it's filled). -->
    <DestinationPicker
      ref="picker"
      :initial-name="savedData.destination_id || ''"
      forced-type="custom"
      optional
      @expand="(v) => (creating = v)"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import DestinationPicker from "@/components/flow/forms/DestinationPicker.vue";
import { workflowObj, setNodeIncomplete } from "@/plugins/workflows/useWorkflowCanvas";

const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);
const creating = ref(false);

// Map the shared picker's { org_id, destination_name } into the workflow
// destination shape { destination_id, template_override }. With `optional`, the
// picker returns an EMPTY destination_name when nothing is selected (instead of
// null) — we commit that as a PLACEHOLDER and flag the node `meta.incomplete` so
// Publish blocks it. A null return means the inline create form is still open.
const submit = async () => {
  const payload = await picker.value?.submit();
  if (!payload) return null;
  const destinationId = payload.destination_name || "";
  // Mark/clear the placeholder flag on the staged/edited node.
  setNodeIncomplete(workflowObj.currentSelectedNodeData, !destinationId);
  return {
    destination_id: destinationId,
    template_override: savedData.template_override ?? null,
  };
};

// `createNewDestination` lets WorkflowNodeDrawer hide its footer while the inline
// create form (with its own Save/Cancel) is open.
defineExpose({ submit, createNewDestination: creating });
</script>
