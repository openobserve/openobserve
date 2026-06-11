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
  <div class="tw:mt-4">
    <div class="tags-title tw:font-bold tw:mb-2 tw:ml-1">{{ t("rum.events") }}</div>
    <OTable
      :data="error.events || []"
      :columns="columns || []"
      :default-columns="false"
      row-key="index"
      pagination="none"
      :show-global-filter="false"
      class="tw:w-full"
    >
      <template #cell-type="{ row }">
        <ErrorTypeIcons :column="row" />
      </template>
      <template #cell-description="{ row }">
        <ErrorEventDescription :column="row" />
      </template>
      <template #empty>
        <NoData />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import OTable from "@/lib/core/Table/OTable.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { ref } from "vue";
import ErrorEventDescription from "@/components/rum/errorTracking/view/ErrorEventDescription.vue";
import { formatDate } from "@/utils/date";
import ErrorTypeIcons from "./ErrorTypeIcons.vue";
import { useI18n } from "vue-i18n";

defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const { t } = useI18n();

const columns = ref<OTableColumnDef[]>([
  {
    id: "type",
    header: t("rum.type"),
    accessorKey: "type",
    cell: " ",
    sortable: true,
    size: 50,
    meta: { align: "left", cellClass: "error-type" },
  },
  {
    id: "category",
    header: t("rum.category"),
    accessorFn: (row: any) => getErrorCategory(row),
    sortable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "description",
    header: t("rum.description"),
    accessorKey: "description",
    cell: " ",
    sortable: true,
    size: COL.description,
    meta: { align: "left", cellClass: "description-column", autoWidth: true },
  },
  {
    id: "level",
    header: t("rum.level"),
    accessorFn: (row: any) => (row["type"] === "error" ? "error" : "info"),
    size: COL.status,
    meta: { align: "left", cellClass: "error-level" },
  },
  {
    id: "timestamp",
    header: t("rum.timestamp"),
    accessorFn: (row: any) => getFormattedDate(row["_timestamp"] / 1000),
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
]);

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change"
      ? "Navigation"
      : "Reload";
  else if (row["type"] === "action") return row["action_type"];
  else return row["type"];
};

const getFormattedDate = (timestamp: number) =>
  formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");
</script>

<style scoped>
.tags-title {
  font-size: 16px;
}
</style>

<style>
.description-column {
  max-width: 60vw;
}

.error-level {
  border: 1px solid #e0e0e0;
}
</style>
