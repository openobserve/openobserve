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
  <div class="p-0 o2-custom-bg"
    style="
      height: calc(100vh - 48px);
      min-height: inherit;
      display: flex;
      flex-direction: column;
    "
  >
    <AppPageHeader
      :title="destination ? t('alert_destinations.updateTitle') : t('alert_destinations.addTitle')"
      title-data-test="add-destination-title"
      :back="{
        label: t('alert_destinations.header'),
        onClick: () => emit('cancel:hideform'),
      }"
      class="px-3 border-b border-border-default"
      style="flex-shrink: 0"
    >
    </AppPageHeader>
    <div
      class="card-container py-2"
      style="flex: 1; overflow-y: auto; overflow-x: hidden"
    >
      <div>
        <!-- OWNER of this <OForm> (Rule ③): AddDestination reads its own form
             state (form.useStore) to drive the discriminated rendering and
             bridges the non-<input> discriminators (destination_type card grid,
             type tabs) via setFieldValue. Custom/pipeline destinations submit
             THIS form (id=add-destination-form); prebuilt destinations submit
             the nested child credential form by id (form-id bridge, R4). -->
        <OForm
          :form="form"
          id="add-destination-form"
          class="flex flex-col gap-2 px-3 mt-2 mb-1"
        >
          <!-- Destination Type Selection for Alerts (only show in create mode, not edit) -->
          <div v-if="isAlerts && !destination" class="w-full pb-3">
            <div class="text-sm font-medium mb-2">
              {{ t("alert_destinations.destination_type") }}
            </div>
            <PrebuiltDestinationSelector
              :model-value="dtVal"
              @update:model-value="setDestinationType"
              :search-query="destinationSearchQuery"
              data-test="prebuilt-destination-selector"
              @select="selectDestinationType"
              @update:search-query="destinationSearchQuery = $event"
            />
          </div>

          <!-- Destination Type and Name Display for Edit Mode -->
          <div
            v-if="isAlerts && destination && dtVal"
            class="w-full pb-3"
          >
            <div class="flex gap-3">
              <!-- Destination Type (Read-only) -->
              <div class="w-1/2">
                <div class="text-sm font-medium mb-1 leading-tight">
                  {{ t("alert_destinations.destination_type") }}
                </div>
                <div
                  class="flex items-center p-2 el-border el-border-radius"
                  data-test="destination-type-readonly"
                >
                  <OIcon
                    :name="getDestinationTypeIcon(dtVal)"
                    size="md"
                    class="mr-2"
                  />
                  <span class="text-sm">{{
                    getDestinationTypeName(dtVal)
                  }}</span>
                  <OTag
                    type="readonlyFlag"
                    value="readonly"
                    class="ml-2"
                    >{{ t("alert_destinations.readonly") }}</OTag
                  >
                </div>
              </div>
              <!-- Destination Name (Read-only) -->
              <div class="w-1/2">
                <OFormInput
                  data-test="add-destination-name-input"
                  name="name"
                  :label="t('alerts.name')"
                  required
                  readonly
                  disabled
                  tabindex="0"
                />
              </div>
            </div>
          </div>

          <!-- Prebuilt Destination Form (for alerts only) -->
          <!-- Show for: create mode with destination_type selected OR edit mode for prebuilt destinations -->
          <div
            v-if="
              isAlerts &&
              (isPrebuiltDestination ||
                (isUpdatingDestination &&
                  dtVal !== 'custom'))
            "
            class="w-full"
          >
            <!-- Name Field for Create Mode -->
            <div v-if="!destination" class="w-1/2 pb-3">
              <OFormInput
                data-test="add-destination-name-input"
                name="name"
                :label="t('alerts.name')"
                required
                tabindex="0"
              />
            </div>

            <PrebuiltDestinationForm
              v-if="dtVal && dtVal !== 'custom'"
              :destination-type="dtVal"
              :hide-actions="true"
              data-test="prebuilt-form"
            />
            <div v-else-if="isUpdatingDestination" class="p-3 text-center">
              <OSpinner size="md" data-test="add-destination-loading-indicator" />
              <div class="mt-2 text-gray-400">{{ t("alert_destinations.loadingData") }}</div>
            </div>

            <!-- Template selector for prebuilt destinations -->
            <div
              v-if="dtVal && dtVal !== 'custom'"
              class="w-1/2 py-1"
            >
              <OFormSelect
                data-test="add-destination-prebuilt-template-select"
                name="template"
                :label="t('alert_destinations.template')"
                :options="prebuiltTemplateOptions"
                labelKey="label"
                valueKey="value"
                tabindex="0"
              />
              <div class="text-xs text-gray-400 mt-1">
                {{ t('alert_destinations.templateHelp', {
                  type: getDestinationTypeName(dtVal),
                  name: defaultPrebuiltTemplateName,
                }) }}
              </div>
            </div>

            <!-- Additional Settings for Prebuilt Destinations -->
            <div class="w-full mt-3">
              <div class="font-bold py-1">
                {{ t("alert_destinations.additional_settings") }}
              </div>

              <!-- Custom Headers (hidden for email destinations) -->
              <div v-if="dtVal !== 'email'" class="py-2">
                <div class="text-sm font-medium pb-1">
                  {{ t("alert_destinations.custom_headers") }}
                </div>
                <div
                  v-for="(header, index) in apiHeaders"
                  :key="index"
                  class="flex gap-2 pb-2"
                >
                  <div class="w-5/12 ml-0">
                    <OFormInput
                      :data-test="`add-destination-header-${header['key']}-key-input`"
                      :name="`apiHeaders[${index}].key`"
                      :placeholder="t('alert_destinations.api_header')"
                      tabindex="0"
                    />
                  </div>
                  <div class="w-5/12 ml-0">
                    <OFormInput
                      :data-test="`add-destination-header-${header['key']}-value-input`"
                      :name="`apiHeaders[${index}].value`"
                      :placeholder="t('alert_destinations.api_header_value')"
                      tabindex="0"
                    />
                  </div>
                  <div class="w-1/6 ml-0">
                    <OButton
                      :data-test="`add-destination-header-${header['key']}-delete-btn`"
                      class="ml-1"
                      variant="ghost"
                      size="icon-circle-sm"
                      :title="t('alert_templates.edit')"
                      @click="deleteApiHeader(index)"
                    >
                      <OIcon name="delete" size="sm" />
                    </OButton>
                    <OButton
                      data-test="add-destination-add-header-btn"
                      v-if="index === apiHeaders.length - 1"
                      class="ml-1"
                      variant="ghost"
                      size="icon-circle-sm"
                      :title="t('alert_templates.edit')"
                      @click="addApiHeader()"
                    >
                      <OIcon name="add" size="sm" />
                    </OButton>
                  </div>
                </div>
              </div>

              <!-- Skip TLS Verify Toggle -->
              <div class="py-2">
                <OFormSwitch
                  data-test="add-destination-skip-tls-verify-toggle"
                  name="skip_tls_verify"
                  :label="t('alert_destinations.skip_tls_verify')"
                />
              </div>
            </div>

            <!-- Test Result Display -->
            <DestinationTestResult
              v-if="lastTestResult"
              :result="lastTestResult"
              :is-loading="isTestInProgress"
              data-test="prebuilt-test-result"
              @retry="handleTestDestination"
            />
          </div>

          <!-- Tabs for non-alert destinations OR custom alert destinations -->
          <div
            v-if="
              !isAlerts || (isAlerts && dtVal === 'custom')
            "
            class="w-full pb-3"
          >
            <div class="app-tabs-container h-[36px] mr-2 w-fit">
              <app-tabs
                data-test="add-destination-tabs"
                :tabs="tabs"
                class="tabs-selection-container"
                :active-tab="typeVal"
                @update:active-tab="setType"
              />
            </div>
          </div>
          <div
            v-if="typeVal === 'email' && !getFormattedTemplates.length"
            class="flex items-center w-full mb-3"
          >
            <div class="text-sm font-medium mr-2">
              {{ t("alert_destinations.noEmailTemplates") }}
            </div>
            <OButton variant="outline" size="sm" @click="createEmailTemplate"
              >{{ t("alert_destinations.createEmailTemplate") }}</OButton
            >
          </div>
          <!-- Name + Template row for custom alert destinations -->
          <div
            v-if="isAlerts && dtVal === 'custom'"
            class="flex gap-3 w-full"
          >
            <div class="w-1/2 py-1">
              <OFormInput
                data-test="add-destination-name-input"
                name="name"
                :label="t('alerts.name')"
                required
                tabindex="0"
              />
            </div>
            <div class="w-1/2 py-1">
              <OFormSelect
                data-test="add-destination-template-select"
                name="template"
                :label="t('alert_destinations.template')"
                required
                :options="getFormattedTemplates"
                tabindex="0"
              />
            </div>
          </div>
          <!-- Name field for non-alert destinations (pipelines) -->
          <div
            v-if="!isAlerts"
            class="py-1 w-full"
          >
            <OFormInput
              data-test="add-destination-name-input"
              name="name"
              :label="t('alerts.name')"
              required
              tabindex="0"
            />
          </div>

          <template
            v-if="
              (isAlerts &&
                dtVal === 'custom' &&
                typeVal === 'http') ||
              (!isAlerts && typeVal === 'http')
            "
          >
            <div class="flex gap-3 w-full">
              <div class="w-1/2 py-1">
                <OFormInput
                  data-test="add-destination-url-input"
                  name="url"
                  :label="t('alert_destinations.url')"
                  required
                  tabindex="0"
                />
              </div>
              <div
                class="py-1"
                :class="{ 'w-1/4': !isAlerts, 'w-1/2': isAlerts }"
              >
                <OFormSelect
                  data-test="add-destination-method-select"
                  name="method"
                  :label="t('alert_destinations.method')"
                  required
                  :options="apiMethods"
                  tabindex="0"
                />
              </div>
              <div
                v-if="!isAlerts"
                class="w-1/4 py-1"
              >
                <OFormSelect
                  data-test="add-destination-output-format-select"
                  name="output_format"
                  :label="t('alert_destinations.output_format')"
                  required
                  :options="outputFormats"
                  tabindex="0"
                />
              </div>
            </div>
            <div class="w-full py-2">
              <div class="font-bold py-1">{{ t("alert_destinations.headers") }}</div>
              <div
                v-for="(header, index) in apiHeaders"
                :key="index"
                class="flex gap-2 pb-2"
              >
                <div class="w-5/12 ml-0">
                  <OFormInput
                    :data-test="`add-destination-header-${header['key']}-key-input`"
                    :name="`apiHeaders[${index}].key`"
                    :placeholder="t('alert_destinations.api_header')"
                    tabindex="0"
                  />
                </div>
                <div class="w-5/12 ml-0">
                  <OFormInput
                    :data-test="`add-destination-header-${header['key']}-value-input`"
                    :name="`apiHeaders[${index}].value`"
                    :placeholder="t('alert_destinations.api_header_value')"
                    tabindex="0"
                  />
                </div>
                <div class="w-1/6 ml-0">
                  <OButton
                    :data-test="`add-destination-header-${header['key']}-delete-btn`"
                    class="ml-1"
                    variant="ghost"
                    size="icon-circle-sm"
                    :title="t('alert_templates.edit')"
                    @click="deleteApiHeader(index)"
                  >
                    <OIcon name="delete" size="sm" />
                  </OButton>
                  <OButton
                    data-test="add-destination-add-header-btn"
                    v-if="index === apiHeaders.length - 1"
                    class="ml-1"
                    variant="ghost"
                    size="icon-circle-sm"
                    :title="t('alert_templates.edit')"
                    @click="addApiHeader()"
                  >
                    <OIcon name="add" size="sm" />
                  </OButton>
                </div>
              </div>
            </div>
            <div class="w-full py-2">
              <OFormSwitch
                data-test="add-destination-skip-tls-verify-toggle"
                name="skip_tls_verify"
                :label="t('alert_destinations.skip_tls_verify')"
              />
            </div>
          </template>
          <template
            v-if="
              typeVal === 'email' &&
              (!isAlerts || dtVal === 'custom')
            "
          >
            <OFormInput
              name="emails"
              :label="t('reports.recipients')"
              required
              tabindex="0"
              style="width: 100%"
              :placeholder="t('user.inviteByEmail')"
            />
          </template>

          <template
            v-if="
              typeVal === 'action' &&
              (!isAlerts || dtVal === 'custom')
            "
          >
            <div class="w-1/2 py-1 action-select">
              <OFormSelect
                data-test="add-destination-action-select"
                name="action_id"
                :label="t('alert_destinations.action')"
                required
                :options="actionOptions"
                searchable
                labelKey="label"
                valueKey="value"
                :loading="isLoadingActions"
                tabindex="0"
              />
            </div>
          </template>
        </OForm>
      </div>
      <div class="flex justify-between px-4 py-4 w-full border-t border-border-default">
        <!-- Left side: Test and Preview buttons (only for prebuilt destinations) -->
        <div
          v-if="
            isAlerts &&
            (isPrebuiltDestination ||
              (isUpdatingDestination && dtVal !== 'custom'))
          "
          class="flex items-center gap-2"
        >
          <OButton
            data-test="destination-preview-button"
            variant="outline"
            size="sm"
            @click="showPreview"
            icon-left="preview"
          >
            {{ t("alert_destinations.preview") }}
          </OButton>
          <OButton
            data-test="destination-test-button"
            :loading="isTestInProgress"
            variant="outline"
            size="sm"
            @click="handleTestDestination"
            icon-left="send"
          >
            {{ t("alert_destinations.test") }}
          </OButton>
        </div>
        <div v-else></div>

        <!-- Right side: Cancel and Save buttons -->
        <div class="flex items-center gap-2">
          <OButton
            data-test="add-destination-cancel-btn"
            v-close-popup="true"
            variant="outline"
            size="sm-action"
            @click="$emit('cancel:hideform')"
            >{{ t("alerts.cancel") }}</OButton
          >
          <!-- R4: Enter + this Save both submit the ONE form by id (custom,
               pipeline AND prebuilt all live in add-destination-form now — no
               nested form to route to). @click is additive to the native submit
               — it restores the pre-migration landing-state toast (see
               onSaveClick) without disturbing the form-id submit. -->
          <OButton
            data-test="add-destination-submit-btn"
            variant="primary"
            size="sm-action"
            type="submit"
            form="add-destination-form"
            @click="onSaveClick"
            >{{ t("alerts.save") }}</OButton
          >
        </div>
      </div>
    </div>

    <!-- Destination Preview Modal -->
    <DestinationPreview
      v-model="showPreviewModal"
      :type="dtVal"
      :template-content="previewContent"
      data-test="destination-preview-modal"
    />
  </div>
