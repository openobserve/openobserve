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
    class="resource-detail-drawer"
  >
    <div class="tw:h-full tw:flex tw:flex-col">
      <!-- Header -->
      <div class="tw:p-[0.625rem] tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <div class="flex justify-between items-center">
          <div class="text-bold text-h6">Resource Details</div>
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
        <template v-if="resource">
          <!-- Resource Header -->
          <div class="q-mb-md">
            <div class="text-bold text-subtitle1 q-mb-sm">
              {{ resource.resource_method || 'GET' }} {{ resource.resource_url }}
            </div>
            <div class="row items-center q-gutter-sm text-grey-7">
              <div class="row items-center">
                <q-icon name="schedule" size="sm" class="q-mr-xs" />
                <span>{{ formatTimestamp(resource[store.state.zoConfig.timestamp_column]) }}</span>
              </div>
              <q-separator vertical />
              <div class="row items-center">
                <q-icon name="access_time" size="sm" class="q-mr-xs" />
                <span>{{ formatDuration(resource.resource_duration) }}</span>
              </div>
              <q-separator vertical />
              <div class="row items-center">
                <q-icon
                  :name="getStatusIcon(resource.resource_status_code)"
                  :color="getStatusColor(resource.resource_status_code)"
                  size="sm"
                  class="q-mr-xs"
                />
                <span>{{ resource.resource_status_code || 'N/A' }}</span>
              </div>
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- Resource Details -->
          <div class="q-mb-md">
            <div class="tags-title text-bold q-ml-xs q-mb-sm">Resource Information</div>
            <div class="resource-info-grid">
              <div class="info-row" v-if="resource.resource_type">
                <div class="info-label">Type:</div>
                <div class="info-value">{{ resource.resource_type }}</div>
              </div>
              <div class="info-row" v-if="resource.resource_size">
                <div class="info-label">Size:</div>
                <div class="info-value">{{ formatBytes(resource.resource_size) }}</div>
              </div>
              <div class="info-row" v-if="resource.resource_render_blocking_status">
                <div class="info-label">Render Blocking:</div>
                <div class="info-value">{{ resource.resource_render_blocking_status }}</div>
              </div>
              <div class="info-row" v-if="resource.session?.id">
                <div class="info-label">Session ID:</div>
                <div class="info-value">
                  <code class="session-id-text">{{ formatSessionId(resource.session.id) }}</code>
                </div>
              </div>
              <div class="info-row" v-if="resource.view?.url">
                <div class="info-label">Page URL:</div>
                <div class="info-value ellipsis" :title="resource.view.url">
                  {{ resource.view.url }}
                </div>
              </div>
            </div>
          </div>

          <q-separator class="q-my-md" />

          <!-- Trace Correlation -->
          <TraceCorrelationCard
            v-if="resource._oo?.trace_id"
            :trace-id="resource._oo.trace_id"
            :span-id="resource._oo.span_id"
            :session-id="resource.session?.id"
            :resource-duration="resource.resource_duration"
          />

          <!-- No Trace ID Notice -->
          <div v-else class="q-pa-md text-center tw:bg-[var(--o2-hover-accent)] tw:rounded">
            <q-icon name="info" color="info" size="md" class="q-mb-sm" />
            <div class="text-grey-7">
              No trace information available for this resource.
            </div>
            <div class="text-caption text-grey-6 q-mt-xs">
              Trace correlation requires browser SDK v0.3.3+ with trace propagation enabled.
            </div>
          </div>

          <!-- Session Context -->
          <div v-if="resource.session" class="q-mt-md">
            <q-separator class="q-my-md" />
            <div class="tags-title text-bold q-ml-xs q-mb-sm">Session Context</div>
            <div class="row q-gutter-sm">
              <q-btn
                outline
                no-caps
                color="primary"
                label="View Session Replay"
                icon="play_circle"
                @click="viewSessionReplay"
                class="tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]! hover:tw:bg-[var(--o2-hover-accent)]!"
              />
              <q-btn
                flat
                no-caps
                color="primary"
                label="View All Session Events"
                icon="list"
                @click="viewSessionEvents"
                class="tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]! hover:tw:bg-[var(--o2-hover-accent)]!"
              />
            </div>
          </div>
        </template>
      </div>
    </div>
  </q-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { date, useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  resource: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["update:modelValue"]);

const q = useQuasar();
const router = useRouter();
const store = useStore();

const isOpen = ref(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    isOpen.value = val;
  }
);

watch(isOpen, (val) => {
  emit("update:modelValue", val);
});

const closeDrawer = () => {
  isOpen.value = false;
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return date.formatDate(Math.floor(timestamp / 1000), "MMM DD, YYYY HH:mm:ss.SSS Z");
};

const formatDuration = (duration: number) => {
  if (!duration) return "N/A";
  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }
  return `${(duration / 1000).toFixed(2)}s`;
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "N/A";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
};

const formatSessionId = (id: string) => {
  if (!id) return "";
  return id.length > 16 ? `${id.substring(0, 8)}...${id.substring(id.length - 8)}` : id;
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

const viewSessionReplay = () => {
  if (!props.resource?.session?.id) return;

  // Navigate to session replay viewer
  router.push({
    name: "rumSessions",
    query: {
      session_id: props.resource.session.id,
    },
  });
  closeDrawer();
};

const viewSessionEvents = () => {
  if (!props.resource?.session?.id) return;

  // TODO: Navigate to filtered session events view
  q.notify({
    type: "info",
    message: "Session events view coming soon",
    timeout: 2000,
  });
};
</script>

<style lang="scss" scoped>
.resource-detail-drawer {
  .tags-title {
    font-size: 1rem;
    color: var(--o2-text-color);
  }

  .resource-info-grid {
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

  .session-id-text {
    font-family: monospace;
    font-size: 0.875rem;
    padding: 0.25rem 0.5rem;
    background-color: var(--o2-hover-accent);
    border-radius: 4px;
    color: var(--o2-text-color);
  }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
