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
  >
    <OPage>
      <div class="o2-input">
        <div class="row items-center no-wrap q-mx-md q-pb-sm q-pl-md q-pt-md">
          <div class="flex items-center tw:w-full">
            <div class="tw:w-full" data-test="add-destination-title">
              <div
                class="tw:text-[18px] tw:flex tw:items-center tw:justify-between"
              >
                External Destination
                <div>
                  <OButton variant="ghost" size="icon" v-close-popup>
                    <q-icon name="cancel" size="14px" />
                  </OButton>
                </div>
              </div>
            </div>
          </div>
        </div>
        <q-separator />
        <div class="row q-col-gutter-sm q-px-lg">
          <q-toggle
            data-test="create-stream-toggle"
            class="q-mb-sm tw:h-[36px] o2-toggle-button-xs tw:mr-3 q-mt-md"
            size="xs"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-xs-dark'
                : 'o2-toggle-button-xs-light'
            "
            :label="'Create new Destination'"
            v-model="createNewDestination"
          />

          <div v-if="createNewDestination" class="q-mt-sm q-mb-md col-12">
            <!-- Create New Destination Form -->
            <CreateDestinationForm
              @created="handleDestinationCreated"
              @cancel="handleCancel"
            />
          </div>

          <!-- Select Existing Destination -->
          <div v-else class="col-12">
            <div class="col-12 q-py-xs destination-method-select">
              <q-select
                data-test="external-destination-select"
                v-model="selectedDestination"
                :label="'Destination *'"
                :options="getFormattedDestinations"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                outlined
                filled
                dense
                tabindex="0"
              >
                <template v-slot:option="scope">
                  <q-item
                    style="max-width: calc(40vw - 42px)"
                    v-bind="scope.itemProps"
                  >
                    <q-item-section class="flex flex-col">
                      <q-item-label>
                        <span class="text-bold"> {{ scope.opt.label }}</span> -
                        <span class="truncate-url"> {{ scope.opt.url }}</span>
                      </q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
            </div>

            <!-- Action buttons for existing destination selection -->
            <div class="tw:flex tw:gap-2 q-mt-md q-mb-md">
              <OButton
                v-if="pipelineObj.isEditNode"
                data-test="add-destination-delete-btn"
                variant="outline-destructive"
                size="sm-action"
                @click="openDeleteDialog"
              >{{ t("pipeline.deleteNode") }}</OButton>
              <OButton
                data-test="add-destination-cancel-btn"
                variant="outline"
                size="sm-action"
                @click="handleCancel"
              >{{ t('alerts.cancel') }}</OButton>
              <OButton
                data-test="add-destination-save-btn"
                variant="primary"
                size="sm-action"
                @click="saveDestination"
              >{{ t('alerts.save') }}</OButton>
            </div>
          </div>
        </div>
      </div>
    </OPage>
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
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

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
const q = useQuasar();
const store = useStore();
const { t } = useI18n();

const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();
const createNewDestination = ref(false);
const selectedDestination: any = ref(
  pipelineObj.currentSelectedNodeData?.data?.destination_name
    ? {
        label: pipelineObj.currentSelectedNodeData.data.destination_name,
        value: pipelineObj.currentSelectedNodeData.data.destination_name,
      }
    : { label: "", value: "" },
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
      url: truncatedUrl,
    };
  });
});

const getDestinations = () => {
  const dismiss = q.notify({
    spinner: true,
    message: "Please wait while loading destinations...",
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
        q.notify({
          type: "negative",
          message: "Error while pulling destinations.",
          timeout: 2000,
        });
      }
      dismiss();
    })
    .finally(() => dismiss());
};

const saveDestination = () => {
  const destinationData = {
    destination_name: selectedDestination.value.value,
    node_type: "remote_stream",
    io_type: "output",
    org_id: store.state.selectedOrganization.identifier,
  };
  if (
    selectedDestination.value.hasOwnProperty("value") &&
    selectedDestination.value.value === ""
  ) {
    q.notify({
      message: "Please select External destination from the list",
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return;
  }
  addNode(destinationData);
  emit("cancel:hideform");
};

const handleDestinationCreated = (destinationName: string) => {
  // Switch back to selection mode and select the newly created destination
  selectedDestination.value = {
    label: destinationName,
    value: destinationName,
  };
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