</template>
<script lang="ts" setup>
import {
  ref,
  computed,
  onBeforeMount,
  onActivated,
  watch,
} from "vue";
import type { PropType } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import type {
  Template,
  Headers,
  DestinationPayload,
} from "@/ts/interfaces";
import { useRouter } from "vue-router";
import AppTabs from "@/components/common/AppTabs.vue";
import config from "@/aws-exports";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import { isPrebuiltType, detectPrebuiltTypeFromUrl } from "@/utils/prebuilt-templates";
import PrebuiltDestinationForm from "./PrebuiltDestinationForm.vue";
import { prebuiltDestinationDefaults } from "./PrebuiltDestinationForm.schema";
import PrebuiltDestinationSelector from "./PrebuiltDestinationSelector.vue";
import DestinationTestResult from "./DestinationTestResult.vue";
import DestinationPreview from "./DestinationPreview.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeAddDestinationSchema,
  addDestinationDefaults,
  type AddDestinationForm,
} from "./AddDestination.schema";

const props = defineProps({
  templates: {
    type: Array as PropType<Template[]>,
    default: [],
  },
  destination: {
    type: Object as PropType<DestinationPayload | null>,
    default: null,
  },
  isAlerts: {
    type: Boolean,
    default: true,
  },
});
const emit = defineEmits(["get:destinations", "cancel:hideform"]);
const apiMethods = ["get", "post", "put"];
const outputFormats = ["json", "ndjson"];
const store = useStore();
const { t } = useI18n();
const { track } = useReo();

