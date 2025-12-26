<!-- Copyright 2023 OpenObserve Inc.

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
      >
        <template #no-data>
          <NoData />
        </template>
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              :label="t('settings.extendTrial')"
              class="q-ml-xs text-capitalize"
              unelevated
              dense
              size="sm"
              padding="xs"
              text-color="primary"
              data-test="otg-management-extend-trial-btn"
              @click.stop="toggleExtendTrialDialog(props.row)"
            ></q-btn>
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
    <q-dialog v-model="extendTrialPrompt">
      <q-card class="q-pa-sm" style="min-width: 450px;">
        <q-toolbar>
          <q-toolbar-title>
            <span class="text-weight-bold" :title="extendTrialDataRow.name">Extend Trial for {{ extendTrialDataRow.name }}</span>
            <span class="text-subtitle2 flex">Set the new trial extension period.</span>
          </q-toolbar-title>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-toolbar>

        <q-card-section>
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
                    : 'bg-white text-gray-700 border-gray-3'
                ]"
              >
                {{ page }}
              </span>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right" class="text-primary q-mt-md">
          <q-btn
            v-close-popup
            class="q-mr-md o2-secondary-button tw:h-[36px]"
            :label="t('common.cancel')"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          />
          <q-btn
            class="o2-primary-button no-border tw:h-[36px]"
            :label="`Extend trial by ${extendedTrial} week(s)`"
            no-caps
            flat
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click.stop="updateTrialPeriod(extendTrialDataRow.identifier, extendedTrial)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
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
export default defineComponent({
  name: "PageAlerts",
  components: {
    NoData,
    QTablePagination,
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

    onMounted(() => {
      if(store.state.zoConfig.meta_org == store.state.selectedOrganization.identifier) {
        getData();
      } else {
        router.replace({
          name: "general",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        })
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
        classes: 'w-[150px]'
      },
      {
        name: "identifier",
        field: "identifier",
        label: t("settings.org_identifier"),
        align: "left",
        sortable: false,
        style: "col-3"
      },
      {
        name: "subscription_status",
        field: "plan",
        label: t("settings.subscription_status"),
        align: "left",
        sortable: true,
        style: "col-1"
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
        name: "actions",
        field: "actions",
        label: t("settings.actions"),
        align: "center",
        sortable: false,
        style: "width: 110px",
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
      "2": "Enterprise"
    }
    
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    
    const getData = () => {
      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading data...",
      });

      OrganizationServices.get_admin_org(store.state.selectedOrganization.identifier)
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
              created_at: timestampToTimezoneDate(responseData[i].created_at, "UTC", "yyyy-MM-dd"),
              trial_expires_at: timestampToTimezoneDate(responseData[i].trial_expires_at, "UTC", "yyyy-MM-dd"),
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
    }

    const getTimestampInMicroseconds = (weeks: number) => (Date.now() + weeks * 7 * 24 * 60 * 60 * 1000) * 1000;


    const updateTrialPeriod = (org_id: string, extended_week: number) => {
      const payload = {
        new_end_date: getTimestampInMicroseconds(extended_week),
        org_id
      };

      loading.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while processing trial period extension request...",
      });
      OrganizationServices.extend_trial_period(store.state.selectedOrganization.identifier, payload)
        .then((response) => {
          if(response.data) {
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
    }

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
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms) || rows[i]["identifier"].toLowerCase().includes(terms) || rows[i]["plan"].toLowerCase().includes(terms)) {
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
