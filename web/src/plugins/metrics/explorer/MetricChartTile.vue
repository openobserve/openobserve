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
    ref="root"
    class="border-border-default rounded-surface flex min-w-0 flex-col overflow-hidden border"
    :data-test="dataTest"
  >
    <PanelBar class="min-w-0 gap-2" @click="emit('select')">
      <slot name="header" />
    </PanelBar>

    <!-- Not part of the select target: the mouseup ending a drag-to-zoom arrives as a click. -->
    <div class="relative min-h-0 flex-1 cursor-default">
      <OSpinner
        v-if="refreshing"
        size="xs"
        class="absolute top-1 right-1 z-10"
        :data-test="`${dataTest}-refreshing`"
      />
      <div
        v-if="state.status === 'error'"
        class="text-text-secondary flex h-full flex-col items-center justify-center gap-1 text-xs"
        :title="state.error"
        :data-test="`${dataTest}-error`"
      >
        <OIcon name="error" size="sm" class="text-error-600" />
        <span>{{ t("metrics.explorer.queryFailed") }}</span>
        <OButton
          variant="ghost-primary"
          size="xs"
          :data-test="`${dataTest}-retry`"
          @click.stop="load"
        >
          {{ t("metrics.explorer.retry") }}
        </OButton>
      </div>

      <div
        v-else-if="queries && !queries.length"
        class="text-text-secondary flex h-full items-center justify-center text-xs"
        :data-test="`${dataTest}-nopreview`"
      >
        {{ t("metrics.explorer.card.noPreview") }}
      </div>

      <div
        v-else-if="state.status === 'done' && !hasData"
        class="text-text-secondary flex h-full items-center justify-center text-xs"
        :data-test="`${dataTest}-nodata`"
      >
        {{ t("metrics.explorer.noData") }}
      </div>

      <slot
        v-else-if="state.status === 'done'"
        name="chart"
        :results="state.results"
        :time-range="state.timeRange"
        :on-render-error="onRenderError"
      >
        <MetricCardChart
          :results="state.results"
          :queries="queries ?? []"
          :chart-type="chartType"
          :unit="o2Unit.unit"
          :unit-custom="o2Unit.unitCustom ?? undefined"
          :bucket-unit="bucketO2Unit.unit ?? undefined"
          :bucket-unit-custom="bucketO2Unit.unitCustom ?? undefined"
          :color="color"
          :time-range="state.timeRange"
          :legend="legend"
          :allow-alert-creation="allowAlertCreation"
          :shifted="state.shifted ?? []"
          :step-seconds="state.stepSeconds ?? 0"
          @error="onRenderError"
        />
      </slot>

      <div v-else class="h-full p-2" :data-test="`${dataTest}-loading`">
        <OSkeleton class="h-full" animation="wave" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import MetricCardChart from "./MetricCardChart.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { parseSearchError } from "@/utils/query/searchError";
import { toO2Unit } from "@/utils/metrics/metricDefaults";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { hasSamples, type QueryWindow } from "@/composables/metrics/useMetricsExplorerGrid";
import type { ShiftedResult } from "./MetricCardChart.vue";

export interface TileQuery {
  expr: string;
  legendTemplate?: string;
  /** The stream the query reads, for an alert created from the chart. */
  stream?: string;
}

/** An earlier period to chart beside the current one. */
export interface TileCompare {
  gapMs: number;
  periodAsStr: string;
}

interface TileState {
  status: "idle" | "loading" | "done" | "error";
  results: any[];
  shifted?: ShiftedResult[];
  /** The step `results` were queried at, kept with them like `timeRange`. */
  stepSeconds?: number;
  error: string;
  /** The window `results` were queried for: a chart kept through a refresh stays on its axis. */
  timeRange?: { start_time: number; end_time: number };
}

const IDLE: TileState = { status: "idle", results: [], error: "" };

const props = withDefaults(
  defineProps<{
    /** `null` while the query is still being decided; empty when the metric has none to chart. */
    queries: TileQuery[] | null;
    chartType?: string;
    unit?: string | null;
    bucketUnit?: string | null;
    color: string;
    timeRange: { start_time: number; end_time: number };
    legend?: boolean;
    /** Offer the chart's right-click "Create alert" menu. */
    allowAlertCreation?: boolean;
    /** Chart each query again over the period this far back. */
    compare?: TileCompare | null;
    stepSeconds?: number;
    /** A signal, not a cancel by expr, so two tiles on one query never cancel each other. */
    runQuery: (expr: string, signal: AbortSignal, opts?: { window?: QueryWindow }) => Promise<any>;
    dataTest: string;
  }>(),
  {
    chartType: "line",
    unit: null,
    bucketUnit: null,
    legend: false,
    allowAlertCreation: false,
    compare: null,
    stepSeconds: 0,
  },
);

