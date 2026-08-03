<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Live preview for a TIME-SLICE SLI: the per-slice aggregate against the
  threshold, and the SLI that threshold produces.

  The count preview answers "is my predicate right?" — a syntax question. This
  one answers a question of degree, which is harder and more consequential: a
  time-slice SLI is defined by a NUMBER the user has to guess (232 ms), and
  nothing in the form tells them whether that number makes 1% or 40% of slices
  bad. Without this, the only way to find out is to save, wait for slices to
  accumulate, and read the SLI days later.

  So the tally under the header is the point, not the chart. The chart shows
  WHERE the threshold cuts; the tally says what it costs, next to the target
  the user just typed.

  A LINE, not bars: unlike the count preview's discrete per-bucket totals, a
  slice aggregate is a sample of something continuous, and reading the trend
  between slices is exactly how a threshold gets chosen.

  Classification happens here rather than in SQL, mirroring the ingest pass —
  see `buildSloTimeSlicePreviewQuery`.
-->
<template>
  <div class="flex flex-col gap-2" data-test="slos-slotimeslicepreview-root">
    <div class="flex items-center justify-end">
      <OToggleGroup
        :model-value="range"
        data-test="slos-slotimeslicepreview-range"
        @update:model-value="onRangeChange"
      >
        <OToggleGroupItem
          v-for="option in rangeOptions"
          :key="option.value"
          :value="option.value"
          size="sm"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <div
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      data-test="slos-slotimeslicepreview-panel"
    >
      <div
        class="border-border-default text-compact text-text-heading flex min-h-7 w-full items-center justify-between gap-2 border-b px-2 py-1 font-medium tracking-[0.02em]"
      >
        <span>{{ t("slos.preview.sliceValues") }}</span>
        <!-- The verdict, coloured against the target: this is the number the
             threshold is being chosen to produce. -->
        <span
          v-if="tally && tally.sli !== null"
          class="font-normal tabular-nums"
          :class="verdictClass"
          data-test="slos-slotimeslicepreview-tally"
        >
          {{
            t("slos.preview.sliceTally", {
              good: tally.good,
              total: tally.measured,
              sli: tally.sli.toFixed(1),
            })
          }}
        </span>
      </div>

      <div class="h-45 w-full">
        <div
          v-if="loading"
          class="flex h-full items-center justify-center"
          data-test="slos-slotimeslicepreview-loading"
        >
          <OSpinner size="sm" />
        </div>
        <div
          v-else-if="error"
          class="flex h-full items-center justify-center px-4 text-center"
          data-test="slos-slotimeslicepreview-error"
        >
          <span class="text-text-secondary text-sm">{{ error }}</span>
        </div>
        <div
          v-else-if="!points.length"
          class="flex h-full items-center justify-center px-4 text-center"
          data-test="slos-slotimeslicepreview-empty"
        >
          <span class="text-text-secondary text-sm">{{ t("slos.preview.noSlices") }}</span>
        </div>
        <ChartRenderer
          v-else
          :data="{ options: chartOptions }"
          data-test="slos-slotimeslicepreview-chart"
        />
      </div>

      <!-- Unmeasured slots are neither good nor bad and must not be read as
           either — the same distinction coverage draws on the detail page. This
           is also what discloses the tally's denominator: without it the
           percentage above looks like a reading of the whole range. -->
      <div
        v-if="gapSlots > 0"
        class="border-border-default text-text-secondary border-t px-2 py-1 text-xs"
        data-test="slos-slotimeslicepreview-gaps"
      >
        {{ t("slos.preview.sliceGaps", { n: gapSlots, total: expectedSlots }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import searchService from "@/services/search";
import {
  SLICE_ALIAS,
  VALUE_ALIAS,
  buildSloTimeSlicePreviewQuery,
  classifyPreviewSlices,
  type PreviewSliceTally,
} from "@/utils/slos/previewQuery";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  streamType: string;
  stream: string;
  /** SQL predicate; empty = all rows. */
  scope?: string;
  /** The aggregate scored against the threshold. */
  aggregate?: string;
  comparator?: string;
  threshold?: number | string | null;
  sliceIntervalSecs: number;
  /** Percentage, 0..100 — drawn only as the pass/fail colour of the tally. */
  target?: number;
}>();

const { t } = useI18n();
const store = useStore();

interface PreviewPoint {
  ts: number;
  value: number | null;
}

const points = ref<PreviewPoint[]>([]);
const loading = ref(false);
const error = ref("");
const range = ref<string>("1h");

const RANGE_SECS: Record<string, number> = {
  "1h": 3600,
  "6h": 6 * 3600,
  "24h": 24 * 3600,
};

const rangeOptions = computed(() => [
  { value: "1h", label: t("alerts.groups.range1h") },
  { value: "6h", label: t("alerts.groups.range6h") },
  { value: "24h", label: t("alerts.groups.range24h") },
]);

const thresholdNum = computed(() => {
  const n = Number(props.threshold);
  return Number.isFinite(n) ? n : Number.NaN;
});

const tally = computed<PreviewSliceTally | null>(() => {
  if (!points.value.length) return null;
  return classifyPreviewSlices(
    points.value.map((p) => p.value),
    props.comparator ?? "",
    thresholdNum.value,
  );
});

/**
 * How many slices the chosen range COULD hold, against how many carried data.
 *
 * `GROUP BY histogram(...)` emits nothing at all for a slot with no rows, so
 * the result set is not the range — it is the measured part of it. Reporting a
 * percentage over that without saying so is the mistake this whole feature
 * avoids everywhere else: a gap is not a zero, and on a sparse stream the
 * tally can be four slices out of twelve while reading like a verdict on the
 * hour.
 */
const expectedSlots = computed(() =>
  Math.max(0, Math.floor((RANGE_SECS[range.value] ?? 0) / Math.max(1, props.sliceIntervalSecs))),
);

/** Slots with no row at all, plus rows whose aggregate could not be read. */
const gapSlots = computed(() => {
  const missing = Math.max(0, expectedSlots.value - points.value.length);
  return missing + (tally.value?.unmeasured ?? 0);
});

/**
 * Below this many measured slices the verdict is drawn neutral.
 *
 * Not squeamishness: at three slices a single slot moves the reading by 33
 * points, and a red "66.7%" against a 95% target invites someone to retune a
 * production threshold on noise. The number is still shown — only the claim
 * that it passes or fails is withheld.
 */
const MIN_SLICES_FOR_VERDICT = 10;

const verdictClass = computed(() => {
  const sli = tally.value?.sli;
  const target = Number(props.target);
  if (
    sli === null ||
    sli === undefined ||
    !Number.isFinite(target) ||
    (tally.value?.measured ?? 0) < MIN_SLICES_FOR_VERDICT
  ) {
    // Neutral for "not enough to say" AND for an unreadable target. Green was
    // the old default there, which is a pass claimed from ignorance.
    return "text-text-secondary";
  }
  return sli >= target ? "text-positive" : "text-negative";
});

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  load();
};

/** Read a design token for the chart renderer, which takes colour STRINGS and
 *  cannot be handed a utility class. */
const resolveToken = (token: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(token).trim();
  return value || fallback;
};

/**
 * `histogram()` returns its bucket as `"2026-08-02T12:00:00"` — UTC, with no
 * zone marker. A browser parses that as LOCAL time, which silently shifts the
 * entire series by the viewer's offset, so the `Z` is not optional. Same fix
 * `sqlTimeSeriesConverter` applies to `zo_sql_key`.
 *
 * The numeric branch is for a backend that ever hands back epoch micros
 * instead; without it a numeric response would parse to `Invalid Date` and the
 * panel would sit empty with nothing to explain why.
 */
function parseSliceStart(raw: unknown): number {
  // Before anything else: `Number(null)` is 0, so a null bucket would fall
  // through the numeric branch and plot itself at 1970 rather than being
  // dropped.
  if (raw === null || raw === undefined || raw === "") return Number.NaN;
  const iso = new Date(`${String(raw)}Z`).getTime();
  if (Number.isFinite(iso)) return iso;
  const micros = Number(raw);
  return Number.isFinite(micros) ? micros / 1000 : Number.NaN;
}

const labels = computed(() =>
  points.value.map((p) => format(toZonedTime(p.ts, store.state.timezone), "HH:mm")),
);

const chartOptions = computed(() => {
  void store.state.theme; // getComputedStyle is not reactive — re-resolve on flip.
  const accent = resolveToken("--color-accent", "#5960b2");
  const danger = resolveToken("--color-severity-error-color", "#ef5350");
  const axisColor = resolveToken("--color-text-secondary", "#6b7280");
  const gridColor = resolveToken("--color-border-default", "#e5e7eb");

  return {
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "line" } },
    xAxis: {
      type: "category",
      data: labels.value,
      boundaryGap: false,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { hideOverlap: true, color: axisColor },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: axisColor },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
    },
    series: [
      {
        name: t("slos.preview.sliceValue"),
        type: "line",
        smooth: false,
        showSymbol: false,
        // A bucket with no rows is not a zero reading — joining across it
        // would draw a measurement nobody took.
        connectNulls: false,
        lineStyle: { width: 2, color: accent },
        itemStyle: { color: accent },
        data: points.value.map((p) => p.value),
        // The threshold is the definition made visible: every slice on the bad
        // side of this line is one the SLO will count against the budget.
        markLine: Number.isFinite(thresholdNum.value)
          ? {
              symbol: "none",
              animation: false,
              silent: true,
              lineStyle: { color: danger, type: "dashed" },
              label: {
                formatter: t("slos.preview.thresholdLabel", { value: thresholdNum.value }),
                position: "insideEndTop",
                color: danger,
              },
              data: [{ yAxis: thresholdNum.value }],
            }
          : undefined,
      },
    ],
  };
});

