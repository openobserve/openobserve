<template>
  <div v-if="!level" class="q-mb-md text-bold">
    {{ selectedPermissionsHash.size }} Permissions
  </div>
  <div class="iam-permissions-table">
    <div :style="{ marginTop: 0 }" class="app-table-container">
      <template v-if="!rows.length">
        <div class="q-py-md text-center text-subtitle">No Data Found</div>
      </template>
      <template v-else>
        <q-table
          flat
          bordered
          ref="qTableRef"
          :rows="rows"
          :columns="(columns as [])"
          :table-colspan="9"
          row-key="index"
          virtual-scroll
          :virtual-scroll-item-size="48"
          :rows-per-page-options="[0]"
          dense
          :hide-header="!!level"
          :filter="filter && filter.value"
          :filter-method="filter && filter.method"
          hide-bottom
          class="full-height"
        >
          <template v-slot:header="props">
            <q-tr :props="props" class="thead-sticky">
              <q-th
                v-for="col in props.cols"
                :key="col.name"
                :props="props"
                :style="col.style"
              >
                {{ col.label }}
              </q-th>
            </q-tr>
          </template>
          <template v-slot:body="props">
            <q-tr :props="props" :key="`m_${props.row.index}`">
              <q-td
                v-for="(col, index) in props.cols"
                :key="col.name"
                :props="props"
                :style="{
                  paddingLeft: level && index === 0 ? level * 36 + 'px' : '',
                }"
              >
                <template
                  v-if="col.name === 'expand' && props.row.has_entities"
                >
                  <q-icon
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
                  v-else-if="
                    col.name !== 'expand' && col.field !== 'permission'
                  "
                >
                  <span
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
              v-show="props.row.expand"
              :props="props"
              :key="`e_${props.row.index + 'entity'}`"
              class="q-virtual-scroll--with-prev"
              style="transition: display 2s ease-in"
            >
              <q-td colspan="100%" style="padding: 0; border-bottom: none">
                <template v-if="props.row.entities">
                  <PermissionsTable
                    :level="level + 1"
                    :rows="props.row.entities"
                    @updated:permission="handlePermissionChange"
                    @expand:row="expandPermission"
                  />
                </template>
              </q-td>
            </q-tr>
          </template>
        </q-table>
      </template>
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
    name: "display_name",
    field: "display_name",
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
