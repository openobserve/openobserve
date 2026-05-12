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
  <div
    data-test="report-list-page"
    class="q-pa-none flex flex-col"
  >
    <!-- Header bar -->
    <div class="tw:w-full tw:px-[0.625rem] q-pt-xs">
      <div class="card-container">
        <div
          class="flex justify-between full-width tw:py-3 tw:mb-[0.625rem] tw:px-4 tw:h-[68px] items-center"
        >
          <div class="q-table__title tw:font-[600]" data-test="report-list-title">
            {{ t("reports.header") }}
          </div>

          <div class="flex q-ml-auto tw:ps-2 items-center">
            <!-- Scheduled / Cached tabs -->
            <div class="app-tabs-container q-mr-sm">
              <app-tabs
                class="tabs-selection-container"
                :tabs="tabs"
                v-model:active-tab="activeTab"
                @update:active-tab="() => { invalidateFolderCache(activeFolderId.value); loadReports(activeFolderId.value); }"
              />
            </div>

            <!-- Search input -->
            <q-input
              data-test="report-list-search-input"
              v-model="dynamicQueryModel"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw:h-[36px] tw:w-[150px]"
              :placeholder="
                searchAcrossFolders
                  ? t('dashboard.searchAcross')
                  : t('reports.search')
              "
              :clearable="searchAcrossFolders"
              @clear="clearSearch"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>

            <!-- All Folders toggle -->
            <div class="tw:ml-2">
              <q-toggle
                data-test="report-list-search-across-folders-toggle"
                v-model="searchAcrossFolders"
                label="All Folders"
                class="tw:h-[32px] tw:mr-3 o2-toggle-button-lg all-folders-toggle"
                size="lg"
              />
              <q-tooltip
                class="q-mt-lg"
                anchor="top middle"
                self="bottom middle"
              >
                {{
                  searchAcrossFolders
                    ? t("dashboard.searchSelf")
                    : t("dashboard.searchAll")
                }}
              </q-tooltip>
            </div>

            <OButton
              data-test="report-list-add-report-btn"
              variant="primary"
              size="sm-action"
              class="q-ml-sm"
              @click="createNewReport"
            >
              {{ t(`reports.add`) }}
            </OButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Splitter: folder list left, table right -->
    <div
      class="full-width report-list-table"
      style="height: calc(100vh - 118px)"
    >
      <q-splitter
        v-model="splitterModel"
        unit="px"
        :limits="[200, 500]"
        style="height: calc(100vh - 118px)"
        data-test="report-list-splitter"
      >
        <!-- Left: folder list -->
        <template #before>
          <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
            <div class="tw:h-full">
              <FolderList
                type="reports"
                @update:activeFolderId="updateActiveFolderId"
              />
            </div>
          </div>
        </template>

        <!-- Right: report table -->
        <template #after>
          <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
            <div class="tw:h-full card-container">
              <q-table
                data-test="report-list-table"
                ref="reportListTableRef"
                :rows="visibleRows"
                :columns="columns"
                row-key="report_id"
                :pagination="pagination"
                :filter="filterQuery"
                :filter-method="filterData"
                selection="multiple"
                v-model:selected="selectedReports"
                style="width: 100%"
                :style="
                  hasVisibleRows
                    ? 'width: 100%; height: calc(100vh - 124px)'
                    : 'width: 100%'
                "
                class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
              >
                <template #no-data>
                  <NoData />
                </template>

                <!-- Custom header with select-all checkbox -->
                <template v-slot:header="props">
                  <q-tr :props="props">
                    <q-th v-if="columns.length > 0" auto-width>
                      <q-checkbox
                        v-model="props.selected"
                        size="sm"
                        :class="
                          store.state.theme === 'dark'
                            ? 'o2-table-checkbox-dark'
                            : 'o2-table-checkbox-light'
                        "
                        class="o2-table-checkbox"
                      />
                    </q-th>
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

                <template v-slot:body-selection="scope">
                  <q-checkbox v-model="scope.selected" size="sm" class="o2-table-checkbox" />
                </template>

                <!-- Name column: badges for type/preview -->
                <template v-slot:body-cell-name="props">
                  <q-td :props="props">
                    <span>{{ props.row.name }}</span>
                    <q-badge
                      v-if="props.row.dashboards?.[0]?.report_type === 'png'"
                      color="teal"
                      class="q-ml-xs"
                      label="PNG"
                      outline
                    />
                    <q-badge
                      v-if="props.row.imagePreview"
                      color="blue-grey"
                      class="q-ml-xs"
                      label="Preview"
                      outline
                    />
                  </q-td>
                </template>

                <!-- Folder column -->
                <template v-slot:body-cell-folder_name="props">
                  <q-td :props="props">
                    {{ props.row.folder_name || "default" }}
                  </q-td>
                </template>

                <!-- Actions column -->
                <template v-slot:body-cell-actions="props">
                  <q-td :props="props">
                    <!-- Enable/disable toggle -->
                    <div
                      v-if="reportsStateLoadingMap[props.row.report_id]"
                      data-test="report-list-toggle-report-state-loader"
                      style="display: inline-block; width: 33.14px; height: auto"
                      class="flex justify-center items-center"
                    >
                      <q-circular-progress
                        indeterminate
                        rounded
                        size="16px"
                        :value="1"
                        color="secondary"
                      />
                    </div>
                    <OButton
                      v-else
                      :data-test="`report-list-${props.row.name}-pause-start-report`"
                      :variant="props.row.enabled ? 'ghost-destructive' : 'ghost'"
                      size="icon-sm"
                      :title="props.row.enabled ? t('alerts.pause') : t('alerts.start')"
                      @click="toggleReportState(props.row)"
                    >
                      <Pause v-if="props.row.enabled" class="tw:size-4" />
                      <Play v-else class="tw:size-4" />
                    </OButton>

                    <!-- Edit -->
                    <OButton
                      :data-test="`report-list-${props.row.name}-edit-report`"
                      variant="ghost"
                      size="icon-sm"
                      :title="t('alerts.edit')"
                      @click="editReport(props.row)"
                    >
                      <Pencil class="tw:size-4" />
                    </OButton>

                    <!-- Move to folder -->
                    <OButton
                      :data-test="`report-list-${props.row.name}-move-report`"
                      variant="ghost"
                      size="icon-sm"
                      title="Move to Folder"
                      @click="openMoveDialog(props.row)"
                    >
                      <FolderInput class="tw:size-4" />
                    </OButton>

                    <!-- Delete -->
                    <OButton
                      :data-test="`report-list-${props.row.name}-delete-report`"
                      variant="ghost-destructive"
                      size="icon-sm"
                      :title="t('alerts.delete')"
                      @click="confirmDeleteReport(props.row)"
                    >
                      <Trash2 class="tw:size-4" />
                    </OButton>
                  </q-td>
                </template>

                <!-- Table footer: pagination + bulk actions -->
                <template #bottom="scope">
                  <div class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[48px]">
                    <!-- Left: count + action buttons grouped together -->
                    <div class="tw:flex tw:items-center tw:gap-2">
                      <div class="o2-table-footer-title tw:flex tw:items-center tw:whitespace-nowrap">
                        {{ resultTotal }} {{ t("reports.header") }}
                      </div>
                      <OButton
                        v-if="selectedReports.length > 0"
                        data-test="report-list-move-reports-btn"
                        variant="outline"
                        size="sm-action"
                        @click="moveMultipleReports"
                      >
                        <FolderInput class="tw:size-4 tw:mr-1" />
                        Move
                      </OButton>
                      <OButton
                        v-if="selectedReports.length > 0"
                        data-test="report-list-delete-reports-btn"
                        variant="outline-destructive"
                        size="sm-action"
                        @click="openBulkDeleteDialog"
                      >
                        <Trash2 class="tw:size-4 tw:mr-1" />
                        Delete
                      </OButton>
                    </div>
                    <!-- Right: pagination -->
                    <QTablePagination
                      :scope="scope"
                      :position="'bottom'"
                      :resultTotal="resultTotal"
                      :perPageOptions="perPageOptions"
                      @update:changeRecordPerPage="changePagination"
                    />
                  </div>
                </template>
              </q-table>
            </div>
          </div>
        </template>
      </q-splitter>
    </div>

    <!-- Single delete confirm -->
    <ConfirmDialog
      v-model="deleteDialog.show"
      :title="deleteDialog.title"
      :message="deleteDialog.message"
      @update:ok="deleteReport"
      @update:cancel="deleteDialog.show = false"
    />

    <!-- Bulk delete confirm -->
    <ConfirmDialog
      v-model="confirmBulkDelete"
      title="Delete Reports"
      :message="`Are you sure you want to delete ${selectedReports.length} report(s)?`"
      @update:ok="bulkDeleteReports"
      @update:cancel="confirmBulkDelete = false"
    />

    <!-- Move to folder dialog -->
    <MoveAcrossFolders
      v-model:open="showMoveDialog"
      :activeFolderId="activeFolderToMove"
      :moduleId="reportIdsToMove"
      type="reports"
      @updated="onMoveUpdated"
      data-test="report-move-to-another-folder-dialog"
    />
  </div>
