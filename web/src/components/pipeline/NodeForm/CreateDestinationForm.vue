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
  <div class="create-destination-form">
    <OForm
      ref="formRef"
      :schema="destinationSchema"
      :default-values="formDefaultValues"
      @submit="createDestination"
      class="tw:w-full pipeline-add-remote-destination-form"
      v-slot="{ isSubmitting }"
    >
      <!-- Stepper for Create New Destination.
           Capped at 50vw (not fixed) so it reads as a readable column on the
           full-width page editor, yet shrinks to fill narrower containers like
           the External Destination drawer without overflowing/clipping. The
           footer below stays full-width so its top border lines up with the
           full-width page header (matching the other destination forms). -->
      <div class="tw:w-full tw:max-w-[50vw]">
      <OStepper
        v-model="step"
        ref="stepper"
        animated
      >
        <!-- Step 1: Choose Destination Type -->
        <OStep
          :name="1"
          title="Choose Type"
          icon="edit"
          :done="step > 1"
          :navigable="step > 1"
        >
          <div class="tw:text-sm tw:font-medium tw:mb-3" style="font-weight: 500">
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
              <OIcon
                v-else
                :name="destType.icon"
                size="lg"
                class="card-icon"
              />
              <div class="card-label">{{ destType.label }}</div>
              <div
                v-if="formData.destination_type === destType.value"
                class="check-icon"
              >
                <!-- eslint-disable-next-line vue/max-attributes-per-line -->
                <OIcon name="check" size="xs" />
              </div>
            </div>
          </div>
        </OStep>

        <!-- Step 2: Connection Details -->
        <OStep
          :name="2"
          title="Connection"
          icon="compare-arrows"
          :done="step > 2"
          :navigable="step > 2"
        >
          <div class="tw:text-sm tw:font-medium tw:mb-4" style="font-weight: 500">
            Connection Details
          </div>

          <div class="tw:flex tw:flex-col tw:gap-4">
            <OFormInput
              data-test="add-destination-name-input"
              name="name"
              :label="t('alerts.name')"
              required
              tabindex="0"
            />

            <OFormInput
              data-test="add-destination-url-input"
              name="url"
              :label="t('alert_destinations.url')"
              required
              help-text="Base URL without trailing slash (e.g., https://your-domain.com)"
              tabindex="0"
            />

            <!-- OpenObserve Organization and Stream fields -->
            <div
              v-if="formData.destination_type === 'openobserve'"
              class="tw:flex tw:gap-4"
            >
              <div class="tw:w-1/2">
                <OFormInput
                  data-test="add-destination-openobserve-org-input"
                  v-model="openobserveOrg"
                  name="org"
                  :label="'Organization'"
                  required
                  :placeholder="'e.g., default'"
                  help-text="OpenObserve organization identifier"
                  tabindex="0"
                />
              </div>
              <div class="tw:w-1/2">
                <OFormInput
                  data-test="add-destination-openobserve-stream-input"
                  v-model="openobserveStream"
                  name="stream"
                  :label="'Stream Name'"
                  required
                  :placeholder="'e.g., default'"
                  help-text="OpenObserve stream name"
                  tabindex="0"
                />
              </div>
            </div>

            <OFormInput
              data-test="add-destination-url-endpoint-input"
              v-model="formData.url_endpoint"
              name="url_endpoint"
              label="Endpoint Path"
              :required="formData.destination_type !== 'custom'"
              :disabled="formData.destination_type !== 'custom'"
              help-text="Path will be appended to base URL (must start with /)"
              tabindex="0"
            />
            <!-- Method field - only shown for Custom destination type -->
            <OFormSelect
              v-if="formData.destination_type === 'custom'"
              data-test="add-destination-method-select"
              v-model="formData.method"
              name="method"
              :label="t('alert_destinations.method')"
              required
              :options="apiMethods"
              tabindex="0"
            />

            <!-- Output Format field - disabled for all except Custom -->
            <OFormSelect
              data-test="add-destination-output-format-select"
              v-model="formData.output_format"
              name="output_format"
              :label="t('alert_destinations.output_format')"
              required
              :options="outputFormats"
              labelKey="label"
              valueKey="value"
              :disabled="formData.destination_type !== 'custom'"
              tabindex="0"
            />

            <!-- ESBulk Index Name field - only shown when output format is esbulk -->
            <OFormInput
              v-if="formData.output_format === 'esbulk'"
              data-test="add-destination-esbulk-index-input"
              v-model="formData.esbulk_index"
              name="esbulk_index"
              :label="'ESBulk Index Name'"
              required
              :placeholder="'Enter index name (e.g., logs, events)'"
              help-text="Index name where data will be written in Elasticsearch"
              tabindex="0"
            />

            <!-- StringSeparated Separator field - only shown when output format is stringseparated -->
            <OFormInput
              v-if="formData.output_format === 'stringseparated'"
              data-test="add-destination-separator-input"
              v-model="formData.separator"
              name="separator"
              :label="t('alert_destinations.separator')"
              required
              :placeholder="t('alert_destinations.separator_placeholder')"
              :help-text="t('alert_destinations.separator_hint')"
              tabindex="0"
            />
          </div>

          <!-- Destination-specific Metadata Section -->
          <div v-if="showMetadataFields" class="tw:flex tw:flex-col tw:gap-4 tw:mt-4">
            <div class="tw:w-full tw:text-[14px] tw:font-bold header-label">
              Metadata Configuration
            </div>

            <!-- Splunk Metadata Fields -->
            <template v-if="formData.destination_type === 'splunk'">
              <OFormInput
                data-test="add-destination-metadata-source-input"
                name="metadata.source"
                :label="'Source'"
                :placeholder="'Enter source (e.g., http:my_source)'"
                help-text="Splunk source field for event metadata"
                tabindex="0"
              />

              <OFormInput
                data-test="add-destination-metadata-sourcetype-input"
                name="metadata.sourcetype"
                :label="'Source Type'"
                :placeholder="'Enter source type (e.g., _json)'"
                help-text="Splunk sourcetype field for event metadata"
                tabindex="0"
              />

              <OFormInput
                data-test="add-destination-metadata-hostname-input"
                name="metadata.hostname"
                :label="'Hostname'"
                :placeholder="'Enter hostname (e.g., server01)'"
                help-text="Splunk host field for event metadata"
                tabindex="0"
              />
            </template>

            <!-- Datadog Metadata Fields -->
            <template v-if="formData.destination_type === 'datadog'">
              <OFormInput
                data-test="add-destination-metadata-ddsource-input"
                name="metadata.ddsource"
                :label="'DD Source'"
                required
                :placeholder="'Enter source (e.g., nginx, java)'"
                help-text="Source attribute for Datadog logs"
                tabindex="0"
              />

              <OFormInput
                data-test="add-destination-metadata-ddtags-input"
                name="metadata.ddtags"
                :label="'DD Tags'"
                required
                :placeholder="'Enter tags (e.g., env:prod,version:1.0)'"
                help-text="Comma-separated tags for Datadog logs"
                tabindex="0"
              />

              <OFormInput
                data-test="add-destination-metadata-service-input"
                name="metadata.service"
                :label="'Service'"
                :placeholder="'Enter service name (e.g., api-gateway)'"
                help-text="Service name for Datadog logs"
                tabindex="0"
              />

              <OFormInput
                data-test="add-destination-metadata-hostname-input"
                name="metadata.hostname"
                :label="'Hostname'"
                :placeholder="'Enter hostname (e.g., server01)'"
                help-text="Hostname for Datadog logs"
                tabindex="0"
              />
            </template>

          </div>

          <div class="tw:flex tw:flex-col tw:gap-1 tw:mt-4">
            <div class="o-input-label tw:leading-tight tw:flex tw:items-center">
              Headers
            </div>
            <div class="tw:flex tw:flex-col tw:gap-2">
            <div
              v-for="(header, index) in apiHeaders"
              :key="index"
              class="tw:flex tw:gap-1"
            >
              <div class="tw:w-5/12">
                <OFormInput
                  :data-test="`add-destination-header-${header['key']}-key-input`"
                  :name="`headers[${index}].key`"
                  :placeholder="t('alert_destinations.api_header')"
                  tabindex="0"
                />
              </div>
              <div class="tw:w-5/12">
                <OFormInput
                  :data-test="`add-destination-header-${header['key']}-value-input`"
                  :name="`headers[${index}].value`"
                  :placeholder="t('alert_destinations.api_header_value')"
                  tabindex="0"
                />
              </div>
              <div class="tw:w-1/6 headers-btns">
                <OButton
                  :data-test="`add-destination-header-${header['key']}-delete-btn`"
                  variant="ghost-destructive"
                  size="icon-xs-sq"
                  :title="t('alert_templates.edit')"
                  @click="deleteApiHeader(index)"
                  icon-left="delete"
                />
                <OButton
                  data-test="add-destination-add-header-btn"
                  v-if="index === apiHeaders.length - 1"
                  variant="ghost"
                  size="icon-xs-sq"
                  :title="t('alert_templates.edit')"
                  @click="addApiHeader()"
                  icon-left="add"
                />
              </div>
            </div>
            </div>
          </div>

          <div class="tw:w-full tw:mt-3 tw:inline-flex">
            <OFormSwitch
              data-test="add-destination-skip-tls-verify-toggle"
              name="skip_tls_verify"
              :label="t('alert_destinations.skip_tls_verify')"
            />
          </div>

          <!-- Connection Notes Card -->
          <OCard
            class="connection-notes-card tw:mb-6 tw:mt-4 tw:!bg-[var(--color-banner-info-bg)]"
          >
            <OCardSection role="body">
              <div class="tw:flex tw:items-center tw:mb-2">
                <OIcon
                  name="info"
                  size="md"
                  class="tw:mr-2"
                />
                <div class="tw:text-sm tw:font-medium text-weight-medium">
                  {{ connectionNotes.title }}
                </div>
              </div>
              <div class="tw:text-sm">
                <ol class="connection-steps tw:pl-3 tw:mb-0">
                  <li
                    v-for="(stepText, index) in connectionNotes.steps"
                    :key="index"
                    class="tw:mb-1"
                  >
                    {{ stepText }}
                  </li>
                </ol>
                <div
                  v-if="connectionNotes.example"
                  class="tw:mt-2 tw:p-2 example-url"
                  :class="
                    store.state.theme === 'dark' ? 'tw:bg-gray-600' : 'tw:bg-white'
                  "
                >
                  <strong>Example:</strong>
                  <code class="tw:ml-1">{{ connectionNotes.example }}</code>
                </div>
              </div>
            </OCardSection>
          </OCard>
        </OStep>
      </OStepper>
      </div>

      <!-- Form buttons -->
      <div class="tw:flex tw:justify-start tw:mb-3 tw:pt-4 tw:border-t tw:border-border-default">
        <div v-if="step === 1" class="tw:flex tw:gap-2">
          <OButton
            data-test="step1-cancel-btn"
            variant="outline"
            size="sm-action"
            @click="$emit('cancel')"
          >
            {{ t('alerts.cancel') }}
          </OButton>
          <OButton
            data-test="step1-continue-btn"
            variant="primary"
            size="sm-action"
            :disabled="!canProceedStep1"
            @click="nextStep"
          >
            Continue
          </OButton>
        </div>
        <div v-if="step > 1" class="tw:flex tw:gap-2">
          <OButton
            data-test="step3-back-btn"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            @click="prevStep"
          >
            Back
          </OButton>
          <OButton
            data-test="add-destination-cancel-btn"
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            @click="$emit('cancel')"
          >
            {{ t('alerts.cancel') }}
          </OButton>
          <OButton
            data-test="add-destination-submit-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
          >
            {{ t('alerts.save') }}
          </OButton>
        </div>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import type { DestinationData, Headers } from "@/ts/interfaces";
