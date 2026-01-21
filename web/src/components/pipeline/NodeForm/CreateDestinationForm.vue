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
  <div class="create-destination-form">
    <q-form
      ref="destinationForm"
      @submit="createDestination"
      class="col-12 pipeline-add-remote-destination-form"
    >
      <!-- Stepper for Create New Destination -->
      <q-stepper
        v-model="step"
        ref="stepper"
        color="primary"
        animated
        flat
        class="modern-stepper"
      >
        <!-- Step 1: Choose Destination Type -->
        <q-step
          :name="1"
          title="Choose Type"
          icon="category"
          :done="step > 1"
          :header-nav="step > 1"
        >
          <div class="text-subtitle2 q-mb-md" style="font-weight: 500">
            Select Destination Type <span class="text-red">*</span>
          </div>
          <div class="destination-type-grid">
            <div
              v-for="destType in destinationTypes"
              :key="destType.value"
              :data-test="`destination-type-card-${destType.value}`"
              class="destination-type-card"
              :class="{
                selected: formData.destination_type === destType.value,
                'dark-mode': store.state.theme === 'dark',
              }"
              @click="formData.destination_type = destType.value"
            >
              <img
                v-if="destType.image"
                :src="destType.image"
                :alt="destType.label"
                class="card-image"
              />
              <q-icon
                v-else
                :name="destType.icon"
                size="28px"
                class="card-icon"
              />
              <div class="card-label">{{ destType.label }}</div>
              <div
                v-if="formData.destination_type === destType.value"
                class="check-icon"
              >
                <!-- eslint-disable-next-line vue/max-attributes-per-line -->
                <q-icon name="check_circle" size="20px" color="positive" />
              </div>
            </div>
          </div>
        </q-step>

        <!-- Step 2: Connection Details -->
        <q-step
          :name="2"
          title="Connection"
          icon="settings_ethernet"
          :done="step > 2"
          :header-nav="step > 2"
        >
          <div class="text-subtitle2 q-mb-lg" style="font-weight: 500">
            Connection Details
          </div>

          <div class="q-gutter-sm">
            <q-input
              data-test="add-destination-name-input"
              v-model="formData.name"
              :label="t('alerts.name') + ' *'"
              class="no-border showLabelOnTop"
              borderless
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

            <q-input
              data-test="add-destination-url-input"
              v-model="formData.url"
              :label="t('alert_destinations.url') + ' *'"
              class="no-border showLabelOnTop"
              borderless
              dense
              flat
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
                <span class="text-caption"
                  >Base URL without trailing slash (e.g.,
                  https://your-domain.com)</span
                >
              </template>
            </q-input>

            <!-- OpenObserve Organization and Stream fields -->
            <div
              v-if="formData.destination_type === 'openobserve'"
              class="row q-col-gutter-xs q-mt-xs q-ml-xs"
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

            <!-- Endpoint Path field - shown for all destination types -->
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
              stack-label
              bottom-slots
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
            <!-- Method field - only shown for Custom destination type -->
            <q-select
              v-if="formData.destination_type === 'custom'"
              data-test="add-destination-method-select"
              v-model="formData.method"
              :label="t('alert_destinations.method') + ' *'"
              :options="apiMethods"
              class="no-border showLabelOnTop"
              borderless
              dense
              flat
              stack-label
              :popup-content-style="{ textTransform: 'uppercase' }"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />

            <!-- Output Format field - disabled for all except Custom -->
            <q-select
              data-test="add-destination-output-format-select"
              v-model="formData.output_format"
              :label="t('alert_destinations.output_format') + ' *'"
              :options="outputFormats"
              class="no-border showLabelOnTop q-mt-sm"
              borderless
              dense
              flat
              stack-label
              emit-value
              map-options
              :rules="[(val: any) => !!val || 'Field is required!']"
              :disable="formData.destination_type !== 'custom'"
              tabindex="0"
            />

            <!-- ESBulk Index Name field - only shown when output format is esbulk -->
            <q-input
              v-if="formData.output_format === 'esbulk'"
              data-test="add-destination-esbulk-index-input"
              v-model="formData.esbulk_index"
              :label="'ESBulk Index Name *'"
              :placeholder="'Enter index name (e.g., logs, events)'"
              class="no-border showLabelOnTop q-mt-sm"
              borderless
              dense
              flat
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

          <!-- Destination-specific Metadata Section -->
          <div v-if="showMetadataFields" class="q-gutter-sm q-mt-md">
            <div class="col-12 tw:text-[14px] tw:font-bold header-label">
              Metadata Configuration
            </div>

            <!-- Splunk Metadata Fields -->
            <template v-if="formData.destination_type === 'splunk'">
              <q-input
                data-test="add-destination-metadata-source-input"
                v-model="formData.metadata!.source"
                :label="'Source'"
                :placeholder="'Enter source (e.g., http:my_source)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
                stack-label
                tabindex="0"
              >
                <template v-slot:hint>
                  Splunk source field for event metadata
                </template>
              </q-input>

              <q-input
                data-test="add-destination-metadata-sourcetype-input"
                v-model="formData.metadata!.sourcetype"
                :label="'Source Type'"
                :placeholder="'Enter source type (e.g., _json)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
                stack-label
                tabindex="0"
              >
                <template v-slot:hint>
                  Splunk sourcetype field for event metadata
                </template>
              </q-input>

              <q-input
                data-test="add-destination-metadata-hostname-input"
                v-model="formData.metadata!.hostname"
                :label="'Hostname'"
                :placeholder="'Enter hostname (e.g., server01)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
                stack-label
                tabindex="0"
              >
                <template v-slot:hint>
                  Splunk host field for event metadata
                </template>
              </q-input>
            </template>

            <!-- Datadog Metadata Fields -->
            <template v-if="formData.destination_type === 'datadog'">
              <q-input
                data-test="add-destination-metadata-ddsource-input"
                v-model="formData.metadata!.ddsource"
                :label="'DD Source *'"
                :placeholder="'Enter source (e.g., nginx, java)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
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

              <q-input
                data-test="add-destination-metadata-ddtags-input"
                v-model="formData.metadata!.ddtags"
                :label="'DD Tags *'"
                :placeholder="'Enter tags (e.g., env:prod,version:1.0)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
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

              <q-input
                data-test="add-destination-metadata-service-input"
                v-model="formData.metadata!.service"
                :label="'Service'"
                :placeholder="'Enter service name (e.g., api-gateway)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
                stack-label
                tabindex="0"
              >
                <template v-slot:hint> Service name for Datadog logs </template>
              </q-input>

              <q-input
                data-test="add-destination-metadata-hostname-input"
                v-model="formData.metadata!.hostname"
                :label="'Hostname'"
                :placeholder="'Enter hostname (e.g., server01)'"
                class="no-border showLabelOnTop"
                borderless
                dense
                flat
                stack-label
                tabindex="0"
              >
                <template v-slot:hint> Hostname for Datadog logs </template>
              </q-input>
            </template>
          </div>

          <div class="q-gutter-sm">
            <div class="col-12 tw:text-[14px] tw:font-bold header-label">
              Headers
            </div>
            <div
              v-for="(header, index) in apiHeaders"
              :key="header.uuid"
              class="row q-col-gutter-xs q-ml-xs"
            >
              <div class="col-5">
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
              <div class="col-5">
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
                  tabindex="0"
                />
              </div>
              <div class="col-2 headers-btns">
                <q-btn
                  :data-test="`add-destination-header-${header['key']}-delete-btn`"
                  icon="delete"
                  class="q-ml-xs iconHoverBtn el-border el-border-radius"
                  :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                  padding="sm"
                  dense
                  flat
                  :title="t('alert_templates.edit')"
                  @click="deleteApiHeader(header)"
                />
                <q-btn
                  data-test="add-destination-add-header-btn"
                  v-if="index === apiHeaders.length - 1"
                  icon="add"
                  :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
                  class="q-ml-xs iconHoverBtn el-border el-border-radius"
                  padding="sm"
                  size="sm"
                  dense
                  flat
                  :title="t('alert_templates.edit')"
                  @click="addApiHeader()"
                />
              </div>
            </div>
          </div>

          <div class="col-12 q-mt-md tw:inline-flex">
            <q-toggle
              data-test="add-destination-skip-tls-verify-toggle"
              class="o2-toggle-button-xs q-mt-sm tw:inline-flex"
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

          <!-- Connection Notes Card -->
          <q-card
            flat
            bordered
            class="connection-notes-card q-mb-lg q-mt-md"
            :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-blue-1'"
          >
            <q-card-section>
              <div class="row items-center q-mb-sm">
                <q-icon
                  name="info"
                  color="primary"
                  size="20px"
                  class="q-mr-sm"
                />
                <div class="text-subtitle2 text-weight-medium">
                  {{ connectionNotes.title }}
                </div>
              </div>
              <div class="text-body2">
                <ol class="connection-steps q-pl-md q-mb-none">
                  <li
                    v-for="(stepText, index) in connectionNotes.steps"
                    :key="index"
                    class="q-mb-xs"
                  >
                    {{ stepText }}
                  </li>
                </ol>
                <div
                  v-if="connectionNotes.example"
                  class="q-mt-sm q-pa-sm example-url"
                  :class="
                    store.state.theme === 'dark' ? 'bg-grey-8' : 'bg-white'
                  "
                >
                  <strong>Example:</strong>
                  <code class="q-ml-xs">{{ connectionNotes.example }}</code>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </q-step>
      </q-stepper>

      <!-- Form buttons -->
      <div class="flex justify-start q-mb-md">
        <div v-if="step === 1">
          <q-btn
            data-test="step1-cancel-btn"
            class="o2-secondary-button tw:h-[36px] q-mr-sm"
            :label="t('alerts.cancel')"
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            no-caps
            @click="$emit('cancel')"
          />
          <q-btn
            data-test="step1-continue-btn"
            @click="nextStep"
            :disable="!canProceedStep1"
            label="Continue"
            class="no-border o2-primary-button tw:h-[36px]"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            flat
            no-caps
          />
        </div>
        <div v-if="step > 1">
          <q-btn
            data-test="step3-back-btn"
            @click="prevStep"
            label="Back"
            class="o2-secondary-button tw:h-[36px] q-mr-sm"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            flat
            no-caps
          />
          <q-btn
            data-test="add-destination-cancel-btn"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            no-caps
            @click="$emit('cancel')"
          />
          <q-btn
            data-test="add-destination-submit-btn"
            :label="t('alerts.save')"
            class="no-border q-ml-sm o2-primary-button tw:h-[36px]"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            flat
            type="submit"
            no-caps
          />
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

// Props
const props = defineProps<{
  destination?: DestinationData | null;
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

const destinationForm = ref(null);
const step = ref(1);

const formData: Ref<DestinationData> = ref({
  name: "",
  url: "",
  url_endpoint: "/api/default/default/_json", // Default endpoint for OpenObserve
  method: "post",
  skip_tls_verify: false,
  template: "",
  headers: {},
  emails: "",
  type: "http",
  output_format: "json",
  destination_type: "openobserve",
  esbulk_index: "",
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

// Initialize apiHeaders with default headers for OpenObserve (the default destination type)
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
    // Only auto-set values if not in edit mode
    if (!isEditMode.value) {
      if (newType !== "custom") {
        // Set method to POST for all non-custom types
        formData.value.method = "post";

        // Set output_format based on destination type
        if (newType === "splunk") {
          formData.value.output_format = "nestedevent";
        } else if (newType === "elasticsearch") {
          formData.value.output_format = "esbulk";
          // Set default index name if not already set
          if (!formData.value.esbulk_index) {
            formData.value.esbulk_index = "default";
          }
        } else {
          formData.value.output_format = "json";
        }
      }

      // Set endpoint based on destination type
      if (newType === "openobserve") {
        // For OpenObserve, use org and stream values
        formData.value.url_endpoint = `/api/${openobserveOrg.value || "default"}/${openobserveStream.value || "default"}/_json`;
      } else {
        // For other types, use the default endpoint
        formData.value.url_endpoint = defaultUrlEndpoint.value;
      }

      // Set default headers for the destination type
      apiHeaders.value = getDefaultHeaders(newType);
    }
  },
);

// Function to populate form when editing an existing destination
const populateFormForEdit = (destination: any) => {
  formData.value.name = destination.name || "";
  formData.value.method = destination.method || "post";
  formData.value.skip_tls_verify = destination.skip_tls_verify || false;
  formData.value.template = destination.template || "";

  // Handle output_format
  if (destination.output_format) {
    if (
      typeof destination.output_format === "object" &&
      destination.output_format.esbulk
    ) {
      formData.value.output_format = "esbulk";
      formData.value.esbulk_index =
        destination.output_format.esbulk.index || "default";
    } else if (typeof destination.output_format === "string") {
      formData.value.output_format = destination.output_format;
      formData.value.esbulk_index = "";
    }
  } else {
    formData.value.output_format = "json";
    formData.value.esbulk_index = "";
  }

  // Use destination_type_name from backend, fallback to destination_type or default
  const destType =
    destination.destination_type_name || destination.destination_type;
  formData.value.destination_type =
    destType && destType.trim() !== "" ? destType : "openobserve";

  // Split URL into hostname and endpoint for all destination types except custom
  const fullUrl = destination.url || "";
  if (fullUrl && formData.value.destination_type !== "custom") {
    try {
      // Add protocol if missing for URL parsing, but only if it looks like a valid URL
      const hasProtocol = fullUrl.includes("://");
      const looksLikeUrl = fullUrl.includes(".") || fullUrl.includes(":");
      const urlToParse = hasProtocol
        ? fullUrl
        : looksLikeUrl
          ? `https://${fullUrl}`
          : fullUrl;

      const url = new URL(urlToParse);
      // Base URL is protocol + hostname + port (if any) - always include protocol for consistency
      formData.value.url = url.origin;
      // URL endpoint is the path + search + hash
      const endpoint = url.pathname + url.search + url.hash;
      // Only set endpoint if it's not just "/"
      formData.value.url_endpoint = endpoint === "/" ? "" : endpoint;
    } catch (error) {
      // If URL parsing fails, try to split manually
      console.warn(
        "Failed to parse URL, attempting manual split:",
        fullUrl,
        error,
      );
      const firstSlashIndex = fullUrl.indexOf("/");
      if (firstSlashIndex > 0) {
        // Split at first slash
        formData.value.url = fullUrl.substring(0, firstSlashIndex);
        formData.value.url_endpoint = fullUrl.substring(firstSlashIndex);
      } else {
        // No slash found, keep full URL as-is
        formData.value.url = fullUrl;
        formData.value.url_endpoint = "";
      }
    }
  } else {
    // For custom destination or empty URL, don't split
    formData.value.url = fullUrl;
    formData.value.url_endpoint = "";
  }

  // Populate headers
  if (destination.headers && typeof destination.headers === "object") {
    apiHeaders.value = Object.entries(destination.headers).map(
      ([key, value]) => ({
        key,
        value: value as string,
        uuid: getUUID(),
      }),
    );
  }

  // Populate metadata object
  if (destination.metadata && typeof destination.metadata === "object") {
    formData.value.metadata = { ...destination.metadata };
  } else {
    formData.value.metadata = {};
  }

  // Extract OpenObserve org and stream from endpoint if it's OpenObserve
  if (
    formData.value.destination_type === "openobserve" &&
    formData.value.url_endpoint
  ) {
    // Parse endpoint like /api/{org}/{stream}/_json
    const match = formData.value.url_endpoint.match(
      /^\/api\/([^/]+)\/([^/]+)\/_json$/,
    );
    if (match) {
      openobserveOrg.value = match[1] || "default";
      openobserveStream.value = match[2] || "default";
    }
  }

  // Move to step 2 since destination type is already selected
  step.value = 2;
};

// Watch for destination prop changes to populate form in edit mode
watch(
  () => props.destination,
  (destination) => {
    if (destination) {
      populateFormForEdit(destination);
    }
  },
  { immediate: true },
);

// Watch destination_type changes to ensure method is set to "post" for non-custom types
watch(
  () => formData.value.destination_type,
  (newType) => {
    if (newType !== "custom") {
      formData.value.method = "post";
    }
  },
);

const isValidDestination = computed(
  () => formData.value.name && formData.value.url && formData.value.method,
);

// Default URL endpoints for different destination types (shown as hint)
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

// Show metadata fields for specific destination types
const showMetadataFields = computed(() => {
  return ["splunk", "datadog"].includes(formData.value.destination_type);
});

// Watch to ensure metadata is initialized when needed
watch(
  showMetadataFields,
  (needsMetadata) => {
    if (needsMetadata && !formData.value.metadata) {
      formData.value.metadata = {};
    }
  },
  { immediate: true },
);

// Watch OpenObserve org and stream to update endpoint dynamically
watch([openobserveOrg, openobserveStream], ([org, stream]) => {
  if (formData.value.destination_type === "openobserve") {
    formData.value.url_endpoint = `/api/${org || "default"}/${stream || "default"}/_json`;
  }
});

// Step validation
const canProceedStep1 = computed(() => {
  return !!formData.value.destination_type;
});

const canProceedStep2 = computed(() => {
  const basicValidation =
    formData.value.name &&
    isValidResourceName(formData.value.name) &&
    formData.value.url &&
    formData.value.method &&
    formData.value.output_format;

  if (!basicValidation) return false;

  // Validate url_endpoint for non-custom destination types
  if (
    formData.value.destination_type !== "custom" &&
    !formData.value.url_endpoint?.trim()
  ) {
    return false;
  }

  // Validate destination-specific metadata
  if (formData.value.destination_type === "splunk") {
    return !!(
      formData.value.metadata?.source?.trim() &&
      formData.value.metadata?.sourcetype?.trim() &&
      formData.value.metadata?.hostname?.trim()
    );
  }

  if (formData.value.destination_type === "elasticsearch") {
    // Validate esbulk_index is set
    return !!(
      formData.value.output_format === "esbulk" &&
      formData.value.esbulk_index?.trim()
    );
  }

  if (formData.value.destination_type === "datadog") {
    return !!(
      formData.value.metadata?.ddsource?.trim() &&
      formData.value.metadata?.ddtags?.trim()
    );
  }

  return true;
});

// Navigation functions
const nextStep = () => {
  if (step.value === 1 && canProceedStep1.value) {
    step.value = 2;
  }
};

const prevStep = () => {
  if (step.value > 1) {
    step.value--;
  }
};

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

  // Merge URL + URL endpoint for all destination types
  const fullUrl = formData.value.url + (formData.value.url_endpoint || "");

  // Handle output format - for esbulk, format as JSON object with index
  let outputFormat: any = formData.value.output_format;
  if (outputFormat === "esbulk" && formData.value.esbulk_index) {
    outputFormat = {
      esbulk: {
        index: formData.value.esbulk_index,
      },
    };
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

  // Add metadata as JSON object
  if (
    formData.value.metadata &&
    Object.keys(formData.value.metadata).length > 0
  ) {
    payload.metadata = formData.value.metadata;
  }

  // Check if we're in edit mode
  if (isEditMode.value) {
    // Update existing destination
    destinationService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: formData.value.name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        q.notify({
          type: "positive",
          message: `Destination updated successfully.`,
        });
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
    // Create new destination
    destinationService
      .create({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: formData.value.name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        q.notify({
          type: "positive",
          message: `Destination saved successfully.`,
        });
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

// Reset form when needed
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
  };
  // Reset OpenObserve specific fields
  openobserveOrg.value = "default";
  openobserveStream.value = "default";
  // Set default headers for OpenObserve
  apiHeaders.value = getDefaultHeaders(defaultDestinationType);
  step.value = 1;
};

// Expose functions for testing
defineExpose({
  getUUID,
  createDestination,
  addApiHeader,
  deleteApiHeader,
  resetForm,
  formData,
  apiHeaders,
  isValidDestination,
  step,
  nextStep,
  prevStep,
  canProceedStep1,
  canProceedStep2,
  connectionNotes,
  populateFormForEdit,
  openobserveOrg,
  openobserveStream,
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
    border-color: var(--o2-border-color);
    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: var(--o2-border-color);
    background: linear-gradient(135deg, #e3f2fd 0%, #ffffff 100%);
    box-shadow: 0 4px 16px rgba(25, 118, 210, 0.2);

    .card-icon {
      color: var(--o2-border-color);
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

  .card-image {
    width: 48px;
    height: 48px;
    margin-bottom: 8px;
    object-fit: contain;
    transition: all 0.3s ease;
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
    background: var(--o2-primary-btn-bg);
  }

  :deep(.q-stepper__step-inner) {
    padding: 10px 0;
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
</style>

<style lang="scss">
.pipeline-add-remote-destination-form .modern-stepper .q-stepper__tab {
  padding: 5px 5px 15px 5px !important;
  min-height: 35px !important;
}

.create-destination-form {
  .q-stepper {
    background: transparent !important;
  }

  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0.275rem 0 0 !important;
  }

  .q-field--labeled.showLabelOnTop {
    padding-top: 24px;
  }
}
</style>
