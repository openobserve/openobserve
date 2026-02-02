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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div
    class="q-pa-none flex flex-col"
    :key="store.state.selectedOrganization.identifier"
  >
    <!-- searchBar at top -->
     <div class="tw:w-full tw:px-[0.625rem] tw:mb-[0.625rem] q-pt-xs">
      <div class="card-container">
        <div class="flex justify-between full-width tw:py-3 tw:px-4 items-center">
            <div class="q-table__title">{{ t("dashboard.header") }}</div>

              <div class="flex q-ml-auto tw:ps-2">
                <q-input
                  v-model="dynamicQueryModel"
                  dense
                  borderless
                  :placeholder="
                    searchAcrossFolders
                      ? t('dashboard.searchAcross')
                      : t('dashboard.search')
                  "
                  data-test="dashboard-search"
                  :clearable="searchAcrossFolders"
                  @clear="clearSearchHistory"
                  class="o2-search-input"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-search-input-dark'
                      : 'o2-search-input-light'
                  "
                hide-bottom-space>
                  <template #prepend>
                    <q-icon
                      class="o2-search-input-icon"
                      :class="
                        store.state.theme === 'dark'
                          ? 'o2-search-input-icon-dark'
                          : 'o2-search-input-icon-light'
                      "
                      name="search"
                    />
                  </template>
                </q-input>
              </div>
              <div class="tw:mb-2">
                <q-toggle
                  data-test="dashboard-search-across-folders-toggle"
                  v-model="searchAcrossFolders"
                  label="All Folders"
                  size="lg"
                  class="q-ml-sm tw:h-[36px] o2-toggle-button-lg"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-toggle-button-lg-dark'
                      : 'o2-toggle-button-lg-light'
                  "
                >
                </q-toggle>
                <q-tooltip class="q-mt-lg" anchor="top middle" self="bottom middle">
                  {{
                    searchAcrossFolders
                      ? t("dashboard.searchSelf")
                      : t("dashboard.searchAll")
                  }}
                </q-tooltip>
              </div>
              <q-btn
                class="q-ml-sm o2-secondary-button tw:h-[36px]"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-secondary-button-dark'
                    : 'o2-secondary-button-light'
                "
                no-caps
                flat
                :label="t(`dashboard.import`)"
                @click="importDashboard"
                data-test="dashboard-import"
              />
              <!-- add dashboard button -->
              <q-btn
                class="q-ml-sm o2-primary-button tw:h-[36px]"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-primary-button-dark'
                    : 'o2-primary-button-light'
                "
                no-caps
                flat
                data-test="dashboard-add"
                :label="t(`dashboard.add`)"
                @click="addDashboard"
              />
        </div>
      </div>
     </div>
     <div 
      class="full-width alert-list-table"
      style="height: calc(100vh - 116px)"
     >
       <q-splitter
            v-model="splitterModel"
            unit="px"
            :limits="[200, 500]"
            style="height: calc(100vh - 116px)"
            data-test="dashboard-splitter"
    >
      <template v-slot:before>
        <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
        <div class="tw:h-full">
          <div class="card-container tw:h-full tw:flex tw:flex-col tw:pb-[0.3rem]">
          <!-- folder list starts here -->
          <div
            class="dashboard-folder-header dashboard-sticky-top "
            :class="
              store.state.theme === 'dark'
                ? 'dashboard-folder-header-dark'
                : 'dashboard-folder-header-light'
            "
          >
            <div
              class="text-bold q-px-sm q-py-sm tw:flex tw:items-center tw:justify-between tw:gap-2"
            >
              {{ t("dashboard.folderLabel") }}
              <div>
                <q-btn
                  class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-secondary-button-dark'
                      : 'o2-secondary-button-light'
                  "
                  no-caps
                  flat
                  @click.stop="addFolder"
                  data-test="dashboard-new-folder-btn"
                  title="Add Folder"
                >
                  <q-icon name="add" size="xs" />
                </q-btn>
              </div>
            </div>
            <q-separator class="tw:mb-1 tw:mt-[3px]" size="2px"></q-separator>
            <!-- Search Input -->
            <div style="width: 100%" class="flex folder-item q-py-xs">
              <q-input
                v-model="folderSearchQuery"
                dense
                borderless
                data-test="folder-search"
                placeholder="Search Folder"
                style="width: 100%"
                clearable
                class="tw:mx-2 q-px-xs"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-search-input-dark'
                    : 'o2-search-input-light'
                "
               hide-bottom-space>
                <template #prepend>
                  <q-icon
                    class="o2-search-input-icon"
                    :class="
                      store.state.theme === 'dark'
                        ? 'o2-search-input-icon-dark'
                        : 'o2-search-input-icon-light'
                    "
                    name="search"
                  />
                </template>
              </q-input>
              <div></div>
            </div>
          </div>
          <div class="dashboards-tabs tw:flex-1 tw:overflow-y-auto">
            <q-tabs
              indicator-color="transparent"
              inline-label
              vertical
              v-model="activeFolderId"
              data-test="dashboards-folder-tabs"
            >
              <q-tab
                v-for="(tab, index) in filteredFolders"
                :key="tab.folderId"
                :name="tab.folderId"
                content-class="tab_content full-width"
                class="individual-tab"
                :data-test="`dashboard-folder-tab-${tab.folderId}`"
              >
                <div class="folder-item full-width row justify-between no-wrap">
                  <span class="folder-name text-truncate" :title="tab.name">{{
                    tab.name
                  }}</span>
                  <div class="hover-actions">
                    <q-btn
                      v-if="
                        index ||
                        (folderSearchQuery?.length > 0 &&
                          index == 0 &&
                          tab.folderId.toLowerCase() != 'default')
                      "
                      dense
                      flat
                      no-caps
                      icon="more_vert"
                      style="cursor: pointer; justify-self: end; height: 0.5rem"
                      size="sm"
                      data-test="dashboard-more-icon"
                    >
                      <q-menu>
                        <q-list dense>
                          <q-item
                            v-close-popup
                            clickable
                            @click.stop="editFolder(tab.folderId)"
                            data-test="dashboard-edit-folder-icon"
                          >
                            <q-item-section avatar>
                              <q-icon :name="outlinedEdit" size="xs" />
                            </q-item-section>
                            <q-item-section>
                              <q-item-label>Edit</q-item-label>
                            </q-item-section>
                          </q-item>
                          <q-item
                            v-close-popup
                            clickable
                            @click.stop="showDeleteFolderDialogFn(tab.folderId)"
                            data-test="dashboard-delete-folder-icon"
                          >
                            <q-item-section avatar>
                              <q-icon :name="outlinedDelete" size="xs" />
                            </q-item-section>
                            <q-item-section>
                              <q-item-label>Delete</q-item-label>
                            </q-item-section>
                          </q-item>
                        </q-list>
                      </q-menu>
                    </q-btn>
                  </div>
                </div>
                <q-separator />
              </q-tab>
            </q-tabs>
          </div>
        </div>
        </div>
        </div>
      </template>
      <template v-slot:after>
          <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
            <div class="tw:h-full card-container">
          <!-- add dashboard table -->
          <q-table
            ref="qTable"
            :rows="dashboards"
            :columns="columns"
            row-key="id"
            :pagination="pagination"
            :filter="filterQuery"
            :filter-method="filterData"
            v-model:selected="selected"
            selection="multiple"
            :loading="loading"
            @row-click="onRowClick"
            data-test="dashboard-table"
            :style="
              !filterQuery.length && dashboards.length > 0
                ? 'height: calc(100vh - 124px)'
                : ''
            "
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          >
            <!-- if data not available show nodata component -->
            <template #no-data>
              <NoData />
            </template>
            <!-- we need to handle custom header for the table -->
            <!-- so we manually added check box and all the columns -->
            <template v-slot:header="props">
              <q-tr :props="props">
                <!-- Adding this block to render the select-all checkbox -->
                <q-th auto-width>
                  <q-checkbox
                    v-model="props.selected"
                    size="sm"
                    class="o2-table-checkbox"
                    @update:model-value="props.select"
                  />
                </q-th>

                <!-- Rendering the rest of the columns -->
                <!-- here passing the classes and style to the columns -->
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
            <!-- body selection which on click selects the dashboard -->
            <template #body-selection="scope">
              <q-checkbox
                v-model="scope.selected"
                size="sm"
                :class="
                  store.state.theme === 'dark'
                    ? 'o2-table-checkbox-dark'
                    : 'o2-table-checkbox-light'
                "
                class="o2-table-checkbox"
              />
            </template>
            <template #body-cell-name="props">
              <q-td :props="props">
                <div :title="props.value" class="text-truncate">
                  {{
                    props.value && props.value.length > 30
                      ? props.value.slice(0, 30) + "..."
                      : props.value
                  }}
                  <q-tooltip
                    v-if="props.value && props.value.length > 30"
                    class="q-mt-lg tw:w-[300px]"
                    anchor="top middle"
                    self="bottom middle"
                  >
                    {{ props.value }}
                  </q-tooltip>
                </div>
              </q-td>
            </template>
            <template #body-cell-description="props">
              <q-td :props="props">
                <div :title="props.value">
                  {{
                    props.value && props.value.length > 30
                      ? props.value.slice(0, 30) + "..."
                      : props.value
                  }}
                </div>
              </q-td>
            </template>
            <template #body-cell-folder="props">
              <q-td :props="props">
                <div @click.stop="updateActiveFolderId(props.row.folder_id)">
                  {{ props.row.folder }}
                </div>
              </q-td>
            </template>
            <!-- add delete icon in actions column -->
            <template #body-cell-actions="props">
              <q-td :props="props">
                <q-btn
                  v-if="props.row.actions == 'true'"
                  :title="t('dashboard.move_to_another_folder')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  :icon="outlinedDriveFileMove"
                  @click.stop="showMoveDashboardPanel(props.row)"
                  data-test="dashboard-move-to-another-folder"
                >
              </q-btn>
                <q-btn
                  v-if="props.row.actions == 'true'"
                  :title="t('dashboard.duplicate')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  icon="content_copy"
                  @click.stop="
                    duplicateDashboard(props.row.id, props.row.folder_id)
                  "
                  data-test="dashboard-duplicate"
                >
              </q-btn>
                <q-btn
                  v-if="props.row.actions == 'true'"
                  :title="t('dashboard.delete')"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  :icon="outlinedDelete"
                  data-test="dashboard-delete"
                  flat
                  @click.stop="showDeleteDialogFn(props)"
                >
              </q-btn>
              </q-td>
            </template>
            <template #bottom="scope">
              <div class="bottom-btn tw:h-[48px]">
                <div
                  class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-md"
                >
                  {{ resultTotal }} {{ t("dashboard.header") }}
                </div>
                <div class="bottom-btn-dashboard-list">
                  <q-btn
                    v-if="selected.length > 0"
                    data-test="dashboard-list-move-across-folders-btn"
                    class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                    :class="
                      store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    @click="moveMultipleDashboards"
                  >
                    <q-icon :name="outlinedDriveFileMove" size="16px" />
                    <span class="tw:ml-2">Move</span>
                  </q-btn>
                  <q-btn
                    v-if="selected.length > 0"
                    data-test="dashboard-list-export-dashboards-btn"
                    class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                    :class="
                      store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    @click="multipleExportDashboard"
                  >
                    <q-icon name="download" size="16px" />
                    <span class="tw:ml-2">Export</span>
                  </q-btn>
                  <q-btn
                    v-if="selected.length > 0"
                    data-test="dashboard-list-delete-dashboards-btn"
                    class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                    :class="
                      store.state.theme === 'dark'
                        ? 'o2-secondary-button-dark'
                        : 'o2-secondary-button-light'
                    "
                    @click="openBulkDeleteDialog"
                  >
                    <q-icon name="delete" size="16px" />
                    <span class="tw:ml-2">Delete</span>
                  </q-btn>
                </div>
                <QTablePagination
                  :scope="scope"
                  :resultTotal="resultTotal"
                  :perPageOptions="perPageOptions"
                  position="bottom"
                  @update:changeRecordPerPage="changePagination"
                  @update:maxRecordToReturn="changeMaxRecordToReturn"
                />
              </div>
            </template>
          </q-table>

          <!-- add dashboard -->
          <q-dialog
            v-model="showAddDashboardDialog"
            position="right"
            full-height
            maximized
            data-test="dashboard-add-dialog"
          >
            <AddDashboard
              style="width: 30vw"
              @updated="updateDashboardList"
              :activeFolderId="activeFolderId"
            />
          </q-dialog>

          <!-- add/edit folder -->
          <q-dialog
            v-model="showAddFolderDialog"
            position="right"
            full-height
            maximized
            data-test="dashboard-folder-dialog"
          >
            <AddFolder
              style="width: 30vw"
              @update:modelValue="updateFolderList"
              :edit-mode="isFolderEditMode"
              :folder-id="selectedFolderToEdit ?? 'default'"
            />
          </q-dialog>

          <!-- move dashboard to another folder -->
          <q-dialog
            v-model="showMoveDashboardDialog"
            position="right"
            full-height
            maximized
            data-test="dashboard-move-to-another-folder-dialog"
          >
            <MoveDashboardToAnotherFolder
              @updated="handleDashboardMoved"
              :dashboard-ids="selectedDashboardIdToMove"
              :activeFolderId="activeFolderToMove"
            />
          </q-dialog>

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
            :message="`Are you sure you want to delete ${selected.length} dashboard(s)?`"
            @update:ok="bulkDeleteDashboards"
            @update:cancel="confirmBulkDelete = false"
            v-model="confirmBulkDelete"
          />
        </div>
        </div>
      </template>
    </q-splitter>
     </div>
  </div>
