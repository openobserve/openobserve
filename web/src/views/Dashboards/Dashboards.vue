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
    <!-- add dashboard table -->
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
      <!-- if data not available show nodata component -->
      <template #no-data>
        <NoData />
      </template>
      <!-- add delete icon in actions column -->
      <template #body-cell-actions="props">
        <q-td :props="props">
          <q-btn
            v-if="props.row.actions == 'true'"
            :icon="'img:' + getImageURL('images/common/delete_icon.svg')"
            :title="t('dashboard.delete')"
            class="q-ml-xs iconHoverBtn"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            @click.stop="showDeleteDialogFn(props)"
          ></q-btn>
        </q-td>
      </template>
      <!-- searchBar at top -->
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
        <!-- add dashboard button -->
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`dashboard.add`)"
          @click="addDashboard"
        />

        <!-- table pagination -->
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
      <AddDashboard @updated="updateDashboardList" />
    </q-dialog>
    <ConfirmDialog
      title="Delete dashboard"
      message="Are you sure you want to delete dashboard?"
      @update:ok="removeDashboard"
      @update:cancel="confirmDeleteDialog = false"
      v-model="confirmDeleteDialog"
    />
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import { computed, defineComponent, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";

import dashboardService from "../../services/dashboards";
import AddDashboard from "../../components/dashboards/AddDashboard.vue";
import QTablePagination from "../../components/shared/grid/Pagination.vue";
import NoData from "../../components/shared/grid/NoData.vue";
import { useRouter } from "vue-router";
import { isProxy, toRaw } from "vue";
import { getImageURL } from "../../utils/zincutils";
import ConfirmDialog from "../../components/ConfirmDialog.vue";

export default defineComponent({
  name: "Dashboards",
  components: {
    AddDashboard,
    QTablePagination,
    NoData,
    ConfirmDialog,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const dashboard = ref({});
    const showAddDashboardDialog = ref(false);
    const qTable: any = ref(null);
    const router = useRouter();
    const orgData: any = ref(store.state.selectedOrganization);
    const confirmDeleteDialog = ref<boolean>(false);
    const selectedDelete = ref(null);

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
        label: t("dashboard.name"),
        align: "left",
        sortable: true,
      },
      {
        name: "identifier",
        field: "identifier",
        label: t("dashboard.identifier"),
        align: "left",
        sortable: true,
      },
      {
        name: "description",
        field: "description",
        label: t("dashboard.description"),
        align: "left",
        sortable: true,
      },
      {
        name: "owner",
        field: "owner",
        label: t("dashboard.owner"),
        align: "left",
        sortable: true,
      },
      {
        name: "created",
        field: "created",
        label: t("dashboard.created"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("dashboard.actions"),
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
      // console.log("row");
      return router.push({
        path: "/dashboards/view",
        query: { dashboard: row.identifier },
      });
    };
    const getDashboards = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading dashboards...",
      });
      await dashboardService
        .list(
          0,
          1000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier
        )
        .then((res) => {
          resultTotal.value = res.data.list.length;
          store.dispatch("setAllDashboardList", res.data.list);

          dismiss();
        })
        .catch((error) => {
          console.error(error);
        });
    };
    const dashboards = computed(function () {
      const dashboardList = toRaw(store.state.allDashboardList);
      return dashboardList.map((data: any, index) => {
        const board = data.details;
        return {
          "#": index < 9 ? `0${index + 1}` : index + 1,
          id: board.dashboardId,
          name: board.title,
          identifier: board.dashboardId,
          description: board.description,
          owner: board.owner,
          created: date.formatDate(board.created, "YYYY-MM-DDTHH:mm:ssZ"),
          actions: "true",
        };
      });
    });

    const removeDashboard = async () => {
      if (selectedDelete.value) {
        const dashboardId = selectedDelete.value.id;
        await dashboardService
          .delete(store.state.selectedOrganization.identifier, dashboardId)
          .then((res) => {
            const dashboardList = JSON.parse(
              JSON.stringify(toRaw(store.state.allDashboardList))
            );
            const newDashboardList = dashboardList.filter(
              (dashboard) => dashboard.name != dashboardId
            );
            store.dispatch("setAllDashboardList", newDashboardList);
            $q.notify({
              type: "positive",
              message: "Dashboard deleted successfully.",
              timeout: 5000,
            });
          })
          .catch((error) => {
            // console.log(error);
          });
      }
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDeleteDialog.value = true;
    };

    return {
      t,
      qTable,
      store,
      orgData,
      router,
      loading: ref(false),
      dashboards,
      dashboard,
      columns,
      showAddDashboardDialog,
      addDashboard,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      changeMaxRecordToReturn,
      routeToViewD,
      showDeleteDialogFn,
      confirmDeleteDialog,
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
      getImageURL,
    };
  },
  methods: {
    //after adding dashboard need to update the dashboard list
    async updateDashboardList(it: any) {
      this.showAddDashboardDialog = false;
      await this.getDashboards();

      this.$q.notify({
        type: "positive",
        message: `Dashboard added successfully.`,
      });

      this.$router.push({
        path: "/dashboards/view",
        query: { dashboard: it },
      });
    },
    onRowClick(evt, row) {
      this.routeToViewD(row);
    },
  },
  computed: {
    selectedOrg() {
      return this.store.state.selectedOrganization.identifier;
    },
  },
  watch: {
    selectedOrg(newVal: any, oldVal: any) {
      this.orgData.identifier = newVal;
      if (
        (newVal != oldVal || this.dashboards.value == undefined) &&
        this.router.currentRoute.value.name == "dashboards"
      ) {
        // console.log("inside if");

        this.getDashboards(this.store.state.selectedOrganization.id);
      }
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
