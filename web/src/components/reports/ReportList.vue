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
  <div
    data-test="report-list-page"
    class="flex q-mt-xs"
  >
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:justify-between tw:items-center tw:w-full tw:py-3 tw:px-4 tw:h-[68px]">
          <div class="q-table__title tw:font-[600]" data-test="report-list-title">
            {{ t("reports.header") }}
          </div>

          <div class="tw:flex tw:items-center">
            <div class="app-tabs-container q-mr-sm">
            <app-tabs
              class="tabs-selection-container"
              :tabs="tabs"
              v-model:active-tab="activeTab"
              @update:active-tab="filterReports"
            />
            </div>
            <q-input
              data-test="report-list-search-input"
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw:h-[36px] tw:w-[150px]"
              :placeholder="t('reports.search')"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
            <q-btn
              data-test="report-list-add-report-btn"
              class="q-ml-sm o2-primary-button tw:h-[36px]"
              flat
              no-caps
              :label="t(`reports.add`)"
              @click="createNewReport"
            />
          </div>
        </div>
      </div>
      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
        <div class="card-container full-width o2-quasar-table o2-row-md o2-quasar-table-header-sticky tw:h-[calc(100vh-128px)]">
          <q-table
            data-test="report-list-table"
            ref="reportListTableRef"
            :rows="visibleRows"
            :columns="columns"
            row-key="name"
            :pagination="pagination"
            :filter="filterQuery"
            :filter-method="filterData"
            selection="multiple"
            v-model:selected="selectedReports"
            style="width: 100%"
            :style="hasVisibleRows
                ? 'width: 100%; height: calc(100vh - 124px)'
                : 'width: 100%'"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          >
            <template #no-data>
              <NoData />
            </template>

            <template v-slot:body-cell-actions="props">
              <q-td :props="props">
                <div
                  v-if="reportsStateLoadingMap[props.row.uuid]"
                  data-test="report-list-toggle-report-state-loader"
                  style="display: inline-block; width: 33.14px; height: auto"
                  class="flex justify-center items-center"
                  :title="`Turning ${props.row.enabled ? 'Off' : 'On'}`"
                >
                  <q-circular-progress
                    indeterminate
                    rounded
                    size="16px"
                    :value="1"
                    color="secondary"
                  />
                </div>
                <q-btn
                  v-else
                  :data-test="`report-list-${props.row.name}-pause-start-report`"
                  padding="sm"
                  unelevated
                  size="sm"
                  :color="props.row.enabled ? 'negative' : 'positive'"
                  :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
                  round
                  flat
                  :title="props.row.enabled ? t('alerts.pause') : t('alerts.start')"
                  @click="toggleReportState(props.row)"
                >
              </q-btn>
                <q-btn
                  :data-test="`report-list-${props.row.name}-edit-report`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="edit"
                  :title="t('alerts.edit')"
                  @click="editReport(props.row)"
                >
              </q-btn>
                <q-btn
                  :data-test="`report-list-${props.row.name}-delete-report`"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  :icon="outlinedDelete"
                  :title="t('alerts.delete')"
                  @click="confirmDeleteReport(props.row)"
                >
              </q-btn>
              </q-td>
            </template>

            <template v-slot:body-cell-function="props">
              <q-td :props="props">
                <q-tooltip>
                  <pre>{{ props.row.sql }}</pre>
                </q-tooltip>
                <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
              </q-td>
            </template>

            <template v-slot:body-selection="scope">
              <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
            </template>

            <template #bottom="scope">
              <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                      {{ resultTotal }} {{ t('reports.header') }}
                    </div>
                <q-btn
                  v-if="selectedReports.length > 0"
                  data-test="report-list-delete-reports-btn"
                  class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-secondary-button-dark'
                      : 'o2-secondary-button-light'
                  "
                  no-caps
                  dense
                  @click="openBulkDeleteDialog"
                >
                  <q-icon name="delete" size="16px" />
                  <span class="tw:ml-2">Delete</span>
                </q-btn>
                <QTablePagination
                :scope="scope"
                :position="'bottom'"
                :resultTotal="resultTotal"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
              </div>

            </template>

            <template v-slot:header="props">
                <q-tr :props="props">
                  <!-- Adding this block to render the select-all checkbox -->
                  <q-th v-if="columns.length > 0" auto-width>
                    <q-checkbox
                      v-model="props.selected"
                      size="sm"
                      :class="store.state.theme === 'dark' ? 'o2-table-checkbox-dark' : 'o2-table-checkbox-light'"
                      class="o2-table-checkbox"
                    />
                  </q-th>

                  <!-- Rendering the rest of the columns -->
                  <q-th
                    v-for="col in props.cols"
                    :key="col.name"
                    :props="props"
                    :class="col.classes"
                    :style="col.style"
                  >
                    {{ col.label }}
                  </q-th>
                </q-tr>
              </template>
          </q-table>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteReport"
      @update:cancel="deleteDialog.show = false"
    />

    <ConfirmDialog
      v-model="confirmBulkDelete"
      title="Delete Reports"
      :message="`Are you sure you want to delete ${selectedReports.length} report(s)?`"
      @update:ok="bulkDeleteReports"
      @update:cancel="confirmBulkDelete = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, reactive, computed, watch } from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
} from "@quasar/extras/material-icons-outlined";
import { useQuasar, date, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import reports from "@/services/reports";
import { cloneDeep } from "lodash-es";
import AppTabs from "@/components/common/AppTabs.vue";
import { useReo } from "@/services/reodotdev_analytics";

const reportsTableRows: Ref<any[]> = ref([]);

const { t } = useI18n();

const router = useRouter();

const { track } = useReo();

const confirmDelete = ref(false);

const store = useStore();

const editingReport: any = ref(null);

const q = useQuasar();

const isLoadingReports = ref(false);

const activeTab = ref("shared");

const tabs = reactive([
  {
    label: t("reports.scheduled"),
    value: "shared",
  },
  {
    label: t("reports.cached"),
    value: "cached",
  },
]);

const perPageOptions: any = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];
const resultTotal = ref<number>(0);
const maxRecordToReturn = ref<number>(100);
const selectedPerPage = ref<number>(20);
const pagination: any = ref({
  rowsPerPage: 20,
});

const reportsStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});

const filterQuery = ref("");

const deleteDialog = ref({
  show: false,
  title: "Delete Report",
  message: "Are you sure you want to delete report?",
  data: "" as any,
});

const confirmBulkDelete = ref<boolean>(false);

const selectedReports = ref<any[]>([]);

const reportListTableRef: Ref<any> = ref(null);

const staticReportsList: Ref<any[]> = ref([]);

const columns: any = ref<QTableProps["columns"]>([
  {
    name: "#",
    label: "#",
    field: "#",
    align: "center",
    style: "width: 67px;",
  },
  {
    name: "name",
    field: "name",
    label: t("alerts.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "owner",
    field: "owner",
    label: t("alerts.owner"),
    align: "center",
    sortable: true,
    style: "width: 150px",
  },
  {
    name: "description",
    field: "description",
    label: t("alerts.description"),
    align: "center",
    sortable: false,
    style: "width: 300px",
  },
  {
    name: "last_triggered_at",
    field: "last_triggered_at",
    label: t("alerts.lastTriggered"),
    align: "left",
    sortable: true,
    style: "width: 150px",
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    sortable: false,
    classes: "actions-column",
  },
]);

onBeforeMount(() => {
  isLoadingReports.value = true;

  const dismiss = q.notify({
    spinner: true,
    message: "Please wait while fetching reports...",
    timeout: 2000,
  });

  reports
    .list(store.state.selectedOrganization.identifier)
    .then((res: any) => {
      reportsTableRows.value = res.data.map((report: any, index: number) => ({
        "#": index + 1,
        ...report,
        last_triggered_at: report.last_triggered_at
          ? convertUnixToQuasarFormat(report.last_triggered_at)
          : "-",
      }));
      resultTotal.value = reportsTableRows.value.length;
      staticReportsList.value = JSON.parse(
        JSON.stringify(reportsTableRows.value),
      );
      filterReports();
    })
    .catch((err) => {
      if (err.response.status != 403) {
        q.notify({
          type: "negative",
          message: err?.data?.message || "Error while fetching reports!",
          timeout: 3000,
        });
      }
    })
    .finally(() => {
      isLoadingReports.value = false;
      dismiss();
    });
});

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  reportListTableRef.value?.setPagination(pagination.value);
};

