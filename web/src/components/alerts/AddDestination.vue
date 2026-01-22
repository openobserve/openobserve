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
 <q-page class="q-pa-none o2-custom-bg" style="height: calc(100vh - 48px); min-height: inherit; display: flex; flex-direction: column;" >
      <div class="row items-center no-wrap card-container q-px-md tw:mb-[0.675rem]" style="flex-shrink: 0;">
        <div class="flex items-center tw:h-[60px]">
          <div
            no-caps
            padding="xs"
            outline
            icon="arrow_back_ios_new"
            class="el-border tw:w-6 tw:h-6 flex items-center justify-center cursor-pointer el-border-radius q-mr-sm"
            title="Go Back"
            @click="$emit('cancel:hideform')"
          >
            <q-icon name="arrow_back_ios_new" size="14px" />
          </div>
          <div class="col" data-test="add-destination-title">
            <div v-if="destination" class="text-h6">
              {{ t("alert_destinations.updateTitle") }}
            </div>
            <div v-else class="text-h6">
              {{ t("alert_destinations.addTitle") }}
            </div>
          </div>
        </div>
      </div>
      <div class="card-container tw:py-2" style="flex: 1; overflow-y: auto; overflow-x: hidden;">
        <div>
       <div class="row q-col-gutter-sm q-px-md q-mt-sm q-mb-xs">
        <!-- Destination Type Selection for Alerts (only show in create mode, not edit) -->
        <div v-if="isAlerts && !destination" class="col-12 q-pb-md">
          <div class="text-subtitle2 q-mb-sm">{{ t('alert_destinations.destination_type') }}</div>
          <PrebuiltDestinationSelector
            v-model="formData.destination_type"
            :search-query="destinationSearchQuery"
            data-test="prebuilt-destination-selector"
            @select="selectDestinationType"
            @update:search-query="destinationSearchQuery = $event"
          />
        </div>

        <!-- Destination Type and Name Display for Edit Mode -->
        <div v-if="isAlerts && destination && formData.destination_type" class="col-12 q-pb-md">
          <div class="row q-col-gutter-md">
            <!-- Destination Type (Read-only) -->
            <div class="col-6">
              <div class="text-subtitle2 q-mb-xs">{{ t('alert_destinations.destination_type') }}</div>
              <div class="flex items-center q-pa-sm el-border el-border-radius" data-test="destination-type-readonly">
                <q-icon :name="getDestinationTypeIcon(formData.destination_type)" size="20px" class="q-mr-sm" />
                <span class="text-body2">{{ getDestinationTypeName(formData.destination_type) }}</span>
                <q-chip size="sm" color="grey-3" text-color="grey-8" class="q-ml-sm">{{ t('alert_destinations.readonly') }}</q-chip>
              </div>
            </div>
            <!-- Destination Name (Read-only) -->
            <div class="col-6">
              <q-input
                data-test="add-destination-name-input"
                v-model="formData.name"
                :label="t('alerts.name') + ' *'"
                class="showLabelOnTop"
                stack-label
                borderless
                dense
                readonly
                disable
                :rules="[
                  (val: any) =>
                    !!val
                      ? isValidResourceName(val) ||
                        `Characters like :, ?, /, #, and spaces are not allowed.`
                      : t('common.nameRequired'),
                ]"
                tabindex="0"
                hide-bottom-space
              />
            </div>
          </div>
        </div>

        <!-- Prebuilt Destination Form (for alerts only) -->
        <!-- Show for: create mode with destination_type selected OR edit mode (while loading) -->
        <div v-if="isAlerts && (isPrebuiltDestination || isUpdatingDestination)" class="col-12">
          <!-- Name Field for Create Mode -->
          <div v-if="!destination" class="col-12 q-pb-md">
            <q-input
              data-test="add-destination-name-input"
              v-model="formData.name"
              :label="t('alerts.name') + ' *'"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              :rules="[
                (val: any) =>
                  !!val
                    ? isValidResourceName(val) ||
                      `Characters like :, ?, /, #, and spaces are not allowed.`
                    : t('common.nameRequired'),
              ]"
              tabindex="0"
              hide-bottom-space
            />
          </div>

          <PrebuiltDestinationForm
            v-if="formData.destination_type && formData.destination_type !== 'custom'"
            :key="`${formData.destination_type}-${isUpdatingDestination}-${Object.keys(prebuiltCredentials).length}`"
            v-model="prebuiltCredentials"
            :destination-type="formData.destination_type"
            :hide-actions="true"
            data-test="prebuilt-form"
          />
          <div v-else-if="isUpdatingDestination" class="q-pa-md text-center">
            <q-spinner color="primary" size="40px" />
            <div class="q-mt-sm text-grey-7">Loading destination data...</div>
          </div>

          <!-- Additional Settings for Prebuilt Destinations -->
          <div class="col-12 q-mt-md">
            <div class="text-bold q-py-xs">
              {{ t('alert_destinations.additional_settings') }}
            </div>

            <!-- Custom Headers -->
            <div class="q-py-sm">
              <div class="text-subtitle2 q-pb-xs">
                {{ t('alert_destinations.custom_headers') }}
              </div>
              <div
                v-for="(header, index) in apiHeaders"
                :key="header.uuid"
                class="row q-col-gutter-sm q-pb-sm"
              >
                <div class="col-5 q-ml-none">
                  <q-input
                    :data-test="`add-destination-header-${header['key']}-key-input`"
                    v-model="header.key"
                    stack-label
                    borderless
                    hide-bottom-space
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
                    stack-label
                    borderless
                    hide-bottom-space
                    dense
                    tabindex="0"
                  />
                </div>
                <div class="col-2 q-ml-none">
                  <q-btn
                    :data-test="`add-destination-header-${header['key']}-delete-btn`"
                    icon="delete"
                    class="q-ml-xs iconHoverBtn"
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

            <!-- Skip TLS Verify Toggle -->
            <div class="q-py-sm">
              <q-toggle
                data-test="add-destination-skip-tls-verify-toggle"
                class="o2-toggle-button-lg"
                size="lg"
                v-model="formData.skip_tls_verify"
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

        <!-- Legacy tabs for non-alert destinations -->
        <div v-if="!isAlerts" class="col-12 q-pb-md">
         <div class="app-tabs-container tw:h-[36px] q-mr-sm tw:w-fit">
          <app-tabs
            data-test="add-destination-tabs"
            :tabs="tabs"
            class="tabs-selection-container"
            v-model:active-tab="formData.type"
          />
          </div>
        </div>
        <div
          v-if="formData.type === 'email' && !getFormattedTemplates.length"
          class="flex items-center col-12 q-mb-md"
        >
          <div class="text-subtitle2 q-mr-sm">
            It looks like you haven't created any Email Templates yet.
          </div>
          <q-btn
            label="Create Email Template"
            size="sm"
            no-caps
            class="o2-secondary-button"
            style="border-radius: 4px; font-size: 12px"
            @click="createEmailTemplate"
          />
        </div>
        <!-- Name field for custom destinations or pipelines (not prebuilt) -->
        <div
          v-if="!isAlerts || (isAlerts && formData.destination_type === 'custom')"
          class="q-py-xs"
          :class="{ 'col-6': isAlerts, 'col-12': !isAlerts }"
        >
          <q-input
            data-test="add-destination-name-input"
            v-model="formData.name"
            :label="t('alerts.name') + ' *'"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            :rules="[
              (val: any) =>
                !!val
                  ? isValidResourceName(val) ||
                    `Characters like :, ?, /, #, and spaces are not allowed.`
                  : t('common.nameRequired'),
            ]"
            tabindex="0"
            hide-bottom-space
          />
        </div>
        <!-- Template field only for custom alert destinations -->
        <div v-if="isAlerts && formData.destination_type === 'custom'" class="col-6 row q-py-xs">
          <div class="col-12">
            <q-select
              data-test="add-destination-template-select"
              v-model="formData.template"
              :label="t('alert_destinations.template')"
              :options="getFormattedTemplates"
              class="showLabelOnTop no-case"
              stack-label
              borderless
              hide-bottom-space
              dense
              clearable
              tabindex="0"
            >
              <template v-slot:hint>
                <span class="text-caption text-grey-7">
                  Optional - can be set at alert level instead
                </span>
              </template>
            </q-select>
          </div>
        </div>

        <template
          v-if="((isAlerts && formData.destination_type === 'custom') || isAlerts == false)"
        >
          <div class="col-6 q-py-xs">
            <q-input
              data-test="add-destination-url-input"
              v-model="formData.url"
              :label="t('alert_destinations.url') + ' *'"
              class="showLabelOnTop"
              stack-label
              borderless
              hide-bottom-space
              dense
              :rules="[(val: any) => !!val.trim() || 'Field is required!']"
              tabindex="0"
            />
          </div>
          <div  class=" q-py-xs destination-method-select"
          :class="{ 'col-3': !isAlerts, 'col-6': isAlerts }"
          >
            <q-select
              data-test="add-destination-method-select"
              v-model="formData.method"
              :label="t('alert_destinations.method') + ' *'"
              :options="apiMethods"
              class="showLabelOnTop"
              stack-label
                            dense

              borderless
              hide-bottom-space
              :popup-content-style="{ textTransform: 'uppercase' }"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />
            
          </div>
          <div v-if="!isAlerts" class="col-3 q-py-xs destination-method-select">
            <q-select
              data-test="add-destination-output-format-select"
              v-model="formData.output_format"
              :label="t('alert_destinations.output_format') + ' *'"
              :options="outputFormats"
              class="showLabelOnTop"
              stack-label
              borderless
              hide-bottom-space
              :popup-content-style="{ textTransform: 'uppercase' }"
              dense
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
            />
            
          </div>
          <div class="col-12 q-py-sm">
            <div class="text-bold q-py-xs">
              Headers
            </div>
            <div
              v-for="(header, index) in apiHeaders"
              :key="header.uuid"
              class="row q-col-gutter-sm q-pb-sm"
            >
              <div class="col-5 q-ml-none">
                <q-input
                  :data-test="`add-destination-header-${header['key']}-key-input`"
                  v-model="header.key"
                  stack-label
                  borderless
                  hide-bottom-space
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
                  stack-label
                  borderless
                  hide-bottom-space
                  dense
                  isUpdatingDestination
                  tabindex="0"
                />
              </div>
              <div class="col-2 q-ml-none">
                <q-btn
                  :data-test="`add-destination-header-${header['key']}-delete-btn`"
                  icon="delete"
                  class="q-ml-xs iconHoverBtn"
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
          <div class="col-12 q-py-sm">
              <q-toggle
                data-test="add-destination-skip-tls-verify-toggle"
                class="o2-toggle-button-lg"
                size="lg"
                v-model="formData.skip_tls_verify"
                :label="t('alert_destinations.skip_tls_verify')"
              />
          </div>
        </template>
        <template v-if="formData.type === 'email' && (!isAlerts || formData.destination_type === 'custom')">
          <q-input
            v-model="formData.emails"
            :label="t('reports.recipients') + ' *'"
            class="showLabelOnTop"
            stack-label
            borderless
            dense
            :rules="[
              (val: any) =>
                /^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\s*[;,]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))*$/.test(
                  val,
                ) || 'Add valid emails!',
            ]"
            tabindex="0"
            style="width: 100%"
            :placeholder="t('user.inviteByEmail')"
          />
        </template>

        <template v-if="formData.type === 'action' && (!isAlerts || formData.destination_type === 'custom')">
          <div class="col-6 q-py-xs action-select">
            <q-select
              data-test="add-destination-action-select"
              v-model="formData.action_id"
              :label="t('alert_destinations.action') + ' *'"
              :options="filteredActions"
              class="showLabelOnTop no-case"
              map-options
              emit-value
              stack-label
              borderless
              dense
              use-input
              :loading="isLoadingActions"
              :rules="[(val: any) => !!val || 'Field is required!']"
              tabindex="0"
              @filter="filterActions"
            />
          </div>
        </template>
      </div>
    </div>
    <div class="flex justify-between q-px-lg q-py-lg full-width">
      <!-- Left side: Test and Preview buttons (only for prebuilt destinations) -->
      <div v-if="isAlerts && (isPrebuiltDestination || isUpdatingDestination)" class="flex items-center tw:gap-2">
        <q-btn
          data-test="destination-preview-button"
          :label="t('alert_destinations.preview')"
          icon="preview"
          outline
          no-caps
          class="tw:h-[36px] tw:mr-2"
          @click="showPreview"
        />
        <q-btn
          data-test="destination-test-button"
          :loading="isTestInProgress"
          :label="t('alert_destinations.test')"
          icon="send"
          outline
          no-caps
          class="tw:h-[36px]"
          @click="handleTestDestination"
        />
      </div>
      <div v-else></div>

      <!-- Right side: Cancel and Save buttons -->
      <div class="flex items-center tw:gap-2">
        <q-btn
          data-test="add-destination-cancel-btn"
          v-close-popup="true"
          class="o2-secondary-button tw:h-[36px]"
          :label="t('alerts.cancel')"
          no-caps
          flat
          @click="$emit('cancel:hideform')"
        />
        <q-btn
          data-test="add-destination-submit-btn"
          class="o2-primary-button no-border tw:h-[36px]"
          :label="t('alerts.save')"
          type="submit"
          no-caps
          flat
          @click="saveDestination"
        />
      </div>
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
import type {
  Template,
  DestinationData,
  Headers,
  DestinationPayload,
} from "@/ts/interfaces";
import { useRouter } from "vue-router";
import { isValidResourceName } from "@/utils/zincutils";
import AppTabs from "@/components/common/AppTabs.vue";
import config from "@/aws-exports";
import useActions from "@/composables/useActions";
import { useReo } from "@/services/reodotdev_analytics";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import PrebuiltDestinationForm from "./PrebuiltDestinationForm.vue";
import PrebuiltDestinationSelector from "./PrebuiltDestinationSelector.vue";
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
  destination_type: "", // For prebuilt destinations
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
  lastTestResult
} = usePrebuiltDestinations();

