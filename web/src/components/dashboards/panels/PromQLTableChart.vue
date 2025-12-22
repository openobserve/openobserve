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
  <div class="promql-table-chart" style="height: 100%; width: 100%; display: flex; flex-direction: column; position: relative;">
    <q-table
      :rows="filteredTableRows"
      :columns="tableColumns"
      :pagination="paginationConfig"
      :filter="filter"
      :loading="loading"
      row-key="id"
      flat
      bordered
      dense
      :style="{ flex: '1 1 auto', height: showLegendFooter ? 'calc(100% - 60px)' : '100%' }"
      :virtual-scroll="filteredTableRows.length > 100"
      :rows-per-page-options="[10, 20, 50, 100, 0]"
      :class="{ 'with-legend-footer': showLegendFooter }"
    >
      <!-- Header slot for custom styling -->
      <template v-slot:header="props">
        <q-tr :props="props">
          <q-th
            v-for="col in props.cols"
            :key="col.name"
            :props="props"
            :style="{
              backgroundColor: config.header_bg_color || '#f5f5f5',
              fontWeight: 'bold',
            }"
          >
            {{ col.label }}
          </q-th>
        </q-tr>
      </template>

      <!-- Body slot for custom formatting -->
      <template v-slot:body="props">
        <q-tr :props="props" :class="{ 'cursor-pointer': true }">
          <q-td
            v-for="col in props.cols"
            :key="col.name"
            :props="props"
            :style="{ textAlign: col.align || 'left' }"
          >
            {{
              col.format
                ? col.format(props.row[col.field])
                : props.row[col.field]
            }}
          </q-td>
        </q-tr>
      </template>

      <!-- No data slot -->
      <template v-slot:no-data>
        <div class="text-center q-pa-md text-grey-6">
          <q-icon name="info" size="48px" color="grey-5" class="q-mb-md" />
          <div class="text-h6">No data available</div>
          <div class="text-caption">
            Your PromQL query returned no results
          </div>
        </div>
      </template>

      <!-- Loading slot -->
      <template v-slot:loading>
        <q-inner-loading showing color="primary" />
      </template>
    </q-table>

    <!-- Search/Filter bar (optional) -->
    <div
      v-if="config.filterable !== false && tableRows.length > 0"
      class="table-filter q-pa-sm"
      style="
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 10;
        width: 250px;
      "
    >
      <q-input
        v-model="filter"
        outlined
        dense
        debounce="300"
        placeholder="Search..."
        clearable
      >
        <template v-slot:prepend>
          <q-icon name="search" />
        </template>
      </q-input>
    </div>

    <!-- Legend Dropdown Footer (Grafana-style) -->
    <div
      v-if="showLegendFooter"
      class="legend-footer q-pa-sm"
    >
      <div class="row items-center q-gutter-md" style="width: 100%; padding: 0 12px;">
        <div class="text-body2" style="min-width: 60px;">
          Legend:
        </div>
        <q-select
          v-model="selectedLegend"
          :options="legendOptions"
          outlined
          dense
          emit-value
          map-options
          style="min-width: 300px; max-width: 500px;"
          placeholder="Select series to filter"
        >
          <template v-slot:prepend>
            <q-icon name="filter_list" size="sm" />
          </template>
        </q-select>
        <q-space />
        <div class="text-body2 text-grey-7">
          Showing {{ filteredTableRows.length }} of {{ tableRows.length }} rows
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import {
  getUnitValue,
  formatUnitValue,
} from "@/utils/dashboard/convertDataIntoUnitValue";

