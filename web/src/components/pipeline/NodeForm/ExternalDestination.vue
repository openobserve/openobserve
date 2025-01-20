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
          <div class="flex items-center">
            <div class="col" data-test="add-destination-title">
              <div class="text-h6">External Destination</div>
            </div>
          </div>
        </div>
        <q-separator />
        <div class="row q-col-gutter-sm q-px-lg q-my-md">
          <q-toggle
            data-test="create-stream-toggle"
            class="q-mb-sm"
            :label="'Create new Destination'"
            v-model="createNewDestination"
          />
          <div
            v-if="!createNewDestination"
            class="col-12 q-py-xs destination-method-select q-pb-md"
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
            />
          </div>
          <div class="col-12 q-pb-md"></div>
          <div v-if="createNewDestination" class="col-12 q-py-xs">
            <q-input
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
          <div v-if="createNewDestination" class="col-6 q-py-xs">
            <q-select
              v-model="formData.stream_type"
              :options="streamTypes"
              :label="t('alerts.streamType') + ' *'"
              :popup-content-style="{ textTransform: 'lowercase' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop no-case"
              stack-label
              outlined
              filled
              dense
              v-bind:readonly="isUpdatingDestination"
              v-bind:disable="isUpdatingDestination"
              @update:model-value="updateStreams()"
              :rules="[(val: any) => !!val || 'Field is required!']"
              style="min-width: 220px"
            />
          </div>
          <div v-if="createNewDestination" class="col-6 q-py-xs ">
            <q-select
              v-model="formData.stream_name"
              :options="filteredStreams"
              :label="t('alerts.stream_name') + ' *'"
              :loading="isFetchingStreams"
              :popup-content-style="{ textTransform: 'lowercase' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop no-case"
              filled
              stack-label
              dense
              use-input
              hide-selected
              fill-input
              :input-debounce="400"
              v-bind:readonly="isUpdatingDestination"
              v-bind:disable="isUpdatingDestination"
              @filter="filterStreams"
              @update:model-value="updateStreamFields(formData.stream_name)"
              behavior="menu"
              :rules="[(val: any) => !!val || 'Field is required!']"
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
          <div
            v-if="createNewDestination"
            class="col-12 q-py-xs destination-method-select"
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
            <div class="q-py-sm">
              <q-toggle
                data-test="add-destination-skip-tls-verify-toggle"
                class="q-mt-sm"
                v-model="formData.skip_tls_verify"
                :label="t('alert_destinations.skip_tls_verify')"
              />
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-center q-mt-lg">
        <q-btn
          data-test="add-destination-cancel-btn"
          v-close-popup="true"
          class="q-mb-md text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="$emit('cancel:hideform')"
        />
        <q-btn
          data-test="add-destination-submit-btn"
          :label="t('alerts.save')"
          class="q-mb-md text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          @click="createNewDestination ? createDestination() : saveDestination()"
          no-caps
        />
      </div>
    </q-page>
  </div>
</template>
<script lang="ts" setup>
import {
  ref,
  computed,
  defineProps,
  onBeforeMount,
  onActivated,
  defineEmits,
  reactive,
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

import useDragAndDrop from "@/plugins/pipelines/useDnD";
import useStreams from "@/composables/useStreams";

const emit = defineEmits(["get:destinations", "cancel:hideform"]);
const q = useQuasar();
const apiMethods = ["get", "post", "put"];
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
  type: "remote_pipeline",
  stream_name: "",
  stream_type: "logs",
});
const isUpdatingDestination = ref(false);
const createNewDestination = ref(false);
const isFetchingStreams = ref(false);
const streamTypes = ["logs", "metrics", "traces"];
const indexOptions = ref([]);

const originalStreamFields = ref([]);
const filteredColumns = ref([]);
const schemaList = ref([]);
const streams: any = ref({});

const { getStreams, getStream } = useStreams();
const { addNode, pipelineObj } = useDragAndDrop();
const retries = ref(0);
const selectedDestination = ref(
  pipelineObj.currentSelectedNodeData.data.destination_name || "",
);
const destinations = ref([]);

const router = useRouter();
const filteredStreams: Ref<string[]> = ref([]);


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
  updateStreams();
  getDestinations();
});

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
    type: "remote_pipeline",
    stream_name: formData.value.stream_name,
    stream_type: formData.value.stream_type,
    org_id: store.state.selectedOrganization.identifier,
  };

  destinationService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      destination_name: formData.value.name,
      data: payload,
    })
    .then(() => {
      dismiss();
      emit("get:destinations");
      emit("cancel:hideform");
      q.notify({
        type: "positive",
        message: `Destination saved successfully.`,
      });
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
  if (formData.value.headers[header.key])
    delete formData.value.headers[header.key];
  if (!apiHeaders.value.length) addApiHeader();
};

const getFormattedDestinations = computed(() => {
  return destinations.value.map((destination: any) => {
    return {
      label: destination.name,
      value: destination.name,
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
      dst_type: "remote_pipeline",
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
  };
  if (!selectedDestination.value) {
    q.notify({
      message: "Please select Stream from the list",
      color: "negative",
      position: "bottom",
      timeout: 2000,
    });
    return;
  }
  addNode(destinationData);
  emit("cancel:hideform");
};
const updateStreamFields = async (stream_name: any) => {
          let streamCols: any = [];
          const streams: any = await getStream(
            stream_name,
            formData.value.stream_type || "logs",
            true,
          );

          if (streams && Array.isArray(streams.schema)) {
            streamCols = streams.schema.map((column: any) => ({
              label: column.name,
              value: column.name,
              type: column.type,
            }));
          }

          // originalStreamFields.value = [...streamCols];
          // filteredColumns.value = [...streamCols];

          };
          const updateStreams = (resetStream = true) => {
              if (resetStream && !isUpdatingDestination.value)
                formData.value.stream_name = "";
              if (formData.value.stream_type && streams.value[formData.value.stream_type]) {
                  schemaList.value = streams.value[formData.value.stream_type];
                  indexOptions.value = streams.value[formData.value.stream_type].map(
                    (data: any) => {
                      return data.name;
                    },
                  );
                  return;
                }

                if (!formData.value.stream_type) return Promise.resolve();

                isFetchingStreams.value = true;
                return getStreams(formData.value.stream_type, false)
                  .then((res: any) => {
                    if (formData.value.stream_type) {
                      streams.value[formData.value.stream_type] = res.list;
                    }
                    schemaList.value = res.list;
                    indexOptions.value = res.list.map((data: any) => {
                      return data.name;
                    });

                    if (formData.value.stream_name)
                      updateStreamFields(formData.value.stream_name);
                    return Promise.resolve();
                  })
                  .catch(() => Promise.reject())
                  .finally(() => (isFetchingStreams.value = false));
              };
          const filterColumns = (options: any[], val: String, update: Function) => {
            let filteredOptions: any[] = [];
            if (val === "") {
              update(() => {
                filteredOptions = [...options];
              });
              return filteredOptions;
            }
            update(() => {
              const value = val.toLowerCase();
              filteredOptions = options.filter(
                (column: any) => column.toLowerCase().indexOf(value) > -1,
              );
            });
            return filteredOptions;
          };
    const filterStreams = (val: string, update: any) => {
      filteredStreams.value = filterColumns(indexOptions.value, val, update);
    };
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
</style>