import { isValidResourceName, getImageURL, getUUID } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeDestinationSchema,
  type DestinationForm,
} from "./CreateDestinationForm.schema";

// Props
const props = defineProps<{
  destination?: DestinationData | null;
}>();

const emit = defineEmits(["created", "updated", "cancel"]);
const store = useStore();
const { t } = useI18n();

// OForm instance ref — used for the destination_type bridge (setFieldValue) and
// to read the form-owned `name`/`url` values reactively (form.useStore).
// Typed `any` because OForm is generic (its InstanceType isn't constructable).
const formRef = ref<any>(null);

// Co-located Zod schema (factory keeps the required message i18n-driven).
// Named after the form per the playbook house style.
const destinationSchema = makeDestinationSchema(t);

const isEditMode = computed(() => !!props.destination);

const apiMethods = [
  { label: "GET", value: "get" },
  { label: "POST", value: "post" },
  { label: "PUT", value: "put" },
];
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
    icon: "monitor-heart",
    image: getImageURL("images/pipeline/newrelic.png"),
  },
  {
    label: "Custom",
    value: "custom",
    icon: "settings",
    image: getImageURL("images/pipeline/custom.png"),
  },
];

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
  separator: "",
});

// OpenObserve specific fields
const openobserveOrg = ref("default");
const openobserveStream = ref("default");

