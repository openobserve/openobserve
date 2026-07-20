<template>
  <div
    class="card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem] bg-(--color-surface-base) border border-(--color-border-default) transition-shadow duration-200 ease-in-out hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
    :data-test="`quality-kpi-${kpi.id}`"
  >
    <div class="flex flex-col gap-[0.25rem]">
      <!-- Label + a metric icon in a soft corner tile — same KPI-card pattern
           as LLM Insights / Session Detail so every card reads the same. -->
      <div class="flex items-center justify-between gap-2 mb-[0.25rem]">
        <div class="kpi-label text-[0.7rem] font-semibold leading-normal text-(--color-text-secondary) min-w-0 truncate">
          {{ t(`onlineEvals.quality.kpis.${kpi.id}.title`) }}
        </div>
        <span
          class="inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-md bg-(--color-surface-subtle) text-(--color-text-secondary)"
        >
          <OIcon :name="cardIcon" size="sm" />
        </span>
      </div>
      <div class="flex items-baseline gap-[0.2rem]">
        <template v-if="kpi.value != null">
          <span class="text-[1.4rem] font-bold leading-none text-[var(--color-grey-600)]">
            {{ bigNumber }}
          </span>
          <span
            v-if="unitLabel"
            class="text-[0.8rem] font-semibold text-[var(--color-text-secondary)] "
          >
            {{ unitLabel }}
          </span>
        </template>
        <span
          v-else
          class="text-[0.95rem] font-medium leading-none text-[var(--color-text-muted)]"
        >
          {{ t("onlineEvals.quality.kpis.noData") }}
        </span>
      </div>
      <!-- Always render the delta row even when prev is missing — keeps
           every card the same height. The body switches to a neutral
           "no prior data" hint instead of hiding the row, so the user
           can tell the comparison is *unavailable* (recent column /
           short history) rather than zero. -->
      <div
        v-if="kpi.value != null"
        class="text-[0.65rem] font-medium flex items-center gap-[0.25rem]"
        :class="{
          'text-[var(--color-success-600)]': (delta != null ? trendSentiment : 'neutral') === 'good',
          'text-[var(--color-error-600)]': (delta != null ? trendSentiment : 'neutral') === 'bad',
          'text-[var(--color-text-muted)]': (delta != null ? trendSentiment : 'neutral') === 'neutral',
        }"
      >
        <template v-if="delta != null">
          <span class="kpi-trend-arrow">{{ trendArrow }}</span>
          <span>{{ deltaText }} vs prev</span>
        </template>
        <template v-else>
          <span class="kpi-trend-arrow">–</span>
          <span>no prior data</span>
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

// Metric icon per KPI id — mirrors the LLM Insights / Session Detail cards so
// every KPI card carries a corner icon. Falls back to a neutral chart icon.
const ICONS: Record<string, string> = {
  evaluated: "fact-check",
  evaluationCost: "payments",
  jobSuccess: "check-circle",
  scorerFailures: "error",
  latencyP95: "schedule",
};
const cardIcon = computed(() => ICONS[props.kpi.id] ?? "insights");

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

const sparkColor = computed(() => {
  if (trendSentiment.value === "good") return "#16a34a";
  if (trendSentiment.value === "bad") return "var(--color-status-error-text)";
  return "#3b82f6";
});
</script>

