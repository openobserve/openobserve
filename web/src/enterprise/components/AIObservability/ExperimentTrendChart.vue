<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  One dataset's runs in time order for one score, against the baseline and a
  noise band as wide as Compare's threshold. Points inside the band count as
  unchanged, so a one-slot wobble does not read as a regression. A plain SVG
  like OSparkline: one series and a band need nothing from a chart library.
-->
<template>
  <div
    v-if="trend && trend.points.length"
    class="border-border-default px-table-edge space-y-1 border-t py-2"
    data-test="ai-experiment-trend"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span class="text-text-heading font-medium">{{ t("experimentsAtScale.trendTitle") }}</span>
      <OSelect
        v-model="scoreName"
        :label="t('experimentsAtScale.trendScore')"
        label-position="inside"
        size="sm"
        width="md"
        :options="options"
        data-test="ai-experiment-trend-score"
      />
      <span class="text-text-secondary">
        {{
          t("experimentsAtScale.trendBaseline", {
            name: baseline.name,
            value: format(trend.baseline),
          })
        }}
      </span>
      <span class="text-text-secondary">{{ noiseLabel }}</span>
      <span class="text-status-error-text" data-test="ai-experiment-trend-regressed">
        {{ t("experimentsAtScale.regressedCount", { count: trend.regressed }) }}
      </span>
      <span class="text-status-positive" data-test="ai-experiment-trend-improved">
        {{ t("experimentsAtScale.improvedCount", { count: trend.improved }) }}
      </span>
    </div>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      :aria-label="ariaLabel"
      class="h-36 w-full"
    >
      <rect
        :x="X0"
        :y="y(trend.band[1])"
        :width="X1 - X0"
        :height="y(trend.band[0]) - y(trend.band[1])"
        class="text-accent"
        fill="currentColor"
        opacity="0.12"
      />
      <g class="text-text-secondary" fill="currentColor" font-size="10">
        <template v-for="tick in ticks" :key="tick">
          <line :x1="X0" :x2="X1" :y1="y(tick)" :y2="y(tick)" stroke="currentColor" opacity="0.2" />
          <text :x="X0 - 6" :y="y(tick) + 3" text-anchor="end">{{ format(tick) }}</text>
        </template>
        <text :x="X0" :y="H - 4">{{ dateLabel(trend.points[0].createdAt) }}</text>
        <text :x="X1" :y="H - 4" text-anchor="end">
          {{ dateLabel(trend.points[trend.points.length - 1].createdAt) }}
        </text>
      </g>
      <line
        :x1="X0"
        :x2="X1"
        :y1="y(trend.baseline)"
        :y2="y(trend.baseline)"
        class="text-accent"
        stroke="currentColor"
        stroke-dasharray="4 3"
      />
      <polyline
        :points="line"
        fill="none"
        class="text-text-muted"
        stroke="currentColor"
        opacity="0.5"
      />
      <circle
        v-for="(point, index) in trend.points"
        :key="point.id"
        :cx="x(index)"
        :cy="y(point.value)"
        :r="point.outcome === 'unchanged' ? 2.5 : 3.5"
        fill="currentColor"
        :class="POINT_TONE[point.outcome]"
        :data-test="`ai-experiment-trend-point-${point.id}`"
      >
        <title>{{ raw(`${point.name} · ${format(point.value)}`) }}</title>
      </circle>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { LlmExperiment } from "@/services/llm-experiments.service";
import {
  COMPARISON_THRESHOLD,
  scoreTrend,
  trendScores,
  type BaselineOutcome,
  type ScorePolicy,
} from "@/enterprise/views/AIObservability/experimentScale";

const props = defineProps<{
  /** One run per re-run fold: the latest stands for it, as in the table. */
  runs: LlmExperiment[];
  baseline: LlmExperiment;
  policies: Map<string, ScorePolicy>;
}>();

const { t } = useI18nTyped();

// The SVG's own coordinate space; CSS sets the size, the text stays legible.
const W = 640;
const H = 140;
const X0 = 48;
const X1 = W - 8;
const Y_TOP = 8;
const Y_BOTTOM = H - 22;

const POINT_TONE: Record<BaselineOutcome, string> = {
  regressed: "text-status-error-text",
  improved: "text-status-positive",
  unchanged: "text-text-muted",
};

const scores = computed(() => trendScores(props.baseline, props.policies));
const scoreName = ref("");
// The first plottable score until the user picks one, and again if the pick
// leaves (a new baseline without that score).
watch(
  scores,
  (next) => {
    if (!next.some(({ name }) => name === scoreName.value)) scoreName.value = next[0]?.name ?? "";
  },
  { immediate: true },
);

const options = computed(() =>
  scores.value.map(({ name, share }) => ({
    value: name,
    label: share ? t("experimentsAtScale.trendShareOption", { score: name }) : raw(name),
  })),
);

const trend = computed(() =>
  scoreName.value ? scoreTrend(props.runs, props.baseline, scoreName.value, props.policies) : null,
);

const domain = computed(() => {
  const value = trend.value!;
  const values = [...value.points.map((point) => point.value), ...value.band];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 0.01;
  return { min: min - pad, max: max + pad };
});

function y(value: number) {
  const { min, max } = domain.value;
  return Y_BOTTOM - ((value - min) / (max - min)) * (Y_BOTTOM - Y_TOP);
}

function x(index: number) {
  const count = trend.value!.points.length;
  return count > 1 ? X0 + (index * (X1 - X0)) / (count - 1) : (X0 + X1) / 2;
}

const ticks = computed(() => [domain.value.min, domain.value.max]);
const line = computed(() =>
  trend.value!.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" "),
);

function format(value: number) {
  return raw(trend.value!.share ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
}

function dateLabel(ms: number) {
  return raw(new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
}

const noiseLabel = computed(() => {
  const [low, high] = trend.value!.band;
  return trend.value!.share
    ? t("experimentsAtScale.trendNoisePts", { value: COMPARISON_THRESHOLD * 100 })
    : t("experimentsAtScale.trendNoise", { value: ((high - low) / 2).toFixed(3) });
});

const ariaLabel = computed(() =>
  t("experimentsAtScale.trendAria", {
    score: scoreName.value,
    count: trend.value!.points.length,
    value: format(trend.value!.baseline),
    regressed: trend.value!.regressed,
    improved: trend.value!.improved,
  }),
);
</script>