// A single Headers row. Matches the schema's `headerRowSchema` ({ key, value }).
// No `uuid` — the dynamic array-field keys rows by index and add/remove operate
// on the form's `headers` array by index (playbook §2).
type HeaderRow = { key: string; value: string };

// Helper function to get default headers for each destination type
const getDefaultHeaders = (destinationType: string): HeaderRow[] => {
  const headers: HeaderRow[] = [];

  switch (destinationType) {
    case "openobserve":
      headers.push({ key: "Authorization", value: "Basic <token>" });
      break;
    case "splunk":
      headers.push({ key: "Authorization", value: "Splunk <splunk_token>" });
      break;
    case "elasticsearch":
      headers.push({ key: "Authorization", value: "ApiKey <token>" });
      headers.push({ key: "Content-Type", value: "application/json" });
      break;
    case "datadog":
      headers.push({ key: "DD-API-KEY", value: "<token>" });
      headers.push({ key: "Content-Encoding", value: "gzip" });
      headers.push({ key: "Content-Type", value: "application/json" });
      break;
    case "dynatrace":
      headers.push({ key: "Authorization", value: "Api-Token <token>" });
      headers.push({
        key: "Content-Type",
        value: "application/json; charset=utf-8",
      });
      break;
    case "newrelic":
      headers.push({ key: "Api-Key", value: "<token>" });
      headers.push({ key: "Content-Type", value: "application/json" });
      break;
    case "custom":
    default:
      headers.push({ key: "", value: "" });
      break;
  }

  return headers;
};

