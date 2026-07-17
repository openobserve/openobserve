<!-- Copyright 2026 OpenObserve Inc.

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
  <OTable
    :data="invoiceHistory"
    :columns="columns"
    row-key="id"
    pagination="client"
    :page-size="20"
    :page-size-options="[5, 10, 20, 50, 100]"
    sorting="client"
    filter-mode="client"
    :default-columns="false"
    :show-global-filter="false"
    class="h-full w-full"
  >
    <template #empty>
      <NoData />
    </template>
    <template #cell-start_date="{ row }">
      <OTimeCell :value="row.start_date" unit="s" mode="date" :timezone="store.state.timezone" />
    </template>
    <template #cell-end_date="{ row }">
      <OTimeCell :value="row.end_date" unit="s" mode="date" :timezone="store.state.timezone" />
    </template>
    <template #cell-status="{ row }">
      <OTag type="invoiceStatus" :value="row.status" />
    </template>
    <template #cell-actions="{ row }">
      <OButton
        as="a"
        :href="row.pdf"
        target="_blank"
        :title="t('billing.downloadInvoice')"
        variant="ghost"
        size="icon-sm"
        class="ml-1"
      >
        <OIcon name="download" size="sm" />
      </OButton>
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import NoData from "@/components/shared/grid/NoData.vue";
import BillingService from "@/services/billings";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

const { t } = useI18n();
const store = useStore();

const columns: OTableColumnDef[] = [
  {
    id: "id",
    header: "#",
    accessorKey: "id",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "amount",
    header: t("billing.amount"),
    accessorKey: "amount",
    sortable: true,
    size: COL.price,
    meta: { align: "right" },
  },
  {
    id: "paid",
    header: t("billing.amountPaid"),
    accessorKey: "paid",
    sortable: true,
    size: COL.price,
    meta: { align: "right" },
  },
  {
    id: "start_date",
    header: t("billing.invoiceStartDate"),
    accessorKey: "start_date",
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
  {
    id: "end_date",
    header: t("billing.invoiceEndDate"),
    accessorKey: "end_date",
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("billing.status"),
    accessorKey: "status",
    sortable: true,
    size: COL.status,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("billing.action"),
    isAction: true,
    pinned: "right",
    meta: { align: "center" },
  },
];

interface Invoice {
  period_start: number;
  period_end: number;
  paid: boolean;
  total: number;
  currency: string;
  amount_paid: number;
  amount_due: number;
  attempt_count: number;
  statue: string;
  invoice_pdf: string;
}

interface InvoiceRow {
  id: number;
  start_date: number;
  end_date: number;
  paid: string;
  amount: string;
  amount_paid: number;
  amount_due: number;
  attempt_count: number;
  status: string;
  pdf: string;
  action: string;
}

const invoiceHistory = ref<InvoiceRow[]>([]);

const getInvoiceHistory = () => {
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while loading invoice history...",
      timeout: 0,
});

  BillingService.list_invoice_history(
    store.state.selectedOrganization.identifier
  )
    .then((res) => {
      dismiss();
      const invoiceList = res.data.invoices;
      if (invoiceList.length > 0) {
        invoiceHistory.value = invoiceList.map((invoice: Invoice, index: number) => {
          return {
            id: ++index,
            start_date: invoice.period_start,
            end_date: invoice.period_end,
            paid: invoice.paid ? "Yes" : "No",
            amount: invoice.total + " " + invoice.currency.toUpperCase(),
            amount_paid: invoice.amount_paid,
            amount_due: invoice.amount_due,
            attempt_count: invoice.attempt_count,
            status: invoice.statue,
            pdf: invoice.invoice_pdf,
            action: "Download",
          };
        });
      }
    })
    .catch((e) => {
      dismiss();
      toast({
        variant: "error",
        message: e.message,
        timeout: 5000,
      });
    });
};

onMounted(() => {
  getInvoiceHistory();
});
</script>
