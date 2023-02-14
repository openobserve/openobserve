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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page class="q-pa-none">
    <q-table
      ref="qTable"
      :rows="dashboards"
      :columns="columns"
      row-key="id"
      :pagination="pagination"
      :filter="filterQuery"
      :filter-method="filterData"
      :loading="loading"
      @row-click="onRowClick"
    >
      <template #no-data>
        <NoData />
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            v-if="props.row.actions == 'true'"
            icon="img:/src/assets/images/common/remove_icon.svg"
            :title="t('organization.invite')"
            class="iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            @click.stop="removeDashboard(props)"
          ></q-btn>
        </q-td>
      </template>

      <template #top="scope">
        <div class="q-table__title">{{ t("dashboard.header") }}</div>
        <q-input
          v-model="filterQuery"
          filled
          dense
          class="q-ml-auto q-mb-xs"
          :placeholder="t('dashboard.search')"
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`dashboard.add`)"
          @click="addDashboard"
        />

        <QTablePagination
          :scope="scope"
          :pageTitle="t('dashboard.header')"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="top"
          @update:changeRecordPerPage="changePagination"
        />
      </template>

      <template #bottom="scope">
        <QTablePagination
          :scope="scope"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          :maxRecordToReturn="maxRecordToReturn"
          position="bottom"
          @update:changeRecordPerPage="changePagination"
          @update:maxRecordToReturn="changeMaxRecordToReturn"
        />
      </template>
    </q-table>
    <q-dialog
      v-model="showAddDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <add-update-organization @updated="updateDashboardList" />
    </q-dialog>

    <q-dialog
      v-model="showJoinOrganizationDialog"
      position="right"
      full-height
      maximized
    >
      Organization not available
      <!-- <join-organization v-model="organization" @updated="joinOrganization" /> -->
    </q-dialog>
    <q-dialog v-model="showOrgAPIKeyDialog">
      <q-card>
        <q-card-section>
          <div class="text-h6">Organization API Key</div>
        </q-card-section>

        <q-card-section class="q-pt-none" wrap>
          <q-item>
            <q-item-section>
              <q-item-label lines="3" style="word-wrap: break-word">{{
                organizationAPIKey
              }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                unelevated
                round
                flat
                padding="sm"
                size="sm"
                icon="content_copy"
                @click="copyAPIKey"
                :title="t('organization.copyapikey')"
              />
            </q-item-section>
          </q-item>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-page>
</template>
  
<script lang="ts">
// @ts-nocheck
import { computed, defineComponent, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";

import organizationsService from "../services/organizations";
import dashboardService from "../services/dashboards";

import AddUpdateOrganization from "../components/dashboards/AddUpdateDashboards.vue";
import QTablePagination from "../components/shared/grid/Pagination.vue";
import NoData from "../components/shared/grid/NoData.vue";
import { useRouter } from "vue-router";
import { isProxy, toRaw } from "vue";

export default defineComponent({
  name: "PageOrganization",
  components: {
    AddUpdateOrganization,
    QTablePagination,
    NoData,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const organization = ref({});
    const showAddDashboardDialog = ref(false);
    const showJoinOrganizationDialog = ref(false);
    const showOrgAPIKeyDialog = ref(false);
    const organizationAPIKey = ref("");
    const qTable: any = ref(null);
    const router = useRouter();
    const columns = ref<QTableProps["columns"]>([
      {
        name: "#",
        label: "#",
        field: "#",
        align: "left",
      },
      {
        name: "name",
        field: "name",
        label: t("organization.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "identifier",
        field: "identifier",
        label: t("organization.identifier"),
        align: "left",
        sortable: true,
      },
      {
        name: "role",
        field: "role",
        label: t("organization.role"),
        align: "left",
        sortable: true,
      },
      {
        name: "type",
        field: "type",
        label: t("organization.type"),
        align: "left",
        sortable: true,
      },
      {
        name: "owner",
        field: "owner",
        label: t("organization.owner"),
        align: "left",
        sortable: true,
      },
      {
        name: "created",
        field: "created",
        label: t("organization.created"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("organization.actions"),
        align: "center",
      },
    ]);
    const perPageOptions = [
      { label: "5", value: 5 },
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "All", value: 0 },
    ];
    const resultTotal = ref<number>(0);
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

    onMounted(() => {
      getDashboards();
    });

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
      getDashboards();
    };
    const addDashboard = () => {
      showAddDashboardDialog.value = true;
    };
    const routeToViewD = (row) => {
      console.log("row");
      //return router.push( '/viewDashboard' )
      return router.push({
        path: "/viewDashboard",
        query: { dashboard: row.identifier },
      });
    };
    const getDashboards = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading dashboards...",
      });

      await dashboardService
        .list(store.state.selectedOrganization.identifier)
        .then((res) => {
          store.dispatch("setAllCurrentDashboards", res.data.list);
        })
        .catch((error) => {
          console.log(error);
        });
    };
    const dashboards = computed(function () {
      const dashboardList = toRaw(store.state.allCurrentDashboards);
      return dashboardList.map((data: any) => {
        const jsonDataOBj = JSON.parse(data.details);
        return {
          "#":
            data.id <= 9
              ? `0${jsonDataOBj.dashboardID}`
              : jsonDataOBj.dashboardID,
          id: jsonDataOBj.dashboardId,
          name: jsonDataOBj.title,
          identifier: jsonDataOBj.dashboardId,
          type: jsonDataOBj.description,
          owner: jsonDataOBj.owner,
          created: date.formatDate(jsonDataOBj.created, "YYYY-MM-DDTHH:mm:ssZ"),
          role: jsonDataOBj.role,
          actions: "true",
        };
      });
    });
    const onAddTeam = (props: any) => {
      console.log(props);
    };
    const inviteTeam = (props: any) => {
      organization.value = {
        id: props.row.id,
        name: props.row.name,
        role: props.row.role,
        member_lists: [],
      };
      console.log("dashboard", organization);
      showJoinOrganizationDialog.value = true;
    };
    const removeDashboard = async (props: any) => {
      const dashboardId = props.key;
      await dashboardService
        .delete(store.state.selectedOrganization.identifier, dashboardId)
        .then((res) => {
          const dashboardList = JSON.parse(
            JSON.stringify(toRaw(store.state.allCurrentDashboards))
          );
          const newDashboardList = dashboardList.filter(
            (dashboard) => dashboard.name != dashboardId
          );
          store.dispatch("setAllCurrentDashboards", newDashboardList);
          $q.notify({
            type: "positive",
            message: "Dashboard deleted successfully.",
            timeout: 5000,
          });
        })
        .catch((error) => {
          console.log(error);
        });
    };

    return {
      t,
      qTable,
      loading: ref(false),
      dashboards,
      organization,
      columns,
      showAddDashboardDialog,
      showJoinOrganizationDialog,
      showOrgAPIKeyDialog,
      organizationAPIKey,
      addDashboard,
      inviteTeam,
      onAddTeam,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      changeMaxRecordToReturn,
      routeToViewD,
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      removeDashboard,
      getDashboards,
    };
  },
  methods: {
    updateDashboardList() {
      this.showAddDashboardDialog = false;
      this.getDashboards();

      this.$q.notify({
        type: "positive",
        message: `Dashboard added successfully.`,
      });
    },
    onRowClick(evt, row) {
      this.routeToViewD(row);
    },
    joinOrganization() {
      this.$q.notify({
        type: "positive",
        message: "Request completed successfully.",
        timeout: 5000,
      });
      this.showJoinOrganizationDialog = false;
    },
    getAPIKey(org_identifier: string) {
      const dismiss: any = this.$q.notify({
        message: "Wait while processing your request...",
      });
      this.organizationAPIKey = "";
      organizationsService
        .get_organization_passcode(org_identifier)
        .then((res) => {
          dismiss();
          if (res.data.data.token == "") {
            this.$q.notify({
              type: "negative",
              message: "API Key not found.",
              timeout: 5000,
            });
          } else {
            this.showOrgAPIKeyDialog = true;
            this.organizationAPIKey = res.data.data.token;
          }
        });
    },
    copyAPIKey() {
      copyToClipboard(this.organizationAPIKey)
        .then(() => {
          this.$q.notify({
            type: "positive",
            message: "API Key Copied Successfully!",
            timeout: 5000,
          });
        })
        .catch(() => {
          this.$q.notify({
            type: "negative",
            message: "Error while copy API Key.",
            timeout: 5000,
          });
        });
    },
  },
});
</script>
  
<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
  