</template>

<script setup lang="ts">

import { ref, onBeforeMount, reactive, computed, watch, defineAsyncComponent } from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
  outlinedDriveFileMove,
} from "@quasar/extras/material-icons-outlined";
import { useQuasar, date, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import reports from "@/services/reports";
import { cloneDeep, debounce } from "lodash-es";
import AppTabs from "@/components/common/AppTabs.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { getFoldersListByType } from "@/utils/commons";
import OButton from '@/lib/core/Button/OButton.vue';
import { Pause, Play, Pencil, Trash2, FolderInput, CalendarClock, Database } from 'lucide-vue-next';

const MoveAcrossFolders = defineAsyncComponent(
  () => import("@/components/common/sidebar/MoveAcrossFolders.vue"),
);

const { t } = useI18n();
const router = useRouter();
const { track } = useReo();
const store = useStore();
const q = useQuasar();

// ── Folder state ──────────────────────────────────────────────────────────────
const splitterModel = ref(200);
const activeFolderId = ref<string>(
  (router.currentRoute.value.query.folder as string) ?? "default",
);
const searchAcrossFolders = ref(false);

const showMoveDialog = ref(false);
const activeFolderToMove = ref("default");
const reportIdsToMove = ref<string[]>([]);

// ── Report list state ─────────────────────────────────────────────────────────
const reportsTableRows: Ref<any[]> = ref([]);
const staticReportsList: Ref<any[]> = ref([]);
const isLoadingReports = ref(false);
const activeTab = ref("shared");
const filterQuery = ref(""); // client-side filter within current folder
const searchQuery = ref(""); // API search across all folders
const cachedFolderReports = ref<any[]>([]); // current folder's reports before cross-folder search

const dynamicQueryModel = computed({
  get() { return searchAcrossFolders.value ? searchQuery.value : filterQuery.value; },
  set(value: string) {
    if (searchAcrossFolders.value) searchQuery.value = value;
    else filterQuery.value = value;
  },
});

const selectedReports = ref<any[]>([]);
const reportListTableRef: Ref<any> = ref(null);
const reportsStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});

