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
  <div :style="{ height: resource.expand ? '100%' : '0px', transition: 'height 0.3s ease-in' }">
    <OTable
      :data="rows"
      :columns="columns"
      row-key="name"
      :global-filter="searchKey"
      filter-mode="client"
      :default-columns="false"
      :show-global-filter="false"
      dense
      :bordered="false"
    >
      <template v-for="col in permissionColumnIds" :key="col" #[`cell-${col}`]="{ row }">
        <OCheckbox
          v-show="row.permission[col]?.show"
          v-model="row.permission[col].value"
          :value="col"
          class="filter-check-box cursor-pointer"
          @click="handlePermissionChange(row, col)"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import usePermissions from "@/composables/iam/usePermissions";
import type { Entity } from "@/ts/interfaces";
import { watch } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const props = defineProps({
  resource: {
    type: Object,
    default: () => {},
  },
  showSelected: {
    type: Boolean,
    default: false,
  },
  searchKey: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["updated:permission"]);

const { t } = useI18n();

const rows: any = ref([]);

const { permissionsState } = usePermissions();

const permissionColumnIds = computed(() =>
  columns.value
    .filter((c) => c.id.startsWith("Allow"))
    .map((c) => c.id),
);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "expand",
    header: "",
    accessorKey: "expand",
    cell: (info: any) => info.getValue(),
    size: 36,
    minSize: 32,
    maxSize: 40,
    meta: { align: "center", compactPadding: true },
  },
  {
    id: "name",
    header: t("iam.entityName"),
    accessorKey: "name",
    sortable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "type",
    header: t("common.type"),
    accessorKey: "type",
    sortable: true,
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "AllowAll",
    header: t("iam.all"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
  {
    id: "AllowList",
    header: t("iam.list"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
  {
    id: "AllowGet",
    header: t("iam.get"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
  {
    id: "AllowDelete",
    header: t("iam.delete"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
  {
    id: "AllowPost",
    header: t("iam.create"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
  {
    id: "AllowPut",
    header: t("iam.update"),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "center" },
  },
]);

const getResourceEntities = () => {
  return props.resource.entities;
};

const updateTableData = () => {
  if (!props.showSelected) {
    rows.value = getResourceEntities();
  } else {
    rows.value = getResourceEntities().filter((entity: Entity) => {
      const showEntity = Object.values(entity.permission).some(
        (permission: any) => permission.value,
      );

      return showEntity;
    });
  }
};

const handlePermissionChange = (row: Entity, permission: string) => {
  emits("updated:permission", row, permission);
};

watch(
  () => props.resource.expand,
  (val) => {
    if (val) updateTableData();
  },
  {
    immediate: true,
  },
);

</script>

<style scoped></style>
