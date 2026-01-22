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
  <q-dialog
    v-model="isOpen"
    position="right"
    full-height
    maximized
    @hide="closeDrawer"
  >
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
                    v-close-popup="true"
                    round
                    flat
                    dense
                    size="sm"
                    icon="cancel"
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
      <template
        v-if="event && Object.keys(event).length && rawEvent.action_type"
      >
        <q-separator class="tw:my-2" />
        <q-card-section
          class="tw:px-2 tw:py-[0.5rem]! tw-flex-1 tw:overflow-y-auto"
        >
          <div v-if="event.type === 'action'" class="tw:mb-3">
            <div class="tw:font-bold tw:mb-1 tw:text-sm">Action Details</div>
            <div>
              <div
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Action Type:
                </div>
                <div class="tw:flex-1 text-capitalize tw:break-words">
                  {{ rawEvent?.action_type || "N/A" }}
                </div>
              </div>
              <div
                class="tw:flex tw:py-1 tw:px-1.5 tw:border-solid tw:border-[var(--o2-border-color)] tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Target:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  {{ rawEvent?.action_target_name || "N/A" }}
                </div>
              </div>
              <div
                v-if="rawEvent?.action_id"
                class="tw:flex tw:py-1 tw:px-1.5 tw:text-xs"
              >
                <div
                  class="tw:w-[100px] tw:font-medium tw:text-[var(--o2-text-secondary)] tw:shrink-0"
                >
                  Action ID:
                </div>
                <div class="tw:flex-1 tw:break-words">
                  <code
                    class="tw:font-mono tw:text-[10px] tw:px-1 tw:py-0.5 tw:bg-[var(--o2-hover-accent)] tw:rounded"
                  >
                    {{ formatId(rawEvent.action_id) }}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </q-card-section>
      </template>
      <q-separator class="tw:my-2" />
      <!-- Content -->
      <q-card-section
        class="tw:px-2 tw:py-[0.5rem]! tw-flex-1 tw:overflow-y-auto"
      >
        <template v-if="event && Object.keys(event).length">
          <!-- Action Details with Resource Linking -->
          <div v-if="event.type === 'action'" class="tw:mb-3">
            <!-- Related Events Section -->
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
                  <div class="row items-center text-grey-7 tw:text-[10px]">
                    <q-icon name="schedule" size="xs" class="tw:mr-1" />
                    <span class="tw:mr-2">{{
                      formatTimestamp(item.date)
                    }}</span>

                    <!-- Resource-specific details -->
                    <template v-if="item.type === 'resource'">
                      <q-icon name="access_time" size="xs" class="tw:mr-0.5" />
                      <span class="tw:mr-2">{{
                        formatDuration(item.resource_duration)
                      }}</span>
                      <q-icon
                        :name="getStatusIcon(item.resource_status_code)"
                        :color="getStatusColor(item.resource_status_code)"
                        size="xs"
                        class="tw:mr-0.5"
                      />
                      <span>{{ item.resource_status_code }}</span>
                    </template>

                    <!-- Clickable Trace Button -->
                    <q-btn
                      v-if="item._oo_trace_id"
                      dense
                      :icon="outlinedAccountTree"
                      size="xs"
                      outline
                      class="tw:ml-[0.625rem]! tw:px-[0.2rem]! tw:border-1! tw:border-[var(--o2-theme-color)]! tw:text-[var(--o2-theme-color)]!"
                      title="View trace details"
                      @click.stop="navigateToSpecificTrace(item._oo_trace_id)"
                    >
                      <span
                        v-if="item._oo_trace_id"
                        class="tw:text-[10px] tw:pl-[0.2rem] tw:text-[var(--o2-theme-primary)]"
                      >
                        Trace
                      </span>
                    </q-btn>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Error Details -->
          <div v-if="event.type === 'error'" class="tw:mb-3">
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
          <div v-if="event.type === 'view'" class="tw:mb-3">
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

          <!-- Trace Correlation (if trace_id exists in related resource) -->
          <template v-if="selectedResourceWithTrace">
            <q-separator class="tw:my-2" />
            <TraceCorrelationCard
              :trace-id="selectedResourceWithTrace._oo_trace_id"
              :span-id="selectedResourceWithTrace._oo_trace_id"
              :session-id="rawEvent?.session_id"
              :resource-duration="selectedResourceWithTrace.resource_duration"
            />
          </template>

          <!-- Raw Event Data (Collapsible) -->
        </template>
      </q-card-section>

      <q-separator class="tw:my-2" />
      <q-card-section
        class="tw:px-2 tw:py-[0.5rem]! tw-flex-1 tw:overflow-y-auto"
      >
        <div class="tw:mb-2">
          <q-expansion-item
            label="Raw Event Data"
            header-class="text-bold tw:text-sm"
            dense
          >
            <div class="tw:p-2 tw:bg-[var(--o2-hover-accent)] tw:rounded">
              <pre
                class="tw:text-[10px] tw:font-mono tw:m-0 tw:whitespace-pre-wrap tw:break-words tw:leading-tight"
              >
                  {{ JSON.stringify(rawEvent, null, 2) }}
                </pre
              >
            </div>
          </q-expansion-item>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { date } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import {
  outlinedAccountTree,
  outlinedCode,
} from "@quasar/extras/material-icons-outlined";
import FrustrationEventBadge from "./FrustrationEventBadge.vue";

