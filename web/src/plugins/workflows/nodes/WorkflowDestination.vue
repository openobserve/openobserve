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
  (the shared picker returns it as `destination_name`; we remap here).

  Dummy-node model (C1): there is NO "Set up later" toggle. Leaving the picker empty
  simply saves the node as a PLACEHOLDER (empty destination, flagged
  `meta.incomplete`) — an unconfigured node IS a dummy node. Draft + test still run;
  Publish is blocked until a destination is set.
-->
<template>
  <div data-test="workflow-destination-body" class="flex w-full flex-col gap-2">
    <!-- Config pane header (shared) — always shown, including while the inline
         "Create New Destination" form is open. -->
    <WorkflowConfigHeader />
    <!-- Workflows only support Custom HTTP destinations for now, so lock the inline
         create form to Custom. Optional: an empty selection saves a placeholder. -->
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
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import { workflowObj, setNodeIncomplete } from "@/plugins/workflows/useWorkflowCanvas";

const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);
const creating = ref(false);

// Drawer "Save": the picker is optional, so submit() resolves a payload even with
// no destination selected (empty name = placeholder). It only returns null while
// the inline "Create New Destination" editor is open. Flag the node incomplete when
// no destination was picked — that drives the warning badge and blocks Publish.
const submit = async () => {
  const node = workflowObj.currentSelectedNodeData;
  const payload = await picker.value?.submit();
  if (!payload) return null;
  const destination_id = payload.destination_name || "";
  setNodeIncomplete(node, !destination_id);
  return {
    destination_id,
    template_override: savedData.template_override ?? null,
  };
};

// `createNewDestination` lets WorkflowNodeDrawer hide its footer while the inline
// create form (with its own Save/Cancel) is open.
defineExpose({ submit, createNewDestination: creating });
</script>
