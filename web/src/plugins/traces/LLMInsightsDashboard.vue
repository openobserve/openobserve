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
  <!-- Page wrapper is intentionally chrome-less: KPI tiles and trend
       panels each carry their own `card-container`. Wrapping them in
       another card-container would render same-bg-on-same-bg and the
       inner cards would visually disappear (no border contrast). -->
  <div
    class="llm-insights-dashboard tw:h-full tw:flex tw:flex-col tw:px-[0.625rem]"
  >
    <!-- Toolbar: stream selector — hidden when no streams are available -->
    <div
      v-if="availableStreams.length > 0"
      class="tw:flex tw:items-center tw:justify-end tw:gap-[0.5rem] tw:py-[0.5rem]"
    >
      <div
        data-test="llm-insights-stream-selector"
        class="tw:w-[14rem] tw:flex-shrink-0"
      >
        <OSelect
          v-model="activeStream"
          :label="t('traces.sessionsList.streamLabel')"
          label-position="inside"
          :options="availableStreams.map((s) => ({ label: s, value: s }))"
          labelKey="label"
          valueKey="value"
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          @update:model-value="onStreamChange"
        />
      </div>
    </div>

    <!-- Skeleton shown only while a real request is in flight -->
    <LLMInsightsSkeleton v-if="!streamsLoaded || loading" class="tw:flex-1" />

    <!-- Generic error state — kept separate because a failed request is a
         different signal from "no data yet". Once we have a result we fall
         through to the consolidated empty / dashboard branches below. -->
    <EvalEmptyState
      v-else-if="error && hasLoadedOnce"
      data-test="llm-insights-empty-error"
      icon="error-outline"
      title="Failed to load LLM Insights"
      :description="error || ''"
      cta-label="Retry"
      cta-data-test="llm-insights-retry-btn"
      @create="loadInsights()"
    />

    <!-- Consolidated empty state — single OEmptyState covers all three
         "no data" shapes (no LLM streams in the org, the active stream has
         no gen_ai_* fields, or the time window returned nothing). The page
         doesn't expose a search/filter widget, so we never set `:filtered`
         — both the first-run and the "no data right now" cases land on
         the preset's "Instrument with OpenTelemetry" call to action. -->
    <div
      v-else-if="isEmpty"
      class="tw:flex-1 tw:min-h-0 tw:flex tw:items-center tw:justify-center"
      data-test="llm-insights-empty"
    >
      <OEmptyState
        size="hero"
        preset="no-llm-insights"
        @action="onEmptyAction"
      />
    </div>

    <!-- Dashboard content — scrollable panel area -->
    <div v-else class="tw:flex-1 tw:overflow-y-auto tw:pb-[0.625rem]">
      <!-- KPI Cards Row -->
      <div class="tw:grid tw:grid-cols-5 tw:gap-[0.625rem] tw:mt-[0.625rem] tw:mb-[0.625rem]">
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="kpi-card card-container tw:rounded-lg tw:flex tw:flex-col tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.25rem]"
        >
          <div class="tw:flex tw:flex-col tw:gap-[0.25rem]">
            <div class="kpi-label tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-muted)]">
              {{ card.label }}
            </div>
            <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
              <span class="tw:text-[1.4rem] tw:font-bold tw:leading-none tw:text-[var(--o2-text-primary)]">
                {{ card.value }}
              </span>
              <span
                v-if="card.unit"
                class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-secondary)]"
              >
                {{ card.unit }}
              </span>
            </div>
            <div
              v-if="card.trend"
              class="kpi-trend tw:text-[0.65rem] tw:font-medium tw:flex tw:items-center tw:gap-[0.25rem]"
              :class="`kpi-trend--${card.trend.sentiment}`"
            >
              <span class="kpi-trend-arrow">{{ trendArrow(card.trend.direction) }}</span>
              <span>
                {{ card.trend.deltaPct.toFixed(card.trend.deltaPct < 10 ? 1 : 0) }}%
                vs prev{{ previousWindowLabel ? " " + previousWindowLabel : "" }}
              </span>
            </div>
          </div>
          <KpiSparkline
            v-if="card.sparkData && card.sparkData.length > 1"
            :data="card.sparkData"
            :color="card.sparkColor"
            :height="32"
            class="tw:mt-auto"
          />
        </div>
      </div>

      <!-- Trend panels (config-driven) -->
      <div class="tw:grid tw:grid-cols-2 tw:gap-[0.625rem]">
        <div
          v-for="panel in LLM_INSIGHTS_PANELS"
          :key="panel.id"
          :class="panel.layout.colSpan === 2 ? 'tw:col-span-2' : ''"
        >
          <LLMTrendPanel
            :panel="panel"
            :streamName="activeStream"
            :startTime="startTime"
            :endTime="endTime"
            @view-trace="onViewTrace"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useLLMInsights } from "./composables/useLLMInsights";
