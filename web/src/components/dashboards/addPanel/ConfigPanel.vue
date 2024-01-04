<!-- Copyright 2023 Zinc Labs Inc.

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
  <div>
    <q-toggle
      v-if="
        dashboardPanelData.data.type != 'table' &&
        dashboardPanelData.data.type != 'heatmap' &&
        dashboardPanelData.data.type != 'metric' &&
        dashboardPanelData.data.type != 'gauge'
      "
      v-model="dashboardPanelData.data.config.show_legends"
      :label="t('dashboard.showLegendsLabel')"
      data-test="dashboard-config-show-legend"
    />

    <div class="space"></div>

    <div class="" style="max-width: 300px">
      <div class="q-mb-sm">{{ t("dashboard.description") }}</div>
      <q-input
        outlined
        v-model="dashboardPanelData.data.description"
        filled
        autogrow
        class="showLabelOnTop"
        data-test="dashboard-config-description"
      />
    </div>

    <div class="space"></div>

    <q-select
      v-if="
        dashboardPanelData.data.type != 'table' &&
        dashboardPanelData.data.type != 'heatmap' &&
        dashboardPanelData.data.type != 'metric' &&
        dashboardPanelData.data.type != 'gauge'
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
      data-test="dashboard-config-legend-position"
    >
    </q-select>

    <div class="space"></div>

    <q-select
      outlined
      v-if="dashboardPanelData.data.type != 'table'"
      v-model="dashboardPanelData.data.config.unit"
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
      data-test="dashboard-config-unit"
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
      data-test="dashboard-config-custom-unit"
    />

    <q-input
      v-if="dashboardPanelData.data.type != 'geomap'"
      type="number"
      v-model.number="dashboardPanelData.data.config.decimals"
      value="2"
      min="0"
      max="100"
      @update:model-value="
        (value: any) => (dashboardPanelData.data.config.decimals = ( typeof value == 'number' && value >= 0) ? value : 2)
      "
      :rules="[
        (val) =>
          (val >= 0 && val <= 100) || 'Decimals must be between 0 and 100',
      ]"
      label="Decimals"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      filled
      dense
      label-slot
      data-test="dashboard-config-decimals"
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
      data-test="dashboard-config-basemap"
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
          data-test="dashboard-config-lattitude"
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
          data-test="dashboard-config-longitude"
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
        data-test="dashboard-config-zoom"
      >
      </q-input>
    </div>

    <div class="space"></div>

    <!-- <q-input v-if="promqlMode" v-model="dashboardPanelData.data.config.promql_legend" label="Legend" color="input-border"
      bg-color="input-bg" class="q-py-md showLabelOnTop" stack-label outlined filled dense label-slot> -->
    <div
      v-if="promqlMode || dashboardPanelData.data.type == 'geomap'"
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
        data-test="dashboard-config-query-tab"
      >
        <q-tab
          no-caps
          v-for="(tab, index) in dashboardPanelData.data.queries"
          :key="index"
          :name="index"
          :label="'Query ' + (index + 1)"
          :data-test="`dashboard-config-query-tab-${index}`"
        >
        </q-tab>
      </q-tabs>
    </div>
    <!-- </q-input> -->
    <div class="space"></div>

    <!-- for auto sql query limit -->
    <!-- it should not be promql and custom query -->
    <q-input
      v-if="
        !promqlMode &&
        !dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery
      "
      v-model.number="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit
      "
      :value="0"
      :min="0"
      @update:model-value="
        (value) =>
          (dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].config.limit = value ? value : 0)
      "
      label="Limit"
      color="input-border"
      bg-color="input-bg"
      class="q-py-sm showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      placeholder="0"
      :type="'number'"
      data-test="dashboard-config-limit"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          Query Limit
          <div>
            <q-icon class="q-ml-xs" size="20px" name="info" data-test="dashboard-config-limit-info"/>
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              Limit for the query result
            </q-tooltip>
          </div>
        </div>
      </template>
    </q-input>

    <q-input
      v-if="promqlMode"
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
      data-test="dashboard-config-promql-legend"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          {{ t("dashboard.legendLabel") }}
          <div>
            <q-icon class="q-ml-xs" size="20px" name="info" data-test="dashboard-config-promql-legend-info"/>
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
      data-test="dashboard-config-layer-type"
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
      data-test="dashboard-config-weight"
    >
    </q-input>

    <q-input
      v-if="dashboardPanelData.data.type === 'gauge'"
      v-model.number="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.min
      "
      :value="0"
      @update:model-value="
        (value) =>
          (dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].config.min = value ? value : 0)
      "
      label="Gauge Min Value"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      :type="'number'"
      data-test="dashboard-config-gauge-min"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">Gauge Min Value</div>
      </template>
    </q-input>
    <q-input
      v-if="dashboardPanelData.data.type === 'gauge'"
      v-model.number="
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.max
      "
      :value="100"
      @update:model-value="
        (value) =>
          (dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].config.max = value ? value : 100)
      "
      label="Gauge Max Value"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      placeholder="100"
      :type="'number'"
      data-test="dashboard-config-gauge-max"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">Gauge Max Value</div>
      </template>
    </q-input>
    <q-input
      v-model.number="
        dashboardPanelData.data.config.axisWidth
      "
      :label="t('common.axisWidth')"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
      label-slot
      :type="'number'"
      placeholder="Auto"
      @update:model-value="
      (value) =>
        (dashboardPanelData.data.config.axisWidth = value !== '' ? value : null)
    "
    >
    </q-input>

    <div class="space"></div>

    <q-toggle
      v-model="dashboardPanelData.data.config.axisBorderShow"
      :label="t('dashboard.showBorder')"
    />

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
