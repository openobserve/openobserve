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

<template>
  <ODrawer
    :open="internalOpen"
    @update:open="handleDrawerClose"
    title="External Destination"
    size="lg"
    :show-close="true"
    @keydown.stop
    :primaryButtonLabel="!createNewDestination ? t('alerts.save') : undefined"
    :secondaryButtonLabel="!createNewDestination ? t('alerts.cancel') : undefined"
    :neutralButtonLabel="!createNewDestination && pipelineObj.isEditNode ? t('pipeline.deleteNode') : undefined"
    neutralButtonVariant="outline-destructive"
    form-id="external-destination-form"
    @click:secondary="handleCancel"
    @click:neutral="openDeleteDialog"
  >
    <div class="w-full flex flex-col gap-4">
      <!-- Mode toggle — stays a bare UI control OUTSIDE the form: it swaps the
           select-existing form for the CreateDestinationForm create child. -->
      <OSwitch
        data-test="create-stream-toggle"
        :label="'Create new Destination'"
        v-model="createNewDestination"
      />

      <div v-if="createNewDestination" class="w-full">
        <!-- Create New Destination Form -->
        <CreateDestinationForm
          @created="handleDestinationCreated"
          @cancel="handleCancel"
        />
      </div>

      <!-- Select Existing Destination -->
      <OForm
        v-else
        id="external-destination-form"
        ref="formRef"
        :schema="externalDestinationSchema"
        :default-values="externalDestinationDefaults"
        @submit="saveDestination"
      >
        <OFormSelect
          data-test="external-destination-select"
          name="selectedDestination"
          :label="'Destination'"
          required
          :options="getFormattedDestinations"
          tabindex="0"
        />
      </OForm>
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
import { ref, computed, onBeforeMount, watch } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeExternalDestinationSchema,
  type ExternalDestinationForm,
} from "./ExternalDestination.schema";

const props = withDefaults(defineProps<{ open?: boolean }>(), { open: false });
const emit = defineEmits(["get:destinations", "cancel:hideform"]);

const internalOpen = ref(!!props.open);
watch(() => props.open, (v) => { internalOpen.value = !!v; });

function handleDrawerClose(v: boolean) {
  internalOpen.value = v;
  if (!v) {
    setTimeout(() => emit("cancel:hideform"), 300);
  }
}
const store = useStore();
const { t } = useI18n();

// Schema built here so its required message stays i18n-driven; bound in the
// template via <OForm :schema="externalDestinationSchema">.
const externalDestinationSchema = makeExternalDestinationSchema(t);

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();
const createNewDestination = ref(false);

// OForm instance ref — exposed so the drawer footer (form-id bridge) and specs
// can drive/read the real form. Typed `any` because OForm is generic.
const formRef = ref<any>(null);

// Seed for the form's `:default-values` (edit prefill / a just-created
// destination). The form owns the live value after mount.
const selectedDestinationSeed = ref<string>(
  pipelineObj.currentSelectedNodeData?.data?.destination_name ?? "",
);
const externalDestinationDefaults = computed((): ExternalDestinationForm => ({
  selectedDestination: selectedDestinationSeed.value,
}));

const destinations = ref([]);

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

onBeforeMount(() => {
  getDestinations();
});

watch(
  () => createNewDestination.value,
  (val) => {
    if (!val) {
      // When switching back to select mode, refresh destinations
      getDestinations();
    }
  },
);

const getFormattedDestinations = computed(() => {
  return destinations.value.map((destination: any) => {
    const truncatedUrl =
      destination.url.length > 70
        ? destination.url.slice(0, 70) + "..."
        : destination.url;

    return {
      label: destination.name,
      value: destination.name,
      subLabel: truncatedUrl,
      subLabelInline: true,
    };
  });
});

const getDestinations = () => {
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while loading destinations...",
      timeout: 0,
});
  destinationService
    .list({
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      org_identifier: store.state.selectedOrganization.identifier,
      module: "pipeline",
    })
    .then((res) => {
      destinations.value = res.data;
    })
    .catch((err) => {
      if (err.response.status != 403) {
        toast({
          variant: "error",
          message: "Error while pulling destinations.",
        });
      }
      dismiss();
    })
    .finally(() => dismiss());
};

// @submit handler — OForm only calls it once the schema passes
// (selectedDestination required), so the schema gates the save (the old
// imperative toast guard is gone).
const saveDestination = (value: ExternalDestinationForm) => {
  const destinationData = {
    destination_name: value.selectedDestination,
    node_type: "remote_stream",
    io_type: "output",
    org_id: store.state.selectedOrganization.identifier,
  };
  addNode(destinationData);
  emit("cancel:hideform");
};

const handleDestinationCreated = (destinationName: string) => {
  // Switch back to selection mode and select the newly created destination.
  // Seed it so the form re-mounts (when toggling out of create mode) with the
  // value; if the select form is already mounted, push it in directly.
  selectedDestinationSeed.value = destinationName;
  createNewDestination.value = false;
  if (formRef.value?.form) {
    formRef.value.form.setFieldValue("selectedDestination", destinationName);
  }
  getDestinations();
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

// Expose functions for testing
defineExpose({
  getDestinations,
  saveDestination,
  formRef,
  selectedDestinationSeed,
  destinations,
  getFormattedDestinations,
  createNewDestination,
  pipelineObj,
  dialog,
  openDeleteDialog,
  deleteRoute,
  handleDestinationCreated,
  handleCancel,
});
</script>
