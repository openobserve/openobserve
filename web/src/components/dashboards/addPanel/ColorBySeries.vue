<!-- Copyright 2023 OpenObserve Inc.

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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div>
    <div class="q-mb-sm" style="font-weight: 600">
      <span>Color by series</span>
      <q-btn
        no-caps
        padding="xs"
        class=""
        size="sm"
        flat
        icon="info_outline"
        data-test="dashboard-addpanel-config-color-by-series"
      >
        <q-tooltip
          class="bg-grey-8"
          anchor="bottom middle"
          self="top middle"
          max-width="250px"
        >
          Apply colors to series for better visual distinction in charts.
          Customize colors for each series to enhance data visualization.
        </q-tooltip>
      </q-btn>
    </div>
    <q-btn
      @click="openColorBySeriesPopUp"
      style="cursor: pointer; padding: 0px 5px"
      :label="
        dashboardPanelData?.data?.config?.color?.colorBySeries?.length
          ? ' Edit color by series'
          : ' Apply color by series'
      "
      no-caps
      data-test="dashboard-addpanel-config-colorBySeries-add-btn"
    />
    <q-dialog v-model="showColorBySeriesPopUp">
      <ColorBySeriesPopUp
        :seriesOptions="seriesOptions?.series"
        :colorBySeries="
          dashboardPanelData?.data?.config?.color?.colorBySeries || []
        "
        @close="showColorBySeriesPopUp = false"
        @save="saveColorBySeriesconfig"
        :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, ref, computed, onBeforeMount } from "vue";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import ColorBySeriesPopUp from "./ColorBySeriesPopUp.vue";
export default defineComponent({
  name: "ColorBySeries",
  components: { ColorBySeriesPopUp },
  props: {
    colorBySeriesData: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const showColorBySeriesPopUp = ref(false);

    const openColorBySeriesPopUp = () => {
      showColorBySeriesPopUp.value = true;
    };

    onBeforeMount(() => {
      // Ensure that the colorBySeries object is initialized in config
      if (!dashboardPanelData?.data?.config?.color?.colorBySeries) {
        dashboardPanelData.data.config.color.colorBySeries = [];
      }
    });

    const saveColorBySeriesconfig = (colorBySeries: any) => {
      dashboardPanelData.data.config.color.colorBySeries = colorBySeries;
      showColorBySeriesPopUp.value = false;
    };

    const seriesOptions = computed(() => {
      const panelType = dashboardPanelData.data.type;
      const chartOptions = props.colorBySeriesData?.options;
      // For pie and donut charts, extract series names from data[].name
      if (
        (panelType === "pie" || panelType === "donut") &&
        chartOptions?.series?.[0]?.data
      ) {
        const pieDonutSeriesNames = chartOptions.series[0].data
          .filter((item: any) => item && item.name) // Filter out invalid items
          .map((item: any) => ({  
            name: item.name,
          }));
        return { series: pieDonutSeriesNames };
      }

      // For other chart types, use the existing logic
      return props.colorBySeriesData?.options || { series: [] };
    });

    return {
      store,
      dashboardPanelData,
      // colorBySeries:
      //   dashboardPanelData?.data?.config?.color?.colorBySeries || [],
      showColorBySeriesPopUp,
      openColorBySeriesPopUp,
      saveColorBySeriesconfig,
      seriesOptions,
    };
  },
});
</script>

<style lang="scss" scoped></style>
