<!-- Copyright 2023 OpenObserve Inc.

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
  <div
    data-test="add-stream-input-stream-routing-section"
    class="tw-h-[calc(100vh)] tw-overflow-auto tw-w-[40vw]"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <q-page>
      <div class="o2-input">
        <div class="row items-center no-wrap q-mx-md q-pb-sm q-pl-md q-pt-md">
          <div class="flex items-center tw-w-full">
            <div class="tw-w-full" data-test="add-destination-title">
              <div
                class="tw-text-[18px] tw-flex tw-items-center tw-justify-between"
              >
                External Destination
                <div>
                  <q-btn v-close-popup="true" round flat icon="cancel"> </q-btn>
                </div>
              </div>
            </div>
          </div>
        </div>
        <q-separator />
        <div class="row q-col-gutter-sm q-px-lg">
          <q-toggle
            data-test="create-stream-toggle"
            class="q-mb-sm tw-h-[36px] o2-toggle-button-xs tw-mr-3 q-mt-md"
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
            <div class="flex justify-start q-mt-md q-mb-md">
              <q-btn
                v-if="pipelineObj.isEditNode"
                data-test="add-destination-delete-btn"
                class="o2-secondary-button tw-h-[36px] q-mr-sm"
                color="negative"
                flat
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-secondary-button-dark'
                    : 'o2-secondary-button-light'
                "
                no-caps
                @click="openDeleteDialog"
              >
                <q-icon name="delete" class="q-mr-xs" />
                {{ t("pipeline.deleteNode") }}
              </q-btn>
              <q-btn
                data-test="add-destination-cancel-btn"
                v-close-popup="true"
                class="o2-secondary-button tw-h-[36px]"
                :label="t('alerts.cancel')"
                flat
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-secondary-button-dark'
                    : 'o2-secondary-button-light'
                "
                no-caps
                @click="handleCancel"
              />
              <q-btn
                data-test="add-destination-save-btn"
                :label="t('alerts.save')"
                class="no-border q-ml-sm o2-primary-button tw-h-[36px]"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-primary-button-dark'
                    : 'o2-primary-button-light'
                "
                flat
                no-caps
                @click="saveDestination"
              />
            </div>
          </div>
        </div>
      </div>
    </q-page>
  </div>
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
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import CreateDestinationForm from "./CreateDestinationForm.vue";
import useDragAndDrop from "@/plugins/pipelines/useDnD";

const emit = defineEmits(["get:destinations", "cancel:hideform"]);
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
// Destination Type Cards Grid
.destination-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.destination-type-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 12px;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 120px;

  &:hover {
    border-color: #1976d2;
    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: #1976d2;
    background: linear-gradient(135deg, #e3f2fd 0%, #ffffff 100%);
    box-shadow: 0 4px 16px rgba(25, 118, 210, 0.2);

    .card-icon {
      color: #1976d2;
    }
  }

  &.dark-mode {
    background: #1e1e1e;
    border-color: #424242;

    &:hover {
      border-color: #5d9cec;
      box-shadow: 0 4px 12px rgba(93, 156, 236, 0.2);
    }

    &.selected {
      border-color: #5d9cec;
      background: linear-gradient(135deg, #1a3a52 0%, #1e1e1e 100%);
      box-shadow: 0 4px 16px rgba(93, 156, 236, 0.25);

      .card-icon {
        color: #5d9cec;
      }
    }
  }

  .card-icon {
    margin-bottom: 8px;
    color: #666;
    transition: color 0.3s ease;
  }

  .card-label {
    font-size: 13px;
    font-weight: 500;
    text-align: center;
    line-height: 1.3;
    margin-top: 4px;
  }

  .check-icon {
    position: absolute;
    top: 8px;
    right: 8px;
  }
}

// Stepper Styles
.modern-stepper {
  box-shadow: none;

  :deep(.q-stepper__header) {
    border-bottom: 1px solid #e0e0e0;
  }

  :deep(.q-stepper__tab) {
    padding: 16px 24px;
  }

  :deep(.q-stepper__tab--active) {
    color: #1976d2;
    font-weight: 600;
  }

  :deep(.q-stepper__tab--done) {
    color: #4caf50;
  }

  :deep(.q-stepper__dot) {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  :deep(.q-stepper__step-inner) {
    padding: 24px 0;
  }
}

// Connection Notes Card
.connection-notes-card {
  border-radius: 8px;
  border: 1px solid #e3f2fd;

  .connection-steps {
    line-height: 1.8;

    li {
      margin-bottom: 8px;
      color: inherit;
    }
  }

  .example-url {
    border-radius: 6px;
    font-size: 13px;

    code {
      background: transparent;
      padding: 0;
      font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
      color: #1976d2;
    }
  }
}

// Enhanced input fields
.showLabelOnTop {
  :deep(.q-field__prepend) {
    padding-right: 8px;
  }
}

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
