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
  <q-card class="column full-height no-wrap tw:w-[70vw]!">
    <!-- Header -->
    <q-card-section class="tw:px-2 tw:py-[0.625rem]!">
      <div class="row items-center no-wrap">
        <div class="col">
          <!-- Event Header -->
          <div>
            <div class="row items-center justify-between tw:mb-[0.625rem]">
              <div
                class="row items-center tw:w-full tw:max-w-[calc(100%-1.9rem)]"
              >
                <div
                  class="tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[10px] tw:font-semibold tw:uppercase tw:mr-1.5"
                  :class="getEventTypeClass(event.type)"
                >
                  {{ event.type }}
                </div>

                <template
                  v-if="
                    event.frustration_types &&
                    event.frustration_types.length > 0
                  "
                >
                  <FrustrationEventBadge
                    :frustration-types="event.frustration_types"
                    class="q-mr-xs inline"
                  />
                </template>
                <div
                  class="tw:text-sm tw:semi-bold tw:leading-tight tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:max-w-[calc(100%-12rem)]"
                  :title="event.name"
                >
                  {{ event.name }}
                </div>
              </div>
              <div class="col-auto">
                <q-btn
                  round
                  flat
                  dense
                  size="sm"
                  icon="cancel"
                  data-test="close-drawer-btn"
                  @click="$emit('close')"
                />
              </div>
            </div>
            <div
              data-test="event-session-meta-data"
              class="row items-center tw:flex-wrap tw:gap-x-3 tw:gap-y-1 event-metadata"
            >
              <div class="text-caption ellipsis tw:flex tw:items-center">
                <q-icon name="language" size="0.75rem" class="q-pr-xs" />
                {{ sessionDetails.ip }}
              </div>
              <div class="text-caption tw:flex tw:items-center">
                <q-icon :name="outlinedCode" size="1rem" class="q-pr-xs" />
                {{ rawEvent.service || "Unknown User" }}
              </div>
              <div class="text-caption tw:flex tw:items-center">
                V {{ rawEvent.version || "Unknown User" }}
              </div>
              <div class="text-caption tw:flex tw:items-center">
                <q-icon name="mail" size="0.75rem" class="q-pr-xs" />
                {{ sessionDetails.user_email || "Unknown User" }}
              </div>
              <div class="text-caption ellipsis tw:flex tw:items-center">
                <q-icon name="settings" size="0.75rem" class="q-pr-xs" />
                {{ sessionDetails.browser }}, {{ sessionDetails.os }}
              </div>
              <div class="text-caption ellipsis tw:flex tw:items-center">
                <q-icon name="location_on" size="0.75rem" class="q-pr-xs" />
                {{ sessionDetails.city }}, {{ sessionDetails.country }}
              </div>
              <div class="text-caption ellipsis tw:flex tw:items-center">
                <q-icon name="schedule" size="0.75rem" class="q-pr-xs" />
                {{ sessionDetails.date }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-card-section>

    <!-- Tabs Navigation -->
    <q-separator />
    <div class="row q-pt-sm q-px-sm">
      <div class="col-12">
        <q-tabs v-model="activeTab" shrink align="left">
          <q-tab
            data-test="event-detail-overview-tab"
            name="overview"
            label="Overview"
          />
          <q-tab
            data-test="event-detail-network-tab"
            name="network"
            label="Network"
          />
          <q-tab
            data-test="event-detail-attributes-tab"
            name="attributes"
            label="Attributes"
          />
        </q-tabs>
      </div>
    </div>

    <q-separator />

    <!-- Tab Content -->
    <q-tab-panels
      v-model="activeTab"
      animated
      keep-alive
      class="tw:flex-1 tw:overflow-y-auto"
      data-test="tab-content-container"
    >
      <!-- Overview Tab -->
      <q-tab-panel name="overview" class="q-pa-sm" data-test="overview-tab">
        <template v-if="event && Object.keys(event).length">
          <!-- Error Details -->
          <div
            v-if="event.type === 'error'"
            class="tw:mb-3"
            data-test="error-details"
          >
            <div class="tw:font-bold tw:mb-1 tw:text-sm">Error Details</div>
            <div>
              <div
                v-if="rawEvent?.error_type"
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Error Type:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  {{ rawEvent.error_type }}
                </div>
              </div>
              <div
                v-if="rawEvent?.error_message"
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Message:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  {{ rawEvent.error_message }}
                </div>
              </div>
              <div
                v-if="rawEvent?.error_handling"
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Handling:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  <span
                    class="tw:px-1 tw:py-0.5 tw:rounded tw:text-[10px]"
                    :class="
                      rawEvent.error_handling === 'unhandled'
                        ? 'text-red-6 tw:border tw:border-solid tw:border-red-6'
                        : 'text-grey-8'
                    "
                  >
                    {{ rawEvent.error_handling }}
                  </span>
                </div>
              </div>
              <div
                v-if="rawEvent?.error_id"
                class="tw:flex tw:py-1 tw:px-1.5 tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Error ID:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  <code
                    class="tw:font-mono tw:text-[10px] tw:px-1 tw:py-0.5 tw:bg-[var(--o2-hover-accent)] tw:rounded"
                  >
                    {{ formatId(rawEvent.error_id) }}
                  </code>
                </div>
              </div>
            </div>
          </div>

          <!-- View Details -->
          <div
            v-if="event.type === 'view'"
            class="tw:mb-3"
            data-test="view-details"
          >
            <div class="tw:font-bold tw:mb-1 tw:text-sm">View Details</div>
            <div>
              <div
                v-if="rawEvent?.view_loading_type"
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Loading Type:
                </div>
                <div class="tw:flex-1 text-capitalize tw:break-words">
                  {{ rawEvent.view_loading_type.replace("_", " ") }}
                </div>
              </div>
              <div
                v-if="rawEvent?.view_url"
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  URL:
                </div>
                <div
                  class="tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap"
                  :title="rawEvent.view_url"
                >
                  {{ rawEvent.view_url }}
                </div>
              </div>
              <div
                v-if="rawEvent?.view_id"
                class="tw:flex tw:py-1 tw:px-1.5 tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  View ID:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  <code
                    class="tw:font-mono tw:text-[10px] tw:px-1 tw:py-0.5 tw:bg-[var(--o2-hover-accent)] tw:rounded"
                  >
                    {{ formatId(rawEvent.view_id) }}
                  </code>
                </div>
              </div>
            </div>
          </div>

          <!-- Action Details -->
          <EventDetailsSection
            v-if="event.type === 'action'"
            title="Action Details"
            :fields="actionFields"
            data-test="action-details"
            class="tw:mb-3"
          />

          <!-- Related Events for Actions -->
          <div v-if="event.type === 'action'" class="tw:mb-3">
            <template v-if="isLoadingRelatedResources">
              <div class="tw:mt-2 tw:p-2 text-center">
                <q-spinner-hourglass color="primary" size="1rem" />
                <div class="tw:mt-1 text-grey-7 tw:text-xs">
                  Loading related events...
                </div>
              </div>
            </template>
            <template v-else-if="relatedResources.length > 0">
              <div class="tw:font-bold tw:mb-1 tw:text-sm">
                Related Events ({{ relatedResources.length }})
              </div>
              <div>
                <div
                  v-for="item in relatedResources"
                  :key="item[`${item.type}_id`] || item.id"
                  class="tw:p-1.5 tw:mb-1 tw:bg-[var(--o2-hover-accent)] tw:rounded tw:cursor-pointer hover:tw:bg-[#e0e0e0] tw:transition-colors"
                  data-test="related-resource-item"
                  @click="viewResourceDetails(item)"
                >
                  <!-- Event Type Badge -->
                  <div class="row items-center tw:mb-0.5">
                    <div
                      class="tw:px-1 tw:py-0.5 tw:rounded tw:text-[10px] tw:font-semibold tw:uppercase tw:mr-1.5"
                      :class="getEventTypeClass(item.type)"
                    >
                      {{ item.type }}
                    </div>

                    <!-- Resource -->
                    <template v-if="item.type === 'resource'">
                      <span
                        class="tw:mr-1 text-bold tw:text-[10px] tw:text-[var(--o2-primary-btn-bg)]"
                      >
                        {{ item.resource_method || "GET" }}
                      </span>
                      <span
                        class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs"
                      >
                        {{ item.resource_url }}
                      </span>
                    </template>

                    <!-- Error -->
                    <template v-else-if="item.type === 'error'">
                      <span
                        class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs"
                      >
                        {{ item.error_message || item.error_type }}
                      </span>
                    </template>

                    <!-- View -->
                    <template v-else-if="item.type === 'view'">
                      <span
                        class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs"
                      >
                        {{ item.view_url }}
                      </span>
                    </template>

                    <!-- Action -->
                    <template v-else-if="item.type === 'action'">
                      <span
                        class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs"
                      >
                        {{ item.action_type }} on {{ item.action_target_name }}
                      </span>
                    </template>

                    <!-- Other -->
                    <template v-else>
                      <span
                        class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-xs"
                      >
                        {{ item.type }} event
                      </span>
                    </template>
                  </div>

                  <!-- Event Details Row -->
                  <div class="tw:flex items-center text-grey-7 tw:text-[10px]">
                    <q-icon name="schedule" size="0.75rem" class="tw:mr-1" />
                    <span class="tw:mr-2">{{
                      formatTimestamp(item.date)
                    }}</span>

                    <!-- Resource-specific details -->
                    <template v-if="item.type === 'resource'">
                      <q-icon
                        name="access_time"
                        size="0.75rem"
                        class="tw:mr-0.5"
                      />
                      <span class="tw:mr-2">{{
                        formatDuration(item.resource_duration / 1000000)
                      }}</span>
                      <q-icon
                        :name="getStatusIcon(item.resource_status_code)"
                        :color="getStatusColor(item.resource_status_code)"
                        size="0.75rem"
                        class="tw:mr-0.5"
                      />
                      <span>{{ item.resource_status_code }}</span>
                    </template>

                    <!-- Clickable Trace Button -->
                    <q-btn
                      v-if="item._oo_trace_id"
                      dense
                      :icon="outlinedAccountTree"
                      outline
                      size="0.75rem"
                      class="tw:ml-[0.625rem]! tw:py-[0]! tw:px-[0.2rem]! tw:border-1! tw:border-[var(--o2-theme-color)]! tw:text-[var(--o2-theme-color)]!"
                      title="View trace details"
                      data-test="view-trace-btn"
                      @click.stop="navigateToSpecificTrace(item._oo_trace_id)"
                    >
                      <span
                        v-if="item._oo_trace_id"
                        class="tw:text-[10px] tw:pl-[0.2rem] tw:py-[0]! tw:text-[var(--o2-theme-primary)]"
                      >
                        Trace
                      </span>
                    </q-btn>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </q-tab-panel>

      <!-- Network Tab -->
      <q-tab-panel name="network" class="q-pa-sm" data-test="network-tab">
        <template v-if="networkResources.length > 0">
          <div class="tw:font-bold tw:mb-2 tw:text-sm">
            Network Requests ({{ networkResources.length }})
          </div>
          <div>
            <div
              v-for="resource in networkResources"
              :key="resource.resource_id"
              class="tw:p-2 tw:mb-2 tw:bg-[var(--o2-hover-accent)] tw:rounded"
              data-test="network-resource-item"
            >
              <div class="tw:flex tw:items-center tw:mb-1">
                <span
                  class="tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[10px] tw:font-bold tw:mr-2 tw:bg-blue-100 tw:text-blue-700"
                >
                  {{ resource.resource_method || "GET" }}
                </span>
                <span class="tw:text-xs tw:break-all">
                  {{ resource.resource_url }}
                </span>
              </div>
              <div
                class="row items-center tw:gap-x-3 tw:text-[10px] text-grey-7"
              >
                <div class="tw:flex tw:items-center">
                  <q-icon name="access_time" size="0.75rem" class="tw:mr-1" />
                  {{ formatDuration(resource.resource_duration / 1000000) }}
                </div>
                <div class="tw:flex tw:items-center">
                  <q-icon
                    :name="getStatusIcon(resource.resource_status_code)"
                    :color="getStatusColor(resource.resource_status_code)"
                    size="0.75rem"
                    class="tw:mr-1"
                  />
                  {{ resource.resource_status_code }}
                </div>
                <div class="tw:flex tw:items-center">
                  <q-icon name="schedule" size="0.75rem" class="tw:mr-1" />
                  {{ formatTimestamp(resource.date) }}
                </div>
              </div>
            </div>
          </div>
        </template>
        <div
          v-else
          class="tw:text-center tw:py-8 tw:text-grey-6 tw:text-sm"
          data-test="network-empty-state"
        >
          No network requests found for this event
        </div>
      </q-tab-panel>

      <!-- Console Tab -->
      <q-tab-panel name="console" class="q-pa-sm" data-test="console-tab">
        <div class="tw:text-center tw:py-8 tw:text-grey-6 tw:text-sm">
          Console logs coming soon
        </div>
      </q-tab-panel>

      <!-- Performance Tab -->
      <q-tab-panel
        name="performance"
        class="q-pa-sm"
        data-test="performance-tab"
      >
        <div class="tw:text-center tw:py-8 tw:text-grey-6 tw:text-sm">
          Performance metrics coming soon
        </div>
      </q-tab-panel>

      <!-- Attributes Tab -->
      <q-tab-panel name="attributes" class="q-pa-sm" data-test="attributes-tab">
        <div class="tw:flex tw:justify-start">
          <q-btn
            :label="t('common.copyToClipboard')"
            dense
            size="sm"
            no-caps
            class="q-px-sm tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:font-normal"
            icon="content_copy"
            @click="copyAttributesToClipboard"
            data-test="attributes-copy-btn"
          />
        </div>
        <div
          class="tw:p-2 tw:rounded tw:overflow-x-auto tw:font-mono tw:text-[10px]"
          data-test="raw-event-json"
        >
          <div>
            {
            <div
              v-for="(key, index) in Object.keys(rawEvent)"
              :key="key"
              class="tw:ml-4"
            >
              <span :class="store.state.theme === 'dark' ? 'dark' : ''">
                <LogsHighLighting
                  :data="{ [key]: rawEvent[key] }"
                  :show-braces="false"
                  :query-string="''"
                /><span v-if="index < Object.keys(rawEvent).length - 1">,</span>
              </span>
            </div>
            }
          </div>
        </div>
      </q-tab-panel>
    </q-tab-panels>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import {
  outlinedAccountTree,
  outlinedCode,
} from "@quasar/extras/material-icons-outlined";
import FrustrationEventBadge from "./FrustrationEventBadge.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import EventDetailsSection from "./common/EventDetailsSection.vue";
import EventTypeBadge from "./common/EventTypeBadge.vue";
import { useEventFormatters } from "@/composables/useEventFormatters";
import { formatDuration } from "@/utils/zincutils";

const props = defineProps({
  event: {
    type: Object,
    default: () => ({}),
  },
  rawEvent: {
    type: Object,
    default: () => ({}),
  },
  sessionId: {
    type: String,
    default: "",
  },
  sessionDetails: {
    type: Object,
    default: () => ({
      user_email: "",
      date: "",
      browser: "",
      os: "",
      ip: "",
      city: "",
      country: "",
    }),
  },
});

const emit = defineEmits(["close", "resource-selected"]);

const store = useStore();
const router = useRouter();
const q = useQuasar();
const { t } = useI18n();
const relatedResources = ref<any[]>([]);
const isLoadingRelatedResources = ref(false);
const selectedResourceWithTrace = ref<any>(null);
const activeTab = ref("overview");

const {
  formatTimestamp,
  formatId,
  getStatusIcon,
  getStatusColor,
  formatResourceDuration,
  getEventTypeClass,
} = useEventFormatters();

const copyAttributesToClipboard = () => {
  copyToClipboard(JSON.stringify(props.rawEvent, null, 2))
    .then(() => {
      q.notify({
        type: "positive",
        message: t("common.copyToClipboard") + " - " + t("common.success"),
        timeout: 1500,
      });
    })
    .catch(() => {
      q.notify({
        type: "negative",
        message: "Error while copying content.",
        timeout: 1500,
      });
    });
};

const networkResources = computed(() => {
  return relatedResources.value.filter((item) => item.type === "resource");
});

// Computed fields for different event types
const errorFields = computed(() => [
  {
    key: "error_type",
    label: "Error Type",
    value: props.rawEvent?.error_type,
  },
  {
    key: "error_message",
    label: "Message",
    value: props.rawEvent?.error_message,
  },
  {
    key: "error_handling",
    label: "Handling",
    value: props.rawEvent?.error_handling,
    slot: true,
  },
  {
    key: "error_id",
    label: "Error ID",
    value: props.rawEvent?.error_id,
    slot: true,
  },
]);

const viewFields = computed(() => [
  {
    key: "view_loading_type",
    label: "Loading Type",
    value: props.rawEvent?.view_loading_type?.replace("_", " "),
    valueClass: "text-capitalize",
  },
  {
    key: "view_url",
    label: "URL",
    value: props.rawEvent?.view_url,
  },
  {
    key: "view_id",
    label: "View ID",
    value: props.rawEvent?.view_id,
    slot: true,
  },
]);

const actionFields = computed(() => [
  {
    key: "action_type",
    label: "Action Type",
    value: props.rawEvent?.action_type || "N/A",
    valueClass: "text-capitalize",
  },
  {
    key: "action_target_name",
    label: "Target",
    value: props.rawEvent?.action_target_name || "N/A",
  },
  {
    key: "action_id",
    label: "Action ID",
    value: props.rawEvent?.action_id,
    slot: true,
  },
]);

/**
 * Fetch resources related to an action by action_id
 * Resources triggered by an action will have the same action_id
 */
const fetchRelatedResources = async () => {
  if (!props.rawEvent?.action_id || !props.sessionId) return;

  isLoadingRelatedResources.value = true;
  relatedResources.value = [];

  try {
    const req = {
      query: {
        sql: `select * from "_rumdata" where (action_id like '%${props.rawEvent.action_id}%' or action_id='${props.rawEvent.action_id}') order by ${store.state.zoConfig.timestamp_column} desc`,
        start_time: props.rawEvent.date * 1000, // 5 mins/360 seconds before action
        end_time: props.rawEvent.date * 1000 + 360000000, // 5 mins/360 seconds after action
        from: 0,
        size: 50,
      },
    };

    const res = await searchService.search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: req,
        page_type: "logs",
      },
      "RUM",
    );

    relatedResources.value = res.data.hits || [];

    // Auto-select first resource with trace_id for trace correlation
    const resourceWithTrace = relatedResources.value.find(
      (r: any) => r._oo_trace_id,
    );
    if (resourceWithTrace) {
      selectedResourceWithTrace.value = resourceWithTrace;
    }
  } catch {
    // Failed to fetch related resources
  } finally {
    isLoadingRelatedResources.value = false;
  }
};

