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
    @click:primary="saveDestination"
    @click:secondary="handleCancel"
    @click:neutral="openDeleteDialog"
  >
    <div class="tw:w-full tw:pt-3 tw:pb-3 tw:px-3 tw:flex tw:flex-col tw:gap-4">
      <OSwitch
        data-test="create-stream-toggle"
        :label="'Create new Destination'"
        v-model="createNewDestination"
      />

      <div v-if="createNewDestination" class="tw:w-full">
        <!-- Create New Destination Form -->
        <CreateDestinationForm
          @created="handleDestinationCreated"
          @cancel="handleCancel"
        />
      </div>

      <!-- Select Existing Destination -->
      <template v-else>
        <OSelect
          data-test="external-destination-select"
          v-model="selectedDestination"
          :label="'Destination *'"
          :options="getFormattedDestinations"
          class="destination-method-select"
          tabindex="0"
        />
      </template>
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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";
import { toast } from "@/lib/feedback/Toast/useToast";

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

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();
const createNewDestination = ref(false);
const selectedDestination = ref<string>(
  pipelineObj.currentSelectedNodeData?.data?.destination_name ?? "",
);
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

const saveDestination = () => {
  const destinationData = {
    destination_name: selectedDestination.value,
    node_type: "remote_stream",
    io_type: "output",
    org_id: store.state.selectedOrganization.identifier,
  };
  if (!selectedDestination.value) {
    toast({
      variant: "warning",
      message: "Please select External destination from the list",
    });
    return;
  }
  addNode(destinationData);
  emit("cancel:hideform");
};

const handleDestinationCreated = (destinationName: string) => {
  // Switch back to selection mode and select the newly created destination
  selectedDestination.value = destinationName;
  createNewDestination.value = false;
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
  selectedDestination,
  destinations,
  getFormattedDestinations,
  createNewDestination,
  pipelineObj,
  handleDestinationCreated,
  handleCancel,
});
</script>

<style lang="scss" scoped>
.destination-method-select {
  .q-field__native > :first-child {
    text-transform: uppercase !important;
  }
}

.truncate-url {
  display: inline-block;
  max-width: calc(40vw - 200px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
