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
  <div class="promql-table-chart" style="height: 100%; width: 100%">
    <q-table
      :rows="tableRows"
      :columns="tableColumns"
      :pagination="paginationConfig"
      :filter="filter"
      :loading="loading"
      row-key="id"
      flat
      bordered
      dense
      :style="{ height: '100%' }"
      :virtual-scroll="tableRows.length > 100"
      :rows-per-page-options="[10, 20, 50, 100, 0]"
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

    const paginationConfig = computed(() => {
      const pageSize = props.config.page_size || 10;
      const enabled = props.config.pagination !== false;

      return {
        page: 1,
        rowsPerPage: enabled ? pageSize : 0, // 0 = show all rows
        rowsNumber: tableRows.value.length,
      };
    });

    // Watch for data changes
    watch(
      () => props.data,
      (newData) => {
        console.log("=== [PromQL Table Chart] Data updated ===");
        console.log("New data:", newData);
      },
      { deep: true }
    );

    return {
      filter,
      loading,
      tableColumns,
      tableRows,
      paginationConfig,
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
  }
}
</style>
