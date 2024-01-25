<template>
  <div class="q-px-md row">
    <div class="col q-pr-xs">
      <div class="flex justify-start bordered q-mt-sm q-mb-md">
        <div class="o2-input q-mr-md" style="width: 400px">
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
            <template v-for="visual in usersDisplayOptions" :key="visual.value">
              <q-btn
                :color="visual.value === usersDisplay ? 'primary' : ''"
                :flat="visual.value === usersDisplay ? false : true"
                dense
                no-caps
                size="11px"
                class="q-px-md visual-selection-btn"
                @click="usersDisplay = visual.value"
              >
                {{ visual.label }}</q-btn
              >
            </template>
          </div>
          <span style="font-size: 14px"> Users </span>
        </div>
      </div>
      <div class="q-ml-sm q-mb-sm text-bold">{{ rows.length }} Permissions</div>
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

const usersDisplay = ref("selected");

const usersDisplayOptions = [
  {
    label: "All",
    value: "all",
  },
  {
    label: "Selected",
    value: "selected",
  },
];

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