const tabs = reactive([
  { label: t("reports.scheduled"), value: "shared", icon: CalendarClock },
  { label: t("reports.cached"),    value: "cached", icon: Database },
]);

const perPageOptions: any = [
  { label: "20",  value: 20  },
  { label: "50",  value: 50  },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
];
const resultTotal = ref<number>(0);
const selectedPerPage = ref<number>(20);
const pagination: any = ref({ rowsPerPage: 20 });

const deleteDialog = ref({
  show:    false,
  title:   "Delete Report",
  message: "Are you sure you want to delete report?",
  data:    null as any, // { report_id, name }
});
const confirmBulkDelete = ref<boolean>(false);

const columns = computed<QTableProps["columns"]>(() => {
  const base: any[] = [
    { name: "#",               label: "#",                    field: "#",                align: "center", style: "width: 67px;" },
    { name: "name",            label: t("alerts.name"),       field: "name",             align: "left",   sortable: true },
    { name: "owner",           label: t("alerts.owner"),      field: "owner",            align: "center", sortable: true,  style: "width: 150px" },
    { name: "description",     label: t("alerts.description"),field: "description",      align: "center", sortable: false, style: "width: 300px" },
    { name: "last_triggered_at", label: t("alerts.lastTriggered"), field: "last_triggered_at", align: "left", sortable: true, style: "width: 150px" },
    { name: "actions",         label: t("alerts.actions"),    field: "actions",          align: "center", sortable: false, classes: "actions-column" },
  ];

  if (searchAcrossFolders.value && searchQuery.value !== "") {
    base.splice(2, 0, {
      name: "folder_name",
      field: "folder_name",
      label: "Folder",
      align: "left",
      sortable: true,
      style: "width: 150px",
    });
  }

  return base;
});

