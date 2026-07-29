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
  Evaluation chart on the alert status page.

  Shows what the alert measures over time against its Critical and Warning
  thresholds. For a grouped alert that is one line per group — which makes
  "which groups are breaching, and for how long" legible without reading the
  table row by row — and it applies whether or not the alert opted in to
  per-group evaluation: grouping is what produces the series, `multi_alert`
  only decides whether each group carries its own state.

  Both threshold families are handled (alerts_2.md §4.4b): an aggregation alert
  charts its aggregate, a count alert charts matching rows per bucket, and each
  draws the marklines from its OWN family — mixing them would put the line on
  the wrong scale.

  The series come from the alert's own generated SQL, re-shaped for a time axis
  by the helpers in `utils/alerts/aggregationPreviewQuery` — the same ones the
  edit form's preview uses, so the two charts cannot disagree about what the
  alert measures. Notably `cleanAggregationQuery` drops the `HAVING` clause:
  keeping it would hide healthy groups, making a recovery look identical to a
  series that simply stopped.
-->
<template>
  <div class="flex flex-col gap-2" data-test="alerts-alertgroupchart">
    <div class="flex items-center justify-between gap-2">
      <span class="text-compact font-bold text-text-heading">
        {{ t("alerts.groups.evaluation") }}
      </span>
      <OToggleGroup
        :model-value="range"
        data-test="alerts-alertgroupchart-range"
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

    <div class="h-62.5 w-full">
      <PanelSchemaRenderer
        v-if="chartData"
        :height="5"
        :width="5"
        :panelSchema="chartData"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        searchType="ui"
        data-test="alerts-alertgroupchart-panel"
      />
      <div
        v-else
        class="flex h-full items-center justify-center"
        data-test="alerts-alertgroupchart-empty"
      >
        <span class="text-sm text-text-secondary">
          {{ t("alerts.groups.chartUnavailable") }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import alertsService from "@/services/alerts";
import {
  GROUP_LABEL_ALIAS,
  buildCountChartQuery,
  cleanAggregationQuery,
  getDefaultDashboardPanelData,
  withCompositeGroupLabel,
} from "@/utils/alerts/aggregationPreviewQuery";
import { buildThresholdMarkLines } from "@/utils/alerts/thresholdMarkLines";

const props = defineProps<{ alert: any }>();

const { t } = useI18n();
const store = useStore();

const chartData = ref<any>(null);
const selectedTimeObj = ref<any>(null);
const range = ref<string>("1h");

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

const queryCondition = computed(
  () => props.alert?.query_condition || props.alert?.condition,
);
const aggregation = computed(() => queryCondition.value?.aggregation);

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  build();
};

