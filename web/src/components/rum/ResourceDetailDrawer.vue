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
  <div class="tw:h-full tw:flex tw:flex-col">
    <!-- Header -->
    <div
      class="tw:p-[0.625rem] tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]"
    >
      <div class="tw:flex tw:justify-between tw:items-center">
        <div class="tw:font-bold tw:text-xl tw:font-semibold">Resource Details</div>
        <OButton
          icon-left="close"
          variant="ghost"
          size="icon-sm"
          data-test="close-drawer-btn"
          @click="closeDrawer"
        />
      </div>
    </div>

    <!-- Content -->
    <div class="tw:flex-1 tw:overflow-y-auto tw:p-[0.625rem]">
      <template v-if="resource">
        <!-- Resource Header -->
        <div class="tw:mb-3">
          <div class="tw:font-bold tw:text-base tw:font-medium tw:mb-2">
            {{ resource.resource_method || "GET" }}
            {{ resource.resource_url }}
          </div>
          <div class="tw:flex tw:items-center tw:gap-2 tw:text-gray-400">
            <div class="tw:flex tw:items-center">
              <OIcon name="schedule" size="sm" class="tw:mr-1" />
              <span>{{
                formatTimestamp(resource[store.state.zoConfig.timestamp_column])
              }}</span>
            </div>
            <OSeparator vertical />
            <div class="tw:flex tw:items-center">
              <OIcon name="access-time" size="sm" class="tw:mr-1" />
              <span>{{ formatDuration(resource.resource_duration) }}</span>
            </div>
            <OSeparator vertical />
            <div class="tw:flex tw:items-center">
              <OIcon
                :name="getStatusIcon(resource.resource_status_code)"
                :class="['tw:mr-1', getStatusColorClass(resource.resource_status_code)]"
                size="sm"
              />
              <span>{{ resource.resource_status_code || "N/A" }}</span>
            </div>
          </div>
        </div>

        <OSeparator class="tw:my-4" />

        <!-- Resource Details -->
        <div class="tw:mb-3">
          <div class="tags-title tw:font-bold tw:ml-1 tw:mb-2">
            Resource Information
          </div>
          <div class="resource-info-grid">
            <div class="info-row" v-if="resource.resource_type">
              <div class="info-label">Type:</div>
              <div class="info-value">{{ resource.resource_type }}</div>
            </div>
            <div class="info-row" v-if="resource.resource_size">
              <div class="info-label">Size:</div>
              <div class="info-value">
                {{ formatBytes(resource.resource_size) }}
              </div>
            </div>
            <div
              class="info-row"
              v-if="resource.resource_render_blocking_status"
            >
              <div class="info-label">Render Blocking:</div>
              <div class="info-value">
                {{ resource.resource_render_blocking_status }}
              </div>
            </div>
            <div class="info-row" v-if="resource.session?.id">
              <div class="info-label">Session ID:</div>
              <div class="info-value">
                <code class="session-id-text">{{
                  formatSessionId(resource.session.id)
                }}</code>
              </div>
            </div>
            <div class="info-row" v-if="resource.view?.url">
              <div class="info-label">Page URL:</div>
              <div class="info-value tw:truncate" :title="resource.view.url">
                {{ resource.view.url }}
              </div>
            </div>
          </div>
        </div>

        <OSeparator class="tw:my-4" />

        <!-- Trace Correlation -->
        <TraceCorrelationCard
          v-if="resource._oo?.trace_id"
          :trace-id="resource._oo_trace_id"
          :span-id="resource._oo.span_id"
          :session-id="resource.session?.id"
          :resource-duration="resource.resource_duration"
        />

        <!-- No Trace ID Notice -->
        <div
          v-else
          class="tw:p-3 tw:text-center tw:bg-[var(--o2-hover-accent)] tw:rounded"
        >
          <OIcon name="info" size="md" class="tw:mb-2" />
          <div class="tw:text-gray-400">
            No trace information available for this resource.
          </div>
          <div class="tw:text-xs tw:text-gray-400 tw:mt-1">
            Trace correlation requires browser SDK v0.3.3+ with trace
            propagation enabled.
          </div>
        </div>

        <!-- Session Context -->
        <div v-if="resource.session?.id" class="tw:mt-3">
          <OSeparator class="tw:my-4" />
          <div class="tags-title tw:font-bold tw:ml-1 tw:mb-2">
            Session Context
          </div>
          <div class="tw:flex tw:gap-2">
            <OButton
              icon-left="play-circle"
              variant="outline"
              size="sm-action"
              data-test="view-session-replay-btn"
              @click="viewSessionReplay"
            >
              View Session Replay
            </OButton>
            <OButton
              icon-left="format-list-bulleted"
              variant="ghost"
              size="sm-action"
              data-test="view-session-events-btn"
              @click="viewSessionEvents"
            >
              View All Session Events
            </OButton>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { formatToHuman } from "@/utils/date";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';


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

const router = useRouter();
const store = useStore();

const isOpen = ref(props.modelValue);

watch(
  () => props.modelValue,
  (val) => {
    isOpen.value = val;
  },
);

watch(isOpen, (val) => {
  emit("update:modelValue", val);
});

const closeDrawer = () => {
  isOpen.value = false;
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return formatToHuman(timestamp);
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
  return id.length > 16
    ? `${id.substring(0, 8)}...${id.substring(id.length - 8)}`
    : id;
};

const getStatusIcon = (statusCode: number) => {
  if (!statusCode) return "help-outline";
  if (statusCode >= 200 && statusCode < 300) return "check-circle";
  if (statusCode >= 300 && statusCode < 400) return "info";
  if (statusCode >= 400 && statusCode < 500) return "warning";
  return "error";
};

const getStatusColorClass = (statusCode: number) => {
  if (!statusCode) return "tw:text-gray-500";
  if (statusCode >= 200 && statusCode < 300) return "tw:text-[var(--o2-positive)]";
  if (statusCode >= 300 && statusCode < 400) return "tw:text-[var(--o2-info)]";
  if (statusCode >= 400 && statusCode < 500) return "tw:text-[var(--o2-warning)]";
  return "tw:text-[var(--o2-negative)]";
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
  toast({
    variant: "info",
    message: "Session events view coming soon",
  });
};

defineExpose({
  viewSessionEvents,
});
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
