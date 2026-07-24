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
      :form="form"
      class="pipeline-add-remote-destination-form w-full"
      v-slot="{ isSubmitting }"
    >
      <!-- Stepper for Create New Destination.
           Capped at 50vw (not fixed) so it reads as a readable column on the
           full-width page editor, yet shrinks to fill narrower containers like
           the External Destination drawer without overflowing/clipping. The
           footer below stays full-width so its top border lines up with the
           full-width page header (matching the other destination forms). -->
      <div class="w-full max-w-[50vw]">
        <OStepper v-model="step" ref="stepper" animated>
          <!-- Step 1: Choose Destination Type -->
          <OStep :name="1" title="Choose Type" icon="edit" :done="step > 1" :navigable="step > 1">
            <div class="mb-3 text-sm font-medium">
              Select Destination Type <span class="text-status-error-text">*</span>
            </div>
            <div class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              <div
                v-for="destType in destinationTypes"
                :key="destType.value"
                :data-test="`destination-type-card-${destType.value}`"
                class="destination-type-card group rounded-default hover:border-card-glass-border relative flex min-h-30 cursor-pointer flex-col items-center justify-center border-2 px-3 py-5 [transition:all_0.3s_ease] hover:-translate-y-0.5 hover:shadow-[0_0.25rem_0.75rem_color-mix(in_srgb,var(--color-status-info-text)_15%,transparent)]"
                :class="
                  destinationType === destType.value
                    ? 'selected border-card-glass-border bg-status-info-bg shadow-[0_0.25rem_1rem_color-mix(in_srgb,var(--color-status-info-text)_20%,transparent)]'
                    : 'border-border-default bg-surface-base'
                "
                @click="form.setFieldValue('destination_type', destType.value)"
              >
                <img
                  v-if="destType.image"
                  :src="destType.image"
                  :alt="destType.label"
                  class="mb-2 h-12 w-12 object-contain [transition:all_0.3s_ease]"
                />
                <OIcon
                  v-else
                  :name="destType.icon"
                  size="lg"
                  class="card-icon text-icon-color group-[.selected]:text-card-glass-border mb-2 [transition:color_0.3s_ease]"
                />
                <div
                  class="card-label text-compact text-text-body group-[.selected]:text-text-body mt-1 text-center leading-[1.3] font-medium"
                >
                  {{ destType.label }}
                </div>
                <div
                  v-if="destinationType === destType.value"
                  class="bg-status-positive text-text-inverse absolute top-1.5 right-1.5 z-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full"
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
            <div class="mb-4 text-sm font-medium">Connection Details</div>

            <div class="flex flex-col gap-4">
              <!-- Name is the destination's identifier — it can't be changed once
                 created, so lock it in edit mode. -->
              <OFormInput
                data-test="add-destination-name-input"
                name="name"
                :label="t('alerts.name')"
                required
                :readonly="isEditMode"
                :disabled="isEditMode"
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
              <div v-if="destinationType === 'openobserve'" class="flex gap-4">
                <div class="w-1/2">
                  <OFormInput
                    data-test="add-destination-openobserve-org-input"
                    name="org"
                    :label="'Organization'"
                    required
                    :placeholder="'e.g., default'"
                    help-text="OpenObserve organization identifier"
                    tabindex="0"
                  />
                </div>
                <div class="w-1/2">
                  <OFormInput
                    data-test="add-destination-openobserve-stream-input"
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
                name="url_endpoint"
                label="Endpoint Path"
                :required="destinationType !== 'custom'"
                :disabled="destinationType !== 'custom'"
                help-text="Path will be appended to base URL (must start with /)"
                tabindex="0"
              />
              <!-- Method field - only shown for Custom destination type -->
              <OFormSelect
                v-if="destinationType === 'custom'"
                data-test="add-destination-method-select"
                name="method"
                :label="t('alert_destinations.method')"
                required
                :options="apiMethods"
                tabindex="0"
              />

              <!-- Output Format field - disabled for all except Custom -->
              <OFormSelect
                data-test="add-destination-output-format-select"
                name="output_format"
                :label="t('alert_destinations.output_format')"
                required
                :options="outputFormats"
                labelKey="label"
                valueKey="value"
                :disabled="destinationType !== 'custom'"
                tabindex="0"
              />

              <!-- ESBulk Index Name field - only shown when output format is esbulk -->
              <OFormInput
                v-if="outputFormat === 'esbulk'"
                data-test="add-destination-esbulk-index-input"
                name="esbulk_index"
                :label="'ESBulk Index Name'"
                required
                :placeholder="'Enter index name (e.g., logs, events)'"
                help-text="Index name where data will be written in Elasticsearch"
                tabindex="0"
              />

              <!-- StringSeparated Separator field - only shown when output format is stringseparated -->
              <OFormInput
                v-if="outputFormat === 'stringseparated'"
                data-test="add-destination-separator-input"
                name="separator"
                :label="t('alert_destinations.separator')"
                required
                :placeholder="t('alert_destinations.separator_placeholder')"
                :help-text="t('alert_destinations.separator_hint')"
                tabindex="0"
              />
            </div>

            <!-- Destination-specific Metadata Section -->
            <div v-if="showMetadataFields" class="mt-4 flex flex-col gap-4">
              <div class="text-input-label w-full text-sm font-bold">Metadata Configuration</div>

              <!-- Splunk Metadata Fields -->
              <template v-if="destinationType === 'splunk'">
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
              <template v-if="destinationType === 'datadog'">
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

            <div class="mt-4 flex flex-col gap-1">
              <div
                class="o-input-label text-compact text-input-label-text flex items-center leading-tight font-medium"
              >
                Headers
              </div>
              <div class="flex flex-col gap-2">
                <div v-for="(header, index) in apiHeaders" :key="index" class="flex gap-1">
                  <div class="w-5/12">
                    <OFormInput
                      :data-test="`add-destination-header-${header['key']}-key-input`"
                      :name="`headers[${index}].key`"
                      :placeholder="t('alert_destinations.api_header')"
                      tabindex="0"
                    />
                  </div>
                  <div class="w-5/12">
                    <OFormInput
                      :data-test="`add-destination-header-${header['key']}-value-input`"
                      :name="`headers[${index}].value`"
                      :placeholder="t('alert_destinations.api_header_value')"
                      tabindex="0"
                    />
                  </div>
                  <div class="headers-btns w-1/6">
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

            <div class="mt-3 inline-flex w-full">
              <OFormSwitch
                data-test="add-destination-skip-tls-verify-toggle"
                name="skip_tls_verify"
                :label="t('alert_destinations.skip_tls_verify')"
              />
            </div>

            <!-- Connection Notes Card -->
            <OCard
              class="connection-notes-card rounded-default border-banner-info-border bg-banner-info-bg! mt-4 mb-6 border"
            >
              <OCardSection role="body">
                <div class="mb-2 flex items-center">
                  <OIcon name="info" size="md" class="mr-2" />
                  <div class="text-sm font-medium">
                    {{ connectionNotes.title }}
                  </div>
                </div>
                <div class="text-sm">
                  <ol class="mb-0 pl-3 leading-[1.8]">
                    <li
                      v-for="(stepText, index) in connectionNotes.steps"
                      :key="index"
                      class="mb-2"
                    >
                      {{ stepText }}
                    </li>
                  </ol>
                  <div
                    v-if="connectionNotes.example"
                    class="rounded-default text-compact bg-surface-base mt-2 p-2"
                  >
                    <strong>Example:</strong>
                    <code class="text-text-link ml-1 bg-transparent p-0 font-mono">{{
                      connectionNotes.example
                    }}</code>
                  </div>
                </div>
              </OCardSection>
            </OCard>
          </OStep>
        </OStepper>
      </div>

      <!-- Form buttons -->
      <div class="border-border-default mb-3 flex justify-start border-t pt-4">
        <div v-if="step === 1" class="flex gap-2">
          <OButton
            data-test="step1-cancel-btn"
            variant="outline"
            size="sm-action"
            @click="$emit('cancel')"
          >
            {{ t("alerts.cancel") }}
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
        <div v-if="step > 1" class="flex gap-2">
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
            {{ t("alerts.cancel") }}
          </OButton>
          <OButton
            data-test="add-destination-submit-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
          >
            {{ t("alerts.save") }}
          </OButton>
        </div>
      </div>
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
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
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { makeDestinationSchema, type DestinationForm } from "./CreateDestinationForm.schema";

