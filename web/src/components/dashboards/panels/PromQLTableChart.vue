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
    <div style="height: 100%; position: relative">
      <TableRenderer
        :data="{ rows: filteredTableRows, columns: tableColumns }"
        :wrap-cells="config.wrap_table_cells"
        :value-mapping="config.mappings ?? []"
        @row-click="$emit('row-click', $event)"
      >
        <template #bottom v-if="showLegendFooter">
          <div class="row items-center full-width" style="width: 100%">
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
      </TableRenderer>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import TableRenderer from "./TableRenderer.vue";

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
  components: { TableRenderer },
  setup(props) {
    const filter = ref("");
    const loading = ref(false);

    // Extract columns and rows from processed data
    const tableColumns = computed(() => {
      if (!props.data?.columns) {
        console.warn("No columns found in table data");
        return [];
      }
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
      return options;
    });

    // Determine if legend footer should be shown
    const showLegendFooter = computed(() => {
      const tableMode = props.config?.promql_table_mode || "single";
      // Show legend footer in both "single" and "expanded_timeseries" modes when there are multiple series
      return (
        (tableMode === "single" || tableMode === "expanded_timeseries") &&
        legendOptions.value.length > 1
      );
    });

    // Filter rows based on selected legend
    const filteredTableRows = computed(() => {
      const tableMode = props.config?.promql_table_mode || "single";

      // In "all" (Aggregate) mode, never filter by legend - show all rows
      if (tableMode === "all") {
        return tableRows.value;
      }

      // In time series modes, filter by selected legend
      if (!selectedLegend.value || selectedLegend.value === "__all__") {
        return tableRows.value;
      }

      const filtered = tableRows.value.filter(
        (row: any) => row.__legend__ === selectedLegend.value,
      );
      return filtered;
    });

    const pagination = ref({
      rowsPerPage: 0, // 0 = show all rows (like SQL table)
    });

    // Watch for data changes and set default legend only if not already set or legend options changed
    watch(
      () => props.data,
      (newData) => {
        // Only set default legend if no legend is selected yet or if current selection is invalid
        if (legendOptions.value.length > 0) {
          const currentSelectionValid = legendOptions.value.some(
            (opt) => opt.value === selectedLegend.value,
          );

          // Only reset if no selection exists or current selection is invalid
          if (!selectedLegend.value || !currentSelectionValid) {
            const tableMode = props.config?.promql_table_mode || "single";

            if (tableMode === "all") {
              // In "all" mode, default to "All series"
              selectedLegend.value = "__all__";
            } else {
              // In "single" or "expanded_timeseries" mode, select first series
              selectedLegend.value = legendOptions.value[0]?.value || "";
            }
          }
        }
      },
      { deep: true, immediate: true },
    );

    // Make config reactive to prop changes
    const config = computed(() => props.config || {});

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
      config,
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

  // Sticky columns (horizontal scroll)
  :deep(thead tr th.sticky-column),
  :deep(tbody tr td.sticky-column) {
    position: sticky !important;
    left: 0 !important;
    z-index: 2;
    background-color: #fff !important;
    box-shadow: 2px 0 4px rgba(0, 0, 0, 0.1);
  }

  :deep(thead tr th.sticky-column) {
    z-index: 3 !important; // Headers need higher z-index
  }

  // Support for multiple sticky columns - each subsequent column should be offset
  :deep(thead tr th.sticky-column:nth-child(2)),
  :deep(tbody tr td.sticky-column:nth-child(2)) {
    left: var(--sticky-col-1-width, 150px) !important;
  }

  :deep(thead tr th.sticky-column:nth-child(3)),
  :deep(tbody tr td.sticky-column:nth-child(3)) {
    left: calc(
      var(--sticky-col-1-width, 150px) + var(--sticky-col-2-width, 150px)
    ) !important;
  }
}

.my-sticky-virtscroll-table.q-dark {
  :deep(.q-table__top),
  :deep(.q-table__bottom),
  :deep(thead tr:first-child th) {
    /* bg color is important for th; just specify one */
    background-color: $dark-page !important;
  }

  // Sticky columns in dark mode
  :deep(thead tr th.sticky-column),
  :deep(tbody tr td.sticky-column) {
    background-color: $dark-page !important;
  }
}
</style>
