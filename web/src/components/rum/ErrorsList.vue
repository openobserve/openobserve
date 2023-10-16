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
          size="20px"
          icon="drag_indicator"
          style="top: 10px"
        />
      </template>
      <template #after>
        <AppTable :columns="columns" :rows="rows">
          <template v-slot:error_details="slotProps">
            <ErrorDetail :column="slotProps"></ErrorDetail>
          </template>
        </AppTable>
      </template>
    </q-splitter>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import AppTable from "./AppTable.vue";
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
const columns = ref([
  {
    name: "error",
    field: (row: any) => row["error"],
    prop: (row: any) => row["error"],
    label: "Error",
    align: "left",
    sortable: true,
    slot: true,
    slotName: "error_details",
  },
  {
    name: "type",
    field: (row: any) => row["type"],
    prop: (row: any) => row["type"],
    label: "Session Type",
    align: "left",
    sortable: true,
  },
  {
    name: "time_spent",
    field: (row: any) => formatDuration(row["time_spent"] / 1000000),
    label: "Time Spent",
    align: "left",
    sortable: true,
    sort: (a: any, b: any, rowA: Session, rowB: Session) => {
      return parseInt(rowA.time_spent) - parseInt(rowB.time_spent);
    },
  },
  {
    name: "error_count",
    field: (row: any) => row["error_count"],
    prop: (row: any) => row["error_count"],
    label: "Error Count",
    align: "left",
    sortable: true,
  },
  {
    name: "initial_view_name",
    field: (row: any) => row["initial_view_name"],
    prop: (row: any) => row["initial_view_name"],
    label: "Intital View Name",
    align: "left",
    sortable: true,
  },
]);

const rows = ref<Session[]>([]);
</script>

<style>
.sessions_page {
  .index-menu .field_list .field_overlay .field_label,
  .q-field__native,
  .q-field__input,
  .q-table tbody td {
    font-size: 12px !important;
  }

  .q-splitter__after {
    overflow: hidden;
  }

  .q-item__label span {
    /* text-transform: capitalize; */
  }

  .index-table :hover::-webkit-scrollbar,
  #tracesSearchGridComponent:hover::-webkit-scrollbar {
    height: 13px;
    width: 13px;
  }

  .index-table ::-webkit-scrollbar-track,
  #tracesSearchGridComponent::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .index-table ::-webkit-scrollbar-thumb,
  #tracesSearchGridComponent::-webkit-scrollbar-thumb {
    border-radius: 10px;
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
  }

  .q-table__top {
    padding: 0px !important;
  }

  .q-table__control {
    width: 100%;
  }

  .q-field__control-container {
    padding-top: 0px !important;
  }
}
</style>
