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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <PageLayout
    :key="store.state.selectedOrganization.identifier"
    :main-panel="false"
    :header-class="'tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default'"
  >
    <!-- ── Page header (row 1) ──────────────────────────────────────
         The breadcrumb path now lives in the top chrome bar (published
         below); this row carries the page title + description + actions. -->
    <template #header>
      <AppPageHeader
        :title="t('dashboard.header')"
        icon="dashboard"
        :subtitle="t('dashboard.subtitle')"
      >
      <template #actions>
        <!-- import dashboard button with dropdown -->
        <ODropdown side="bottom" align="end">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              data-test="dashboard-import"
              icon-left="upload-file"
              icon-right="expand-more"
            >
              {{ t(`dashboard.import`) }}
            </OButton>
          </template>
          <ODropdownItem
            @select="importDashboard"
            data-test="dashboard-import-custom"
          >
            <div class="tw:flex tw:flex-col">
              <span>{{ t('dashboard.importCustom') }}</span>
              <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60"
                >{{ t('dashboard.importCustomDesc') }}</span
              >
            </div>
          </ODropdownItem>
          <ODropdownItem
            @select="showAddDashboardFromGitHub = true"
            data-test="dashboard-import-templates"
          >
            <div class="tw:flex tw:flex-col">
              <span>{{ t('dashboard.importTemplates') }}</span>
              <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60"
                >{{ t('dashboard.importTemplatesDesc') }}</span
              >
            </div>
          </ODropdownItem>
        </ODropdown>
        <!-- new dashboard button -->
        <OButton
          variant="primary"
          size="sm"
          icon-left="add"
          data-test="dashboard-new"
          @click="addDashboard"
        >
          {{ t(`dashboard.add`) }}
        </OButton>
      </template>
      </AppPageHeader>
    </template>

    <!-- Folder rail + table — matches the Alerts/Reports layout. -->
    <div class="tw:flex-1 tw:flex tw:min-h-0">
      <!-- Left: shared folder list (same component as Alerts/Reports) -->
      <div class="tw:shrink-0 tw:h-full" :style="{ width: 230 + 'px' }">
        <div class="tw:h-full">
          <FolderList
            type="dashboards"
            @update:activeFolderId="updateActiveFolderId"
          />
        </div>
      </div>
      <!-- Right: dashboards table -->
      <div class="tw:flex-1 tw:min-w-0 tw:h-full">
        <div class="tw:h-full card-container">
          <OTable
            ref="oTableRef"
            :data="dashboards"
            :columns="columns"
            row-key="id"
            :loading="loading"
            :frame="false"
            :default-columns="false"
            :global-filter="filterQuery"
            :show-global-filter="false"
            :footer-title="t('dashboard.header')"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            selection="multiple"
            v-model:selected-ids="selectedIds"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="dashboards-dashboard-list"
            @row-click="onRowClick"
            data-test="dashboard-table"
            style="width: 100%; height: 100%"
          >
            <!-- Toolbar inside the table frame: scoped search (fills the bar) + refresh -->
            <template #toolbar>
              <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
                <div class="tw:flex-1 tw:min-w-0">
                  <OInput
                    v-model="dynamicQueryModel"
                    :placeholder="
                      searchAcrossFolders
                        ? t('dashboard.searchAcross')
                        : t('dashboard.search')
                    "
                    :clearable="searchAcrossFolders"
                    @clear="clearSearchHistory"
                    data-test="dashboard-search"
                    class="tw:w-full"
                  >
                    <template #icon-left>
                      <OIcon name="search" size="sm" />
                    </template>
                    <template #icon-right>
                      <OToggleGroup
                        :model-value="searchAcrossFolders ? 'all' : 'this'"
                        type="single"
                        class="tw:self-center tw:mr-1"
                        @update:model-value="(v) => (searchAcrossFolders = v === 'all')"
                      >
                        <OToggleGroupItem
                          value="this"
                          size="xs"
                          icon-left="folder-outline"
                          data-test="dashboard-search-scope-current"
                          :title="t('dashboard.searchThisFolderTitle')"
                        >{{ t('dashboard.searchThisFolder') }}</OToggleGroupItem>
                        <OToggleGroupItem
                          value="all"
                          size="xs"
                          icon-left="search"
                          data-test="dashboard-search-across-folders-toggle"
                          :title="t('dashboard.searchAllFoldersTitle')"
                        >{{ t('dashboard.searchAllFolders') }}</OToggleGroupItem>
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
                :loading="loading"
                data-test="dashboard-list-refresh"
                @click="getDashboards"
              >
                <OTooltip side="bottom" :content="t('dashboard.reloadDashboards')" shortcut-id="dashboardsListRefresh" />
              </OButton>
            </template>
            <template #cell-name="{ row, value }">
              <span
                class="tw:text-text-primary"
                :data-test="`dashboard-name-cell-${value}`"
                :title="value"
                >{{ value }}</span
              >
            </template>
            <template #cell-identifier="{ value }">
              <span
                class="tw:font-mono tw:text-xs tw:text-text-primary"
                :title="value"
                >{{ value }}</span
              >
            </template>
            <template #cell-description="{ value }">
              <span
                class="tw:text-text-primary"
                :title="value"
                >{{ value || "—" }}</span
              >
            </template>
            <template #cell-owner="{ value }">
              <OUserCell :value="value" />
            </template>
            <template #cell-created="{ row, value }">
              <OTimeCell
                :value="row.created_raw || value"
                unit="iso"
                :timezone="store.state.timezone"
              />
            </template>
            <template #cell-folder="{ row }">
              <button
                type="button"
                class="tw:inline-flex tw:items-center tw:gap-1 tw:max-w-full tw:px-2 tw:py-0.5 tw:rounded-full tw:bg-surface-subtle tw:text-text-primary tw:text-xs tw:leading-5 tw:transition-colors tw:outline-none tw:hover:bg-surface-subtle-hover tw:hover:text-text-primary tw:focus-visible:ring-4 tw:focus-visible:ring-primary-500/25 tw:focus-visible:ring-inset"
                @click.stop="updateActiveFolderId(row.folder_id)"
              >
                <OIcon name="folder-outline" size="xs" />
                <span class="tw:truncate">{{ row.folder }}</span>
              </button>
            </template>
            <template #cell-actions="{ row }">
              <span
                class="row-actions tw:flex tw:items-center tw:justify-center tw:gap-0.5"
              >
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="drive-file-move"
                  :title="t('dashboard.move_to_another_folder')"
                  variant="ghost"
                  size="icon-xs-sq"
                  data-test="dashboard-move-to-another-folder"
                  @click.stop="showMoveDashboardPanel(row)"
                />
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="content-copy"
                  :title="t('dashboard.duplicate')"
                  variant="ghost"
                  size="icon-xs-sq"
                  data-test="dashboard-duplicate"
                  data-row-action="duplicate"
                  @click.stop="duplicateDashboard(row.id, row.folder_id)"
                />
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="delete"
                  :title="t('dashboard.delete')"
                  variant="ghost-destructive"
                  size="icon-xs-sq"
                  data-test="dashboard-delete"
                  data-row-action="delete"
                  @click.stop="showDeleteDialogFn({ row })"
                />
              </span>
            </template>
            <template #empty>
              <OEmptyState
                size="hero"
                :preset="activeFolderId !== 'default' ? 'no-dashboards-in-folder' : 'no-dashboards'"
                :filtered="!!filterQuery"
                @action="
                  (id) =>
                    id === 'clear-filters'
                      ? (filterQuery = '')
                      : id === 'import'
                        ? importDashboard()
                        : id === 'templates'
                          ? (showAddDashboardFromGitHub = true)
                          : addDashboard()
                "
              />
            </template>
            <template #bottom>
              <div
                class="tw:flex tw:w-full tw:justify-between tw:items-center tw:py-1"
              >
                <div
                  class="o2-table-footer-title tw:flex tw:items-center tw:gap-2 tw:shrink-0"
                >
                  <span class="tw:text-text-primary">{{
                    resultTotal || 0
                  }}</span>
                  <span class="tw:text-text-secondary">{{
                    t("dashboard.header")
                  }}</span>
                </div>
                <div
                  v-if="selectedIds.length > 0"
                  class="bulk-action-bar tw:flex tw:items-center tw:gap-2"
                >
                  <span
                    class="tw:text-sm tw:text-text-primary tw:mr-1"
                    >{{ selectedIds.length }} selected</span
                  >
                  <OButton
                    variant="outline"
                    size="sm-action"
                    data-test="dashboard-list-move-across-folders-btn"
                    @click="moveMultipleDashboards"
                    icon-left="drive-file-move"
                  >
                    {{ t('common.move') }}
                  </OButton>
                  <OButton
                    variant="outline"
                    size="sm-action"
                    icon-left="download"
                    data-test="dashboard-list-export-dashboards-btn"
                    @click="multipleExportDashboard"
                  >
                    {{ t('common.export') }}
                  </OButton>
                  <OButton
                    variant="outline-destructive"
                    size="sm-action"
                    icon-left="delete"
                    data-test="dashboard-list-delete-dashboards-btn"
                    @click="openBulkDeleteDialog"
                  >
                    {{ t('common.delete') }}
                  </OButton>
                </div>
              </div>
            </template>
          </OTable>
        </div>
      </div>
    </div>

          <!-- add dashboard -->
          <ODialog
            v-model:open="showAddDashboardDialog"
            size="md"
            :title="t('dashboard.createdashboard')"
            data-test="dashboard-add-dialog"
            :secondary-button-label="t('dashboard.cancel')"
            :primary-button-label="t('dashboard.save')"
            form-id="add-dashboard-form"
            @click:secondary="showAddDashboardDialog = false"
          >
            <AddDashboard
              ref="addDashboardRef"
              @close="showAddDashboardDialog = false"
              @updated="updateDashboardList"
              :activeFolderId="activeFolderId"
            />
          </ODialog>

          <!-- add dashboard from GitHub gallery -->
          <AddDashboardFromGitHub
            v-model="showAddDashboardFromGitHub"
            @added="getDashboards"
          />

          <!-- add/edit folder -->
          <ODialog
            v-model:open="showAddFolderDialog"
            size="sm"
            :title="
              isFolderEditMode
                ? t('dashboard.updateFolder')
                : t('dashboard.newFolder')
            "
            data-test="dashboard-folder-dialog"
            :secondary-button-label="t('dashboard.cancel')"
            :primary-button-label="t('dashboard.save')"
            form-id="add-folder-dashboards-form"
            @click:secondary="showAddFolderDialog = false"
          >
            <AddFolder
              ref="addFolderRef"
              @update:modelValue="updateFolderList"
              :edit-mode="isFolderEditMode"
              :folder-id="selectedFolderToEdit ?? 'default'"
            />
          </ODialog>

          <!-- move dashboard to another folder -->
          <MoveDashboardToAnotherFolder
            v-model:open="showMoveDashboardDialog"
            @updated="handleDashboardMoved"
            :dashboard-ids="selectedDashboardIdToMove"
            :activeFolderId="activeFolderToMove"
            data-test="dashboard-move-to-another-folder-dialog"
          />

          <!-- delete dashboard dialog -->
          <ConfirmDialog
            :title="t('dashboard.deleteDashboardConfirmTitle')"
            data-test="dashboard-confirm-dialog"
            :message="t('dashboard.deleteDashboardConfirmMsg')"
            @update:ok="deleteDashboard"
            @update:cancel="confirmDeleteDialog = false"
            v-model="confirmDeleteDialog"
          />

          <!-- delete folder dialog -->
          <ConfirmDialog
            :title="t('dashboard.deleteFolder')"
            data-test="dashboard-confirm-delete-folder-dialog"
            :message="t('dashboard.deleteFolderMessage')"
            @update:ok="deleteFolder"
            @update:cancel="confirmDeleteFolderDialog = false"
            v-model="confirmDeleteFolderDialog"
          />

          <!-- bulk delete dashboards dialog -->
          <ConfirmDialog
            :title="t('dashboard.deleteDashboardsConfirmTitle')"
            data-test="dashboard-confirm-bulk-delete-dialog"
            :message="t('dashboard.deleteDashboardsConfirmMsg', { count: selectedIds.length })"
            @update:ok="bulkDeleteDashboards"
            @update:cancel="confirmBulkDelete = false"
            v-model="confirmBulkDelete"
          />
  </PageLayout>
