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
  <q-page
    class="q-pa-none o2-custom-bg"
    style="
      height: calc(100vh - 54px);
      min-height: inherit;
      display: flex;
      flex-direction: column;
    "
  >
    <div
      class="card-container add-destination-form tw:overflow-hidden"
      style="flex: 1; min-height: 0; display: flex; flex-direction: column;"
    >
      <div
        class="tw:flex tw:items-center tw:flex-nowrap tw:px-4"
        style="flex-shrink: 0"
      >
        <div class="flex items-center tw:h-[68px]">
          <div
            class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius tw:mr-2"
            @click="$emit('cancel:hideform')"
          >
            <q-icon name="arrow_back_ios_new" size="14px" />
          </div>
          <div class="tw:flex-1" data-test="add-destination-title">
            <div class="q-table__title tw:font-[600] tw:leading-tight">
              {{
                destination
                  ? t("alert_destinations.updateTitle") + " - " + destination.name
                  : t("alert_destinations.addTitle")
              }}
            </div>
          </div>
        </div>
      </div>
      <q-separator />
      <div
        class="add-destination-form tw:overflow-hidden"
        style="flex: 1; min-height: 0;"
      >
      <q-form
        ref="destinationForm"
        class="tw:w-full tw:h-full tw:overflow-hidden"
        style="display: flex; flex-direction: column;"
      >
        <div style="flex: 1; min-height: 0; display: flex; overflow: hidden; gap: 24px; padding: 16px;">
          <!-- Left Column: Form Fields -->
          <div style="flex: 1; overflow-y: auto; min-height: 0; min-width: 0;">
            <div class="tw:flex tw:flex-col tw:gap-4">
              <!-- Destination Type Selection (create mode, alerts only) -->
              <div v-if="isAlerts && !destination" class="tw:flex tw:gap-2">
                <div class="tw:w-full">
                  <q-select
                    data-test="add-destination-type-select"
                    v-model="formData.destination_type"
                    :label="t('alert_destinations.destination_type') + ' *'"
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
                    @update:model-value="selectDestinationType"
                  >
                    <template #selected-item="scope">
                      <div class="tw:flex tw:items-center tw:flex-nowrap">
                        <img
                          v-if="scope.opt.image"
                          :src="scope.opt.image"
                          class="option-image tw:mr-2"
                        />
                        <q-icon
                          v-else
                          :name="scope.opt.icon"
                          size="20px"
                          class="tw:mr-2"
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

              <!-- Name -->
              <div
                v-if="
                  (isAlerts && isPrebuiltDestination && !destination) ||
                  !isAlerts ||
                  (isAlerts && formData.destination_type === 'custom')
                "
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
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

              <!-- Prebuilt Destination Form -->
              <div
                v-if="isAlerts && (isPrebuiltDestination || (isUpdatingDestination && formData.destination_type !== 'custom'))"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
                  <PrebuiltDestinationForm
                    v-if="formData.destination_type && formData.destination_type !== 'custom'"
                    :key="`${formData.destination_type}-${isUpdatingDestination}`"
                    v-model="prebuiltCredentials"
                    :destination-type="formData.destination_type"
                    :hide-actions="true"
                    data-test="prebuilt-form"
                  />
                  <div v-else-if="isUpdatingDestination" class="text-center">
                    <q-spinner color="primary" size="40px" />
                    <div class="tw:mt-2 text-grey-7">Loading destination data...</div>
                  </div>
                </div>
              </div>

              <!-- Test Result Display -->
              <div v-if="lastTestResult" class="tw:flex tw:gap-2">
                <div class="tw:w-full">
                  <DestinationTestResult
                    :result="lastTestResult"
                    :is-loading="isTestInProgress"
                    data-test="prebuilt-test-result"
                    @retry="handleTestDestination"
                  />
                </div>
              </div>

              <!-- Tabs for custom/pipeline destinations -->
              <div
                v-if="!isAlerts || (isAlerts && formData.destination_type === 'custom')"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
                  <div class="app-tabs-container tw:h-[36px] tw:w-fit">
                    <app-tabs
                      data-test="add-destination-tabs"
                      :tabs="tabs"
                      class="tabs-selection-container"
                      v-model:active-tab="formData.type"
                    />
                  </div>
                </div>
              </div>

              <!-- No Templates Warning -->
              <div
                v-if="formData.type === 'email' && !getFormattedTemplates.length"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full tw:flex tw:items-center tw:gap-2">
                  <span class="text-subtitle2">It looks like you haven't created any Email Templates yet.</span>
                  <OButton variant="outline" size="sm" @click="createEmailTemplate">
                    Create Email Template
                  </OButton>
                </div>
              </div>

              <!-- Template field (custom alert destinations) -->
              <div
                v-if="isAlerts && formData.destination_type === 'custom'"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
                  <q-select
                    data-test="add-destination-template-select"
                    v-model="formData.template"
                    :label="t('alert_destinations.template') + ' *'"
                    :options="getFormattedTemplates"
                    class="no-border showLabelOnTop no-case"
                    stack-label
                    borderless
                    hide-bottom-space
                    dense
                    flat
                    tabindex="0"
                    :rules="[(val: any) => !!val || 'Template is required!']"
                  />
                </div>
              </div>

              <!-- HTTP Fields -->
              <template
                v-if="
                  (isAlerts && formData.destination_type === 'custom' && formData.type === 'http') ||
                  (!isAlerts && formData.type === 'http')
                "
              >
                <div class="tw:flex tw:gap-2">
                  <div class="tw:w-full">
                    <q-input
                      data-test="add-destination-url-input"
                      v-model="formData.url"
                      :label="t('alert_destinations.url') + ' *'"
                      class="no-border showLabelOnTop"
                      borderless
                      dense
                      flat
                      hide-bottom-space
                      stack-label
                      :rules="[(val: any) => !!val.trim() || 'Field is required!']"
                      tabindex="0"
                    />
                  </div>
                </div>
                <div class="tw:flex tw:gap-2">
                  <div :class="isAlerts ? 'tw:w-full' : 'tw:w-1/2'">
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
                  <div v-if="!isAlerts" class="tw:w-1/2">
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
                      :rules="[(val: any) => !!val || 'Field is required!']"
                      tabindex="0"
                    />
                  </div>
                </div>
              </template>

              <!-- Email Fields -->
              <div
                v-if="formData.type === 'email' && (!isAlerts || formData.destination_type === 'custom')"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
                  <q-input
                    v-model="formData.emails"
                    :label="t('reports.recipients') + ' *'"
                    class="no-border showLabelOnTop"
                    borderless
                    dense
                    flat
                    hide-bottom-space
                    stack-label
                    :rules="[
                      (val: any) =>
                        /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/.test(
                          val,
                        ) || 'Add valid emails!',
                    ]"
                    tabindex="0"
                    :placeholder="t('user.inviteByEmail')"
                  />
                </div>
              </div>

              <!-- Action Fields -->
              <div
                v-if="formData.type === 'action' && (!isAlerts || formData.destination_type === 'custom')"
                class="tw:flex tw:gap-2"
              >
                <div class="tw:w-full">
                  <q-select
                    data-test="add-destination-action-select"
                    v-model="formData.action_id"
                    :label="t('alert_destinations.action') + ' *'"
                    :options="filteredActions"
                    class="no-border showLabelOnTop no-case"
                    map-options
                    emit-value
                    borderless
                    dense
                    flat
                    hide-bottom-space
                    stack-label
                    use-input
                    :loading="isLoadingActions"
                    :rules="[(val: any) => !!val || 'Field is required!']"
                    tabindex="0"
                    @filter="filterActions"
                  />
                </div>
              </div>
            </div>

            <!-- Headers -->
            <div class="tw:flex tw:gap-2 tw:mt-4">
                <div class="tw:w-full">
                  <div class="tw:text-[14px] tw:font-bold header-label">
                    Headers
                  </div>
                </div>
              </div>
              <div
                v-for="(header, index) in apiHeaders"
                :key="header.uuid"
                class="tw:flex tw:gap-2 tw:mb-2"
              >
                <div class="tw:w-5/12">
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
                <div class="tw:w-5/12">
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
                <div class="tw:w-1/6 headers-btns">
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

            <!-- Skip TLS Verify Toggle -->
            <div class="tw:flex tw:gap-2 tw:mt-2">
              <div class="tw:w-full tw:inline-flex">
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

        <!-- Form buttons footer (sticky bottom, full width) -->
        <div
          class="form-footer tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2.5 tw:shrink-0 tw:gap-2"
          style="flex-shrink: 0; border-top: 1px solid var(--o2-border-color);"
        >
              <div
                v-if="
                  isAlerts &&
                  (isPrebuiltDestination ||
                    (isUpdatingDestination && formData.destination_type !== 'custom'))
                "
                class="tw:flex tw:items-center tw:gap-2"
              >
                <OButton
                  data-test="destination-preview-button"
                  variant="outline"
                  size="sm-action"
                  @click="showPreview"
                >
                  <template #icon-left><q-icon name="preview" /></template>
                  {{ t("alert_destinations.preview") }}
                </OButton>
                <OButton
                  data-test="destination-test-button"
                  :loading="isTestInProgress"
                  variant="outline"
                  size="sm-action"
                  @click="handleTestDestination"
                >
                  <template #icon-left><q-icon name="send" /></template>
                  {{ t("alert_destinations.test") }}
                </OButton>
              </div>
              <div v-else></div>
              <div class="tw:flex tw:items-center tw:gap-2">
                <OButton
                  data-test="add-destination-cancel-btn"
                  v-close-popup="true"
                  variant="outline"
                  size="sm-action"
                  @click="$emit('cancel:hideform')"
                >
                  {{ t("alerts.cancel") }}
                </OButton>
                <OButton
                  data-test="add-destination-submit-btn"
                  variant="primary"
                  size="sm-action"
                  @click="saveDestination"
                >
                  {{ t("alerts.save") }}
                </OButton>
              </div>
            </div>
          </q-form>
        </div>
      </div>

      <!-- Destination Preview Modal -->
        <DestinationPreview
          v-model="showPreviewModal"
          :type="formData.destination_type"
          :template-content="previewContent"
          data-test="destination-preview-modal"
        />
      </q-page>
    </template>