// ── OWNER pattern (Rule ③): create the single form here so its state drives the
// discriminated rendering (form.useStore) and the non-<input> discriminators
// (card grid + tabs) bridge in via setFieldValue. There is ONE form for custom,
// pipeline AND prebuilt destinations (credentials are form-owned `credentials.*`
// fields now, not a nested child form) — `saveDestination` dispatches by type.
const form = useOForm({
  defaultValues: addDestinationDefaults(),
  schema: makeAddDestinationSchema(t, props.isAlerts),
  onSubmit: (value) => saveDestination(value as AddDestinationForm),
});

// Single submit entry-point. Prebuilt types save via handlePrebuiltSave (which
// reads the form-owned `credentials.*`); custom/pipeline via saveCustomDestination.
// Returned so OForm awaits the real save → the footer Save spinner spans it.
function saveDestination(value: AddDestinationForm) {
  return isPrebuiltDestination.value
    ? handlePrebuiltSave(value)
    : saveCustomDestination(value);
}

// Reactive reads of the form-owned discriminators + the api-headers array.
const dtVal = form.useStore((s: any) => s.values.destination_type as string);
const typeVal = form.useStore((s: any) => s.values.type as string);
const apiHeaders = form.useStore(
  (s: any) => (s.values.apiHeaders ?? []) as { key: string; value: string }[],
);

