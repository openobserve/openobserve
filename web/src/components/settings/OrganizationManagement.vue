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
  <div class="flex flex-col h-full p-0">
    <div class="flex flex-col h-full">
      <!-- Standard section header: title only. Search moved into the table toolbar. -->
      <AppPageHeader
        :title="t('settings.organizationManagement')"
        icon="lan"
        :subtitle="'Create and manage organizations'"
        class="shrink-0 px-4 border-b border-border-default"
      />
      <div class="bg-card-glass-bg flex-1 min-h-0 mt-2.5 overflow-hidden">
      <OTable
        :frame="false"
        data-test="org-management-list-table"
        :data="visibleRows"
        :columns="columns"
        row-key="id"
        pagination="client"
        :page-size="20"
        :page-size-options="[5, 10, 20, 50, 100]"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="org-management-list"
        :show-global-filter="false"
        :loading="loading"
      >
        <template #toolbar>
          <OSearchInput
            data-test="org-management-search-input"
            v-model="filterQuery"
            class="w-64 no-border o2-search-input"
            :placeholder="t('settings.searchOrgs')"
          />
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="org-management-list-refresh-btn"
            @click="getData"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="orgManagementRefresh" />
          </OButton>
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-organizations"
            :filtered="!!filterQuery"
            :hide-action="!filterQuery"
            @action="(id) => id === 'clear-filters' && (filterQuery = '')"
          />
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center gap-1 justify-center">
            <OButton
              variant="ghost"
              size="icon-xs-circle"
              icon-left="event"
              data-test="otg-management-extend-trial-btn"
              @click.stop="toggleExtendTrialDialog(row)"
            >
              <OTooltip :content="t('settings.extendTrial')" />
            </OButton>
            <OButton
              v-if="row.billing_provider === '-'"
              variant="ghost"
              size="icon-xs-circle"
              icon-left="note-add"
              data-test="org-management-add-contract-btn"
              @click.stop="toggleContractDialog(row, 'create')"
            >
              <OTooltip content="Add Contract" />
            </OButton>
            <OButton
              v-if="row.billing_provider === 'no_op'"
              variant="ghost"
              size="icon-xs-circle"
              icon-left="event"
              data-test="org-management-extend-contract-btn"
              @click.stop="toggleContractDialog(row, 'extend')"
            >
              <OTooltip content="Extend Contract" />
            </OButton>
            <OButton
              v-if="row.billing_provider === 'no_op'"
              variant="ghost-destructive"
              size="icon-xs-circle"
              icon-left="block"
              data-test="org-management-revoke-contract-btn"
              @click.stop="confirmRevokeContract(row)"
            >
              <OTooltip content="Revoke" />
            </OButton>
            <OButton
              v-if="!row.org_storage_enabled"
              variant="ghost"
              size="icon-xs-circle"
              icon-left="cloud-upload"
              data-test="org-management-storage-enable-btn"
              @click.stop="toggleOrgStorage(row)"
            >
              <OTooltip content="Enable Storage" />
            </OButton>
            <OButton
              v-else
              variant="ghost"
              size="icon-xs-circle"
              icon-left="cloud-done"
              disabled
              class="text-status-positive"
              data-test="org-management-storage-enabled-btn"
            >
              <OTooltip content="Storage Enabled" />
            </OButton>
          </div>
        </template>
      </OTable>
      </div>
    </div>

    <!-- Extend Trial Dialog -->
    <ODialog
      data-test="organization-management-extend-trial-dialog"
      v-model:open="extendTrialPrompt"
      size="sm"
      :title="`Extend Trial for ${extendTrialDataRow?.name}`"
      sub-title="Set the new trial extension period."
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="`Extend trial by ${extendedTrial} week(s)`"
      form-id="org-extend-trial-form"
      @click:secondary="extendTrialPrompt = false"
    >
      <OForm
        id="org-extend-trial-form"
        ref="extendTrialFormRef"
        :schema="extendTrialSchema"
        :default-values="extendTrialDefaults"
        @submit="onExtendTrialSubmit"
      >
        <div class="flex flex-col gap-3">
          <div class="font-bold">Week(s)</div>
          <div class="flex gap-1">
            <span
              v-for="page in 4"
              :key="page"
              @click="extendedTrial = page"
              :class="[
                'cursor-pointer px-2 py-1 border border-border-default',
                extendedTrial === page
                  ? 'bg-button-primary text-button-primary-foreground border-button-primary'
                  : 'bg-surface-base text-text-body border-border-default',
              ]"
            >
              {{ page }}
            </span>
          </div>
        </div>
      </OForm>
    </ODialog>

    <!-- External Contract Dialog -->
    <ODialog
      data-test="organization-management-contract-dialog"
      v-model:open="contractPrompt"
      size="sm"
      :title="`${contractMode === 'create' ? 'Create' : 'Extend'} External Contract for ${contractDataRow?.name}`"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="contractMode === 'create' ? 'Create Contract' : 'Extend Contract'"
      form-id="org-contract-form"
      @click:secondary="contractPrompt = false"
    >
      <OForm
        id="org-contract-form"
        :schema="contractSchema"
        :default-values="contractDefaults()"
        @submit="submitContract"
      >
        <div class="mb-3">
          <OFormInput
            name="contractEndDate"
            type="date"
            data-test="contract-end-date-input"
            :label="contractMode === 'create' ? 'End Date' : 'New End Date'"
            required
          />
        </div>
        <div
          v-if="contractMode === 'extend' && contractDataRow?.contract_end_date"
          class="text-xs text-text-secondary"
        >
          Current end date: {{ formatMicrosToDate(contractDataRow.contract_end_date) }}
        </div>
      </OForm>
    </ODialog>
  </div>
