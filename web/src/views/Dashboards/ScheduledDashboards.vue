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
  <div>
    <q-table
      data-test="alert-list-table"
      ref="tableRef"
      :rows="scheduledReports"
      :columns="columns"
      row-key="id"
      :pagination="pagination"
      :filter="filterQuery"
      :filter-method="filterData"
      style="width: 100%"
      class="tw-h-full"
    >
      <template #no-data>
        <NoData />
      </template>
      <template #top="scope">
        <div class="q-table__title" data-test="alerts-list-title">
          {{ t("alerts.header") }}
        </div>
        <q-input
          data-test="alert-list-search-input"
          v-model="filterQuery"
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
        <q-btn
          data-test="alert-list-add-alert-btn"
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`dashboard.newReport`)"
          @click="createNewReport()"
        />

        <QTablePagination
          :scope="scope"
          :pageTitle="t('alerts.header')"
          :position="'top'"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          @update:changeRecordPerPage="changePagination"
        />
      </template>

      <template #bottom="scope">
        <QTablePagination
          :scope="scope"
          :position="'bottom'"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          @update:changeRecordPerPage="changePagination"
        />
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts">
import { QTable, QTableProps } from "quasar";
import { reactive, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const scheduledReports = reactive([]);

const tableRef = ref<InstanceType<typeof QTable> | null>();

const columns: any = reactive<QTableProps["columns"]>([
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
  },
  {
    name: "name",
    field: "name",
    label: t("reports.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "tab",
    field: "tab",
    label: t("reports.tab"),
    align: "left",
    sortable: true,
  },
  {
    name: "time_range",
    field: "time_range",
    label: t("reports.timeRange"),
    align: "left",
    sortable: true,
  },
  {
    name: "frequency",
    field: "frequency",
    label: t("reports.frequency"),
    align: "left",
    sortable: true,
  },
  {
    name: "last_triggered_at",
    field: "last_triggered_at",
    label: t("reports.lastTriggeredAt"),
    align: "left",
    sortable: false,
  },
  {
    name: "createad_at",
    field: "createad_at",
    label: t("reports.createdAt"),
    align: "left",
    sortable: false,
  },
]);

const pagination: any = reactive({
  rowsPerPage: 20,
});

const resultTotal = ref(0);

const perPageOptions = ref([
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
]);

const selectedPerPage = ref(1);

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  tableRef.value?.setPagination(pagination.value);
};

const filterQuery = ref("");

const filterData = (rows: any, terms: string) => {
  return rows.filter((row: any) => {
    return Object.values(row).some((value) => {
      return String(value).toLowerCase().includes(terms.toLowerCase());
    });
  });
};

const createNewReport = () => {};
</script>

<style lang="scss" scoped></style>