const build = async () => {
  const agg = aggregation.value;
  const orgId = store.state.selectedOrganization?.identifier;
  if (!orgId || !props.alert?.stream_name) {
    chartData.value = null;
    return;
  }

  let sql = "";
  try {
    // Ask the backend for the alert's own SQL rather than rebuilding it here:
    // the evaluation query is the source of truth for what this alert
    // measures, and a second local implementation would drift from it.
    const res = await alertsService.generate_sql(orgId, {
      stream_name: props.alert.stream_name,
      stream_type: props.alert.stream_type,
      query_condition: queryCondition.value,
    });
    sql = res.data?.sql || res.data?.query || "";
  } catch {
    chartData.value = null;
    return;
  }
  if (!sql) {
    chartData.value = null;
    return;
  }

  // Two threshold families, two chart shapes (alerts_2.md §4.4b). An
  // aggregation alert charts its aggregate per group; a count alert charts the
  // matching-row count over time. Using the aggregation rewrite on a count
  // alert would produce a query with no value column at all.
  let chartQuery = agg ? cleanAggregationQuery(sql) : buildCountChartQuery(sql);
  if (!chartQuery) {
    chartData.value = null;
    return;
  }

  // With two or more group-by columns the group is their COMBINATION, so each
  // series needs the whole combination as its name. Left as separate columns
  // the renderer labels a line by just one of them, and two groups sharing
  // that column become indistinguishable.
  const groupCols: string[] = (agg?.group_by || []).filter(
    (f: string) => f && f.trim() !== "",
  );
  const composite =
    groupCols.length > 1 ? withCompositeGroupLabel(chartQuery, groupCols) : null;
  if (composite) chartQuery = composite;

  const panel: any = cloneDeep(getDefaultDashboardPanelData());
  panel.data.type = "line";
  panel.data.queryType = "sql";
  panel.data.config.unit = "numbers";
  // Assign colours by series INDEX, not by hashing the series name.
  //
  // The default (`palette-classic-by-series`) hashes the name into the palette,
  // and group labels are near-identical strings — `eng-001 / us-east-1b` and
  // `data-001 / eu-central-1b` collide into the same slot, drawing two groups
  // in one colour. Index assignment makes every group on the chart distinct by
  // construction, which is the whole point of a per-group chart.
  //
  // Set here rather than in the shared panel factory so the alert form's
  // preview keeps whatever colouring it already had.
  panel.data.config.color = {
    mode: "palette-classic",
    fixedColor: [],
    seriesBy: "last",
    colorBySeries: [],
  };
  panel.data.queries[0].customQuery = true;
  panel.data.queries[0].query = chartQuery;
  panel.data.queries[0].vrlFunctionQuery = null;
  panel.data.config.table_dynamic_columns = false;
  panel.data.queries[0].fields.stream = props.alert.stream_name;
  panel.data.queries[0].fields.stream_type = props.alert.stream_type;
  panel.data.queries[0].fields.x = [
    { alias: "zo_sql_key", column: "zo_sql_key", color: null, label: "Time" },
  ];

  const fn = agg?.function || "";
  const col = agg?.having?.column || "";
  const aggLabel = col ? (fn ? `${fn}(${col})` : col) : "zo_sql_num";
  panel.data.queries[0].fields.y = [
    {
      alias: "zo_sql_num",
      column: "zo_sql_num",
      color: null,
      label: agg ? aggLabel : t("alerts.groups.eventCount"),
    },
  ];
  panel.data.queries[0].fields.z = [];
  // One series per group. A count alert has no grouping at all, so it draws a
  // single line — which is exactly what it evaluates. When the columns were
  // collapsed above, the breakdown is that one composite column.
  panel.data.queries[0].fields.breakdown = composite
    ? [
        {
          alias: GROUP_LABEL_ALIAS,
          column: GROUP_LABEL_ALIAS,
          color: null,
          label: groupCols.join(", "),
        },
      ]
    : groupCols.map((field: string) => ({
        alias: field,
        column: field,
        color: null,
        label: field,
      }));
  panel.data.queries[0].fields.filter = {
    filterType: "group",
    logicalOperator: "AND",
    conditions: [],
  };
  // Both bands, so a group sitting between them is visibly in the warning
  // range rather than just "under the line". The thresholds must come from the
  // SAME family as the series: an aggregation alert compares the aggregate,
  // a count alert compares the row count, and mixing them would draw the line
  // on the wrong scale entirely.
  panel.data.config.mark_line = agg
    ? buildThresholdMarkLines(agg.having?.value, agg.warning_value)
    : buildThresholdMarkLines(
        props.alert?.trigger_condition?.threshold,
        props.alert?.trigger_condition?.warning_threshold,
      );

  // MICROSECONDS into `new Date(...)`, deliberately: that is the convention
  // `PanelSchemaRenderer` is fed everywhere else in the alert UI (see
  // PreviewAlert's `endTime = Date.now() * 1000`). Passing honest
  // milliseconds here silently produced an empty chart.
  const endUs = Date.now() * 1000;
  const startUs = endUs - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) * 1000;
  selectedTimeObj.value = {
    start_time: new Date(startUs),
    end_time: new Date(endUs),
  };
  chartData.value = panel.data;
};

watch(() => props.alert, build);
onMounted(build);
</script>
