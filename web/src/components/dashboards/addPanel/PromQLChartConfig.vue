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
  <div class="promql-chart-config" data-test="dashboard-promql-chart-config">
    <!-- Aggregation Function Selector -->
    <OSelect
      v-if="showAggregationConfig"
      v-model="aggregationValue"
      :options="aggregationOptions"
      :label="t('dashboard.aggregationFunction')"
      data-test="dashboard-config-aggregation"
    >
      <template #tooltip>
        <OTooltip max-width="300px">
          <template #content>
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
          </template>
        </OTooltip>
      </template>
    </OSelect>

    <!-- GeoMap Label Configuration -->
    <div v-if="chartType === 'geomap'" class="geomap-config">
      <OInput
        v-model="geoLatLabel"
        :label="t('dashboard.geoLatLabel')"
        placeholder="latitude or lat"
        data-test="dashboard-config-geo-lat-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              Name of the metric label containing latitude values. Default:
              "latitude" or "lat"
            </template>
          </OTooltip>
        </template>
      </OInput>

      <OInput
        v-model="geoLonLabel"
        :label="t('dashboard.geoLonLabel')"
        placeholder="longitude or lon"
        data-test="dashboard-config-geo-lon-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              Name of the metric label containing longitude values. Default:
              "longitude" or "lon"
            </template>
          </OTooltip>
        </template>
      </OInput>

      <OInput
        v-model="geoWeightLabel"
        :label="t('dashboard.geoWeightLabel')"
        placeholder="weight"
        data-test="dashboard-config-geo-weight-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              Name of the metric label containing weight values. Default:
              "weight"
            </template>
          </OTooltip>
        </template>
      </OInput>
    </div>

    <!-- Maps Label Configuration -->
    <div v-if="chartType === 'maps'" class="maps-config">
      <OInput
        v-model="mapsNameLabel"
        :label="t('dashboard.mapsNameLabel')"
        placeholder="country or location"
        data-test="dashboard-config-maps-name-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              Name of the metric label containing location names (e.g., country,
              region). Default: "name"
            </template>
          </OTooltip>
        </template>
      </OInput>
    </div>

    <!-- Table Configuration -->
    <div v-if="chartType === 'table'" class="table-config">
      <!-- PromQL Table Mode -->
      <OSelect
        v-show="isConfigOptionVisible('promqlTable', 'promql-table-mode')"
        v-model="promqlTableMode"
        :options="promqlTableModeOptions"
        :label="t('dashboard.promqlTableMode')"
        data-test="dashboard-config-promql-table-mode"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
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
            </template>
          </OTooltip>
        </template>
      </OSelect>
      <template v-if="promqlTableMode === 'all'">
        <OSelect
          v-show="isConfigOptionVisible('promqlTable', 'table-aggregations')"
          v-model="tableAggregations"
          :options="aggregationOptions"
          :label="t('dashboard.tableAggregations')"
          multiple
          class="showLabelOnTop"
          data-test="dashboard-config-table-aggregations"
        >
          <template #tooltip>
            <OTooltip max-width="350px">
              <template #content>
                <b>Table Aggregations - </b>
                Select multiple aggregation functions to display as columns.
                <br /><br />
                Single aggregation: creates a "value" column
                <br />
                Multiple aggregations: creates "value_last", "value_sum", etc.
                <br /><br />
                Example: Selecting "last", "sum", "avg" will create three value
                columns.
              </template>
            </OTooltip>
          </template>
        </OSelect>
      </template>

      <!-- Column Filters -->
      <template
        v-if="
          promqlTableMode === 'all' || promqlTableMode === 'expanded_timeseries'
        "
      >
        <div
          v-show="
            isConfigOptionVisible('promqlTable', 'visible-columns') ||
            isConfigOptionVisible('promqlTable', 'hidden-columns')
          "
          class="tw:mb-2 tw:text-sm tw:font-medium tw:mt-3"
        >
          Column Filters
        </div>

        <OSelect
          v-show="isConfigOptionVisible('promqlTable', 'visible-columns')"
          v-model="visibleColumns"
          :options="availableColumnOptions"
          :label="t('dashboard.visibleColumns')"
          multiple
          creatable
          class="showLabelOnTop"
          data-test="dashboard-config-visible-columns"
          @create="addToVisibleColumns"
        >
          <template #tooltip>
            <OTooltip max-width="400px">
              <template #content>
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
              </template>
            </OTooltip>
          </template>
        </OSelect>

        <OSelect
          v-show="isConfigOptionVisible('promqlTable', 'hidden-columns')"
          v-model="hiddenColumns"
          :options="availableColumnOptions"
          :label="t('dashboard.hiddenColumns')"
          multiple
          creatable
          class="showLabelOnTop"
          data-test="dashboard-config-hidden-columns"
          @create="addToHiddenColumns"
        >
          <template #tooltip>
            <OTooltip max-width="400px">
              <template #content>
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
              </template>
            </OTooltip>
          </template>
        </OSelect>
      </template>

      <!-- Sticky Columns -->
      <template
        v-if="
          promqlTableMode === 'all' || promqlTableMode === 'expanded_timeseries'
        "
      >
        <div
          v-show="
            isConfigOptionVisible('promqlTable', 'sticky-first-column') ||
            isConfigOptionVisible('promqlTable', 'sticky-columns')
          "
          class="tw:mb-2 tw:text-sm tw:font-medium tw:mt-3"
        >
          Sticky Columns
        </div>

        <OSwitch
          v-show="isConfigOptionVisible('promqlTable', 'sticky-first-column')"
          v-model="stickyFirstColumn"
          label="Sticky First Column"
          data-test="dashboard-config-sticky-first-column"
          size="lg"
        >
          <template #tooltip>
            <OTooltip max-width="300px">
              <template #content>
                <b>Sticky First Column - </b>
                Makes the first column stay fixed when scrolling horizontally.
                <br /><br />
                Useful for keeping the primary identifier visible (e.g., job,
                instance).
              </template>
            </OTooltip>
          </template>
        </OSwitch>

        <OSelect
          v-show="isConfigOptionVisible('promqlTable', 'sticky-columns')"
          v-model="stickyColumns"
          :options="availableColumnOptions"
          :label="t('dashboard.stickyColumns')"
          multiple
          creatable
          class="showLabelOnTop"
          data-test="dashboard-config-sticky-columns"
          :disabled="stickyFirstColumn"
          @create="addToStickyColumns"
        >
          <template #tooltip>
            <OTooltip max-width="400px">
              <template #content>
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
              </template>
            </OTooltip>
          </template>
        </OSelect>
      </template>

      <!-- Column Order Configuration -->
      <template
        v-if="
          promqlTableMode === 'all' || promqlTableMode === 'expanded_timeseries'
        "
      >
        <div
          v-show="
            isConfigOptionVisible('promqlTable', 'configure-column-order')
          "
          style="font-weight: 600"
        ></div>
        <OButton
          v-show="
            isConfigOptionVisible('promqlTable', 'configure-column-order')
          "
          variant="outline"
          size="sm"
          @click="openColumnOrderPopup"
          data-test="dashboard-config-column-order-button"
          icon-left="reorder"
        >
          {{ t(`dashboard.configureColumnOrder`) }}
        </OButton>

        <!-- Column Order Popup Dialog -->
        <ColumnOrderPopUp
          :open="showColumnOrderPopup"
          :column-order="columnOrder"
          :available-columns="filteredAvailableColumns"
          @cancel="closeColumnOrderPopup"
          @save="saveColumnOrder"
        />
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, inject, watch } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import ColumnOrderPopUp from "./ColumnOrderPopUp.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

