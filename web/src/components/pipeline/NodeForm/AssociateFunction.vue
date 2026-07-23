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
  Pipeline "Associate Function" node drawer.

  This file is CHROME ONLY: the drawer + Save/Cancel/Delete + addNode. The body
  is the SHARED FunctionPicker — the same component the workflow Function node
  renders — so the two canvases cannot drift. The picker owns the form (the
  AssociateFunction zod schema: required + "already associated") and the inline
  AddFunction editor, and hands back the payload from its awaited submit().

  While the inline function editor is open it carries its own Save/Cancel, so the
  drawer widens and hides its footer (the picker emits `expand`).
-->
<template>
  <ODrawer
    data-test="associate-function-drawer"
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.associateFunction')"
    :width="creating ? 97 : 30"
    :bleed="creating"
    @keydown.stop
    :primaryButtonLabel="!creating ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!creating ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!creating && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveFunction"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <!-- Padding drops away once the inline editor expands, so it can run
         full-bleed and the picker's toggle row supplies its own spacing —
         same contract WorkflowNodeDrawer follows. That is now expressed with
         ODrawer's `bleed` prop above rather than a manual px-3 here: the drawer
         pads its own body (bodyPaddingClass), so padding here would double up. -->
    <div data-test="add-function-node-routing-section" class="flex flex-col h-full bg-surface-base">
      <!-- NOTE: `is-updating` is deliberately NOT bound to pipelineObj.isEditNode.
           That flag means "editing the NODE"; the picker's isUpdating means
           "editing an existing FUNCTION" (it locks the select). Editing a node
           must still let you re-point it at a different function, which is how
           this drawer has always behaved. -->
      <!-- Pipelines execute VRL, so only VRL functions are selectable and the
           inline editor is locked to VRL (a JS function created here could never
           be attached to a pipeline node). -->
      <FunctionPicker
        ref="picker"
        :initial-name="initialName"
        :initial-after-flatten="initialAfterFlatten"
        :duplicate-names="associatedFunctions"
        language="vrl"
        @expand="(v) => (creating = v)"
        @created="(fn) => emit('add:function', fn)"
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
import { ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FunctionPicker from "@/components/flow/forms/FunctionPicker.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    associatedFunctions?: string[];
  }>(),
  {
    open: false,
    associatedFunctions: () => [],
  },
);

const emit = defineEmits(["update:node", "cancel:hideform", "delete:node", "add:function"]);

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
// True while the picker's inline function editor is open — the drawer widens and
// hides its footer then (the editor carries its own Save/Cancel).
const creating = ref(false);

// Edit prefill.
const initialName = (pipelineObj.currentSelectedNodeData?.data as { name?: string })?.name || "";
const initialAfterFlatten =
  (pipelineObj.currentSelectedNodeData?.data as { after_flatten?: boolean })?.after_flatten ?? true;

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

onMounted(() => {
  if (pipelineObj.userSelectedNode) {
    pipelineObj.userSelectedNode = {};
  }
});

// The picker validates through the shared schema (required + already-associated)
// and renders the error inline, returning null when invalid — so there is no
// guard here. It also returns null while the inline editor is still open.
const saveFunction = async () => {
  const payload = await picker.value?.submit();
  if (!payload) return;
  addNode({ name: payload.name, after_flatten: payload.after_flatten });
  emit("cancel:hideform");
};

const openCancelDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = () => emit("cancel:hideform");
  pipelineObj.userClickedNode = {};
  pipelineObj.userSelectedNode = {};
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message = "Are you sure you want to delete function association?";
  dialog.value.okCallback = deleteFunction;
};

const deleteFunction = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);
  emit("cancel:hideform");
};

defineExpose({
  picker,
  creating,
  saveFunction,
  openCancelDialog,
  openDeleteDialog,
  deleteFunction,
  dialog,
  pipelineObj,
});
</script>
