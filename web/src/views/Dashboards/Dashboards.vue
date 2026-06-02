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
  <div
    class="tw:flex tw:flex-col"
    :key="store.state.selectedOrganization.identifier"
    :style="{ height: 'calc(100vh - var(--navbar-height))' }"
  >
    <!-- searchBar at top -->

    <div class="tw:shrink-0 tw:px-[0.625rem] tw:pt-[0.625rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="tw:flex tw:justify-between tw:items-center tw:py-3 tw:px-4 tw:h-[68px]"
        >

          <div class="tw:text-xl tw:tracking-[0.005em]">{{ t("dashboard.header") }}</div>

          <div
            class="tw:flex tw:flex-row tw:gap-x-2 tw:justify-end tw:items-center"
          >
            <OSearchInput
              v-model="dynamicQueryModel"
              :placeholder="
                searchAcrossFolders
                  ? t('dashboard.searchAcross')
                  : t('dashboard.search')
              "
              @clear="clearSearchHistory"
              data-test="dashboard-search"
            />

            <OSwitch
              data-test="dashboard-search-across-folders-toggle"
              v-model="searchAcrossFolders"
              label="All Folders"
              size="lg"
              class="tw:h-8 tw:px-2 tw:border tw:border-[var(--color-button-outline-border)] tw:rounded-md tw:flex tw:items-center tw:justify-center tw:whitespace-nowrap"
            >
              <template #tooltip>
                <OTooltip
                  :content="
                    searchAcrossFolders
                      ? t('dashboard.searchSelf')
                      : t('dashboard.searchAll')
                  "
                />
              </template>
            </OSwitch>

            <!-- import dashboard button with dropdown -->
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  variant="outline"
                  size="sm"
                  data-test="dashboard-import"
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
                  <span>Custom</span>
                  <span
                    class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60"
                    >Import from JSON file or URL</span
                  >
                </div>
              </ODropdownItem>
              <ODropdownItem
                @select="showAddDashboardFromGitHub = true"
                data-test="dashboard-import-templates"
              >
                <div class="tw:flex tw:flex-col">
                  <span>Templates</span>
                  <span
                    class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60"
                    >Browse and import from gallery</span
                  >
                </div>
              </ODropdownItem>
            </ODropdown>
            <!-- new dashboard button -->
            <OButton
              variant="primary"
              size="sm"
              data-test="dashboard-new"
              @click="addDashboard"
            >
              {{ t(`dashboard.add`) }}
            </OButton>
          </div>
        </div>
      </div>
    </div>
    <div
      class="tw:flex-1 tw:flex tw:min-h-0 tw:px-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.625rem]"
    >
      <!-- Left: FolderList -->
      <div
        class="tw:shrink-0 tw:h-full"
        :style="{ width: splitterModel + 'px' }"
      >
        <div class="tw:h-full">
          <div
            class="card-container tw:h-full tw:flex tw:flex-col tw:pb-[0.3rem]"
          >
            <!-- folder list starts here -->
            <div
              class="dashboard-folder-header dashboard-sticky-top"
              :class="
                store.state.theme === 'dark'
                  ? 'dashboard-folder-header-dark'
                  : 'dashboard-folder-header-light'
              "
            >
              <div
                class="tw:font-bold tw:px-2 tw:py-2 tw:flex tw:items-center tw:justify-between tw:gap-2"
              >
                {{ t("dashboard.folderLabel") }}
                <div>
                  <OButton
                    variant="outline"
                    size="icon"
                    icon-left="add"
                    class="tw:h-7 tw:w-8"
                    @click.stop="addFolder"
                    data-test="dashboard-new-folder-btn"
                    title="Add Folder"
                  />
                </div>
              </div>
              <OSeparator class="tw:h-[2px] tw:mb-1 tw:mt-[3px]" />
              <!-- Search Input -->
              <div class="tw:flex folder-item tw:py-1 tw:w-full tw:px-2">
                <OSearchInput
                  v-model="folderSearchQuery"
                  data-test="folder-search"
                  placeholder="Search Folder"
                  clearable
                  class="tw:w-full"
                />
                <div></div>
              </div>
            </div>
            <div class="dashboards-tabs tw:flex-1 tw:overflow-y-auto">
              <OTabs
                orientation="vertical"
                v-model="activeFolderId"
                data-test="dashboards-folder-tabs"
              >
                <OTab
                  v-for="(tab, index) in filteredFolders"
                  :key="tab.folderId"
                  :name="tab.folderId"
                  class="individual-tab"
                  :data-test="`dashboard-folder-tab-${tab.folderId}`"
                  :data-test-folder-name="tab.name"
                >
                  <div
                    class="folder-item tw:w-full tw:flex tw:justify-between tw:flex-nowrap tw:group/row"
                    :data-test="`dashboard-folder-tab-name-${tab.name}`"
                  >
                    <span
                      class="folder-name text-truncate"
                      :title="tab.name"
                      :data-test="`dashboard-folder-name-${tab.name}`"
                    >{{
                      tab.name
                    }}</span>
                    <div
                      class="tw:invisible tw:group-hover/row:visible tw:has-[[data-state=open]]:visible tw:flex tw:items-center tw:absolute tw:right-0 tw:top-1/2 tw:-translate-y-1/2"
                    >
                      <ODropdown
                        v-if="
                          index ||
                          (folderSearchQuery?.length > 0 &&
                            index == 0 &&
                            tab.folderId.toLowerCase() != 'default')
                        "
                        side="bottom"
                        align="start"
                      >
                        <template #trigger>
                          <OButton
                            size="icon"
                            variant="ghost"
                            icon-left="more-vert"
                            class="tw:h-6 tw:w-6"
                            data-test="dashboard-more-icon"
                          />
                        </template>
                        <ODropdownItem
                          @select="editFolder(tab.folderId)"
                          data-test="dashboard-edit-folder-icon"
                        >
                          <template #icon-left>
                            <OIcon name="edit" size="xs" />
                          </template>
                          Edit
                        </ODropdownItem>
                        <ODropdownItem
                          @select="showDeleteFolderDialogFn(tab.folderId)"
                          data-test="dashboard-delete-folder-icon"
                        >
                          <template #icon-left>
                            <OIcon name="delete" size="xs" />
                          </template>
                          Delete
                        </ODropdownItem>
                      </ODropdown>
                    </div>
                  </div>
                </OTab>
              </OTabs>
            </div>
          </div>
        </div>
      </div>
      <!-- Right: Table -->
      <div class="tw:flex-1 tw:min-w-0 tw:h-full">
        <div class="tw:h-full card-container">

          <!-- add dashboard table -->
          <OTable
            ref="oTableRef"
            :data="dashboards"
            :columns="columns"
            row-key="id"
            :loading="loading"
            :global-filter="filterQuery"
            :show-global-filter="false"
            :footer-title="t('dashboard.header')"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            selection="multiple"
            v-model:selected-ids="selectedIds"
            @row-click="onRowClick"
            data-test="dashboard-table"
            style="width: 100%; height: 100%"
          >
            <template #cell-name="{ row, value }">
              <div
                :title="value"
                :data-test="`dashboard-name-cell-${value}`"
                class="text-truncate"
              >
                {{
                  value && value.length > 30
                    ? value.slice(0, 30) + "..."
                    : value
                }}
                <OTooltip
                  v-if="value && value.length > 30"
                  :content="value"
                  max-width="300px"
                />
              </div>
            </template>
            <template #cell-description="{ row, value }">
              <div :title="value">
                {{
                  value && value.length > 30
                    ? value.slice(0, 30) + "..."
                    : value
                }}
              </div>
            </template>
            <template #cell-folder="{ row }">
              <div @click.stop="updateActiveFolderId(row.folder_id)">
                {{ row.folder }}
              </div>
            </template>
            <template #cell-actions="{ row }">
              <div class="tw:flex tw:items-center actions-container">
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="drive-file-move"
                  :title="t('dashboard.move_to_another_folder')"
                  variant="ghost"
                  size="icon-sm"
                  data-test="dashboard-move-to-another-folder"
                  @click.stop="showMoveDashboardPanel(row)"
                />
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="content-copy"
                  :title="t('dashboard.duplicate')"
                  variant="ghost"
                  size="icon-sm"
                  data-test="dashboard-duplicate"
                  @click.stop="duplicateDashboard(row.id, row.folder_id)"
                />
                <OButton
                  v-if="row.actions == 'true'"
                  icon-left="delete"
                  :title="t('dashboard.delete')"
                  variant="ghost-destructive"
                  size="icon-sm"
                  data-test="dashboard-delete"
                  @click.stop="showDeleteDialogFn({ row })"
                />
              </div>
            </template>
            <template #empty>
              <NoData />
            </template>
            <template #bottom>
              <div class="bottom-btn tw:py-2">
                <div
                  class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-md"
                >
                  {{ resultTotal }} {{ t("dashboard.header") }}
                </div>
                <div class="bottom-btn-dashboard-list">
                  <OButton
                    v-if="selectedIds.length > 0"
                    variant="outline"
                    size="sm"
                    class="tw:mr-2 tw:h-9"
                    data-test="dashboard-list-move-across-folders-btn"
                    @click="moveMultipleDashboards"
                    icon-left="drive-file-move"
                  >
                    Move
                  </OButton>
                  <OButton
                    v-if="selectedIds.length > 0"
                    variant="outline"
                    size="sm"
                    class="tw:mr-2 tw:h-9"
                    icon-left="download"
                    data-test="dashboard-list-export-dashboards-btn"
                    @click="multipleExportDashboard"
                  >
                    Export
                  </OButton>
                  <OButton
                    v-if="selectedIds.length > 0"
                    variant="outline-destructive"
                    size="sm"
                    class="tw:mr-2 tw:h-9"
                    icon-left="delete"
                    data-test="dashboard-list-delete-dashboards-btn"
                    @click="openBulkDeleteDialog"
                  >
                    Delete
                  </OButton>
                </div>
              </div>
            </template>
          </OTable>

          <!-- add dashboard -->
          <ODrawer
            v-model:open="showAddDashboardDialog"
            :width="30"
            :title="t('dashboard.createdashboard')"
            data-test="dashboard-add-dialog"
            :secondary-button-label="t('dashboard.cancel')"
            :primary-button-label="t('dashboard.save')"
            @click:secondary="showAddDashboardDialog = false"
            @click:primary="addDashboardRef?.submit()"
          >
            <AddDashboard
              ref="addDashboardRef"
              @close="showAddDashboardDialog = false"
              @updated="updateDashboardList"
              :activeFolderId="activeFolderId"
            />
          </ODrawer>

          <!-- add dashboard from GitHub gallery -->
          <AddDashboardFromGitHub
            v-model="showAddDashboardFromGitHub"
            @added="getDashboards"
          />

          <!-- add/edit folder -->
          <ODrawer
            v-model:open="showAddFolderDialog"
            :width="30"
            :title="
              isFolderEditMode
                ? t('dashboard.updateFolder')
                : t('dashboard.newFolder')
            "
            data-test="dashboard-folder-dialog"
            :secondary-button-label="t('dashboard.cancel')"
            :primary-button-label="t('dashboard.save')"
            @click:secondary="showAddFolderDialog = false"
            @click:primary="addFolderRef?.submit()"
          >
            <AddFolder
              ref="addFolderRef"
              @update:modelValue="updateFolderList"
              :edit-mode="isFolderEditMode"
              :folder-id="selectedFolderToEdit ?? 'default'"
            />
          </ODrawer>

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
            title="Delete dashboard"
            data-test="dashboard-confirm-dialog"
            message="Are you sure you want to delete the dashboard?"
            @update:ok="deleteDashboard"
            @update:cancel="confirmDeleteDialog = false"
            v-model="confirmDeleteDialog"
          />

          <!-- delete folder dialog -->
          <ConfirmDialog
            title="Delete Folder"
            data-test="dashboard-confirm-delete-folder-dialog"
            message="Are you sure you want to delete this Folder?"
            @update:ok="deleteFolder"
            @update:cancel="confirmDeleteFolderDialog = false"
            v-model="confirmDeleteFolderDialog"
          />

          <!-- bulk delete dashboards dialog -->
          <ConfirmDialog
            title="Delete Dashboards"
            data-test="dashboard-confirm-bulk-delete-dialog"
            :message="`Are you sure you want to delete ${selectedIds.length} dashboard(s)?`"
            @update:ok="bulkDeleteDashboards"
            @update:cancel="confirmBulkDelete = false"
            v-model="confirmBulkDelete"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