const isUpdatingDestination = ref(false);
const isLoadingActions = ref(false);
const router = useRouter();
const actionOptions = ref<{ value: string; label: string; type: string }[]>([]);

const { getAllActions } = useActions();

// Prebuilt destinations composable
const {
  availableTypes,
  testDestination,
  createDestination,
  updateDestination,
  generatePreview,
  isTestInProgress,
  lastTestResult,
  detectPrebuiltType,
} = usePrebuiltDestinations();

// Prebuilt credentials are a form-owned sub-object (`credentials.*`) now — read
// them reactively from the ONE form for the Preview/Test buttons (no mirror ref).
const prebuiltCredentials = form.useStore(
  (s: any) => (s.values.credentials ?? {}) as Record<string, any>,
);
const destinationSearchQuery = ref("");
const showPreviewModal = ref(false);
const previewContent = ref("");

// Landing-state feedback (pre-migration parity). The Save button natively
// submits the parent form; in the alerts create flow with no destination-type
// card chosen yet, `destination_type` is empty so the schema rejects on
// name/url — but those fields aren't mounted until a card is picked, so the
// errors have nowhere to render and the click looks dead. Pre-migration
// saveDestination always toasted "Please fill required fields" here; restore it.
// Once a card IS picked the fields mount and show inline errors, so this only
// needs to cover the no-type-selected state (and it runs alongside, not instead
// of, the native submit — the R4 form-id routing is untouched).
const onSaveClick = () => {
  if (props.isAlerts && !props.destination && !dtVal.value) {
    toast({
      variant: "error",
      message: t("common.fillRequiredFields"),
      timeout: 1500,
    });
  }
};

// Bridge helpers for the non-<input> discriminators.
const setDestinationType = (v: string) =>
  form.setFieldValue("destination_type", v ?? "");
const setType = (v: string) => form.setFieldValue("type", v);

