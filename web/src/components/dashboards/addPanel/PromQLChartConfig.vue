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
        v-model="geoWeightLabel"
        :label="t('dashboard.geoWeightLabel')"
        placeholder="weight"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-weight-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.geoWeightLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing weight values. Default: "weight"
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

    <!-- Maps Label Configuration -->
    <div v-if="chartType === 'maps'" class="maps-config">
      <div class="q-mb-sm text-subtitle2">Maps Configuration</div>

      <q-input
        v-model="mapsNameLabel"
        :label="t('dashboard.mapsNameLabel')"
        placeholder="country or location"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-maps-name-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.mapsNameLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="300px">
              Name of the metric label containing location names (e.g., country, region). Default: "name"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-select
        v-model="mapsMapType"
        :options="['world', 'USA', 'China']"
        :label="t('dashboard.mapsMapType')"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-maps-type"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.mapsMapType") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Map type to display. Default: "world"
            </q-tooltip>
          </div>
        </template>
      </q-select>

      <q-toggle
        v-model="mapsEnableRoam"
        :label="t('dashboard.mapsEnableRoam')"
        class="q-py-sm"
        data-test="dashboard-config-maps-enable-roam"
      />
    </div>

    <!-- Table Configuration -->
    <div v-if="chartType === 'table'" class="table-config">
      <div class="q-mb-sm text-subtitle2">Table Aggregations</div>

      <q-select
        v-model="tableAggregations"
        :options="aggregationOptions"
        :label="t('dashboard.tableAggregations')"
        multiple
        borderless
        dense
        class="q-py-md showLabelOnTop"
        stack-label
        emit-value
        map-options
        data-test="dashboard-config-table-aggregations"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.tableAggregations") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="350px">
              <b>Table Aggregations - </b>
              Select multiple aggregation functions to display as columns.
              <br /><br />
              Single aggregation: creates a "value" column
              <br />
              Multiple aggregations: creates "value_last", "value_sum", etc.
              <br /><br />
              Example: Selecting "last", "sum", "avg" will create three value columns.
            </q-tooltip>
          </div>
        </template>
        <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
          <q-item v-bind="itemProps">
            <q-item-section side>
              <q-checkbox :model-value="selected" @update:model-value="toggleOption(opt)" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ opt.label }}</q-item-label>
            </q-item-section>
          </q-item>
        </template>
      </q-select>
    </div>
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
      "gauge",
      "metric",
      "h-bar",
      "geomap",
      "maps",
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

    const geoWeightLabel = computed({
      get: () => dashboardPanelData.data.config?.weight_label || "weight",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.weight_label = value;
      },
    });

    // Maps configuration
    const mapsNameLabel = computed({
      get: () => dashboardPanelData.data.config?.name_label || "name",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.name_label = value;
      },
    });

    const mapsMapType = computed({
      get: () => dashboardPanelData.data.config?.map_type || "world",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.map_type = value;
      },
    });

    const mapsEnableRoam = computed({
      get: () => dashboardPanelData.data.config?.enable_roam !== false,
      set: (value: boolean) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.enable_roam = value;
      },
    });

    // Table aggregations configuration
    const tableAggregations = computed({
      get: () => dashboardPanelData.data.config?.table_aggregations || ["last"],
      set: (value: string[]) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.table_aggregations = value;
      },
    });

    return {
      t,
      aggregationOptions,
      showAggregationConfig,
      aggregationValue,
      geoLatLabel,
      geoLonLabel,
      geoWeightLabel,
      geoNameLabel,
      geoSymbolSize,
      geoEnableRoam,
      mapsNameLabel,
      mapsMapType,
      mapsEnableRoam,
      tableAggregations,
    };
  },
});
</script>

<style scoped lang="scss">
.promql-chart-config {
  .geomap-config,
  .maps-config,
  .table-config {
    padding: 16px 0;
    border-top: 1px solid rgba(0, 0, 0, 0.12);
  }
}
</style>
