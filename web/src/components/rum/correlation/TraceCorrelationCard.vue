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
  <div class="border-card-glass-border rounded-default mt-3 border border-solid">
    <div class="text-text-heading mb-2 ml-1 text-base font-bold">
      {{ t("traces.correlation.distributedTrace") }}
    </div>

    <template v-if="isLoading">
      <div class="p-3 text-center">
        <OSpinner size="sm" />
        <div class="text-text-muted mt-2">{{ t("traces.correlation.loadingTraceData") }}</div>
      </div>
    </template>

    <template v-else-if="!traceId">
      <div class="text-text-muted p-3 text-center">
        <OIcon name="info" size="md" class="mb-2" />
        <div>{{ t("traces.correlation.noTraceInfoAvailable") }}</div>
      </div>
    </template>

    <template v-else>
      <!-- Trace ID Section -->
      <div class="bg-card-glass-bg p-3">
        <div class="mb-3 flex items-center">
          <div class="text-text-label w-1/4">{{ t("traces.correlation.traceIdLabel") }}</div>
          <div class="flex w-3/4 flex-nowrap items-center">
            <code
              data-test="trace-correlation-card-trace-id-text"
              class="bg-surface-accent rounded-default text-text-body px-2 py-1 font-mono text-sm"
              >{{ formatTraceId(traceId) }}</code
            >
            <OButton
              icon-left="content-copy"
              variant="ghost"
              size="icon-sm"
              class="ml-1"
              @click="copyTraceId"
            >
              <OTooltip :content="t('traces.correlation.copyTraceId')" />
            </OButton>
          </div>
        </div>

        <div class="mb-3 flex items-center" v-if="spanId">
          <div class="text-text-label w-1/4">{{ t("traces.correlation.spanIdLabel") }}</div>
          <div class="w-3/4">
            <code
              data-test="trace-correlation-card-span-id-text"
              class="bg-surface-accent rounded-default text-text-body px-2 py-1 font-mono text-sm"
              >{{ formatSpanId(spanId) }}</code
            >
          </div>
        </div>

        <!-- Span Hierarchy -->
        <div v-if="hasBackendTrace" class="mb-3">
          <div class="text-text-label mb-1">{{ t("traces.correlation.spanHierarchy") }}</div>
          <div class="ml-3">
            <div class="flex items-center py-1 text-sm">
              <OIcon name="circle" size="xs" class="mr-1" />
              <span class="text-text-secondary">{{ t("traces.correlation.applicationSpan") }}</span>
            </div>
            <div class="ml-3 flex items-center py-1 text-sm">
              <OIcon name="arrow-right" size="sm" class="mr-1" />
              <OIcon name="circle" size="xs" class="mr-1" />
              <span class="text-text-secondary"
                >{{ t("traces.correlation.browserSdkSpanPrefix") }}{{ formatSpanId(spanId)
                }}{{ t("traces.correlation.closingParen") }}</span
              >
            </div>
            <div class="ml-4 flex items-center py-1 text-sm" v-if="backendSpanCount > 0">
              <OIcon name="arrow-right" size="sm" class="mr-1" />
              <OIcon name="circle" size="xs" class="mr-1" />
              <span class="text-text-secondary"
                >{{ t("traces.correlation.backendSpansPrefix") }}{{ backendSpanCount
                }}{{ t("traces.correlation.closingParen") }}</span
              >
            </div>
          </div>
        </div>

        <!-- Performance Breakdown -->
        <div v-if="performanceData" class="mb-3">
          <div class="text-text-label mb-1">{{ t("traces.correlation.performanceBreakdown") }}</div>
          <div class="bg-surface-accent rounded-default p-2 text-sm">
            <div class="mb-1 flex items-center">
              <div class="text-text-label w-5/12">{{ t("traces.correlation.totalDuration") }}</div>
              <div class="w-7/12 font-bold">{{ performanceData.total_duration_ms }}ms</div>
            </div>
            <div class="mb-1 flex items-center" v-if="performanceData.browser_duration_ms">
              <div class="text-text-label w-5/12">{{ t("traces.correlation.browserLabel") }}</div>
              <div class="w-7/12">
                {{ performanceData.browser_duration_ms }}ms
                <span class="text-text-secondary"
                  >({{
                    calculatePercentage(
                      performanceData.browser_duration_ms,
                      performanceData.total_duration_ms,
                    )
                  }}%)</span
                >
              </div>
            </div>
            <div class="mb-1 flex items-center" v-if="performanceData.network_latency_ms">
              <div class="text-text-label w-5/12">{{ t("traces.correlation.networkLabel") }}</div>
              <div class="w-7/12">
                {{ performanceData.network_latency_ms }}ms
                <span class="text-text-secondary"
                  >({{
                    calculatePercentage(
                      performanceData.network_latency_ms,
                      performanceData.total_duration_ms,
                    )
                  }}%)</span
                >
              </div>
            </div>
            <div class="mb-1 flex items-center" v-if="performanceData.backend_duration_ms">
              <div class="text-text-label w-5/12">{{ t("traces.correlation.backendLabel") }}</div>
              <div class="w-7/12">
                {{ performanceData.backend_duration_ms }}ms
                <span class="text-text-secondary"
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

        <OSeparator class="my-4" />

        <!-- Action Buttons -->
        <div class="flex gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!hasBackendTrace"
            @click="viewTraceDetails"
          >
            <OIcon name="git-branch" size="sm" class="mr-1" />
            {{ t("traces.correlation.viewTraceDetails") }}
            <OTooltip
              v-if="!hasBackendTrace"
              :content="t('traces.correlation.backendTraceNotAvailable')"
            />
          </OButton>
          <OButton icon-left="refresh" variant="ghost" size="sm-action" @click="refreshTraceData">
            {{ t("common.refresh") }}
          </OButton>
        </div>

        <!-- Missing trace notice -->
        <div v-if="!hasBackendTrace && traceId" class="bg-surface-accent rounded-default mt-3 p-2">
          <div class="flex items-center">
            <OIcon name="info" size="sm" class="mr-2" />
            <div class="text-text-secondary text-xs">
              {{ t("traces.correlation.backendTraceNotAvailable") }}
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
import useTraceCorrelation from "@/composables/rum/useTraceCorrelation";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
  /** µs timestamp of the correlated event; scopes the trace lookup to a
   * ±30 min window around it instead of the trailing hour. */
  timestamp: {
    type: Number,
    default: 0,
  },
});

const HALF_HOUR_US = 1800000000;

const correlationRange = computed(() =>
  props.timestamp
    ? {
        startTime: props.timestamp - HALF_HOUR_US,
        endTime: props.timestamp + HALF_HOUR_US,
      }
    : null,
);

const { isLoading, hasBackendTrace, fetchCorrelation, backendSpanCount, performanceData } =
  useTraceCorrelation(
    computed(() => props.traceId),
    correlationRange,
  );

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