const tabs = computed(() => {
  // In edit mode for custom destinations, only show the tab for the current type
  if (
    isUpdatingDestination.value &&
    dtVal.value === "custom"
  ) {
    const currentType = typeVal.value;

    // Only return the tab matching the current destination type
    if (currentType === "http") {
      return [{ label: t("alerts.webhook"), value: "http", icon: "webhook" }];
    } else if (currentType === "email") {
      return [{ label: t("alerts.email"), value: "email", icon: "mail" }];
    } else if (currentType === "action") {
      return [{ label: t("alerts.action"), value: "action", icon: "bolt" }];
    }
  }

  // In create mode, show all tabs
  const tabs = [
    { label: t("alerts.webhook"), value: "http", icon: "webhook" },
    { label: t("alerts.email"), value: "email", icon: "mail" },
  ];

  if (
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    store.state.zoConfig.actions_enabled
  ) {
    tabs.push({ label: t("alerts.action"), value: "action", icon: "bolt" });
  }

  return tabs;
});

// Check if current destination type is prebuilt
const isPrebuiltDestination = computed(() => {
  return !!(dtVal.value && dtVal.value !== "custom");
});

// Helper methods for displaying destination type in edit mode
const getDestinationTypeName = (typeId: string) => {
  const type = availableTypes.value.find((t) => t.id === typeId);
  return type ? type.name : typeId;
};

const getDestinationTypeIcon = (typeId: string) => {
  const iconMap: Record<string, string> = {
    slack: "chat",
    discord: "forum",
    msteams: "groups",
    email: "email",
    pagerduty: "warning",
    opsgenie: "notifications_active",
    servicenow: "support_agent",
    custom: "settings",
  };
  return iconMap[typeId] || "webhook";
};

onActivated(() => setupDestinationData());
onBeforeMount(async () => {
  setupDestinationData();
  await getActionOptions();
});

// Watch for destination prop changes (important for edit mode dialog)
watch(
  () => props.destination,
  (newDest) => {
    if (newDest && newDest.name) {
      // Only run setup when destination has actual data (name is a good indicator)
      setupDestinationData();
    }
  },
  { deep: true },
);

const setupDestinationData = () => {
  if (props.destination) {
    isUpdatingDestination.value = true;
    // Resolve the destination_type discriminator FIRST. `setDestType` is pure
    // now (it only records the choice): the resolved value rides into the single
    // form.reset(record) below instead of being poked into the form mid-scan.
    let destType = "";
    const setDestType = (v: string) => {
      destType = v;
    };

    const destHeaders: Record<string, any> = props.destination.headers || {};

    // Set destination_type for prebuilt destinations in edit mode
    // Parse metadata if it's a string
    let parsedMetadata: any = null;
    if (props.destination.metadata) {
      try {
        parsedMetadata =
          typeof props.destination.metadata === "string"
            ? JSON.parse(props.destination.metadata)
            : props.destination.metadata;
      } catch (e) {
        console.error("Failed to parse destination metadata:", e);
      }
    }

    // Priority 1: Check metadata.prebuilt_type (most reliable for prebuilt destinations)
    if (
      parsedMetadata?.prebuilt_type &&
      isPrebuiltType(parsedMetadata.prebuilt_type)
    ) {
      setDestType(parsedMetadata.prebuilt_type);
    }
    // Priority 2: Check if template starts with 'system-prebuilt-' AND destination structure matches
    // (Must have emails array for email, or specific prebuilt URL patterns for HTTP)
    else if (props.destination.template?.startsWith("system-prebuilt-")) {
      const templateType = props.destination.template.replace(
        "system-prebuilt-",
        "",
      );
      // Only treat as prebuilt if structure matches the type
      if (
        templateType === "email" &&
        props.destination.type === "email" &&
        props.destination.emails
      ) {
        setDestType("email");
      } else if (props.destination.type === "http" && props.destination.url) {
        // Use URL-only detection here — detectPrebuiltType also checks the template
        // name, which would always match since we're already inside the
        // system-prebuilt-* branch. A custom destination can have any template,
        // so the URL is the only reliable signal at this point.
        const urlType = detectPrebuiltTypeFromUrl(props.destination.url);
        if (urlType && isPrebuiltType(urlType)) {
          setDestType(urlType);
        } else {
          // Has system template but URL doesn't match prebuilt patterns - it's custom
          setDestType("custom");
        }
      } else {
        setDestType("custom");
      }
    }
    // Priority 3: Check if template starts with 'prebuilt_' (user templates)
    // Also verify the URL matches the prebuilt type to avoid misclassifying custom
    // destinations that happen to use a template with a prebuilt_ prefix.
    else if (props.destination.template?.startsWith("prebuilt_")) {
      const extractedType = props.destination.template.replace("prebuilt_", "");
      if (isPrebuiltType(extractedType) && props.destination.url) {
        const urlType = detectPrebuiltTypeFromUrl(props.destination.url);
        setDestType(urlType === extractedType ? extractedType : "custom");
      } else {
        setDestType(isPrebuiltType(extractedType) ? extractedType : "custom");
      }
    }
    // Priority 4: Check if template includes 'prebuilt' (legacy format)
    // Also verify the URL matches the prebuilt type (same guard as Priority 3).
    else if (props.destination.template?.includes("prebuilt")) {
      const parts = props.destination.template.split("-");
      const extractedType = parts[parts.length - 1];
      if (isPrebuiltType(extractedType) && props.destination.url) {
        const urlType = detectPrebuiltTypeFromUrl(props.destination.url);
        setDestType(urlType === extractedType ? extractedType : "custom");
      } else {
        setDestType(isPrebuiltType(extractedType) ? extractedType : "custom");
      }
    }
    // Priority 5: Fallback to URL-based detection (for destinations created before metadata was added)
    else if (props.destination.url) {
      const detectedType = detectPrebuiltType(props.destination);
      if (detectedType) {
        setDestType(detectedType);
      } else {
        setDestType("custom");
      }
    }
    // Priority 6: No indicators - this is a custom destination
    else {
      setDestType("custom");
    }

    // ── Edit-prefill: ONE form.reset(record) ────────────────────────────────
    // Async data arriving after mount re-seeds via a single reset, never a
    // per-field setFieldValue loop (alerts-migration.md §5). reset() also clears
    // field meta — a setFieldValue loop leaves every prefilled field marked
    // dirty/touched with stale errors, and this runs again on every onActivated.
    // Start from the defaults so every key is present, then overlay the record.
    const record: Record<string, any> = {
      ...addDestinationDefaults(),
      destination_type: destType,
      name: props.destination.name,
      url: props.destination.url ?? "",
      method: props.destination.method ?? "post",
      skip_tls_verify: props.destination.skip_tls_verify ?? false,
      template: props.destination.template ?? "",
      emails: (props.destination?.emails || []).join(", "),
      type: props.destination.type || "http",
      action_id: props.destination.action_id || "",
      // Prebuilt credentials ride into the SAME single reset (form-owned now,
      // not a separate mirror), typed to the active type's fields. Custom → {}.
      credentials:
        destType && destType !== "custom"
          ? prebuiltDestinationDefaults(destType, extractPrebuiltCredentials(destType))
          : {},
    };

    // Only CUSTOM headers reach the UI array; system/prebuilt ones stay implicit.
    // Parity: when there are none, the default apiHeaders row is kept.
    if (Object.keys(destHeaders).length) {
      const systemHeaders = ["Content-Type", "Authorization", "X-Routing-Key"];
      const customHeadersOnly = Object.entries(destHeaders).filter(
        ([key]) => !systemHeaders.includes(key),
      );
      if (customHeadersOnly.length > 0) {
        record.apiHeaders = customHeadersOnly.map(([key, value]) => ({
          key,
          value: value as string,
        }));
      }
    }

    // Parity: only override the default when the saved destination carries one.
    if (props.destination.output_format) {
      record.output_format = props.destination.output_format;
    }

    // ONE reset seeds every field INCLUDING credentials (built above via
    // extractPrebuiltCredentials + prebuiltDestinationDefaults). Template name is
    // stored/displayed as-is (e.g. "prebuilt_slack") — the dropdown's first
    // option carries that value, so edit mode matches automatically.
    form.reset(record);
  }
};