function convertUnixToQuasarFormat(unixMicroseconds: any) {
  if (!unixMicroseconds) return "";
  const unixSeconds = unixMicroseconds / 1e6;
  const dateToFormat = new Date(unixSeconds * 1000);
  const formattedDate = dateToFormat.toISOString();
  return date.formatDate(formattedDate, "YYYY-MM-DDTHH:mm:ssZ");
}



const filterData = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};

const toggleReportState = (report: any) => {
  const state = report.enabled ? "Stopping" : "Starting";
  const dismiss = q.notify({
    message: `${state} report "${report.name}"`,
  });
  reportsStateLoadingMap.value[report.name] = true;
  reports
    .toggleReportState(
      store.state.selectedOrganization.identifier,
      report.name,
      !report.enabled,
    )
    .then(() => {
      // Create a new report object with updated enabled status
      const updatedReport = { ...report, enabled: !report.enabled };

      // Update in staticReportsList
      staticReportsList.value = staticReportsList.value.map((r: any) => {
        if (r.name === report.name) {
          return updatedReport;
        }
        return r;
      });

      // Update in reportsTableRows
      reportsTableRows.value = reportsTableRows.value.map((r: any) => {
        if (r.name === report.name) {
          return { ...r, enabled: !r.enabled };
        }
        return r;
      });

      q.notify({
        type: "positive",
        message: `${
          updatedReport.enabled ? "Started" : "Stopped"
        } report successfully.`,
        timeout: 2000,
      });
    })
    .catch((err) => {
      if (err.response.status != 403) {
        q.notify({
          type: "negative",
          message: err?.data?.message || "Error while stopping report!",
          timeout: 4000,
        });
      }
    })
    .finally(() => {
      reportsStateLoadingMap.value[report.name] = false;
      dismiss();
    });
};