export default defineComponent({
  name: "PromQLTableChart",
  props: {
    data: {
      type: Object,
      required: true,
    },
    config: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const filter = ref("");
    const loading = ref(false);

    console.log("=== [PromQL Table Chart] Component mounted ===");
    console.log("Table Data:", props.data);
    console.log("Table Config:", props.config);

    // Extract columns and rows from processed data
    const tableColumns = computed(() => {
      if (!props.data?.columns) {
        console.warn("No columns found in table data");
        return [];
      }
      console.log("Table Columns:", props.data.columns);
      return props.data.columns;
    });

    const tableRows = computed(() => {
      if (!props.data?.rows) {
        console.warn("No rows found in table data");
        return [];
      }
      // Add unique ID to each row for q-table
      const rows = props.data.rows.map((row: any, index: number) => ({
        id: `row_${index}`,
        ...row,
      }));
      console.log(`Table Rows: ${rows.length} rows`);
      return rows;
    });

    // Legend filtering logic
    const selectedLegend = ref<string>("");

    // Extract unique legend names from rows
    const legendOptions = computed(() => {
      const rows = props.data?.rows || [];
      const uniqueLegends = new Set<string>();

      rows.forEach((row: any) => {
        if (row.__legend__) {
          uniqueLegends.add(row.__legend__);
        }
      });

      const legends = Array.from(uniqueLegends);

      // Config option: table_mode can be "single" (default) or "all"
      const tableMode = props.config?.promql_table_mode || "single";

      const options = [];

      if (tableMode === "all") {
        // In "all" mode, add "All series" option
        options.push({ label: "All series", value: "__all__" });
      }

      // Add individual legend options
      legends.forEach((legend) => {
        options.push({
          label: legend,
          value: legend,
        });
      });

      console.log("Legend Options:", options);
      console.log("Table Mode:", tableMode);
      console.log("Unique legends count:", legends.length);

      return options;
    });

    // Determine if legend footer should be shown
    const showLegendFooter = computed(() => {
      return legendOptions.value.length > 1;
    });

    // Filter rows based on selected legend
    const filteredTableRows = computed(() => {
      if (!selectedLegend.value || selectedLegend.value === "__all__") {
        return tableRows.value;
      }

      const filtered = tableRows.value.filter(
        (row: any) => row.__legend__ === selectedLegend.value
      );
      console.log(
        `Filtered to legend "${selectedLegend.value}": ${filtered.length} rows`
      );
      return filtered;
    });

    const paginationConfig = computed(() => {
      const pageSize = props.config.page_size || 10;
      const enabled = props.config.pagination !== false;

      return {
        page: 1,
        rowsPerPage: enabled ? pageSize : 0, // 0 = show all rows
        rowsNumber: filteredTableRows.value.length,
      };
    });

    // Watch for data changes and set default legend
    watch(
      () => props.data,
      (newData) => {
        console.log("=== [PromQL Table Chart] Data updated ===");
        console.log("New data:", newData);

        // Set default legend selection
        if (legendOptions.value.length > 0) {
          const tableMode = props.config?.promql_table_mode || "single";

          if (tableMode === "all") {
            // In "all" mode, default to "All series"
            selectedLegend.value = "__all__";
          } else {
            // In "single" mode (default), select first series
            selectedLegend.value = legendOptions.value[0]?.value || "";
          }

          console.log("Default legend selected:", selectedLegend.value);
        }
      },
      { deep: true, immediate: true }
    );

    return {
      filter,
      loading,
      tableColumns,
      tableRows,
      filteredTableRows,
      paginationConfig,
      selectedLegend,
      legendOptions,
      showLegendFooter,
    };
  },
});
</script>

<style scoped lang="scss">
.promql-table-chart {
  position: relative;

  :deep(.q-table) {
    height: 100%;

    .q-table__container {
      height: 100%;
      max-height: 100%;
    }

    .q-table__middle {
      max-height: calc(100% - 50px);
    }

    thead tr th {
      position: sticky;
      top: 0;
      z-index: 2;
      background-color: #f5f5f5;
      font-weight: bold;
    }

    tbody tr {
      transition: background-color 0.2s;

      &:hover {
        background-color: rgba(0, 0, 0, 0.05);
      }
    }

    // Ensure alternating row colors
    tbody tr:nth-child(even) {
      background-color: rgba(0, 0, 0, 0.02);
    }
  }

  .table-filter {
    background-color: rgba(255, 255, 255, 0.95);
    border-radius: 4px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
}

// Dark mode support
.body--dark {
  .promql-table-chart {
    :deep(.q-table) {
      thead tr th {
        background-color: #1e1e1e;
      }

      tbody tr:nth-child(even) {
        background-color: rgba(255, 255, 255, 0.02);
      }

      tbody tr:hover {
        background-color: rgba(255, 255, 255, 0.05);
      }
    }

    .table-filter {
      background-color: rgba(30, 30, 30, 0.95);
    }

    .legend-footer {
      background-color: #1a1a1a !important;
      border-top-color: rgba(255, 255, 255, 0.12) !important;
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.5);
    }
  }
}

// Legend footer styling
.legend-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  z-index: 10;
  border-top: 2px solid #e0e0e0;
  background-color: #ffffff;
  display: flex;
  align-items: center;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.2s ease-in-out;
}
</style>