</template>

<script lang="ts">
import PageLayout from "@/components/common/PageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
// @ts-nocheck
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatDate } from "@/utils/date";

import dashboardService from "../../services/dashboards";
import OTable from "@/lib/core/Table/OTable.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useRoute, useRouter } from "vue-router";
import { toRaw } from "vue";
import { getImageURL, verifyOrganizationStatus } from "../../utils/zincutils";
import ConfirmDialog from "../../components/ConfirmDialog.vue";
import {
  deleteDashboardById,
  deleteFolderById,
  getAllDashboards,
  getAllDashboardsByFolderId,
  getDashboard,
  getFoldersList,
  moveModuleToAnotherFolder,
} from "../../utils/commons.ts";
import AddFolder from "../../components/dashboards/AddFolder.vue";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import useNotifications from "@/composables/useNotifications";
import { debounce, filter, forIn } from "lodash-es";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { useLoading } from "@/composables/useLoading";
import { useReo } from "@/services/reodotdev_analytics";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import type { AiDashboardEvent } from "@/composables/useAiDashboardEvents";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";

const MoveDashboardToAnotherFolder = defineAsyncComponent(() => {
  return import("@/components/dashboards/MoveDashboardToAnotherFolder.vue");
});

const AddDashboard = defineAsyncComponent(() => {
  return import("@/components/dashboards/AddDashboard.vue");
});