// @ts-nocheck
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { useStore } from "vuex";
import { formatDate } from "@/utils/date";
import { useI18n } from "vue-i18n";

import dashboardService from "../../services/dashboards";
import OTable from "@/lib/core/Table/OTable.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import NoData from "../../components/shared/grid/NoData.vue";
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
import useNotifications from "@/composables/useNotifications";
import { debounce, filter, forIn } from "lodash-es";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { useLoading } from "@/composables/useLoading";
import { useReo } from "@/services/reodotdev_analytics";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import type { AiDashboardEvent } from "@/composables/useAiDashboardEvents";
import { toast } from "@/lib/feedback/Toast/useToast";

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
    OSeparator,
    OTabs,
    OTab,
    OButton,
    OIcon,
    ODropdown,
    ODropdownItem,
    OSearchInput,
    OSwitch,
    OCheckbox,
    ODrawer,
    AddDashboard,
    OTooltip,
    AddDashboardFromGitHub,
    OTable,
    NoData,
    ConfirmDialog,
    AddFolder,
    MoveDashboardToAnotherFolder,
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
    const splitterModel = ref(200);
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
          size: 67,
          meta: { align: "left" },
        },
        {
          id: "name",
          header: t("dashboard.name"),
          accessorKey: "name",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "identifier",
          header: t("dashboard.identifier"),
          accessorKey: "identifier",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "description",
          header: t("dashboard.description"),
          accessorKey: "description",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "owner",
          header: t("dashboard.owner"),
          accessorKey: "owner",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "created",
          header: t("dashboard.created"),
          accessorKey: "created",
          sortable: true,
          meta: { align: "left" },
        },
        {
          id: "actions",
          header: t("dashboard.actions"),
          sortable: false,
          isAction: true,
          meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
        },
      ];

      if (searchAcrossFolders.value && searchQuery.value != "") {
        baseColumns.splice(2, 0, {
          id: "folder",
          header: t("dashboard.folder"),
          accessorKey: "folder",
          sortable: true,
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
            if (!error.name === "AbortError") {
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
    const loading = ref(false);
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
      splitterModel,
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
  },
});
</script>

<style lang="scss" scoped>
.dashboards-tabs {
  .o-tabs {
    height: auto !important;
    max-height: none !important;
  }

  .individual-tab {
    min-height: 1.5rem;
  }
  .folder-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    border-radius: 0.25rem;
    transition: background-color 0.3s;

    // .folder-name {
    //   white-space: nowrap;
    //   overflow: hidden;
    //   text-overflow: ellipsis;
    // }
  }

  .o-tabs {
    &--vertical {
      margin: 5px;

      .o-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
        text-transform: capitalize;

        &__content.tab_content {
          .o-tab {
            &__icon + &__label {
              padding-left: 0.875rem;
              font-weight: 600;
            }
          }
        }

        &--active {
          background-color: var(--o2-primary-btn-bg);
          color: white;
        }
      }
    }
  }
}

.folder-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none !important;
}
.dashboard-folder-header {
  &.dashboard-sticky-top {
    position: sticky;
    top: 0;
    z-index: 10;
  }

  &.dashboard-folder-header-light {
    background-color: white;
  }

  &.dashboard-folder-header-dark {
    background-color: #1a1a1a;
  }
  border-radius: 0.625rem;
}

// Toolbar Icon and Toggle Styles
.toolbar-toggle-container {
  padding: 0.45rem 0.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.0625rem solid var(--color-button-outline-border); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background-color: var(--o2-hover-accent);
  }
}

.dark-theme .toolbar-toggle-container {
  border: 0.0625rem solid var(--color-button-outline-border);
}

.bottom-btn-dashboard-list {
  display: flex;
  width: 100%;
  align-items: center;
}

.move-btn-dashboard-list {
  width: calc(10vw);
}

.export-btn-dashboard-list {
  width: calc(10vw);
}

.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}
</style>