// ── Load reports ──────────────────────────────────────────────────────────────
const loadReports = async (folderId: string, nameQuery?: string) => {
  // Use Vuex cache for folder loads (no nameQuery = normal folder navigation)
  if (!nameQuery && store.state.organizationData.allReportsListByFolderId?.[folderId]) {
    const cached = store.state.organizationData.allReportsListByFolderId[folderId];
    staticReportsList.value = cached;
    cachedFolderReports.value = cached;
    filterReports();
    return;
  }

  isLoadingReports.value = true;
  const dismiss = q.notify({
    spinner: true,
    message: "Please wait while fetching reports...",
    timeout: 2000,
  });

  try {
    const folder = searchAcrossFolders.value ? undefined : folderId;
    const isCache = activeTab.value === "cached";
    const res = await reports.listByFolderId(
      store.state.selectedOrganization.identifier,
      folder,
      undefined,
      isCache || undefined,
      nameQuery || undefined,
    );

    const mapped = (res.data ?? []).map((report: any, index: number) => ({
      "#": index + 1,
      ...report,
      last_triggered_at: report.last_triggered_at
        ? convertUnixToQuasarFormat(report.last_triggered_at)
        : "-",
    }));

    // Always cache the result — even if stale, so navigating back hits the cache
    if (!nameQuery) {
      store.dispatch("setAllReportsListByFolderId", {
        ...store.state.organizationData.allReportsListByFolderId,
        [folderId]: mapped,
      });
    }

    // Race condition guard: don't update UI if user moved to another folder,
    // but data is already cached above for future use (mirrors AlertList.vue:1574)
    if (folderId !== activeFolderId.value && !nameQuery) {
      dismiss();
      return;
    }

    if (!nameQuery) cachedFolderReports.value = mapped;
    staticReportsList.value = mapped;
    filterReports();
  } catch (err: any) {
    if (err?.response?.status !== 403) {
      q.notify({
        type: "negative",
        message: err?.data?.message || "Error while fetching reports!",
        timeout: 3000,
      });
    }
  } finally {
    isLoadingReports.value = false;
    dismiss();
  }
};

const invalidateFolderCache = (folderId: string) => {
  const updated = { ...store.state.organizationData.allReportsListByFolderId };
  delete updated[folderId];
  store.dispatch("setAllReportsListByFolderId", updated);
};

const filterReports = () => {
  reportsTableRows.value = (staticReportsList.value as any[]).map((r: any, i: number) => ({
    ...r,
    "#": i + 1,
  }));
  resultTotal.value = reportsTableRows.value.length;
};

onBeforeMount(async () => {
  // Ensure report folders are in the store before FolderList renders
  if (!store.state.organizationData.foldersByType?.["reports"]) {
    await getFoldersListByType(store, "reports");
  }
  await loadReports(activeFolderId.value);
});

// ── Folder watchers (mirrors AlertList pattern) ───────────────────────────────
watch(
  () => store.state.organizationData.foldersByType?.["reports"],
  (folders) => {
    if (!folders) return;
    const folderQuery = router.currentRoute.value.query.folder as string | undefined;
    const match = folders.find((f: any) => f.folderId === folderQuery);
    activeFolderId.value = match ? folderQuery! : "default";
    filterReports();
  },
  { immediate: true },
);

