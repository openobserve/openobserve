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
  Pipeline "External Destination" node drawer.

  This file is CHROME ONLY: the drawer + Save/Cancel/Delete + addNode. The body
  is the SHARED DestinationPicker, the same component the workflow Destination
  node renders, so the two canvases cannot drift. The picker owns the form (zod
  schema + OForm) and hands back the payload from its awaited submit().

  While the picker's inline "create destination" form is open it carries its own
  Save/Cancel, so we hide this drawer's footer (the picker emits `expand`).
-->
<template>
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    title="External Destination"
    size="lg"
    :show-close="true"
    @keydown.stop
    :primaryButtonLabel="!creating ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!creating ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!creating && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveDestination"
    @click:secondary="handleCancel"
    @click:neutral="openDeleteDialog"
  >
    <!-- No padding here: ODrawer now pads its own body (bodyPaddingClass). -->
    <div class="w-full">
      <DestinationPicker
        ref="picker"
        :initial-name="initialDestinationName"
        @expand="(v) => (creating = v)"
      />
    </div>
  </ODrawer>
  <ConfirmDialog
    v-model="dialog.show"
    :title="dialog.title"
    :message="dialog.message"
    @update:ok="dialog.okCallback"
    @update:cancel="dialog.show = false"
  />
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DestinationPicker from "@/components/flow/forms/DestinationPicker.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits(["cancel:hideform"]);

const internalOpen = ref(!!props.open);
watch(
  () => props.open,
  (v) => {
    internalOpen.value = !!v;
  },
);

function handleDrawerClose(v: boolean) {
  internalOpen.value = v;
  if (!v) {
    setTimeout(() => emit("cancel:hideform"), 300);
  }
}

const store = useStore();
const { t } = useI18n();
const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

const picker = ref<any>(null);
// True while the picker's inline create form is open — the drawer hides its
// footer then (the create form carries its own Save/Cancel).
const creating = ref(false);

// Edit prefill — pipelines store the destination under `destination_name`.
const initialDestinationName = pipelineObj.currentSelectedNodeData?.data?.destination_name ?? "";

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

// The picker validates through the shared schema and returns null when the
// field is empty (rendering the error inline), so there is no guard here.
const saveDestination = async () => {
  const payload = await picker.value?.submit();
  if (!payload) return;
  addNode({
    destination_name: payload.destination_name,
    node_type: "remote_stream",
    io_type: "output",
    org_id: store.state.selectedOrganization.identifier,
  });
  emit("cancel:hideform");
};

const handleCancel = () => {
  emit("cancel:hideform");
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete stream routing?";
  dialog.value.okCallback = deleteRoute;
};

const deleteRoute = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);
  emit("cancel:hideform");
};

defineExpose({
  picker,
  creating,
  saveDestination,
  handleCancel,
  openDeleteDialog,
  deleteRoute,
  dialog,
  pipelineObj,
});
</script>
