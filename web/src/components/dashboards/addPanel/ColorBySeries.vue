<!-- Copyright 2026 OpenObserve Inc.

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
    <div
      class="q-mb-sm"
      style="font-weight: 600; display: flex; align-items: center"
    >
      <span>{{ t("dashboard.colorBySeriesTitle") }}</span>
      <OButton
        variant="ghost"
        size="icon"
        data-test="dashboard-addpanel-config-color-by-series"
      >
        <template #icon-left><q-icon name="info_outline" /></template>
        <q-tooltip
          class="bg-grey-8"
          anchor="bottom middle"
          self="top middle"
          max-width="250px"
        >
          {{ t("dashboard.colorBySeriesTooltip") }}
        </q-tooltip>
      </OButton>
    </div>
    <OButton
      variant="outline"
      size="sm"
      @click="openColorBySeriesPopUp"
      data-test="dashboard-addpanel-config-colorBySeries-add-btn"
    >
      {{
        dashboardPanelData?.data?.config?.color?.colorBySeries?.length
          ? t("dashboard.editColorBySeries")
          : t("dashboard.applyColorBySeries")
      }}
    </OButton>
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
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import ColorBySeriesPopUp from "./ColorBySeriesPopUp.vue";
import OButton from "@/lib/core/Button/OButton.vue";
export default defineComponent({
  name: "ColorBySeries",
  components: { ColorBySeriesPopUp, OButton },
  props: {
    colorBySeriesData: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();
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
      // For gauge charts, extract series names from each series' data[0].name
      if (panelType === "gauge" && chartOptions?.series) {
        const gaugeSeriesNames = chartOptions.series
          .filter(
            (series: any) =>
              series && series.data && series.data[0] && series.data[0].name,
          ) // Filter out invalid series
          .map((series: any) => ({
            name: series.data[0].name,
          }));
        return { series: gaugeSeriesNames };
      }

      // For other chart types, use the existing logic
      return props.colorBySeriesData?.options || { series: [] };
    });

    return {
      t,
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