watch(
  () => activeFolderId.value,
  async (newVal) => {
    selectedReports.value = [];
    if (newVal === router.currentRoute.value.query.folder) return;

    if (searchAcrossFolders.value) {
      searchAcrossFolders.value = false;
      searchQuery.value = "";
      filterQuery.value = "";
    }

    await loadReports(newVal);

    if (router.currentRoute.value.query.folder !== activeFolderId.value) {
      router.push({
        name: "reports",
        query: {
          ...router.currentRoute.value.query,
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    }
  },
);

watch(searchAcrossFolders, (enabled) => {
  if (enabled) {
    // Transfer any existing client-side filter into the cross-folder search query
    searchQuery.value = filterQuery.value;
    filterQuery.value = "";
    // No API call — wait for user to type a query
  } else {
    // Restore the cached folder data without an API call
    searchQuery.value = "";
    filterQuery.value = "";
    staticReportsList.value = cachedFolderReports.value;
    filterReports();
  }
});

const debouncedSearch = debounce(async (query: string) => {
  await loadReports(activeFolderId.value, query);
}, 600);

watch(searchQuery, async (newVal) => {
  if (!searchAcrossFolders.value) return;
  if (!newVal) {
    // User cleared the search — restore cached folder data
    staticReportsList.value = cachedFolderReports.value;
    filterReports();
  } else {
    await debouncedSearch(newVal);
  }
});

const updateActiveFolderId = (folderId: string) => {
  activeFolderId.value = folderId;
};

const clearSearch = () => {
  searchQuery.value = "";
  filterQuery.value = "";
  searchAcrossFolders.value = false;
  // watch(searchAcrossFolders) handles the restore
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function convertUnixToQuasarFormat(unixMicroseconds: any) {
  if (!unixMicroseconds) return "";
  const unixSeconds = unixMicroseconds / 1e6;
  const dateToFormat = new Date(unixSeconds * 1000);
  return date.formatDate(dateToFormat.toISOString(), "YYYY-MM-DDTHH:mm:ssZ");
}

const filterData = (rows: any[], terms: any) => {
  const lc = terms.toLowerCase();
  return rows.filter((r) => r["name"].toLowerCase().includes(lc));
};

const visibleRows = computed(() => {
  if (!filterQuery.value || searchAcrossFolders.value) return reportsTableRows.value ?? [];
  return filterData(reportsTableRows.value ?? [], filterQuery.value);
});
const hasVisibleRows = computed(() => visibleRows.value.length > 0);

watch(visibleRows, (rows) => { resultTotal.value = rows.length; }, { immediate: true });

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  reportListTableRef.value?.setPagination(pagination.value);
};

// ── Actions ───────────────────────────────────────────────────────────────────
const createNewReport = () => {
  track("Button Click", { button: "Add Report", page: "Reports" });
  router.push({
    name: "createReport",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      folder: activeFolderId.value,
    },
  });
};

const editReport = (report: any) => {
  router.push({
    name: "createReport",
    query: {
      report_id: report.report_id,
      name: report.name,
      org_identifier: store.state.selectedOrganization.identifier,
      folder: report.folder_id || activeFolderId.value,
    },
  });
};

// Toggle enable/disable — uses report_id (v2)
const toggleReportState = (report: any) => {
  const state = report.enabled ? "Stopping" : "Starting";
  const dismiss = q.notify({ message: `${state} report "${report.name}"` });
  reportsStateLoadingMap.value[report.report_id] = true;

  reports
    .toggleReportStateById(
      store.state.selectedOrganization.identifier,
      report.report_id,
      !report.enabled,
    )
    .then(() => {
      staticReportsList.value = staticReportsList.value.map((r: any) =>
        r.report_id === report.report_id ? { ...r, enabled: !r.enabled } : r,
      );
      invalidateFolderCache(activeFolderId.value);
      filterReports();
      q.notify({
        type: "positive",
        message: `${!report.enabled ? "Started" : "Stopped"} report successfully.`,
        timeout: 2000,
      });
    })
    .catch((err) => {
      if (err?.response?.status !== 403) {
        q.notify({
          type: "negative",
          message: err?.data?.message || "Error while updating report state!",
          timeout: 4000,
        });
      }
    })
    .finally(() => {
      reportsStateLoadingMap.value[report.report_id] = false;
      dismiss();
    });
};

// Delete — uses report_id (v2)
const confirmDeleteReport = (report: any) => {
  deleteDialog.value.show = true;
  deleteDialog.value.message = `Are you sure you want to delete report "${report.name}"`;
  deleteDialog.value.data = { report_id: report.report_id, name: report.name };
};

const deleteReport = () => {
  const { report_id, name } = deleteDialog.value.data;
  const dismiss = q.notify({ message: `Deleting report "${name}"` });

  reports
    .deleteReportById(store.state.selectedOrganization.identifier, report_id)
    .then(() => {
      staticReportsList.value = staticReportsList.value.filter(
        (r: any) => r.report_id !== report_id,
      );
      invalidateFolderCache(activeFolderId.value);
      filterReports();
      q.notify({ type: "positive", message: "Report deleted successfully.", timeout: 3000 });
    })
    .catch((err: any) => {
      if (err?.response?.status !== 403) {
        q.notify({
          type: "negative",
          message: err?.data?.message || "Error while deleting report!",
          timeout: 4000,
        });
      }
    })
    .finally(() => dismiss());
};

// Bulk delete — uses report_ids (v2)
const openBulkDeleteDialog = () => { confirmBulkDelete.value = true; };

const bulkDeleteReports = async () => {
  const dismiss = q.notify({ spinner: true, message: "Deleting reports...", timeout: 0 });
  try {
    if (!selectedReports.value.length) {
      q.notify({ type: "negative", message: "No reports selected for deletion", timeout: 2000 });
      dismiss();
      return;
    }

    const payload = { ids: selectedReports.value.map((r: any) => r.report_id) };
    const response = await reports.bulkDeleteById(
      store.state.selectedOrganization.identifier,
      payload,
    );
    dismiss();

    const { successful = [], unsuccessful = [] } = response.data ?? {};
    if (unsuccessful.length && successful.length) {
      q.notify({ type: "warning", message: `${successful.length} deleted, ${unsuccessful.length} failed`, timeout: 5000 });
    } else if (unsuccessful.length) {
      q.notify({ type: "negative", message: `Failed to delete ${unsuccessful.length} report(s)`, timeout: 3000 });
    } else {
      q.notify({ type: "positive", message: `${successful.length} report(s) deleted successfully`, timeout: 2000 });
    }

    const successfulIds = new Set(successful);
    staticReportsList.value = staticReportsList.value.filter(
      (r: any) => !successfulIds.has(r.report_id),
    );
    invalidateFolderCache(activeFolderId.value);
    filterReports();
    selectedReports.value = [];
  } catch (error: any) {
    dismiss();
    const msg = error.response?.data?.message || error?.message || "Error deleting reports.";
    if (error.response?.status !== 403) {
      q.notify({ type: "negative", message: msg, timeout: 3000 });
    }
  }
  confirmBulkDelete.value = false;
};

// Move to folder — single row
const openMoveDialog = (report: any) => {
  activeFolderToMove.value = report.folder_id || activeFolderId.value;
  reportIdsToMove.value = [report.report_id];
  showMoveDialog.value = true;
};

// Move to folder — bulk (selected rows)
const moveMultipleReports = () => {
  activeFolderToMove.value = activeFolderId.value;
  reportIdsToMove.value = selectedReports.value.map((r: any) => r.report_id);
  showMoveDialog.value = true;
};

const onMoveUpdated = async (fromFolder: string, toFolder: string) => {
  showMoveDialog.value = false;
  selectedReports.value = [];
  reportIdsToMove.value = [];
  // Invalidate both source and destination folder caches
  invalidateFolderCache(fromFolder || activeFolderId.value);
  invalidateFolderCache(toFolder);
  await loadReports(activeFolderId.value);
};
</script>

<style lang="scss" scoped>
.report-list-table {
  :deep(.q-table th),
  :deep(.q-table td) {
    padding: 0px 16px;
    height: 32px;
  }
}
</style>
