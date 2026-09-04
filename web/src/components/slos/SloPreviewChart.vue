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
  Live good/bad events preview for a count SLI, while the user is still
  defining it.

  Exists because the alternative is finding out AFTER saving: a wrong
  `good_expr` saves cleanly and then measures nonsense (or nothing), and the
  mistake only surfaces days later as a mysterious SLI. Seeing the counts move
  while typing is the validation no save-time check can give.

  TWO charts, not two series on one. Good and bad are counted from the same
  scan, so they are near-perfect mirrors — on a shared axis the pair reads as
  one crossing tangle, and (far worse) the tall series flattens the short one
  into the baseline. Bad is the series that matters and it is the small one:
  give it its own axis and "27 bad events" is legible next to "19k good".

  BARS, not lines: these are counts per bucket — discrete quantities in
  discrete intervals. A line implies interpolation between buckets, which is
  meaningless for a count.

  The queries use the same CASE-SUM shape the ingest pass uses, so what the
  preview draws is what the SLO will measure.

  Over a METRICS stream the pair is good and TOTAL instead, because that is what
  `CountSource::PromQl` is: two independent expressions where total is the
  denominator, not the complement. Nothing there is one scan, so there is no
  "bad" to derive — `total - good` is a subtraction between two separately
  evaluated counters, and it goes negative on any reset or float drift between
  them. Those two run as range evaluations here rather than through the panel
  renderer, so the step and the slice attribution are the ingest pass's own
  (`prom_query`); the range is not snapped to the slice grid, so the boundaries
  are phase-shifted against the stored ones while the shape is the same.
