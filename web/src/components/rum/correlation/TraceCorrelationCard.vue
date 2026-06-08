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
  <div class="trace-correlation-card tw:mt-3">
    <div class="tags-title tw:font-bold tw:ml-1 tw:mb-2">Distributed Trace</div>

    <template v-if="isLoading">
      <div class="tw:p-3 tw:text-center">
        <OSpinner size="sm" />
        <div class="tw:mt-2 tw:text-gray-400">Loading trace data...</div>
      </div>
    </template>

    <template v-else-if="!traceId">
      <div class="tw:p-3 tw:text-center tw:text-gray-400">
        <OIcon name="info" size="md" class="tw:mb-2" />
        <div>No trace information available for this event</div>
      </div>
    </template>

    <template v-else>
      <!-- Trace ID Section -->
      <div class="trace-info-section tw:p-3">
        <div class="tw:flex tw:items-center tw:mb-3">
          <div class="tw:w-1/4 tw:text-gray-400">Trace ID:</div>
          <div class="tw:w-3/4 tw:flex tw:items-center tw:flex-nowrap">
            <code class="trace-id-text">{{ formatTraceId(traceId) }}</code>
            <OButton
              icon-left="content-copy"
              variant="ghost"
              size="icon-sm"
              class="tw:ml-1"
              @click="copyTraceId"
            >
              <OTooltip content="Copy Trace ID" />
            </OButton>
          </div>
        </div>

        <div class="tw:flex tw:items-center tw:mb-3" v-if="spanId">
          <div class="tw:w-1/4 tw:text-gray-400">Span ID:</div>
          <div class="tw:w-3/4">
            <code class="span-id-text">{{ formatSpanId(spanId) }}</code>
          </div>
        </div>

        <!-- Span Hierarchy -->
        <div v-if="hasBackendTrace" class="tw:mb-3">
          <div class="tw:text-gray-400 tw:mb-1">Span Hierarchy:</div>
          <div class="span-hierarchy tw:ml-3">
            <div class="span-item">
              <OIcon name="circle" size="xs" class="tw:mr-1" />
              <span class="tw:text-gray-500">Application Span</span>
            </div>
            <div class="span-item tw:ml-3">
              <OIcon name="arrow-right" size="sm" class="tw:mr-1" />
              <OIcon name="circle" size="xs" class="tw:mr-1" />
              <span class="tw:text-gray-500"
                >Browser SDK Span ({{ formatSpanId(spanId) }})</span
              >
            </div>
            <div class="span-item tw:ml-4" v-if="backendSpanCount > 0">
              <OIcon name="arrow-right" size="sm" class="tw:mr-1" />
              <OIcon
                name="circle"
                size="xs"
                class="tw:mr-1"
              />
              <span class="tw:text-gray-500"
                >Backend Spans ({{ backendSpanCount }})</span
              >
            </div>
          </div>
        </div>

        <!-- Performance Breakdown -->
        <div v-if="performanceData" class="tw:mb-3">
          <div class="tw:text-gray-400 tw:mb-1">Performance Breakdown:</div>
          <div class="performance-breakdown">
            <div class="tw:flex tw:items-center tw:mb-1">
              <div class="tw:w-5/12 tw:text-gray-500">Total Duration:</div>
              <div class="tw:w-7/12 tw:font-bold">
                {{ performanceData.total_duration_ms }}ms
              </div>
            </div>
            <div
              class="tw:flex tw:items-center tw:mb-1"
              v-if="performanceData.browser_duration_ms"
            >
              <div class="tw:w-5/12 tw:text-gray-500">Browser:</div>
              <div class="tw:w-7/12">
                {{ performanceData.browser_duration_ms }}ms
                <span class="tw:text-gray-400"
                  >({{
                    calculatePercentage(
                      performanceData.browser_duration_ms,
                      performanceData.total_duration_ms,
                    )
                  }}%)</span
                >
              </div>
            </div>
            <div
              class="tw:flex tw:items-center tw:mb-1"
              v-if="performanceData.network_latency_ms"
            >
              <div class="tw:w-5/12 tw:text-gray-500">Network:</div>
              <div class="tw:w-7/12">
                {{ performanceData.network_latency_ms }}ms
                <span class="tw:text-gray-400"
                  >({{
                    calculatePercentage(
                      performanceData.network_latency_ms,
                      performanceData.total_duration_ms,
                    )
                  }}%)</span
                >
              </div>
            </div>
            <div
              class="tw:flex tw:items-center tw:mb-1"
              v-if="performanceData.backend_duration_ms"
            >
              <div class="tw:w-5/12 tw:text-gray-500">Backend:</div>
              <div class="tw:w-7/12">
                {{ performanceData.backend_duration_ms }}ms
                <span class="tw:text-gray-400"
                  >({{
                    calculatePercentage(
                      performanceData.backend_duration_ms,
                      performanceData.total_duration_ms,
                    )
                  }}%)</span
                >
              </div>
            </div>
          </div>
        </div>

        <OSeparator class="tw:my-4" />

        <!-- Action Buttons -->
        <div class="tw:flex tw:gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!hasBackendTrace"
            @click="viewTraceDetails"
          >
            <OIcon name="git-branch" size="sm" class="tw:mr-1" />
            View Trace Details
            <OTooltip v-if="!hasBackendTrace" content="Backend trace data not yet available. Trace data may take up to 30 seconds to be ingested." />
          </OButton>
          <OButton
            icon-left="refresh"
            variant="ghost"
            size="sm-action"
            @click="refreshTraceData"
          >
            Refresh
          </OButton>
        </div>

        <!-- Missing trace notice -->
        <div
          v-if="!hasBackendTrace && traceId"
          class="tw:mt-3 tw:p-2 tw:bg-[var(--o2-hover-accent)] tw:rounded"
        >
          <div class="tw:flex tw:items-center">
            <OIcon name="info" size="sm" class="tw:mr-2" />
            <div class="tw:text-gray-500 tw:text-xs">
              Backend trace data not yet available. Trace data may take up to 30
              seconds to be ingested.
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { copyToClipboard } from "@/utils/clipboard";
import { useRouter } from "vue-router";
import useTraceCorrelation from "@/composables/rum/useTraceCorrelation";
import OButton from '@/lib/core/Button/OButton.vue';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

