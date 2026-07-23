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
  <div class="relative flex h-full w-full flex-col" data-test="promql-table-chart">
    <div class="relative h-full">
      <TableRenderer
        ref="innerTableRef"
        :data="{ rows: filteredTableRows, columns: tableColumns }"
        :wrap-cells="panelConfig.wrap_table_cells"
        :value-mapping="panelConfig.mappings ?? []"
        :show-pagination="panelConfig.table_pagination && !store.state.printMode"
        :rows-per-page="panelConfig.table_pagination_rows_per_page"
        :enable-filtering="enableFiltering"
        @row-click="$emit('row-click', $event)"
      >
        <!-- Override bottom slot to add legend filter alongside native pagination -->
        <!-- When legend footer is not shown, TableRenderer's default pagination will be used -->
        <template #bottom="scope" v-if="showLegendFooter">
          <div class="flex w-full items-center" data-test="dashboard-table-pagination">
            <div class="flex items-center gap-1">
              <OSelect
                class="max-w-100 min-w-50"
                v-model="selectedLegend"
                :options="legendOptions"
                :placeholder="t('dashboard.promQLTableChart.selectSeriesToFilter')"
              >
                <template #icon-left>
                  <OIcon name="filter-list" size="xs" />
                </template>
              </OSelect>
            </div>
            <div class="flex-1" />
            <TablePaginationControls
              :show-pagination="panelConfig.table_pagination && !store.state.printMode"
              :pagination="scope.pagination"
              :pagination-options="scope.paginationOptions"
              :total-rows="scope.totalRows"
              :pages-number="scope.pagesNumber"
              :is-first-page="scope.isFirstPage"
              :is-last-page="scope.isLastPage"
              @update:rows-per-page="scope.setRowsPerPage"
              @first-page="scope.firstPage"
              @prev-page="scope.prevPage"
              @next-page="scope.nextPage"
              @last-page="scope.lastPage"
            />
          </div>
        </template>
      </TableRenderer>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import TableRenderer from "./TableRenderer.vue";
import TablePaginationControls from "../addPanel/TablePaginationControls.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
    enableFiltering: {
      type: Boolean,
      default: false,
    },
  },
  components: { TableRenderer, TablePaginationControls, OSelect, OIcon },
  setup(props) {
    const store = useStore();
    const { t } = useI18n();
    const filter = ref("");
    const loading = ref(false);
    const innerTableRef = ref<any>(null);

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
      // Add unique ID to each row for the table
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
        options.push({ label: t("dashboard.promQLTableChart.allSeries"), value: "__all__" });
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
      // Show legend footer in both "single" and "expanded_timeseries" modes
      return tableMode === "single" || tableMode === "expanded_timeseries";
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

    // Note: paginationOptions is now provided by TableRenderer's slot
    // and accessible via scope.paginationOptions in the template
    // This avoids code duplication

    const pagination = ref({
      rowsPerPage: 0, // 0 = show all rows (like SQL table)
    });

    // Watch for data changes and set default legend only if not already set or legend options changed
    watch(
      () => props.data,
      () => {
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
    const panelConfig = computed(() => props.config || {});

    const downloadTableAsCSV = (title?: string) => {
      innerTableRef.value?.downloadTableAsCSV(title);
    };

    const downloadTableAsJSON = (title?: string) => {
      innerTableRef.value?.downloadTableAsJSON(title);
    };

    return {
      t,
      filter,
      store,
      loading,
      innerTableRef,
      tableColumns,
      tableRows,
      filteredTableRows,
      pagination,
      selectedLegend,
      legendOptions,
      showLegendFooter,
      panelConfig,
      downloadTableAsCSV,
      downloadTableAsJSON,
    };
  },
});
</script>
