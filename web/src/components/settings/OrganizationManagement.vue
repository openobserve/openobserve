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
  <q-page class="q-pa-none" style="min-height: inherit">
    <div>
      <q-table
        data-test="org-management-list-table"
        ref="qTable"
        :rows="tabledata"
        :columns="columns"
        row-key="id"
        :pagination="pagination"
        :filter="filterQuery"
        :filter-method="filterData"
        :loading="loading"
        table-style="table-layout: fixed"
        style="
          width: 100%;
          height: calc(100vh - var(--navbar-height) - 87px);
          overflow-y: auto;
        "
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <div class="tw:flex tw:items-center tw:gap-1 tw:justify-center">
              <OButton
                variant="ghost"
                size="icon-xs-circle"
                data-test="otg-management-extend-trial-btn"
                @click.stop="toggleExtendTrialDialog(props.row)"
              >
                <q-icon name="event" size="14px" />
                <q-tooltip>{{ t("settings.extendTrial") }}</q-tooltip>
              </OButton>
              <OButton
                v-if="props.row.billing_provider === '-'"
                variant="ghost"
                size="icon-xs-circle"
                data-test="org-management-add-contract-btn"
                @click.stop="toggleContractDialog(props.row, 'create')"
              >
                <q-icon name="note_add" size="14px" />
                <q-tooltip>Add Contract</q-tooltip>
              </OButton>
              <OButton
                v-if="props.row.billing_provider === 'no_op'"
                variant="ghost"
                size="icon-xs-circle"
                data-test="org-management-extend-contract-btn"
                @click.stop="toggleContractDialog(props.row, 'extend')"
              >
                <q-icon name="event" size="14px" />
                <q-tooltip>Extend Contract</q-tooltip>
              </OButton>
              <OButton
                v-if="props.row.billing_provider === 'no_op'"
                variant="ghost-destructive"
                size="icon-xs-circle"
                data-test="org-management-revoke-contract-btn"
                @click.stop="confirmRevokeContract(props.row)"
              >
                <q-icon name="block" size="14px" />
                <q-tooltip>Revoke</q-tooltip>
              </OButton>
              <OButton
                v-if="!props.row.org_storage_enabled"
                variant="ghost"
                size="icon-xs-circle"
                data-test="org-management-storage-enable-btn"
                @click.stop="toggleOrgStorage(props.row)"
              >
                <q-icon name="cloud_upload" size="14px" />
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
                <q-icon name="cloud_done" size="14px" />
                <q-tooltip>Storage Enabled</q-tooltip>
              </OButton>
            </div>
          </q-td>
        </template>
        <template #top="scope">
          <div class="q-table__title" data-test="org-management-list-title">
            {{ t("settings.organizationManagement") }}
          </div>
          <q-input
            data-test="org-management-search-input"
            v-model="filterQuery"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border col-3"
            :placeholder="t('settings.searchOrgs')"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>

          <QTablePagination
            :scope="scope"
            :pageTitle="t('settings.paginationOrganizationLabel')"
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

    <!-- Extend Trial Dialog -->
    <ODialog
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
        <q-input
          v-model="contractEndDate"
          dense
          outlined
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
  </q-page>
