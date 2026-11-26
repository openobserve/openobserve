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
  <ODialog
    :open="open"
    size="lg"
    :title="t('settings.organizationManagementPage.contractInvoicesTitle', { name: orgName })"
    :sub-title="t('settings.organizationManagementPage.contractInvoicesSubtitle')"
    data-test="org-contract-invoices-dialog"
    @update:open="$emit('update:open', $event)"
  >
    <div>
      <div
        v-if="loading && !invoices.length"
        class="text-text-secondary py-8 text-center text-sm"
        data-test="org-contract-invoices-loading"
      >
        {{ t("settings.organizationManagementPage.contractInvoicesLoading") }}
      </div>
      <div
        v-else-if="loadError"
        class="text-error py-8 text-center text-sm"
        data-test="org-contract-invoices-error"
      >
        {{ loadError }}
      </div>
      <div
        v-else-if="!invoices.length"
        class="text-text-secondary py-8 text-center text-sm"
        data-test="org-contract-invoices-empty"
      >
        {{ t("settings.organizationManagementPage.contractInvoicesEmpty") }}
      </div>
      <div v-else class="flex flex-col gap-1.5" data-test="org-contract-invoices-list">
        <div
          v-for="invoice in invoices"
          :key="invoice.invoice_id"
          class="rounded-default bg-surface-secondary flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
          :data-test="`org-contract-invoice-${invoice.invoice_id}`"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-text-body truncate text-sm font-medium">
              {{ invoice.invoice_id }}
            </span>
            <span class="text-text-secondary text-xs">
              {{
                t("settings.organizationManagementPage.contractInvoiceWindow", {
                  start: formatTime(invoice.window_start),
                  end: formatTime(invoice.window_end),
                })
              }}
            </span>
          </div>
          <span
            class="text-text-body text-sm font-medium tabular-nums"
            data-test="org-contract-invoice-total"
          >
            ${{ invoice.total }}
          </span>
          <div class="flex flex-col items-end">
            <OBadge
              :variant="statusVariant(invoice.status)"
              size="sm"
              data-test="org-contract-invoice-status"
            >
              {{ statusLabel(invoice.status) }}
            </OBadge>
            <span class="text-text-secondary text-xs">
              {{
                invoice.sent_at
                  ? t("settings.organizationManagementPage.contractInvoiceSentAt", {
                      time: formatTime(invoice.sent_at),
                    })
                  : t("settings.organizationManagementPage.contractInvoiceNotSent")
              }}
            </span>
          </div>
          <OButton
            variant="outline"
            size="sm"
            :loading="resending === invoice.invoice_id"
            :disabled="!!resending"
            data-test="org-contract-invoice-resend-btn"
            @click="resend(invoice)"
          >
            {{ t("settings.organizationManagementPage.resendContractInvoice") }}
          </OButton>
        </div>
      </div>
    </div>
  </ODialog>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OrganizationServices from "@/services/organizations";
import { toast } from "@/lib/feedback/Toast/useToast";
import { timestampToTimezoneDate } from "@/utils/zincutils";

export interface ContractInvoice {
  invoice_id: string;
  contract_id: string;
  org_id: string;
  window_kind: string;
  window_start: number;
  window_end: number;
  total: string;
  recipients: string[];
  status: "pending" | "sent" | "failed";
  sent_at: number | null;
  updated_at: number;
}

export default defineComponent({
  name: "OrgContractInvoicesDialog",
  components: { ODialog, OButton, OBadge },
  props: {
    open: { type: Boolean, required: true },
    orgId: { type: String, required: true },
    orgName: { type: String, default: "" },
  },
  emits: ["update:open"],
  setup(props) {
    const { t } = useI18nTyped();
    const store = useStore();
    const invoices = ref<ContractInvoice[]>([]);
    const loading = ref(false);
    const loadError = ref("");
    const resending = ref("");

    const metaOrg = () => store.state.selectedOrganization.identifier;

    const load = async () => {
      loading.value = true;
      loadError.value = "";
      try {
        const res = await OrganizationServices.list_contract_invoices(metaOrg(), props.orgId);
        invoices.value = res.data;
      } catch (error: any) {
        invoices.value = [];
        loadError.value =
          error.response?.data?.message ||
          t("settings.organizationManagementPage.contractInvoicesLoadError");
      } finally {
        loading.value = false;
      }
    };

    const resend = async (invoice: ContractInvoice) => {
      resending.value = invoice.invoice_id;
      const dismiss = toast({
        variant: "loading",
        message: t("settings.organizationManagementPage.resendingContractInvoice"),
        timeout: 0,
      });
      try {
        const res = await OrganizationServices.resend_contract_invoice(
          metaOrg(),
          props.orgId,
          invoice.invoice_id,
        );
        invoices.value = invoices.value.map((i) =>
          i.invoice_id === invoice.invoice_id ? res.data : i,
        );
        toast({
          variant: "success",
          message: t("settings.organizationManagementPage.contractInvoiceResent", {
            id: invoice.invoice_id,
          }),
          timeout: 5000,
        });
      } catch (error: any) {
        toast({
          variant: "error",
          message:
            error.response?.data?.message ||
            t("settings.organizationManagementPage.resendContractInvoiceError"),
          timeout: 5000,
        });
      } finally {
        dismiss();
        resending.value = "";
      }
    };

    const formatTime = (micros: number): string =>
      `${timestampToTimezoneDate(micros, "UTC", "yyyy-MM-dd HH:mm")} UTC`;

    const statusVariant = (status: ContractInvoice["status"]): BadgeVariant => {
      if (status === "sent") return "success-soft";
      if (status === "failed") return "error-soft";
      return "warning-soft";
    };

    const statusLabel = (status: ContractInvoice["status"]): string => {
      if (status === "sent")
        return t("settings.organizationManagementPage.contractInvoiceStatusSent");
      if (status === "failed")
        return t("settings.organizationManagementPage.contractInvoiceStatusFailed");
      return t("settings.organizationManagementPage.contractInvoiceStatusPending");
    };

    watch(
      () => [props.open, props.orgId],
      ([open]) => {
        if (open) load();
      },
      { immediate: true },
    );

    return {
      t,
      invoices,
      loading,
      loadError,
      resending,
      resend,
      formatTime,
      statusVariant,
      statusLabel,
    };
  },
});
</script>
