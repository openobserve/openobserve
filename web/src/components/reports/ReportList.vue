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
  <div data-test="report-list-page" class="h-full">
    <OPageLayout
      bleed
      :title="t('reports.header')"
      title-data-test="report-list-title"
      icon="description"
      :subtitle="t('reports.subtitle')"
    >
      <template #actions>
        <OButton
          data-test="report-list-add-report-btn"
          variant="primary"
          size="sm"
          @click="createNewReport"
        >
          {{ t(`reports.add`) }}
        </OButton>
      </template>

      <!-- Folder rail (fixed width) + table — matches the Alerts layout. -->
      <div data-test="report-list-splitter" class="report-list-table flex-1 flex min-h-0">
        <!-- Left: folder list -->
        <div class="shrink-0 h-full w-rail">
          <div class="h-full">
            <FolderList type="reports" @update:activeFolderId="updateActiveFolderId" />
          </div>
        </div>

        <!-- Right: report table -->
        <div class="flex-1 min-w-0 h-full">
          <div class="h-full bg-card-glass-bg">
            <OTable
              data-test="report-list-table"
              :data="visibleRows"
              :columns="columns"
              row-key="report_id"
              :frame="false"
              :loading="isLoadingReports"
              pagination="client"
              selection="multiple"
              v-model:selected-ids="selectedReportIds"
              class="w-full h-full"
              :show-global-filter="false"
              :enable-column-resize="true"
              :persist-columns="true"
              :default-columns="false"
              show-index
              table-id="reports-report-list"
            >
              <!-- Toolbar: Scheduled/Cached tabs + search (inline folder scope) + refresh -->
              <template #toolbar>
                <div class="flex items-center gap-2 w-full">
                  <div class="app-tabs-container">
                    <app-tabs
                      class="tabs-selection-container"
                      :tabs="tabs"
                      v-model:active-tab="activeTab"
                      @update:active-tab="
                        () => {
                          invalidateFolderCache(activeFolderId);
                          loadReports(activeFolderId);
                        }
                      "
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <OInput
                      v-model="dynamicQueryModel"
                      :placeholder="
                        searchAcrossFolders ? t('dashboard.searchAcross') : t('reports.search')
                      "
                      :clearable="searchAcrossFolders"
                      @clear="clearSearch"
                      data-test="report-list-search-input"
                      class="w-full"
                    >
                      <template #icon-left>
                        <OIcon name="search" size="sm" />
                      </template>
                      <template #icon-right>
                        <OToggleGroup
                          :model-value="searchAcrossFolders ? 'all' : 'this'"
                          type="single"
                          class="self-center mr-1"
                          @update:model-value="(v) => (searchAcrossFolders = v === 'all')"
                        >
                          <OToggleGroupItem
                            value="this"
                            size="xs"
                            icon-left="folder-outline"
                            data-test="report-list-search-scope-current"
                            title="Search only this folder"
                            >{{ t("reports.searchThisFolder") }}</OToggleGroupItem
                          >
                          <OToggleGroupItem
                            value="all"
                            size="xs"
                            icon-left="search"
                            data-test="report-list-search-across-folders-toggle"
                            title="Search across all folders"
                            >{{ t("reports.searchAllFolders") }}</OToggleGroupItem
                          >
                        </OToggleGroup>
                      </template>
                    </OInput>
                  </div>
                </div>
              </template>
              <template #toolbar-trailing>
                <OButton
                  variant="outline"
                  size="icon-sm"
                  icon-left="refresh"
                  :loading="isLoadingReports"
                  data-test="report-list-refresh-btn"
                  @click="
                    () => {
                      invalidateFolderCache(activeFolderId);
                      loadReports(activeFolderId);
                    }
                  "
                >
                  <OTooltip
                    side="bottom"
                    :content="t('reports.reloadReports')"
                    shortcut-id="reportsRefresh"
                  />
                </OButton>
              </template>
              <template #empty>
                <OEmptyState
                  size="hero"
                  preset="no-reports"
                  :filtered="!!(filterQuery || searchQuery)"
                  @action="
                    (id) =>
                      id === 'clear-filters'
                        ? ((filterQuery = ''), (searchQuery = ''))
                        : createNewReport()
                  "
                />
              </template>

              <!-- Name column: badges for type/preview -->
              <template #cell-name="{ row }">
                <span :data-test="`report-list-name-cell-${row.name}`">{{ row.name }}</span>
                <OTag
                  v-if="row.dashboards?.[0]?.report_type === 'png'"
                  type="reportTag"
                  value="png"
                  class="ml-1"
                />
                <OTag v-if="row.imagePreview" type="reportTag" value="preview" class="ml-1" />
              </template>

              <!-- Owner column -->
              <template #cell-owner="{ row }">
                <OUserCell :value="row.owner" />
              </template>

              <!-- Folder column -->
              <template #cell-folder_name="{ row }">
                {{ row.folder_name || "default" }}
              </template>

              <!-- Last triggered timestamp -->
              <template #cell-last_triggered_at="{ row }">
                <OTimeCell
                  :value="row.last_triggered_at_raw"
                  unit="us"
                  mode="absolute"
                  :timezone="store.state.timezone"
                  empty-label="Never"
                />
              </template>

              <!-- Actions column -->
              <template #cell-actions="{ row }">
                <!-- Enable/disable toggle -->
                <div
                  v-if="reportsStateLoadingMap[row.report_id]"
                  data-test="report-list-toggle-report-state-loader"
                  style="display: inline-block; width: 33.14px"
                  class="flex justify-center items-center h-auto"
                >
                  <OSpinner size="xs" />
                </div>
                <OButton
                  v-else
                  :data-test="`report-list-${row.name}-pause-start-report`"
                  :data-row-action="row.enabled ? 'pause' : 'resume'"
                  :variant="row.enabled ? 'ghost-destructive' : 'ghost'"
                  size="icon-sm"
                  :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                  :title="row.enabled ? t('alerts.pause') : t('alerts.start')"
                  @click="toggleReportState(row)"
                />

                <!-- Edit -->
                <OButton
                  :data-test="`report-list-${row.name}-edit-report`"
                  data-row-action="edit"
                  icon-left="edit"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('alerts.edit')"
                  @click="editReport(row)"
                />

                <!-- Move to folder -->
                <OButton
                  :data-test="`report-list-${row.name}-move-report`"
                  icon-left="drive-file-move"
                  variant="ghost"
                  size="icon-sm"
                  :title="t('reports.moveToFolder')"
                  @click="openMoveDialog(row)"
                />

                <!-- Delete -->
                <OButton
                  :data-test="`report-list-${row.name}-delete-report`"
                  data-row-action="delete"
                  icon-left="delete"
                  variant="ghost-destructive"
                  size="icon-sm"
                  :title="t('alerts.delete')"
                  @click="confirmDeleteReport(row)"
                />
              </template>

              <!-- Table footer: pagination + bulk actions -->
              <template #bottom>
                <div class="flex items-center justify-between w-full h-12">
                  <!-- Left: count + action buttons grouped together -->
                  <div class="flex items-center gap-2">
                    <div class="text-xs font-normal flex items-center whitespace-nowrap">
                      {{ resultTotal }} {{ t("reports.header") }}
                    </div>
                    <OButton
                      v-if="selectedReports.length > 0"
                      data-test="report-list-move-reports-btn"
                      icon-left="drive-file-move"
                      variant="outline"
                      size="sm-action"
                      @click="moveMultipleReports"
                    >
                      {{ t("common.move") }}
                    </OButton>
                    <OButton
                      v-if="selectedReports.length > 0"
                      data-test="report-list-delete-reports-btn"
                      icon-left="delete"
                      variant="outline-destructive"
                      size="sm-action"
                      :loading="bulkDeleteLoading"
                      @click="openBulkDeleteDialog"
                    >
                      {{ t("common.delete") }}
                    </OButton>
                  </div>
                </div>
              </template>
            </OTable>
          </div>
        </div>
      </div>
    </OPageLayout>

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
      :title="t('reports.deleteReportsTitle')"
      :message="t('reports.deleteReportsMsg', { count: selectedReports.length })"
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
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import { convertUnixToDateFormat } from "@/utils/date";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useI18n } from "vue-i18n";
import reports from "@/services/reports";
import { debounce } from "lodash-es";
import AppTabs from "@/components/common/AppTabs.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { getFoldersListByType } from "@/utils/commons";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";