// Rebuild the credential sub-object for an existing prebuilt destination from its
// persisted shape (metadata `credential_*` vars, url/emails, and the auth headers
// where sensitive values live). Pure over props.destination — used to seed the
// single form.reset(record) in edit mode. Mirrors the pre-migration restoration.
const extractPrebuiltCredentials = (typeId: string): Record<string, any> => {
  const credentials: Record<string, any> = {};
  if (!props.destination) return credentials;

  // Step 1: Parse metadata and remove the credential_ prefix. `metadata` is not
  // on the DestinationPayload type but is present on saved records at runtime.
  const rawMetadata = (props.destination as any).metadata;
  if (rawMetadata) {
    try {
      const metadata =
        typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
      Object.entries(metadata).forEach(([key, value]) => {
        if (key.startsWith("credential_")) {
          credentials[key.replace("credential_", "")] = value;
        } else if (key === "routing_key") {
          // PagerDuty stores the integration key as the bare `routing_key`
          // metadata variable (substituted into the request body).
          credentials.integrationKey = value;
        }
      });
    } catch (e) {
      console.error("Failed to parse destination metadata:", e);
    }
  }

  // Step 2: Restore sensitive fields from destination properties.
  // webhookUrl is stored in the url field for webhook-based destinations.
  if (props.destination.url) {
    credentials.webhookUrl = props.destination.url;
  }
  // For ServiceNow, instanceUrl is the base URL.
  if (typeId === "servicenow" && props.destination.url) {
    credentials.instanceUrl = props.destination.url;
  }
  // For email destinations, recipients are in the emails field.
  if (typeId === "email" && props.destination.emails) {
    credentials.recipients = Array.isArray(props.destination.emails)
      ? props.destination.emails.join(", ")
      : props.destination.emails;
  }
  // PagerDuty: integrationKey from routing_key metadata above; fall back to the
  // legacy X-Routing-Key header for destinations saved before the key moved into
  // the request body.
  if (
    typeId === "pagerduty" &&
    !credentials.integrationKey &&
    props.destination.headers?.["X-Routing-Key"]
  ) {
    credentials.integrationKey = props.destination.headers["X-Routing-Key"];
  }
  // Opsgenie: apiKey is in the Authorization header.
  if (typeId === "opsgenie" && props.destination.headers?.["Authorization"]) {
    const authHeader = props.destination.headers["Authorization"];
    if (authHeader.startsWith("GenieKey ")) {
      credentials.apiKey = authHeader.replace("GenieKey ", "");
    }
  }
  // ServiceNow: username:password are in the Basic auth Authorization header.
  if (typeId === "servicenow" && props.destination.headers?.["Authorization"]) {
    const authHeader = props.destination.headers["Authorization"];
    if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = atob(authHeader.replace("Basic ", ""));
        const colonIndex = decoded.indexOf(":");
        if (colonIndex > 0) {
          credentials.username = decoded.substring(0, colonIndex);
          credentials.password = decoded.substring(colonIndex + 1);
        }
      } catch {
        // Can't decode — leave credential fields blank.
      }
    }
  }
  // Non-sensitive fields (severity, priority, assignmentGroup, username, …) are
  // restored from metadata via Step 1. Sensitive fields containing "password",
  // "key", or "token" are NOT persisted to metadata for security.
  return credentials;
};