const props = defineProps({
  traceId: {
    type: String,
    default: "",
  },
  spanId: {
    type: String,
    default: "",
  },
  sessionId: {
    type: String,
    default: "",
  },
  resourceDuration: {
    type: Number,
    default: 0,
  },
});

const router = useRouter();

const {
  correlationData,
  isLoading,
  hasBackendTrace,
  fetchCorrelation,
  backendSpanCount,
  performanceData,
} = useTraceCorrelation(computed(() => props.traceId));

onMounted(() => {
  if (props.traceId) {
    fetchCorrelation();
  }
});

watch(
  () => props.traceId,
  (newTraceId) => {
    if (newTraceId) {
      fetchCorrelation();
    }
  },
);

const formatTraceId = (id: string) => {
  if (!id) return "";
  return id.length > 16
    ? `${id.substring(0, 8)}...${id.substring(id.length - 8)}`
    : id;
};

const formatSpanId = (id: string) => {
  if (!id) return "";
  return id.length > 12
    ? `${id.substring(0, 6)}...${id.substring(id.length - 6)}`
    : id;
};

const calculatePercentage = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const copyTraceId = () => {
  copyToClipboard(props.traceId, {
    successMessage: "Trace ID copied to clipboard",
    timeout: 1500,
  });
};

const viewTraceDetails = () => {
  // TODO: Navigate to trace detail view
  // This will be implemented once we know the trace viewer route
  toast({
    variant: "info",
    message: "Trace detail view coming soon",
  });
};

const refreshTraceData = () => {
  fetchCorrelation();
  toast({
    variant: "info",
    message: "Refreshing trace data...",
    timeout: 1000,
  });
};
</script>

<style lang="scss" scoped>
.trace-correlation-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 4px;
}

.trace-info-section {
  background-color: var(--o2-card-bg);
}

.trace-id-text,
.span-id-text {
  font-family: monospace;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--o2-hover-accent);
  border-radius: 4px;
  color: var(--o2-text-color);
}

.span-hierarchy {
  .span-item {
    display: flex;
    align-items: center;
    padding: 0.25rem 0;
    font-size: 0.875rem;
  }
}

.performance-breakdown {
  padding: 0.5rem;
  background-color: var(--o2-hover-accent);
  border-radius: 4px;
  font-size: 0.875rem;
}

.tags-title {
  font-size: 1rem;
  color: var(--o2-text-color);
}
</style>
