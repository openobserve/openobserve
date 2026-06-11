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

  <div
    :data-test="`iam-${
      parent ? parent.name : 'main'
    }-permissions-table-section`"
    class="iam-permissions-table"
  >
    <div :style="{ marginTop: 0 }" class="app-table-container">
      <div
        data-test="edit-role-permissions-table-no-permissions-title"
        v-if="!level && !rows.length && !loading"
        class="tw:w-full tw:text-center tw:mt-4 tw:font-bold tw:text-gray-600"
        style="margin-top: 64px; font-size: 18px"
      >
        <span> No Permissions Selected </span>
      </div>
      <div
        data-test="edit-role-permissions-table-loading-resources-loader"
        v-show="parent.expand && parent.is_loading"
        class="tw:flex tw:items-center"
        :style="{
          paddingLeft: level
            ? parent.has_entities
              ? 16 + 8 + level * 20 + 'px'
              : 16 +
                8 +
                (level * 20 - ((level > 1 ? level - 1 : 1) - 1) * 7) +
                'px'
            : '',
        }"
      >
        <OSpinner size="xs" class="tw:my-2 tw:mx-0 tw:mr-2" />
        <div>Loading Resources...</div>
      </div>
      <div
        v-if="level && getFilteredRows.length === 50"
        class="tw:py-2 tw:text-left tw:text-gray-700 tw:bg-white tw:relative"
        :style="{
          paddingLeft: level
            ? parent.has_entities
              ? 16 + 8 + level * 20 + 'px'
              : 16 +
                8 +
                (level * 20 - ((level > 1 ? level - 1 : 1) - 1) * 7) +
                'px'
            : '',
        }"
      >
        Showing <span class="tw:font-bold"> Top 50 </span> resources (Search to get
        specific resource)
      </div>
      <div
        :data-test="`edit-role-${parent ? parent.name : 'main'}-permissions-table`"
        :id="`permissions-table-${parent.resourceName}`"
        :class="level > 0 ? 'tw:overflow-y-auto tw:overflow-x-hidden' : ''"
        :style="{
          maxHeight: level > 0 ? '400px' : undefined,
        }"
      >
        <OTable
          ref="permissionsTableRef"
          :data="getFilteredRows"
          :columns="columns"
          row-key="name"
          :global-filter="filter?.value ?? ''"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          dense
          pagination="none"
          :virtual-scroll="false"
          expansion="multiple"
          :expanded-ids="expandedRowIds"
          :show-header="level === 0"
          :loading="level === 0 && props.loading"
          :get-row-expansion-enabled="(row: any) => !!row.has_entities"
          @update:expanded-ids="handleOTableExpansionChange"
        >
          <template #cell-display_name="{ row }">
            <span :style="{ paddingLeft: level > 0 ? `${level * 20}px` : undefined }">{{ row.display_name }}</span>
          </template>
          <template v-for="col in permissionColumnIds" :key="col" #[`cell-${col}`]="{ row }">
            <OCheckbox
              v-if="row.permission?.[col]?.show"
              :data-test="`edit-role-permissions-table-body-row-${row.name}-col-${col}-checkbox`"
              v-model="row.permission[col].value"
              :value="col"
              class="filter-check-box tw:cursor-pointer"
              @update:model-value="handlePermissionChange(row, col)"
            />
          </template>
          <template #expansion="{ row }">
            <template v-if="row.entities">
              <PermissionsTable
                :level="level + 1"
                :rows="row.entities"
                :customFilteredPermissions="customFilteredPermissions"
                :parent="row"
                @updated:permission="handlePermissionChange"
                @updated:permission-batch="(changes: any) => emits('updated:permission-batch', changes)"
                @expand:row="expandPermission"
              />
            </template>
          </template>
          <template #empty>
            <div v-if="level === 0" class="tw:py-16 tw:flex tw:justify-center tw:items-center">
              <NoData :filtered="!!filter" @action="emits('update:filter', '')" />
            </div>
            <div
              v-else
              data-test="edit-role-permissions-table-no-resources-title"
              class="tw:py-2 tw:px-4 tw:text-sm tw:text-text-secondary"
            >
              No Resources Present
            </div>
          </template>
        </OTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, h } from "vue";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import NoData from "@/components/shared/grid/NoData.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
const props = defineProps({
  selectedPermissionsHash: {
    type: Set,
    default: () => new Set(),
  },
  rows: {
    type: Array,
    default: () => [],
  },
  filter: {
    type: Object,
    default: () => ({}),
  },
  level: {
    type: Number,
    default: 0,
  },
  visibleResourceCount: {
    type: Number,
    default: 0,
  },
  parent: {
    type: Object,
    default: () => ({}),
  },
  customFilteredPermissions: {
    type: Object,
    default: () => ({}),
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emits = defineEmits(["updated:permission", "updated:permission-batch", "expand:row", "update:filter"]);

const { t } = useI18n();

const permissionsTableRef: any = ref(null);

const permissionColumnIds = computed(() =>
  columns.value
    .filter((c) => c.id.startsWith("Allow"))
    .map((c) => c.id),
);

const expandedRowIds = ref<string[]>([]);


function handleOTableExpansionChange(ids: string[]) {
  const newlyExpanded = ids.filter((id) => !expandedRowIds.value.includes(id));
  expandedRowIds.value = ids;
  newlyExpanded.forEach((id) => {
    const row = props.rows.find((r: any) => r.name === id);
    if (row) emits("expand:row", row);
  });
}

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "display_name",
    header: t("quota.moduleName"),
    accessorKey: "display_name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "type",
    header: t("iam.object"),
    accessorKey: "type",
    sortable: true,
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "AllowAll",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowAll'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowAll'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.all')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "left" },
  },
  {
    id: "AllowList",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowList'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowList'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.list')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "left" },
  },
  {
    id: "AllowGet",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowGet'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowGet'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.get')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 72,
    minSize: 60,
    maxSize: 84,
    meta: { align: "left" },
  },
  {
    id: "AllowPost",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5 tw:whitespace-nowrap' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowPost'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowPost'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.create')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 90,
    minSize: 82,
    maxSize: 104,
    meta: { align: "left" },
  },
  {
    id: "AllowPut",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5 tw:whitespace-nowrap' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowPut'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowPut'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.update')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 90,
    minSize: 82,
    maxSize: 104,
    meta: { align: "left" },
  },
  {
    id: "AllowDelete",
    header: () => h('div', { class: 'tw:flex tw:items-center tw:gap-1.5 tw:whitespace-nowrap' }, [
      h(OCheckbox, { 'modelValue': getHeaderCheckboxState('AllowDelete'), 'indeterminateValue': 'indeterminate', 'onUpdate:modelValue': () => toggleColumnAll('AllowDelete'), class: 'filter-check-box cursor-pointer' }),
      h('span', {}, t('iam.delete')),
    ]),
    accessorKey: "permission",
    cell: (info: any) => info.getValue(),
    size: 90,
    minSize: 82,
    maxSize: 104,
    meta: { align: "left" },
  },
]);

// Only top-level "Type" rows are toggled by the header checkbox.
// Child/nested rows inherit permissions through their parent type row,
// so toggling them individually here is not needed.
const getTopLevelTypeRows = computed(() => {
  return props.rows.filter(
    (row: any) => row?.show && row.type === "Type"
  );
});

const getHeaderCheckboxState = (colName: string) => {
  const visibleRows = getTopLevelTypeRows.value.filter(
    (row: any) => row.permission?.[colName]?.show
  );
  if (!visibleRows.length) return false;
  const checkedCount = visibleRows.filter(
    (row: any) => row.permission[colName].value
  ).length;
  if (checkedCount === 0) return false;
  if (checkedCount === visibleRows.length) return true;
  return "indeterminate";
};

const toggleColumnAll = (colName: string) => {
  const visibleRows = getTopLevelTypeRows.value.filter(
    (row: any) => row.permission?.[colName]?.show
  );
  const allChecked = visibleRows.every(
    (row: any) => row.permission[colName].value
  );
  const newValue = !allChecked;
  const changedRows = visibleRows
    .filter((row: any) => row.permission[colName].value !== newValue)
    .map((row: any) => ({ row, permission: colName, newValue }));

  if (changedRows.length) {
    emits("updated:permission-batch", changedRows);
  }
};

const expandPermission = async (resource: any) => {
  emits("expand:row", resource);
};

const handlePermissionChange = (row: any, permission: string) => {
  emits("updated:permission", row, permission);
};

const getFilteredRows = computed(() => {
  return props.rows.filter((row: any) => row?.show);
})
defineExpose({
  permissionsTableRef,
});
</script>

<style scoped></style>
<style lang="scss">
.iam-permissions-table {
  th{
    height: 48px !important;
  }
}
</style>
