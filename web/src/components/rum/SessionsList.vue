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
    <OSplitter
      class="logs-horizontal-splitter full-height"
      v-model="splitterModel"
      unit="px"
      :horizontal="true"
    >
      <template #before>
        <SearchFieldList></SearchFieldList>
      </template>
      <template #after>
        <OTable
          :data="tableRows"
          :columns="tableColumns"
          :default-columns="false"
          row-key="id"
          pagination="none"
          virtual-scroll
          dense
          data-test="rum-sessions-list-table"
          @row-click="handleRowClick"
        >
          <template #cell-action_play="{ row }">
            <OIcon
              name="play-circle-filled"
              size="md"
              class="cursor-pointer text-[var(--o2-icon-color)] hover:text-[var(--o2-primary-btn-bg)]"
            />
          </template>
        </OTable>
      </template>
    </OSplitter>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { formatDuration } from "@/utils/zincutils";
import SearchBar from "./SearchBar.vue";
import SearchFieldList from "@/components/common/sidebar/SearchFieldList.vue";
import { useRouter } from "vue-router";

interface SessionColumn {
  name: string;
  field: (row: any) => any;
  prop: (row: any) => any;
  label: string;
  align: string;
  sortable: boolean;
}

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
    id: "action_play",
    header: "",
    accessorKey: "action_play",
    sortable: false,
    size: 56,
    meta: { align: "left" },
  },
  {
    id: "timestamp",
    header: t("rum.timestamp"),
    accessorKey: "timestamp",
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("rum.sessionType"),
    accessorKey: "type",
    sortable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "time_spent",
    header: t("rum.timeSpent"),
    accessorFn: (row: any) => formatDuration(row["time_spent"] / 1000000),
    sortable: true,
    size: COL.duration,
    meta: { align: "left" },
  },
  {
    id: "error_count",
    header: t("rum.errorCount"),
    accessorKey: "error_count",
    sortable: true,
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "initial_view_name",
    header: t("rum.initialViewName"),
    accessorKey: "initial_view_name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
];

const rows = ref<Session[]>([]);

const tableRows = computed(() => rows.value);

const router = useRouter();

const handleRowClick = (row: any) => {
  handleCellClick({ row });
};

const handleCellClick = (payload: any) => {
  router.push({
    name: "SessionViewer",
    params: { id: payload.row.id },
  });
};
</script>

<style>
.sessions_page .index-table :hover::-webkit-scrollbar,
#tracesSearchGridComponent:hover::-webkit-scrollbar {
  height: 0.8125rem;
  width: 0.8125rem;
}

.sessions_page .index-table ::-webkit-scrollbar-track,
#tracesSearchGridComponent::-webkit-scrollbar-track {
  -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3);
  border-radius: 0.625rem;
}

.sessions_page .index-table ::-webkit-scrollbar-thumb,
#tracesSearchGridComponent::-webkit-scrollbar-thumb {
  border-radius: 0.625rem;
  -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.5);
}
</style>