<script lang="ts" setup>
import {
  ref,
  computed,
  onBeforeMount,
  onActivated,
  watch,
  nextTick,
} from "vue";
import type { Ref, PropType } from "vue";
import { useI18n } from "vue-i18n";
import destinationService from "@/services/alert_destination";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import type {
  Template,
  DestinationData,
  Headers,
  DestinationPayload,
} from "@/ts/interfaces";
import { useRouter } from "vue-router";
import { isValidResourceName } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import { Webhook, Mail, Zap, Trash2, Plus } from "lucide-vue-next";
import config from "@/aws-exports";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import { isPrebuiltType } from "@/utils/prebuilt-templates";
import PrebuiltDestinationForm from "./PrebuiltDestinationForm.vue";
import DestinationTestResult from "./DestinationTestResult.vue";
import DestinationPreview from "./DestinationPreview.vue";

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
const q = useQuasar();
const apiMethods = ["get", "post", "put"];
const outputFormats = ["json", "ndjson"];
const store = useStore();
const { t } = useI18n();
const { track } = useReo();
const destinationForm = ref<{ submit: () => void } | null>(null);

const formData: Ref<DestinationData> = ref({
  name: "",
  url: "",
  method: "post",
  skip_tls_verify: false,
  template: "",
  headers: {},
  emails: "",
  type: "http",
  action_id: "",
  output_format: "json",
  destination_type: "slack", // For prebuilt destinations
});
const isUpdatingDestination = ref(false);

