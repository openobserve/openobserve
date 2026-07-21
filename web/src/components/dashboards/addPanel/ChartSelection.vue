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
  <div class="h-full">
    <div class="p-0 w-25">
      <ul class="flex flex-wrap list-none p-0 m-0">
        <li class="w-12.5"
          v-for="(item, index) in ChartsArray"
          :key="index"
          :class="[
            'border-r border-b border-card-glass-border',
            'transition-colors duration-150 ease-in-out hover:bg-surface-subtle',
            selectedChartType === item.id ? 'bg-label-chip-url-bg' : '',
            isChartDisabled(item)
              ? 'opacity-50 cursor-not-allowed'
              : 'cursor-pointer',
          ]"
          @click="!isChartDisabled(item) && $emit('update:selectedChartType', item.id)"
          data-test="dashboard-addpanel-chart-selection-item"
          :data-test-selected="selectedChartType === item.id ? item.id : undefined"
        >
          <div
            :data-test="`selected-chart-${item.id}-item`"
            :data-selected="selectedChartType === item.id ? 'true' : 'false'"
            class="flex flex-col items-center relative"
          >
            <img
              :src="item.image.replace('img:', '')"
              :alt="item.title"
              class="mx-auto my-2 w-6 h-6"
              data-test="dashboard-addpanel-chart-selection-icon"
            />
            <OTooltip class="text-center"
              :content="item.title"
              data-test="dashboard-addpanel-chart-selection-tooltip"
            />
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref } from "vue";
import { getImageURL } from "../../../utils/zincutils";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
export default defineComponent({
  name: "ChartSelection",
  props: ["selectedChartType", "allowedchartstype"],
  emits: ["update:selectedChartType"],

  setup(props) {
    const store = useStore();
    const { t } = useI18n();
    // array of charts
    const chartsArray = ref([
      {
        image: "img:" + getImageURL("images/dashboard/charts/area.png"),
        title: t("dashboard.areaLabel"),
        id: "area",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/area-graph.png"),
        title: t("dashboard.areaStackedLabel"),
        id: "area-stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/bar-chart.png"),
        title: t("dashboard.barLabel"),
        id: "bar",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/bar-graph.png"),
        title: t("dashboard.horizontalLabel"),
        id: "h-bar",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/line-chart.png"),
        title: t("dashboard.lineLabel"),
        id: "line",
      },
      {
        image:
          "img:" + getImageURL("images/dashboard/charts/scatter-graph.png"),
        title: t("dashboard.scatterLabel"),
        id: "scatter",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/stacked.png"),
        title: t("dashboard.stackedLabel"),
        id: "stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/h-stacked.png"),
        title: t("dashboard.hstackedLabel"),
        id: "h-stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/geomap.png"),
        title: t("dashboard.geomapLabel"),
        id: "geomap",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/world-map.png"),
        title: t("dashboard.worldmapLabel"),
        id: "maps",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/pie-chart.png"),
        title: t("dashboard.pieLabel"),
        id: "pie",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/donut-chart.png"),
        title: t("dashboard.donutLabel"),
        id: "donut",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/heatmap.png"),
        title: t("dashboard.heatmapLabel"),
        id: "heatmap",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/table.png"),
        title: t("dashboard.tableLabel"),
        id: "table",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/123.png"),
        title: t("dashboard.metricTextLabel"),
        id: "metric",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/Gauge.png"),
        title: t("dashboard.chartSelection.gauge"),
        id: "gauge",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/HTML.png"),
        title: t("dashboard.chartSelection.html"),
        id: "html",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/Markdown.svg"),
        title: t("dashboard.chartSelection.markdown"),
        id: "markdown",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/sankey.svg"),
        title: t("dashboard.chartSelection.sankey"),
        id: "sankey",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/chart.png"),
        title: t("dashboard.chartSelection.customChart"),
        id: "custom_chart",
      },
    ]);

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { promqlMode, dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const promqlAllowedCharts = new Set([
      "line",
      "area",
      "bar",
      "scatter",
      "area-stacked",
      "metric",
      "gauge",
      "pie",
      "donut",
      "table",
      "heatmap",
      "h-bar",
      "stacked",
      "h-stacked",
      "geomap",
      "maps",
      "html",
      "markdown",
      "custom_chart",
    ]);

    const isChartDisabled = (item: any) => {
      if (promqlMode.value && !promqlAllowedCharts.has(item.id)) {
        return true;
      }
      if (
        props.allowedchartstype &&
        props.allowedchartstype.length > 0 &&
        !props.allowedchartstype.includes(item.id)
      ) {
        return true;
      }
      return false;
    };

    return {
      t,
      ChartsArray: chartsArray,
      promqlMode,
      dashboardPanelData,
      store,
      isChartDisabled,
    };
  },
  components: { OIcon , OTooltip },
});
</script>
