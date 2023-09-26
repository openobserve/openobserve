<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-page class="q-pa-none" :key="store.state.selectedOrganization.identifier">
     <!-- searchBar at top -->
     <div style="display: flex; flex-direction: row; justify-content: space-between; padding: 1%; border-bottom: 2px solid rgb(230, 230, 230);">
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
          class="q-ml-md q-mb-xs text-bold"
          padding="sm lg"
          outline
          no-caps
          :label="t(`dashboard.import`)"
          @click="importDashboard"
        />
        <!-- add dashboard button -->
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          data-test="dashboard-add"
          :label="t(`dashboard.add`)"
          @click="addDashboard"
        />
      </div>
    <q-splitter
      v-model="splitterModel"
      unit="px"
      style="height: 80vh"
    >
      <template v-slot:before>
        <div class="dashboards-tabs">
          <q-tabs
            v-model="activeFolder"
            @update:model-value="getDashboards"
            indicator-color="transparent"
            inline-label
            vertical
          >
            <q-tab
            v-for="(tab, index) in folders"
              :key="index"
              :label="tab.name"
              :name="index"
              content-class="tab_content"
            />
          </q-tabs>
          <q-btn
          class="q-ml-lg text-bold no-border self-center"
          padding="sm lg"
          color="secondary"
          no-caps
          label="New Folder"
          @click="addFolder"
        />
        </div>
      </template>
    <template v-slot:after>
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
      data-test="dashboard-table"
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
              icon="content_copy"
              :title="t('dashboard.duplicate')"
              class="q-ml-xs"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              @click.stop="duplicateDashboard(props.row.id)"
            ></q-btn>
          <q-btn
            v-if="props.row.actions == 'true'"
            :icon="outlinedDelete"
            :title="t('dashboard.delete')"
            class="q-ml-xs"
            padding="sm"
            unelevated
            size="sm"
            round
            data-test="dashboard-delete"
            flat
            @click.stop="showDeleteDialogFn(props)"
          ></q-btn>
        </q-td>
      </template>
      <!-- searchBar at top -->
      <template #top="scope">
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
      <AddDashboard @updated="updateDashboardList" :folders="folders" :activeFolder="activeFolder" />
    </q-dialog>
    <q-dialog
      v-model="showAddFolderDialog"
      position="right"
      full-height
      maximized
    >
      <AddFolder @update:modelValue="updateFolderList" />
    </q-dialog>
    <ConfirmDialog
      title="Delete dashboard"
      data-test="dashboard-confirm-dialog"
      message="Are you sure you want to delete the dashboard?"
      @update:ok="deleteDashboard"
      @update:cancel="confirmDeleteDialog = false"
      v-model="confirmDeleteDialog"
    />
    </template>
    </q-splitter>
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
import { getImageURL, verifyOrganizationStatus } from "../../utils/zincutils";
import ConfirmDialog from "../../components/ConfirmDialog.vue";
import { getAllDashboards, getDashboard, getFoldersList } from "../../utils/commons.ts";
import { outlinedDelete } from '@quasar/extras/material-icons-outlined'
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import AddFolder from "../../components/dashboards/AddFolder.vue";

export default defineComponent({
  name: "Dashboards",
  components: {
    AddDashboard,
    QTablePagination,
    NoData,
    ConfirmDialog,
    AddFolder
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const dashboard = ref({});
    const showAddDashboardDialog = ref(false);
    const showAddFolderDialog = ref(false);
    const qTable: any = ref(null);
    const router = useRouter();
    const orgData: any = ref(store.state.selectedOrganization);
    const confirmDeleteDialog = ref<boolean>(false);
    const selectedDelete = ref(null);
    const splitterModel = ref(200);
    const activeFolder = ref(0);
    const folders = ref([]);

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

    onMounted(async() => {      
      folders.value = await getFoldersList(store);
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
    const addFolder = () => {      
      showAddFolderDialog.value = true;
    };
    const importDashboard = () => {
      router.push({
        path: "/dashboards/import",
      });
    };

    const duplicateDashboard = async (dashboardId: any) => {

    const dismiss = $q.notify({
      spinner: true,
      message: "Please wait...",
      timeout: 2000,
    });

    try {
      // Get the dashboard
      const dashboard = await getDashboard(store, dashboardId);

      // Duplicate the dashboard
      const data = JSON.parse(JSON.stringify(dashboard));

      //change title owner name and created date
      data.title=`${data.title} - Copy`;
      data.owner= store.state.userInfo.name
      data.created= new Date().toISOString()

      await dashboardService.create(
        store.state.selectedOrganization.identifier,
        data,
        folders.value[activeFolder?.value]?.folderId || "default"
      );

      await getDashboards();

      $q.notify({
        type: "positive",
        message: `Dashboard Duplicated Successfully`,
      });
    } catch (err) {
      $q.notify({
        type: "negative",
        message: err?.response?.data["error"]
          ? JSON.stringify(err?.response?.data["error"])
          : 'Dashboard duplication failed',
      });
    }

      dismiss();
    };

    const routeToViewD = (row) => {
      return router.push({
        path: "/dashboards/view",
        query: { org_identifier: store.state.selectedOrganization.identifier, dashboard: row.identifier },
      });
    };
    const getDashboards = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading dashboards...",
      });
      await getAllDashboards(store,folders.value[activeFolder.value]?.folderId || "default");
      resultTotal.value = store.state.organizationData.allDashboardList.length;
      dismiss();
    };
    const dashboards = computed(function () {
      const dashboardList = toRaw(store.state.organizationData.allDashboardList);
      return dashboardList.map((board: any, index) => {
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

    const deleteDashboard = async () => {
      if (selectedDelete.value) {
        const dashboardId = selectedDelete.value.id;
        await dashboardService
          .delete(store.state.selectedOrganization.identifier, dashboardId)
          .then((res) => {
            const dashboards = toRaw(store.state.organizationData.allDashboardList);
            const newDashboards = dashboards.filter(
              (dashboard) => dashboard.dashboardId != dashboardId
            );
            store.dispatch("setAllDashboardList", newDashboards);
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

    //after adding Folder need to update the Folder list
    const updateFolderList = async (it: any) => {
      showAddFolderDialog.value = false;

      //add new folder to folders array
      folders.value.push(it);
      activeFolder.value = folders.value.length - 1;
      await getDashboards();

      $q.notify({
        type: "positive",
        message: `Folder added successfully.`,
      });

      $router.push({
        path: "/dashboards",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    }

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
      importDashboard,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      changeMaxRecordToReturn,
      outlinedDelete,
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
      deleteDashboard,
      duplicateDashboard,
      getDashboards,
      getImageURL,
      verifyOrganizationStatus,
      splitterModel,
      folders,
      activeFolder,
      addFolder,
      showAddFolderDialog,
      updateFolderList
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
        query: { org_identifier: store.state.selectedOrganization.identifier, dashboard: it },
      });
    },
    onRowClick(evt, row) {
      this.routeToViewD(row);
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

.dashboards-tabs {
  .q-tabs {
    &--vertical {
      margin: 20px 16px 0 16px;
      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        margin-bottom: 0.5rem;
        text-transform: capitalize;
        &__content.tab_content {
          .q-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }
        &--active {
          background-color: $accent;
          color: black;
        }
      }
    }
  }
}
</style>