const MoveAcrossFolders = defineAsyncComponent(
  () => import("@/components/common/sidebar/MoveAcrossFolders.vue"),
);

const { t } = useI18n();
const router = useRouter();
const { track } = useReo();
const store = useStore();

// ── Folder state ──────────────────────────────────────────────────────────────
const activeFolderId = ref<string>((router.currentRoute.value.query.folder as string) ?? "default");
const searchAcrossFolders = ref(false);

const showMoveDialog = ref(false);
const activeFolderToMove = ref("default");
const reportIdsToMove = ref<string[]>([]);

// ── Report list state ─────────────────────────────────────────────────────────
const reportsTableRows: Ref<any[]> = ref([]);
const staticReportsList: Ref<any[]> = ref([]);
// Start in the loading state so the table shows the skeleton on first render
// instead of briefly flashing the empty state before the fetch completes.
const isLoadingReports = ref(true);
const activeTab = ref("shared");
const filterQuery = ref(""); // client-side filter within current folder
const searchQuery = ref(""); // API search across all folders
const cachedFolderReports = ref<any[]>([]); // current folder's reports before cross-folder search

const dynamicQueryModel = computed({
  get() {
    return searchAcrossFolders.value ? searchQuery.value : filterQuery.value;
  },
  set(value: string) {
    if (searchAcrossFolders.value) searchQuery.value = value;
    else filterQuery.value = value;
  },
});

