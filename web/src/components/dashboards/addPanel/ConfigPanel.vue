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
  <div>
    <q-toggle
      v-if="
        dashboardPanelData.data.type != 'table' &&
        dashboardPanelData.data.type != 'heatmap' && dashboardPanelData.data.type != 'metric' && dashboardPanelData.data.type != 'gauge'
      "
      v-model="dashboardPanelData.data.config.show_legends"
      :label="t('dashboard.showLegendsLabel')"
    />

    <div class="space"></div>

    <q-select
      v-if="
        dashboardPanelData.data.type != 'table' &&
        dashboardPanelData.data.type != 'heatmap' && dashboardPanelData.data.type != 'metric' && dashboardPanelData.data.type != 'gauge'
      "
      outlined
      v-model="dashboardPanelData.data.config.legends_position"
      :options="legendsPositionOptions"
      dense
      :label="t('dashboard.legendsPositionLabel')"
      class="showLabelOnTop"
      stack-label
      emit-value
      :display-value="`${
        dashboardPanelData.data.config.legends_position ?? 'Auto'
      }`"
    >
    </q-select>

    <div class="space"></div>

    <q-select
      outlined
      v-if="dashboardPanelData.data.type != 'table'" v-model="dashboardPanelData.data.config.unit"
      :options="unitOptions"
      dense
      :label="t('dashboard.unitLabel')"
      class="showLabelOnTop selectedLabel"
      stack-label
      emit-value
      :display-value="`${
        dashboardPanelData.data.config.unit
          ? unitOptions.find(
              (it) => it.value == dashboardPanelData.data.config.unit
            )?.label
          : 'Default'
      }`"
    >
    </q-select>
    <!-- :rules="[(val: any) => !!val || 'Field is required!']" -->
    <q-input
      v-if="dashboardPanelData.data.config.unit == 'custom'"
      v-model="dashboardPanelData.data.config.unit_custom"
      :label="t('dashboard.customunitLabel')"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      filled
      dense
      label-slot
    />

    <div class="space"></div>

    <q-select
      v-if="dashboardPanelData.data.type == 'geomap'"
      outlined
      v-model="dashboardPanelData.data.config.base_map.type"
      :options="basemapTypeOptions"
      dense
      :label="t('dashboard.basemapLabel')"
      class="showLabelOnTop"
      stack-label
      emit-value
      :display-value="'OpenStreetMap'"
    >
    </q-select>

    <div class="space"></div>
    <div v-if="dashboardPanelData.data.type == 'geomap'">
      <span>Initial View:</span>
      <div class="row">
        <q-input
          v-model.number="dashboardPanelData.data.config.map_view.lat"
          :label="t('dashboard.lattitudeLabel')"
          color="input-border"
          bg-color="input-bg"
          class="col-6 q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          label-slot
          :type="'number'"
        >
        </q-input>
        <q-input
          v-model.number="dashboardPanelData.data.config.map_view.lng"
          :label="t('dashboard.longitudeLabel')"
          color="input-border"
          bg-color="input-bg"
          class="col-6 q-py-md showLabelOnTop"
          stack-label
          outlined
          filled
          dense
          label-slot
          :type="'number'"
        >
        </q-input>
      </div>
      <q-input
        v-model.number="dashboardPanelData.data.config.map_view.zoom"
        :label="t('dashboard.zoomLabel')"
        color="input-border"
        bg-color="input-bg"
        class="q-py-md showLabelOnTop"
        stack-label
        outlined
        filled
        dense
        label-slot
        :type="'number'"
      >
      </q-input>
    </div>

    <div class="space"></div>

    <!-- <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot> -->
    <div
      v-if="dashboardPanelData.data.type == 'geomap' || (promqlMode && dashboardPanelData.data.type != 'table' && dashboardPanelData.data.type != 'metric' && dashboardPanelData.data.type != 'gauge')"
      class="q-py-md showLabelOnTop"
    >
      Query
      <q-tabs
        v-model="dashboardPanelData.layout.currentQueryIndex"
        narrow-indicator
        dense
        inline-label
        outside-arrows
        mobile-arrows
      >
        <q-tab
          no-caps
          v-for="(tab, index) in dashboardPanelData.data.queries"
          :key="index"
          :name="index"
          :label="'Query ' + (index + 1)"
        >
        </q-tab>
      </q-tabs>
    </div>
    <!-- </q-input> -->
    <div class="space"></div>

    <q-input
      v-if="promqlMode && dashboardPanelData.data.type != 'table' && dashboardPanelData.data.type != 'metric' && dashboardPanelData.data.type != 'gauge'"
      v-model="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.promql_legend
      "
      :label="t('common.legend')"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          {{ t("dashboard.legendLabel") }}
          <div>
            <q-icon class="q-ml-xs" size="20px"
name="info" />
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              {{ t("dashboard.overrideMessage") }}
            </q-tooltip>
          </div>
        </div>
      </template>
    </q-input>

    <div class="space"></div>

    <q-select
      v-if="dashboardPanelData.data.type == 'geomap'"
      outlined
      v-model="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.layer_type
      "
      :options="layerTypeOptions"
      dense
      :label="t('dashboard.layerType')"
      class="showLabelOnTop"
      stack-label
      emit-value
      :display-value="`${
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.layer_type
      }`"
    >
    </q-select>

    <div class="space"></div>

    <q-input
      v-if="dashboardPanelData.data.type == 'geomap' && !isWeightFieldPresent"
      v-model.number="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.weight_fixed
      "
      :label="t('common.weight')"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      :type="'number'"
    >
    </q-input>

    <q-input v-if="dashboardPanelData.data.type === 'gauge'" v-model="dashboardPanelData.data.config.gauge_min" label="Gauge Min Value" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot placeholder="0">
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          Gauge Min Value
        </div>
      </template>
    </q-input>

    <q-input v-if="dashboardPanelData.data.type === 'gauge'" v-model="dashboardPanelData.data.config.gauge_max" label="Gauge Max Value" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot placeholder="100">
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          Gauge Max Value
        </div>
      </template>
    </q-input>

  </div>
</template>

<script lang="ts">
import useDashboardPanelData from "@/composables/useDashboardPanel";
import { computed, defineComponent, watch } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  setup() {
    const { dashboardPanelData, promqlMode } = useDashboardPanelData();
    const { t } = useI18n();

    const basemapTypeOptions = [
      {
        label: t("dashboard.openStreetMap"),
        value: "osm",
      },
    ];

    const layerTypeOptions = [
      {
        label: t("dashboard.scatter"),
        value: "scatter",
      },
      {
        label: t("dashboard.heatmap"),
        value: "heatmap",
      },
    ];
    // options for legends position
    const legendsPositionOptions = [
      {
        label: t("dashboard.auto"),
        value: null,
      },
      {
        label: t("dashboard.right"),
        value: "right",
      },
      {
        label: t("dashboard.bottom"),
        value: "bottom",
      },
    ];
    const unitOptions = [
      {
        label: t("dashboard.default"),
        value: null,
      },
      {
        label: t("dashboard.bytes"),
        value: "bytes",
      },
      {
        label: t("dashboard.kilobytes"),
        value: "kilobytes",
      },
      {
        label: t("dashboard.megabytes"),
        value: "megabytes",
      },
      {
        label: t("dashboard.bytesPerSecond"),
        value: "bps",
      },
      {
        label: t("dashboard.seconds"),
        value: "seconds",
      },
      {
        label: t("dashboard.microseconds"),
        value: "microseconds",
      },
      {
        label: t("dashboard.milliseconds"),
        value: "milliseconds",
      },
      {
        label: t("dashboard.percent1"),
        value: "percent-1",
      },
      {
        label: t("dashboard.percent"),
        value: "percent",
      },
      {
        label: t("dashboard.custom"),
        value: "custom",
      },
    ];
    const isWeightFieldPresent = computed(() => {
      const layoutFields =
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields;
      return !!layoutFields?.weight;
    });
    return {
      t,
      dashboardPanelData,
      promqlMode,
      basemapTypeOptions,
      layerTypeOptions,
      legendsPositionOptions,
      unitOptions,
      isWeightFieldPresent,
    };
  },
});
</script>

<style lang="scss" scoped>
:deep(.selectedLabel span) {
  text-transform: none !important;
}

.space {
  margin-top: 10px;
  margin-bottom: 10px;
}
</style>
