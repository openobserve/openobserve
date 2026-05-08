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
  <div class="create-destination-form tw:h-full tw:overflow-hidden">
    <q-form
      ref="destinationForm"
      @submit="createDestination"
      class="col-12 pipeline-add-remote-destination-form tw:h-full tw:overflow-hidden"
    >
      <div style="display: flex; height: 100%; overflow: hidden; gap: 24px;">
        <!-- Left Column: Form Fields -->
        <div style="flex: 1; overflow-y: auto; min-height: 0; min-width: 0;">
          <div class="tw:flex tw:flex-col tw:gap-4">
            <!-- Row 1: Destination Type -->
            <div class="row q-col-gutter-xs">
              <div class="col-12">
                <q-select
                  data-test="add-destination-type-select"
                  v-model="formData.destination_type"
                  :label="'Destination Type' + ' *'"
                  :options="destinationTypes"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  stack-label
                  emit-value
                  hide-bottom-space
                  map-options
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  tabindex="0"
                >
                  <template #selected-item="scope">
                    <div class="row items-center no-wrap">
                      <img
                        v-if="scope.opt.image"
                        :src="scope.opt.image"
                        class="option-image q-mr-sm"
                      />
                      <q-icon
                        v-else
                        :name="scope.opt.icon"
                        size="20px"
                        class="q-mr-sm"
                      />
                      <span>{{ scope.opt.label }}</span>
                    </div>
                  </template>
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps" class="dest-option-item">
                      <q-item-section avatar>
                        <img
                          v-if="scope.opt.image"
                          :src="scope.opt.image"
                          class="option-image"
                        />
                        <q-icon
                          v-else
                          :name="scope.opt.icon"
                          size="22px"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-separator
                      v-if="scope.opt.value !== destinationTypes[destinationTypes.length - 1].value"
                    />
                  </template>
                </q-select>
              </div>
            </div>

            <!-- Row 2: Name -->
            <div class="row q-col-gutter-xs">
              <div class="col-12">
                <q-input
                  data-test="add-destination-name-input"
                  v-model="formData.name"
                  :label="t('alerts.name') + ' *'"
                  class="no-border showLabelOnTop"
                  borderless
                  hide-bottom-space
                  dense
                  flat
                  stack-label
                  :rules="[
                    (val: any) =>
                      !!val
                        ? isValidResourceName(val) ||
                          `Characters like :, ?, /, #, and spaces are not allowed.`
                        : t('common.nameRequired'),
                  ]"
                  tabindex="0"
                ></q-input>
              </div>
            </div>

            <!-- Row 2: OpenObserve Organization + Stream Name -->
            <div
              v-if="formData.destination_type === 'openobserve'"
              class="row q-col-gutter-xs"
            >
              <div class="col-6">
                <q-input
                  data-test="add-destination-openobserve-org-input"
                  v-model="openobserveOrg"
                  :label="'Organization *'"
                  :placeholder="'e.g., default'"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) =>
                      !!val?.trim() ||
                      'Organization is required for OpenObserve',
                  ]"
                  tabindex="0"
                >
                  <template #hint>
                    <span class="text-caption">
                      OpenObserve organization identifier
                    </span>
                  </template>
                </q-input>
              </div>
              <div class="col-6">
                <q-input
                  data-test="add-destination-openobserve-stream-input"
                  v-model="openobserveStream"
                  :label="'Stream Name *'"
                  :placeholder="'e.g., default'"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) =>
                      !!val?.trim() ||
                      'Stream name is required for OpenObserve',
                  ]"
                  tabindex="0"
                >
                  <template #hint>
                    <span class="text-caption"> OpenObserve stream name </span>
                  </template>
                </q-input>
              </div>
            </div>

            <!-- URL -->
            <div class="row q-col-gutter-xs">
              <div class="col-12">
                <q-input
                  data-test="add-destination-url-input"
                  v-model="formData.url"
                  :label="t('alert_destinations.url') + ' *'"
                  :placeholder="'https://your-domain.com'"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) => !!val.trim() || 'Field is required!',
                    (val: any) =>
                      !val.trim().endsWith('/') ||
                      'URL should not end with a trailing slash',
                  ]"
                  tabindex="0"
                >
                  <template #hint>
                    <span class="text-caption">Base URL without trailing slash</span>
                  </template>
                </q-input>
              </div>
            </div>

            <!-- Endpoint Path + Output Format -->
            <div class="row q-col-gutter-xs">
              <div class="col-6">
                <q-input
                  data-test="add-destination-url-endpoint-input"
                  v-model="formData.url_endpoint"
                  :label="
                    formData.destination_type === 'custom'
                      ? 'Endpoint Path'
                      : 'Endpoint Path *'
                  "
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :disable="formData.destination_type !== 'custom'"
                  :rules="[
                    ...(formData.destination_type === 'custom'
                      ? []
                      : [(val: any) => !!val.trim() || 'Field is required!']),
                    (val: any) =>
                      !val.trim() ||
                      val.trim().startsWith('/') ||
                      'Endpoint path must start with /',
                  ]"
                  tabindex="0"
                >
                  <template #hint>
                    <span class="text-caption">
                      Path will be appended to base URL (must start with /)
                    </span>
                  </template>
                </q-input>
              </div>
              <div class="col-6">
                <q-select
                  data-test="add-destination-output-format-select"
                  v-model="formData.output_format"
                  :label="t('alert_destinations.output_format') + ' *'"
                  :options="outputFormats"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  emit-value
                  map-options
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  :disable="formData.destination_type !== 'custom'"
                  tabindex="0"
                />
              </div>
            </div>
            <!-- Method field - only shown for Custom destination type -->
            <div
              v-if="formData.destination_type === 'custom'"
              class="row q-col-gutter-xs"
            >
              <div class="col-12">
                <q-select
                  data-test="add-destination-method-select"
                  v-model="formData.method"
                  :label="t('alert_destinations.method') + ' *'"
                  :options="apiMethods"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :popup-content-style="{ textTransform: 'uppercase' }"
                  :rules="[(val: any) => !!val || 'Field is required!']"
                  tabindex="0"
                />
              </div>
            </div>

            <!-- ESBulk Index Name field - only shown when output format is esbulk -->
            <div
              v-if="formData.output_format === 'esbulk'"
              class="row q-col-gutter-xs"
            >
              <div class="col-12">
                <q-input
                  data-test="add-destination-esbulk-index-input"
                  v-model="formData.esbulk_index"
                  :label="'ESBulk Index Name *'"
                  :placeholder="'Enter index name (e.g., logs, events)'"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) =>
                      !!val?.trim() || 'Index name is required for ESBulk format',
                  ]"
                  tabindex="0"
                >
                  <template v-slot:hint>
                    Index name where data will be written in Elasticsearch
                  </template>
                </q-input>
              </div>
            </div>

            <!-- StringSeparated Separator field - only shown when output format is stringseparated -->
            <div
              v-if="formData.output_format === 'stringseparated'"
              class="row q-col-gutter-xs"
            >
              <div class="col-12">
                <q-input
                  data-test="add-destination-separator-input"
                  v-model="formData.separator"
                  :label="t('alert_destinations.separator') + ' *'"
                  :placeholder="t('alert_destinations.separator_placeholder')"
                  class="no-border showLabelOnTop"
                  borderless
                  dense
                  flat
                  hide-bottom-space
                  stack-label
                  :rules="[
                    (val: any) =>
                      (val !== null && val !== undefined && val !== '') ||
                      'Separator is required for StringSeparated format',
                  ]"
                  tabindex="0"
                >
                  <template v-slot:hint>
                    {{ t('alert_destinations.separator_hint') }}
                  </template>
                </q-input>
              </div>
            </div>
          </div>

          <!-- Destination-specific Metadata Section -->
          <div v-if="showMetadataFields" class="q-mt-md">
            <div class="row q-col-gutter-xs">
              <div class="col-12">
                <div class="tw:text-[14px] tw:font-bold header-label">
                  Metadata Configuration
                </div>
              </div>
            </div>

            <div class="q-gutter-sm">
              <!-- Splunk Metadata Fields -->
              <template v-if="formData.destination_type === 'splunk'">
                <div class="row q-col-gutter-xs">
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-source-input"
                      v-model="formData.metadata!.source"
                      :label="'Source'"
                      :placeholder="'Enter source (e.g., http:my_source)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      tabindex="0"
                    >
                      <template v-slot:hint>
                        Splunk source field for event metadata
                      </template>
                    </q-input>
                  </div>
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-sourcetype-input"
                      v-model="formData.metadata!.sourcetype"
                      :label="'Source Type'"
                      :placeholder="'Enter source type (e.g., _json)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      tabindex="0"
                    >
                      <template v-slot:hint>
                        Splunk sourcetype field for event metadata
                      </template>
                    </q-input>
                  </div>
                </div>
                <div class="row q-col-gutter-xs">
                  <div class="col-12">
                    <q-input
                      data-test="add-destination-metadata-hostname-input"
                      v-model="formData.metadata!.hostname"
                      :label="'Hostname'"
                      :placeholder="'Enter hostname (e.g., server01)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      tabindex="0"
                    >
                      <template v-slot:hint>
                        Splunk host field for event metadata
                      </template>
                    </q-input>
                  </div>
                </div>
              </template>

              <!-- Datadog Metadata Fields -->
              <template v-if="formData.destination_type === 'datadog'">
                <div class="row q-col-gutter-xs">
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-ddsource-input"
                      v-model="formData.metadata!.ddsource"
                      :label="'DD Source *'"
                      :placeholder="'Enter source (e.g., nginx, java)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      :rules="[
                        (val: any) =>
                          !!val?.trim() || 'DD Source is required for Datadog',
                      ]"
                      tabindex="0"
                    >
                      <template v-slot:hint>
                        Source attribute for Datadog logs
                      </template>
                    </q-input>
                  </div>
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-ddtags-input"
                      v-model="formData.metadata!.ddtags"
                      :label="'DD Tags *'"
                      :placeholder="'Enter tags (e.g., env:prod,version:1.0)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      :rules="[
                        (val: any) =>
                          !!val?.trim() || 'DD Tags are required for Datadog',
                      ]"
                      tabindex="0"
                    >
                      <template v-slot:hint>
                        Comma-separated tags for Datadog logs
                      </template>
                    </q-input>
                  </div>
                </div>
                <div class="row q-col-gutter-xs">
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-service-input"
                      v-model="formData.metadata!.service"
                      :label="'Service'"
                      :placeholder="'Enter service name (e.g., api-gateway)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      tabindex="0"
                    >
                      <template v-slot:hint> Service name for Datadog logs </template>
                    </q-input>
                  </div>
                  <div class="col-6">
                    <q-input
                      data-test="add-destination-metadata-hostname-input"
                      v-model="formData.metadata!.hostname"
                      :label="'Hostname'"
                      :placeholder="'Enter hostname (e.g., server01)'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      tabindex="0"
                    >
                      <template v-slot:hint> Hostname for Datadog logs </template>
                    </q-input>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <div class="row q-col-gutter-xs q-mt-md">
              <div class="col-12">
                <div class="tw:text-[14px] tw:font-bold header-label">
                  Headers
                </div>
              </div>
            </div>
            <div
              v-for="(header, index) in apiHeaders"
              :key="header.uuid"
              class="row q-col-gutter-xs q-mb-sm"
            >
              <div class="col-5">
                <q-input
                  :data-test="`add-destination-header-${header['key']}-key-input`"
                  v-model="header.key"
                  color="input-border"
                  bg-color="input-bg"
                  stack-label
                  borderless
                  hide-bottom-space
                  :placeholder="t('alert_destinations.api_header')"
                  dense
                  tabindex="0"
                />
              </div>
              <div class="col-5">
                <q-input
                  :data-test="`add-destination-header-${header['key']}-value-input`"
                  v-model="header.value"
                  :placeholder="t('alert_destinations.api_header_value')"
                  color="input-border"
                  bg-color="input-bg"
                  stack-label
                  borderless
                  hide-bottom-space
                  dense
                  tabindex="0"
                />
              </div>
              <div class="col-2 headers-btns">
                <OButton
                  :data-test="`add-destination-header-${header['key']}-delete-btn`"
                  variant="ghost-destructive"
                  size="icon-xs-sq"
                  :title="t('alert_templates.edit')"
                  @click="deleteApiHeader(header)"
                >
                  <template #icon-left>
                    <Trash2 class="tw:size-3.5 tw:shrink-0" />
                  </template>
                </OButton>
                <OButton
                  data-test="add-destination-add-header-btn"
                  v-if="index === apiHeaders.length - 1"
                  variant="ghost"
                  size="icon-xs-sq"
                  :title="t('alert_templates.edit')"
                  @click="addApiHeader()"
                >
                  <template #icon-left>
                    <Plus class="tw:size-3.5 tw:shrink-0" />
                  </template>
                </OButton>
              </div>
            </div>

          <div class="row q-col-gutter-xs q-mt-sm">
            <div class="col-12 tw:inline-flex">
              <q-toggle
                data-test="add-destination-skip-tls-verify-toggle"
                class="o2-toggle-button-xs"
                size="xs"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-toggle-button-xs-dark'
                  : 'o2-toggle-button-xs-light'
              "
              v-model="formData.skip_tls_verify"
              :label="t('alert_destinations.skip_tls_verify')"
            />
            </div>
          </div>

          <!-- Form buttons footer (shown when not using external footer) -->
          <div
            v-if="!hideFooter"
            class="form-footer card-container tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:shrink-0 tw:gap-2"
          >
            <OButton
              data-test="add-destination-cancel-btn"
              variant="outline"
              size="sm-action"
              @click="$emit('cancel')"
            >
              {{ t('alerts.cancel') }}
            </OButton>
            <OButton
              data-test="add-destination-submit-btn"
              variant="primary"
              size="sm-action"
              type="submit"
            >
              {{ t('alerts.save') }}
            </OButton>
          </div>
        </div>

        <!-- Right Column: Connection Notes -->
        <div style="flex: 0 0 42%; overflow-y: auto; min-height: 0; min-width: 0;">
          <div class="side-panel">
            <div
              class="connection-notes-card"
              :class="store.state.theme === 'dark' ? 'connection-notes-dark' : 'connection-notes-light'"
            >
              <div class="notes-header">
                <div class="notes-header-icon">
                  <q-icon name="link" size="18px" />
                </div>
                <div class="notes-header-text">
                  {{ connectionNotes.title }}
                </div>
              </div>
              <div class="notes-steps">
                <div
                  v-for="(stepText, index) in connectionNotes.steps"
                  :key="index"
                  class="step-row"
                >
                  <div class="step-number">
                    <span>{{ index + 1 }}</span>
                  </div>
                  <div class="step-text">{{ stepText }}</div>
                </div>
              </div>
              <div
                v-if="connectionNotes.example"
                class="notes-example"
                :class="store.state.theme === 'dark' ? 'notes-example-dark' : 'notes-example-light'"
              >
                <div class="notes-example-label">Example URL</div>
                <code class="notes-example-value">{{ connectionNotes.example }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-form>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import type { DestinationData, Headers } from "@/ts/interfaces";
import { isValidResourceName, getImageURL, getUUID } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import { Trash2, Plus, ChevronLeft } from "lucide-vue-next";

// Props
const props = defineProps<{
  destination?: DestinationData | null;
  hideFooter?: boolean;
}>();

const emit = defineEmits(["created", "updated", "cancel"]);
const q = useQuasar();
const store = useStore();
const { t } = useI18n();

const isEditMode = computed(() => !!props.destination);

const apiMethods = ["get", "post", "put"];
const outputFormats = [
  { label: "JSON", value: "json" },
  { label: "NDJSON", value: "ndjson" },
  { label: "NestedEvent", value: "nestedevent" },
  { label: "ESBulk", value: "esbulk" },
  { label: "String Separated", value: "stringseparated" },
];
const destinationTypes = [
  {
    label: "OpenObserve",
    value: "openobserve",
    icon: "insights",
    image: getImageURL("images/pipeline/openobserve.svg"),
  },
  {
    label: "Splunk",
    value: "splunk",
    icon: "analytics",
    image: getImageURL("images/pipeline/splunk.webp"),
  },
  {
    label: "Elasticsearch / OpenSearch",
    value: "elasticsearch",
    icon: "search",
    image: getImageURL("images/pipeline/elasticsearch.png"),
  },
  {
    label: "Datadog",
    value: "datadog",
    icon: "pets",
    image: getImageURL("images/pipeline/datadog.png"),
  },
  {
    label: "Dynatrace",
    value: "dynatrace",
    icon: "speed",
    image: getImageURL("images/pipeline/dynatrace.png"),
  },
  {
    label: "Newrelic",
    value: "newrelic",
    icon: "monitor_heart",
    image: getImageURL("images/pipeline/newrelic.png"),
  },
  {
    label: "Custom",
    value: "custom",
    icon: "settings",
    image: getImageURL("images/pipeline/custom.png"),
  },
];

const destinationForm = ref<{ submit: () => void } | null>(null);

const formData: Ref<DestinationData> = ref({
  name: "",
  url: "",
  url_endpoint: "/api/default/default/_json",
  method: "post",
  skip_tls_verify: false,
  template: "",
  headers: {},
  emails: "",
  type: "http",
  output_format: "json",
  destination_type: "openobserve",
  esbulk_index: "",
  separator: "",
});

// OpenObserve specific fields
const openobserveOrg = ref("default");
const openobserveStream = ref("default");

// Helper function to get default headers for each destination type
const getDefaultHeaders = (destinationType: string) => {
  const headers: Array<{ key: string; value: string; uuid: string }> = [];

  switch (destinationType) {
    case "openobserve":
      headers.push({
        key: "Authorization",
        value: "Basic <token>",
        uuid: getUUID(),
      });
      break;
    case "splunk":
      headers.push({
        key: "Authorization",
        value: "Splunk <splunk_token>",
        uuid: getUUID(),
      });
      break;
    case "elasticsearch":
      headers.push({
        key: "Authorization",
        value: "ApiKey <token>",
        uuid: getUUID(),
      });
      headers.push({
        key: "Content-Type",
        value: "application/json",
        uuid: getUUID(),
      });
      break;
    case "datadog":
      headers.push({
        key: "DD-API-KEY",
        value: "<token>",
        uuid: getUUID(),
      });
      headers.push({
        key: "Content-Encoding",
        value: "gzip",
        uuid: getUUID(),
      });
      headers.push({
        key: "Content-Type",
        value: "application/json",
        uuid: getUUID(),
      });
      break;
    case "dynatrace":
      headers.push({
        key: "Authorization",
        value: "Api-Token <token>",
        uuid: getUUID(),
      });
      headers.push({
        key: "Content-Type",
        value: "application/json; charset=utf-8",
        uuid: getUUID(),
      });
      break;
    case "newrelic":
      headers.push({
        key: "Api-Key",
        value: "<token>",
        uuid: getUUID(),
      });
      headers.push({
        key: "Content-Type",
        value: "application/json",
        uuid: getUUID(),
      });
      break;
    case "custom":
    default:
      headers.push({ key: "", value: "", uuid: getUUID() });
      break;
  }

  return headers;
};

const apiHeaders: Ref<
  {
    key: string;
    value: string;
    uuid: string;
  }[]
> = ref(getDefaultHeaders("openobserve"));

// Watch destination_type changes to set method, output_format, headers, and endpoint appropriately
watch(
  () => formData.value.destination_type,
  (newType) => {
    if (!isEditMode.value) {
      if (newType !== "custom") {
        formData.value.method = "post";

        if (newType === "splunk") {
          formData.value.output_format = "nestedevent";
        } else if (newType === "elasticsearch") {
          formData.value.output_format = "esbulk";
          if (!formData.value.esbulk_index) {
            formData.value.esbulk_index = "default";
          }
        } else {
          formData.value.output_format = "json";
        }
      }

      if (newType === "openobserve") {
        formData.value.url_endpoint = `/api/${openobserveOrg.value || "default"}/${openobserveStream.value || "default"}/_json`;
      } else {
        formData.value.url_endpoint = defaultUrlEndpoint.value;
      }

      apiHeaders.value = getDefaultHeaders(newType);
    }
  },
);

const populateFormForEdit = (destination: any) => {
  formData.value.name = destination.name || "";
  formData.value.method = destination.method || "post";
  formData.value.skip_tls_verify = destination.skip_tls_verify || false;
  formData.value.template = destination.template || "";

  if (destination.output_format) {
    if (
      typeof destination.output_format === "object" &&
      destination.output_format.esbulk
    ) {
      formData.value.output_format = "esbulk";
      formData.value.esbulk_index =
        destination.output_format.esbulk.index || "default";
      formData.value.separator = "";
    } else if (
      typeof destination.output_format === "object" &&
      destination.output_format.stringseparated
    ) {
      formData.value.output_format = "stringseparated";
      formData.value.separator =
        destination.output_format.stringseparated.separator || "";
      formData.value.esbulk_index = "";
    } else if (typeof destination.output_format === "string") {
      formData.value.output_format = destination.output_format;
      formData.value.esbulk_index = "";
      formData.value.separator = "";
    }
  } else {
    formData.value.output_format = "json";
    formData.value.esbulk_index = "";
    formData.value.separator = "";
  }

  const destType =
    destination.destination_type_name || destination.destination_type;
  formData.value.destination_type =
    destType && destType.trim() !== "" ? destType : "openobserve";

  const fullUrl = destination.url || "";
  if (fullUrl && formData.value.destination_type !== "custom") {
    try {
      const hasProtocol = fullUrl.includes("://");
      const looksLikeUrl = fullUrl.includes(".") || fullUrl.includes(":");
      const urlToParse = hasProtocol
        ? fullUrl
        : looksLikeUrl
          ? `https://${fullUrl}`
          : fullUrl;

      const url = new URL(urlToParse);
      formData.value.url = url.origin;
      const endpoint = url.pathname + url.search + url.hash;
      formData.value.url_endpoint = endpoint === "/" ? "" : endpoint;
    } catch (error) {
      console.warn(
        "Failed to parse URL, attempting manual split:",
        fullUrl,
        error,
      );
      const firstSlashIndex = fullUrl.indexOf("/");
      if (firstSlashIndex > 0) {
        formData.value.url = fullUrl.substring(0, firstSlashIndex);
        formData.value.url_endpoint = fullUrl.substring(firstSlashIndex);
      } else {
        formData.value.url = fullUrl;
        formData.value.url_endpoint = "";
      }
    }
  } else {
    formData.value.url = fullUrl;
    formData.value.url_endpoint = "";
  }

  if (destination.headers && typeof destination.headers === "object") {
    apiHeaders.value = Object.entries(destination.headers).map(
      ([key, value]) => ({
        key,
        value: value as string,
        uuid: getUUID(),
      }),
    );
  }

  if (destination.metadata && typeof destination.metadata === "object") {
    formData.value.metadata = { ...destination.metadata };
  } else {
    formData.value.metadata = {};
  }

  if (
    formData.value.destination_type === "openobserve" &&
    formData.value.url_endpoint
  ) {
    const match = formData.value.url_endpoint.match(
      /^\/api\/([^/]+)\/([^/]+)\/_json$/,
    );
    if (match) {
      openobserveOrg.value = match[1] || "default";
      openobserveStream.value = match[2] || "default";
    }
  }
};

watch(
  () => props.destination,
  (destination) => {
    if (destination) {
      populateFormForEdit(destination);
    }
  },
  { immediate: true },
);

watch(
  () => formData.value.destination_type,
  (newType) => {
    if (newType !== "custom") {
      formData.value.method = "post";
    }
  },
);

const isValidDestination = computed(() => {
  return !!(formData.value.name && formData.value.url && formData.value.method);
});

const defaultUrlEndpoint = computed(() => {
  switch (formData.value.destination_type) {
    case "openobserve":
      return "/api/{org}/{stream}/_json";
    case "splunk":
      return "/services/collector";
    case "elasticsearch":
      return "/_bulk";
    case "datadog":
      return "/v1/input";
    case "dynatrace":
      return "/api/v2/logs/ingest";
    case "newrelic":
      return "/log/v1";
    case "custom":
      return "";
    default:
      return "";
  }
});

const showMetadataFields = computed(() => {
  return ["splunk", "datadog"].includes(formData.value.destination_type);
});

watch(
  showMetadataFields,
  (needsMetadata) => {
    if (needsMetadata && !formData.value.metadata) {
      formData.value.metadata = {};
    }
  },
  { immediate: true },
);

watch([openobserveOrg, openobserveStream], ([org, stream]) => {
  if (formData.value.destination_type === "openobserve") {
    formData.value.url_endpoint = `/api/${org || "default"}/${stream || "default"}/_json`;
  }
});

// Connection notes for each destination type
const connectionNotes = computed(() => {
  switch (formData.value.destination_type) {
    case "openobserve":
      return {
        title: "OpenObserve Connection Details",
        steps: [
          "Log in to your OpenObserve instance",
          "Copy your base URL (e.g., https://your-instance.openobserve.ai)",
          "The endpoint path is prefilled as: /api/{org}/{stream}/_json",
          "Replace {org} with your organization identifier",
          "Replace {stream} with your stream name",
          "Add authentication header: Authorization: Basic <OpenObserve_Token>",
        ],
        example:
          "Base URL: https://your-instance.openobserve.ai | Endpoint: /api/default/default/_json",
      };
    case "splunk":
      return {
        title: "Splunk HEC Connection Details",
        steps: [
          "Log in to your Splunk instance as an admin",
          "Go to Settings → Data Inputs → HTTP Event Collector",
          "Click 'New Token' to create a new HEC token",
          "Configure the token settings and save",
          "Use your Splunk HEC endpoint URL",
          "Add the HEC token in the Headers section (Authorization: Splunk <token>)",
        ],
        example: "https://your-splunk.com:8088",
      };
    case "elasticsearch":
      return {
        title: "Elasticsearch Connection Details",
        steps: [
          "Locate your Elasticsearch cluster endpoint",
          "Ensure the cluster is accessible from this network",
          "Create an API key or use basic authentication",
          "For Cloud: Get the endpoint from your cloud console",
          "For self-hosted: Use your cluster URL with port (typically 9200)",
          "Add authentication in the Headers section",
        ],
        example: "https://your-cluster.es.io:9200",
      };
    case "datadog":
      return {
        title: "Datadog Connection Details",
        steps: [
          "Log in to your Datadog account",
          "Navigate to Organization Settings → API Keys",
          "Create a new API key or copy an existing one",
          "Use the Datadog intake URL for your region",
          "US: https://http-intake.logs.datadoghq.com",
          "EU: https://http-intake.logs.datadoghq.eu",
          "Add the API key in Headers: DD-API-KEY: <your-key>",
        ],
        example: "https://http-intake.logs.datadoghq.com",
      };
    case "dynatrace":
      return {
        title: "Dynatrace Connection Details",
        steps: [
          "Log in to your Dynatrace environment",
          "Navigate to Settings → Integration → Dynatrace API",
          "Create a new API token with logs.ingest permission",
          "Use your environment URL",
          "Format: https://{your-environment-id}.live.dynatrace.com",
          "Add the token in Headers: Authorization: Api-Token <token>",
        ],
        example: "https://abc12345.live.dynatrace.com",
      };
    case "newrelic":
      return {
        title: "New Relic Connection Details",
        steps: [
          "Log in to your New Relic account",
          "Navigate to API Keys section",
          "Create or copy a License Key (Ingest - License)",
          "US endpoint: https://log-api.newrelic.com",
          "EU endpoint: https://log-api.eu.newrelic.com",
          "Add the license key in Headers: Api-Key: <your-license-key>",
        ],
        example: "https://log-api.newrelic.com",
      };
    case "custom":
      return {
        title: "Custom Endpoint Connection",
        steps: [
          "Enter your custom endpoint URL",
          "Ensure the endpoint accepts HTTP/HTTPS requests",
          "Select the appropriate HTTP method (GET, POST, PUT)",
          "Configure any required headers for authentication",
          "Choose the output format (JSON or NDJSON)",
          "Test the connection to verify it works",
        ],
        example: "https://your-custom-endpoint.com/logs",
      };
    default:
      return {
        title: "Connection Details",
        steps: ["Select a destination type to see specific instructions"],
        example: "",
      };
  }
});

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

  const fullUrl = formData.value.url + (formData.value.url_endpoint || "");

  let outputFormat: any = formData.value.output_format;
  if (formData.value.output_format === "esbulk") {
    outputFormat = {
      esbulk: {
        index: formData.value.esbulk_index,
      },
    };
  } else if (outputFormat === "stringseparated" && formData.value.separator) {
    outputFormat = {
      stringseparated: {
        separator: formData.value.separator,
      },
    };
  } else {
    outputFormat = formData.value.output_format;
  }

  const payload: any = {
    url: fullUrl,
    method: formData.value.method,
    skip_tls_verify: formData.value.skip_tls_verify,
    template: formData.value.template,
    headers: headers,
    name: formData.value.name,
    type: "http",
    output_format: outputFormat,
    destination_type_name: formData.value.destination_type,
  };

  if (
    formData.value.metadata &&
    Object.keys(formData.value.metadata).length > 0
  ) {
    payload.metadata = formData.value.metadata;
  }

  if (isEditMode.value) {
    destinationService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: formData.value.name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        emit("updated", formData.value.name);
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
  } else {
    destinationService
      .create({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: formData.value.name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        emit("created", formData.value.name);
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
  }
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

const resetForm = () => {
  const defaultDestinationType = "openobserve";
  formData.value = {
    name: "",
    url: "",
    url_endpoint: "",
    method: "post",
    skip_tls_verify: false,
    template: "",
    headers: {},
    emails: "",
    type: "http",
    output_format: "json",
    destination_type: defaultDestinationType,
    esbulk_index: "",
    separator: "",
  };
  openobserveOrg.value = "default";
  openobserveStream.value = "default";
  apiHeaders.value = getDefaultHeaders(defaultDestinationType);
};

const submitForm = () => {
  destinationForm.value?.submit();
};

defineExpose({
  getUUID,
  createDestination,
  submitForm,
  addApiHeader,
  deleteApiHeader,
  resetForm,
  formData,
  apiHeaders,
  isValidDestination,
  connectionNotes,
  populateFormForEdit,
  openobserveOrg,
  openobserveStream,
});
</script>

<style lang="scss" scoped>
// Option image in select dropdown
.option-image {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

// Side panel sticky wrapper
.side-panel {
  position: sticky;
  top: 0;
}

// Enhanced input fields
.showLabelOnTop {
  :deep(.q-field__prepend) {
    padding-right: 8px;
  }
}

.headers-btns {
  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
}

.header-label {
  color: var(--o2-input-label-text-color);
}

// Connection Notes Card
.connection-notes-card {
  border-radius: 14px;
  padding: 28px;
  font-size: 13px;
  line-height: 1.6;
  position: relative;
  overflow: hidden;

  &.connection-notes-light {
    background: linear-gradient(135deg, #fafbff 0%, #f1f5f9 100%);
    border: 1px solid #e8ecf4;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  &.connection-notes-dark {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border: 1px solid #334155;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
}

.notes-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.notes-header-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .connection-notes-light & {
    background: linear-gradient(135deg, #5960f5 0%, #7c3aed 100%);
    color: #fff;
    box-shadow: 0 4px 12px rgba(89, 96, 245, 0.25);
  }

  .connection-notes-dark & {
    background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
    color: #fff;
    box-shadow: 0 4px 12px rgba(129, 140, 248, 0.2);
  }
}

.notes-header-text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.notes-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.step-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  transition: background 0.15s ease;

  .connection-notes-light & {
    background: rgba(255, 255, 255, 0.6);

    &:hover {
      background: rgba(255, 255, 255, 0.9);
    }
  }

  .connection-notes-dark & {
    background: rgba(255, 255, 255, 0.03);

    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }
  }
}

.step-number {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;

  .connection-notes-light & {
    background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
    color: #5960f5;
  }

  .connection-notes-dark & {
    background: rgba(129, 140, 248, 0.15);
    color: #a5b4fc;
  }
}

.step-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.6;
  color: inherit;
  padding-top: 2px;
}

.notes-example {
  border-radius: 10px;
  overflow: hidden;

  &.notes-example-light {
    background: #fff;
    border: 1px solid #e8ecf4;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  &.notes-example-dark {
    background: #0f172a;
    border: 1px solid #334155;
  }
}

.notes-example-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 12px 16px 4px;
  color: #94a3b8;
}

.notes-example-value {
  display: block;
  padding: 4px 16px 14px;
  font-family: "SF Mono", "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 12.5px;
  color: #5960f5;
  word-break: break-all;
  background: transparent;
  line-height: 1.7;
}
</style>

<style lang="scss">
.pipeline-add-remote-destination-form {
  .q-select__dropdown-icon {
    font-size: 20px;
  }

  // Add spacing between dropdown options
  .dest-option-item {
    padding-top: 16px;
    padding-bottom: 16px;
  }
}

.create-destination-form {
  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0.275rem 0 0 !important;
  }

  .q-field--labeled.showLabelOnTop {
    padding-top: 24px;
  }
}
</style>
