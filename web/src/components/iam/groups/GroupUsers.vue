<template>
  <div class="q-px-md row">
    <div class="col q-pr-xs">
      <div style="font-size: 16px" class="q-py-md q-pl-xs text-bold">
        Users in this group ({{ rows.length }})
      </div>
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
          label="Remove"
          class="q-mb-md text-bold no-border q-mr-sm"
          color="secondary"
          size="md"
          :disable="!usersToRemove.length"
          no-caps
        />
      </div>
      <template v-if="rows.length">
        <app-table :rows="rows" :columns="columns">
          <template v-slot:select="slotProps">
            <q-checkbox
              size="xs"
              v-model="usersToRemove"
              :val="slotProps.column.row.email"
              class="filter-check-box cursor-pointer"
            />
          </template>
        </app-table>
      </template>
      <div v-if="!rows.length" class="q-mt-md text-bold q-pl-md">
        No users added
      </div>
    </div>
    <div class="col q-pl-xs">
      <div style="font-size: 16px" class="q-py-md q-pl-xs text-bold">Users</div>
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
          :disable="!usersToAdd.length"
          no-caps
        />
      </div>
      <template v-if="rows.length">
        <app-table :rows="users" :columns="columns">
          <template v-slot:select="slotProps">
            <q-checkbox
              size="xs"
              v-model="usersToAdd"
              :val="slotProps.column.row.email"
              class="filter-check-box cursor-pointer"
            />
          </template>
        </app-table>
      </template>
      <div v-if="!rows.length" class="q-mt-md text-bold q-pl-md">
        No users added
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const rows = ref([
  {
    "#": 1,
    email: "example@example.com",
  },
  {
    "#": 2,
    email: "root@example.com",
  },
]);

const users = ref([
  {
    "#": 1,
    email: "example@example.com",
  },
  {
    "#": 2,
    email: "root@example.com",
  },
  {
    "#": 3,
    email: "root@examplee.com",
  },
  {
    "#": 4,
    email: "root@exampleee.com",
  },
  {
    "#": 5,
    email: "root@exampleeee.com",
  },
]);

const { t } = useI18n();

const userSearchKey = ref("");

const usersToRemove = ref([]);

const usersToAdd = ref([]);

const columns = [
  {
    name: "select",
    field: "",
    label: "",
    align: "left",
    sortable: true,
    slot: true,
    slotName: "select",
  },
  {
    name: "email",
    field: "email",
    label: t("iam.userName"),
    align: "left",
    sortable: true,
  },
];
</script>

<style scoped></style>
