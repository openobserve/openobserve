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
  Error-budget burndown and burn rate over the SLO's window.

  The stat tiles above answer "where am I now"; these answer "how did I get
  here", which is the question that decides whether to page someone. A budget
  at 40% is calm if it has been drifting down for six days and an emergency if
  it fell there in twenty minutes — the tile cannot tell those apart.

  TWO charts, not two series on one. Percent-remaining and a burn multiple have
  unrelated scales (0–100 vs 0–600+ in a bad incident), and putting them on one
  axis means either a dual axis — which makes the crossing point pure artifact
  of the two scalings — or one series crushed flat against the baseline.

  Both read the SAME numbers from the SAME slices; they differ only in the
  window they aggregate over (see `toBurndownSeries`). Drawing them side by
  side is what makes that relationship legible: burn spikes above 1, budget
  bends downward.
-->
<template>
  <div class="flex flex-col gap-3" data-test="slos-sloburndownchart-root">
    <div
      v-for="panel in panels"
      :key="panel.key"
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      :data-test="`slos-sloburndownchart-${panel.key}`"
    >
      <div
        class="border-border-default text-compact text-text-heading flex min-h-7 w-full items-center justify-between gap-2 border-b px-2 py-1 font-medium tracking-[0.02em]"
      >
        <span class="flex items-center gap-1">
          {{ panel.label }}
          <!-- The formula, not just prose: "budget remaining" and "burn rate"
               are both derived numbers, and a reader deciding whether to page
               someone needs to know exactly what was divided by what. -->
          <OIcon
            name="info"
            size="sm"
            class="text-icon-color cursor-help"
            :label="t('slos.chart.about')"
            :data-test="`slos-sloburndownchart-${panel.key}-info`"
          >
            <OTooltip side="right" max-width="26rem" :delay="150" hoverable>
              <template #content>
                <div class="flex flex-col gap-2">
                  <p class="text-xs leading-relaxed">{{ panel.explain }}</p>
                  <div class="flex flex-col gap-1">
                    <span class="text-text-secondary text-2xs font-semibold uppercase">
                      {{ t("slos.chart.formulaLabel") }}
                    </span>
                    <!-- The interpolation hugs the tags: `whitespace-pre-line`
                         keeps newlines, so template indentation around it would
                         render as a blank first line inside the block. -->
                    <code
                      class="bg-surface-subtle text-text-code rounded-default text-2xs block px-2 py-1 leading-relaxed whitespace-pre-line"
                      >{{ panel.formula }}</code
                    >
                  </div>
                  <p class="text-text-secondary text-2xs leading-relaxed">{{ panel.note }}</p>
                </div>
              </template>
            </OTooltip>
          </OIcon>
        </span>
        <span class="text-text-secondary font-normal">{{ panel.hint }}</span>
      </div>

      <div class="h-60 w-full">
        <div
          v-if="loading"
          class="flex h-full items-center justify-center"
          :data-test="`slos-sloburndownchart-${panel.key}-loading`"
        >
          <OSpinner size="sm" />
        </div>
        <div
          v-else-if="error"
          class="flex h-full items-center justify-center px-4 text-center"
          :data-test="`slos-sloburndownchart-${panel.key}-error`"
        >
          <span class="text-text-secondary text-sm">{{ error }}</span>
        </div>
        <div
          v-else-if="!hasData"
          class="flex h-full items-center justify-center px-4 text-center"
          :data-test="`slos-sloburndownchart-${panel.key}-empty`"
        >
          <span class="text-text-secondary text-sm">{{ t("slos.chart.empty") }}</span>
        </div>
        <ChartRenderer
          v-else
          :data="{ options: panel.options }"
          :data-test="`slos-sloburndownchart-${panel.key}-chart`"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { format } from "date-fns";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import searchService from "@/services/search";
import {
  bucketSecsFor,
  buildSloBurndownQuery,
  toBurndownSeries,
  type SloBurndownPoint,
  type SloSliceBucket,
} from "@/utils/slos/burndownQuery";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  sloId: string;
  /** Filters slices to the current epoch — mixing generations is corruption (D59). */
  generation: number;
  /** Percentage, 0..100. */
  target: number;
  windowSecs: number;
  sliceIntervalSecs: number;
}>();

const { t } = useI18n();
const store = useStore();

const points = ref<SloBurndownPoint[]>([]);
const loading = ref(false);
const error = ref("");

const hasData = computed(() => points.value.some((p) => p.remaining !== null || p.burn !== null));

/** Read a design token for the chart renderer, which takes colour STRINGS and
 *  cannot be handed a utility class. Resolved at build time rather than
 *  hardcoded so the charts follow the theme. */
const resolveToken = (token: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(token).trim();
  return value || fallback;
};

/** Span decides the label format: "14:05" is useless across 90 days. */
const labelFormat = computed(() => (props.windowSecs > 2 * 86400 ? "MM-dd" : "MM-dd HH:mm"));

const labels = computed(() =>
  points.value.map((p) => format(new Date(p.ts * 1000), labelFormat.value)),
);

/** Shared chrome. Recessive axes and a crosshair tooltip on both charts, so
 *  the pair reads as one instrument rather than two unrelated panels. */
function baseOptions(axisColor: string, gridColor: string) {
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
  };
}