// Headers are a FORM-OWNED dynamic array-field (`headers[i].key/.value`). The
// form is the single source of truth; this local mirror is kept in sync from the
// form's store (subscribed on mount) so the template v-for + the exposed
// `apiHeaders` stay reactive across add/remove (a bare `form.state.values`
// read in a computed would NOT re-render — playbook §2 gotcha).
//
// `initialHeaders` SEEDS `:default-values` (computed before the form mounts):
// default headers for the default type, or the prefilled headers in edit mode.
const initialHeaders = ref<HeaderRow[]>(getDefaultHeaders("openobserve"));
const apiHeaders = ref<HeaderRow[]>(initialHeaders.value.slice());

// Write the form's `headers` array. Before the form mounts (setup-time edit
// prefill / immediate watches) there is no form yet → seed `initialHeaders`
// instead so the value flows in via `:default-values`. After mount, set it on
// the form (the single source of truth) and the store subscription mirrors it
// back into `apiHeaders`.
const setHeaders = (rows: HeaderRow[]) => {
  const next = rows.map((h) => ({ key: h.key, value: h.value }));
  if (formRef.value?.form) {
    formRef.value.form.setFieldValue("headers", next, { dontUpdateMeta: true });
  } else {
    initialHeaders.value = next;
    apiHeaders.value = next.slice();
  }
};

