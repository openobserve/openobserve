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
  Pipeline "Function" node form. The drawer chrome + save/cancel/delete live
  here; the picker body (create-toggle · inline AddFunction · select · preview ·
  After-Flattening toggle) is the SHARED FunctionPicker, so it stays in sync with
  the workflow function form.
-->
<template>
  <ODrawer
    data-test="associate-function-drawer"
    :open="internalOpen"
    @update:open="handleDrawerClose"
    :title="t('pipeline.associateFunction')"
    :width="isCreating ? 97 : 30"
    @keydown.stop
    :primaryButtonLabel="!isCreating ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!isCreating ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!isCreating && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    @click:primary="saveFunction"
    @click:secondary="openCancelDialog"
    @click:neutral="openDeleteDialog"
  >
    <div
      data-test="add-function-node-routing-section"
      class="tw:flex tw:flex-col tw:h-full"
      :class="store.state.theme === 'dark' ? 'tw:bg-(--o2-bg-card-dark,#1a1a1a)' : 'tw:bg-white'"
    >
      <div
        data-test="associate-function-routing-container"
        class="tw:rounded-lg tw:w-full tw:pt-3 tw:pb-3 tw:flex tw:flex-col tw:flex-1 tw:min-h-0"
        :class="!isCreating ? 'tw:px-3' : ''"
      >
        <FunctionPicker
          ref="picker"
          :initial-name="initialName"
          :initial-after-flatten="initialAfterFlatten"
          :duplicate-names="(associatedFunctions as string[])"
          @expand="onExpand"
          @created="onCreated"
        />
      </div>
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
import { useStore } from "vuex";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import FunctionPicker from "@/components/flow/forms/FunctionPicker.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  // Kept for call-site compatibility; the picker self-fetches its VRL list.
  functions: {
    type: Array,
    required: false,
    default: () => [],
  },
  associatedFunctions: {
    type: Array,
    required: true,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:node",
  "cancel:hideform",
  "delete:node",
  "add:function",
]);

const { t } = useI18n();
const store = useStore();
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
// True while the picker's inline "Create New Function" editor is open — widens
// the drawer and hides its Save/Cancel (AddFunction's toolbar owns them).
const isCreating = ref(false);
const onExpand = (v: boolean) => {
  isCreating.value = v;
};
const onCreated = (fn: any) => emit("add:function", fn);

const savedData = (pipelineObj.currentSelectedNodeData?.data ?? {}) as {
  name?: string;
  after_flatten?: boolean;
};
const initialName = savedData.name || "";
const initialAfterFlatten = savedData.after_flatten ?? true;

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

const openCancelDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Discard Changes";
  dialog.value.message = "Are you sure you want to cancel changes?";
  dialog.value.okCallback = () => emit("cancel:hideform");
};

const openDeleteDialog = () => {
  dialog.value.show = true;
  dialog.value.title = "Delete Node";
  dialog.value.message =
    "Are you sure you want to delete function association?";
  dialog.value.okCallback = deleteFunction;
};

const saveFunction = () => {
  const payload = picker.value?.getPayload();
  if (!payload) return; // picker surfaced its own validation
  addNode(payload);
  emit("cancel:hideform");
};

const deleteFunction = () => {
  deletePipelineNode(pipelineObj.currentSelectedNodeID);
  emit("cancel:hideform");
};

// exposed for tests / parent access
defineExpose({ isCreating, saveFunction });
</script>