-->
<template>
  <div class="flex flex-col gap-2" data-test="slos-slopreviewchart-root">
    <!-- The range picker is the only chrome here — no section heading. Two
         charts labelled "Good events" / "Bad events" already say what this
         is, and a third "Preview" heading above them was pure vertical cost
         in a column that needs the height for the bars. -->
    <div class="flex items-center justify-end">
      <!-- One picker for both charts: they are two readings of the same
           window, and separate pickers would let them silently disagree. -->
      <OToggleGroup
        :model-value="range"
        data-test="slos-slopreviewchart-range"
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

    <!-- The dashboard panel shape: `PanelBar` (the same bar `PanelContainer`
         uses), then the chart filling everything below it. The title reads as
         part of the panel rather than floating above it, and the chart gets the
         remaining height instead of competing with padding for it. -->
    <div
      v-for="panel in panels"
      :key="panel.key"
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      :data-test="`slos-slopreviewchart-${panel.key}`"
    >
      <PanelBar class="w-full">
        {{ panel.label }}
      </PanelBar>
      <div class="h-45 w-full">
        <!-- PromQL owns its own request lifecycle, where the SQL branch hands
             that to the panel renderer — so this side has the states the
             renderer would otherwise have drawn. -->
        <template v-if="isPromql">
          <div
            v-if="loading"
            class="flex h-full items-center justify-center"
            :data-test="`slos-slopreviewchart-${panel.key}-loading`"
          >
            <OSpinner size="sm" />
          </div>
          <div
            v-else-if="error"
            class="flex h-full items-center justify-center px-4 text-center"
            :data-test="`slos-slopreviewchart-${panel.key}-error`"
          >
            <span class="text-text-secondary text-sm">{{ error }}</span>
          </div>
          <ChartRenderer
            v-else-if="panel.options"
            :data="{ options: panel.options }"
            :data-test="`slos-slopreviewchart-${panel.key}-chart`"
          />
          <div
            v-else
            class="flex h-full items-center justify-center px-4 text-center"
            :data-test="`slos-slopreviewchart-${panel.key}-empty`"
          >
            <span class="text-text-secondary text-sm">{{ promqlEmptyNotice }}</span>
          </div>
        </template>
        <PanelSchemaRenderer
          v-else-if="panel.schema"
          :height="4"
          :width="5"
          :panelSchema="panel.schema"
          :selectedTimeObj="selectedTimeObj"
          :variablesData="{}"
          searchType="ui"
          :data-test="`slos-slopreviewchart-${panel.key}-panel`"
        />
        <div
          v-else
          class="flex h-full items-center justify-center"
          :data-test="`slos-slopreviewchart-${panel.key}-empty`"
        >
          <span class="text-text-secondary text-sm">
            {{ t("slos.preview.needsDefinition") }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { chartAxisLine, chartColor, chartTextColor } from "@/utils/chartTheme";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import searchService from "@/services/search";
import { getDefaultDashboardPanelData } from "@/utils/alerts/aggregationPreviewQuery";
import {
  buildSloPreviewQuery,
  buildSloPromqlPreviewRange,
  promqlCountSeriesPoints,
  type SloPreviewPoint,
  type SloPromqlPreviewRange,
} from "@/utils/slos/previewQuery";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = withDefaults(
  defineProps<{
    streamType: string;
    /** Optional because `CountSource::PromQl` has no stream: an SLO stored in
     *  that arm hydrates the form without one. */
    stream?: string;
    /** SQL predicate; empty = all rows. */
    scope?: string;
    /** SQL predicate defining a good event. Required for a drawable preview. */
    goodExpr?: string;
    /** `CountSource::PromQl`'s numerator. */
    good?: string;
    /** `CountSource::PromQl`'s DENOMINATOR — not the complement of `good`. */
    total?: string;
    /** The API's discriminator. `prom_ql` is a range evaluation, not a scan. */
    queryLanguage?: "sql" | "prom_ql";
    /** Sets the evaluation step AND the slice each sample is attributed to.
     *  Optional because the SQL branch has no use for it: its `histogram()`
     *  carries no interval. */
    sliceIntervalSecs?: number;
  }>(),
  { stream: "", queryLanguage: "sql", sliceIntervalSecs: 300 },
);

const { t } = useI18nTyped();
const store = useStore();

// Semantic series colours. Literal hex because this is chart data, not
// component styling: the renderer takes colour strings, not utility classes,
// and every other panel colour in the app is specified the same way (see
// `classicColorPaletteLightTheme`). Values match the palette's green and red
// so the charts stay consistent with the rest of the product.
const GOOD_COLOR = "#34d399";
const BAD_COLOR = "#f87171";

// The PromQL bars resolve their colours through `chartTheme`, the sanctioned
// seam for handing a token's value to a renderer that takes colour strings.
// series-2 is the same green as GOOD_COLOR above; the denominator is blue and
// not a second green, because total is not "more good" — it is what good is
// measured against.
const GOOD_TOKEN = "--color-chart-series-2";
const TOTAL_TOKEN = "--color-chart-series-1";

const goodSchema = ref<any>(null);
const badSchema = ref<any>(null);
const selectedTimeObj = ref<any>(null);
const range = ref<string>("1h");

const isPromql = computed(() => props.queryLanguage === "prom_ql");

const goodPoints = ref<SloPreviewPoint[]>([]);
const totalPoints = ref<SloPreviewPoint[]>([]);
const loading = ref(false);
const error = ref("");

/** A panel carries a SCHEMA on the SQL branch and chart OPTIONS on the PromQL
 *  one: the first is rendered by the dashboard stack, the second is drawn from
 *  points this component fetched itself. */
interface PreviewPanel {
  key: string;
  label: I18nText;
  schema?: unknown;
  /** `null` until there is something to draw. */
  options?: unknown;
}

/**
 * ONE axis for both panels, from the union of the slices either side answered.
 *
 * They are stacked, which invites reading bar N of one against bar N of the
 * other — and the two are separate evaluations that need not cover the same
 * slices (a label-filtered numerator whose series churns is the ordinary case).
 * Per-panel axes would put different slices in the same column.
 */
const alignedSlices = computed(() => {
  const all = new Set<number>();
  for (const point of [...goodPoints.value, ...totalPoints.value]) all.add(point.ts);
  return [...all].sort((a, b) => a - b);
});

/** Formatted once for both panels — the shared axis is the point. */
const sliceLabels = computed(() =>
  alignedSlices.value.map((ts) => format(toZonedTime(ts, store.state.timezone), "HH:mm")),
);

const byTs = (points: SloPreviewPoint[]) => new Map(points.map((p) => [p.ts, p.value]));

/**
 * The numerator's bar for every slice on the axis.
 *
 * A slice the DENOMINATOR answered and the numerator did not is a ZERO, not a
 * gap: `promql_rows` iterates totals and defaults the numerator to `0.0`, so
 * the SLO records that slice at 0% — traffic continued and none of it was good,
 * which is the most important thing a count preview can show. Drawing it as a
 * gap is exactly the "nothing was good" / "no traffic" confusion the SQL
 * branch's CASE-SUM exists to avoid.
 *
 * `has`, not `??`: a slice the numerator answered UNREADABLY is already `null`
 * and must stay a gap rather than being promoted to a confident zero.
 */
const goodValues = computed<Array<number | null>>(() => {
  const good = byTs(goodPoints.value);
  const total = byTs(totalPoints.value);
  return alignedSlices.value.map((ts) => {
    if (good.has(ts)) return good.get(ts) ?? null;
    return total.has(ts) ? 0 : null;
  });
});

/** The reverse has no such rule: `promql_rows` emits no row at all for a slice
 *  only the numerator answered, so the denominator is honestly a gap there. */
const totalValues = computed<Array<number | null>>(() => {
  const total = byTs(totalPoints.value);
  return alignedSlices.value.map((ts) => total.get(ts) ?? null);
});

// Numerator first, denominator below — the order the user reads them in, and
// the order the SLI is written in.
const panels = computed<PreviewPanel[]>(() =>
  isPromql.value
    ? [
        {
          key: "good",
          label: t("slos.preview.goodEvents"),
          options: chartOptionsFor(goodValues.value, GOOD_TOKEN),
        },
        {
          key: "total",
          label: t("slos.preview.totalEvents"),
          options: chartOptionsFor(totalValues.value, TOTAL_TOKEN),
        },
      ]
    : [
        { key: "good", label: t("slos.preview.goodEvents"), schema: goodSchema.value },
        { key: "bad", label: t("slos.preview.badEvents"), schema: badSchema.value },
      ],
);

/** Both expressions, or there is no SLI to preview — `total` is the
 *  denominator, so half a definition previews nothing. */
const hasPromqlPair = computed(() => !!props.good?.trim() && !!props.total?.trim());

/** "Nothing typed yet" and "ran, and the range was empty" are different
 *  answers, and only one of them is the user's cue to keep typing. */
const promqlEmptyNotice = computed(() =>
  hasPromqlPair.value ? t("slos.preview.noSlices") : t("slos.preview.needsPromqlDefinition"),
);

const rangeOptions = computed(() => [
  { value: "1h", label: t("alerts.groups.range1h") },
  { value: "6h", label: t("alerts.groups.range6h") },
  { value: "24h", label: t("alerts.groups.range24h") },
]);

const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  build();
};