// Metadata (Splunk source/sourcetype/hostname, Datadog
// service/hostname/ddsource/ddtags) is FORM-OWNED via nested `metadata.*`
// OFormInput fields. `initialMetadata` SEEDS `:default-values`; `setMetadata`
// writes the whole object onto the form after mount (edit prefill), or seeds it
// before mount.
type MetadataValue = DestinationForm["metadata"];
const initialMetadata = ref<MetadataValue>({});
const setMetadata = (meta: MetadataValue) => {
  const next = { ...(meta ?? {}) };
  if (formRef.value?.form) {
    formRef.value.form.setFieldValue("metadata", next, { dontUpdateMeta: true });
  } else {
    initialMetadata.value = next;
  }
};

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

      // Set default headers for the destination type (form-owned).
      setHeaders(getDefaultHeaders(newType ?? "openobserve"));
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

  // Populate headers (form-owned dynamic array-field).
  if (destination.headers && typeof destination.headers === "object") {
    setHeaders(
      Object.entries(destination.headers).map(([key, value]) => ({
        key,
        value: value as string,
      })),
    );
  }

  // Populate metadata object (form-owned). `formData.value.metadata` is kept
  // so the rest of the component (showMetadataFields etc.) keeps working; the
  // form's `metadata` is seeded via setMetadata so the OFormInput fields prefill.
  if (destination.metadata && typeof destination.metadata === "object") {
    formData.value.metadata = { ...destination.metadata };
    setMetadata({ ...destination.metadata });
  } else {
    formData.value.metadata = {};
    setMetadata({});
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

// Snapshot of all field values for OForm defaultValues.
// Defined AFTER the immediate watch above so that edit-mode values
// (set synchronously by populateFormForEdit) are captured correctly.
//
// `name`/`url`/`skip_tls_verify`/`headers`/`metadata.*` are form-owned: the form
// is the single source of truth at submit time, and this snapshot only SEEDS
// them (blank/defaults for create, prefilled for edit). The remaining keys
// mirror entangled `formData`/`openobserveOrg` values that stay component-owned
// (sanctioned exception) — they are seeded here so the schema's superRefine can
// validate them, and re-synced into the form on change by the bridge watches.
const formDefaultValues: DestinationForm = {
  name: formData.value.name,
  url: formData.value.url,
  skip_tls_verify: formData.value.skip_tls_verify ?? false,
  headers: initialHeaders.value.map((h) => ({ key: h.key, value: h.value })),
  metadata: { ...(initialMetadata.value ?? {}) },
  destination_type: formData.value.destination_type,
  url_endpoint: formData.value.url_endpoint ?? "",
  method: formData.value.method ?? "post",
  output_format: formData.value.output_format ?? "json",
  esbulk_index: formData.value.esbulk_index ?? "",
  separator: formData.value.separator ?? "",
  org: openobserveOrg.value,
  stream: openobserveStream.value,
};

// ── Bridge: keep the form's copy of the component-owned fields in sync ────────
// `destination_type` is a custom card grid (not an <input>), so it can't be a
// real OForm field — bridge it in via setFieldValue so superRefine can branch on
// it. This watch→setFieldValue is the documented sanctioned exception. The
// remaining entangled fields ARE rendered as OForm* (their name= is in the
// schema) but stay v-model'd to component state and auto-prefilled, so mirror
// their values in too, ensuring the schema validates the live values on submit.
const syncToForm = (key: keyof DestinationForm, value: unknown) => {
  formRef.value?.form?.setFieldValue(key, value, {
    dontUpdateMeta: true,
  });
};

watch(
  () => formData.value.destination_type,
  (dt) => syncToForm("destination_type", dt),
  { immediate: true },
);
watch(
  () => formData.value.url_endpoint,
  (v) => syncToForm("url_endpoint", v ?? ""),
);
watch(
  () => formData.value.method,
  (v) => syncToForm("method", v ?? "post"),
);
watch(
  () => formData.value.output_format,
  (v) => syncToForm("output_format", v ?? "json"),
);
watch(
  () => formData.value.esbulk_index,
  (v) => syncToForm("esbulk_index", v ?? ""),
);
watch(
  () => formData.value.separator,
  (v) => syncToForm("separator", v ?? ""),
);
watch(openobserveOrg, (v) => syncToForm("org", v ?? ""));
watch(openobserveStream, (v) => syncToForm("stream", v ?? ""));

// ── Mirror the form-owned `headers` array into `apiHeaders` ───────────────────
// Headers live on the form (`headers[i].key/.value`). Subscribe to the form's
// store once it mounts so the template v-for + the exposed `apiHeaders` re-render
// on every add/remove/edit (a plain `form.state.values` read in a computed would
// NOT track array mutations — playbook §2 gotcha). Cleaned up on unmount.
let unsubscribeHeaders: (() => void) | null = null;
const syncApiHeadersFromForm = () => {
  const rows = (formRef.value?.form?.state.values.headers ?? []) as HeaderRow[];
  apiHeaders.value = rows.map((h) => ({ key: h.key, value: h.value }));
};
const stopFormReadyWatch = watch(
  () => formRef.value?.form,
  (form) => {
    if (!form || unsubscribeHeaders) return;
    syncApiHeadersFromForm();
    unsubscribeHeaders = form.store.subscribe(syncApiHeadersFromForm).unsubscribe;
    stopFormReadyWatch();
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => unsubscribeHeaders?.());

// Reactive reads of the form-owned `name`/`url` (single source of truth).
const formName = computed<string>(
  () => formRef.value?.form?.state.values.name ?? "",
);
const formUrl = computed<string>(
  () => formRef.value?.form?.state.values.url ?? "",
);
// Metadata (Splunk/Datadog) is form-owned via the nested `metadata.*` OFormInput
// fields, so read it from the form too — NOT from `formData.metadata`, which the
// migrated inputs no longer write to.
const formMetadata = computed<Record<string, any>>(
  () => formRef.value?.form?.state.values.metadata ?? {},
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

const isValidDestination = computed(() => {
  return !!(formName.value && formUrl.value && formData.value.method);
});

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
  // name/url are form-owned — read them from the form (single source of truth).
  const basicValidation =
    formName.value &&
    isValidResourceName(formName.value) &&
    formUrl.value &&
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
      formMetadata.value?.source?.trim() &&
      formMetadata.value?.sourcetype?.trim() &&
      formMetadata.value?.hostname?.trim()
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
      formMetadata.value?.ddsource?.trim() &&
      formMetadata.value?.ddtags?.trim()
    );
  }

  // Additional validation for StringSeparated format
  if (formData.value.output_format === "stringseparated") {
    return !!(
      formData.value.separator !== null &&
      formData.value.separator !== undefined &&
      formData.value.separator !== ""
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

// @submit handler. OForm only calls this once the whole schema passes (incl. the
// superRefine conditionals), so the schema — not a manual guard — gates the save.
// `value` is the validated payload and the source of truth for the form-owned
// `name`/`url`; the entangled fields still come from `formData`. Returning the
// service promise lets OForm's awaited isSubmitting drive the Save spinner.
//
// `value` is optional so existing tests that invoke createDestination() directly
// (driving formData) keep working — they fall back to the form-owned values.
const createDestination = (value?: DestinationForm) => {
  // The @submit payload is the source of truth for every FORM-OWNED field
  // (name/url/skip_tls_verify/headers/metadata). For direct test calls that pass
  // no `value`, fall back to the form's live state, then component state.
  const formValues = (formRef.value?.form?.state.values ?? {}) as Partial<
    DestinationForm
  >;
  const name = value?.name ?? formName.value ?? formData.value.name ?? "";
  const url = value?.url ?? formUrl.value ?? formData.value.url ?? "";

  if (!(name && url && formData.value.method)) {
    toast({
      variant: "error",
      message: "Please fill required fields",
      timeout: 1500,
    });
    return;
  }
  const dismiss = toast({
    variant: "loading",
    message: "Please wait...",
      timeout: 0,
});
  // Headers from the form (form-owned array-field). Only non-empty rows persist.
  const headerRows = (value?.headers ??
    formValues.headers ??
    apiHeaders.value) as HeaderRow[];
  const headers: Headers = {};
  headerRows.forEach((header) => {
    if (header["key"] && header["value"]) headers[header.key] = header.value;
  });

  // Merge URL + URL endpoint
  const fullUrl = url + (formData.value.url_endpoint || "");

  // Handle output format - for esbulk, format as JSON object with index
  // For stringseparated, format as JSON object with separator
  // For all other formats (json, nestedevent, etc.), keep as string
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
    // Keep output_format as string for json, nestedevent, and other formats
    outputFormat = formData.value.output_format;
  }

  // skip_tls_verify is form-owned — read it from the @submit payload (fall back
  // to the form's live state, then formData, for direct test calls).
  const skipTlsVerify =
    value?.skip_tls_verify ??
    formValues.skip_tls_verify ??
    formData.value.skip_tls_verify ??
    false;

  const payload: any = {
    url: fullUrl,
    method: formData.value.method,
    skip_tls_verify: skipTlsVerify,
    template: formData.value.template,
    headers: headers,
    name: name,
    type: "http",
    output_format: outputFormat,
    destination_type_name: formData.value.destination_type,
  };

  // Add metadata as JSON object (form-owned via nested metadata.* fields). Read
  // it from the @submit payload, falling back to the form's live state, then
  // formData. Only include non-empty values so we don't persist blank keys.
  const metadataSource =
    value?.metadata ?? formValues.metadata ?? formData.value.metadata ?? {};
  const metadata: Record<string, string> = {};
  Object.entries(metadataSource).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") {
      metadata[k] = v as string;
    }
  });
  if (Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  // Check if we're in edit mode. Return the promise so OForm awaits the save
  // (its isSubmitting drives the Save button spinner).
  if (isEditMode.value) {
    // Update existing destination
    return destinationService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        emit("updated", name);
      })
      .catch((err: any) => {
        if (err.response?.status == 403) {
          return;
        }
        dismiss();
        toast({
          variant: "error",
          message: err.response?.data?.error || err.response?.data?.message,
        });
      });
  } else {
    // Create new destination
    return destinationService
      .create({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: name,
        data: payload,
        module: "pipeline",
      })
      .then(() => {
        dismiss();
        emit("created", name);
      })
      .catch((err: any) => {
        if (err.response?.status == 403) {
          return;
        }
        dismiss();
        toast({
          variant: "error",
          message: err.response?.data?.error || err.response?.data?.message,
        });
      });
  }
};

