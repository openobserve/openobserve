<template>
  <div
    class="bg-card-glass-bg rounded-default border-border-default flex flex-col gap-1 border px-3.5 pt-2.5 pb-2.5 transition-shadow duration-200 ease-in-out hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
    :data-test="`quality-kpi-${kpi.id}`"
  >
    <div class="flex flex-col gap-1">
      <!-- Label + a metric icon in a soft corner tile — same KPI-card pattern
           as LLM Insights / Session Detail so every card reads the same. -->
      <div class="mb-1 flex items-center justify-between gap-2">
        <div
          class="kpi-label text-2xs text-text-secondary min-w-0 truncate leading-normal font-semibold"
        >
          {{ t(`onlineEvals.quality.kpis.${kpi.id}.title`) }}
        </div>
        <span
          class="rounded-default bg-surface-subtle text-text-secondary inline-flex h-6 w-6 shrink-0 items-center justify-center"
        >
          <OIcon :name="cardIcon" size="sm" />
        </span>
      </div>
      <div class="flex items-baseline gap-[0.2rem]">
        <template v-if="kpi.value != null">
          <span class="text-text-secondary text-2xl leading-none font-bold">
            {{ bigNumber }}
          </span>
          <span v-if="unitLabel" class="text-compact text-text-secondary font-semibold">
            {{ unitLabel }}
          </span>
        </template>
        <span v-else class="text-text-muted text-base leading-none font-medium">
          {{ t("onlineEvals.quality.kpis.noData") }}
        </span>
      </div>
      <div
        v-if="kpi.id === 'scoreResults' && kpi.scopeCounts"
        class="text-3xs text-text-tertiary flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium"
        data-test="quality-kpi-scope-breakdown"
      >
        <span
          v-for="scope in scopes"
          :key="scope"
          class="inline-flex items-center gap-1 [font-variant-numeric:tabular-nums]"
          :data-test="`quality-kpi-scope-${scope}`"
        >
          <span>{{ t(`onlineEvals.quality.scopes.${scope}`) }}</span>
          <span class="text-text-secondary font-semibold">
            {{ compactCount(kpi.scopeCounts[scope]) }}
          </span>
        </span>
      </div>
      <!-- Always render the delta row even when prev is missing — keeps
           every card the same height. The body switches to a neutral
           "no prior data" hint instead of hiding the row, so the user
           can tell the comparison is *unavailable* (recent column /
           short history) rather than zero. -->
      <div
        v-if="kpi.value != null"
        class="text-3xs flex items-center gap-1 font-medium"
        :class="{
          'text-status-success-text': (delta != null ? trendSentiment : 'neutral') === 'good',
          'text-error-600': (delta != null ? trendSentiment : 'neutral') === 'bad',
          'text-text-muted': (delta != null ? trendSentiment : 'neutral') === 'neutral',
        }"
      >
        <template v-if="delta != null">
          <span class="kpi-trend-arrow">{{ trendArrow }}</span>
          <span> {{ deltaText }} {{ t("onlineEvals.quality.kpis.vsPrev") }} </span>
        </template>
        <template v-else>
          <span class="kpi-trend-arrow">–</span>
          <span>{{ t("onlineEvals.quality.kpis.noPriorData") }}</span>
        </template>
      </div>
    </div>
    <KpiSparkline
      v-if="kpi.sparkline && kpi.sparkline.length > 1"
      :data="kpi.sparkline"
      :color="sparkColor"
      :height="32"
      class="mt-auto"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import KpiSparkline from "@/plugins/traces/KpiSparkline.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { KpiCard } from "../composables/useQualityData";

const props = defineProps<{
  kpi: KpiCard;
  delta: number | null;
}>();

const { t } = useI18n();

const scopes = ["span", "trace", "session"] as const;

const ICONS: Record<KpiCard["id"], string> = {
  scoreResults: "fact-check",
  evaluationCost: "payments",
  scorerSuccess: "check-circle",
  scorerFailures: "error",
  latencyP95: "schedule",
};
const cardIcon = computed(() => ICONS[props.kpi.id]);

const trendSentiment = computed<"good" | "bad" | "neutral">(() => {
  if (props.delta == null || props.kpi.healthyDirection === "neutral" || props.delta === 0) {
    return "neutral";
  }
  const movedUp = props.delta > 0;
  if (props.kpi.healthyDirection === "up") return movedUp ? "good" : "bad";
  return movedUp ? "bad" : "good";
});

const trendArrow = computed(() => {
  if (props.delta == null || props.delta === 0) return "–";
  return props.delta > 0 ? "▲" : "▼";
});

const deltaText = computed(() => {
  if (props.delta == null) return "—";
  const abs = Math.abs(props.delta);
  if (props.kpi.format === "percent") return `${abs.toFixed(1)}%`;
  if (props.kpi.format === "currency") return `$${abs.toFixed(2)}`;
  if (props.kpi.format === "seconds") return `${abs.toFixed(2)}s`;
  if (abs >= 100) {
    const prev = props.kpi.prevValue ?? 0;
    const pct = prev > 0 ? (abs / prev) * 100 : 0;
    return `${pct.toFixed(1)}%`;
  }
  return `${Math.round(abs)}`;
});

const bigNumber = computed(() => {
  const v = props.kpi.value;
  if (v == null) return "—";
  if (props.kpi.format === "percent") return v.toFixed(1);
  // Currency: prefix the symbol on the main number itself — `unitLabel`
  // stays empty so we don't end up with "$98.97 $". Mirrors how the
  // delta line formats currency (`$${abs.toFixed(2)}`).
  if (props.kpi.format === "currency") return `$${v.toFixed(2)}`;
  if (props.kpi.format === "seconds") return v.toFixed(1);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
});

const unitLabel = computed(() => {
  if (props.kpi.format === "percent") return "%";
  if (props.kpi.format === "currency") return "";
  if (props.kpi.format === "seconds") return "s";
  return "";
});

function compactCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

const sparkColor = computed(() => {
  if (trendSentiment.value === "good") {
    return "var(--color-status-success-text)";
  }
  if (trendSentiment.value === "bad") return "var(--color-status-error-text)";
  return "var(--color-primary-500)";
});
</script>