const budgetOptions = computed(() => {
  void store.state.theme; // getComputedStyle is not reactive — re-resolve on flip.
  const accent = resolveToken("--color-accent", "#5960b2");
  const danger = resolveToken("--color-severity-error-color", "#ef5350");
  const axisColor = resolveToken("--color-text-secondary", "#6b7280");
  const gridColor = resolveToken("--color-border-default", "#e5e7eb");

  return {
    ...baseOptions(axisColor, gridColor),
    yAxis: {
      type: "value",
      axisLabel: { formatter: "{value}%", color: axisColor },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
    },
    series: [
      {
        name: t("slos.chart.budgetRemaining"),
        type: "line",
        smooth: false,
        showSymbol: false,
        // Gaps stay gaps: an unmeasured bucket is `null`, and joining across it
        // would draw a budget line through time nobody observed.
        connectNulls: false,
        lineStyle: { width: 2, color: accent },
        itemStyle: { color: accent },
        data: points.value.map((p) => p.remaining),
        markLine: {
          symbol: "none",
          animation: false,
          silent: true,
          lineStyle: { color: danger, type: "dashed" },
          label: { formatter: t("slos.chart.exhausted"), position: "insideEndTop" },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
});

const burnOptions = computed(() => {
  void store.state.theme;
  const accent = resolveToken("--color-accent", "#5960b2");
  const warning = resolveToken("--color-severity-warning-color", "#fb8c00");
  const axisColor = resolveToken("--color-text-secondary", "#6b7280");
  const gridColor = resolveToken("--color-border-default", "#e5e7eb");

  return {
    ...baseOptions(axisColor, gridColor),
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { formatter: "×{value}", color: axisColor },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
    },
    series: [
      {
        name: t("slos.chart.burnRate"),
        type: "line",
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: accent },
        itemStyle: { color: accent },
        data: points.value.map((p) => p.burn),
        // ×1 is the only threshold that means anything here: at exactly 1 the
        // budget lands on the window's end. Above it the SLO is overspending,
        // below it is banking budget — which is unreadable without the line.
        markLine: {
          symbol: "none",
          animation: false,
          silent: true,
          lineStyle: { color: warning, type: "dashed" },
          label: { formatter: t("slos.chart.neutralBurn"), position: "insideEndTop" },
          data: [{ yAxis: 1 }],
        },
      },
    ],
  };
});

// `explain` / `formula` / `note` are the info tooltip's three parts, in the
// order a reader needs them: what the line is, the arithmetic behind it, and
// how to read the threshold. The formulas mirror `toBurndownSeries` (and so
// `config::meta::slo::math`) — if the arithmetic there changes, these change
// with it, or the page documents a calculation it no longer performs.
const panels = computed(() => [
  {
    key: "budget",
    label: t("slos.chart.budgetTitle"),
    hint: t("slos.chart.cumulativeHint"),
    explain: t("slos.chart.budgetExplain"),
    formula: t("slos.chart.budgetFormula"),
    note: t("slos.chart.budgetNote"),
    options: budgetOptions.value,
  },
  {
    key: "burn",
    label: t("slos.chart.burnTitle"),
    hint: t("slos.chart.perBucketHint"),
    explain: t("slos.chart.burnExplain"),
    formula: t("slos.chart.burnFormula"),
    note: t("slos.chart.burnNote"),
    options: burnOptions.value,
  },
]);

// An abandoned search holds a slot in the server's work-group queue until it
// completes, so leaving the page mid-query has to abort rather than just drop
// the result (see the `signal` note on the search service).
let controller: AbortController | null = null;

async function load() {
  const org = store.state.selectedOrganization?.identifier;
  if (!org || !props.sloId || !(props.windowSecs > 0)) return;

  controller?.abort();
  const mine = new AbortController();
  controller = mine;

  loading.value = true;
  error.value = "";

  const nowSecs = Math.floor(Date.now() / 1000);
  const startSecs = nowSecs - props.windowSecs;
  const sql = buildSloBurndownQuery({
    sloId: props.sloId,
    generation: props.generation,
    startSecs,
    bucketSecs: bucketSecsFor(props.windowSecs, props.sliceIntervalSecs),
  });

  try {
    const res = await searchService.search(
      {
        org_identifier: org,
        query: {
          query: {
            sql,
            // The search API filters on `_timestamp` (WRITE time) while the SQL
            // filters on `slice_start` (measurement time). Backfill writes old
            // measurements with a current `_timestamp`, so the scan range has to
            // be generous or freshly-backfilled history is filtered out before
            // the WHERE clause ever sees it. One extra window is enough: nothing
            // writes a slice older than the window it belongs to.
            start_time: (startSecs - props.windowSecs) * 1_000_000,
            end_time: nowSecs * 1_000_000,
            from: 0,
            size: -1,
          },
        },
        page_type: "logs",
        signal: mine.signal,
      },
      "ui",
    );

    if (controller !== mine) return;
    const hits: SloSliceBucket[] = res?.data?.hits ?? [];
    points.value = toBurndownSeries(hits, props.target);
  } catch (e: any) {
    // An abort is this component tidying up after itself, not a failure to
    // report to the user.
    if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
    if (controller !== mine) return;
    points.value = [];
    error.value = e?.response?.data?.message || t("slos.chart.loadFailed");
  } finally {
    // Only the CURRENT request may clear the spinner. `finally` runs even for
    // the superseded request that was just aborted — and since a prop change
    // aborts the old search and starts a new one, the old one's `finally`
    // would land while the new one is still in flight, dropping the spinner
    // and flashing the empty state over data that is about to arrive.
    if (controller === mine) loading.value = false;
  }
}

watch(
  () => [props.sloId, props.generation, props.target, props.windowSecs, props.sliceIntervalSecs],
  load,
  { immediate: true },
);

onBeforeUnmount(() => controller?.abort());
</script>
