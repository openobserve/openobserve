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
  <div class="promql-chart-config">
    <!-- Aggregation Function Selector -->
    <q-select
      v-if="showAggregationConfig"
      v-model="aggregationValue"
      :options="aggregationOptions"
      :label="t('dashboard.aggregationFunction')"
      borderless
      dense
      class="q-py-md showLabelOnTop"
      stack-label
      emit-value
      map-options
      data-test="dashboard-config-aggregation"
    >
      <template v-slot:label>
        <div class="row items-center all-pointer-events">
          {{ t("dashboard.aggregationFunction") }}
          <q-icon class="q-ml-xs" size="20px" name="info" />
          <q-tooltip class="bg-grey-8" max-width="300px">
            <b>Aggregation Function - </b>
            Determines how time-series data is converted to a single value.
            <br /><br />
            <b>Last:</b> Most recent value (default)
            <br />
            <b>First:</b> Oldest value
            <br />
            <b>Min/Max:</b> Minimum/Maximum value
            <br />
            <b>Avg:</b> Average of all values
            <br />
            <b>Sum:</b> Total of all values
            <br />
            <b>Count:</b> Number of data points
            <br />
            <b>Range:</b> Difference between max and min
            <br />
            <b>Diff:</b> Difference between last and first
          </q-tooltip>
        </div>
      </template>
    </q-select>

    <!-- GeoMap Label Configuration -->
    <div v-if="chartType === 'geomap'" class="geomap-config">
      <div class="q-mb-sm text-subtitle2">GeoMap Configuration</div>

      <q-input
        v-model="geoLatLabel"
        :label="t('dashboard.geoLatLabel')"
        placeholder="latitude or lat"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-lat-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.geoLatLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing latitude values. Default: "latitude" or "lat"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-input
        v-model="geoLonLabel"
        :label="t('dashboard.geoLonLabel')"
        placeholder="longitude or lon"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-lon-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.geoLonLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing longitude values. Default: "longitude" or "lon"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-input
        v-model="geoNameLabel"
        :label="t('dashboard.geoNameLabel')"
        placeholder="name"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-name-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.geoNameLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label to use for location names. Default: "name"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-input
        v-model.number="geoSymbolSize"
        :label="t('dashboard.geoSymbolSize')"
        type="number"
        placeholder="10"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-symbol-size"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.geoSymbolSize") }}
          </div>
        </template>
      </q-input>

      <q-toggle
        v-model="geoEnableRoam"
        :label="t('dashboard.geoEnableRoam')"
        class="q-py-sm"
        data-test="dashboard-config-geo-enable-roam"
      />
    </div>

    <!-- Sankey Label Configuration -->
    <div v-if="chartType === 'sankey'" class="sankey-config">
      <div class="q-mb-sm text-subtitle2">Sankey Configuration</div>

      <q-input
        v-model="sankeySourceLabel"
        :label="t('dashboard.sankeySourceLabel')"
        placeholder="source"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-sankey-source-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.sankeySourceLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing source node names. Default: "source"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-input
        v-model="sankeyTargetLabel"
        :label="t('dashboard.sankeyTargetLabel')"
        placeholder="target"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-sankey-target-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.sankeyTargetLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing target node names. Default: "target"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-select
        v-model="sankeyOrient"
        :options="['horizontal', 'vertical']"
        :label="t('dashboard.sankeyOrient')"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-sankey-orient"
      />

      <q-input
        v-model.number="sankeyCurveness"
        :label="t('dashboard.sankeyCurveness')"
        type="number"
        placeholder="0.5"
        min="0"
        max="1"
        step="0.1"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-sankey-curveness"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.sankeyCurveness") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Curvature of flow links (0-1). Default: 0.5
            </q-tooltip>
          </div>
        </template>
      </q-input>
    </div>

    <!-- Table Configuration -->
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/useDashboardPanel";

export default defineComponent({
  name: "PromQLChartConfig",
  props: {
    chartType: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    const { t } = useI18n();
    const { dashboardPanelData } = useDashboardPanelData();

    // Aggregation function options
    const aggregationOptions = [
      { label: "Last (most recent value)", value: "last" },
      { label: "First (oldest value)", value: "first" },
      { label: "Min (minimum value)", value: "min" },
      { label: "Max (maximum value)", value: "max" },
      { label: "Avg (average)", value: "avg" },
      { label: "Sum (total)", value: "sum" },
      { label: "Count (number of data points)", value: "count" },
      { label: "Range (max - min)", value: "range" },
      { label: "Diff (last - first)", value: "diff" },
    ];

    // Chart types that support aggregation
    const chartsWithAggregation = [
      "pie",
      "donut",
      "table",
      "gauge",
      "metric",
      "h-bar",
      "geomap",
      "sankey",
    ];

    const showAggregationConfig = computed(() =>
      chartsWithAggregation.includes(props.chartType)
    );

    // Aggregation value
    const aggregationValue = computed({
      get: () => dashboardPanelData.data.config?.aggregation || "last",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.aggregation = value;
      },
    });

    // GeoMap configuration
    const geoLatLabel = computed({
      get: () => dashboardPanelData.data.config?.lat_label || "latitude",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.lat_label = value;
      },
    });

    const geoLonLabel = computed({
      get: () => dashboardPanelData.data.config?.lon_label || "longitude",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.lon_label = value;
      },
    });

    const geoNameLabel = computed({
      get: () => dashboardPanelData.data.config?.name_label || "name",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.name_label = value;
      },
    });

    const geoSymbolSize = computed({
      get: () => dashboardPanelData.data.config?.symbol_size || 10,
      set: (value: number) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.symbol_size = value;
      },
    });

    const geoEnableRoam = computed({
      get: () => dashboardPanelData.data.config?.enable_roam !== false,
      set: (value: boolean) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.enable_roam = value;
      },
    });

    // Sankey configuration
    const sankeySourceLabel = computed({
      get: () => dashboardPanelData.data.config?.source_label || "source",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.source_label = value;
      },
    });

    const sankeyTargetLabel = computed({
      get: () => dashboardPanelData.data.config?.target_label || "target",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.target_label = value;
      },
    });

    const sankeyOrient = computed({
      get: () => dashboardPanelData.data.config?.orient || "horizontal",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.orient = value;
      },
    });

    const sankeyCurveness = computed({
      get: () => dashboardPanelData.data.config?.curveness || 0.5,
      set: (value: number) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.curveness = value;
      },
    });

    return {
      t,
      aggregationOptions,
      showAggregationConfig,
      aggregationValue,
      geoLatLabel,
      geoLonLabel,
      geoNameLabel,
      geoSymbolSize,
      geoEnableRoam,
      sankeySourceLabel,
      sankeyTargetLabel,
      sankeyOrient,
      sankeyCurveness,
    };
  },
});
</script>

<style scoped lang="scss">
.promql-chart-config {
  .geomap-config,
  .sankey-config,
  .table-config {
    padding: 16px 0;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
  }
}
</style>