// Add/remove operate on the FORM-OWNED `headers` array (the single source of
// truth) via setHeaders; the store subscription mirrors the result back into
// `apiHeaders` for the template v-for (playbook §2). The template's delete
// button passes the row INDEX.
const addApiHeader = (key: string = "", value: string = "") => {
  const rows = (formRef.value?.form?.state.values.headers ??
    apiHeaders.value) as HeaderRow[];
  setHeaders([
    ...rows.map((h) => ({ key: h.key, value: h.value })),
    { key, value },
  ]);
};

const deleteApiHeader = (index: number) => {
  const rows = (formRef.value?.form?.state.values.headers ??
    apiHeaders.value) as HeaderRow[];
  const next = rows
    .filter((_, i) => i !== index)
    .map((h) => ({ key: h.key, value: h.value }));
  // Always keep at least one (blank) row so the add button stays reachable.
  setHeaders(next.length ? next : [{ key: "", value: "" }]);
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
    separator: "",
  };
  // Reset OpenObserve specific fields
  openobserveOrg.value = "default";
  openobserveStream.value = "default";
  // Clear the form-owned fields (name/url) back to their blank defaults.
  formRef.value?.form?.reset();
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
  // Form-owned (name/url) — exposed so tests can drive/read the real form.
  formRef,
  formName,
  formUrl,
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

    .card-label {
      color: #333333;
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

      .card-label {
        color: #ffffff;
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
    color: var(--o2-text-primary);
  }

  .check-icon {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--o2-positive);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
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
.create-destination-form {
  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0.275rem 0 0 !important;
  }

  .q-field--labeled.showLabelOnTop {
    padding-top: 24px;
  }
}
</style>
