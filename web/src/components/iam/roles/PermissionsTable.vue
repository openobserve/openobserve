<template>
  <div v-if="!level" class="q-mb-md text-bold">
    {{ rows.length }} Permissions
  </div>
  <div class="iam-permissions-table">
    <AppTable
      :rows="rows"
      :columns="columns"
      :dense="true"
      class="q-mt-sm"
      :filter="{
        value: filter.searchKey,
        method: filterResources,
      }"
      :hide-header="!!level"
    >
      <template v-slot:expand="slotProps">
        <q-icon
          :name="
            slotProps.column.row.expand
              ? 'keyboard_arrow_up'
              : 'keyboard_arrow_down'
          "
          class="cursor-pointer"
          :title="t('common.expand')"
          @click="() => expandPermission(slotProps.column.row)"
        />
      </template>

      <template v-slot:permission="slotProps">
        <q-checkbox
          size="xs"
          v-model="slotProps.column.row.permission[slotProps.columnName]"
          :val="slotProps.columnName"
          class="filter-check-box cursor-pointer"
          @update:model-value="
            handlePermissionChange(slotProps.column.row, slotProps.columnName)
          "
        />
      </template>

      <template v-slot:resource_table="slotProps">
        <permissions-table
          ref="permissionTableRef"
          :rows="slotProps.row.row.childs"
          :level="level + 1"
          @updated:permission="handlePermissionChange"
          @expand:row="expandPermission"
        />
      </template>

      <template v-slot:entity_table="slotProps">
        <entity-permission-table
          :entity="slotProps.row.row"
          :show-selected="filter.permissions === 'selected'"
          :searchKey="filter.searchKey"
          @updated:permission="handlePermissionChange"
        />
      </template>
    </AppTable>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, defineEmits, computed } from "vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import EntityPermissionTable from "@/components/iam/roles/EntityPermissionTable.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { useStore } from "vuex";

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
    style: "width: 45px",
  },
  {
    name: "name",
    field: "name",
    label: t("common.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "type",
    field: "type",
    label: t("common.type"),
    align: "left",
    style: "width: 100px",
  },
  {
    name: "resourceName",
    field: "resourceName",
    label: t("iam.resourceName"),
    align: "left",
    style: "width: 200px",
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

const filterResources = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    let isAdded = false;
    if (rows[i]["name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
      isAdded = true;
      continue;
    }
    for (var j = 0; j < rows[i].entities.length; j++) {
      if (
        !isAdded &&
        rows[i].entities[j]["name"].toLowerCase().includes(terms)
      ) {
        filtered.push(rows[i]);
        break;
      }
    }
  }
  return filtered;
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
