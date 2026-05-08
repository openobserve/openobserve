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
  <div
    class="llm-insights-dashboard tw:h-full tw:overflow-y-auto tw:px-[0.625rem] tw:pb-[0.625rem]"
  >
    <!-- Toolbar: stream selector. The page-level "Run query" button in the
         top toolbar is the single source of refresh — picking a different
         stream here auto-applies the change (same convention as the rest of
         the Traces tabs), and changing the time range / clicking Run query
         re-runs the panels via prop watchers below. -->
    <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:py-[0.5rem]">
      <div
        data-test="llm-insights-stream-selector"
        class="tw:w-[14rem] tw:flex-shrink-0"
      >
        <q-select
          v-model="activeStream"
          :options="
            availableStreams.length > 0
              ? availableStreams.map((s) => ({ label: s, value: s }))
              : []
          "
          dense
          borderless
          emit-value
          map-options
          class="tw:w-[auto] tw:flex-shrink-0 tw:rounded"
          @update:model-value="onStreamChange"
          :disable="availableStreams.length === 0"
        >
          <q-tooltip v-if="availableStreams.length === 0">
            No LLM streams available.
          </q-tooltip>
        </q-select>
      </div>
    </div>

    <!-- Streams list loaded but no LLM streams exist for this org. -->
    <div
      v-if="streamsLoaded && availableStreams.length === 0"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[320px] tw:text-center"
    >
      <q-icon name="auto_awesome" size="3rem" color="grey-5" class="tw:mb-3" />
      <div class="tw:text-base tw:text-[var(--o2-text-2)] tw:mb-2">
        No LLM streams found
      </div>
      <div
        class="tw:text-sm tw:text-[var(--o2-text-3)] tw:mb-3 tw:max-w-[30rem]"
      >
        LLM Insights aggregates spans from traces streams that capture
        <code>gen_ai_*</code> attributes. Either no traces stream has been
        marked as an LLM stream, or no spans have been ingested yet. Instrument
        your service with the OpenTelemetry Gen-AI semantic conventions and
        ingest at least one trace to populate this dashboard.
      </div>
    </div>

    <!-- Skeleton shown only while a real request is in flight (initial
         streams fetch or KPI/sparkline load). Prevents the post-tab-switch
         "Failed to load" flash by not painting the error state until data
         actually fails for the *current* mount. -->
    <LLMInsightsSkeleton v-else-if="!streamsLoaded || loading" />

    <!-- Stream has no LLM (gen_ai_*) fields → friendly empty state -->
    <div
      v-else-if="streamHasNoLLMFields"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[300px]"
    >
      <q-icon name="auto_awesome" size="3rem" color="grey-5" class="tw:mb-3" />
      <div class="tw:text-base tw:text-[var(--o2-text-2)] tw:mb-2">
        No LLM data in <b>{{ activeStream }}</b>
      </div>
      <div
        class="tw:text-sm tw:text-[var(--o2-text-3)] tw:mb-3 tw:max-w-[28rem] tw:text-center"
      >
        This stream doesn't have any LLM (<code>gen_ai_*</code>) fields. Pick a
        different stream above, or instrument your service with the OpenTelemetry
        Gen-AI semantic conventions to populate this dashboard.
      </div>
    </div>

    <!-- Generic error state — only after at least one successful mount-load
         attempt has resolved. -->
    <div
      v-else-if="error && hasLoadedOnce"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[200px]"
    >
      <q-icon name="error_outline" size="3rem" color="negative" class="tw:mb-3" />
      <div class="tw:text-base tw:mb-2">Failed to load LLM Insights</div>
      <div class="tw:text-sm tw:text-gray-500 tw:mb-3">{{ error }}</div>
      <q-btn
        outline
        color="primary"
        label="Retry"
        @click="loadData"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="hasLoadedOnce && !hasData"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[200px]"
    >
      <q-icon name="info" size="3rem" color="grey-5" class="tw:mb-3" />
      <div class="tw:text-base tw:text-[var(--o2-text-3)]">
        No LLM data found for the selected time range
      </div>
    </div>

    <!-- Dashboard content -->
    <template v-else>
      <!-- KPI Cards Row -->
      <div class="tw:grid tw:grid-cols-5 tw:gap-[0.625rem] tw:mt-[0.625rem] tw:mb-[0.625rem]">
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="kpi-card card-container tw:rounded-lg tw:flex tw:flex-col tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.25rem]"
        >
          <div class="tw:flex tw:flex-col tw:gap-[0.25rem]">
            <div class="kpi-label tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-3)]">
              {{ card.label }}
            </div>
            <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
              <span class="tw:text-[1.4rem] tw:font-bold tw:leading-none tw:text-[var(--o2-text-1)]">
                {{ card.value }}
              </span>
              <span
                v-if="card.unit"
                class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-2)]"
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
              <span>{{ card.trend.deltaPct.toFixed(card.trend.deltaPct < 10 ? 1 : 0) }}% vs prev</span>
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
    </template>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useLLMInsights } from "./composables/useLLMInsights";