const props = defineProps({
  modelValue: {
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

const emit = defineEmits(["update:modelValue", "resource-selected"]);

const store = useStore();
const router = useRouter();
const isOpen = ref(props.modelValue);
const relatedResources = ref<any[]>([]);
const isLoadingRelatedResources = ref(false);
const selectedResourceWithTrace = ref<any>(null);

// Check if any related event has a trace_id
const hasAnyTraceId = computed(() => {
  return relatedResources.value.some((item: any) => item._oo_trace_id);
});

// Get the first trace_id from related events
const firstTraceId = computed(() => {
  const itemWithTrace = relatedResources.value.find(
    (item: any) => item._oo_trace_id,
  );
  return itemWithTrace?._oo_trace_id || null;
});

watch(
  () => props.modelValue,
  (val) => {
    isOpen.value = val;
    if (val && props.event?.type === "action" && props.rawEvent?.action_id) {
      fetchRelatedResources();
    }
  },
);

watch(isOpen, (val) => {
  if (!val) {
    // Reset state when closing
    relatedResources.value = [];
    selectedResourceWithTrace.value = null;
  }
  emit("update:modelValue", val);
});

const closeDrawer = () => {
  isOpen.value = false;
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return date.formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss.SSS Z");
};

const formatDuration = (duration: number) => {
  if (!duration) return "N/A";
  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }
  return `${(duration / 1000).toFixed(2)}s`;
};

const formatId = (id: string) => {
  if (!id) return "";
  return id;
};

const getEventTypeClass = (type: string) => {
  const classes: { [key: string]: string } = {
    error:
      "tw:bg-red-100 tw:text-red-700 tw:border tw:border-solid tw:border-red-300",
    action:
      "tw:bg-blue-100 tw:text-blue-700 tw:border tw:border-solid tw:border-blue-300",
    view: "tw:bg-green-100 tw:text-green-700 tw:border tw:border-solid tw:border-green-300",
  };
  return classes[type] || "tw:bg-grey-100 tw:text-grey-700";
};

const getStatusIcon = (statusCode: number) => {
  if (!statusCode) return "help";
  if (statusCode >= 200 && statusCode < 300) return "check_circle";
  if (statusCode >= 300 && statusCode < 400) return "info";
  if (statusCode >= 400 && statusCode < 500) return "warning";
  return "error";
};

const getStatusColor = (statusCode: number) => {
  if (!statusCode) return "grey";
  if (statusCode >= 200 && statusCode < 300) return "positive";
  if (statusCode >= 300 && statusCode < 400) return "info";
  if (statusCode >= 400 && statusCode < 500) return "warning";
  return "negative";
};

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
      (r: any) => r._oo?.trace_id,
    );
    if (resourceWithTrace) {
      selectedResourceWithTrace.value = resourceWithTrace;
    }
  } catch (error) {
    console.error("Failed to fetch related resources:", error);
  } finally {
    isLoadingRelatedResources.value = false;
  }
};

const viewResourceDetails = (resource: any) => {
  // Update selected resource for trace correlation
  if (resource._oo?.trace_id) {
    selectedResourceWithTrace.value = resource;
  }

  // Emit event to parent if they want to handle it differently
  emit("resource-selected", resource);
};

/**
 * Navigate to trace details page with the first available trace_id
 */
const navigateToTrace = () => {
  if (!firstTraceId.value) return;

  // Find the first resource with trace_id to get timing information
  const resource = relatedResources.value.find((r: any) => r._oo_trace_id);

  // Use resource timing if available, otherwise use event timing
  const startTime = resource?.date
    ? resource.date * 1000 - 10000000 // 10 seconds before
    : props.rawEvent?.date * 1000 - 10000000;
  const endTime = resource?.date
    ? resource.date * 1000 + 10000000 // 10 seconds after
    : props.rawEvent?.date * 1000 + 10000000;

  router.push({
    name: "traceDetails",
    query: {
      stream: "default", // RUM traces stream
      trace_id: firstTraceId.value,
      from: startTime,
      to: endTime,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
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

<style lang="scss" scoped></style>