// An abandoned search holds a slot in the server's work-group queue until it
// completes, so a superseded preview has to abort rather than just drop the
// result.
let controller: AbortController | null = null;

async function load() {
  const org = store.state.selectedOrganization?.identifier;
  const sql = buildSloTimeSlicePreviewQuery({
    stream: props.stream,
    scope: props.scope,
    aggregate: props.aggregate,
    sliceIntervalSecs: props.sliceIntervalSecs,
  });
  if (!org || !sql) {
    points.value = [];
    return;
  }

  controller?.abort();
  const mine = new AbortController();
  controller = mine;

  loading.value = true;
  error.value = "";

  const endSecs = Math.floor(Date.now() / 1000);
  const startSecs = endSecs - (RANGE_SECS[range.value] ?? RANGE_SECS["1h"]);

  try {
    const res = await searchService.search(
      {
        org_identifier: org,
        query: {
          query: {
            sql,
            start_time: startSecs * 1_000_000,
            end_time: endSecs * 1_000_000,
            from: 0,
            size: -1,
          },
        },
        page_type: props.streamType || "logs",
        signal: mine.signal,
      },
      "ui",
    );

    if (controller !== mine) return;
    const hits: any[] = res?.data?.hits ?? [];
    points.value = hits
      .map((h) => {
        const raw = h?.[VALUE_ALIAS];
        const value = Number(raw);
        return {
          ts: parseSliceStart(h?.[SLICE_ALIAS]),
          value: raw === null || raw === undefined || !Number.isFinite(value) ? null : value,
        };
      })
      .filter((p) => Number.isFinite(p.ts))
      .sort((a, b) => a.ts - b.ts);
  } catch (e: any) {
    // An abort is this component tidying up after itself, not a failure.
    if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
    if (controller !== mine) return;
    points.value = [];
    error.value = e?.response?.data?.message || t("slos.preview.loadFailed");
  } finally {
    // Only the CURRENT request may clear the spinner: a superseded request's
    // `finally` would otherwise drop it while the new search is still running.
    if (controller === mine) loading.value = false;
  }
}

// Debounced, like the count preview: the aggregate and scope change per
// keystroke and every rebuild is a search. The THRESHOLD is deliberately not
// in here — it never reaches SQL, so moving it reclassifies the slices already
// in hand, and dragging it re-scores instantly with no query at all.
let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [props.stream, props.streamType, props.scope, props.aggregate, props.sliceIntervalSecs],
  () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(load, 500);
  },
);

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});
onMounted(load);
</script>