import {
  computeTrend,
  trendArrow,
  splitNumberWithUnit,
  splitDuration,
  splitCost,
  formatWindowLabel,
  type KpiTrend,
} from "./llmInsightsDashboard.utils";
import KpiSparkline from "./KpiSparkline.vue";
import LLMTrendPanel from "./LLMTrendPanel.vue";
import LLMInsightsSkeleton from "./LLMInsightsSkeleton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import EvalEmptyState from "@/components/EvalEmptyState.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";
import useStreams from "@/composables/useStreams";

const { getStreams } = useStreams();
const { t } = useI18n();
const router = useRouter();
const store = useStore();

interface Props {
  streamName: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
}

const props = defineProps<Props>();

// --- Stream selection (mirrors ServiceGraph's pattern) ---
const STREAM_LS_KEY = "llmInsights_streamFilter";

const {
  kpi,
  kpiPrev,
  sparklines,
  loading,
  error,
  fetchAll,
  cancelAll,
  hasLoadedOnce,
  availableStreams,
  streamsLoaded,
} = useLLMInsights();

// activeStream is component-local (drives the q-select v-model), but its
// initial value falls back to localStorage / parent prop. Once the streams
// list is reconciled, it's clamped to a valid option.
const activeStream = ref<string>(
  localStorage.getItem(STREAM_LS_KEY) || props.streamName || "",
);

