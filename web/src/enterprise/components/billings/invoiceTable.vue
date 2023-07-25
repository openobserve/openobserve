<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <q-table
    ref="qTable"
    :rows="invoiceHistory"
    :columns="columns"
    row-key="id"
    :pagination="pagination"
  >
    <template #no-data><NoData /></template>
    <template #body-cell-actions="props">
      <q-td :props="props">
        <q-btn
          size="sm"
          round
          flat
          :icon="'img:' + getImageURL('images/common/download.svg')"
        />
      </q-td>
    </template>
    <template #bottom="scope">
      <QTablePagination
        :scope="scope"
        :resultTotal="resultTotal"
        :perPageOptions="perPageOptions"
        position="bottom"
        @update:changeRecordPerPage="changePagination"
        @update:maxRecordToReturn="changeMaxRecordToReturn"
      />
    </template>
  </q-table>
</template>

<script lang="ts">
// @ts-nocheck
import { computed, defineComponent, onMounted, ref } from "@vue/runtime-core";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";
import NoData from "@/components/shared/grid/NoData.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import BillingService from "@/services/billings";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "InvoiceHistory",
  components: {
    NoData,
    QTablePagination,
  },
  props: [],
  setup(props) {
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const qTable: any = ref(null);
    const columns = ref<QTableProps["columns"]>([
      {
        name: "id",
        field: "id",
        label: "#",
        align: "left",
        sortable: true,
      },
      {
        name: "generated_at",
        field: "generated_at",
        label: t("billing.generatedAt"),
        align: "left",
        sortable: true,
      },
      {
        name: "amount",
        field: "amount",
        label: t("billing.amount"),
        align: "left",
        sortable: true,
      },
      {
        name: "amount_paid",
        field: "amount_paid",
        label: t("billing.amountPaid"),
        align: "left",
        sortable: true,
      },
      {
        name: "amount_due",
        field: "amount_due",
        label: t("billing.amountDue"),
        align: "left",
        sortable: true,
      },
      {
        name: "due_date",
        field: "due_date",
        label: t("billing.dueDate"),
        align: "left",
        sortable: true,
      },
      {
        name: "status",
        field: "status",
        label: t("billing.status"),
        align: "left",
        sortable: true,
      },
      // {
      //   name: "actions",
      //   field: "actions",
      //   label: t("billing.action"),
      //   align: "center",
      // },
    ]);
    const resultTotal = ref<number>(0);
    const invoiceHistory = ref([]);
    const pagination: any = ref({
      rowsPerPage: 5,
    });
    // const selectedPerPage = ref<number>(20);
    const perPageOptions = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];

    onMounted(() => {
      getInvoiceHistory();
    });

    const getInvoiceHistory = () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading invoice history...",
      });

      BillingService.list_invoice_history(
        store.state.selectedOrganization.identifier
      )
        .then((res) => {
          const invoiceList = res.data.data.list;
          if (invoiceList.length > 0) {
            resultTotal.value = invoiceList.length;
            invoiceHistory.value = invoiceList.map(({ invoice }) => {
              const invoiceDate = date.formatDate(
                Math.floor(invoice.generated_at * 1000),
                "DD MMM, YYYY"
              );
              const dueDate = date.formatDate(
                Math.floor(invoice.due_date * 1000),
                "DD MMM, YYYY"
              );
              return {
                id: invoice.id,
                generated_at: invoiceDate,
                amount: invoice.total,
                amount_paid: invoice.amount_paid,
                amount_due: invoice.amount_due,
                due_date: dueDate,
                status: invoice.status,
              };
            });
          }
          dismiss();
        })
        .catch((e) => {
          $q.notify({
            type: "negative",
            message: e.message,
            timeout: 5000,
          });
        });
    };

    const changePagination = (val: { label: string; value: any }) => {
      // selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      // maxRecordToReturn.value = val;
      // getOrganizations();
    };

    return {
      t,
      // $q,
      store,
      qTable,
      columns,
      resultTotal,
      invoiceHistory,
      pagination,
      changePagination,
      // selectedPerPage,
      changeMaxRecordToReturn,
      perPageOptions,
      getInvoiceHistory,
      getImageURL,
    };
  },
});
</script>
<style lang="scss" scoped>
.download-icon {
  cursor: pointer;
}
</style>
