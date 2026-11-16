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
  <span
    class="relative block w-full"
    :style="{ height: `${height}px` }"
    :data-state="state"
    data-test="ao-sparkline"
  >
    <OSkeleton
      v-if="state === 'loading'"
      animation="pulse"
      class="absolute inset-0 size-full"
      data-test="ao-sparkline-loading"
    />
    <span
      v-else-if="state === 'error'"
      role="alert"
      class="text-status-error-text absolute inset-0 flex items-center gap-1 text-xs"
      data-test="ao-sparkline-error"
    >
      <OIcon name="error-outline" size="xs" class="shrink-0" />
      <span class="min-w-0 truncate">{{ errorText }}</span>
      <OButton
        v-if="retryable"
        variant="ghost-primary"
        size="xs"
        data-test="ao-sparkline-retry"
        @click.stop="emit('retry')"
        >{{ t("autoobserve.issueLive.spark.retry") }}</OButton
      >
    </span>
    <span
      v-else-if="state === 'empty'"
      class="text-text-secondary absolute inset-0 flex items-center text-xs"
      data-test="ao-sparkline-empty"
      >{{ emptyText ?? t("autoobserve.issueLive.spark.empty") }}</span
    >
    <span
      v-else
      role="img"
      :aria-label="ariaLabel"
      class="absolute inset-0"
      :class="TONE[tone]"
      data-test="ao-sparkline-chart"
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        class="absolute inset-0 size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient :id="fillId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.22" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <rect
          v-for="(r, i) in shaded"
          :key="`s${i}`"
          :x="r.x"
          y="0"
          :width="r.width"
          height="100"
          class="text-status-error-text dark:[fill-opacity:0.24]"
          fill="currentColor"
          fill-opacity="0.08"
          data-test="ao-sparkline-highlight"
        />
        <path
          v-if="shape.band"
          :d="shape.band"
          class="text-text-secondary dark:[fill-opacity:0.3]"
          fill="currentColor"
          fill-opacity="0.12"
          data-test="ao-sparkline-band"
        />
        <path
          v-if="shape.expected"
          :d="shape.expected"
          class="text-text-secondary"
          v-bind="STROKE"
          stroke-dasharray="3 3"
          data-test="ao-sparkline-expected"
        />
        <path v-for="(d, i) in shape.areas" :key="`a${i}`" :d="d" :fill="`url(#${fillId})`" />
        <path v-for="(d, i) in shape.lines" :key="`l${i}`" :d="d" v-bind="STROKE" />
      </svg>
      <span
        v-for="(m, i) in placed"
        :key="i"
        class="absolute size-2 -translate-1/2"
        :style="{ left: `${m.x}%`, top: `${m.y}%` }"
        :title="m.label"
        :data-test="`ao-sparkline-marker-${m.kind}`"
      >
        <span
          v-if="m.kind === 'live'"
          class="absolute inset-0 rounded-full bg-current opacity-50 motion-safe:animate-ping"
        />
        <span class="absolute inset-0 rounded-full" :class="MARKER[m.kind] ?? MARKER.default" />
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type {
  AoSparkBand,
  AoSparkMarker,
  AoSparkPoint,
  AoSparkSpan,
  AoSparkTone,
} from "./aoSparkline";

const props = withDefaults(
  defineProps<{
    series: AoSparkPoint[];
    expected?: AoSparkPoint[];
    band?: AoSparkBand[];
    markers?: AoSparkMarker[];
    // Stretches shaded behind the line, such as buckets the engine judged outside the usual range.
    highlights?: AoSparkSpan[];
    loading?: boolean;
    error?: boolean | string;
    height?: number;
    label?: string;
    emptyText?: string;
    tone?: AoSparkTone;
    retryable?: boolean;
  }>(),
  {
    expected: () => [],
    band: () => [],
    markers: () => [],
    highlights: () => [],
    loading: false,
    error: false,
    height: 36,
    label: undefined,
    emptyText: undefined,
    tone: "danger",
    retryable: false,
  },
);

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const TONE: Record<AoSparkTone, string> = {
  danger: "text-status-error-text",
  warning: "text-status-warning-text",
  success: "text-status-positive",
  neutral: "text-text-secondary",
};

