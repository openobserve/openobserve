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
  <ODrawer data-test="event-detail-drawer"
    bleed
    :open="open"
    size="xl"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="px-1 py-2.5 w-full">
        <div class="flex items-center flex-nowrap w-full">
        <div class="flex flex-col w-full">
          <!-- Event Header -->
          <div class="flex items-center justify-between mb-2.5">
              <div
                class="flex items-center w-full"
              >
                <div
                  class="px-1.5 py-0.5 rounded-default text-3xs font-semibold uppercase mr-1.5"
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
                    class="mr-1 inline"
                  />
                </template>
                <div
                  class="text-sm semi-bold leading-tight overflow-hidden text-ellipsis whitespace-nowrap flex-1"
                  :title="event.name"
                >
                  {{ event.name }}
                </div>
              </div>
          </div>
          <div
              data-test="event-session-meta-data"
              class="flex items-center flex-wrap gap-x-3 gap-y-1 event-metadata"
            >
              <div class="text-xs truncate flex items-center">
                <OIcon name="language" size="sm" class="pr-1" />
                {{ sessionDetails.ip }}
              </div>
              <div class="text-xs flex items-center">
                <OIcon name="code" size="sm" class="pr-1" />
                {{ rawEvent.service || "Unknown User" }}
              </div>
              <div class="text-xs flex items-center">
                V {{ rawEvent.version || "Unknown User" }}
              </div>
              <div class="text-xs flex items-center">
                <OIcon name="mail" size="sm" class="pr-1" />
                {{ sessionDetails.user_email || "Unknown User" }}
              </div>
              <div class="text-xs truncate flex items-center">
                <OIcon name="settings" size="sm" class="pr-1" />
                {{ sessionDetails.browser }}, {{ sessionDetails.os }}
              </div>
              <div class="text-xs truncate flex items-center">
                <OIcon name="location-on" size="sm" class="pr-1" />
                {{ sessionDetails.city }}, {{ sessionDetails.country }}
              </div>
              <div class="text-xs truncate flex items-center">
                <OIcon name="schedule" size="sm" class="pr-1" />
                {{ sessionDetails.date }}
              </div>
          </div>
        </div>
      </div>
      </div>
    </template>

    <!-- Tabs Navigation -->
    <div class="flex pt-2 px-page-edge">
      <div class="w-full">
        <OTabs v-model="activeTab" align="left" dense>
          <OTab
            data-test="event-detail-overview-tab"
            name="overview"
            label="Overview"
          />
          <OTab
            data-test="event-detail-network-tab"
            name="network"
            label="Network"
          />
          <OTab
            data-test="event-detail-attributes-tab"
            name="attributes"
            label="Attributes"
          />
        </OTabs>
      </div>
    </div>

    <!-- Tab Content -->
    <OTabPanels
      v-model="activeTab"
      animated
      keep-alive
      grow
      scroll="y"
      data-test="tab-content-container"
    >
      <!-- Overview Tab -->
      <OTabPanel name="overview" padding="sm" data-test="overview-tab">
        <template v-if="event && Object.keys(event).length">
          <!-- Error Details -->
          <div
            v-if="event.type === 'error'"
            class="mb-3"
            data-test="error-details"
          >
            <div class="font-bold mb-1 text-sm">Error Details</div>
            <div>
              <div
                v-if="rawEvent?.error_type"
                class="flex py-1 px-1.5 border-b border-solid border-card-glass-border text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  Error Type:
                </div>
                <div class="flex-1 break-words">
                  {{ rawEvent.error_type }}
                </div>
              </div>
              <div
                v-if="rawEvent?.error_message"
                class="flex py-1 px-1.5 border-b border-solid border-card-glass-border text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  Message:
                </div>
                <div class="flex-1 break-words">
                  {{ rawEvent.error_message }}
                </div>
              </div>
              <div
                v-if="rawEvent?.error_handling"
                class="flex py-1 px-1.5 border-b border-solid border-card-glass-border text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  Handling:
                </div>
                <div class="flex-1 break-words">
                  <span
                    class="px-1 py-0.5 rounded-default text-3xs"
                    :class="
                      rawEvent.error_handling === 'unhandled'
                        ? 'text-status-error-text border border-solid border-status-negative'
                        : 'text-text-secondary'
                    "
                  >
                    {{ rawEvent.error_handling }}
                  </span>
                </div>
              </div>
              <div
                v-if="rawEvent?.error_id"
                class="flex py-1 px-1.5 text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  Error ID:
                </div>
                <div class="flex-1 break-words">
                  <code
                    class="font-mono text-3xs px-1 py-0.5 bg-surface-accent rounded-default"
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
            class="mb-3"
            data-test="view-details"
          >
            <div class="font-bold mb-1 text-sm">View Details</div>
            <div>
              <div
                v-if="rawEvent?.view_loading_type"
                class="flex py-1 px-1.5 border-b border-solid border-card-glass-border text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  Loading Type:
                </div>
                <div class="flex-1 capitalize break-words">
                  {{ rawEvent.view_loading_type.replace("_", " ") }}
                </div>
              </div>
              <div
                v-if="rawEvent?.view_url"
                class="flex py-1 px-1.5 border-b border-solid border-card-glass-border text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  URL:
                </div>
                <div
                  class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                  :title="rawEvent.view_url"
                >
                  {{ rawEvent.view_url }}
                </div>
              </div>
              <div
                v-if="rawEvent?.view_id"
                class="flex py-1 px-1.5 text-xs"
              >
                <div
                  class="w-25 font-medium text-text-secondary shrink-0"
                >
                  View ID:
                </div>
                <div class="flex-1 break-words">
                  <code
                    class="font-mono text-3xs px-1 py-0.5 bg-surface-accent rounded-default"
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
            class="mb-3"
          />

          <!-- Related Events for Actions -->
          <div v-if="event.type === 'action'" class="mb-3">
            <template v-if="isLoadingRelatedResources">
              <div class="mt-2 p-2 text-center">
                <OSpinner size="xs" />
                <div class="mt-1 text-text-secondary text-xs">
                  Loading related events...
                </div>
              </div>
            </template>
            <template v-else-if="relatedResources.length > 0">
              <div class="font-bold mb-1 text-sm">
                Related Events ({{ relatedResources.length }})
              </div>
              <div>
                <div
                  v-for="item in relatedResources"
                  :key="item[`${item.type}_id`] || item.id"
                  class="p-1.5 mb-1 bg-surface-accent rounded-default cursor-pointer hover:bg-interactive-hover-bg transition-colors"
                  data-test="related-resource-item"
                  @click="viewResourceDetails(item)"
                >
                  <!-- Event Type Badge -->
                  <div class="flex items-center mb-0.5">
                    <div
                      class="px-1 py-0.5 rounded-default text-3xs font-semibold uppercase mr-1.5"
                      :class="getEventTypeClass(item.type)"
                    >
                      {{ item.type }}
                    </div>

                    <!-- Resource -->
                    <template v-if="item.type === 'resource'">
                      <span
                        class="mr-1 font-bold text-3xs text-button-primary"
                      >
                        {{ item.resource_method || "GET" }}
                      </span>
                      <span
                        class="overflow-hidden text-ellipsis whitespace-nowrap text-xs"
                      >
                        {{ item.resource_url }}
                      </span>
                    </template>

                    <!-- Error -->
                    <template v-else-if="item.type === 'error'">
                      <span
                        class="overflow-hidden text-ellipsis whitespace-nowrap text-xs"
                      >
                        {{ item.error_message || item.error_type }}
                      </span>
                    </template>

                    <!-- View -->
                    <template v-else-if="item.type === 'view'">
                      <span
                        class="overflow-hidden text-ellipsis whitespace-nowrap text-xs"
                      >
                        {{ item.view_url }}
                      </span>
                    </template>

                    <!-- Action -->
                    <template v-else-if="item.type === 'action'">
                      <span
                        class="overflow-hidden text-ellipsis whitespace-nowrap text-xs"
                      >
                        {{ item.action_type }} on {{ item.action_target_name }}
                      </span>
                    </template>

                    <!-- Other -->
                    <template v-else>
                      <span
                        class="overflow-hidden text-ellipsis whitespace-nowrap text-xs"
                      >
                        {{ item.type }} event
                      </span>
                    </template>
                  </div>

                  <!-- Event Details Row -->
                  <div class="flex items-center text-text-secondary text-3xs">
                    <OIcon name="schedule" size="xs" class="mr-1" />
                    <span class="mr-2">{{
                      formatTimestamp(item.date)
                    }}</span>

                    <!-- Resource-specific details -->
                    <template v-if="item.type === 'resource'">
                      <OIcon
                        name="access-time"
                        size="xs"
                        class="mr-0.5"
                      />
                      <span class="mr-2">{{
                        formatDuration(item.resource_duration / 1000000)
                      }}</span>
                      <OIcon
                        :name="getStatusIcon(item.resource_status_code)"
                        :class="['mr-0.5', getStatusColorClass(item.resource_status_code)]"
                        size="xs"
                      />
                      <span>{{ item.resource_status_code }}</span>
                    </template>

                    <!-- Clickable Trace Button -->
                    <OButton
                      v-if="item._oo_trace_id"
                      variant="outline"
                      size="xs"
                      title="View trace details"
                      data-test="view-trace-btn"
                      class="ml-2 h-5! px-1.5"
                      @click.stop="navigateToSpecificTrace(item._oo_trace_id)"
                    >
                      <OIcon name="account-tree" size="xs" />
                      <span v-if="item._oo_trace_id">View Trace</span>
                    </OButton>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </OTabPanel>

      <!-- Network Tab -->
      <OTabPanel name="network" padding="sm" data-test="network-tab">
        <template v-if="networkResources.length > 0">
          <div class="font-bold mb-2 text-sm">
            Network Requests ({{ networkResources.length }})
          </div>
          <div>
            <div
              v-for="resource in networkResources"
              :key="resource.resource_id"
              class="p-2 mb-2 bg-surface-accent rounded-default"
              data-test="network-resource-item"
            >
              <div class="flex items-center mb-1">
                <span
                  class="px-1.5 py-0.5 rounded-default text-3xs font-bold mr-2 bg-badge-blue-soft-bg text-badge-blue-soft-text"
                >
                  {{ resource.resource_method || "GET" }}
                </span>
                <span class="text-xs break-all">
                  {{ resource.resource_url }}
                </span>
              </div>
              <div
                class="flex items-center gap-x-3 text-3xs text-text-secondary"
              >
                <div class="flex items-center">
                  <OIcon name="access-time" size="xs" class="mr-1" />
                  {{ formatDuration(resource.resource_duration / 1000000) }}
                </div>
                <div class="flex items-center">
                  <OIcon
                    :name="getStatusIcon(resource.resource_status_code)"
                    :class="['mr-1', getStatusColorClass(resource.resource_status_code)]"
                    size="xs"
                  />
                  {{ resource.resource_status_code }}
                </div>
                <div class="flex items-center">
                  <OIcon name="schedule" size="xs" class="mr-1" />
                  {{ formatTimestamp(resource.date) }}
                </div>
              </div>
            </div>
          </div>
        </template>
        <div
          v-else
          class="text-center py-8 text-text-muted text-sm"
          data-test="network-empty-state"
        >
          No network requests found for this event
        </div>
      </OTabPanel>

      <!-- Console Tab -->
      <OTabPanel name="console" padding="sm" data-test="console-tab">
        <div class="text-center py-8 text-text-muted text-sm">
          Console logs coming soon
        </div>
      </OTabPanel>

      <!-- Performance Tab -->
      <OTabPanel
        name="performance"
        padding="sm"
        data-test="performance-tab"
      >
        <div class="text-center py-8 text-text-muted text-sm">
          Performance metrics coming soon
        </div>
      </OTabPanel>

      <!-- Attributes Tab -->
      <OTabPanel name="attributes" padding="sm" data-test="attributes-tab">
        <div class="flex justify-start">
          <OButton
            icon-left="content-copy"
            variant="outline"
            size="xs"
            data-test="attributes-copy-btn"
            @click="copyAttributesToClipboard"
          >
            {{ t('common.copyToClipboard') }}
          </OButton>
        </div>
        <div
          class="p-2 rounded-default overflow-x-auto font-mono text-3xs"
          data-test="raw-event-json"
        >
          <div>
            {
            <div
              v-for="(key, index) in Object.keys(rawEvent)"
              :key="key"
              class="ml-4"
            >
              <span>
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
      </OTabPanel>
    </OTabPanels>
  </ODrawer>
</template>

<script setup lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OTabPanels from '@/lib/navigation/Tabs/OTabPanels.vue'
import OTabPanel from '@/lib/navigation/Tabs/OTabPanel.vue'
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import FrustrationEventBadge from "./FrustrationEventBadge.vue";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import EventDetailsSection from "./common/EventDetailsSection.vue";
import EventTypeBadge from "./common/EventTypeBadge.vue";
import { useEventFormatters } from "@/composables/useEventFormatters";
import { formatDuration } from "@/utils/zincutils";
import OButton from '@/lib/core/Button/OButton.vue';
import ODrawer from '@/lib/overlay/Drawer/ODrawer.vue';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
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

const emit = defineEmits(["update:open", "resource-selected"]);

const store = useStore();
const router = useRouter();
const { t } = useI18n();
const relatedResources = ref<any[]>([]);
const isLoadingRelatedResources = ref(false);
const selectedResourceWithTrace = ref<any>(null);
const activeTab = ref("overview");

const {
  formatTimestamp,
  formatId,
  getStatusIcon,
  getStatusColorClass,
  formatResourceDuration,
  getEventTypeClass,
} = useEventFormatters();

const copyAttributesToClipboard = () => {
  copyToClipboard(JSON.stringify(props.rawEvent, null, 2), {
    successMessage: t("common.copyToClipboard") + " - " + t("common.success"),
    errorMessage: "Error while copying content.",
    timeout: 1500,
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
    valueClass: "capitalize",
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
    valueClass: "capitalize",
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
  outlinedAccountTree: "account-tree",
});
</script>

