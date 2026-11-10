<!-- Copyright 2026 OpenObserve Inc. -->

<!-- Points inside the noise band count as unchanged, so a one-slot wobble is not a regression. -->
<template>
  <div
    v-if="trend && trend.points.length"
    class="border-border-default px-table-edge space-y-1 border-t py-2"
    data-test="ai-experiment-trend"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span class="text-text-heading font-medium">{{ t("experimentsAtScale.trendTitle") }}</span>
      <OSelect
        v-model="scoreKey"
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
    <!-- Viewbox is the measured width, so 1 unit = 1 px and text keeps its size. -->
    <svg
      ref="svg"
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
        <text v-if="trend.points.length > 1" :x="X1" :y="H - 4" text-anchor="end">
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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { LlmExperiment } from "@/services/llm-experiments.service";
import { scoreColumnLabel } from "@/enterprise/views/AIObservability/experimentDiscovery";
import {
  COMPARISON_THRESHOLD,
  scoreTrend,
  trendScores,
  type BaselineOutcome,
  type ScorePolicy,
  type SharedCaseComparison,
} from "@/enterprise/views/AIObservability/experimentScale";

const props = defineProps<{
  /** One run per re-run fold: the newest completed one stands for it, as in the table. */
  runs: LlmExperiment[];
  baseline: LlmExperiment;
  policies: Map<string, ScorePolicy>;
  /** Compare over the shared cases, by run id, for runs on other cases than the baseline. */
  sharedCases: Map<string, SharedCaseComparison>;
}>();

const { t } = useI18nTyped();

// Width follows the element's so CSS stretches nothing and text stays legible.
const DEFAULT_W = 640;
const H = 140;
const X0 = 48;
const Y_TOP = 8;
const Y_BOTTOM = H - 22;

const svg = ref<SVGSVGElement | null>(null);
const W = ref(DEFAULT_W);
const X1 = computed(() => W.value - 8);
let observer: ResizeObserver | undefined;
watch(svg, (element) => {
  observer?.disconnect();
  if (!element || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width > X0 * 2) W.value = width;
  });
  observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());

const POINT_TONE: Record<BaselineOutcome, string> = {
  regressed: "text-status-error-text",
  improved: "text-status-positive",
  unchanged: "text-text-muted",
};

const scores = computed(() => trendScores(props.baseline, props.policies));
const scoreKey = ref("");
watch(
  scores,
  (next) => {
    if (!next.some(({ key }) => key === scoreKey.value)) scoreKey.value = next[0]?.key ?? "";
  },
  { immediate: true },
);

const options = computed(() =>
  scores.value.map((score) => {
    const label = scoreColumnLabel(score, t);
    return {
      value: score.key,
      label: score.share ? t("experimentsAtScale.trendShareOption", { score: label }) : label,
    };
  }),
);

const scoreLabel = computed(() => {
  const score = scores.value.find(({ key }) => key === scoreKey.value);
  return score ? scoreColumnLabel(score, t) : raw("");
});

const trend = computed(() =>
  scoreKey.value
    ? scoreTrend(props.runs, props.baseline, scoreKey.value, props.policies, props.sharedCases)
    : null,
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
  return count > 1 ? X0 + (index * (X1.value - X0)) / (count - 1) : (X0 + X1.value) / 2;
}

const ticks = computed(() => [domain.value.min, domain.value.max]);
const line = computed(() =>
  trend.value!.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" "),
);

function format(value: number) {
  return raw(trend.value!.share ? `${(value * 100).toFixed(1)}%` : value.toFixed(3));
}

// Re-runs minutes apart share a day, so the axis then shows the time too.
function dateLabel(ms: number) {
  const points = trend.value!.points;
  const sameDay =
    new Date(points[0].createdAt).toDateString() ===
    new Date(points[points.length - 1].createdAt).toDateString();
  return raw(
    new Date(ms).toLocaleString(
      undefined,
      sameDay
        ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
        : { day: "numeric", month: "short" },
    ),
  );
}

const noiseLabel = computed(() => {
  const [low, high] = trend.value!.band;
  return trend.value!.share
    ? t("experimentsAtScale.trendNoisePts", { value: COMPARISON_THRESHOLD * 100 })
    : t("experimentsAtScale.trendNoise", { value: ((high - low) / 2).toFixed(3) });
});

const ariaLabel = computed(() =>
  t("experimentsAtScale.trendAria", {
    score: scoreLabel.value,
    count: trend.value!.points.length,
    value: format(trend.value!.baseline),
    regressed: trend.value!.regressed,
    improved: trend.value!.improved,
  }),
);
</script>
