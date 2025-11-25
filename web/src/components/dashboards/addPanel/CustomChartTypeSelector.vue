<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="custom-chart-type-selector q-pa-md">
    <div class="text-subtitle2 q-mb-sm">
      {{ t("panel.customChartTypeSelector") }}
      <q-icon name="info_outline" class="q-ml-xs">
        <q-tooltip>
          {{ t("panel.customChartTypeSelectorHint") }}
        </q-tooltip>
      </q-icon>
    </div>
    <q-select
      v-model="selectedChartType"
      :options="chartTypeOptions"
      :label="t('panel.selectChartType')"
      dense
      outlined
      emit-value
      map-options
      @update:model-value="onChartTypeSelected"
      data-test="custom-chart-type-selector"
      class="custom-chart-selector"
    >
      <template v-slot:prepend>
        <q-icon name="bar_chart" />
      </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { customChartTemplates } from "./customChartTemplates";

export default defineComponent({
  name: "CustomChartTypeSelector",
  emits: ["template-selected"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const selectedChartType = ref(null);

    const chartTypeOptions = [
      { label: "Basic Line Chart", value: "line-simple" },
      { label: "Basic Bar Chart", value: "bar-simple" },
      { label: "Basic Pie Chart", value: "pie-simple" },
      { label: "Basic Scatter Chart", value: "scatter-simple" },
      { label: "Radar Chart", value: "radar-simple" },
      { label: "Gauge Chart", value: "gauge-simple" },
      { label: "Funnel Chart", value: "funnel-simple" },
      { label: "Heatmap", value: "heatmap-simple" },
      { label: "Candlestick Chart", value: "candlestick-simple" },
      { label: "Graph/Network", value: "graph-simple" },
      { label: "Tree Chart", value: "tree-simple" },
      { label: "Treemap", value: "treemap-simple" },
      { label: "Sunburst", value: "sunburst-simple" },
      { label: "Sankey Diagram", value: "sankey-simple" },
      { label: "Boxplot", value: "boxplot-simple" },
      { label: "Parallel Coordinates", value: "parallel-simple" },
      { label: "Calendar Heatmap", value: "calendar-simple" },
      { label: "Pictorial Bar", value: "pictorialBar-simple" },
      { label: "ThemeRiver", value: "themeRiver-simple" },
      { label: "Custom Series", value: "custom-simple" },
    ];

    const onChartTypeSelected = (value: string) => {
      const template = customChartTemplates[value];
      if (template) {
        emit("template-selected", template);
      }
    };

    return {
      t,
      selectedChartType,
      chartTypeOptions,
      onChartTypeSelected,
    };
  },
});
</script>

<style lang="scss" scoped>
.custom-chart-type-selector {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.02);
}

.custom-chart-selector {
  max-width: 400px;
}
</style>