function onViewTrace(traceId: string) {
  if (!traceId) return;
  router.push({
    name: "traceDetails",
    query: {
      stream: activeStream.value,
      trace_id: traceId,
      from: props.startTime,
      to: props.endTime,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

async function loadTraceStreams() {
  streamsLoaded.value = false;
  try {
    const res = await getStreams("traces", false, false);
    const list = res?.list || [];
    const llmStreams = list.filter(
      (stream: any) => stream?.settings?.is_llm_stream !== false,
    );
    availableStreams.value = llmStreams.map((stream: any) => stream.name);
    if (!availableStreams.value.includes(activeStream.value)) {
      activeStream.value = availableStreams.value[0] || "";
    }
  } catch (e) {
    console.error("Error loading trace streams:", e);
    availableStreams.value = [];
    activeStream.value = "";
  } finally {
    streamsLoaded.value = true;
  }
}

const hasData = computed(() => kpi.value.requestCount > 0);

// Short label for the comparison window — drives the KPI trend chip
// text, e.g. "▲ 100% vs prev 12h". Computed from the current
// time-range props rather than the user-picked relative period so it
// stays correct for absolute ranges too.
const previousWindowLabel = computed(() =>
  formatWindowLabel(props.endTime - props.startTime),
);

// DataFusion returns "Schema error: No field named gen_ai_..." when the
// chosen stream lacks LLM instrumentation. Detect that specific case so we
// can show a friendly empty state instead of the generic error fallback.
const streamHasNoLLMFields = computed(() => {
  if (!error.value) return false;
  const msg = String(error.value);
  return /No field named\s+gen_ai_/i.test(msg);
});

// Drives the consolidated OEmptyState branch in the template. True for any
// shape of "no LLM data right now": no LLM streams in the org, the active
// stream has no gen_ai_* fields, or the load completed and the KPI rollup
// came back empty. The dashboard's KPI tiles + trend panels render only
// when this is false — so we never show "0" tiles next to empty charts.
const isEmpty = computed<boolean>(
  () =>
    streamsLoaded.value &&
    (availableStreams.value.length === 0 ||
      streamHasNoLLMFields.value ||
      (hasLoadedOnce.value && !hasData.value)),
);

// The empty-state action card emits its `id` here. `instrument` routes to
// the in-app AI integrations page (OpenTelemetry / Gen-AI guides) — the
// closest thing we have to a "set this up" landing surface and keeps the
// user inside the product instead of bouncing to docs.
function onEmptyAction(id?: string) {
  if (id !== "instrument") return;
  router.push({
    name: "ai-integrations",
    query: {
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

interface KpiCard {
  label: string;
  value: string;
  unit?: string;
  trend?: KpiTrend | null;
  sparkData?: number[];
  sparkColor?: string;
}

const kpiCards = computed<KpiCard[]>(() => {
  const tokens = splitNumberWithUnit(kpi.value.totalTokens);
  const traces = splitNumberWithUnit(kpi.value.traceCount);
  const p95 = splitDuration(kpi.value.p95DurationMicros);
  const errorRate =
    kpi.value.traceCount > 0
      ? (kpi.value.errorCount / kpi.value.traceCount) * 100
      : 0;

  const errorRatePrev =
    kpiPrev.value.traceCount > 0
      ? (kpiPrev.value.errorCount / kpiPrev.value.traceCount) * 100
      : 0;

  // Cost comes straight from SUM(gen_ai_usage_cost) on the KPI summary.
  // If it's 0, either there are no LLM spans in the window or the SDK
  // isn't emitting cost; either way we render "$0".
  const costTrend = computeTrend(
    kpi.value.totalCost,
    kpiPrev.value.totalCost,
    true,
  );

  const costCard: KpiCard = {
    label: "Total Cost",
    ...splitCost(kpi.value.totalCost),
    trend: costTrend,
    sparkData: sparklines.value.cost,
    sparkColor: "#0ea5e9",
  };

  return [
    costCard,
    {
      label: "Total Tokens",
      value: tokens.value,
      unit: tokens.unit,
      trend: computeTrend(kpi.value.totalTokens, kpiPrev.value.totalTokens, true),
      sparkData: sparklines.value.tokens,
      sparkColor: "#a855f7",
    },
    {
      label: "Total Traces",
      value: traces.value,
      unit: traces.unit,
      trend: computeTrend(kpi.value.traceCount, kpiPrev.value.traceCount, true),
      sparkData: sparklines.value.traces,
      sparkColor: "#3b82f6",
    },
    {
      label: "P95 Latency",
      value: p95.value,
      unit: p95.unit,
      trend: computeTrend(
        kpi.value.p95DurationMicros,
        kpiPrev.value.p95DurationMicros,
        true,
      ),
      sparkData: sparklines.value.p95Micros,
      sparkColor: "#f97316",
    },
    {
      label: "Error Rate",
      value: errorRate.toFixed(1),
      unit: "%",
      trend: computeTrend(errorRate, errorRatePrev, true),
      sparkData: sparklines.value.errorRate,
      sparkColor: "#ef4444",
    },
  ];
});

// Single fetch entry point. Always pulls from the current props (which the
// parent keeps in sync via `recomputeInsightsTimeRange`). Stream selector
// changes, refresh button, and onMounted all funnel through here.
async function loadInsights(startTime?: number, endTime?: number) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!activeStream.value || !start || !end) return;
  localStorage.setItem(STREAM_LS_KEY, activeStream.value);
  await fetchAll(activeStream.value, start, end);
}

function onStreamChange() {
  loadInsights();
}

// Parent calls this on Run Query / Refresh / date-range change, passing
// the freshly computed start/end so we don't have to wait for Vue's
// next-tick prop propagation.
async function refresh(startTime?: number, endTime?: number) {
  await loadInsights(startTime, endTime);
}

defineExpose({ refresh });

onMounted(async () => {
  if (!streamsLoaded.value) {
    await loadTraceStreams();
  } else if (!availableStreams.value.includes(activeStream.value)) {
    activeStream.value = availableStreams.value[0] || "";
  }
  if (activeStream.value) {
    loadInsights();
  }
});

// Cancel any in-flight stream queries when the dashboard goes away
// (tab switch, org switch, full page nav). Without this, the server
// keeps streaming results to a component that's no longer there and
// the user pays for work they don't see.
onUnmounted(() => {
  cancelAll();
});
</script>

<style lang="scss" scoped>
// Page wrapper stays transparent so each inner card-container (KPI tiles
// + trend panels) stands out against the surrounding page bg. The
// previous solid-card-bg here matched the inner card-container bg and
// erased every border / shadow.
.llm-insights-dashboard {
  background: transparent;
}

.kpi-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  }
}

.kpi-trend {
  &--good {
    color: #16a34a;
  }
  &--bad {
    color: var(--o2-status-error-text);
  }
  &--neutral {
    color: var(--o2-text-muted);
  }
}

</style>