// Props
const props = defineProps<{
  destination?: DestinationData | null;
}>();

const emit = defineEmits(["created", "updated", "cancel"]);
const store = useStore();
const { t } = useI18n();

// Co-located Zod schema (factory keeps the required message i18n-driven).
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

// A single Headers row. Matches the schema's `headerRowSchema` ({ key, value }).
// No `uuid` — the dynamic array-field keys rows by index and add/remove operate
// on the form's `headers` array by index.
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

// Default URL endpoints for different destination types (used as the seed value
// when a non-OpenObserve type is selected, and shown as a hint).
const endpointForType = (type: string): string => {
  switch (type) {
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
};

// ── OWNER pattern: single source of truth = the TanStack form ─────────────────
// This component OWNS <OForm> and drives all conditional rendering (the
// destination-type card grid, the per-type/per-output_format v-ifs) off the
// form's own state. It creates the form here with useOForm, reads it reactively
// via form.useStore, writes it via form.setFieldValue — NO `formData` mirror,
// NO sync watches, NO store.subscribe. The form is handed to <OForm :form="form">.
//
// `headers` and `metadata.*` are FORM-OWNED dynamic/nested fields; the
// destination-type side-effects (method/output_format/url_endpoint/headers
// defaulting) run in a single `{ flush: "sync" }` watch on the form's
// destination_type. Edit-prefill seeds the form via `form.reset(record)`.

// Build the create-mode default record. OpenObserve is the default type, so seed
// the OpenObserve endpoint + default headers.
const buildCreateDefaults = (): DestinationForm => ({
  name: "",
  url: "",
  skip_tls_verify: false,
  headers: getDefaultHeaders("openobserve").map((h) => ({
    key: h.key,
    value: h.value,
  })),
  metadata: {},
  destination_type: "openobserve",
  url_endpoint: "/api/default/default/_json", // Default endpoint for OpenObserve
  method: "post",
  output_format: "json",
  esbulk_index: "",
  separator: "",
  org: "default",
  stream: "default",
});

const form = useOForm<DestinationForm>({
  defaultValues: buildCreateDefaults(),
  schema: destinationSchema,
  onSubmit: (value) => createDestination(value),
});

// True while an edit record is being seeded onto the form (form.reset). The
// destination_type side-effect watch is suppressed during prefill so the
// reset's explicit url_endpoint/output_format/headers aren't clobbered by the
// create-mode defaulting — independent of the `destination` prop (tests call
// populateFormForEdit directly).
let isPrefilling = false;

// ── Reactive reads of the form-owned state (the SINGLE source of truth) ────────
// These drive the parent-side conditional rendering (card grid selection, the
// per-type/per-output_format v-ifs) and the computed reads below.
const destinationType = form.useStore((s: any) => s.values.destination_type);
const outputFormat = form.useStore((s: any) => s.values.output_format);
const formName = form.useStore((s: any) => s.values.name);
const formUrl = form.useStore((s: any) => s.values.url);
const formMethod = form.useStore((s: any) => s.values.method);
const formUrlEndpoint = form.useStore((s: any) => s.values.url_endpoint);
const formSeparator = form.useStore((s: any) => s.values.separator);
const formEsbulkIndex = form.useStore((s: any) => s.values.esbulk_index);
const formMetadata = form.useStore((s: any) => s.values.metadata ?? {});
const openobserveOrg = form.useStore((s: any) => s.values.org);
const openobserveStream = form.useStore((s: any) => s.values.stream);
// `apiHeaders` is a reactive view of the form-owned `headers` array — drives the
// template v-for + the exposed test surface. Reading via form.useStore tracks
// every add/remove/edit (a bare `form.state.values` read would NOT re-render).
const apiHeaders = form.useStore((s: any) => (s.values.headers ?? []) as HeaderRow[]);

// ── Cross-field side effect: defaulting on a REAL destination_type change ──────
// Sets method/output_format/esbulk_index/url_endpoint + resets headers. Guard
// `prev !== undefined` so the initial seed does NOT clobber edit-prefill, and
// skip in edit mode. `{ flush: "sync" }` so the cross-field resets land before
// any subsequent same-tick write.
watch(
  form.useStore((s: any) => s.values.destination_type),
  (newType, prev) => {
    if (prev === undefined || newType === prev) return;
    // Skip while seeding an edit record (prefill) or in edit mode — the reset
    // already carries the correct values.
    if (isPrefilling || isEditMode.value) return;

    if (newType !== "custom") {
      // Set method to POST for all non-custom types.
      form.setFieldValue("method", "post", { dontUpdateMeta: true });

      // Set output_format based on destination type.
      if (newType === "splunk") {
        form.setFieldValue("output_format", "nestedevent", {
          dontUpdateMeta: true,
        });
      } else if (newType === "elasticsearch") {
        form.setFieldValue("output_format", "esbulk", {
          dontUpdateMeta: true,
        });
        // Set default index name if not already set.
        if (!form.state.values.esbulk_index) {
          form.setFieldValue("esbulk_index", "default", {
            dontUpdateMeta: true,
          });
        }
      } else {
        form.setFieldValue("output_format", "json", { dontUpdateMeta: true });
      }
    }

    // Set endpoint based on destination type.
    if (newType === "openobserve") {
      // For OpenObserve, use org and stream values.
      form.setFieldValue(
        "url_endpoint",
        `/api/${form.state.values.org || "default"}/${form.state.values.stream || "default"}/_json`,
        { dontUpdateMeta: true },
      );
    } else {
      // For other types, use the default endpoint.
      form.setFieldValue("url_endpoint", endpointForType(newType), {
        dontUpdateMeta: true,
      });
    }

    // Set default headers for the destination type (form-owned array-field).
    form.setFieldValue(
      "headers",
      getDefaultHeaders(newType ?? "openobserve").map((h) => ({
        key: h.key,
        value: h.value,
      })),
      { dontUpdateMeta: true },
    );
  },
  { flush: "sync" },
);

// Populate the form when editing an existing destination. Builds the full edit
// record and seeds it onto the form via `form.reset(record)`.
const populateFormForEdit = (destination: any) => {
  const record: DestinationForm = {
    name: destination.name || "",
    url: "",
    skip_tls_verify: destination.skip_tls_verify || false,
    headers: [],
    metadata: {},
    destination_type: "openobserve",
    url_endpoint: "",
    method: destination.method || "post",
    output_format: "json",
    esbulk_index: "",
    separator: "",
    org: "default",
    stream: "default",
  };

  // Handle output_format
  if (destination.output_format) {
    if (typeof destination.output_format === "object" && destination.output_format.esbulk) {
      record.output_format = "esbulk";
      record.esbulk_index = destination.output_format.esbulk.index || "default";
      record.separator = "";
    } else if (
      typeof destination.output_format === "object" &&
      destination.output_format.stringseparated
    ) {
      record.output_format = "stringseparated";
      record.separator = destination.output_format.stringseparated.separator || "";
      record.esbulk_index = "";
    } else if (typeof destination.output_format === "string") {
      record.output_format = destination.output_format;
      record.esbulk_index = "";
      record.separator = "";
    }
  } else {
    record.output_format = "json";
    record.esbulk_index = "";
    record.separator = "";
  }

  // Use destination_type_name from backend, fallback to destination_type or default
  const destType = destination.destination_type_name || destination.destination_type;
  record.destination_type = destType && destType.trim() !== "" ? destType : "openobserve";

  // Split URL into hostname and endpoint for all destination types except custom
  const fullUrl = destination.url || "";
  if (fullUrl && record.destination_type !== "custom") {
    try {
      // Add protocol if missing for URL parsing, but only if it looks like a valid URL
      const hasProtocol = fullUrl.includes("://");
      const looksLikeUrl = fullUrl.includes(".") || fullUrl.includes(":");
      const urlToParse = hasProtocol ? fullUrl : looksLikeUrl ? `https://${fullUrl}` : fullUrl;

      const url = new URL(urlToParse);
      // Base URL is protocol + hostname + port (if any) - always include protocol for consistency
      record.url = url.origin;
      // URL endpoint is the path + search + hash
      const endpoint = url.pathname + url.search + url.hash;
      // Only set endpoint if it's not just "/"
      record.url_endpoint = endpoint === "/" ? "" : endpoint;
    } catch (error) {
      // If URL parsing fails, try to split manually
      console.warn("Failed to parse URL, attempting manual split:", fullUrl, error);
      const firstSlashIndex = fullUrl.indexOf("/");
      if (firstSlashIndex > 0) {
        // Split at first slash
        record.url = fullUrl.substring(0, firstSlashIndex);
        record.url_endpoint = fullUrl.substring(firstSlashIndex);
      } else {
        // No slash found, keep full URL as-is
        record.url = fullUrl;
        record.url_endpoint = "";
      }
    }
  } else {
    // For custom destination or empty URL, don't split
    record.url = fullUrl;
    record.url_endpoint = "";
  }

  // Populate headers (form-owned dynamic array-field).
  if (destination.headers && typeof destination.headers === "object") {
    record.headers = Object.entries(destination.headers).map(([key, value]) => ({
      key,
      value: value as string,
    }));
  }

  // Populate metadata object (form-owned nested fields).
  if (destination.metadata && typeof destination.metadata === "object") {
    record.metadata = { ...destination.metadata };
  } else {
    record.metadata = {};
  }

  // Extract OpenObserve org and stream from endpoint if it's OpenObserve
  if (record.destination_type === "openobserve" && record.url_endpoint) {
    // Parse endpoint like /api/{org}/{stream}/_json
    const match = record.url_endpoint.match(/^\/api\/([^/]+)\/([^/]+)\/_json$/);
    if (match) {
      record.org = match[1] || "default";
      record.stream = match[2] || "default";
    }
  }

  // Seed the whole record onto the form (single source of truth). Suppress the
  // destination_type side-effect watch for the duration of the reset so the
  // record's explicit url_endpoint/output_format/headers aren't clobbered by the
  // create-mode defaulting. `{ flush: "sync" }` makes the watch fire during the
  // reset, so the flag must wrap the reset call synchronously.
  isPrefilling = true;
  form.reset(record);
  isPrefilling = false;

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

const isValidDestination = computed(() => {
  return !!(formName.value && formUrl.value && formMethod.value);
});

// Default URL endpoints for different destination types (shown as hint). Reads
// the form-owned destination_type (single source of truth).
const defaultUrlEndpoint = computed(() => endpointForType(destinationType.value));

// Show metadata fields for specific destination types (form-owned read).
const showMetadataFields = computed(() => {
  return ["splunk", "datadog"].includes(destinationType.value);
});

// Keep the OpenObserve endpoint in sync with org/stream as the user edits them.
// org/stream are form-owned (name="org"/"stream"); watch the form's values and
// write url_endpoint back onto the form — a single source of truth.
watch([openobserveOrg, openobserveStream], ([org, stream]) => {
  if (destinationType.value === "openobserve") {
    form.setFieldValue("url_endpoint", `/api/${org || "default"}/${stream || "default"}/_json`, {
      dontUpdateMeta: true,
    });
  }
});

// Step validation
const canProceedStep1 = computed(() => {
  return !!destinationType.value;
});

const canProceedStep2 = computed(() => {
  // Every value is form-owned — read it from the form (single source of truth).
  const basicValidation =
    formName.value &&
    isValidResourceName(formName.value) &&
    formUrl.value &&
    formMethod.value &&
    outputFormat.value;

  if (!basicValidation) return false;

  // Validate url_endpoint for non-custom destination types
  if (destinationType.value !== "custom" && !formUrlEndpoint.value?.trim()) {
    return false;
  }

  // Validate destination-specific metadata
  if (destinationType.value === "splunk") {
    return !!(
      formMetadata.value?.source?.trim() &&
      formMetadata.value?.sourcetype?.trim() &&
      formMetadata.value?.hostname?.trim()
    );
  }

  if (destinationType.value === "elasticsearch") {
    // Validate esbulk_index is set
    return !!(outputFormat.value === "esbulk" && formEsbulkIndex.value?.trim());
  }

  if (destinationType.value === "datadog") {
    return !!(formMetadata.value?.ddsource?.trim() && formMetadata.value?.ddtags?.trim());
  }

  // Additional validation for StringSeparated format
  if (outputFormat.value === "stringseparated") {
    return !!(
      formSeparator.value !== null &&
      formSeparator.value !== undefined &&
      formSeparator.value !== ""
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

// Connection notes for each destination type (form-owned read).
const connectionNotes = computed(() => {
  switch (destinationType.value) {
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
// `value` is the validated payload and the SINGLE source of truth. Returning the
// service promise lets OForm's awaited isSubmitting drive the Save spinner.
//
// `value` is optional so existing tests that invoke createDestination() directly
// keep working — they fall back to the form's live state (still the one source
// of truth, never a mirror).
const createDestination = (value?: DestinationForm) => {
  // Read every field from the form (single source of truth): the @submit payload
  // if present, else the form's live state for direct test calls.
  const v = (value ?? form.state.values) as DestinationForm;
  const name = v.name ?? "";
  const url = v.url ?? "";

  if (!(name && url && v.method)) {
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
  const headerRows = (v.headers ?? []) as HeaderRow[];
  const headers: Headers = {};
  headerRows.forEach((header) => {
    if (header["key"] && header["value"]) headers[header.key] = header.value;
  });

  // Merge URL + URL endpoint
  const fullUrl = url + (v.url_endpoint || "");

  // Handle output format - for esbulk, format as JSON object with index
  // For stringseparated, format as JSON object with separator
  // For all other formats (json, nestedevent, etc.), keep as string
  let outputFormat: any = v.output_format;
  if (v.output_format === "esbulk") {
    outputFormat = {
      esbulk: {
        index: v.esbulk_index,
      },
    };
  } else if (outputFormat === "stringseparated" && v.separator) {
    outputFormat = {
      stringseparated: {
        separator: v.separator,
      },
    };
  } else {
    // Keep output_format as string for json, nestedevent, and other formats
    outputFormat = v.output_format;
  }

  // skip_tls_verify is form-owned — read it from the validated payload.
  const skipTlsVerify = v.skip_tls_verify ?? false;

  const payload: any = {
    url: fullUrl,
    method: v.method,
    skip_tls_verify: skipTlsVerify,
    // `template` is an alert-destination-model field this pipeline form never
    // edits (there is no template input). Round-trip the existing value from the
    // edit record so editing a destination that carries a template does not wipe
    // it. In create mode `props.destination` is undefined → "".
    template: props.destination?.template || "",
    headers: headers,
    name: name,
    type: "http",
    output_format: outputFormat,
    destination_type_name: v.destination_type,
  };

  // Add metadata as JSON object (form-owned via nested metadata.* fields). Only
  // include non-empty values so we don't persist blank keys.
  const metadataSource = v.metadata ?? {};
  const metadata: Record<string, string> = {};
  Object.entries(metadataSource).forEach(([k, val]) => {
    if (val !== undefined && val !== null && String(val) !== "") {
      metadata[k] = val as string;
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

// Add/remove operate DIRECTLY on the FORM-OWNED `headers` array (the single
// source of truth) via pushFieldValue/removeFieldValue; the `apiHeaders`
// form.useStore view re-renders the template v-for automatically. The template's
// delete button passes the row INDEX.
const addApiHeader = (key: string = "", value: string = "") => {
  form.pushFieldValue("headers", { key, value }, { dontUpdateMeta: true });
};

const deleteApiHeader = (index: number) => {
  form.removeFieldValue("headers", index, { dontUpdateMeta: true });
  // Always keep at least one (blank) row so the add button stays reachable.
  if ((form.state.values.headers ?? []).length === 0) {
    form.pushFieldValue(
      "headers",
      { key: "", value: "" },
      {
        dontUpdateMeta: true,
      },
    );
  }
};

// Reset the form back to the create-mode OpenObserve defaults (single source of
// truth — no `formData` mirror to clear). `form.reset(record)` restores every
// field, including the default headers.
const resetForm = () => {
  form.reset(buildCreateDefaults());
  step.value = 1;
};

// Expose functions for testing. `form` is the single source of truth — tests
// read field values via `form.state.values` and set them via
// `form.setFieldValue`.
defineExpose({
  getUUID,
  createDestination,
  addApiHeader,
  deleteApiHeader,
  resetForm,
  apiHeaders,
  isValidDestination,
  step,
  nextStep,
  prevStep,
  canProceedStep1,
  canProceedStep2,
  connectionNotes,
  populateFormForEdit,
  isEditMode,
  defaultUrlEndpoint,
  showMetadataFields,
  destinationType,
  outputFormat,
  openobserveOrg,
  openobserveStream,
  // The form itself — the single source of truth for every field.
  form,
  formName,
  formUrl,
});
</script>