</template>
<script lang="ts">
import {
  ref,
  onBeforeMount,
  onActivated,
  watch,
  defineComponent,
  onMounted,
} from "vue";
import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar, type QTableProps } from "quasar";
import NoData from "../shared/grid/NoData.vue";
import { timestampToTimezoneDate, getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import OrganizationServices from "@/services/organizations";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import orgStorageService from "@/services/org_storage";
export default defineComponent({
  name: "PageAlerts",
  components: {
    NoData,
    QTablePagination,
    OButton,
    ODialog,
  },
  setup() {
    const qTable = ref();
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
    const selectedPerPage = ref(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

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

    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 50px",
      },
      {
        name: "name",
        field: "name",
        label: t("settings.org_name"),
        align: "left",
        sortable: true,
        classes: "w-[150px]",
      },
      {
        name: "identifier",
        field: "identifier",
        label: t("settings.org_identifier"),
        align: "left",
        sortable: false,
        style: "col-3",
      },
      {
        name: "subscription_status",
        field: "plan",
        label: t("settings.subscription_status"),
        align: "left",
        sortable: true,
        style: "col-1",
      },
      {
        name: "billing_provider",
        field: "billing_provider",
        label: "Provider",
        align: "left",
        sortable: true,
        style: "col-1",
      },
      {
        name: "created_on",
        field: "created_at",
        label: t("settings.created_on"),
        align: "left",
        sortable: true,
      },
      {
        name: "trial_expiry",
        field: "trial_expires_at",
        label: t("settings.trial_expiry"),
        align: "left",
        sortable: true,
      },
      {
        name: "contract_end_date",
        field: "contract_end_date_display",
        label: "Contract End",
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("settings.actions"),
        align: "center",
        sortable: false,
        classes: "actions-column",
        style: "width: 220px",
      },
    ]);
    const perPageOptions: any = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];

    const subscriptionPlans: any = {
      "0": "Free",
      "1": "Pay as you go",
      "2": "Enterprise",
      "3": "External Contract",
    };

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
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
      const dismiss = $q.notify({
        spinner: true,
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
            $q.notify({
              type: "negative",
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
          $q.notify({ type: "negative", message: "End date is required." });
          return;
        }
        const payload = {
          org_id: contractDataRow.value.identifier,
          end_date: dateToMicros(contractEndDate.value),
        };

        loading.value = true;
        const dismiss = $q.notify({
          spinner: true,
          message: "Creating external contract...",
        });
        OrganizationServices.create_external_contract(metaOrg, payload)
          .then(() => {
            $q.notify({
              type: "positive",
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
            $q.notify({
              type: "negative",
              message:
                error.response?.data?.message ||
                "Failed to create external contract.",
              timeout: 5000,
            });
          });
      } else {
        if (!contractEndDate.value) {
          $q.notify({ type: "negative", message: "New end date is required." });
          return;
        }
        const payload = {
          org_id: contractDataRow.value.identifier,
          new_end_date: dateToMicros(contractEndDate.value),
        };

        loading.value = true;
        const dismiss = $q.notify({
          spinner: true,
          message: "Extending external contract...",
        });
        OrganizationServices.extend_external_contract(metaOrg, payload)
          .then(() => {
            $q.notify({
              type: "positive",
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
            $q.notify({
              type: "negative",
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
        const dismiss = $q.notify({
          spinner: true,
          message: "Revoking external contract...",
        });
        OrganizationServices.revoke_external_contract(metaOrg, row.identifier)
          .then(() => {
            $q.notify({
              type: "positive",
              message: "External contract revoked successfully.",
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            $q.notify({
              type: "negative",
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
        const dismiss = $q.notify({
          spinner: true,
          message: "enabling storage settings...",
        });
        orgStorageService
          .enable(row.identifier)
          .then(() => {
            $q.notify({
              type: "positive",
              message: "Storage settings enabled successfully.",
            });
            getData();
            loading.value = false;
            dismiss();
          })
          .catch((error) => {
            loading.value = false;
            dismiss();
            $q.notify({
              type: "negative",
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
      const dismiss = $q.notify({
        spinner: true,
        message:
          "Please wait while processing trial period extension request...",
      });
      OrganizationServices.extend_trial_period(
        store.state.selectedOrganization.identifier,
        payload,
      )
        .then((response) => {
          if (response.data) {
            $q.notify({
              type: "positive",
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
            $q.notify({
              type: "negative",
              message:
                error.response?.data?.message ||
                "Failed to extend trial period. Please try again.",
              timeout: 5000,
            });
          }
        });
    };

    return {
      t,
      qTable,
      columns,
      getImageURL,
      changePagination,
      perPageOptions,
      resultTotal,
      pagination,
      tabledata,
      loading,
      extendedTrial,
      extendTrialPrompt,
      toggleExtendTrialDialog,
      extendTrialDataRow,
      updateTrialPeriod,
      getData,
      getTimestampInMicroseconds,
      selectedPerPage,
      contractPrompt,
      contractDataRow,
      contractMode,
      contractEndDate,
      toggleContractDialog,
      submitContract,
      confirmRevokeContract,
      toggleOrgStorage,
      formatMicrosToDate,
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
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
      },
      store,
    };
  },
});
</script>
<style scopped lang="scss">
.page-border {
  border: 1px solid lightgray;
}

.dialog-btn {
  text-transform: none;
}
</style>