const isLoadingActions = ref(false);

const router = useRouter();

const actionOptions = ref<{ value: string; label: string; type: string }[]>([]);

const filteredActions = ref<any[]>([]);

const { getAllActions } = useActions();

// Prebuilt destinations composable
const {
  availableTypes,
  popularTypes,
  validateCredentials,
  testDestination,
  createDestination,
  updateDestination,
  generatePreview,
  isTestInProgress,
  lastTestResult,
  detectPrebuiltType,
} = usePrebuiltDestinations();

// Prebuilt destinations state
const prebuiltCredentials = ref<Record<string, any>>({});
const showPreviewModal = ref(false);
const previewContent = ref("");

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

const tabs = computed(() => {
  // In edit mode for custom destinations, only show the tab for the current type
  if (
    isUpdatingDestination.value &&
    formData.value.destination_type === "custom"
  ) {
    const currentType = formData.value.type;

    // Only return the tab matching the current destination type
    if (currentType === "http") {
      return [{ label: t("alerts.webhook"), value: "http", icon: Webhook }];
    } else if (currentType === "email") {
      return [{ label: t("alerts.email"), value: "email", icon: Mail }];
    } else if (currentType === "action") {
      return [{ label: t("alerts.action"), value: "action", icon: Zap }];
    }
  }

  // In create mode, show all tabs
  const tabs = [
    { label: t("alerts.webhook"), value: "http", icon: Webhook },
    { label: t("alerts.email"), value: "email", icon: Mail },
  ];

  if (
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    store.state.zoConfig.actions_enabled
  ) {
    tabs.push({ label: t("alerts.action"), value: "action", icon: Zap });
  }

  return tabs;
});

