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

  "Set up later" is a SECTION-LEVEL toggle at the top: turning it on greys out the
  whole destination picker below (its "Create New" switch included), so it reads as
  a parent choice rather than a peer of that switch. Only the DESTINATION is skipped
  — the node name + comment stay editable. The drawer "Save" then commits a
  PLACEHOLDER (empty destination, flagged `meta.incomplete`). Draft + test still run;
  Publish is blocked until a destination is set.
-->
<template>
  <div data-test="workflow-destination-body" class="flex w-full flex-col gap-4">
    <!-- Section-level "Set up later" toggle — left-aligned with the controls below
         (no inset box) and separated by a divider, so it reads as a parent choice
         governing the destination section, not another inline switch. -->
    <div class="border-border-default flex flex-col gap-1.5 border-b pb-4">
      <OSwitch
        v-model="setUpLater"
        :label="t('workflow.node.destinationSetUpLater')"
        data-test="workflow-destination-set-up-later"
      />
      <div class="text-text-secondary text-xs leading-snug">
        {{
          setUpLater
            ? t("workflow.node.destinationSetUpLaterActive")
            : t("workflow.node.destinationSetUpLaterPrompt")
        }}
      </div>
    </div>

    <!-- Workflows only support Custom HTTP destinations for now, so lock the inline
         create form to Custom. Greyed + faded while "Set up later" is on so it's
         clearly governed by the toggle above. -->
    <DestinationPicker
      ref="picker"
      class="transition-opacity"
      :class="{ 'pointer-events-none opacity-50': setUpLater }"
      :initial-name="savedData.destination_id || ''"
      forced-type="custom"
      :optional="setUpLater"
      :disabled="setUpLater"
      @expand="(v) => (creating = v)"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { useI18nTyped } from "@/types/i18n";
import DestinationPicker from "@/components/flow/forms/DestinationPicker.vue";
import {
  workflowObj,
  setNodeIncomplete,
  isNodeIncomplete,
} from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18nTyped();

const savedData: any = workflowObj.currentSelectedNodeData?.data || {};
const picker = ref<any>(null);
const creating = ref(false);

// Selected/pressed state for the "Set up later" button. Defaults ON when reopening
// a node already saved as a placeholder (flagged incomplete); otherwise OFF.
const setUpLater = ref(isNodeIncomplete(workflowObj.currentSelectedNodeData));

// Drawer "Save":
//  • Set up later ON  → commit a PLACEHOLDER (empty destination, flag incomplete).
//  • Set up later OFF → require a real destination via the picker (null blocks Save
//    with the picker's inline error, or means the inline create form is open).
const submit = async () => {
  const node = workflowObj.currentSelectedNodeData;
  if (setUpLater.value) {
    setNodeIncomplete(node, true);
    return { destination_id: "", template_override: savedData.template_override ?? null };
  }
  const payload = await picker.value?.submit();
  if (!payload) return null;
  setNodeIncomplete(node, false);
  return {
    destination_id: payload.destination_name || "",
    template_override: savedData.template_override ?? null,
  };
};

// `createNewDestination` lets WorkflowNodeDrawer hide its footer while the inline
// create form (with its own Save/Cancel) is open. `setUpLater` exposed for tests.
defineExpose({ submit, setUpLater, createNewDestination: creating });
</script>
