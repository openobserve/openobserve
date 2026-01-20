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
  <div class="trace-correlation-card q-mt-md">
    <div class="tags-title text-bold q-ml-xs q-mb-sm">Distributed Trace</div>

    <template v-if="isLoading">
      <div class="q-pa-md text-center">
        <q-spinner-hourglass color="primary" size="1.5rem" />
        <div class="q-mt-sm text-grey-7">Loading trace data...</div>
      </div>
    </template>

    <template v-else-if="!traceId">
      <div class="q-pa-md text-center text-grey-7">
        <q-icon name="info" size="1.5rem" class="q-mb-sm" />
        <div>No trace information available for this event</div>
      </div>
    </template>

    <template v-else>
      <!-- Trace ID Section -->
      <div class="trace-info-section q-pa-md">
        <div class="row items-center q-mb-md">
          <div class="col-3 text-grey-7">Trace ID:</div>
          <div class="col-9 row items-center no-wrap">
            <code class="trace-id-text">{{ formatTraceId(traceId) }}</code>
            <q-btn
              flat
              dense
              size="sm"
              icon="content_copy"
              class="q-ml-xs hover:tw:text-[var(--o2-primary-btn-bg)]"
              @click="copyTraceId"
            >
              <q-tooltip>Copy Trace ID</q-tooltip>
            </q-btn>
          </div>
        </div>

        <div class="row items-center q-mb-md" v-if="spanId">
          <div class="col-3 text-grey-7">Span ID:</div>
          <div class="col-9">
            <code class="span-id-text">{{ formatSpanId(spanId) }}</code>
          </div>
        </div>

        <!-- Span Hierarchy -->
        <div v-if="hasBackendTrace" class="q-mb-md">
          <div class="text-grey-7 q-mb-xs">Span Hierarchy:</div>
          <div class="span-hierarchy q-ml-md">
            <div class="span-item">
              <q-icon name="circle" size="xs" color="blue-6" class="q-mr-xs" />
              <span class="text-grey-8">Application Span</span>
            </div>
            <div class="span-item q-ml-md">
              <q-icon name="arrow_right" size="sm" class="q-mr-xs" />
              <q-icon name="circle" size="xs" color="green-6" class="q-mr-xs" />
              <span class="text-grey-8">Browser SDK Span ({{ formatSpanId(spanId) }})</span>
            </div>
            <div class="span-item q-ml-lg" v-if="backendSpanCount > 0">
              <q-icon name="arrow_right" size="sm" class="q-mr-xs" />
              <q-icon name="circle" size="xs" color="orange-6" class="q-mr-xs" />
              <span class="text-grey-8">Backend Spans ({{ backendSpanCount }})</span>
            </div>
          </div>
        </div>

        <!-- Performance Breakdown -->
        <div v-if="performanceData" class="q-mb-md">
          <div class="text-grey-7 q-mb-xs">Performance Breakdown:</div>
          <div class="performance-breakdown">
            <div class="row items-center q-mb-xs">
              <div class="col-5 text-grey-8">Total Duration:</div>
              <div class="col-7 text-bold">{{ performanceData.total_duration_ms }}ms</div>
            </div>
            <div class="row items-center q-mb-xs" v-if="performanceData.browser_duration_ms">
              <div class="col-5 text-grey-8">Browser:</div>
              <div class="col-7">
                {{ performanceData.browser_duration_ms }}ms
                <span class="text-grey-6">({{ calculatePercentage(performanceData.browser_duration_ms, performanceData.total_duration_ms) }}%)</span>
              </div>
            </div>
            <div class="row items-center q-mb-xs" v-if="performanceData.network_latency_ms">
              <div class="col-5 text-grey-8">Network:</div>
              <div class="col-7">
                {{ performanceData.network_latency_ms }}ms
                <span class="text-grey-6">({{ calculatePercentage(performanceData.network_latency_ms, performanceData.total_duration_ms) }}%)</span>
              </div>
            </div>
            <div class="row items-center q-mb-xs" v-if="performanceData.backend_duration_ms">
              <div class="col-5 text-grey-8">Backend:</div>
              <div class="col-7">
                {{ performanceData.backend_duration_ms }}ms
                <span class="text-grey-6">({{ calculatePercentage(performanceData.backend_duration_ms, performanceData.total_duration_ms) }}%)</span>
              </div>
            </div>
          </div>
        </div>

        <q-separator class="q-my-md" />

        <!-- Action Buttons -->
        <div class="row q-gutter-sm">
          <q-btn
            outline
            no-caps
            color="primary"
            label="View Trace Details"
            icon="timeline"
            :disable="!hasBackendTrace"
            @click="viewTraceDetails"
            class="col tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]! hover:tw:bg-[var(--o2-hover-accent)]!"
          >
            <q-tooltip v-if="!hasBackendTrace">
              Backend trace data not yet available. Trace data may take up to 30 seconds to be ingested.
            </q-tooltip>
          </q-btn>
          <q-btn
            flat
            no-caps
            color="primary"
            label="Refresh"
            icon="refresh"
            @click="refreshTraceData"
            class="tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]! hover:tw:bg-[var(--o2-hover-accent)]!"
          />
        </div>

        <!-- Missing trace notice -->
        <div v-if="!hasBackendTrace && traceId" class="q-mt-md q-pa-sm tw:bg-[var(--o2-hover-accent)] tw:rounded">
          <div class="row items-center">
            <q-icon name="info" color="info" size="sm" class="q-mr-sm" />
            <div class="text-grey-8 text-caption">
              Backend trace data not yet available. Trace data may take up to 30 seconds to be ingested.
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useQuasar, copyToClipboard } from "quasar";
import { useRouter } from "vue-router";
import useTraceCorrelation from "@/composables/rum/useTraceCorrelation";

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

const q = useQuasar();
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

watch(() => props.traceId, (newTraceId) => {
  if (newTraceId) {
    fetchCorrelation();
  }
});

const formatTraceId = (id: string) => {
  if (!id) return "";
  return id.length > 16 ? `${id.substring(0, 8)}...${id.substring(id.length - 8)}` : id;
};

const formatSpanId = (id: string) => {
  if (!id) return "";
  return id.length > 12 ? `${id.substring(0, 6)}...${id.substring(id.length - 6)}` : id;
};

const calculatePercentage = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const copyTraceId = () => {
  copyToClipboard(props.traceId);
  q.notify({
    type: "positive",
    message: "Trace ID copied to clipboard",
    timeout: 1500,
  });
};

const viewTraceDetails = () => {
  // TODO: Navigate to trace detail view
  // This will be implemented once we know the trace viewer route
  q.notify({
    type: "info",
    message: "Trace detail view coming soon",
    timeout: 2000,
  });
};

const refreshTraceData = () => {
  fetchCorrelation();
  q.notify({
    type: "info",
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
