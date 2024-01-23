<template>
  <div class="q-px-md">
    <div class="flex justify-between q-pt-sm">
      <div style="font-size: 16px" class="q-pl-xs q-py-md text-bold">
        Roles {{ rows.length }}
      </div>
      <q-btn
        data-test="add-alert-submit-btn"
        label="Add Roles"
        class="q-mb-md text-bold no-border q-mr-sm"
        color="secondary"
        size="md"
        no-caps
        @click="showAddRoles = true"
      />
    </div>
    <div class="flex bordered q-mb-sm">
      <div class="o2-input" style="width: 500px">
        <q-input
          data-test="alert-list-search-input"
          v-model="roleSearchKey"
          borderless
          filled
          dense
          class="q-ml-auto q-mb-xs no-border"
          :placeholder="t('alerts.search')"
        >
          <template #prepend>
            <q-icon name="search" class="cursor-pointer" />
          </template>
        </q-input>
      </div>
    </div>
    <template v-if="rows.length">
      <app-table :rows="rows" :columns="columns">
        <template v-slot:select="slotProps">
          <q-checkbox
            size="xs"
            v-model="rolesToRemove"
            :val="slotProps.column.row.role_name"
            class="filter-check-box cursor-pointer"
          />
        </template>
      </app-table>
    </template>
    <div v-if="!rows.length" class="q-mt-md text-bold q-pl-md">
      No roles selected
    </div>
  </div>
  <q-dialog v-model="showAddRoles" position="right" full-height maximized>
    <div class="col q-pl-xs bg-white" style="width: 60vw">
      <div style="font-size: 16px" class="q-py-md q-pl-xs text-bold">Roles</div>
      <div class="flex justify-between bordered q-pb-sm">
        <div class="o2-input" style="width: 300px">
          <q-input
            data-test="alert-list-search-input"
            v-model="userSearchKey"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            placeholder="Search"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
        </div>
        <q-btn
          data-test="add-alert-submit-btn"
          label="Add"
          class="q-mb-md text-bold no-border q-mr-sm"
          color="secondary"
          size="md"
          :disable="!rolesToAdd.length"
          no-caps
        />
      </div>
      <template v-if="rows.length">
        <app-table :rows="roles" :columns="columns">
          <template v-slot:select="slotProps">
            <q-checkbox
              size="xs"
              v-model="rolesToAdd"
              :val="slotProps.column.row.email"
              class="filter-check-box cursor-pointer"
            />
          </template>
        </app-table>
      </template>
      <div v-if="!rows.length" class="q-mt-md text-bold q-pl-md">
        No roles added
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const roleSearchKey = ref("");

const columns = [
  {
    name: "select",
    field: "",
    label: "",
    align: "left",
    slot: true,
    slotName: "select",
  },
  {
    name: "role_name",
    field: "role_name",
    label: "Role Name",
    align: "left",
    sortable: true,
  },
];
const rolesToRemove = ref([]);

const showAddRoles = ref(false);

const rolesToAdd = ref([]);

const rows = ref([
  {
    "#": 1,
    role_name: "explore_logs1",
  },
  {
    "#": 2,
    role_name: "explore_logs3",
  },
]);

const roles = ref([
  {
    "#": 1,
    role_name: "explore_logs1",
  },
  {
    "#": 2,
    role_name: "explore_logs3",
  },
  {
    "#": 3,
    role_name: "view_dashboard1",
  },
  {
    "#": 4,
    role_name: "edit_dashboard",
  },
  {
    "#": 5,
    role_name: "edit_dashboard2",
  },
]);
</script>

<style scoped></style>
