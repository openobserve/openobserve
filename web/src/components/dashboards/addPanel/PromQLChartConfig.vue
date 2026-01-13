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
      <q-input
        v-model="geoLatLabel"
        :label="t('dashboard.geoLatLabel')"
        placeholder="latitude or lat"
        borderless
        dense
        class="tw:mb-3 showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-lat-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events tw:mb-[-5px]">
            {{ t("dashboard.geoLatLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing latitude values. Default:
              "latitude" or "lat"
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
        class="tw:mb-3 showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-lon-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events tw:mb-[-5px]">
            {{ t("dashboard.geoLonLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing longitude values. Default:
              "longitude" or "lon"
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
        class="tw:mb-3 showLabelOnTop"
        stack-label
        data-test="dashboard-config-geo-weight-label"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events tw:mb-[-5px]">
            {{ t("dashboard.geoWeightLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Name of the metric label containing weight values. Default:
              "weight"
            </q-tooltip>
          </div>
        </template>
      </q-input>
    </div>

    <!-- Maps Label Configuration -->
    <div v-if="chartType === 'maps'" class="maps-config">
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
          <div class="row items-center all-pointer-events tw:mb-[-5px]">
            {{ t("dashboard.mapsNameLabel") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="300px">
              Name of the metric label containing location names (e.g., country,
              region). Default: "name"
            </q-tooltip>
          </div>
        </template>
      </q-input>

      <q-select
        v-model="mapsMapType"
        :options="['world']"
        :label="t('dashboard.mapsMapType')"
        borderless
        dense
        class="q-py-sm showLabelOnTop"
        stack-label
        data-test="dashboard-config-maps-type"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events tw:mb-[-5px]">
            {{ t("dashboard.mapsMapType") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="250px">
              Map type to display. Default: "world"
            </q-tooltip>
          </div>
        </template>
      </q-select>
    </div>

    <!-- Table Configuration -->
    <div v-if="chartType === 'table'" class="table-config">
      <!-- PromQL Table Mode -->
      <q-select
        v-model="promqlTableMode"
        :options="promqlTableModeOptions"
        :label="t('dashboard.promqlTableMode')"
        borderless
        dense
        class="q-py-md showLabelOnTop"
        stack-label
        emit-value
        map-options
        data-test="dashboard-config-promql-table-mode"
      >
        <template v-slot:label>
          <div class="row items-center all-pointer-events">
            {{ t("dashboard.promqlTableMode") }}
            <q-icon class="q-ml-xs" size="20px" name="info" />
            <q-tooltip class="bg-grey-8" max-width="400px">
              <b>PromQL Table Mode - </b>
              Controls how time-series data is displayed in the table.
              <br /><br />
              <b>Time Series:</b> Shows timestamp and value columns for selected
              series with legend dropdown. <br /><br />
              <b>Time Series with Metadata:</b> Shows timestamp, value, and all
              metric labels (job, instance, etc.) for selected series with
              legend dropdown. <br /><br />
              <b>Aggregate:</b> Shows aggregated values across all series
              without timestamps (no legend dropdown). <br /><br />
              <b>Note:</b> The legend dropdown only appears in time series modes
              when multiple series are present.
            </q-tooltip>
          </div>
        </template>
      </q-select>
      <template v-if="promqlTableMode === 'all'">
        <q-select
          v-model="tableAggregations"
          :options="aggregationOptions"
          :label="t('dashboard.tableAggregations')"
          multiple
          borderless
          dense
          class="showLabelOnTop"
          stack-label
          emit-value
          map-options
          data-test="dashboard-config-table-aggregations"
          :display-value="getTableAggregationsDisplay"
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
                Example: Selecting "last", "sum", "avg" will create three value
                columns.
              </q-tooltip>
            </div>
          </template>
          <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
            <q-item v-bind="itemProps" dense style="padding: 0px 4px">
              <q-item-section side class="q-pa-none">
                <q-checkbox
                  :model-value="selected"
                  @update:model-value="toggleOption(opt)"
                />
              </q-item-section>
              <q-item-section class="q-pa-none">
                <q-item-label>{{ opt.label }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </template>

      <!-- Column Filters -->
      <template
        v-if="
          promqlTableMode === 'all' || promqlTableMode === 'expanded_timeseries'
        "
      >
        <div class="q-mb-sm text-subtitle2 q-mt-md">Column Filters</div>

        <q-select
          v-model="visibleColumns"
          :options="visibleColumnsFilteredOptions"
          :label="t('dashboard.visibleColumns')"
          multiple
          use-input
          input-debounce="0"
          new-value-mode="add-unique"
          @filter="filterVisibleColumns"
          @new-value="createColumnValue"
          borderless
          dense
          class="showLabelOnTop"
          stack-label
          data-test="dashboard-config-visible-columns"
          :display-value="getVisibleColumnsDisplay"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events tw:mb-[-5px]">
              {{ t("dashboard.visibleColumns") }}
              <q-icon class="q-ml-xs" size="18px" name="info">
                <q-tooltip class="bg-grey-8" max-width="400px">
                  <b>Visible Columns</b>
                  <br /><br />
                  Specify which metric label columns to show in the table.
                  <br /><br />
                  <b>How to use:</b><br />
                  • Select from dropdown (loaded from stream fields)<br />
                  • Type custom column names and press Enter<br />
                  • Leave empty to show all columns
                  <br /><br />
                  <b>Note:</b> This takes precedence over "Hidden Columns" if
                  both are set.
                </q-tooltip>
              </q-icon>
            </div>
          </template>
          <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
            <q-item
              v-bind="itemProps"
              dense
              style="min-height: auto; padding: 0px 4px"
            >
              <q-item-section side class="q-pa-none">
                <q-checkbox
                  :model-value="selected"
                  @update:model-value="toggleOption(opt)"
                />
              </q-item-section>
              <q-item-section class="q-pa-none">
                <q-item-label>{{ opt }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>

        <q-select
          v-model="hiddenColumns"
          :options="hiddenColumnsFilteredOptions"
          :label="t('dashboard.hiddenColumns')"
          multiple
          use-input
          input-debounce="0"
          new-value-mode="add-unique"
          @filter="filterHiddenColumns"
          @new-value="createColumnValue"
          borderless
          dense
          class="showLabelOnTop"
          stack-label
          data-test="dashboard-config-hidden-columns"
          :display-value="getHiddenColumnsDisplay"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events tw:mb-[-5px]">
              {{ t("dashboard.hiddenColumns") }}
              <q-icon class="q-ml-xs" size="18px" name="info">
                <q-tooltip class="bg-grey-8" max-width="400px">
                  <b>Hidden Columns</b>
                  <br /><br />
                  Specify which metric label columns to hide from the table.
                  <br /><br />
                  <b>How to use:</b><br />
                  • Select from dropdown (loaded from stream fields)<br />
                  • Type custom column names and press Enter<br />
                  • All other columns will be shown
                  <br /><br />
                  <b>Tip:</b> Useful for hiding internal labels like __name__,
                  le (histogram buckets), quantile, etc.
                </q-tooltip>
              </q-icon>
            </div>
          </template>
          <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
            <q-item
              v-bind="itemProps"
              dense
              style="min-height: auto; padding: 0px 4px"
            >
              <q-item-section side class="q-pa-none">
                <q-checkbox
                  :model-value="selected"
                  @update:model-value="toggleOption(opt)"
                />
              </q-item-section>
              <q-item-section class="q-pa-none">
                <q-item-label>{{ opt }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </template>

      <!-- Sticky Columns -->
      <template
        v-if="
          promqlTableMode === 'all' || promqlTableMode === 'expanded_timeseries'
        "
      >
        <div class="q-mb-sm text-subtitle2 q-mt-md">Sticky Columns</div>

        <q-toggle
          v-model="stickyFirstColumn"
          data-test="dashboard-config-sticky-first-column"
          class="tw:h-[36px] -tw:ml-2 o2-toggle-button-lg"
          size="lg"
        >
          <template v-slot:default>
            <div class="row items-center all-pointer-events tw:mb-[-5px] tw:ml-2">
              {{ t("dashboard.stickyFirstColumn") }}
              <q-icon class="q-ml-xs" size="20px" name="info" />
              <q-tooltip class="bg-grey-8" max-width="300px">
                <b>Sticky First Column - </b>
                Makes the first column stay fixed when scrolling horizontally.
                <br /><br />
                Useful for keeping the primary identifier visible (e.g., job,
                instance).
              </q-tooltip>
            </div>
          </template>
        </q-toggle>

        <q-select
          v-model="stickyColumns"
          :options="stickyColumnsFilteredOptions"
          :label="t('dashboard.stickyColumns')"
          multiple
          use-input
          input-debounce="0"
          new-value-mode="add-unique"
          @filter="filterStickyColumns"
          @new-value="createColumnValue"
          borderless
          dense
          class="showLabelOnTop"
          stack-label
          data-test="dashboard-config-sticky-columns"
          :disable="stickyFirstColumn"
          :display-value="getStickyColumnsDisplay"
        >
          <template v-slot:label>
            <div class="row items-center all-pointer-events">
              {{ t("dashboard.stickyColumns") }}
              <q-icon class="q-ml-xs" size="18px" name="info">
                <q-tooltip class="bg-grey-8" max-width="400px">
                  <b>Sticky Columns</b>
                  <br /><br />
                  Specify which columns should remain fixed when scrolling
                  horizontally.
                  <br /><br />
                  <b>How to use:</b><br />
                  • Select from dropdown (loaded from stream fields)<br />
                  • Type custom column names and press Enter<br />
                  • Columns will stay visible during horizontal scroll
                  <br /><br />
                  <b>Note:</b> Disabled when "Sticky First Column" is enabled.
                </q-tooltip>
              </q-icon>
            </div>
          </template>
          <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
            <q-item
              v-bind="itemProps"
              dense
              style="min-height: auto; padding: 0px 4px"
            >
              <q-item-section side class="q-pa-none">
                <q-checkbox
                  :model-value="selected"
                  @update:model-value="toggleOption(opt)"
                />
              </q-item-section>
              <q-item-section class="q-pa-none">
                <q-item-label>{{ opt }}</q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, inject, watch } from "vue";
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
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

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
    const chartsWithAggregation = ["pie", "donut", "geomap", "maps"];

    const showAggregationConfig = computed(() =>
      chartsWithAggregation.includes(props.chartType),
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
      get: () => {
        const val = dashboardPanelData.data.config?.map_type;
        return typeof val === "string" ? val : "world";
      },
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

    // PromQL Table Mode configuration
    const promqlTableMode = computed({
      get: () => dashboardPanelData.data.config?.promql_table_mode || "single",
      set: (value: string) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.promql_table_mode = value;
      },
    });

    // Options for PromQL table mode
    const promqlTableModeOptions = [
      { label: "Time series", value: "single" },
      { label: "Expanded Time series", value: "expanded_timeseries" },
      { label: "Aggregate", value: "all" },
    ];

    // Get available column options from stream fields across ALL queries
    const availableColumnOptions = computed(() => {
      // For PromQL, we need to combine fields from ALL queries since it supports multi-query
      const queries = dashboardPanelData.data.queries || [];
      const allFieldNames = new Set<string>();

      if (!dashboardPanelData.meta?.streamFields?.groupedFields) {
        return [];
      }

      // Iterate through ALL queries and collect unique field names
      queries.forEach((query: any, index: number) => {
        const streamName = query?.fields?.stream;

        if (!streamName) {
          return;
        }

        // Find the stream in groupedFields
        const streamFields =
          dashboardPanelData.meta.streamFields.groupedFields.find(
            (group: any) => group.name === streamName,
          );

        if (streamFields?.schema) {
          // Extract field names from schema and add to set (automatically removes duplicates)
          const fieldNames = streamFields.schema
            .map((field: any) => field.name)
            .filter(Boolean);

          fieldNames.forEach((name: string) => allFieldNames.add(name));
        }
      });

      const result = Array.from(allFieldNames).sort();

      // Return unique field names as array
      return result;
    });

    // Filtered options for each multiselect (for search/autocomplete)
    const visibleColumnsFilteredOptions = ref<string[]>([]);
    const hiddenColumnsFilteredOptions = ref<string[]>([]);
    const stickyColumnsFilteredOptions = ref<string[]>([]);

    // Filter function for visible columns autocomplete
    const filterVisibleColumns = (
      val: string,
      update: (fn: () => void) => void,
    ) => {
      update(() => {
        const options = availableColumnOptions.value;
        if (val === "") {
          visibleColumnsFilteredOptions.value = options;
        } else {
          const needle = val.toLowerCase();
          visibleColumnsFilteredOptions.value = options.filter((v) =>
            v.toLowerCase().includes(needle),
          );
        }
      });
    };

    // Filter function for hidden columns autocomplete
    const filterHiddenColumns = (
      val: string,
      update: (fn: () => void) => void,
    ) => {
      update(() => {
        const options = availableColumnOptions.value;
        if (val === "") {
          hiddenColumnsFilteredOptions.value = options;
        } else {
          const needle = val.toLowerCase();
          hiddenColumnsFilteredOptions.value = options.filter((v) =>
            v.toLowerCase().includes(needle),
          );
        }
      });
    };

    // Filter function for sticky columns autocomplete
    const filterStickyColumns = (
      val: string,
      update: (fn: () => void) => void,
    ) => {
      update(() => {
        const options = availableColumnOptions.value;
        if (val === "") {
          stickyColumnsFilteredOptions.value = options;
        } else {
          const needle = val.toLowerCase();
          stickyColumnsFilteredOptions.value = options.filter((v) =>
            v.toLowerCase().includes(needle),
          );
        }
      });
    };

    // Handler for creating new column values
    const createColumnValue = (val: string, done: (value: string) => void) => {
      // Trim and validate the value
      const trimmedVal = val.trim();
      if (trimmedVal.length > 0) {
        done(trimmedVal);
      }
    };

    // Table column filters - visible columns
    const visibleColumns = computed({
      get: () => dashboardPanelData.data.config?.visible_columns || [],
      set: (value: string[]) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.visible_columns =
          value && value.length > 0 ? value : undefined;
      },
    });

    // Table column filters - hidden columns
    const hiddenColumns = computed({
      get: () => dashboardPanelData.data.config?.hidden_columns || [],
      set: (value: string[]) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.hidden_columns =
          value && value.length > 0 ? value : undefined;
      },
    });

    // Sticky first column toggle
    const stickyFirstColumn = computed({
      get: () => dashboardPanelData.data.config?.sticky_first_column || false,
      set: (value: boolean) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.sticky_first_column = value;
        // Clear sticky_columns when sticky_first_column is enabled
        if (value) {
          dashboardPanelData.data.config.sticky_columns = undefined;
        }
      },
    });

    // Sticky columns multiselect
    const stickyColumns = computed({
      get: () => dashboardPanelData.data.config?.sticky_columns || [],
      set: (value: string[]) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.sticky_columns =
          value && value.length > 0 ? value : undefined;
      },
    });

    // Display value for table aggregations (compact format: first item + count)
    const getTableAggregationsDisplay = computed(() => {
      const selected = tableAggregations.value || [];
      if (selected.length === 0) return "";

      // Map the selected values to their labels
      const labels = selected
        .map((val: string) => {
          const option = aggregationOptions.find((opt) => opt.value === val);
          return option ? option.value : val;
        })
        .filter(Boolean);

      if (labels.length === 1) return labels[0];
      return `${labels[0]} (+${labels.length - 1} more)`;
    });

    // Display value for visible columns (compact format: first item + count)
    const getVisibleColumnsDisplay = computed(() => {
      const selected = visibleColumns.value || [];
      if (selected.length === 0) return "";
      if (selected.length === 1) return selected[0];
      return `${selected[0]} (+${selected.length - 1} more)`;
    });

    // Display value for hidden columns (compact format: first item + count)
    const getHiddenColumnsDisplay = computed(() => {
      const selected = hiddenColumns.value || [];
      if (selected.length === 0) return "";
      if (selected.length === 1) return selected[0];
      return `${selected[0]} (+${selected.length - 1} more)`;
    });

    // Display value for sticky columns (compact format: first item + count)
    const getStickyColumnsDisplay = computed(() => {
      const selected = stickyColumns.value || [];
      if (selected.length === 0) return "";
      if (selected.length === 1) return selected[0];
      return `${selected[0]} (+${selected.length - 1} more)`;
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
      mapsNameLabel,
      mapsMapType,
      mapsEnableRoam,
      tableAggregations,
      promqlTableMode,
      promqlTableModeOptions,
      getTableAggregationsDisplay,
      visibleColumnsFilteredOptions,
      hiddenColumnsFilteredOptions,
      stickyColumnsFilteredOptions,
      filterVisibleColumns,
      filterHiddenColumns,
      filterStickyColumns,
      createColumnValue,
      visibleColumns,
      hiddenColumns,
      getVisibleColumnsDisplay,
      getHiddenColumnsDisplay,
      stickyFirstColumn,
      stickyColumns,
      getStickyColumnsDisplay,
    };
  },
});
</script>

<style scoped lang="scss">
.promql-chart-config {
  .geomap-config,
  .maps-config,
  .table-config {
    padding: 0px 0;
    // border: 1px solid rgba(0, 0, 0, 0.12);
  }

  // Fix icon cropping in labels
  :deep(.q-field__label) {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  // Prevent capitalization for column filter fields
  :deep(.q-field__native > :first-child) {
    text-transform: none !important;
  }
}
</style>