const selectedReportIds = ref<string[]>([]);
const selectedReports = computed({
  get: () =>
    (reportsTableRows.value || []).filter((row: any) =>
      selectedReportIds.value.includes(row.report_id),
    ),
  set: (val) => {
    selectedReportIds.value = val.map((row: any) => row.report_id);
  },
});
const reportsStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});

const tabs = reactive([
  { label: t("reports.scheduled"), value: "shared", icon: "schedule" },
  { label: t("reports.cached"), value: "cached", icon: "database" },
]);

const resultTotal = ref<number>(0);

const deleteDialog = ref({
  show: false,
  title: "Delete Report",
  message: "Are you sure you want to delete report?",
  data: null as any, // { report_id, name }
});
const confirmBulkDelete = ref<boolean>(false);
const bulkDeleteLoading = ref<boolean>(false);

const columns = computed<OTableColumnDef[]>(() => {
  const base: OTableColumnDef[] = [
    {
      id: "name",
      header: t("alerts.name"),
      accessorKey: "name",
      cell: " ",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.name,
      minSize: 160,
      meta: { align: "left", flex: true },
    },
    {
      id: "owner",
      header: t("alerts.owner"),
      accessorKey: "owner",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.owner,
    },
    {
      id: "description",
      header: t("alerts.description"),
      accessorKey: "description",
      sortable: false,
      resizable: true,
      hideable: true,
      size: COL.description,
      meta: { align: "left" },
    },
    {
      id: "last_triggered_at",
      header: t("alerts.lastTriggered"),
      accessorKey: "last_triggered_at",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.dateAbsolute,
      meta: { align: "left" },
    },
    {
      id: "actions",
      header: t("alerts.actions"),
      isAction: true,
      size: 150,
      meta: { align: "center", cellClass: "actions-column", actionCount: 4 },
    },
  ];

  if (searchAcrossFolders.value && searchQuery.value !== "") {
    base.splice(2, 0, {
      id: "folder_name",
      header: "Folder",
      accessorKey: "folder_name",
      cell: " ",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.folder,
      meta: { align: "left" },
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
    // Data is served synchronously from cache — clear the initial loading flag
    // so the skeleton doesn't stay stuck on a cached (re)mount.
    isLoadingReports.value = false;
    return;
  }

  isLoadingReports.value = true;
  const dismiss = toast({
    variant: "loading",
    message: "Please wait while fetching reports...",
    timeout: 0,
  });

  try {
    const folder = searchAcrossFolders.value ? undefined : folderId;
    const isCache = activeTab.value === "cached";
    const res = await reports.listByFolderId(
      store.state.selectedOrganization.identifier,
      folder,
      undefined,
      isCache,
      nameQuery || undefined,
    );

    const mapped = (res.data ?? []).map((report: any) => ({
      ...report,
      last_triggered_at_raw: report.last_triggered_at || null,
      last_triggered_at: report.last_triggered_at
        ? convertUnixToDateFormat(report.last_triggered_at)
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
      toast({
        variant: "error",
        message: err?.data?.message || "Error while fetching reports!",
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
  reportsTableRows.value = [...(staticReportsList.value as any[])];
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

const filterData = (rows: any[], terms: any) => {
  const lc = terms.toLowerCase();
  return rows.filter((r) => r["name"].toLowerCase().includes(lc));
};

const visibleRows = computed(() => {
  if (!filterQuery.value || searchAcrossFolders.value) return reportsTableRows.value ?? [];
  return filterData(reportsTableRows.value ?? [], filterQuery.value);
});
watch(
  visibleRows,
  (rows) => {
    resultTotal.value = rows.length;
  },
  { immediate: true },
);

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
  const dismiss = toast({
    variant: "loading",
    message: `${state} report "${report.name}"`,
    timeout: 0,
  });
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
      toast({
        variant: "success",
        message: `${!report.enabled ? "Started" : "Stopped"} report successfully.`,
      });
    })
    .catch((err) => {
      if (err?.response?.status !== 403) {
        toast({
          variant: "error",
          message: err?.data?.message || "Error while updating report state!",
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
  const dismiss = toast({ variant: "loading", message: `Deleting report "${name}"`, timeout: 0 });

  reports
    .deleteReportById(store.state.selectedOrganization.identifier, report_id)
    .then(() => {
      staticReportsList.value = staticReportsList.value.filter(
        (r: any) => r.report_id !== report_id,
      );
      invalidateFolderCache(activeFolderId.value);
      filterReports();
      toast({ variant: "success", message: "Report deleted successfully." });
    })
    .catch((err: any) => {
      if (err?.response?.status !== 403) {
        toast({
          variant: "error",
          message: err?.data?.message || "Error while deleting report!",
        });
      }
    })
    .finally(() => dismiss());
};

// Bulk delete — uses report_ids (v2)
const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
};

const bulkDeleteReports = async () => {
  bulkDeleteLoading.value = true;
  const dismiss = toast({ variant: "loading", message: "Deleting reports...", timeout: 0 });
  try {
    if (!selectedReports.value.length) {
      toast({ variant: "error", message: "No reports selected for deletion" });
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
      toast({
        variant: "warning",
        message: `${successful.length} deleted, ${unsuccessful.length} failed`,
        timeout: 5000,
      });
    } else if (unsuccessful.length) {
      toast({ variant: "error", message: `Failed to delete ${unsuccessful.length} report(s)` });
    } else {
      toast({ variant: "success", message: `${successful.length} report(s) deleted successfully` });
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
      toast({ variant: "error", message: msg });
    }
  } finally {
    bulkDeleteLoading.value = false;
  }
  confirmBulkDelete.value = false;
};

// Move to folder — single "row"
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

// ── Keyboard shortcuts ────────────────────────────────────────────────────
useShortcuts([
  {
    id: "reportsAdd",
    handler: () => {
      if (!isInputFocused()) createNewReport();
    },
  },
  {
    id: "reportsRefresh",
    handler: () => {
      if (!isInputFocused()) {
        // Match the refresh button: drop the cache first so it actually reloads.
        invalidateFolderCache(activeFolderId.value);
        loadReports(activeFolderId.value);
      }
    },
  },
  {
    id: "reportsFocusSearch",
    handler: () => {
      focusSearchInput("report-list-search-input");
    },
  },
]);
</script>