const getFormattedTemplates = computed(() =>
  props.templates
    .filter((template: any) => {
      if (typeVal.value === "email" && template.type === "email")
        return true;
      else if (typeVal.value !== "email") return true;
    })
    .map((template: any) => template.name),
);

// The prebuilt template for this destination type, sourced from the API
// (isPrebuilt: true). Falls back to the constructed name if the API hasn't
// returned it yet (e.g. templates list still loading).
const templateNameFor = (type: string): string => {
  if (!type || type === "custom") return "";
  const expectedName = `prebuilt_${type}`;
  const fromApi = props.templates.find(
    (t: any) => t.isPrebuilt && t.name === expectedName,
  );
  return fromApi?.name ?? expectedName;
};

const defaultPrebuiltTemplateName = computed(() => templateNameFor(dtVal.value));

// Template choices for a prebuilt destination: the API-sourced prebuilt
// template for this type as the first (default) option, followed by any
// user-created custom templates of the matching kind (email vs http).
// Other prebuilt types are excluded to prevent cross-type mismatches.
const prebuiltTemplateOptions = computed(() => {
  const isEmailType = dtVal.value === "email";
  const matching = props.templates.filter((template: any) => {
    if (template.isPrebuilt) return false;
    if (isEmailType) return template.type === "email";
    return template.type !== "email";
  });

  const options: { label: string; value: string }[] = [];

  if (defaultPrebuiltTemplateName.value) {
    const defaultLabel = t('alert_destinations.templateDefaultOption', {
      name: defaultPrebuiltTemplateName.value,
    });
    options.push({ label: defaultLabel, value: defaultPrebuiltTemplateName.value });
  }

  matching.forEach((template: any) => {
    options.push({ label: template.name, value: template.name });
  });

  return options;
});

const updateActionOptions = () => {
  actionOptions.value = [];
  store.state.organizationData.actions.forEach((action: any) => {
    if (action.execution_details_type === "service")
      actionOptions.value.push({
        value: action.id,
        label: action.name,
        type: action.execution_details_type,
      });
  });
};

const getActionOptions = async () => {
  try {
    isLoadingActions.value = true;
    // Update action options with existing actions
    updateActionOptions();

    // Get all actions from the server and update the action options
    await getAllActions();
    isLoadingActions.value = false;
    updateActionOptions();
  } catch (err) {
    console.error(err);
  } finally {
    isLoadingActions.value = false;
  }
};

// Select destination type (prebuilt or custom) — bridges the card grid choice
// into the form and swaps the discriminated branch WITHOUT carrying stale
// inactive-branch values into the save.
const selectDestinationType = (type: string) => {
  form.setFieldValue("destination_type", type);

  if (type === "custom") {
    // Switch to custom mode — clear any prebuilt credentials.
    form.setFieldValue("credentials", {});
    form.setFieldValue("type", "http");
    form.setFieldValue("url", "");
    form.setFieldValue("template", "");
  } else {
    // Seed a fresh, per-type credential sub-object (defaults for that type) so
    // switching types never carries stale credential keys into the save.
    form.setFieldValue("credentials", prebuiltDestinationDefaults(type, {}));
    form.setFieldValue("type", type === "email" ? "email" : "http");
    form.setFieldValue("template", templateNameFor(type));
  }
};

// Handle prebuilt destination test
const handleTestDestination = async () => {
  if (!isPrebuiltDestination.value) return;

  try {
    await testDestination(dtVal.value, prebuiltCredentials.value);
  } catch (error) {
    console.error("Test failed:", error);
  }
};

