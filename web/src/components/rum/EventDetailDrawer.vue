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
  <q-drawer
    v-model="isOpen"
    side="right"
    overlay
    elevated
    :width="600"
    class="event-detail-drawer"
  >
    <div class="tw:h-full tw:flex tw:flex-col">
      <!-- Header -->
      <div
        class="tw:p-[0.625rem] tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
      >
        <div class="flex justify-between items-center">
          <div class="text-bold text-h6">Event Details</div>
          <q-btn
            flat
            dense
            round
            icon="close"
            @click="closeDrawer"
            class="hover:tw:text-[var(--o2-primary-btn-bg)]"
          />
        </div>
      </div>

      <!-- Content -->
      <div class="tw:flex-1 tw:overflow-y-auto tw:p-[0.625rem]">
        <template v-if="event && Object.keys(event).length">
          <!-- Event Header -->
          <div class="q-mb-md">
            <div class="row items-center q-mb-sm">
              <div
                class="event-type-badge q-mr-sm q-px-sm q-py-xs tw:rounded"
                :class="getEventTypeClass(event.type)"
              >
                {{ event.type }}
              </div>
              <div class="text-bold text-subtitle1">
                {{ event.name }}
              </div>
            </div>
            <div class="row items-center q-gutter-sm text-grey-7">
              <div class="row items-center">
                <q-icon name="access_time" size="sm" class="q-mr-xs" />
                <span>{{ event.displayTime }}</span>
              </div>
              <q-separator vertical />
              <div class="row items-center">
                <q-icon name="schedule" size="sm" class="q-mr-xs" />
                <span>{{ formatTimestamp(event.timestamp) }}</span>
              </div>
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- Frustration Signals (for actions) -->
          <div
            v-if="event.frustration_types && event.frustration_types.length > 0"
            class="q-mb-md"
          >
            <div class="tags-title text-bold q-ml-xs q-mb-sm">
              Frustration Signals
            </div>
            <div
              class="frustration-signals q-pa-md tw:bg-[var(--o2-hover-accent)] tw:rounded"
            >
              <div
                v-for="(frustrationType, index) in event.frustration_types"
                :key="index"
                class="row items-center q-mb-xs"
              >
                <q-icon
                  name="sentiment_very_dissatisfied"
                  size="sm"
                  class="q-mr-sm"
                  style="color: #fb923c"
                />
                <span class="text-capitalize" style="color: #fb923c">{{
                  frustrationType.replace("_", " ")
                }}</span>
              </div>
            </div>
          </div>

          <!-- Action Details with Resource Linking -->
          <div v-if="event.type === 'action'" class="q-mb-md">
            <div class="tags-title text-bold q-ml-xs q-mb-sm">
              Action Details
            </div>
            <div class="action-details-grid">
              <div class="info-row">
                <div class="info-label">Action Type:</div>
                <div class="info-value text-capitalize">
                  {{ rawEvent?.action_type || "N/A" }}
                </div>
              </div>
              <div class="info-row">
                <div class="info-label">Target:</div>
                <div class="info-value">
                  {{ rawEvent?.action_target_name || "N/A" }}
                </div>
              </div>
              <div class="info-row" v-if="rawEvent?.action_id">
                <div class="info-label">Action ID:</div>
                <div class="info-value">
                  <code class="event-id-text">{{
                    formatId(rawEvent.action_id)
                  }}</code>
                </div>
              </div>
            </div>

            <!-- Related Events Section -->
            <template v-if="isLoadingRelatedResources">
              <div class="q-mt-md q-pa-md text-center">
                <q-spinner-hourglass color="primary" size="1.5rem" />
                <div class="q-mt-sm text-grey-7">Loading related events...</div>
              </div>
            </template>
            <template v-else-if="relatedResources.length > 0">
              <q-separator class="q-my-md" />
              <div class="tags-title text-bold q-ml-xs q-mb-sm">
                Related Events ({{ relatedResources.length }})
              </div>
              <div class="related-resources-list">
                <div
                  v-for="item in relatedResources"
                  :key="item[`${item.type}_id`] || item.id"
                  class="resource-item q-pa-sm q-mb-xs tw:bg-[var(--o2-hover-accent)] tw:rounded cursor-pointer hover:tw:bg-[#e0e0e0]"
                  @click="viewResourceDetails(item)"
                >
                  <!-- Event Type Badge -->
                  <div class="row items-center q-mb-xs">
                    <div
                      class="event-type-badge-small q-mr-xs q-px-xs q-py-xxs tw:rounded"
                      :class="getEventTypeClass(item.type)"
                    >
                      {{ item.type }}
                    </div>

                    <!-- Resource -->
                    <template v-if="item.type === 'resource'">
                      <span class="resource-method q-mr-xs text-bold">{{
                        item.resource_method || "GET"
                      }}</span>
                      <span class="resource-url ellipsis">{{
                        item.resource_url
                      }}</span>
                    </template>

                    <!-- Error -->
                    <template v-else-if="item.type === 'error'">
                      <span class="ellipsis">{{
                        item.error_message || item.error_type
                      }}</span>
                    </template>

                    <!-- View -->
                    <template v-else-if="item.type === 'view'">
                      <span class="ellipsis">{{ item.view_url }}</span>
                    </template>

                    <!-- Action -->
                    <template v-else-if="item.type === 'action'">
                      <span class="ellipsis"
                        >{{ item.action_type }} on
                        {{ item.action_target_name }}</span
                      >
                    </template>

                    <!-- Other -->
                    <template v-else>
                      <span class="ellipsis">{{ item.type }} event</span>
                    </template>
                  </div>

                  <!-- Event Details Row -->
                  <div class="row items-center text-caption text-grey-7">
                    <q-icon name="schedule" size="xs" class="q-mr-xs" />
                    <span class="q-mr-md">{{
                      formatTimestamp(item.date)
                    }}</span>

                    <!-- Resource-specific details -->
                    <template v-if="item.type === 'resource'">
                      <q-icon name="access_time" size="xs" class="q-mr-xs" />
                      <span class="q-mr-md">{{
                        formatDuration(item.resource_duration)
                      }}</span>
                      <q-icon
                        :name="getStatusIcon(item.resource_status_code)"
                        :color="getStatusColor(item.resource_status_code)"
                        size="xs"
                        class="q-mr-xs"
                      />
                      <span>{{ item.resource_status_code }}</span>
                    </template>

                    <!-- Clickable Trace Button -->
                    <q-btn
                      v-if="item._oo_trace_id"
                      flat
                      dense
                      round
                      :icon="outlinedAccountTree"
                      size="xs"
                      color="info"
                      class="q-ml-md"
                      title="View trace details"
                      @click.stop="navigateToSpecificTrace(item._oo_trace_id)"
                    />
                    <span v-if="item._oo_trace_id">Trace</span>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Error Details -->
          <div v-if="event.type === 'error'" class="q-mb-md">
            <div class="tags-title text-bold q-ml-xs q-mb-sm">
              Error Details
            </div>
            <div class="error-details-grid">
              <div class="info-row" v-if="rawEvent?.error_type">
                <div class="info-label">Error Type:</div>
                <div class="info-value">{{ rawEvent.error_type }}</div>
              </div>
              <div class="info-row" v-if="rawEvent?.error_message">
                <div class="info-label">Message:</div>
                <div class="info-value">{{ rawEvent.error_message }}</div>
              </div>
              <div class="info-row" v-if="rawEvent?.error_handling">
                <div class="info-label">Handling:</div>
                <div class="info-value">
                  <span
                    class="q-px-xs tw:rounded"
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
              <div class="info-row" v-if="rawEvent?.error_id">
                <div class="info-label">Error ID:</div>
                <div class="info-value">
                  <code class="event-id-text">{{
                    formatId(rawEvent.error_id)
                  }}</code>
                </div>
              </div>
            </div>
          </div>

          <!-- View Details -->
          <div v-if="event.type === 'view'" class="q-mb-md">
            <div class="tags-title text-bold q-ml-xs q-mb-sm">View Details</div>
            <div class="view-details-grid">
              <div class="info-row" v-if="rawEvent?.view_loading_type">
                <div class="info-label">Loading Type:</div>
                <div class="info-value text-capitalize">
                  {{ rawEvent.view_loading_type.replace("_", " ") }}
                </div>
              </div>
              <div class="info-row" v-if="rawEvent?.view_url">
                <div class="info-label">URL:</div>
                <div class="info-value ellipsis" :title="rawEvent.view_url">
                  {{ rawEvent.view_url }}
                </div>
              </div>
              <div class="info-row" v-if="rawEvent?.view_id">
                <div class="info-label">View ID:</div>
                <div class="info-value">
                  <code class="event-id-text">{{
                    formatId(rawEvent.view_id)
                  }}</code>
                </div>
              </div>
            </div>
          </div>

          <!-- Trace Correlation (if trace_id exists in related resource) -->
          <template v-if="selectedResourceWithTrace">
            <q-separator class="q-my-md" />
            <TraceCorrelationCard
              :trace-id="selectedResourceWithTrace._oo_trace_id"
              :span-id="selectedResourceWithTrace._oo_trace_id"
              :session-id="rawEvent?.session_id"
              :resource-duration="selectedResourceWithTrace.resource_duration"
            />
          </template>

          <!-- Raw Event Data (Collapsible) -->
          <q-separator class="q-my-md" />
          <div class="q-mb-md">
            <q-expansion-item
              label="Raw Event Data"
              icon="code"
              header-class="text-bold"
            >
              <div class="q-pa-md tw:bg-[var(--o2-hover-accent)] tw:rounded">
                <pre class="event-raw-data">{{
                  JSON.stringify(rawEvent, null, 2)
                }}</pre>
              </div>
            </q-expansion-item>
          </div>
        </template>
      </div>
    </div>
  </q-drawer>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { date } from "quasar";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import searchService from "@/services/search";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import { outlinedAccountTree } from "@quasar/extras/material-icons-outlined";

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

  // Navigate to APM trace viewer with the trace_id
  router.push({
    name: "traceDetails",
    params: {
      traceId: firstTraceId.value,
    },
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

/**
 * Navigate to trace details page with a specific trace_id
 * Used when clicking on individual trace icons
 */
const navigateToSpecificTrace = (traceId: string) => {
  if (!traceId) return;

  router.push({
    name: "traceDetails",
    params: {
      traceId: traceId,
    },
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

defineExpose({
  outlinedAccountTree,
});
</script>

<style lang="scss" scoped>
.event-detail-drawer {
  .tags-title {
    font-size: 1rem;
    color: var(--o2-text-color);
  }

  .event-type-badge {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .event-type-badge-small {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .action-details-grid,
  .error-details-grid,
  .view-details-grid {
    .info-row {
      display: flex;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--o2-border-color);

      &:last-child {
        border-bottom: none;
      }

      .info-label {
        width: 150px;
        color: var(--o2-text-secondary);
        font-weight: 500;
      }

      .info-value {
        flex: 1;
        color: var(--o2-text-color);
        word-break: break-word;
      }
    }
  }

  .event-id-text {
    font-family: monospace;
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
    background-color: var(--o2-hover-accent);
    border-radius: 4px;
    color: var(--o2-text-color);
  }

  .frustration-signals {
    font-size: 0.875rem;
  }

  .related-resources-list {
    .resource-item {
      transition: background-color 0.2s ease;

      .resource-method {
        font-size: 0.75rem;
        color: var(--o2-primary-btn-bg);
      }

      .resource-url {
        font-size: 0.875rem;
        color: var(--o2-text-color);
      }
    }
  }

  .event-raw-data {
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--o2-text-color);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