// Prebuilt destinations state
const prebuiltCredentials = ref<Record<string, any>>({});
const destinationSearchQuery = ref('');
const showPreviewModal = ref(false);
const previewContent = ref('');

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
  let tabs = [
    {
      label: t("alerts.webhook"),
      value: "http",
      style: {
        width: "fit-content",
        padding: "4px 14px",
        background: formData.value.type === "http" ? "#5960B2" : "",
        border: "none !important",
        color: formData.value.type === "http" ? "#ffffff !important" : "",
      },
    },
    {
      label: t("alerts.email"),
      value: "email",
      style: {
        width: "fit-content",
        padding: "4px 14px",
        background: formData.value.type === "email" ? "#5960B2" : "",
        border: "none !important",
        color: formData.value.type === "email" ? "#ffffff !important" : "",
      },
    },
  ];

  if (
    (config.isEnterprise == "true" || config.isCloud == "true") &&
    store.state.zoConfig.actions_enabled
  ) {
    tabs.push({
      label: t("alerts.action"),
      value: "action",
      style: {
        width: "fit-content",
        padding: "4px 14px",
        background: formData.value.type === "action" ? "#5960B2" : "",
        border: "none !important",
        color: formData.value.type === "action" ? "#ffffff !important" : "",
      },
    });
  }

  return tabs;
});

