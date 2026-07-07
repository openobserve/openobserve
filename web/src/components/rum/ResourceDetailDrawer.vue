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
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div
      class="p-[0.625rem] border-b border-solid border-[var(--o2-border-color)]"
    >
      <div class="flex justify-between items-center">
        <div class="font-bold text-xl font-semibold">Resource Details</div>
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
    <div class="flex-1 overflow-y-auto p-[0.625rem]">
      <template v-if="resource">
        <!-- Resource Header -->
        <div class="mb-3">
          <div class="font-bold text-base font-medium mb-2">
            {{ resource.resource_method || "GET" }}
            {{ resource.resource_url }}
          </div>
          <div class="flex items-center gap-2 text-gray-400">
            <div class="flex items-center">
              <OIcon name="schedule" size="sm" class="mr-1" />
              <span>{{
                formatTimestamp(resource[store.state.zoConfig.timestamp_column])
              }}</span>
            </div>
            <OSeparator vertical />
            <div class="flex items-center">
              <OIcon name="access-time" size="sm" class="mr-1" />
              <span>{{ formatDuration(resource.resource_duration) }}</span>
            </div>
            <OSeparator vertical />
            <div class="flex items-center">
              <OIcon
                :name="getStatusIcon(resource.resource_status_code)"
                :class="['mr-1', getStatusColorClass(resource.resource_status_code)]"
                size="sm"
              />
              <span>{{ resource.resource_status_code || "N/A" }}</span>
            </div>
          </div>
        </div>

        <OSeparator class="my-4" />

        <!-- Resource Details -->
        <div class="mb-3">
          <div class="text-base text-[var(--o2-text-color)] font-bold ml-1 mb-2">
            Resource Information
          </div>
          <div>
            <div class="flex py-2 px-3 border-b border-solid border-[var(--o2-border-color)]" v-if="resource.resource_type">
              <div class="w-[150px] text-[var(--o2-text-secondary)] font-medium shrink-0">Type:</div>
              <div class="flex-1 text-[var(--o2-text-color)] break-words">{{ resource.resource_type }}</div>
            </div>
            <div class="flex py-2 px-3 border-b border-solid border-[var(--o2-border-color)]" v-if="resource.resource_size">
              <div class="w-[150px] text-[var(--o2-text-secondary)] font-medium shrink-0">Size:</div>
              <div class="flex-1 text-[var(--o2-text-color)] break-words">
                {{ formatBytes(resource.resource_size) }}
              </div>
            </div>
            <div
              class="flex py-2 px-3 border-b border-solid border-[var(--o2-border-color)]"
              v-if="resource.resource_render_blocking_status"
            >
              <div class="w-[150px] text-[var(--o2-text-secondary)] font-medium shrink-0">Render Blocking:</div>
              <div class="flex-1 text-[var(--o2-text-color)] break-words">
                {{ resource.resource_render_blocking_status }}
              </div>
            </div>
            <div class="flex py-2 px-3 border-b border-solid border-[var(--o2-border-color)]" v-if="resource.session?.id">
              <div class="w-[150px] text-[var(--o2-text-secondary)] font-medium shrink-0">Session ID:</div>
              <div class="flex-1 text-[var(--o2-text-color)] break-words">
                <code
                  data-test="resource-detail-drawer-session-id-text"
                  class="font-mono text-sm px-2 py-1 bg-(--color-surface-accent) rounded text-[var(--o2-text-color)]"
                >{{
                  formatSessionId(resource.session.id)
                }}</code>
              </div>
            </div>
            <div class="flex py-2 px-3" v-if="resource.view?.url">
              <div class="w-[150px] text-[var(--o2-text-secondary)] font-medium shrink-0">Page URL:</div>
              <div class="flex-1 text-[var(--o2-text-color)] truncate" :title="resource.view.url">
                {{ resource.view.url }}
              </div>
            </div>
          </div>
        </div>

        <OSeparator class="my-4" />

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
          class="p-3 text-center bg-(--color-surface-accent) rounded"
        >
          <OIcon name="info" size="md" class="mb-2" />
          <div class="text-gray-400">
            No trace information available for this resource.
          </div>
          <div class="text-xs text-gray-400 mt-1">
            Trace correlation requires browser SDK v0.3.3+ with trace
            propagation enabled.
          </div>
        </div>

        <!-- Session Context -->
        <div v-if="resource.session?.id" class="mt-3">
          <OSeparator class="my-4" />
          <div class="text-base text-[var(--o2-text-color)] font-bold ml-1 mb-2">
            Session Context
          </div>
          <div class="flex gap-2">
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
  if (!statusCode) return "text-gray-500";
  if (statusCode >= 200 && statusCode < 300) return "text-[var(--o2-positive)]";
  if (statusCode >= 300 && statusCode < 400) return "text-[var(--o2-info)]";
  if (statusCode >= 400 && statusCode < 500) return "text-[var(--o2-warning)]";
  return "text-[var(--o2-negative)]";
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

