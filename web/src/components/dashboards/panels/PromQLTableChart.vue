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
  <div
    class="promql-table-chart"
    style="
      height: 100%;
      width: 100%;
      display: flex;
      flex-direction: column;
      position: relative;
    "
  >
    <q-table
      :class="['my-sticky-virtscroll-table']"
      :rows="filteredTableRows"
      :columns="tableColumns"
      v-model:pagination="pagination"
      row-key="id"
      dense
      virtual-scroll
      :rows-per-page-options="[0]"
      :virtual-scroll-sticky-size-start="48"
      hide-no-data
    >

      <!-- Bottom slot: add legend dropdown alongside pagination -->
      <template v-slot:bottom v-if="showLegendFooter">
        <div class="row items-center full-width">
          <div class="row items-center q-gutter-sm q-pl-md">
            <q-select
              v-model="selectedLegend"
              :options="legendOptions"
              outlined
              dense
              emit-value
              map-options
              style="min-width: 300px; max-width: 500px"
              placeholder="Select series to filter"
            >
              <template v-slot:prepend>
                <q-icon name="filter_list" size="xs" />
              </template>
            </q-select>
          </div>
          <q-space />
          <div class="q-pr-md text-body2">
            1-{{ filteredTableRows.length }} of {{ filteredTableRows.length }}
          </div>
        </div>
      </template>
    </q-table>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";

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
      const tableMode = props.config?.promql_table_mode || "single";
      // Only show legend footer in "single" (timestamp) mode when there are multiple series
      return tableMode === "single" && legendOptions.value.length > 1;
    });

    // Filter rows based on selected legend
    const filteredTableRows = computed(() => {
      if (!selectedLegend.value || selectedLegend.value === "__all__") {
        return tableRows.value;
      }

      const filtered = tableRows.value.filter(
        (row: any) => row.__legend__ === selectedLegend.value,
      );
      console.log(
        `Filtered to legend "${selectedLegend.value}": ${filtered.length} rows`,
      );
      return filtered;
    });

    const pagination = ref({
      rowsPerPage: 0, // 0 = show all rows (like SQL table)
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
      { deep: true, immediate: true },
    );

    return {
      filter,
      loading,
      tableColumns,
      tableRows,
      filteredTableRows,
      pagination,
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
}

.my-sticky-virtscroll-table {
  /* height or max-height is important */
  height: calc(100% - 1px);
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: auto;

  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
    /* bg color is important for th; just specify one */
    background-color: #fff;
  }

  :deep(thead tr th) {
    will-change: auto !important;
    position: sticky;
    z-index: 1;
  }

  /* this will be the loading indicator */
  :deep(thead tr:last-child th) {
    /* height of all previous header rows */
    top: 48px;
  }

  :deep(thead tr:first-child th) {
    top: 0;
  }

  :deep(.q-virtual-scroll) {
    will-change: auto !important;
  }
}

.my-sticky-virtscroll-table.q-dark {
  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
    /* bg color is important for th; just specify one */
    background-color: $dark-page !important;
  }
}
</style>
