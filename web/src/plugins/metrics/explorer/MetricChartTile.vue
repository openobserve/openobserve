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

<!-- One chart of the detail view, queried only while on screen. -->
<template>
  <div
    ref="root"
    class="border-border-default rounded-surface flex min-w-0 flex-col overflow-hidden border"
    :data-test="dataTest"
  >
    <PanelBar class="min-w-0 gap-2">
      <slot name="header" />
    </PanelBar>

    <div class="relative min-h-0 flex-1">
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

      <MetricCardChart
        v-else-if="state.status === 'done'"
        :results="state.results"
        :queries="queries ?? []"
        :chart-type="chartType"
        :unit="o2Unit.unit"
        :unit-custom="o2Unit.unitCustom ?? undefined"
        :bucket-unit="bucketO2Unit.unit ?? undefined"
        :bucket-unit-custom="bucketO2Unit.unitCustom ?? undefined"
        :color="color"
        :time-range="timeRange"
        :legend="legend"
        @error="onRenderError"
      />

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
import { parseSearchError } from "@/utils/query/searchError";
import { toO2Unit } from "@/utils/metrics/metricDefaults";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { hasSamples } from "@/composables/metrics/useMetricsExplorerGrid";

export interface TileQuery {
  expr: string;
  legendTemplate?: string;
}

interface TileState {
  status: "idle" | "loading" | "done" | "error";
  results: any[];
  error: string;
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
    runQuery: (expr: string) => Promise<any>;
    cancelQueries: (exprs: string[]) => void;
    dataTest: string;
  }>(),
  { chartType: "line", unit: null, bucketUnit: null, legend: false },
);

const { t } = useI18nTyped();

const root = ref<HTMLElement | null>(null);
const state = ref<TileState>(IDLE);
const hasData = computed(() => state.value.results.some(hasSamples));
const o2Unit = computed(() => toO2Unit(props.unit ?? ""));
const bucketO2Unit = computed(() =>
  props.bucketUnit ? toO2Unit(props.bucketUnit) : { unit: null, unitCustom: null },
);

const visible = ref(false);
/** The shown result no longer matches the query and window; reload when next seen. */
let stale = true;
/** Bumped per load, so a superseded result never lands. */
let generation = 0;
let activeExprs: string[] = [];
/** What the last load asked for, so a watcher catching up on it does not ask again. */
let loadedFor: { key: string; timeRange: object } | null = null;

const queryKey = () => props.queries?.map((query) => query.expr).join("\n") ?? null;

const cancelActive = () => {
  if (activeExprs.length) props.cancelQueries(activeExprs);
  activeExprs = [];
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
  loadedFor = { key: exprs.join("\n"), timeRange: props.timeRange };
  activeExprs = exprs;
  state.value = { status: "loading", results: [], error: "" };
  try {
    const results = await Promise.all(exprs.map((expr) => props.runQuery(expr)));
    if (mine !== generation) return;
    activeExprs = [];
    state.value = { status: "done", results, error: "" };
  } catch (error: any) {
    if (mine !== generation) return;
    activeExprs = [];
    if (isCancelled(error)) {
      stale = true;
      state.value = IDLE;
      return;
    }
    state.value = { status: "error", results: [], error: parseSearchError(error).message };
  }
};

/** Drops whatever is shown or running; only an on-screen tile queries again now. */
const invalidate = () => {
  if (!stale && loadedFor?.key === queryKey() && loadedFor?.timeRange === props.timeRange) return;
  generation += 1;
  cancelActive();
  stale = true;
  state.value = IDLE;
  if (visible.value) load();
};

// Sources compared one by one: a getter returning a fresh array re-fires on every rebuild.
watch([queryKey, () => props.timeRange], invalidate);

watch(visible, (isVisible) => {
  if (isVisible) {
    if (stale) load();
  } else if (state.value.status === "loading") {
    // Scrolled away mid-load: its queue slot belongs to a tile someone is looking at.
    generation += 1;
    cancelActive();
    stale = true;
    state.value = IDLE;
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