function panelFor(series: "good" | "bad", color: string) {
  const sql = buildSloPreviewQuery(props.stream, props.scope, props.goodExpr, series);
  const stream = props.stream?.trim();
  if (!sql || !stream) return null;

  const panel: any = cloneDeep(getDefaultDashboardPanelData());
  panel.data.type = "bar";
  panel.data.queryType = "sql";
  panel.data.config.unit = "numbers";
  // `fixed`, not a name-keyed mapping. Each chart draws exactly ONE series,
  // so the colour needs no lookup — and a name-keyed mapping would silently
  // break the moment the series label changes, which is exactly what blanking
  // the axis titles below does. The default (hashing the series NAME into the
  // palette) is what drew good and bad in the same blue when they shared a
  // chart, so leaving it unset is not an option either.
  panel.data.config.color = {
    mode: "fixed",
    fixedColor: [color],
    seriesBy: "last",
    colorBySeries: [],
  };
  panel.data.queries[0].customQuery = true;
  panel.data.queries[0].query = sql;
  panel.data.queries[0].vrlFunctionQuery = null;
  panel.data.queries[0].fields.stream = stream;
  panel.data.queries[0].fields.stream_type = props.streamType || "logs";
  // Empty labels, deliberately: the axis TITLES are rendered from these
  // (`xAxis.name` / `yAxis.name`), and in a small card they are pure noise —
  // the card header already says "Good events", and the x axis is obviously
  // time. Same trick the alert preview uses (`clearFieldLabels`). The tick
  // values stay; only the titles go.
  panel.data.queries[0].fields.x = [
    { alias: "zo_sql_key", column: "zo_sql_key", color: null, label: "" },
  ];
  panel.data.queries[0].fields.y = [
    { alias: "zo_sql_num", column: "zo_sql_num", color: null, label: "" },
  ];
  panel.data.queries[0].fields.z = [];
  panel.data.queries[0].fields.breakdown = [];
  panel.data.queries[0].fields.filter = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [],
  };
  return panel.data;
}

/** `null` when neither evaluation produced anything — the caller draws a notice
 *  rather than an empty pair of axes. */
function chartOptionsFor(values: Array<number | null>, colorToken: `--${string}`) {
  if (!alignedSlices.value.length) return null;
  void store.state.theme; // The resolved values are cached — re-read on a flip.
  const axisColor = chartTextColor();
  const gridColor = chartAxisLine();

  return {
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: sliceLabels.value,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { hideOverlap: true, color: axisColor },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: axisColor },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
    },
    // Bars for the same reason the SQL panels use them: a count per slice is a
    // discrete quantity, and a line between two of them means nothing.
    series: [{ type: "bar", data: values, itemStyle: { color: chartColor(colorToken) } }],
  };
}