const AddDashboardFromGitHub = defineAsyncComponent(() => {
  return import("@/components/dashboards/AddDashboardFromGitHub.vue");
});

export default defineComponent({
  name: "Dashboards",
  components: {
    OUserCell,
    OTimeCell,
    PageLayout,
    AppPageHeader,
    OEmptyState,
    OButton,
    OIcon,
    ODropdown,
    ODropdownItem,
    OInput,
    OCheckbox,
    ODialog,
    AddDashboard,
    OTooltip,
    AddDashboardFromGitHub,
    OTable,
    ConfirmDialog,
    AddFolder,
    MoveDashboardToAnotherFolder,
    FolderList,
    OToggleGroup,
    OToggleGroupItem,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const dashboard = ref({});
    const showAddDashboardDialog = ref(false);
    const showAddDashboardFromGitHub = ref(false);
    const showAddFolderDialog = ref(false);
    const addDashboardRef: any = ref(null);
    const addFolderRef: any = ref(null);
    const oTableRef: any = ref(null);
    const router = useRouter();
    const route = useRoute();
    const orgData: any = ref(store.state.selectedOrganization);
    const confirmDeleteDialog = ref<boolean>(false);
    const selectedDelete = ref(null);
    const activeFolderId = ref(null);
    const isFolderEditMode = ref(false);
    const selectedFolderDelete = ref(null);
    const selectedFolderToEdit = ref(null);
    const searchQuery = ref("");
    const filteredResults = ref([]);
    const confirmDeleteFolderDialog = ref<boolean>(false);
    const selectedDashboardToMove = ref(null);
    const selectedDashboardIdToMove = ref(null);
    const showMoveDashboardDialog = ref(false);
    const searchAcrossFolders = ref(false);
    const filterQuery = ref("");
    const folderSearchQuery = ref("");
    const selectedIds = ref<string[]>([]);
    const { track } = useReo();

    const { showPositiveNotification, showErrorNotification } =
      useNotifications();

    // Listen for AI assistant dashboard mutations to auto-refresh the list
    const { on: onDashboardEvent, off: offDashboardEvent } =
      useAiDashboardEvents();
    const handleAiDashboardEvent = async (event: AiDashboardEvent) => {
      const folderId = event.folderId || activeFolderId.value;
      if (folderId) {
        // Clear cached data so getAllDashboardsByFolderId re-fetches from API
        store.dispatch("setAllDashboardList", {
          ...store.state.organizationData.allDashboardList,
          [folderId]: undefined,
        });
        const response = await getAllDashboardsByFolderId(store, folderId);
        dashboardList.value = response || [];
      }
    };
    onMounted(() => {
      onDashboardEvent(handleAiDashboardEvent);
    });
    onUnmounted(() => {
      offDashboardEvent(handleAiDashboardEvent);
    });

    let currentSearchAbortController = null;
    const columns = computed(() => {
      const baseColumns = [
        {
          id: "#",
          header: "#",
          accessorKey: "#",
          sortable: false,
          size: TABLE_INDEX_COL_SIZE,
          meta: { align: "left" },
        },
        {
          id: "name",
          header: t("dashboard.name"),
          accessorKey: "name",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.name,
          minSize: 160,
          meta: { align: "left", flex: true },
        },
        // {
        //   id: "identifier",
        //   header: t("dashboard.identifier"),
        //   accessorKey: "identifier",
        //   sortable: true,
        //   resizable: true,
        //   hideable: true,
        //   meta: { align: "left" },
        // },
        {
          id: "description",
          header: t("dashboard.description"),
          accessorKey: "description",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.description,
          meta: { align: "left" },
        },
        {
          id: "owner",
          header: t("dashboard.owner"),
          accessorKey: "owner",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.owner,
          meta: { align: "left" },
        },
        {
          id: "created",
          header: t("dashboard.created"),
          accessorKey: "created",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.date,
          meta: { align: "left" },
        },
        {
          id: "actions",
          header: t("dashboard.actions"),
          sortable: false,
          isAction: true,
          size: 124,
          meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
        },
      ];

      if (searchAcrossFolders.value && searchQuery.value != "") {
        baseColumns.splice(2, 0, {
          id: "folder",
          header: t("dashboard.folder"),
          accessorKey: "folder",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.folder,
          meta: { align: "left" },
        });
      }

      return baseColumns;
    });
    const selectedDashboardIds = computed(() => selectedIds.value);

    onMounted(async () => {
      //get folders list
      await getFoldersList(store);

      //initial activeFolderId will be null
      //if route has query and we have a folder in folder list then set activeFolderId to that folder
      // else default as a folder

      activeFolderId.value = null;
      if (
        route.query.folder &&
        store.state.organizationData.folders.find(
          (it: any) => it.folderId === route.query.folder,
        )
      ) {
        activeFolderId.value = route.query.folder;
      } else {
        activeFolderId.value = "default";
      }
    });

    watch(
      activeFolderId,
      async () => {
        //resetting the selected dashboards if any so that when shifting to another folder and reswitching to same folder
        //the selected dashboards are not shown
        selectedIds.value = [];
        // skip the skeleton for already-cached folders so we don't flash it
        loading.value =
          !store.state.organizationData.allDashboardList[activeFolderId.value];
        try {
          const response = await getAllDashboardsByFolderId(
            store,
            activeFolderId.value,
          );

          dashboardList.value = response || [];
        } catch (error) {
          console.error("Error loading dashboards:", error);
          showErrorNotification(
            error?.message ||
              "Failed to load dashboards for the selected folder.",
          );
        } finally {
          loading.value = false;
          searchAcrossFolders.value = false;
          router.push({
            path: "/dashboards",
            query: {
              org_identifier: store.state.selectedOrganization.identifier,
              folder: activeFolderId.value,
            },
          });
        }
      },
      { deep: true },
    );

    watch(searchQuery, async (newQuery) => {
      if (newQuery) {
        loading.value = true;
      } else {
        // Query cleared — reset state and stop the skeleton.
        filteredResults.value = [];
        loading.value = false;
      }
      await debouncedSearch(newQuery);
      if (searchQuery.value == "") {
        filteredResults.value = [];
      }
    });

    watch(searchAcrossFolders, async (newVal) => {
      if (newVal) {
        // If searching across folders, use searchQuery
        if (filterQuery.value) {
          searchQuery.value = filterQuery.value;
          filterQuery.value = "";
        }
        if (searchQuery.value) {
          loading.value = true;
          try {
            // Cancel any in-flight search
            if (currentSearchAbortController) {
              currentSearchAbortController.abort();
            }
            currentSearchAbortController = new AbortController();
            const searchResults = await fetchSearchResults.execute(
              searchQuery.value,
            );
            filteredResults.value = toRaw(searchResults);
          } catch (error) {
            if (error.name !== "AbortError") {
              filteredResults.value = [];
              // Handle error state
            }
          } finally {
            loading.value = false;
          }
        } else {
          // If no search query, clear filtered results
          filteredResults.value = [];
        }
      } else {
        // If searching within the current folder, use filterQuery
        if (searchQuery.value) {
          filterQuery.value = searchQuery.value;
          searchQuery.value = "";
        }
        if (filterQuery.value) {
          await getDashboards();
        } else {
          // If no search query, clear filtered results
          filteredResults.value = [];
        }
      }
    });

    // Comprehensive cleanup function
    const cleanup = () => {
      // Cancel debounced search
      if (debouncedSearch?.cancel) {
        debouncedSearch.cancel();
      }

      // Cancel any in-flight search requests
      if (currentSearchAbortController) {
        currentSearchAbortController.abort();
        currentSearchAbortController = null;
      }

      // Clear reactive refs to prevent memory leaks
      if (oTableRef.value) {
        oTableRef.value = null;
      }

      // Clear arrays and objects
      dashboardList.value = [];
      filteredResults.value = [];
      selectedIds.value = [];

      // Reset refs to null
      selectedDelete.value = null;
      selectedDashboardToMove.value = null;
      selectedFolderDelete.value = null;
      selectedFolderToEdit.value = null;
    };

    // Cleanup on component unmount
    onBeforeUnmount(() => {
      cleanup();
    });

    onUnmounted(() => {
      cleanup();
    });

    const addDashboard = () => {
      showAddDashboardDialog.value = true;
      track("Button Click", {
        button: "Add Dashboard",
        page: "Dashboards",
      });
    };
    const addFolder = () => {
      isFolderEditMode.value = false;
      showAddFolderDialog.value = true;
      track("Button Click", {
        button: "Add Folder",
        page: "Dashboards",
      });
    };
    const importDashboard = () => {
      router.push({
        path: "/dashboards/import",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value || "default",
        },
      });
    };

    const duplicateDashboard = async (
      dashboardId: any,
      folderId = activeFolderId.value,
    ) => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
              timeout: 0,
});

      try {
        // Get the dashboard
        const dashboard = await getDashboard(
          store,
          dashboardId,
          folderId ?? "default",
        );

        // Duplicate the dashboard
        const data = JSON.parse(JSON.stringify(dashboard));

        //change title owner name and created date
        data.title = `${data.title} - Copy`;
        data.owner = store.state.userInfo.name;
        data.created = new Date().toISOString();

        await dashboardService.create(
          store.state.selectedOrganization.identifier,
          data,
          folderId || "default",
        );

        await getDashboards();

        showPositiveNotification("Dashboard Duplicated Successfully.");
      } catch (err) {
        showErrorNotification(err?.message ?? "Dashboard duplication failed");
      }

      dismiss();
    };

    const routeToViewD = (row) => {
      return router.push({
        path: "/dashboards/view",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: row.id,
          folder: searchAcrossFolders.value
            ? row.folder_id
            : activeFolderId.value || "default",
          // tab: selectedTabId,
        },
      });
    };
    const dashboardList = ref([]);
    // Start in the loading state so the table shows the skeleton on first
    // render instead of briefly flashing the empty state before the fetch.
    const loading = ref(true);
    const getDashboards = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading dashboards...",
              timeout: 0,
});
      loading.value = true;
      try {
        const response = await getAllDashboards(
          store,
          activeFolderId.value ?? "default",
        );
        dashboardList.value = response;
      } catch (err) {
        showErrorNotification(err?.message || "Failed to load dashboards.");
      } finally {
        dismiss();
        loading.value = false;
      }
    };

    const mapDashboard = (
      board: any,
      index: number,
      folderInfo?: { name: string; id: string },
    ) => ({
      "#": index < 9 ? `0${index + 1}` : index + 1,
      id: folderInfo ? board.dashboard.dashboardId : board.dashboardId,
      ...(folderInfo && {
        folder: folderInfo.name,
        folder_id: folderInfo.id,
      }),
      name: folderInfo ? board.dashboard.title : board.title,
      identifier: folderInfo ? board.dashboard.dashboardId : board.dashboardId,
      description: folderInfo ? board.dashboard.description : board.description,
      owner: folderInfo ? board.dashboard.owner : board.owner,
      created_raw: folderInfo ? board.dashboard.created : board.created,
      created: formatDate(
        folderInfo ? board.dashboard.created : board.created,
        "YYYY-MM-DDTHH:mm:ss",
      ),
      actions: "true",
    });

    const dashboards = computed(function () {
      selectedIds.value = [];
      if (!searchAcrossFolders.value || searchQuery.value == "") {
        const dashboardList = toRaw(
          store.state.organizationData?.allDashboardList[
            activeFolderId.value
          ] ?? [],
        );
        return dashboardList.map((board: any, index) =>
          mapDashboard(board, index),
        );
      } else {
        return filteredResults.value.map((board: any, index) =>
          mapDashboard(board, index, {
            name: board.folder_name,
            id: board.folder_id,
          }),
        );
      }
    });

    const resultTotal = computed(function () {
      if (!searchAcrossFolders.value || searchQuery.value == "") {
        return store.state.organizationData?.allDashboardList[
          activeFolderId.value
        ]?.length;
      } else {
        return filteredResults.value.length;
      }
    });

    const deleteDashboard = async () => {
      if (selectedDelete.value) {
        try {
          //delete dashboard by id and folder id
          await deleteDashboardById(
            store,
            selectedDelete.value.id,
            selectedDelete.value.folder_id
              ? selectedDelete.value.folder_id
              : (activeFolderId.value ?? "default"),
          );
          showPositiveNotification("Dashboard deleted successfully.");
        } catch (err) {
          showErrorNotification(err?.message ?? "Dashboard deletion failed", {
          });
        }
      }
    };

    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDeleteDialog.value = true;
    };

    //after adding Folder need to update the Folder list
    const updateFolderList = async (it: any) => {
      showAddFolderDialog.value = false;
      isFolderEditMode.value = false;
    };

    const editFolder = (folderId: any) => {
      selectedFolderToEdit.value = folderId;
      isFolderEditMode.value = true;
      showAddFolderDialog.value = true;
    };

    const showDeleteFolderDialogFn = (folderId: any) => {
      selectedFolderDelete.value = folderId;
      confirmDeleteFolderDialog.value = true;
    };

    const showMoveDashboardPanel = (dashboard: any) => {
      selectedDashboardIdToMove.value = [dashboard.id];
      selectedDashboardToMove.value = dashboard;
      showMoveDashboardDialog.value = true;
    };

    const handleDashboardMoved = async () => {
      showMoveDashboardDialog.value = false;
    };

    const deleteFolder = async () => {
      if (selectedFolderDelete.value) {
        try {
          //delete folder
          await deleteFolderById(store, selectedFolderDelete.value);

          //check activeFolderId to be deleted
          if (activeFolderId.value === selectedFolderDelete.value)
            activeFolderId.value = "default";

          showPositiveNotification("Folder deleted successfully.", {
          });
        } catch (err) {
          showErrorNotification(
            err?.response?.data?.message ||
              err?.message ||
              "Folder deletion failed",
            {
            },
          );
        } finally {
          confirmDeleteFolderDialog.value = false;
        }
      }
    };

    const dynamicQueryModel = computed({
      get() {
        return searchAcrossFolders.value
          ? searchQuery.value
          : filterQuery.value;
      },
      set(value) {
        if (searchAcrossFolders.value) {
          searchQuery.value = value;
        } else {
          filterQuery.value = value;
        }
      },
    });

    const fetchSearchResults = useLoading(async (query) => {
      //this is used for showing search msg when user tries to toggle every time before searching across folders
      try {
        //here we are directly calling the dashboard service to get the search results
        const response = await dashboardService.list(
          0,
          1000,
          "name",
          false,
          "",
          store.state.selectedOrganization.identifier,
          "",
          query,
        );
        if (response.config.params.title != searchQuery.value) {
          return [];
        }

        const migratedDashboards = response.data.dashboards.map(
          (dashboard: any) => ({
            dashboard: convertDashboardSchemaVersion(
              dashboard["v" + dashboard.version],
            ),
            hash: dashboard.hash.toString(),
            folder_id: dashboard.folder_id,
            folder_name: dashboard.folder_name,
          }),
        );

        return migratedDashboards;
      } catch (error) {
        showErrorNotification(
          error?.message ?? "Error fetching search results",
        );
      }
    });
    //this debounce search only makes the search call after 600ms of user input

    const debouncedSearch = debounce(async (query) => {
      if (!query) return;
      loading.value = true;
      try {
        const results = await fetchSearchResults.execute(query);
        filteredResults.value = toRaw(results);
      } finally {
        loading.value = false;
      }
    }, 600);

    const activeFolderToMove = computed(() => {
      return selectedDashboardToMove.value?.folder_id
        ? selectedDashboardToMove.value?.folder_id
        : activeFolderId.value;
    });
    const clearSearchHistory = () => {
      searchQuery.value = "";
      filteredResults.value = [];
    };
    const filteredFolders = computed(() => {
      if (!folderSearchQuery.value) return store.state.organizationData.folders;
      return store.state.organizationData.folders?.filter((folder: any) =>
        folder.name
          .toLowerCase()
          .includes(folderSearchQuery.value.toLowerCase()),
      );
    });

    const updateActiveFolderId = (folderId: any) => {
      activeFolderId.value = folderId;
      filterQuery.value = "";
      searchQuery.value = "";
    };
    const multipleExportDashboard = async () => {
      try {
        //this is used to get the dashbaords from the selected dashboard ids
        const dashboards = await Promise.all(
          selectedDashboardIds.value.map((dashboardId) =>
            getDashboard(store, dashboardId, route.query.folder),
          ),
        );
        //this is used to clean up the owner field and set the default title if missing
        const cleanedDashboards = dashboards.map((dashboard, index) => {
          dashboard.owner = "";
          dashboard.title = dashboard.title || `dashboard-${index + 1}`;
          return dashboard;
        });

        const dataStr =
          "data:text/json;charset=utf-8," +
          encodeURIComponent(JSON.stringify(cleanedDashboards, null, 2));

        // Create and trigger the download
        const htmlA = document.createElement("a");
        htmlA.setAttribute("href", dataStr);
        //the file name is exported_dashboards.json
        htmlA.setAttribute("download", "exported_dashboards.json");
        htmlA.click();

        showPositiveNotification(
          `${cleanedDashboards.length} Dashboards exported successfully.`,
        );
        selectedIds.value = [];
      } catch (error) {
        showErrorNotification(error?.message ?? "Error exporting dashboards");
      }
    };

    const moveMultipleDashboards = () => {
      //here we are showing the move dashboard dialog for multiple dashboards
      //we are assigning the selected dashboard ids to the props of move dashboard dialog
      showMoveDashboardDialog.value = true;
      selectedDashboardIdToMove.value = selectedDashboardIds.value;
    };

    const confirmBulkDelete = ref<boolean>(false);

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteDashboards = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Deleting dashboards...",
        timeout: 0,
      });

      try {
        if (selectedIds.value.length === 0) {
          toast({
            variant: "error",
            message: "No dashboards selected for deletion",
          });
          dismiss();
          return;
        }

        // Extract dashboard ids
        const payload = {
          ids: selectedDashboardIds.value,
        };

        const response = await dashboardService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload,
          activeFolderId.value,
        );

        dismiss();

        // Handle response based on successful/unsuccessful arrays
        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            // Partial success
            toast({
              variant: "warning",
              message: `${successCount} dashboard(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            toast({
              variant: "error",
              message: `Failed to delete ${failCount} dashboard(s)`,
            });
          } else {
            // All successful
            toast({
              variant: "success",
              message: `${successCount} dashboard(s) deleted successfully`,
            });
          }
        } else {
          // Fallback success message
          toast({
            variant: "success",
            message: `${selectedIds.value.length} dashboard(s) deleted successfully`,
          });
        }

        selectedIds.value = [];
        // Refresh dashboards
        await getDashboards(store, activeFolderId.value);
      } catch (error: any) {
        dismiss();
        console.error("Error deleting dashboards:", error);

        // Show error message from response if available
        const errorMessage =
          error.response?.data?.message ||
          error?.message ||
          "Error deleting dashboards. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          toast({
            variant: "error",
            message: errorMessage,
          });
        }
      }

      confirmBulkDelete.value = false;
    };



    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "dashboardsListAdd",
        handler: () => { if (!isInputFocused()) addDashboard(); },
      },
      {
        id: "dashboardsListImport",
        handler: () => { if (!isInputFocused()) importDashboard(); },
      },
      {
        id: "dashboardsListRefresh",
        handler: () => { if (!isInputFocused()) getDashboards(); },
      },
      {
        id: "dashboardsListFocusSearch",
        handler: () => {
          focusSearchInput("dashboard-search");
        },
      },
    ]);
    return {
      t,
      oTableRef,
      store,
      orgData,
      router,

      dashboards,
      dashboard,
      columns,
      loading,
      showAddDashboardDialog,
      showAddDashboardFromGitHub,
      addDashboard,
      importDashboard,
      resultTotal,
      routeToViewD,
      showDeleteDialogFn,
      confirmDeleteDialog,
      filterQuery,

      deleteDashboard,
      duplicateDashboard,
      getDashboards,
      getImageURL,
      verifyOrganizationStatus,
      activeFolderId,
      addFolder,
      showAddFolderDialog,
      addDashboardRef,
      addFolderRef,
      isFolderEditMode,
      updateFolderList,
      editFolder,
      deleteFolder,
      showDeleteFolderDialogFn,
      confirmDeleteFolderDialog,
      showMoveDashboardPanel,
      selectedFolderToEdit,
      selectedDashboardToMove,
      selectedDashboardIdToMove,
      showMoveDashboardDialog,
      handleDashboardMoved,
      searchAcrossFolders,
      searchQuery,
      fetchSearchResults,
      debouncedSearch,
      filteredResults,
      activeFolderToMove,
      clearSearchHistory,
      dynamicQueryModel,
      folderSearchQuery,
      filteredFolders,
      updateActiveFolderId,
      selectedIds,
      multipleExportDashboard,
      moveMultipleDashboards,
      openBulkDeleteDialog,
      bulkDeleteDashboards,
      confirmBulkDelete,
    };
  },
  methods: {
    //after adding dashboard need to update the dashboard list
    async updateDashboardList(dashboardId: any, folderId: any) {
      this.showAddDashboardDialog = false;

      //on add dashboard route to dashboard view
      // new dashboard will have single tab which will have id as default
      this.$router.push({
        path: "/dashboards/view/",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
          dashboard: dashboardId,
          folder: folderId,
          tab: "default",
        },
      });
    },
    onRowClick(row, _evt) {
      this.routeToViewD(row);
    },
    ownerInitials(name: string) {
      if (!name) return "";
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },
  },
});
</script>