</template>

<script lang="ts">
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
import { useQuasar, date, debounce } from "quasar";
import { useI18n } from "vue-i18n";

import dashboardService from "../../services/dashboards";
import QTablePagination from "../../components/shared/grid/Pagination.vue";
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
import {
  outlinedDelete,
  outlinedDriveFileMove,
  outlinedEdit,
} from "@quasar/extras/material-icons-outlined";
import AddFolder from "../../components/dashboards/AddFolder.vue";
import useNotifications from "@/composables/useNotifications";
import { filter, forIn } from "lodash-es";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { useLoading } from "@/composables/useLoading";
import { useReo } from "@/services/reodotdev_analytics";

const MoveDashboardToAnotherFolder = defineAsyncComponent(() => {
  return import("@/components/dashboards/MoveDashboardToAnotherFolder.vue");
});

const AddDashboard = defineAsyncComponent(() => {
  return import("@/components/dashboards/AddDashboard.vue");
});

export default defineComponent({
  name: "Dashboards",
  components: {
    AddDashboard,
    QTablePagination,
    NoData,
    ConfirmDialog,
    AddFolder,
    MoveDashboardToAnotherFolder,
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
    const selected = ref([]);
    const { track } = useReo();

    const { showPositiveNotification, showErrorNotification } =
      useNotifications();

    let currentSearchAbortController = null;
    const columns = computed(() => {
      // Define the default columns
      const baseColumns = [
        {
          name: "#",
          label: "#",
          field: "#",
          align: "left",
          style: "width: 67px",
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
          classes: "actions-column", //this is the class that we are adding to the actions column so that we can apply the styling to the actions column only
        },
      ];

      // Conditionally add the "folder" column
      if (searchAcrossFolders.value && searchQuery.value != "") {
        baseColumns.splice(2, 0, {
          name: "folder",
          field: "folder",
          label: t("dashboard.folder"),
          align: "left",
          sortable: true,
        });
      }

      return baseColumns;
    });
    const selectedDashboardIds = computed(() =>
      selected.value.length > 0 ? selected.value.map((row) => row.id) : [],
    );

    const perPageOptions = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });

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
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait while loading dashboards...",
        });
        //resetting the selected dashboards if any so that when shifting to another folder and reswitching to same folder
        //the selected dashboards are not shown
        selected.value = [];
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
          dismiss();
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
          // const searchResults = await fetchSearchResults.execute(searchQuery.value);
          // filteredResults.value = toRaw(searchResults);
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
      if (qTable.value) {
        qTable.value = null;
      }

      // Clear arrays and objects
      dashboardList.value = [];
      filteredResults.value = [];
      selected.value = [];

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

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = async (val: any) => {
      maxRecordToReturn.value = val;
      await getDashboards();
    };
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
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
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
    const getDashboards = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading dashboards...",
      });
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
      created: date.formatDate(
        folderInfo ? board.dashboard.created : board.created,
        "YYYY-MM-DDTHH:mm:ssZ",
      ),
      actions: "true",
    });

    const dashboards = computed(function () {
      selected.value = [];
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
            timeout: 2000,
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
            timeout: 2000,
          });
        } catch (err) {
          showErrorNotification(
            err?.response?.data?.message ||
              err?.message ||
              "Folder deletion failed",
            {
              timeout: 2000,
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
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while searching for dashboards...",
      });
      const results = await fetchSearchResults.execute(query);
      dismiss();
      filteredResults.value = toRaw(results);
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
        selected.value = [];
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
      const dismiss = $q.notify({
        spinner: true,
        message: "Deleting dashboards...",
        timeout: 0,
      });

      try {
        if (selected.value.length === 0) {
          $q.notify({
            type: "negative",
            message: "No dashboards selected for deletion",
            timeout: 2000,
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
          activeFolderId.value
        );

        dismiss();

        // Handle response based on successful/unsuccessful arrays
        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            // Partial success
            $q.notify({
              type: "warning",
              message: `${successCount} dashboard(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            $q.notify({
              type: "negative",
              message: `Failed to delete ${failCount} dashboard(s)`,
              timeout: 3000,
            });
          } else {
            // All successful
            $q.notify({
              type: "positive",
              message: `${successCount} dashboard(s) deleted successfully`,
              timeout: 2000,
            });
          }
        } else {
          // Fallback success message
          $q.notify({
            type: "positive",
            message: `${selected.value.length} dashboard(s) deleted successfully`,
            timeout: 2000,
          });
        }

        selected.value = [];
        // Refresh dashboards
        await getDashboards(store, activeFolderId.value);
      } catch (error: any) {
        dismiss();
        console.error("Error deleting dashboards:", error);

        // Show error message from response if available
        const errorMessage = error.response?.data?.message || error?.message || "Error deleting dashboards. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          $q.notify({
            type: "negative",
            message: errorMessage,
            timeout: 3000,
          });
        }
      }

      confirmBulkDelete.value = false;
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
      importDashboard,
      pagination,
      resultTotal,
      perPageOptions,
      selectedPerPage,
      changePagination,
      maxRecordToReturn,
      changeMaxRecordToReturn,
      outlinedDelete,
      outlinedEdit,
      outlinedDriveFileMove,
      routeToViewD,
      showDeleteDialogFn,
      confirmDeleteDialog,
      filterQuery,
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
      activeFolderId,
      addFolder,
      showAddFolderDialog,
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
      selected,
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
    onRowClick(evt, row) {
      this.routeToViewD(row);
    },
  },
});
</script>

<style lang="scss" scoped>
.dashboards-tabs {
  .q-tabs {
    height: auto !important;
    max-height: none !important;
  }

  .individual-tab {
    min-height: 1.5rem;
    margin-bottom: 6px;
    border-bottom: 1px lightgray dotted;
  }
  .folder-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    border-radius: 0.25rem;
    transition: background-color 0.3s;

    &:hover {
      .hover-actions {
        display: flex;
      }
    }

    // .folder-name {
    //   white-space: nowrap;
    //   overflow: hidden;
    //   text-overflow: ellipsis;
    // }

    .hover-actions {
      display: none;
      align-items: center;

      .q-btn {
        margin-left: 0.5rem;
      }
    }
  }

  .q-tabs {
    &--vertical {
      margin: 5px;

      .q-tab {
        justify-content: flex-start;
        padding: 0 1rem 0 1.25rem;
        border-radius: 0.5rem;
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
