<template>
  <q-page class="q-pa-none" style="min-height: inherit">
    <q-table
      ref="q-table"
      :rows="destinations"
      :columns="columns"
      row-key="id"
      style="width: 100%"
    >
      <template #no-data>
        <NoData />
      </template>
      <template v-slot:body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            icon="edit"
            class="q-ml-xs iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alerts.edit')"
            @click="editTemplate(props)"
          ></q-btn>
          <q-btn
            :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
            class="q-ml-xs iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :title="t('alerts.delete')"
            @click="deleteTemplate(props)"
          ></q-btn>
        </q-td>
      </template>
      <template #top>
        <div class="q-table__title">
          {{ t("templates.header") }}
        </div>
        <q-input
          v-model="destinationSearchKey"
          borderless
          filled
          dense
          class="q-ml-auto q-mb-xs no-border"
          :placeholder="t('templates.search')"
        >
          <template #prepend>
            <q-icon name="search" class="cursor-pointer" />
          </template>
        </q-input>
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`templates.add`)"
          @click="createNewTemplate({})"
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
  </q-page>
</template>
<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { getImageURL } from "@/utils/zincutils";

const destinations = ref([]);
const { t } = useI18n();
const columns: any = ref<QTableProps["columns"]>([
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
  },
  {
    name: "name",
    field: "name",
    label: t("templates.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "url",
    field: "url",
    label: t("templates.url"),
    align: "left",
    sortable: false,
  },
  {
    name: "method",
    field: "method",
    label: t("templates.method"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    sortable: false,
  },
]);
const destinationSearchKey = ref("");
const perPageOptions: any = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "All", value: 0 },
];
const resultTotal = ref<number>(0);
const editTemplate = (props) => {};
const deleteTemplate = (props) => {};
const createNewTemplate = (props) => {};
const changePagination = () => {};
</script>
<style lang=""></style>