// Destination types for alerts (prebuilt + custom)
const destinationTypes = computed(() => {
  if (!props.isAlerts) return [];

  const prebuiltTypes = availableTypes.value.map((type) => ({
    value: type.id,
    label: type.name,
    image: type.image,
    icon: type.icon,
    description: type.description,
  }));

  // Add custom option
  prebuiltTypes.push({
    value: "custom",
    label: "Custom",
    image: undefined as any,
    icon: "settings",
    description: "Create custom webhook destination",
  });

  return prebuiltTypes;
});

// Check if current destination type is prebuilt
const isPrebuiltDestination = computed(() => {
  return (
    formData.value.destination_type &&
    formData.value.destination_type !== "custom"
  );
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
    formData.value.name = props.destination.name;
    formData.value.url = props.destination.url;
    formData.value.method = props.destination.method;
    formData.value.skip_tls_verify = props.destination.skip_tls_verify;
    formData.value.template = props.destination.template;
    if (!props.destination.headers) formData.value.headers = {};
    formData.value.headers = props.destination.headers;
    formData.value.emails = (props.destination?.emails || []).join(", ");
    formData.value.type = props.destination.type || "http";
    formData.value.action_id = props.destination.action_id || "";

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
      formData.value.destination_type = parsedMetadata.prebuilt_type;
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
        formData.value.destination_type = "email";
      } else if (props.destination.type === "http" && props.destination.url) {
        // Check if URL matches known prebuilt patterns
        const detectedType = detectPrebuiltType(props.destination);
        if (detectedType) {
          formData.value.destination_type = detectedType;
        } else {
          // Has system template but URL doesn't match prebuilt patterns - it's custom
          formData.value.destination_type = "custom";
        }
      } else {
        formData.value.destination_type = "custom";
      }
    }
    // Priority 3: Check if template starts with 'prebuilt_' (user templates)
    else if (props.destination.template?.startsWith("prebuilt_")) {
      const extractedType = props.destination.template.replace("prebuilt_", "");
      formData.value.destination_type = isPrebuiltType(extractedType)
        ? extractedType
        : "custom";
    }
    // Priority 4: Check if template includes 'prebuilt' (legacy format)
    else if (props.destination.template?.includes("prebuilt")) {
      const parts = props.destination.template.split("-");
      const extractedType = parts[parts.length - 1];
      formData.value.destination_type = isPrebuiltType(extractedType)
        ? extractedType
        : "custom";
    }
    // Priority 5: Fallback to URL-based detection (for destinations created before metadata was added)
    else if (props.destination.url) {
      const detectedType = detectPrebuiltType(props.destination);
      if (detectedType) {
        formData.value.destination_type = detectedType;
      } else {
        formData.value.destination_type = "custom";
      }
    }
    // Priority 6: No indicators - this is a custom destination
    else {
      formData.value.destination_type = "custom";
    }

    // Continue with credential restoration if we have a destination_type
    if (
      formData.value.destination_type &&
      formData.value.destination_type !== "custom"
    ) {
      const typeId = formData.value.destination_type;

      // Restore prebuilt credentials from metadata and destination fields
      const credentials: Record<string, any> = {};

      // Step 1: Parse metadata and remove credential_ prefix
      if (props.destination.metadata) {
        try {
          const metadata =
            typeof props.destination.metadata === "string"
              ? JSON.parse(props.destination.metadata)
              : props.destination.metadata;

          // Extract credential fields (remove credential_ prefix)
          Object.entries(metadata).forEach(([key, value]) => {
            if (key.startsWith("credential_")) {
              const credentialKey = key.replace("credential_", "");
              credentials[credentialKey] = value;
            }
          });
        } catch (e) {
          console.error("Failed to parse destination metadata:", e);
        }
      }

      // Step 2: Restore sensitive fields from destination properties
      // webhookUrl is stored in the url field for webhook-based destinations
      if (props.destination.url) {
        credentials.webhookUrl = props.destination.url;
      }

      // For ServiceNow, instanceUrl is the base URL
      if (typeId === "servicenow" && props.destination.url) {
        credentials.instanceUrl = props.destination.url;
      }

      // For email destinations, recipients are in emails field
      if (typeId === "email" && props.destination.emails) {
        credentials.recipients = Array.isArray(props.destination.emails)
          ? props.destination.emails.join(", ")
          : props.destination.emails;
      }

      // For PagerDuty, integrationKey is in headers (if present)
      if (
        typeId === "pagerduty" &&
        props.destination.headers?.["X-Routing-Key"]
      ) {
        credentials.integrationKey = props.destination.headers["X-Routing-Key"];
      }

      // For Opsgenie, apiKey is in Authorization header
      if (
        typeId === "opsgenie" &&
        props.destination.headers?.["Authorization"]
      ) {
        const authHeader = props.destination.headers["Authorization"];
        if (authHeader.startsWith("GenieKey ")) {
          credentials.apiKey = authHeader.replace("GenieKey ", "");
        }
      }

      // Note: Non-sensitive fields (severity, priority, assignmentGroup, ccRecipients, subject, username, etc.)
      // are automatically restored from metadata via Step 1 (credential_ prefix removal)
      // Sensitive fields containing "password", "key", or "token" are NOT saved to metadata for security

      prebuiltCredentials.value = credentials;
    }

    if (Object.keys(formData.value?.headers || {}).length) {
      // Filter out system/prebuilt headers - only load custom headers into the UI
      const systemHeaders = ["Content-Type", "Authorization", "X-Routing-Key"];
      const customHeadersOnly = Object.entries(
        formData.value?.headers || {},
      ).filter(([key]) => !systemHeaders.includes(key));

      if (customHeadersOnly.length > 0) {
        apiHeaders.value = [];
        customHeadersOnly.forEach(([key, value]) => {
          addApiHeader(key, value);
        });
      }
    }
    if (props.destination.output_format) {
      formData.value.output_format = props.destination.output_format;
    }
  }
};