// An abandoned evaluation holds a slot in the server's work-group queue until
// it completes, so a superseded preview has to abort rather than just drop the
// result. One controller for both sides: they are one reading.
let controller: AbortController | null = null;

function clearPromql() {
  controller?.abort();
  controller = null;
  goodPoints.value = [];
  totalPoints.value = [];
  error.value = "";
  loading.value = false;
}

async function runRange(
  org: string,
  request: SloPromqlPreviewRange,
  /** Taken from the caller, NOT re-read from props after the await: the slice
   *  width can change while the pair is in flight, and folding a response with
   *  an interval the request was not stepped at shifts every bar. */
  sliceIntervalSecs: number,
  signal: AbortSignal,
): Promise<SloPreviewPoint[]> {
  const res = await searchService.metrics_query_range({
    org_identifier: org,
    ...request,
    signal,
  });
  return promqlCountSeriesPoints(res?.data?.data?.result ?? [], sliceIntervalSecs);
}

async function loadPromql() {
  const org = store.state.selectedOrganization?.identifier;
  const endSecs = Math.floor(Date.now() / 1000);
  const startSecs = endSecs - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) / 1000;
  // Read once, so the request and the reading of its response cannot be built
  // from two different slice widths.
  const sliceIntervalSecs = props.sliceIntervalSecs;
  const rangeFor = (expr: string | undefined) =>
    buildSloPromqlPreviewRange({ expr, startSecs, endSecs, sliceIntervalSecs });
  const good = rangeFor(props.good);
  const total = rangeFor(props.total);

  if (!org || !good || !total) {
    // Aborted, not merely dropped: without this the requests already in flight
    // would still recognise themselves as current and repaint the panels they
    // just cleared. Their `finally` goes with them, so the spinner is cleared
    // here.
    clearPromql();
    return;
  }

  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  error.value = "";

  try {
    const [goodRun, totalRun] = await Promise.all([
      runRange(org, good, sliceIntervalSecs, mine.signal),
      runRange(org, total, sliceIntervalSecs, mine.signal),
    ]);
    if (controller !== mine) return;
    goodPoints.value = goodRun;
    totalPoints.value = totalRun;
  } catch (e: unknown) {
    const failure = e as {
      name?: string;
      code?: string;
      response?: { data?: { message?: string } };
    };
    // An abort is this component tidying up after itself, not a failure.
    if (failure?.name === "CanceledError" || failure?.code === "ERR_CANCELED") return;
    if (controller !== mine) return;
    // `Promise.all` rejects on the first failure and leaves the sibling running
    // — holding a work-group slot for a result nothing will draw.
    mine.abort();
    goodPoints.value = [];
    totalPoints.value = [];
    error.value = failure?.response?.data?.message || t("slos.preview.loadFailed");
  } finally {
    // Only the CURRENT request may clear the spinner: a superseded one's
    // `finally` would otherwise drop it while the new evaluation is running.
    if (controller === mine) loading.value = false;
  }
}

function build() {
  if (isPromql.value) {
    // Cleared so a flip back to PromQL cannot show the last SQL definition's
    // panels for a frame.
    goodSchema.value = null;
    badSchema.value = null;
    loadPromql();
    return;
  }

  clearPromql();
  goodSchema.value = panelFor("good", GOOD_COLOR);
  badSchema.value = panelFor("bad", BAD_COLOR);

  // MICROSECONDS into `new Date(...)` — the convention PanelSchemaRenderer is
  // fed everywhere in the alert UI; honest milliseconds render an empty chart.
  const endUs = Date.now() * 1000;
  const startUs = endUs - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) * 1000;
  selectedTimeObj.value = {
    start_time: new Date(startUs),
    end_time: new Date(endUs),
  };
}

// Debounced: the inputs feeding this change per keystroke, and every rebuild
// is two searches. Half a second of stillness is the signal the expression is
// worth previewing.
let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [
    props.stream,
    props.streamType,
    props.scope,
    props.goodExpr,
    props.good,
    props.total,
    props.queryLanguage,
    // Only PromQL reads the slice width. Unconditionally, flipping the toggle
    // would re-run two SQL searches for a byte-identical pair of panels.
    isPromql.value ? props.sliceIntervalSecs : 0,
  ],
  () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, 500);
  },
);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  controller?.abort();
});
onMounted(build);
</script>
