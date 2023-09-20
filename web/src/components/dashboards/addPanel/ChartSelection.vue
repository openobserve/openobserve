<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div style="height: 100%">
    <div class="q-pa-none" style="max-width: 90px">
      <q-list separator>
        <q-item
          :class="[
            'q-pa-none',
            selectedChartType === item.id
              ? store.state.theme === 'dark'
                ? 'bg-grey-5'
                : 'bg-grey-3'
              : '',
          ]"
          v-for="(item, index) in ChartsArray"
          :disable="
            promqlMode &&
            item.id != 'line' &&
            item.id != 'area' &&
            item.id != 'bar' &&
            item.id != 'scatter' &&
            item.id != 'area-stacked' &&
            item.id != 'metric' &&
            item.id != 'gauge' &&
            item.id != 'table'"
          :key="index"
          clickable
          v-ripple="true"
          @click="$emit('update:selectedChartType', item.id)"
        >
          <q-item-section
            :data-test="`selected-chart-${item.id}-item`"
            class=""
          >
            <q-icon
              size="sm"
              color="primary"
              :name="item.image"
              class="q-mx-auto q-mb-sm"
            />
            <q-item-label
              class="q-pa-none q-mx-auto"
              style="text-align: center"
              caption
              >{{ item.title }}</q-item-label
            >
          </q-item-section>
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { getImageURL } from "../../../utils/zincutils";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "ChartSelection",
  props: ["selectedChartType"],
  emits: ["update:selectedChartType"],

  setup() {
    const store = useStore();
    const { t } = useI18n();
    // array of charts
    const chartsArray = ref([
      {
        image: "img:" + getImageURL("images/dashboard/charts/area.png"),
        title: t('dashboard.areaLabel'),
        id: "area",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/area-graph.png"),
        title: t('dashboard.areaStackedLabel'),
        id: "area-stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/line-chart.png"),
        title: t('dashboard.lineLabel'),
        id: "line",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/bar-chart.png"),
        title: t('dashboard.barLabel'),
        id: "bar",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/bar-graph.png"),
        title: t('dashboard.horizontalLabel'),
        id: "h-bar",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/stacked.png"),
        title: t('dashboard.stackedLabel'),
        id: "stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/heatmap.png"),
        title: t('dashboard.heatmapLabel'),
        id: "heatmap",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/geomap.png"),
        title: t('dashboard.geomapLabel'),
        id: "geomap",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/h-stacked.png"),
        title: t('dashboard.hstackedLabel'),
        id: "h-stacked",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/pie-chart.png"),
        title: t('dashboard.pieLabel'),
        id: "pie",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/donut-chart.png"),
        title: t('dashboard.donutLabel'),
        id: "donut",
      },
      {
        image:
          "img:" + getImageURL("images/dashboard/charts/scatter-graph.png"),
        title: t('dashboard.scatterLabel'),
        id: "scatter",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/table.png"),
        title: t('dashboard.tableLabel'),
        id: "table",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/123.png"),
        title: t('dashboard.metricTextLabel'),
        id: "metric",
      },
      {
        image: "img:" + getImageURL("images/dashboard/charts/Gauge.png"),
        title: "Gauge",
        id: "gauge",
      },
    ]);

    const { promqlMode, dashboardPanelData } = useDashboardPanelData();
    return {
      t,
      ChartsArray: chartsArray,
      promqlMode,
      dashboardPanelData,
      store,
    };
  },
  components: {},
});
</script>

<style lang="sass" scoped></style>