const getFormattedTemplates = computed(() =>
  props.templates
    .filter((template: any) => {
      if (formData.value.type === "email" && template.type === "email")
        return true;
      else if (formData.value.type !== "email") return true;
    })
    .map((template: any) => template.name),
);

const isValidDestination = computed(
  () =>
    formData.value.name &&
    ((formData.value.url &&
      formData.value.method &&
      formData.value.type === "http") ||
      (formData.value.type === "email" && formData.value?.emails?.length) ||
      (formData.value.type === "action" && formData.value?.action_id?.length) ||
      (!props.isAlerts && formData.value.url && formData?.value?.method)) &&
    (props.isAlerts ? formData.value.template : true),
);

const connectionNotes = computed(() => {
  const destType = formData.value.destination_type;
  const isCustom = !destType || destType === "custom";
  const formType = formData.value.type;

  if (props.isAlerts && !isCustom) {
    const notes: Record<string, { title: string; steps: string[]; example?: string }> = {
      slack: {
        title: "Slack Connection Details",
        steps: [
          "Go to your Slack workspace and navigate to Apps",
          "Search for 'Incoming Webhooks' and add it to Slack",
          "Select a channel where notifications will be posted",
          "Copy the generated Webhook URL",
          "Paste the Webhook URL in the form on the left",
        ],
        example: "https://hooks.slack.com/services/...",
      },
      discord: {
        title: "Discord Connection Details",
        steps: [
          "Open your Discord server settings",
          "Go to Integrations → Webhooks → New Webhook",
          "Name your webhook and select the target channel",
          "Copy the Webhook URL",
          "Paste the Webhook URL in the form on the left",
        ],
        example: "https://discord.com/api/webhooks/...",
      },
      msteams: {
        title: "Microsoft Teams Connection Details",
        steps: [
          "Open your Teams channel and click the '...' menu",
          "Select 'Connectors' and search for 'Incoming Webhook'",
          "Click 'Configure' and give your webhook a name",
          "Copy the generated Webhook URL",
          "Paste the Webhook URL in the form on the left",
        ],
        example: "https://*.webhook.office.com/...",
      },
      pagerduty: {
        title: "PagerDuty Connection Details",
        steps: [
          "Log in to your PagerDuty account",
          "Navigate to Services → Service Directory",
          "Select your service and go to the Integrations tab",
          "Create a new integration with 'Events API v2'",
          "Copy the Integration Key",
          "Paste the Integration Key in the form on the left",
        ],
        example: "Events API v2 integration type",
      },
      opsgenie: {
        title: "Opsgenie Connection Details",
        steps: [
          "Log in to your Opsgenie account",
          "Go to Settings → Integrations → Add Integration",
          "Search for and select 'API' integration",
          "Copy the API Key",
          "Paste the API Key in the form on the left",
        ],
        example: "API integration with Create and Read access",
      },
      servicenow: {
        title: "ServiceNow Connection Details",
        steps: [
          "Log in to your ServiceNow instance",
          "Navigate to System Web Services → REST API Explorer",
          "Note your instance URL (e.g., https://dev123456.service-now.com)",
          "Create credentials with access to create incidents",
          "Enter the instance URL, username, and password in the form",
        ],
        example: "https://dev123456.service-now.com",
      },
      email: {
        title: "Email Destination Details",
        steps: [
          "Enter the recipient email addresses (comma-separated)",
          "Select an email template from the template dropdown",
          "Configure any additional CC recipients if needed",
          "Add a descriptive subject line for your alerts",
        ],
        example: "user@example.com, admin@example.com",
      },
    };
    return notes[destType] || { title: "Connection Details", steps: ["Configure the destination using the form on the left."] };
  }

  if (formType === "email") {
    return {
      title: "Email Destination Details",
      steps: [
        "Enter recipient email addresses separated by commas or semicolons",
        "Select an email template to format your alert messages",
        "Make sure the template type matches 'email' in the alert template settings",
        "Test the destination before saving to verify email delivery",
      ],
      example: "user@example.com, admin@example.com",
    };
  }

  if (formType === "action") {
    return {
      title: "Action Destination Details",
      steps: [
        "Select a pre-configured action from the dropdown",
        "Actions are defined in the Actions management section",
        "Ensure the action has the appropriate permissions and endpoints configured",
        "The action will be triggered when alert conditions are met",
      ],
      example: "Settings → Actions → Create New Action",
    };
  }

  return {
    title: "Webhook Destination Details",
    steps: [
      "Enter the full URL of your webhook endpoint",
      "Select the HTTP method (POST is most common)",
      "Choose the output format (JSON or NDJSON)",
      "Add any required authentication headers (e.g., Authorization, API Key)",
      "Optionally configure a custom template for the request body",
      "Toggle 'Skip TLS Verify' only for self-signed certificates in testing",
    ],
    example: "https://your-webhook.example.com/endpoint",
  };
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
  filteredActions.value = actionOptions.value;
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

// Select destination type (prebuilt or custom)
const selectDestinationType = (type: string) => {
  formData.value.destination_type = type;

  // Reset form data when switching types
  prebuiltCredentials.value = {};

  if (type === "custom") {
    // Switch to custom mode
    formData.value.type = "http";
    formData.value.url = "";
    formData.value.template = "";
  } else {
    // Set up prebuilt type
    formData.value.type = type === "email" ? "email" : "http";
  }
};

// Handle prebuilt destination test
const handleTestDestination = async () => {
  if (!isPrebuiltDestination.value) return;

  try {
    await testDestination(
      formData.value.destination_type,
      prebuiltCredentials.value,
    );
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
    const preview = await generatePreview(
      formData.value.destination_type,
      prebuiltCredentials.value,
    );
    previewContent.value = preview;

    // Only show modal after content is ready
    showPreviewModal.value = true;
  } catch (error) {
    console.error("Failed to generate preview:", error);
    q.notify({
      type: "negative",
      message: "Failed to generate preview",
      timeout: 2000,
    });
  }
};

// Save prebuilt or custom destination
const saveDestination = async () => {
  // Handle prebuilt destinations (both create and update)
  if (isPrebuiltDestination.value) {
    try {
      // Build custom headers object from apiHeaders array
      const customHeaders: Headers = {};
      apiHeaders.value.forEach((header) => {
        if (header["key"] && header["value"]) {
          customHeaders[header.key] = header.value;
        }
      });

      if (isUpdatingDestination.value) {
        // Update existing prebuilt destination
        await updateDestination(
          formData.value.destination_type,
          props.destination.name, // original name
          formData.value.name, // potentially new name
          prebuiltCredentials.value,
          customHeaders, // custom headers
          formData.value.skip_tls_verify || false, // skipTlsVerify
        );
      } else {
        // Create new prebuilt destination
        await createDestination(
          formData.value.destination_type,
          formData.value.name,
          prebuiltCredentials.value,
          customHeaders, // custom headers
          formData.value.skip_tls_verify || false, // skipTlsVerify
        );
      }

      emit("get:destinations");
      emit("cancel:hideform");
      return;
    } catch (error) {
      console.error("Failed to save prebuilt destination:", error);
      return;
    }
  }

  // Handle custom destinations (existing logic)
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
    template: props.isAlerts ? formData.value.template : "",
    headers: headers,
    name: formData.value.name,
  };

  if (!props.isAlerts) {
    payload["output_format"] = formData.value.output_format;
  }

  if (formData.value.type === "email") {
    payload["type"] = "email";
    payload["emails"] = (formData.value?.emails || "")
      .split(/[;,]/)
      .map((email: string) => email.trim());
  }

  if (formData.value.type === "action") {
    payload["type"] = "action";
    payload["action_id"] = formData.value.action_id;
  }

  // if (!props.isAlerts) {
  //   payload["type"] = "remote_pipeline";
  // }

  if (isUpdatingDestination.value) {
    destinationService
      .update({
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
    track("Button Click", {
      button: "Update Destination",
      page: "Add Destination",
    });
  } else {
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
    track("Button Click", {
      button: "Create Destination",
      page: "Add Destination",
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

const filterColumns = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
    return filteredOptions;
  }
  update(() => {
    const value = val?.toLowerCase();
    filteredOptions = options.filter((column: any) => {
      if (typeof column === "string")
        return column?.toLowerCase().indexOf(value) > -1;
      else {
        return column?.label?.toLowerCase().indexOf(value) > -1;
      }
    });
  });
  return filteredOptions;
};

const filterActions = (val: string, update: any) => {
  filteredActions.value = filterColumns(actionOptions.value, val, update);
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

// Side panel sticky wrapper
.side-panel {
  position: sticky;
  top: 0;
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
.destination-method-select {
  .q-field__native > :first-child {
    text-transform: uppercase !important;
  }
}

.no-case .q-field__native span {
  text-transform: none !important;
}

.option-image {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.add-destination-form {
  .q-select__dropdown-icon {
    font-size: 20px;
  }

  .dest-option-item {
    padding-top: 16px;
    padding-bottom: 16px;
  }

  .q-field--labeled.showLabelOnTop .q-field__bottom {
    padding: 0.275rem 0 0 !important;
  }

  .q-field--labeled.showLabelOnTop {
    padding-top: 24px;
  }
}

.showLabelOnTop {
  :deep(.q-field__prepend) {
    padding-right: 8px;
  }
}
</style>
