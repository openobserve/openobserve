<!-- Copyright 2023 Zinc Labs Inc.

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
    data-test="edit-role-permissions-table-title"
    v-if="!level"
    class="q-mb-md text-bold"
  >
    {{ selectedPermissionsHash.size }} Permissions
  </div>
  <div class="iam-permissions-table">
    <div :style="{ marginTop: 0 }" class="app-table-container">
      <div
        data-test="edit-role-permissions-table-no-permissions-title"
        v-if="!level && !rows.length"
        class="w-full text-center q-mt-lg text-bold text-grey-9"
        style="margin-top: 64px; font-size: 18px"
      >
        <span> No Permissions Selected </span>
      </div>
      <div
        data-test="edit-role-permissions-table-no-resources-title"
        v-if="level && !parent.is_loading && !rows.length"
        class="q-py-sm text-left text-subtitle text-grey-9"
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
        No Resources Present
      </div>
      <div
        data-test="edit-role-permissions-table-loading-resources-loader"
        v-show="parent.expand && parent.is_loading"
        class="flex items-center"
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
        <q-circular-progress
          indeterminate
          rounded
          size="20px"
          color="primary"
          class="q-my-sm q-mx-none q-mr-sm"
        />
        <div>Loading Resources...</div>
      </div>
      <div
        v-if="level && rows.length === 50"
        class="q-py-sm text-left text-grey-10 bg-white relative-position"
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
        Showing <span class="text-bold"> Top 50 </span> resources (Search to get
        specific resource)
      </div>
      <q-virtual-scroll
        data-test="edit-role-permissions-table"
        :id="`permissions-table-${parent.resourceName}`"
        style="max-height: 725px; overflow-x: hidden; overflow-y: auto"
        :style="{
          'max-height': level > 0 ? (level > 1 ? '400px' : '100%') : '100%',
        }"
        :items-size="5"
        :virtual-scroll-item-size="25"
        :virtual-scroll-sticky-size-start="0"
        :virtual-scroll-sticky-size-end="0"
        :virtual-scroll-slice-size="100"
        :virtual-scroll-slice-ratio-before="100"
        type="table"
        :items="rows"
        flat
        bordered
        ref="qTableRef"
        :rows="rows"
        :columns="(columns as [])"
        :table-colspan="9"
        row-key="name"
        dense
        :hide-header="!!level"
        :filter="filter && filter.value"
        :filter-method="filter && filter.method"
        hide-bottom
        class="full-height"
      >
        <template v-slot:header="props">
          <q-tr
            data-test="edit-role-permissions-table-header"
            :props="props"
            class="thead-sticky"
          >
            <q-th
              :data-test="`edit-role-permissions-table-header-column-${col.name}`"
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
          <q-tr v-if="!visibleResourceCount">
            <q-td
              data-test="edit-role-permissions-table-no-permissions-title"
              colspan="100%"
              class="text-center text-bold text-grey-9"
              style="padding-top: 16px; font-size: 16px"
            >
              No Permissions Selected</q-td
            >
          </q-tr>
        </template>

        <template v-slot="{ item: row }">
          <tr v-if="row.show" :key="`m_${row.name}`">
            <td
              v-for="(col, index) in columns"
              :key="col.name"
              :props="props"
              :style="{
                paddingLeft:
                  level && index === 0
                    ? props.row.has_entities
                      ? 16 + level * 20 + 'px'
                      : 16 +
                        (level * 20 - ((level > 1 ? level - 1 : 1) - 1) * 7) +
                        'px'
                    : '',
              }"
            >
              <template v-if="col.name === 'expand' && props.row.has_entities">
                <q-icon
                  :data-test="`edit-role-permissions-table-body-row-${props.row.name}-col-${col.name}-icon`"
                  :name="
                    props.row.expand
                      ? 'keyboard_arrow_up'
                      : 'keyboard_arrow_down'
                  "
                  class="cursor-pointer"
                  :title="t('common.expand')"
                  @click="() => expandPermission(props.row)"
                />
              </template>
              <template v-else-if="col.field === 'permission'">
                <q-checkbox
                  :data-test="`edit-role-permissions-table-body-row-${props.row.name}-col-${col.name}-checkbox`"
                  v-if="props.row.permission[col.name]?.show"
                  size="xs"
                  v-model="props.row.permission[col.name].value"
                  :val="col.name"
                  class="filter-check-box cursor-pointer"
                  @update:model-value="
                    handlePermissionChange(props.row, col.name)
                  "
                />
              </template>
              <template
                v-else-if="col.name !== 'expand' && col.field !== 'permission'"
              >
                <span
                  :data-test="`edit-role-permissions-table-body-row-${props.row.name}-col-${col.name}-text`"
                  :title="
                    JSON.stringify({
                      name: props.row.name,
                      label: props.row.display_name,
                    })
                  "
                >
                  {{ col.value }}</span
                >
              </template>
            </q-td>
          </q-tr>
          <q-tr
            v-show="props.row.expand && props.row.show"
            :props="props"
            :key="`e_${row.name + 'entity'}`"
            class="q-virtual-scroll--with-prev"
            style="transition: display 2s ease-in"
          >
            <q-td colspan="100%" style="padding: 0; border-bottom: none">
              <template v-if="props.row.entities">
                <PermissionsTable
                  :level="level + 1"
                  :rows="row.entities"
                  :customFilteredPermissions="customFilteredPermissions"
                  :parent="row"
                  @updated:permission="handlePermissionChange"
                  @expand:row="expandPermission"
                />
              </template>
            </q-td>
          </q-tr>
        </template>
      </q-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineEmits } from "vue";
import { useI18n } from "vue-i18n";

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
});

const emits = defineEmits(["updated:permission", "expand:row"]);

const { t } = useI18n();

const columns: any = [
  {
    name: "expand",
    label: "",
    field: "expand",
    align: "center",
    slot: true,
    slotName: "expand",
    style: "width: 37px",
  },
  {
    name: "display_name",
    field: "display_name",
    label: t("common.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "type",
    field: "type",
    label: t("iam.object"),
    align: "left",
    style: "width: 100px",
  },
  {
    name: "AllowAll",
    field: "permission",
    label: t("iam.all"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowList",
    field: "permission",
    label: t("iam.list"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowGet",
    field: "permission",
    label: t("iam.get"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowDelete",
    field: "permission",
    label: t("iam.delete"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowPost",
    field: "permission",
    label: t("iam.create"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowPut",
    field: "permission",
    label: t("iam.update"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
];

const expandPermission = async (resource: any) => {
  emits("expand:row", resource);
};

const handlePermissionChange = (row: any, permission: string) => {
  emits("updated:permission", row, permission);
};
</script>

<style scoped></style>
<style lang="scss">
.iam-permissions-table {
  .q-table--bordered {
    border: none;
  }
}
</style>
