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
  <div class="sessions_page">
    <SearchBar></SearchBar>
    <q-splitter
      class="logs-horizontal-splitter full-height"
      v-model="splitterModel"
      unit="px"
      vertical
    >
      <template #before>
        <IndexList></IndexList>
      </template>
      <template #separator>
        <q-avatar
          color="primary"
          text-color="white"
          size="1.25rem"
          icon="drag_indicator"
          class="tw:top-[0.625rem]"
        />
      </template>
      <template #after>
        <OTable
          :data="tableRows"
          :columns="tableColumns"
          row-key="id"
          pagination="none"
          virtual-scroll
          dense
          data-test="rum-errors-list-table"
        >
          <template #cell-error="{ row }">
            <ErrorDetail :column="row" />
          </template>
        </OTable>
      </template>
    </q-splitter>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { formatDuration } from "@/utils/zincutils";
import SearchBar from "./SearchBar.vue";
import IndexList from "@/plugins/traces/IndexList.vue";
import ErrorDetail from "./ErrorDetail.vue";

interface Session {
  timestamp: string;
  type: string;
  time_spent: string;
  error_count: string;
  initial_view_name: string;
  id: string;
}

const { t } = useI18n();

const splitterModel = ref(250);
const tableColumns = [
  {
    id: "error",
    header: t("rum.error"),
    accessorKey: "error",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("rum.sessionType"),
    accessorKey: "type",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "time_spent",
    header: t("rum.timeSpent"),
    accessorFn: (row: any) => formatDuration(row["time_spent"] / 1000000),
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "error_count",
    header: t("rum.errorCount"),
    accessorKey: "error_count",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "initial_view_name",
    header: t("rum.initialViewName"),
    accessorKey: "initial_view_name",
    sortable: true,
    meta: { align: "left" },
  },
];

const rows = ref<Session[]>([]);

const tableRows = computed(() => rows.value);
</script>

<style lang="scss">
.sessions_page {
  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 0.75rem !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .q-item__label span {
    /* text-transform: capitalize; */
  }

  .index-table :hover::-webkit-scrollbar,
  #tracesSearchGridComponent:hover::-webkit-scrollbar {
    height: 0.8125rem;
    width: 0.8125rem;
  }

  .index-table ::-webkit-scrollbar-track,
  #tracesSearchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 0.625rem;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #tracesSearchGridComponent::-webkit-scrollbar-thumb {
    border-radius: 0.625rem;
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .q-table__top {
    padding: 0 !important;
  }

  .q-table__control {
    width: 100%;
  }

  .q-field__control-container {
    padding-top: 0 !important;
  }
}
</style>