export default defineComponent({
  name: "PromQLChartConfig",
  components: {
    ColumnOrderPopUp,
    OButton,
    OSelect,
    OInput,
    OSwitch,
    OTooltip,
    OIcon,
},
  props: {
    chartType: {
      type: String,
      required: true,
    },
    isConfigOptionVisible: {
      type: Function,
      default: () => true,
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

    // Handlers for adding user-typed custom column names (OSelect @create event)
    const addToVisibleColumns = (val: string) => {
      const current = [...(visibleColumns.value as string[])];
      if (!current.includes(val)) visibleColumns.value = [...current, val];
    };

    const addToHiddenColumns = (val: string) => {
      const current = [...(hiddenColumns.value as string[])];
      if (!current.includes(val)) hiddenColumns.value = [...current, val];
    };

    const addToStickyColumns = (val: string) => {
      const current = [...(stickyColumns.value as string[])];
      if (!current.includes(val)) stickyColumns.value = [...current, val];
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

    // Column order configuration
    const columnOrder = computed({
      get: () => dashboardPanelData.data.config?.column_order || [],
      set: (value: string[]) => {
        if (!dashboardPanelData.data.config) {
          dashboardPanelData.data.config = {};
        }
        dashboardPanelData.data.config.column_order =
          value && value.length > 0 ? value : undefined;
      },
    });

    // Column order popup state
    const showColumnOrderPopup = ref(false);

    // Get filtered available columns based on visible/hidden column settings
    const filteredAvailableColumns = computed(() => {
      const allColumns = availableColumnOptions.value;
      const visible = visibleColumns.value || [];
      const hidden = hiddenColumns.value || [];

      // If visible_columns is specified, only show those columns
      if (visible.length > 0) {
        return allColumns.filter((col) => visible.includes(col));
      }
      // If hidden_columns is specified, hide those columns
      else if (hidden.length > 0) {
        return allColumns.filter((col) => !hidden.includes(col));
      }
      // Otherwise show all columns
      return allColumns;
    });

    // Open column order popup
    const openColumnOrderPopup = () => {
      showColumnOrderPopup.value = true;
    };

    // Close column order popup
    const closeColumnOrderPopup = () => {
      showColumnOrderPopup.value = false;
    };

    // Save column order from popup
    const saveColumnOrder = (newOrder: string[]) => {
      columnOrder.value = newOrder;
      showColumnOrderPopup.value = false;
    };

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
      addToVisibleColumns,
      addToHiddenColumns,
      addToStickyColumns,
      visibleColumns,
      hiddenColumns,
      stickyFirstColumn,
      stickyColumns,
      availableColumnOptions,
      columnOrder,
      showColumnOrderPopup,
      filteredAvailableColumns,
      openColumnOrderPopup,
      closeColumnOrderPopup,
      saveColumnOrder,
    };
  },
});
</script>

<style scoped lang="scss">
.promql-chart-config {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  .geomap-config,
  .maps-config,
  .table-config {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0;
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