const MARKER: Record<string, string> = {
  detected: "bg-status-error-text",
  live: "bg-current",
  recovered: "bg-status-positive",
  default: "border-text-heading bg-surface-base border-2",
};

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.5,
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
  "vector-effect": "non-scaling-stroke",
} as const;

// Room above the peak and below zero, so markers centred on the line never clip.
const TOP = 12;
const BOTTOM = 92;

const fillId = useId();

const measured = computed(() => props.series.filter((p) => p.v != null));

const state = computed(() => {
  if (props.loading) return "loading";
  if (props.error) return "error";
  return measured.value.length ? "ready" : "empty";
});

const errorText = computed(() =>
  typeof props.error === "string" && props.error
    ? props.error
    : t("autoobserve.issueLive.spark.failed"),
);

const ariaLabel = computed(() =>
  [props.label, ...props.markers.map((m) => m.label)].filter(Boolean).join(". "),
);

const span = computed(() => {
  const ts = [
    ...props.series.map((p) => p.t),
    ...props.expected.map((p) => p.t),
    ...props.band.map((p) => p.t),
  ];
  const from = Math.min(...ts);
  const to = Math.max(...ts);
  return { from, width: to - from || 1 };
});

const top = computed(
  () =>
    Math.max(
      0,
      ...measured.value.map((p) => p.v as number),
      ...props.expected.flatMap((p) => (p.v == null ? [] : [p.v])),
      ...props.band.map((p) => p.upper),
    ) || 1,
);

const xOf = (time: number) => 2 + (96 * (time - span.value.from)) / span.value.width;
const yOf = (value: number) => BOTTOM - ((BOTTOM - TOP) * value) / top.value;

const at = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;

// A null value breaks the line, so a gap in the data never reads as a straight run.
const runs = (points: AoSparkPoint[]) => {
  const out: AoSparkPoint[][] = [];
  let run: AoSparkPoint[] = [];
  for (const p of points) {
    if (p.v == null) {
      if (run.length) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) out.push(run);
  return out;
};

const minStep = (ts: number[]) =>
  Math.min(
    ...ts
      .slice(1)
      .map((t, i) => t - ts[i])
      .filter((d) => d > 0),
  );

// The band has no null to break on, so a jump wider than the chart's own bucket step is an unjudged gap.
const bandRuns = (band: AoSparkBand[]) => {
  const step = Math.min(minStep(props.series.map((p) => p.t)), minStep(band.map((p) => p.t)));
  const out: AoSparkBand[][] = [];
  band.forEach((p, i) => {
    if (i && p.t - band[i - 1].t > step * 1.5) out.push([p]);
    else if (out.length) out[out.length - 1].push(p);
    else out.push([p]);
  });
  return out;
};

const linePath = (run: AoSparkPoint[]) =>
  run.map((p, i) => `${i ? "L" : "M"}${at(xOf(p.t), yOf(p.v as number))}`).join(" ");

const shape = computed(() => {
  const series = runs(props.series);
  const lines = series.map(linePath);
  const areas = series.map(
    (run, i) => `${lines[i]} L${at(xOf(run[run.length - 1].t), 100)} L${at(xOf(run[0].t), 100)} Z`,
  );
  const expected = runs(props.expected).map(linePath).join(" ");
  const band = bandRuns(props.band)
    .map((run) =>
      [
        ...run.map((p, i) => `${i ? "L" : "M"}${at(xOf(p.t), yOf(p.upper))}`),
        ...[...run].reverse().map((p) => `L${at(xOf(p.t), yOf(p.lower))}`),
        "Z",
      ].join(" "),
    )
    .join(" ");
  return { lines, areas, expected, band };
});

const shaded = computed(() =>
  props.highlights.map((s) => {
    const x = Math.max(2, xOf(s.from));
    return { x, width: Math.max(0.5, Math.min(98, xOf(s.to)) - x) };
  }),
);

// A marker sits on the measured point nearest its time.
const placed = computed(() => {
  const points = measured.value;
  if (!points.length) return [];
  return props.markers.map((m) => {
    const near = points.reduce((best, p) =>
      Math.abs(p.t - m.t) < Math.abs(best.t - m.t) ? p : best,
    );
    return { ...m, x: xOf(m.t), y: yOf(near.v as number) };
  });
});
</script>