import KpiSparkline from "./KpiSparkline.vue";
import LLMTrendPanel from "./LLMTrendPanel.vue";
import LLMInsightsSkeleton from "./LLMInsightsSkeleton.vue";
import { LLM_INSIGHTS_PANELS } from "./config/llmInsightsPanels";
import useStreams from "@/composables/useStreams";

const { getStreams } = useStreams();
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

// DataFusion returns "Schema error: No field named gen_ai_..." when the
// chosen stream lacks LLM instrumentation. Detect that specific case so we
// can show a friendly empty state instead of the generic error fallback.
const streamHasNoLLMFields = computed(() => {
  if (!error.value) return false;
  const msg = String(error.value);
  return /No field named\s+gen_ai_/i.test(msg);
});

type TrendDirection = "up" | "down" | "flat";
type TrendSentiment = "good" | "bad" | "neutral";

interface KpiTrend {
  direction: TrendDirection;
  sentiment: TrendSentiment;
  deltaPct: number; // absolute %
}

interface KpiCard {
  label: string;
  value: string;
  unit?: string;
  trend?: KpiTrend | null;
  sparkData?: number[];
  sparkColor?: string;
}

const FLAT_THRESHOLD = 1; // percent

function computeTrend(
  curr: number,
  prev: number,
  upIsBad: boolean,
): KpiTrend | null {
  if (!isFinite(curr) || !isFinite(prev)) return null;
  if (prev <= 0 && curr <= 0) return null;
  if (prev <= 0) {
    return { direction: "up", sentiment: upIsBad ? "bad" : "good", deltaPct: 100 };
  }
  const deltaPct = ((curr - prev) / prev) * 100;
  const abs = Math.abs(deltaPct);
  if (abs < FLAT_THRESHOLD) {
    return { direction: "flat", sentiment: "neutral", deltaPct: abs };
  }
  const direction: TrendDirection = deltaPct > 0 ? "up" : "down";
  const sentiment: TrendSentiment =
    direction === "up" ? (upIsBad ? "bad" : "good") : upIsBad ? "good" : "bad";
  return { direction, sentiment, deltaPct: abs };
}


function splitNumberWithUnit(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: "B" };
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: "M" };
  if (n >= 10_000) return { value: (n / 1_000).toFixed(1), unit: "K" };
  return { value: n.toLocaleString(), unit: "" };
}

function splitDuration(micros: number): { value: string; unit: string } {
  if (!micros || micros === 0) return { value: "0", unit: "ms" };
  const ms = micros / 1000;
  if (ms < 1000) return { value: Math.round(ms).toString(), unit: "ms" };
  if (ms < 60_000) return { value: (ms / 1000).toFixed(1), unit: "s" };
  return { value: (ms / 60_000).toFixed(1), unit: "min" };
}

function trendArrow(direction: TrendDirection): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "→";
}

function splitCost(cost: number): { value: string; unit: string } {
  if (cost >= 1_000_000) return { value: `$${(cost / 1_000_000).toFixed(2)}`, unit: "M" };
  if (cost >= 1_000) return { value: `$${(cost / 1_000).toFixed(1)}`, unit: "K" };
  return { value: `$${cost.toFixed(2)}`, unit: "" };
}

const kpiCards = computed<KpiCard[]>(() => {
  const tokens = splitNumberWithUnit(kpi.value.totalTokens);
  const traces = splitNumberWithUnit(kpi.value.traceCount);
  const p95 = splitDuration(kpi.value.p95DurationMicros);
  const errorRate =
    kpi.value.requestCount > 0
      ? (kpi.value.errorCount / kpi.value.requestCount) * 100
      : 0;

  const errorRatePrev =
    kpiPrev.value.requestCount > 0
      ? (kpiPrev.value.errorCount / kpiPrev.value.requestCount) * 100
      : 0;

  // Cost comes straight from SUM(llm_usage_cost_total) on the KPI summary —
  // same source the Traces tab uses. If it's 0, either there are no LLM spans
  // or the SDK isn't emitting cost; either way we render "$0".
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
async function load(startTime?: number, endTime?: number) {
  const start = startTime ?? props.startTime;
  const end = endTime ?? props.endTime;
  if (!activeStream.value || !start || !end) return;
  localStorage.setItem(STREAM_LS_KEY, activeStream.value);
  await fetchAll(activeStream.value, start, end);
}

function onStreamChange() {
  load();
}

// Parent calls this on Run Query / Refresh / date-range change, passing
// the freshly computed start/end so we don't have to wait for Vue's
// next-tick prop propagation.
async function refresh(startTime?: number, endTime?: number) {
  await load(startTime, endTime);
}

defineExpose({ refresh });

onMounted(async () => {
  if (!streamsLoaded.value) {
    await loadTraceStreams();
  } else if (!availableStreams.value.includes(activeStream.value)) {
    activeStream.value = availableStreams.value[0] || "";
  }
  if (activeStream.value) {
    load();
  }
});
</script>

<style lang="scss" scoped>
.llm-insights-dashboard {
  background: var(--o2-card-bg-solid);
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
    color: #dc2626;
  }
  &--neutral {
    color: var(--o2-text-3);
  }
}

</style>
