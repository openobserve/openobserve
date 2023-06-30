<!-- Copyright 2022 Zinc Labs Inc. and Contributors
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
     http:www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-page class="q-pa-none q-pa-md" style="min-height: inherit">
    <div>
      <div class="col-12 items-center no-wrap">
        <div class="col" data-test="add-destination-title">
          <div v-if="destination" class="text-h6">
            {{ t("alert_destinations.updateTitle") }}
          </div>
          <div v-else class="text-h6">
            {{ t("alert_destinations.addTitle") }}
          </div>
        </div>
      </div>
      <q-separator />
      <div class="row q-col-gutter-sm q-pt-lg">
        <div class="col-6 q-py-xs">
          <q-input data-test="add-destination-name-input" v-model="formData.name" :label="t('alerts.name')"
            color="input-border" bg-color="input-bg" class="showLabelOnTop" stack-label outlined filled dense
            v-bind:readonly="isUpdatingDestination" v-bind:disable="isUpdatingDestination"
            :rules="[(val: any) => !!val || 'Field is required!']" tabindex="0" />
        </div>
        <div class="col-6 row q-py-xs">
          <div class="col-12">
            <q-select data-test="add-destination-template-select" v-model="formData.template"
              :label="t('alert_destinations.template')" :options="getFormattedTemplates" color="input-border"
              bg-color="input-bg" class="showLabelOnTop no-case" stack-label outlined filled dense
              :rules="[(val: any) => !!val || 'Field is required!']" tabindex="0" />
          </div>
        </div>
        <div class="col-6 q-py-xs">
          <q-input data-test="add-destination-url-input" v-model="formData.url" :label="t('alert_destinations.url')"
            color="input-border" bg-color="input-bg" class="showLabelOnTop" stack-label outlined filled dense
            :rules="[(val: any) => !!val || 'Field is required!']" tabindex="0" />
        </div>
        <div class="col-6 q-py-xs destination-method-select">
          <q-select data-test="add-destination-method-select" v-model="formData.method"
            :label="t('alert_destinations.method')" :options="apiMethods" color="input-border" bg-color="input-bg"
            class="showLabelOnTop" stack-label outlined :popup-content-style="{ textTransform: 'uppercase' }" filled dense
            :rules="[(val: any) => !!val || 'Field is required!']" tabindex="0" />
        </div>
        <div class="col-12 q-py-sm">
          <div class="text-bold q-py-xs" style="paddingleft: 10px">Headers</div>
          <div v-for="(header, index) in apiHeaders" :key="header.uuid" class="row q-col-gutter-sm q-pb-sm">
            <div class="col-5 q-ml-none">
              <q-input :data-test="`add-destination-header-${header['key']}-key-input`" v-model="header.key"
                color="input-border" bg-color="input-bg" class="showLabelOnTop" stack-label outlined filled
                :placeholder="t('alert_destinations.api_header')" dense tabindex="0" />
            </div>
            <div class="col-5 q-ml-none">
              <q-input :data-test="`add-destination-header-${header['key']}-value-input`" v-model="header.value"
                :placeholder="t('alert_destinations.api_header_value')" color="input-border" bg-color="input-bg"
                class="showLabelOnTop" stack-label outlined filled dense isUpdatingDestination tabindex="0" />
            </div>
            <div class="col-2 q-ml-none">
              <q-btn :data-test="`add-destination-header-${header['key']}-delete-btn`" icon="delete"
                class="q-ml-xs iconHoverBtn" padding="sm" unelevated size="sm" round flat
                :title="t('alert_templates.edit')" @click="deleteApiHeader(header)" />
              <q-btn data-test="add-destination-add-header-btn" v-if="index === apiHeaders.length - 1" icon="add"
                class="q-ml-xs iconHoverBtn" padding="sm" unelevated size="sm" round flat
                :title="t('alert_templates.edit')" @click="addApiHeader()" />
            </div>
          </div>
        </div> 
        <div class="col-12 q-py-sm">
          <div class="q-py-sm">
            <q-toggle class="q-mt-sm" v-model="formData.skip_tls_verify"
              :label="t('alert_destinations.skip_tls_verify')" />
          </div>
        </div>
      </div>
    </div>
    <div class="flex justify-center q-mt-lg">
      <q-btn data-test="add-destination-cancel-btn" v-close-popup class="q-mb-md text-bold"
        :label="t('alerts.cancel')" text-color="light-text" padding="sm md" no-caps
        @click="$emit('cancel:hideform')" />
      <q-btn data-test="add-destination-submit-btn" :label="t('alerts.save')" class="q-mb-md text-bold no-border q-ml-md"
        color="secondary" padding="sm xl" @click="saveDestination" no-caps />
    </div>
  </q-page>
</template>
<script lang="ts" setup>
import {
  ref,
  computed,
  defineProps,
  onBeforeMount,
  onActivated,
  defineEmits,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import type { Template, DestinationData, Headers } from "@/ts/interfaces";
const props = defineProps<{
  templates: Template[] | [];
  destination: DestinationData | null;
}>();
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
});
const isUpdatingDestination = ref(false);

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
onActivated(() => setupDestinationData());
onBeforeMount(() => {
  setupDestinationData();
});

const setupDestinationData = () => {
  if (props.destination) {
    isUpdatingDestination.value = true;
    formData.value.name = props.destination.name;
    formData.value.url = props.destination.url;
    formData.value.method = props.destination.method;
    formData.value.skip_tls_verify = props.destination.skip_tls_verify;
    const template = props.destination.template as Template;
    formData.value.template = template.name;
    formData.value.headers = props.destination.headers;
    if (Object.keys(formData.value.headers).length) {
      apiHeaders.value = [];
      Object.entries(formData.value.headers).forEach(([key, value]) => {
        addApiHeader(key, value);
      });
    }
  }
};
const getFormattedTemplates = computed(() =>
  props.templates.map((template: any) => template.name)
);
const isValidDestination = computed(
  () =>
    formData.value.name &&
    formData.value.url &&
    formData.value.method &&
    formData.value.template
);
const saveDestination = () => {
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
  destinationService
    .create({
      org_identifier: store.state.selectedOrganization.identifier,
      destination_name: formData.value.name,
      data: {
        url: formData.value.url,
        method: formData.value.method,
        skip_tls_verify: formData.value.skip_tls_verify,
        template: formData.value.template,
        headers: headers,
      },
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
    .catch((err) => {
      dismiss();
      q.notify({
        type: "negative",
        message: err.response.data.error,
      });
    });
};
const addApiHeader = (key: string = "", value: string = "") => {
  apiHeaders.value.push({ key: key, value: value, uuid: getUUID() });
};
const deleteApiHeader = (header: any) => {
  apiHeaders.value = apiHeaders.value.filter(
    (_header) => _header.uuid !== header.uuid
  );
  if (formData.value.headers[header.key])
    delete formData.value.headers[header.key];
  if (!apiHeaders.value.length) addApiHeader();
};
</script>
<style lang="scss" scoped>
#editor {
  width: 100%;
  min-height: 5rem;
  padding-bottom: 14px;
  resize: both;
}

.page-content {
  height: calc(100vh - 112px);
}
</style>
<style lang="scss">
.destination-method-select {
  .q-field__native> :first-child {
    text-transform: uppercase !important;
  }
}

.no-case .q-field__native span {
  text-transform: none !important;
}
</style>
