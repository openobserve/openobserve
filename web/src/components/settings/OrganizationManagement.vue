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
  <div class="tw:rounded-md q-pa-none" style="min-height: inherit">
    <div>
      <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]">
        <div class="q-table__title" data-test="org-management-list-title">
          {{ t("settings.organizationManagement") }}
        </div>
        <OInput
          data-test="org-management-search-input"
          v-model="filterQuery"
          class="q-ml-auto no-border o2-search-input"
          :placeholder="t('settings.searchOrgs')"
        >
          <template #prepend>
            <OIcon name="search" size="sm" />
          </template>
        </OInput>
      </div>
      <OTable
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
        :show-global-filter="false"
        :loading="loading"
      >
        <template #empty>
          <NoData />
        </template>
        <template #cell-actions="{ row }">
          <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
            <OButton
              variant="ghost"
              size="icon-xs-circle"
              data-test="otg-management-extend-trial-btn"
              @click.stop="toggleExtendTrialDialog(row)"
            >
              <OIcon name="event" size="xs" />
              <q-tooltip>{{ t("settings.extendTrial") }}</q-tooltip>
            </OButton>
            <OButton
              v-if="row.billing_provider === '-'"
              variant="ghost"
              size="icon-xs-circle"
              data-test="org-management-add-contract-btn"
              @click.stop="toggleContractDialog(row, 'create')"
            >
              <OIcon name="note-add" size="xs" />
              <q-tooltip>Add Contract</q-tooltip>
            </OButton>
            <OButton
              v-if="row.billing_provider === 'no_op'"
              variant="ghost"
              size="icon-xs-circle"
              data-test="org-management-extend-contract-btn"
              @click.stop="toggleContractDialog(row, 'extend')"
            >
              <OIcon name="event" size="xs" />
              <q-tooltip>Extend Contract</q-tooltip>
            </OButton>
            <OButton
              v-if="row.billing_provider === 'no_op'"
              variant="ghost-destructive"
              size="icon-xs-circle"
              data-test="org-management-revoke-contract-btn"
              @click.stop="confirmRevokeContract(row)"
            >
              <OIcon name="block" size="xs" />
              <q-tooltip>Revoke</q-tooltip>
            </OButton>
            <OButton
              v-if="!row.org_storage_enabled"
              variant="ghost"
              size="icon-xs-circle"
              data-test="org-management-storage-enable-btn"
              @click.stop="toggleOrgStorage(row)"
            >
              <OIcon name="cloud-upload" size="xs" />
              <q-tooltip>Enable Storage</q-tooltip>
            </OButton>
            <OButton
              v-else
              variant="ghost"
              size="icon-xs-circle"
              disabled
              class="text-positive"
              data-test="org-management-storage-enabled-btn"
            >
              <OIcon name="cloud-done" size="xs" />
              <q-tooltip>Storage Enabled</q-tooltip>
            </OButton>
          </div>
        </template>
      </OTable>
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
      @click:secondary="extendTrialPrompt = false"
      @click:primary="updateTrialPeriod(extendTrialDataRow.identifier, extendedTrial)"
    >
      <div>
        <div class="float-left text-bold">Week(s)</div>
        <div class="float-right q-gutter-xs">
          <span
            v-for="page in 4"
            :key="page"
            @click="extendedTrial = page"
            :class="[
              'cursor-pointer q-px-sm q-py-xs page-border',
              extendedTrial === page
                ? 'bg-primary text-white'
                : 'bg-white text-gray-700 border-gray-3',
            ]"
          >
            {{ page }}
          </span>
        </div>
      </div>
    </ODialog>

    <!-- External Contract Dialog -->
    <ODialog
      data-test="organization-management-contract-dialog"
      v-model:open="contractPrompt"
      size="sm"
      :title="`${contractMode === 'create' ? 'Create' : 'Extend'} External Contract for ${contractDataRow?.name}`"
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="contractMode === 'create' ? 'Create Contract' : 'Extend Contract'"
      @click:secondary="contractPrompt = false"
      @click:primary="submitContract"
    >
      <div class="q-mb-md">
        <div class="text-bold q-mb-xs">
          {{ contractMode === 'create' ? 'End Date' : 'New End Date' }}
        </div>
        <OInput
          v-model="contractEndDate"
          type="date"
          data-test="contract-end-date-input"
        />
      </div>
      <div
        v-if="contractMode === 'extend' && contractDataRow?.contract_end_date"
        class="text-caption text-grey"
      >
        Current end date: {{ formatMicrosToDate(contractDataRow.contract_end_date) }}
      </div>
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
import { useQuasar } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { timestampToTimezoneDate, getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OrganizationServices from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import orgStorageService from "@/services/org_storage";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageAlerts",
  components: {
    NoData,
    OButton,
    ODialog,
    OTooltip,
    OInput,
    OIcon,
    OTable,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();

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
    const contractEndDate = ref("");

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
        meta: { align: "left" },
      },
      {
        id: "identifier",
        header: t("settings.org_identifier"),
        accessorKey: "identifier",
        meta: { align: "left" },
      },
      {
        id: "subscription_status",
        header: t("settings.subscription_status"),
        accessorKey: "plan",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "billing_provider",
        header: "Provider",
        accessorKey: "billing_provider",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "created_on",
        header: t("settings.created_on"),
        accessorKey: "created_at",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "trial_expiry",
        header: t("settings.trial_expiry"),
        accessorKey: "trial_expires_at",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "contract_end_date",
        header: "Contract End",
        accessorKey: "contract_end_date_display",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("settings.actions"),
        isAction: true,
        pinned: "right",
        size: 220,
        meta: { align: "center" },
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
      contractEndDate.value = "";
      contractPrompt.value = true;
    };

    const submitContract = () => {
      const metaOrg = store.state.selectedOrganization.identifier;

      if (contractMode.value === "create") {
        if (!contractEndDate.value) {
          toast({ variant: "error", message: "End date is required." });
          return;
        }
        const payload = {
          org_id: contractDataRow.value.identifier,
          end_date: dateToMicros(contractEndDate.value),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Creating external contract...",
        });
        OrganizationServices.create_external_contract(metaOrg, payload)
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
        if (!contractEndDate.value) {
          toast({ variant: "error", message: "New end date is required." });
          return;
        }
        const payload = {
          org_id: contractDataRow.value.identifier,
          new_end_date: dateToMicros(contractEndDate.value),
        };

        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Extending external contract...",
        });
        OrganizationServices.extend_external_contract(metaOrg, payload)
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

    const confirmRevokeContract = (row: any) => {
      $q.dialog({
        title: "Revoke External Contract",
        message: `Are you sure you want to revoke the external contract for "${row.name}"? The organization will revert to the Free tier.`,
        cancel: true,
        persistent: true,
      }).onOk(() => {
        const metaOrg = store.state.selectedOrganization.identifier;
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Revoking external contract...",
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
      });
    };

    const toggleOrgStorage = (row: any) => {
      $q.dialog({
        title: "Enable Storage Settings",
        message: `Are you sure you want to enable storage settings for "${row.name}"?`,
        cancel: true,
        persistent: true,
      }).onOk(() => {
        loading.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "enabling storage settings...",
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
      });
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
      });
      OrganizationServices.extend_trial_period(
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
      contractEndDate,
      toggleContractDialog,
      submitContract,
      confirmRevokeContract,
      toggleOrgStorage,
      formatMicrosToDate,
      filterQuery,
      filterData,
      visibleRows,
      store,
    };
  },
});
</script>
<style scoped lang="scss">
.page-border {
  border: 1px solid lightgray;
}

.dialog-btn {
  text-transform: none;
}
</style>
