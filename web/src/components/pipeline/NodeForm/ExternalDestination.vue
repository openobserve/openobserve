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
    class="full-height"
    style="width: 40vw"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <q-page>
      <div class="o2-input">
        <div class="row items-center no-wrap q-mx-md q-pb-sm q-pl-md q-pt-md">
          <div class="flex items-center tw-w-full">
            <div class="tw-w-full" data-test="add-destination-title">
              <div class="tw-text-[18px] tw-flex tw-items-center tw-justify-between">
                External Destination
                <div>
                  <q-btn v-close-popup="true" round flat icon="cancel" >
                  </q-btn>
                </div>
              </div>
            </div>
          </div>
        </div>
        <q-separator />
        <div class="row q-col-gutter-sm q-px-lg q-my-sm">
          <q-toggle
            data-test="create-stream-toggle"
            class="q-mb-sm tw-h-[36px] o2-toggle-button-lg tw-mr-3 -tw-ml-4"
            size="lg"
            :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
            :label="'Create new Destination'"
            v-model="createNewDestination"
          />
          <div
            v-if="!createNewDestination"
            class="col-12 q-py-xs destination-method-select"
          >
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
          <q-form
            ref="destinationForm"
            @submit="
              createNewDestination ? createDestination() : saveDestination()
            "
            class="col-12"
          >
            <div class="col-12 q-py-xs">
              <q-input
                v-if="createNewDestination"
                data-test="add-destination-name-input"
                v-model="formData.name"
                :label="t('alerts.name') + ' *'"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                outlined
                filled
                dense
                :rules="[
                  (val: any) =>
                    !!val
                      ? isValidResourceName(val) ||
                        `Characters like :, ?, /, #, and spaces are not allowed.`
                      : t('common.nameRequired'),
                ]"
                tabindex="0"
              />
            </div>
            <div v-if="createNewDestination" class="col-12 q-py-xs">
              <q-input
                data-test="add-destination-url-input"
                v-model="formData.url"
                :label="t('alert_destinations.url') + ' *'"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                outlined
                filled
                dense
                :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                tabindex="0"
              />
            </div>
            <div class="tw-flex tw-flex-row tw-gap-x-2">
              <div
              v-if="createNewDestination"
              class="tw-w-1/2 q-py-xs destination-method-select"
            >
              <q-select
                data-test="add-destination-method-select"
                v-model="formData.method"
                :label="t('alert_destinations.method') + ' *'"
                :options="apiMethods"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop"
                stack-label
                outlined
                :popup-content-style="{ textTransform: 'uppercase' }"
                filled
                dense
                :rules="[(val: any) => !!val || 'Field is required!']"
                tabindex="0"
              />
            </div>
            <div
              v-if="createNewDestination"
              class="tw-w-1/2 q-py-xs destination-method-select"
            >
              <q-select
                data-test="add-destination-output-format-select"
                v-model="formData.output_format"
                :label="t('alert_destinations.output_format') + ' *'"
                :options="outputFormats"
                color="input-border"
                bg-color="input-bg"
                class="showLabelOnTop "
                stack-label
                outlined
                :popup-content-style="{ textTransform: 'uppercase' }"
                filled
                dense
                :rules="[(val: any) => !!val || 'Field is required!']"
                tabindex="0"
              />
            </div>
            </div>

            <div v-if="createNewDestination" class="col-12 q-py-sm">
              <div class="text-bold q-py-xs" style="paddingleft: 10px">
                Headers
              </div>
              <div
                v-for="(header, index) in apiHeaders"
                :key="header.uuid"
                class="row q-col-gutter-sm q-pb-sm wrap"
              >
                <div class="col-5 q-ml-none">
                  <q-input
                    :data-test="`add-destination-header-${header['key']}-key-input`"
                    v-model="header.key"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    outlined
                    filled
                    :placeholder="t('alert_destinations.api_header')"
                    dense
                    tabindex="0"
                  />
                </div>
                <div class="col-5 q-ml-none">
                  <q-input
                    :data-test="`add-destination-header-${header['key']}-value-input`"
                    v-model="header.value"
                    :placeholder="t('alert_destinations.api_header_value')"
                    color="input-border"
                    bg-color="input-bg"
                    stack-label
                    outlined
                    filled
                    dense
                    isUpdatingDestination
                    tabindex="0"
                  />
                </div>
                <div class="col-2 q-ml-none headers-btns">
                  <q-btn
                    :data-test="`add-destination-header-${header['key']}-delete-btn`"
                    icon="delete"
                    class="q-ml-xs iconHoverBtn"
                    :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    :title="t('alert_templates.edit')"
                    @click="deleteApiHeader(header)"
                  />
                  <q-btn
                    data-test="add-destination-add-header-btn"
                    v-if="index === apiHeaders.length - 1"
                    icon="add"
                    :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                    class="q-ml-xs iconHoverBtn"
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    :title="t('alert_templates.edit')"
                    @click="addApiHeader()"
                  />
                </div>
              </div>
            </div>
            <div v-if="createNewDestination" class="col-12 q-py-sm">
                <q-toggle
                  data-test="add-destination-skip-tls-verify-toggle"
                  class=" tw-h-[36px] o2-toggle-button-lg tw-mr-3 -tw-ml-4"
                  size="lg"
                  :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
                  v-model="formData.skip_tls_verify"
                  :label="t('alert_destinations.skip_tls_verify')"
                />
            </div>
            <div class="flex justify-start">
              <q-btn
                  v-if="pipelineObj.isEditNode && !createNewDestination"
                  data-test="add-destination-delete-btn"
                  class="o2-secondary-button tw-h-[36px] q-mr-md"
                  color="negative"
                  flat
                  :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                  no-caps
                  @click="openDeleteDialog"
                >
                <q-icon name="delete" class="q-mr-xs" />
                {{ t('pipeline.deleteNode') }}
              </q-btn>
              <q-btn
                data-test="add-destination-cancel-btn"
                v-close-popup="true"
                class="o2-secondary-button tw-h-[36px]"
                :label="t('alerts.cancel')"
                flat
                :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                no-caps
                @click="$emit('cancel:hideform')"
              />
              <q-btn
                data-test="add-destination-submit-btn"
                :label="t('alerts.save')"
                class="no-border q-ml-md o2-primary-button tw-h-[36px]"
                :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
                flat
                type="submit"
                no-caps
              />
            </div>
          </q-form>
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
import {
  ref,
  computed,
  onBeforeMount,
  onActivated,
  watch,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import type {
  Template,
  DestinationData,
  Headers,
  DestinationPayload,
} from "@/ts/interfaces";
import { useRouter } from "vue-router";
import { isValidResourceName } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

import useDragAndDrop from "@/plugins/pipelines/useDnD";

const emit = defineEmits(["get:destinations", "cancel:hideform"]);
const q = useQuasar();
const apiMethods = ["get", "post", "put"];
const outputFormats = ["json", "ndjson"];
const store = useStore();
const { t } = useI18n();
const formData: Ref<DestinationData> = ref({
  name: "",
  url: "",
  method: "post",
  skip_tls_verify: false,
  template: "",
  headers: {},
  emails: "",
  type: "http",
  output_format: "json",
});
const isUpdatingDestination = ref(false);
const createNewDestination = ref(false);
const destinationForm = ref(null);
const { addNode, pipelineObj, deletePipelineNode } = useDragAndDrop();
const retries = ref(0);
const selectedDestination: any = ref(
  pipelineObj.currentSelectedNodeData?.data?.destination_name
    ? {
        label: pipelineObj.currentSelectedNodeData.data.destination_name,
        value: pipelineObj.currentSelectedNodeData.data.destination_name,
      }
    : { label: "", value: "" },
);
const destinations = ref([]);

const router = useRouter();

const dialog = ref({
  show: false,
  title: "",
  message: "",
  okCallback: () => {},
});

// TODO OK: Use UUID package instead of this and move this method in utils
const getUUID = () => {
  return (Math.floor(Math.random() * (9999999999 - 100 + 1)) + 100).toString();
};

const apiHeaders: Ref<
  {
    key: string;
    value: string;
    uuid: string;
  }[]
> = ref([{ key: "", value: "", uuid: getUUID() }]);

onActivated(() => {});
onBeforeMount(() => {
  getDestinations();
});
watch(
  () => createNewDestination.value,
  (val) => {
    if (val) {
      formData.value = {
        name: "",
        url: "",
        method: "post",
        skip_tls_verify: false,
        template: "",
        headers: {},
        emails: "",
        type: "http",
        output_format: "json",
      };
      apiHeaders.value = [{ key: "", value: "", uuid: getUUID() }];
    }
  },
);

const isValidDestination = computed(
  () => formData.value.name && formData.value.url && formData.value.method,
);
const createDestination = () => {
  if (!isValidDestination.value) {
    q.notify({
      type: "negative",
      message: "Please fill required fields",
      timeout: 1500,
    });
    return;
  }
  const dismiss = q.notify({
    spinner: true,
    message: "Please wait...",
    timeout: 2000,
  });
  const headers: Headers = {};
  apiHeaders.value.forEach((header) => {
    if (header["key"] && header["value"]) headers[header.key] = header.value;
  });

  const payload: any = {
    url: formData.value.url,
    method: formData.value.method,
    skip_tls_verify: formData.value.skip_tls_verify,
    template: formData.value.template,
    headers: headers,
    name: formData.value.name,
    type: "http",
    output_format: formData.value.output_format,
  };

  destinationService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      destination_name: formData.value.name,
      data: payload,
    })
    .then(() => {
      dismiss();
      // emit("cancel:hideform");
      q.notify({
        type: "positive",
        message: `Destination saved successfully.`,
      });
      selectedDestination.value = {
        label: formData.value.name,
        value: formData.value.name,
      };
      createNewDestination.value = false;

      getDestinations();
    })
    .catch((err: any) => {
      if (err.response?.status == 403) {
        return;
      }
      dismiss();
      q.notify({
        type: "negative",
        message: err.response?.data?.error || err.response?.data?.message,
      });
    });
};
const addApiHeader = (key: string = "", value: string = "") => {
  apiHeaders.value.push({ key: key, value: value, uuid: getUUID() });
};
const deleteApiHeader = (header: any) => {
  apiHeaders.value = apiHeaders.value.filter(
    (_header) => _header.uuid !== header.uuid,
  );
  if (formData.value?.headers?.[header.key])
    delete formData.value?.headers?.[header.key];
  if (!apiHeaders.value.length) addApiHeader();
};

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

const createEmailTemplate = () => {
  router.push({
    name: "alertTemplates",
    query: {
      action: "add",
      type: "email",
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};
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
  getUUID,
  createDestination,
  addApiHeader,
  deleteApiHeader,
  createEmailTemplate,
  getDestinations,
  saveDestination,
  formData,
  apiHeaders,
  selectedDestination,
  destinations,
  isValidDestination,
  getFormattedDestinations,
  createNewDestination,
  isUpdatingDestination,
  retries,
  apiMethods,
  outputFormats,
  pipelineObj
});
</script>
<style lang="scss" scoped>
.destination-method-select {
  .q-field__native > :first-child {
    text-transform: uppercase !important;
  }
}

.no-case .q-field__native span {
  text-transform: none !important;
}
.headers-btns {
  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
}
.truncate-url {
  display: inline-block;
  max-width: calc(40vw - 200px); /* Adjust the width as needed */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