const editReport = (report: any) => {
  editingReport.value = cloneDeep(report);
  router.push({
    name: "createReport",
    query: {
      name: report.name,
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const confirmDeleteReport = (report: any) => {
  deleteDialog.value.show = true;
  deleteDialog.value.message = `Are you sure you want to delete report "${report.name}"`;
  deleteDialog.value.data = report.name;
};

const deleteReport = (report: any) => {
  const dismiss = q.notify({
    message: `Deleting report "${deleteDialog.value.data}"`,
  });
  reports
    .deleteReport(
      store.state.selectedOrganization.identifier,
      deleteDialog.value.data,
    )
    .then(() => {
      // Find the index of the row that matches the condition
      // update in staticReportsList and call filterReports
      staticReportsList.value = staticReportsList.value.filter(
        (r: any) => r.name !== deleteDialog.value.data,
      );

      filterReports();

      q.notify({
        type: "positive",
        message: `Delete report successfully.`,
        timeout: 3000,
      });
    })
    .catch((err: any) => {
      if (err.response.status != 403) {
        q.notify({
          type: "negative",
          message: err?.data?.message || "Error while deleting report!",
          timeout: 4000,
        });
      }
    })
    .finally(() => dismiss());
};

const createNewReport = () => {
  track("Button Click", {
    button: "Add Report",
    page: "Reports"
  });
  router.push({ name: "createReport", query: { org_identifier: store.state.selectedOrganization.identifier } });
};

const filterReports = () => {
  // filter reports based on the selected tab
  // If reports are cached, show only cached reports
  if (activeTab.value === "cached") {
    reportsTableRows.value = (staticReportsList.value as any).filter(
      (report: any) => !report.destinations.length,
    );
  } else {
    reportsTableRows.value = (staticReportsList.value as any).filter(
      (report: any) => report.destinations.length,
    );
  }

  reportsTableRows.value = reportsTableRows.value.map(
    (report: any, index: number) => {
      return {
        ...report,
        "#": index + 1,
      };
    },
  ) as any[];

  resultTotal.value = reportsTableRows.value.length;
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return reportsTableRows.value || [];
  return filterData(reportsTableRows.value || [], filterQuery.value);
});
const hasVisibleRows = computed(() => visibleRows.value.length > 0);

// Watch visibleRows to sync resultTotal with search filter
watch(visibleRows, (newVisibleRows) => {
  resultTotal.value = newVisibleRows.length;
}, { immediate: true });

const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
};

const bulkDeleteReports = async () => {
  const dismiss = q.notify({
    spinner: true,
    message: "Deleting reports...",
    timeout: 0,
  });

  try {
    if (selectedReports.value.length === 0) {
      q.notify({
        type: "negative",
        message: "No reports selected for deletion",
        timeout: 2000,
      });
      dismiss();
      return;
    }

    // Extract report names for the API call (BE supports names)
    const payload = {
      ids: selectedReports.value.map((r: any) => r.name),
    };

    const response = await reports.bulkDelete(
      store.state.selectedOrganization.identifier,
      payload
    );

    dismiss();

    // Handle response based on successful/unsuccessful arrays
    if (response.data) {
      const { successful = [], unsuccessful = [] } = response.data;
      const successCount = successful.length;
      const failCount = unsuccessful.length;

      if (failCount > 0 && successCount > 0) {
        // Partial success
        q.notify({
          type: "warning",
          message: `${successCount} report(s) deleted successfully, ${failCount} failed`,
          timeout: 5000,
        });
      } else if (failCount > 0) {
        // All failed
        q.notify({
          type: "negative",
          message: `Failed to delete ${failCount} report(s)`,
          timeout: 3000,
        });
      } else {
        // All successful
        q.notify({
          type: "positive",
          message: `${successCount} report(s) deleted successfully`,
          timeout: 2000,
        });
      }

      // Remove deleted reports from staticReportsList by name 
      const successfulNames = new Set(successful);
      staticReportsList.value = staticReportsList.value.filter(
        (r: any) => !successfulNames.has(r.name)
      );

      // Refresh the table
      filterReports();
    } else {
      // Fallback success message
      q.notify({
        type: "positive",
        message: `${selectedReports.value.length} report(s) deleted successfully`,
        timeout: 2000,
      });

      // Remove all selected reports by name
      const selectedNames = new Set(selectedReports.value.map((r: any) => r.name));
      staticReportsList.value = staticReportsList.value.filter(
        (r: any) => !selectedNames.has(r.name)
      );

      // Refresh the table
      filterReports();
    }

    selectedReports.value = [];
  } catch (error: any) {
    dismiss();
    console.error("Error deleting reports:", error);

    // Show error message from response if available
    const errorMessage = error.response?.data?.message || error?.message || "Error deleting reports. Please try again.";
    if (error.response?.status != 403 || error?.status != 403) {
      q.notify({
        type: "negative",
        message: errorMessage,
        timeout: 3000,
      });
    }
  }

  confirmBulkDelete.value = false;
};

</script>

<style lang="scss" scoped>
.dark-mode {
  background-color: $dark-page;

  .report-list-tabs {
    height: fit-content;

    :deep(.rum-tabs) {
      border: 1px solid #464646;
    }

    :deep(.rum-tab) {
      &:hover {
        background: #464646;
      }

      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }
}

.report-list-tabs {
  height: fit-content;

  :deep(.rum-tabs) {
    border: 1px solid #eaeaea;
    height: fit-content;
    border-radius: 4px;
    overflow: hidden;
  }

  :deep(.rum-tab) {
    width: fit-content !important;
    padding: 4px 12px !important;
    border: none !important;

    &:hover {
      background: #eaeaea;
    }

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}
</style>
