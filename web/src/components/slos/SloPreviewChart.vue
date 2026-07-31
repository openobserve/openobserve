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

    <!-- Borrowed from the dashboard panel shape (`PanelContainer`): a
         bordered title bar, then the chart filling everything below it. The
         title reads as part of the panel rather than floating above it, and
         the chart gets the remaining height instead of competing with
         padding for it. -->
    <div
      v-for="panel in panels"
      :key="panel.key"
      class="rounded-default border-border-default flex flex-col overflow-hidden border"
      :data-test="`slos-slopreviewchart-${panel.key}`"
    >
      <div
        class="border-border-default text-compact text-text-heading flex min-h-7 w-full items-center border-b px-2 py-1 font-medium tracking-[0.02em]"
      >
        {{ panel.label }}
      </div>
      <div class="h-45 w-full">
        <PanelSchemaRenderer
          v-if="panel.schema"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { getDefaultDashboardPanelData } from "@/utils/alerts/aggregationPreviewQuery";
import { buildSloPreviewQuery } from "@/utils/slos/previewQuery";

const props = defineProps<{
  streamType: string;
  stream: string;
  /** SQL predicate; empty = all rows. */
  scope?: string;
  /** SQL predicate defining a good event. Required for a drawable preview. */
  goodExpr?: string;
}>();

const { t } = useI18n();

// Semantic series colours. Literal hex because this is chart data, not
// component styling: the renderer takes colour strings, not utility classes,
// and every other panel colour in the app is specified the same way (see
// `classicColorPaletteLightTheme`). Values match the palette's green and red
// so the charts stay consistent with the rest of the product.
const GOOD_COLOR = "#34d399";
const BAD_COLOR = "#f87171";

const goodSchema = ref<any>(null);
const badSchema = ref<any>(null);
const selectedTimeObj = ref<any>(null);
const range = ref<string>("1h");

// Good first, bad below — the order the user reads them in.
const panels = computed(() => [
  { key: "good", label: t("slos.preview.goodEvents"), schema: goodSchema.value },
  { key: "bad", label: t("slos.preview.badEvents"), schema: badSchema.value },
]);

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

function build() {
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
  () => [props.stream, props.streamType, props.scope, props.goodExpr],
  () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, 500);
  },
);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});
onMounted(build);
</script>