watch(
  () => props.event,
  (val) => {
    if (val?.type === "action" && props.rawEvent?.action_id) {
      fetchRelatedResources();
    }
  },
  { immediate: true },
);

const viewResourceDetails = (resource: any) => {
  // Update selected resource for trace correlation
  if (resource._oo_trace_id) {
    selectedResourceWithTrace.value = resource;
  }

  // Emit event to parent if they want to handle it differently
  emit("resource-selected", resource);
};

/**
 * Navigate to trace details page with a specific trace_id
 * Used when clicking on individual trace icons
 * Opens in a new tab
 */
const navigateToSpecificTrace = (traceId: string) => {
  if (!traceId) return;

  // Find the resource with this trace_id to get timing information
  const resource = relatedResources.value.find(
    (r: any) => r._oo_trace_id === traceId,
  );

  // Use resource timing if available, otherwise use event timing
  const startTime = resource?.date
    ? resource.date * 1000 - 10000000 // 10 seconds before
    : props.rawEvent?.date * 1000 - 10000000;
  const endTime = resource?.date
    ? resource.date * 1000 + 10000000 // 10 seconds after
    : props.rawEvent?.date * 1000 + 10000000;

  // Build the route object
  const route = router.resolve({
    name: "traceDetails",
    query: {
      stream: "default", // RUM traces stream
      trace_id: traceId,
      from: startTime,
      to: endTime,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });

  // Open in new tab
  window.open(route.href, "_blank");
};

defineExpose({
  outlinedAccountTree,
});
</script>

<style lang="scss">
@import "@/assets/styles/log-highlighting.css";
</style>
