<template>
  <div>
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ t("iam.groups") }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div class="q-mt-lg q-px-md">
      <div class="flex justify-end q-mb-sm">
        <q-btn
          data-test="alert-list-add-alert-btn"
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`iam.addGroup`)"
          @click="addGroup"
        />
      </div>
      <app-table :rows="rows" :columns="columns" pagination :rows-per-page="20">
        <template v-slot:actions>
          <div>
            <q-icon
              size="14px"
              name="edit"
              class="cursor-pointer q-mr-md"
              :title="t('common.edit')"
            />
            <q-icon
              size="14px"
              name="delete"
              class="cursor-pointer"
              :title="t('common.delete')"
            />
          </div>
        </template>
      </app-table>
    </div>

    <q-dialog v-model="showAddGroup" position="right" full-height maximized>
      <AddGroup style="width: 30vw" />
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import AddGroup from "./AddGroup.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";

const showAddGroup = ref(false);

const { t } = useI18n();

const rows: any = ref([]);

const columns: any = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
  },
  {
    name: "group_name",
    field: "group_name",
    label: t("iam.groupName"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "right",
    sortable: false,
    slot: true,
    slotName: "actions",
  },
];

const groups = ref([
  {
    group_name: "developers",
    users: [],
    roles: {
      name: "devRole",
      permissions: [
        {
          object: "stream:default",
          permission: "create",
        },
      ],
    },
  },
  {
    group_name: "developers",
    users: [],
    roles: {
      name: "devRole",
      permissions: [
        {
          object: "stream:default",
          permission: "create",
        },
      ],
    },
  },
  {
    group_name: "developers",
    users: [],
    roles: {
      name: "devRole",
      permissions: [
        {
          object: "stream:default",
          permission: "create",
        },
      ],
    },
  },
]);

const updateTable = () => {
  rows.value = cloneDeep(
    groups.value.map((group, index) => ({ ...group, "#": index + 1 }))
  );
};

const addGroup = () => {
  showAddGroup.value = true;
};

updateTable();
</script>

<style scoped></style>
