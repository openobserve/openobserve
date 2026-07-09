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
  Pipeline "External Destination" node form. The drawer chrome + save/delete live
  here; the picker body (create-toggle · inline CreateDestinationForm · select)
  is the SHARED DestinationPicker, so it stays in sync with the workflow
  destination form.
-->
<template>
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    title="External Destination"
    size="lg"
    :show-close="true"
    @keydown.stop
    :primaryButtonLabel="!isCreating ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!isCreating ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!isCreating && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveDestination"
    @click:secondary="handleCancel"
    @click:neutral="openDeleteDialog"
  >
    <div class="tw:w-full tw:pt-3 tw:pb-3 tw:px-3 tw:flex tw:flex-col tw:gap-4">
      <DestinationPicker
        ref="picker"
        :initial-name="initialName"
        @expand="(v) => (isCreating = v)"
      />
    </div>
  </ODrawer>
  <confirm-dialog
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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DestinationPicker from "@/components/flow/forms/DestinationPicker.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits(["get:destinations", "cancel:hideform"]);

const { t } = useI18n();
const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();

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

const picker = ref<any>(null);
const isCreating = ref(false);
const initialName =
  (pipelineObj.currentSelectedNodeData?.data as { destination_name?: string })
    ?.destination_name ?? "";

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const saveDestination = () => {
  const payload = picker.value?.getPayload();
  if (!payload) return; // picker surfaced its own validation
  addNode({
    destination_name: payload.destination_name,
    node_type: "remote_stream",
    io_type: "output",
    org_id: payload.org_id,
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

defineExpose({ isCreating, saveDestination });
</script>