const emit = defineEmits<{
  select: [];
  /** What the tile holds, so a parent can read the fetched series without querying again. */
  results: [state: { status: TileState["status"]; results: any[] }];
}>();

const { t } = useI18nTyped();

const root = ref<HTMLElement | null>(null);
const state = ref<TileState>(IDLE);
watch(state, ({ status, results }) => emit("results", { status, results }), { immediate: true });
const hasData = computed(() => state.value.results.some(hasSamples));
const o2Unit = computed(() => toO2Unit(props.unit ?? ""));
const bucketO2Unit = computed(() =>
  props.bucketUnit ? toO2Unit(props.bucketUnit) : { unit: null, unitCustom: null },
);

const visible = ref(false);
/** Marks a kept chart, which would otherwise give no sign that it is reloading. */
const refreshing = ref(false);
/** The shown result no longer matches the query and window; reload when next seen. */
let stale = true;
/** Bumped per load, so a superseded result never lands. */
let generation = 0;
let active: AbortController | null = null;
/** What the last load asked for, so a watcher catching up on it does not ask again. */
let loadedFor: { key: string; timeRange: object } | null = null;

const queryKey = () => {
  const exprs = props.queries?.map((query) => query.expr).join("\n");
  return exprs === undefined ? null : `${exprs}\n${props.compare?.gapMs ?? 0}`;
};

const cancelActive = () => {
  active?.abort();
  active = null;
};

const load = async () => {
  const mine = ++generation;
  cancelActive();
  const exprs = props.queries?.map((query) => query.expr) ?? [];
  if (!exprs.length) {
    state.value = IDLE;
    return;
  }
  stale = false;
  const timeRange = props.timeRange;
  const compare = props.compare;
  const stepSeconds = props.stepSeconds;
  loadedFor = { key: queryKey() ?? "", timeRange };
  active = new AbortController();
  const { signal } = active;
  // Only a chart of this same query is still kept here: a new query resets to IDLE first.
  if (state.value.status === "done") refreshing.value = true;
  else state.value = { status: "loading", results: [], error: "" };
  try {
    const window = compare && {
      start: timeRange.start_time - compare.gapMs * 1000,
      end: timeRange.end_time - compare.gapMs * 1000,
    };
    const [results, past] = await Promise.all([
      Promise.all(exprs.map((expr) => props.runQuery(expr, signal))),
      window ? Promise.all(exprs.map((expr) => props.runQuery(expr, signal, { window }))) : [],
    ]);
    if (mine !== generation) return;
    active = null;
    refreshing.value = false;
    const shifted = compare
      ? past.map((result, parentIndex) => ({ result, ...compare, parentIndex }))
      : [];
    state.value = { status: "done", results, shifted, error: "", timeRange, stepSeconds };
  } catch (error: any) {
    if (mine !== generation) return;
    // The other queries of a failed load are not worth finishing.
    cancelActive();
    refreshing.value = false;
    if (isCancelled(error)) {
      // Not its own doing (that bumps `generation`): a shared query or bulk clear cancelled it.
      stale = true;
      if (visible.value) load();
      else if (state.value.status === "loading") state.value = IDLE;
      return;
    }
    state.value = { status: "error", results: [], error: parseSearchError(error).message };
  }
};

/** Drops whatever is shown or running; only an on-screen tile queries again now. */
const invalidate = () => {
  if (!stale && loadedFor?.key === queryKey() && loadedFor?.timeRange === props.timeRange) return;
  // A new window alone (a refresh tick) keeps the drawn chart until the new result lands.
  const windowOnly = loadedFor?.key === queryKey();
  generation += 1;
  cancelActive();
  refreshing.value = false;
  stale = true;
  if (!windowOnly || state.value.status !== "done") state.value = IDLE;
  if (visible.value) load();
};

// Sources compared one by one: a getter returning a fresh array re-fires on every rebuild.
watch([queryKey, () => props.timeRange], invalidate);

watch(visible, (isVisible) => {
  if (isVisible) {
    if (stale) load();
  } else if (active) {
    // Scrolled away mid-load: its queue slot belongs to a tile someone is looking at.
    generation += 1;
    cancelActive();
    refreshing.value = false;
    stale = true;
    if (state.value.status === "loading") state.value = IDLE;
  }
});

const onRenderError = (error: any) => {
  state.value = {
    status: "error",
    results: [],
    error: String(error || t("metrics.functionConfigDialog.failedToRenderChart")),
  };
};

let observer: IntersectionObserver | null = null;
onMounted(() => {
  if (!root.value || typeof IntersectionObserver === "undefined") {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) visible.value = entry.isIntersecting;
    },
    // eslint-disable-next-line local/no-hardcoded-px -- IntersectionObserver rootMargin parses px/% only — a rem value throws SyntaxError
    { rootMargin: "100% 0px" },
  );
  observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  generation += 1;
  cancelActive();
});
</script>