</template>
<script lang="ts">
import {
  ref,
  onMounted,
  watch,
  defineComponent,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { timestampToTimezoneDate, getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OrganizationServices from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import orgStorageService from "@/services/org_storage";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import {
  makeContractSchema,
  contractDefaults,
  extendTrialSchema,
  type ContractForm,
  type ExtendTrialForm,
} from "./OrganizationManagement.schema";

export default defineComponent({
  name: "PageAlerts",
  components: {
    AppPageHeader,
    OEmptyState,
    OButton,
    ODialog,
    OTooltip,
    OForm,
    OFormInput,
    OSearchInput,
    OTable,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    const { confirm } = useConfirmDialog();

    const extendTrialDataRow = ref();
    const extendedTrial = ref(1);
    const loading = ref(false);
    const extendTrialPrompt = ref(false);
    const tabledata = ref<any>([]);
    const resultTotal = ref(0);
    const filterQuery = ref("");

    // Contract management state
    const contractPrompt = ref(false);
    const contractDataRow = ref<any>({});
    const contractMode = ref<"create" | "extend">("create");

    // ── Form schemas (Options-API: MUST be returned from setup() or :schema
    //    resolves to undefined and validation silently no-ops). ───────────────
    // The contract message is mode-aware; the dialog body remounts on open
    // (reka-ui), so a freshly-mounted <OForm> always reads the current schema.
    const contractSchema = computed(() => makeContractSchema(contractMode.value));

    // Extend-trial week count is bridged from the pill grid into the form below.
    // Dynamic defaults (project the current pill value) → a typed computed.
    const extendTrialFormRef = ref<any>(null);
    const extendTrialDefaults = computed(
      (): ExtendTrialForm => ({ extendedTrial: extendedTrial.value }),
    );

    // Keep the form's copy of the bridged pill value in sync (the pill grid is a
    // custom control, not an <input>, so it is bridged via setFieldValue — the
    // documented sanctioned exception, as CreateDestinationForm does).
    watch(extendedTrial, (v) => {
      extendTrialFormRef.value?.form?.setFieldValue("extendedTrial", Number(v));
    });

    onMounted(() => {
      if (
        store.state.zoConfig.meta_org ==
        store.state.selectedOrganization.identifier
      ) {
        getData();
      } else {
        router.replace({
          name: "general",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        });
      }
    });

    const columns: OTableColumnDef[] = [
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 50,
        meta: { align: "left" },
      },
      {
        id: "name",
        header: t("settings.org_name"),
        accessorKey: "name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 200,
        meta: { align: "left", flex: true },
      },
      {
        id: "identifier",
        header: t("settings.org_identifier"),
        accessorKey: "identifier",
        resizable: true,
        hideable: true,
        size: COL.name,
        meta: { align: "left" },
      },
      {
        id: "subscription_status",
        header: t("settings.subscription_status"),
        accessorKey: "plan",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "billing_provider",
        header: "Provider",
        accessorKey: "billing_provider",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "created_on",
        header: t("settings.created_on"),
        accessorKey: "created_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "trial_expiry",
        header: t("settings.trial_expiry"),
        accessorKey: "trial_expires_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "contract_end_date",
        header: "Contract End",
        accessorKey: "contract_end_date_display",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("settings.actions"),
        isAction: true,
        pinned: "right",
        size: 220,
        meta: { align: "center", actionCount: 3 },
      },
    ];

    const subscriptionPlans: any = {
      "0": "Free",
      "1": "Pay as you go",
      "2": "Enterprise",
      "3": "External Contract",
    };

    const formatMicrosToDate = (micros: number): string => {
      if (!micros || micros <= 0) return "-";
      return timestampToTimezoneDate(micros, "UTC", "yyyy-MM-dd");
    };

    const dateToMicros = (dateStr: string): number => {
      // Treat the picked date as end-of-day UTC so selecting today is still in the future.
      const d = new Date(dateStr);
      d.setUTCHours(23, 59, 59, 999);
      return d.getTime() * 1000;
    };

    const getData = () => {
      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading data...",
              timeout: 0,
});

      OrganizationServices.get_admin_org(
        store.state.selectedOrganization.identifier,
      )
        .then((response) => {
          const data = [];
          const responseData = response.data.data;
          for (let i = 0; i < responseData.length; i++) {
            data.push({
              "#": i + 1,
              id: responseData[i].id,
              name: responseData[i].name,
              identifier: responseData[i].identifier,
              plan: subscriptionPlans[responseData[i].plan],
              billing_provider: responseData[i].billing_provider || "-",
              created_at: timestampToTimezoneDate(
                responseData[i].created_at,
                "UTC",
                "yyyy-MM-dd",
              ),
              trial_expires_at: timestampToTimezoneDate(
                responseData[i].trial_expires_at,
                "UTC",
                "yyyy-MM-dd",
              ),
              contract_end_date: responseData[i].contract_end_date || 0,
              contract_end_date_display: formatMicrosToDate(
                responseData[i].contract_end_date,
              ),
              org_storage_enabled: responseData[i].org_storage_enabled || false,
            });
          }

          tabledata.value = data;
          resultTotal.value = responseData.length;
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to fetch organization data. Please try again.",
              timeout: 5000,
            });
          }
        });
    };

    const toggleExtendTrialDialog = (row: any) => {
      extendTrialPrompt.value = true;
      extendTrialDataRow.value = row;
    };

    const getTimestampInMicroseconds = (weeks: number) =>
      (Date.now() + weeks * 7 * 24 * 60 * 60 * 1000) * 1000;

    const toggleContractDialog = (row: any, mode: "create" | "extend") => {
      contractDataRow.value = row;
      contractMode.value = mode;
      // No contractEndDate reset needed: the dialog body remounts on open and
      // <OForm :default-values> re-seeds the field to blank.
      contractPrompt.value = true;
    };

    // @submit handler — fires only once the schema passes (contractEndDate
    // required), so the old toast required-guards are gone. Awaited by OForm, so
    // the footer Save spinner spans the POST automatically.
    const submitContract = async (value: ContractForm) => {
      const metaOrg = store.state.selectedOrganization.identifier;

      if (contractMode.value === "create") {
        const payload = {
          org_id: contractDataRow.value.identifier,
          end_date: dateToMicros(value.contractEndDate),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Creating external contract...",
                  timeout: 0,
});
        return OrganizationServices.create_external_contract(metaOrg, payload)
          .then(() => {
            toast({
              variant: "success",
              message: "External contract created successfully.",
            });
            contractPrompt.value = false;
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to create external contract.",
              timeout: 5000,
            });
          });
      } else {
        const payload = {
          org_id: contractDataRow.value.identifier,
          new_end_date: dateToMicros(value.contractEndDate),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Extending external contract...",
                  timeout: 0,
});
        return OrganizationServices.extend_external_contract(metaOrg, payload)
          .then(() => {
            toast({
              variant: "success",
              message: "External contract extended successfully.",
            });
            contractPrompt.value = false;
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to extend external contract.",
              timeout: 5000,
            });
          });
      }
    };

    const confirmRevokeContract = async (row: any) => {
      const ok = await confirm({
        title: "Revoke External Contract",
        message: `Are you sure you want to revoke the external contract for "${row.name}"? The organization will revert to the Free tier.`,
      });
      if (ok) {
        const metaOrg = store.state.selectedOrganization.identifier;
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Revoking external contract...",
                  timeout: 0,
});
        OrganizationServices.revoke_external_contract(metaOrg, row.identifier)
          .then(() => {
            toast({
              variant: "success",
              message: "External contract revoked successfully.",
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to revoke external contract.",
              timeout: 5000,
            });
          });
      }
    };

    const toggleOrgStorage = async (row: any) => {
      const ok = await confirm({
        title: "Enable BYOB",
        message: `Are you sure you want to enable BYOB for "${row.name}"?`,
      });
      if (ok) {
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "enabling storage settings...",
                  timeout: 0,
});
        orgStorageService
          .enable(row.identifier)
          .then(() => {
            toast({
              variant: "success",
              message: "Storage settings enabled successfully.",
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to enable storage settings.",
              timeout: 5000,
            });
          });
      }
    };

    const updateTrialPeriod = (org_id: string, extended_week: number) => {
      const payload = {
        new_end_date: getTimestampInMicroseconds(extended_week),
        org_id,
      };

      loading.value = true;
      const dismiss = toast({
        variant: "loading",
        message:
          "Please wait while processing trial period extension request...",
              timeout: 0,
});
      return OrganizationServices.extend_trial_period(
        store.state.selectedOrganization.identifier,
        payload,
      )
        .then((response) => {
          if (response.data) {
            toast({
              variant: "success",
              message: "Trial period extended successfully.",
            });
            extendTrialPrompt.value = false;
            extendTrialDataRow.value = {};
            extendedTrial.value = 1;
            getData();
          }
          loading.value = false;
          dismiss();
        })
        .catch((error) => {
          loading.value = false;
          dismiss();
          if (error.status != 403) {
            toast({
              variant: "error",
              message:
                error.response?.data?.message ||
                "Failed to extend trial period. Please try again.",
              timeout: 5000,
            });
          }
        });
    };

    // @submit handler for the extend-trial dialog — awaited by OForm so the
    // footer Save spinner spans the POST. The week count comes from the
    // schema-validated form value (bridged from the pill grid).
    const onExtendTrialSubmit = async (value: ExtendTrialForm) => {
      return updateTrialPeriod(
        extendTrialDataRow.value?.identifier,
        Number(value.extendedTrial),
      );
    };

    const filterData = (rows: string | any[], terms: string) => {
      var filtered = [];
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (
          rows[i]["name"].toLowerCase().includes(terms) ||
          rows[i]["identifier"].toLowerCase().includes(terms) ||
          rows[i]["plan"].toLowerCase().includes(terms)
        ) {
          filtered.push(rows[i]);
        }
      }
      return filtered;
    };

    const visibleRows = computed(() => {
      if (!filterQuery.value) return tabledata.value || [];
      return filterData(tabledata.value || [], filterQuery.value);
    });

    useShortcuts([
      { id: "orgManagementRefresh", handler: () => { if (!isInputFocused()) getData(); } },
    ]);

    return {
      t,
      columns,
      getImageURL,
      resultTotal,
      tabledata,
      loading,
      extendedTrial,
      extendTrialPrompt,
      toggleExtendTrialDialog,
      extendTrialDataRow,
      updateTrialPeriod,
      getData,
      getTimestampInMicroseconds,
      contractPrompt,
      contractDataRow,
      contractMode,
      toggleContractDialog,
      submitContract,
      confirmRevokeContract,
      toggleOrgStorage,
      formatMicrosToDate,
      filterQuery,
      filterData,
      visibleRows,
      store,
      // Form wiring (Options-API: schemas/defaults MUST be returned so :schema
      // resolves and validation runs).
      contractSchema,
      contractDefaults,
      extendTrialSchema,
      extendTrialDefaults,
      extendTrialFormRef,
      onExtendTrialSubmit,
    };
  },
});
</script>