// Show template preview
const showPreview = async () => {
  if (!isPrebuiltDestination.value) return;

  try {
    // Clear previous content
    previewContent.value = "";

    // Fetch and generate preview
    const preview = await generatePreview(dtVal.value, prebuiltCredentials.value);
    previewContent.value = preview;

    // Only show modal after content is ready
    showPreviewModal.value = true;
  } catch (error) {
    console.error("Failed to generate preview:", error);
    toast({
      variant: "error",
      message: t("alert_destinations.previewError"),
    });
  }
};

// Save a prebuilt destination — invoked by saveDestination when the ONE form's
// schema passes (the schema now validates the credentials too, so this fires only
// on valid input). name/template/apiHeaders/skip_tls_verify AND `credentials` all
// come from the single validated `value`. Mirrors the old save() prebuilt branch.
async function handlePrebuiltSave(value: AddDestinationForm) {
  try {
    const vals = value as any;
    // Scope credentials to the ACTIVE type's fields (dropping any keys left over
    // from a previous type selection) and coerce them exactly as the schema does
    // — identical to what the pre-migration child credential form emitted.
    const credentials = prebuiltDestinationDefaults(
      value.destination_type,
      (value.credentials ?? {}) as Record<string, unknown>,
    );
    // Build custom headers object from the api-headers array-field
    const customHeaders: Headers = {};
    (vals.apiHeaders || []).forEach((header: any) => {
      if (header.key && header.value) customHeaders[header.key] = header.value;
    });

    const templateOverride = (vals.template || "").trim() || undefined;

    if (isUpdatingDestination.value) {
      // Update existing prebuilt destination
      await updateDestination(
        vals.destination_type,
        props.destination!.name, // original name
        vals.name, // potentially new name
        credentials,
        customHeaders, // custom headers
        vals.skip_tls_verify || false, // skipTlsVerify
        templateOverride,
      );
    } else {
      // Create new prebuilt destination
      await createDestination(
        vals.destination_type,
        vals.name,
        credentials,
        customHeaders, // custom headers
        vals.skip_tls_verify || false, // skipTlsVerify
        templateOverride,
      );
    }

    emit("get:destinations");
    emit("cancel:hideform");
  } catch (error) {
    console.error("Failed to save prebuilt destination:", error);
  }
}

// The custom/pipeline save path (dispatched from saveDestination for non-prebuilt
// types). OForm calls the submit only once the schema (incl. the type-keyed
// superRefine) passes — the schema, not a manual guard, gates the save. `value`
// is the validated payload source of truth; the payload is built with explicit
// keys so no schema-only field (e.g. `credentials`) leaks into the request.
// Mirrors the old save() custom branch exactly.
function saveCustomDestination(value: AddDestinationForm) {
  const dismiss = toast({
    variant: "loading",
    message: t("common.pleaseWait"),
    timeout: 0,
  });
  const headers: Headers = {};
  (value.apiHeaders || []).forEach((header) => {
    if (header.key && header.value) headers[header.key] = header.value;
  });

  const payload: any = {
    url: value.url,
    method: value.method,
    skip_tls_verify: value.skip_tls_verify,
    template: props.isAlerts ? value.template : "",
    headers: headers,
    name: value.name,
  };

  if (!props.isAlerts) {
    payload["output_format"] = value.output_format;
  }

  if (value.type === "email") {
    payload["type"] = "email";
    payload["emails"] = (value.emails || "")
      .split(/[;,]/)
      .map((email: string) => email.trim());
  }

  if (value.type === "action") {
    payload["type"] = "action";
    payload["action_id"] = value.action_id;
  }

  if (isUpdatingDestination.value) {
    track("Button Click", {
      button: "Update Destination",
      page: "Add Destination",
    });
    return destinationService
      .update({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: value.name,
        data: payload,
      })
      .then(() => {
        dismiss();
        emit("get:destinations");
        emit("cancel:hideform");
        toast({
          variant: "success",
          message: t('alert_destinations.saved'),
        });
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
    track("Button Click", {
      button: "Create Destination",
      page: "Add Destination",
    });
    return destinationService
      .create({
        org_identifier: store.state.selectedOrganization.identifier,
        destination_name: value.name,
        data: payload,
      })
      .then(() => {
        dismiss();
        emit("get:destinations");
        emit("cancel:hideform");
        toast({
          variant: "success",
          message: t('alert_destinations.saved'),
        });
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
}

// Add/remove operate on the FORM-OWNED apiHeaders array (single source of truth)
// via push/removeFieldValue; the template v-for keys rows by INDEX (Rule ①). The
// delete button passes the row INDEX.
const addApiHeader = (key = "", value = "") => {
  (form as any).pushFieldValue("apiHeaders", { key, value });
};
const deleteApiHeader = (index: number) => {
  (form as any).removeFieldValue("apiHeaders", index);
  const rows = (form.getFieldValue("apiHeaders") ?? []) as {
    key: string;
    value: string;
  }[];
  // Always keep at least one (blank) row so the add button stays reachable.
  if (!rows.length) (form as any).pushFieldValue("apiHeaders", { key: "", value: "" });
};

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
</script>
