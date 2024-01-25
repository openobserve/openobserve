<template>
  <div class="q-px-md row">
    <div class="col q-pr-xs">
      <div class="flex justify-start bordered q-mt-sm q-mb-md">
        <div class="o2-input q-mr-md" style="width: 400px">
          <q-input
            data-test="alert-list-search-input"
            v-model="roleSearchKey"
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
        <div class="flex items-center" style="margin-bottom: 2px">
          <span style="font-size: 14px"> Show </span>
          <div
            class="q-mx-sm"
            style="
              border: 1px solid #d7d7d7;
              width: fit-content;
              border-radius: 2px;
            "
          >
            <template v-for="visual in roleDisplayOptions" :key="visual.value">
              <q-btn
                :color="visual.value === roleView ? 'primary' : ''"
                :flat="visual.value === roleView ? false : true"
                dense
                no-caps
                size="11px"
                class="q-px-md visual-selection-btn"
                @click="roleView = visual.value"
              >
                {{ visual.label }}</q-btn
              >
            </template>
          </div>
          <span style="font-size: 14px"> Roles </span>
        </div>
      </div>
      <div class="q-ml-sm q-mb-sm text-bold">{{ rows.length }} Roles</div>
      <template v-if="rows.length">
        <app-table
          :rows="rows"
          :columns="columns"
          :dense="true"
          style="height: fit-content"
        >
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
        No users added
      </div>

      <div class="flex justify-end q-mt-lg">
        <q-btn
          data-test="add-alert-cancel-btn"
          class="text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
        />
        <q-btn
          data-test="add-alert-submit-btn"
          :label="t('alerts.save')"
          class="text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
        />
      </div>
    </div>
  </div>
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

const roleView = ref("selected");

const roleDisplayOptions = [
  {
    label: "All",
    value: "all",
  },
  {
    label: "Selected",
    value: "selected",
  },
];

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