// Destination types for alerts (prebuilt + custom)
const destinationTypes = computed(() => {
  if (!props.isAlerts) return [];

  const prebuiltTypes = availableTypes.value.map(type => ({
    value: type.id,
    label: type.name,
    image: `/src/assets/images/destinations/${type.icon}.png`,
    icon: type.icon,
    description: type.description
  }));

  // Add custom option
  prebuiltTypes.push({
    value: 'custom',
    label: 'Custom',
    image: null,
    icon: 'webhook',
    description: 'Create custom webhook destination'
  });

  return prebuiltTypes;
});

// Check if current destination type is prebuilt
const isPrebuiltDestination = computed(() => {
  return formData.value.destination_type && formData.value.destination_type !== 'custom';
});

// Helper methods for displaying destination type in edit mode
const getDestinationTypeName = (typeId: string) => {
  const type = availableTypes.value.find(t => t.id === typeId);
  return type ? type.name : typeId;
};

const getDestinationTypeIcon = (typeId: string) => {
  const iconMap: Record<string, string> = {
    slack: 'chat',
    discord: 'forum',
    msteams: 'groups',
    email: 'email',
    pagerduty: 'warning',
    opsgenie: 'notifications_active',
    servicenow: 'support_agent',
    custom: 'settings'
  };
  return iconMap[typeId] || 'webhook';
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
  { deep: true }
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
    if (props.destination.template?.includes('prebuilt')) {
      const parts = props.destination.template.split('-');
      const typeId = parts[parts.length - 1]; // system-prebuilt-discord -> discord
      formData.value.destination_type = typeId;
    } else {
      // Fallback: Template missing or doesn't include 'prebuilt' - detect from other fields

      // FALLBACK: Detect destination type from URL patterns or metadata
      let detectedType: string | null = null;

      // Check URL patterns
      if (props.destination.url) {
        try {
          const parsedUrl = new URL(props.destination.url);
          const hostname = parsedUrl.hostname.toLowerCase();

          if (hostname === 'hooks.slack.com' || hostname.endsWith('.hooks.slack.com')) {
            detectedType = 'slack';
          } else if ((hostname === 'discord.com' || hostname.endsWith('.discord.com')) && parsedUrl.pathname.startsWith('/api/webhooks')) {
            detectedType = 'discord';
          } else if (hostname === 'outlook.office.com' || hostname.endsWith('.outlook.office.com') || hostname === 'webhook.office.com' || hostname.endsWith('.webhook.office.com')) {
            detectedType = 'msteams';
          } else if (hostname === 'service-now.com' || hostname.endsWith('.service-now.com')) {
            detectedType = 'servicenow';
          } else if (hostname === 'events.pagerduty.com' || hostname.endsWith('.events.pagerduty.com')) {
            detectedType = 'pagerduty';
          } else if (hostname === 'api.opsgenie.com' || hostname === 'api.eu.opsgenie.com') {
            detectedType = 'opsgenie';
          }
        } catch {
          // Invalid URL, detectedType remains null
        }
      }

      // Check for email type
      if (!detectedType && props.destination.emails && Array.isArray(props.destination.emails) && props.destination.emails.length > 0) {
        detectedType = 'email';
      }

      // Check headers for PagerDuty or Opsgenie
      if (!detectedType && props.destination.headers) {
        if (props.destination.headers['X-Routing-Key']) {
          detectedType = 'pagerduty';
        } else if (props.destination.headers['Authorization']?.startsWith('GenieKey ')) {
          detectedType = 'opsgenie';
        }
      }

      // If we detected a type, set it
      if (detectedType) {
        formData.value.destination_type = detectedType;
      } else {
        // No prebuilt type detected - default to 'custom' for edit mode
        // This handles destinations created before prebuilt types or generic webhook destinations
        formData.value.destination_type = 'custom';
      }
    }

    // Continue with credential restoration if we have a destination_type
    if (formData.value.destination_type && formData.value.destination_type !== 'custom') {
      const typeId = formData.value.destination_type;

      // Restore prebuilt credentials from metadata and destination fields
      const credentials: Record<string, any> = {};

      // Step 1: Parse metadata and remove credential_ prefix
      if (props.destination.metadata) {
        try {
          const metadata = typeof props.destination.metadata === 'string'
            ? JSON.parse(props.destination.metadata)
            : props.destination.metadata;

          // Extract credential fields (remove credential_ prefix)
          Object.entries(metadata).forEach(([key, value]) => {
            if (key.startsWith('credential_')) {
              const credentialKey = key.replace('credential_', '');
              credentials[credentialKey] = value;
            }
          });
        } catch (e) {
          console.error('Failed to parse destination metadata:', e);
        }
      }

      // Step 2: Restore sensitive fields from destination properties
      // webhookUrl is stored in the url field for webhook-based destinations
      if (props.destination.url) {
        credentials.webhookUrl = props.destination.url;
      }

      // For ServiceNow, instanceUrl is the base URL
      if (typeId === 'servicenow' && props.destination.url) {
        credentials.instanceUrl = props.destination.url;
      }

      // For email destinations, recipients are in emails field
      if (typeId === 'email' && props.destination.emails) {
        credentials.recipients = Array.isArray(props.destination.emails)
          ? props.destination.emails.join(', ')
          : props.destination.emails;
      }

      // For PagerDuty, integrationKey is in headers (if present)
      if (typeId === 'pagerduty' && props.destination.headers?.['X-Routing-Key']) {
        credentials.integrationKey = props.destination.headers['X-Routing-Key'];
      }

      // For Opsgenie, apiKey is in Authorization header
      if (typeId === 'opsgenie' && props.destination.headers?.['Authorization']) {
        const authHeader = props.destination.headers['Authorization'];
        if (authHeader.startsWith('GenieKey ')) {
          credentials.apiKey = authHeader.replace('GenieKey ', '');
        }
      }

      // Note: Non-sensitive fields (severity, priority, assignmentGroup, ccRecipients, subject, username, etc.)
      // are automatically restored from metadata via Step 1 (credential_ prefix removal)
      // Sensitive fields containing "password", "key", or "token" are NOT saved to metadata for security

      prebuiltCredentials.value = credentials;
    }

    if (Object.keys(formData.value?.headers || {}).length) {
      // Filter out system/prebuilt headers - only load custom headers into the UI
      const systemHeaders = ['Content-Type', 'Authorization', 'X-Routing-Key'];
      const customHeadersOnly = Object.entries(formData.value?.headers || {})
        .filter(([key]) => !systemHeaders.includes(key));

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

  if (type === 'custom') {
    // Switch to custom mode
    formData.value.type = 'http';
    formData.value.url = '';
    formData.value.template = '';
  } else {
    // Set up prebuilt type
    formData.value.type = type === 'email' ? 'email' : 'http';
  }
};

// Handle prebuilt destination test
const handleTestDestination = async () => {
  if (!isPrebuiltDestination.value) return;

  try {
    await testDestination(formData.value.destination_type, prebuiltCredentials.value);
  } catch (error) {
    console.error('Test failed:', error);
  }
};

// Show template preview
const showPreview = () => {
  if (!isPrebuiltDestination.value) return;

  previewContent.value = generatePreview(formData.value.destination_type);
  showPreviewModal.value = true;
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
          formData.value.skip_tls_verify || false // skipTlsVerify
        );
      } else {
        // Create new prebuilt destination
        await createDestination(
          formData.value.destination_type,
          formData.value.name,
          prebuiltCredentials.value,
          customHeaders, // custom headers
          formData.value.skip_tls_verify || false // skipTlsVerify
        );
      }

      emit("get:destinations");
      emit("cancel:hideform");
      return;
    } catch (error) {
      console.error('Failed to save prebuilt destination:', error);
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

  if(!props.isAlerts){
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
      page: "Add Destination"
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
      page: "Add Destination"
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

// Destination Type Selection Grid Styles
.destination-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 1rem;
  margin-top: 0.5rem;
}

.destination-type-card {
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: white;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;

  &:hover {
    border-color: #5960b2;
    box-shadow: 0 4px 12px rgba(89, 96, 178, 0.15);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: #5960b2;
    background: linear-gradient(135deg, #5960b2 0%, #4a52a0 100%);
    color: white;
    box-shadow: 0 4px 16px rgba(89, 96, 178, 0.3);

    .destination-type-label {
      color: white;
    }

    &::after {
      content: "✓";
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    }
  }
}

.destination-type-content {
  margin-bottom: 0.75rem;
}

.destination-type-image {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.destination-type-icon {
  color: #666;

  .selected & {
    color: white;
  }
}

.destination-type-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: #333;
  margin: 0;

  &.active {
    color: white;
  }
}
</style>
