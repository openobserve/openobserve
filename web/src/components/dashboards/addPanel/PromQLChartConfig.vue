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
  <div class="flex flex-col gap-2" data-test="dashboard-promql-chart-config">
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
            <b>{{ t('dashboard.promQLChartConfig.aggTooltipTitle') }}</b>
            {{ t('dashboard.promQLChartConfig.aggTooltipDesc') }}
            <br /><br />
            <b>{{ t('dashboard.promQLChartConfig.aggLastLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggLastDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggFirstLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggFirstDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggMinMaxLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggMinMaxDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggAvgLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggAvgDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggSumLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggSumDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggCountLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggCountDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggRangeLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggRangeDesc') }}
            <br />
            <b>{{ t('dashboard.promQLChartConfig.aggDiffLabel') }}</b> {{ t('dashboard.promQLChartConfig.aggDiffDesc') }}
          </template>
        </OTooltip>
      </template>
    </OSelect>

    <!-- GeoMap Label Configuration -->
    <div v-if="chartType === 'geomap'" class="flex flex-col gap-2">
      <OInput
        v-model="geoLatLabel"
        :label="t('dashboard.geoLatLabel')"
        :placeholder="t('dashboard.promQLChartConfig.geoLatPlaceholder')"
        data-test="dashboard-config-geo-lat-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              {{ t('dashboard.promQLChartConfig.geoLatTooltip') }}
            </template>
          </OTooltip>
        </template>
      </OInput>

      <OInput
        v-model="geoLonLabel"
        :label="t('dashboard.geoLonLabel')"
        :placeholder="t('dashboard.promQLChartConfig.geoLonPlaceholder')"
        data-test="dashboard-config-geo-lon-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              {{ t('dashboard.promQLChartConfig.geoLonTooltip') }}
            </template>
          </OTooltip>
        </template>
      </OInput>

      <OInput
        v-model="geoWeightLabel"
        :label="t('dashboard.geoWeightLabel')"
        :placeholder="t('dashboard.promQLChartConfig.geoWeightPlaceholder')"
        data-test="dashboard-config-geo-weight-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              {{ t('dashboard.promQLChartConfig.geoWeightTooltip') }}
            </template>
          </OTooltip>
        </template>
      </OInput>
    </div>

    <!-- Maps Label Configuration -->
    <div v-if="chartType === 'maps'" class="flex flex-col gap-2">
      <OInput
        v-model="mapsNameLabel"
        :label="t('dashboard.mapsNameLabel')"
        :placeholder="t('dashboard.promQLChartConfig.mapsNamePlaceholder')"
        data-test="dashboard-config-maps-name-label"
      >
        <template #tooltip>
          <OTooltip max-width="300px">
            <template #content>
              {{ t('dashboard.promQLChartConfig.mapsNameTooltip') }}
            </template>
          </OTooltip>
        </template>
      </OInput>
    </div>

    <!-- Table Configuration -->
    <div v-if="chartType === 'table'" class="flex flex-col gap-2">
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
              <b>{{ t('dashboard.promQLChartConfig.promqlTableModeTooltipTitle') }}</b>
              {{ t('dashboard.promQLChartConfig.promqlTableModeTooltipDesc') }}
              <br /><br />
              <b>{{ t('dashboard.promQLChartConfig.tableModeTimeSeriesLabel') }}</b> {{ t('dashboard.promQLChartConfig.tableModeTimeSeriesDesc') }} <br /><br />
              <b>{{ t('dashboard.promQLChartConfig.tableModeTimeSeriesMetaLabel') }}</b> {{ t('dashboard.promQLChartConfig.tableModeTimeSeriesMetaDesc') }} <br /><br />
              <b>{{ t('dashboard.promQLChartConfig.tableModeAggregateLabel') }}</b> {{ t('dashboard.promQLChartConfig.tableModeAggregateDesc') }} <br /><br />
              <b>{{ t('dashboard.promQLChartConfig.noteLabel') }}</b> {{ t('dashboard.promQLChartConfig.promqlTableModeNoteDesc') }}
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
                <b>{{ t('dashboard.promQLChartConfig.tableAggTooltipTitle') }}</b>
                {{ t('dashboard.promQLChartConfig.tableAggTooltipDesc') }}
                <br /><br />
                {{ t('dashboard.promQLChartConfig.tableAggSingle') }}
                <br />
                {{ t('dashboard.promQLChartConfig.tableAggMultiple') }}
                <br /><br />
                {{ t('dashboard.promQLChartConfig.tableAggExample') }}
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
          class="mb-2 text-sm font-medium mt-3"
        >
          {{ t('dashboard.promQLChartConfig.columnFilters') }}
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
                <b>{{ t('dashboard.promQLChartConfig.visibleColumnsTitle') }}</b>
                <br /><br />
                {{ t('dashboard.promQLChartConfig.visibleColumnsDesc') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.howToUse') }}</b><br />
                {{ t('dashboard.promQLChartConfig.bulletSelectFromDropdown') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletTypeCustom') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletLeaveEmpty') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.noteLabel') }}</b> {{ t('dashboard.promQLChartConfig.visibleColumnsNote') }}
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
                <b>{{ t('dashboard.promQLChartConfig.hiddenColumnsTitle') }}</b>
                <br /><br />
                {{ t('dashboard.promQLChartConfig.hiddenColumnsDesc') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.howToUse') }}</b><br />
                {{ t('dashboard.promQLChartConfig.bulletSelectFromDropdown') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletTypeCustom') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletAllOtherShown') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.tipLabel') }}</b> {{ t('dashboard.promQLChartConfig.hiddenColumnsTip') }}
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
          class="mb-2 text-sm font-medium mt-3"
        >
          {{ t('dashboard.promQLChartConfig.stickyColumns') }}
        </div>

        <OSwitch
          v-show="isConfigOptionVisible('promqlTable', 'sticky-first-column')"
          v-model="stickyFirstColumn"
          :label="t('dashboard.promQLChartConfig.stickyFirstColumnLabel')"
          data-test="dashboard-config-sticky-first-column"
          size="lg"
        >
          <template #tooltip>
            <OTooltip max-width="300px">
              <template #content>
                <b>{{ t('dashboard.promQLChartConfig.stickyFirstColumnTooltipTitle') }}</b>
                {{ t('dashboard.promQLChartConfig.stickyFirstColumnTooltipDesc') }}
                <br /><br />
                {{ t('dashboard.promQLChartConfig.stickyFirstColumnTooltipNote') }}
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
                <b>{{ t('dashboard.promQLChartConfig.stickyColumns') }}</b>
                <br /><br />
                {{ t('dashboard.promQLChartConfig.stickyColumnsDesc') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.howToUse') }}</b><br />
                {{ t('dashboard.promQLChartConfig.bulletSelectFromDropdown') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletTypeCustom') }}<br />
                {{ t('dashboard.promQLChartConfig.bulletStickyScroll') }}
                <br /><br />
                <b>{{ t('dashboard.promQLChartConfig.noteLabel') }}</b> {{ t('dashboard.promQLChartConfig.stickyColumnsNote') }}
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
          class="font-semibold"
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
      { label: t("dashboard.promQLChartConfig.aggOptionLast"), value: "last" },
      { label: t("dashboard.promQLChartConfig.aggOptionFirst"), value: "first" },
      { label: t("dashboard.promQLChartConfig.aggOptionMin"), value: "min" },
      { label: t("dashboard.promQLChartConfig.aggOptionMax"), value: "max" },
      { label: t("dashboard.promQLChartConfig.aggOptionAvg"), value: "avg" },
      { label: t("dashboard.promQLChartConfig.aggOptionSum"), value: "sum" },
      { label: t("dashboard.promQLChartConfig.aggOptionCount"), value: "count" },
      { label: t("dashboard.promQLChartConfig.aggOptionRange"), value: "range" },
      { label: t("dashboard.promQLChartConfig.aggOptionDiff"), value: "diff" },
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
      { label: t("dashboard.promQLChartConfig.tableModeOptionSingle"), value: "single" },
      { label: t("dashboard.promQLChartConfig.tableModeOptionExpanded"), value: "expanded_timeseries" },
      { label: t("dashboard.promQLChartConfig.tableModeOptionAggregate"), value: "all" },
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

