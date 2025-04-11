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
    <div class="text-bold q-px-md q-pt-sm">
       Folders
    </div>
    <div class="folders-tabs">
    <!-- Search Input -->
    <div style="width: 100%;" class="flex folder-item q-py-xs">
          <q-input
          v-model="searchQuery"   
          dense
          filled
          borderless
          data-test="folder-search"
          placeholder="Search Folder"
          style="width: 100%;"
          clearable
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
              <div>
        </div>
          </div>
      <q-tabs
        indicator-color="transparent"
        inline-label
        vertical
        v-model="activeFolderId"
        data-test="dashboards-folder-tabs"
    >
        <q-tab
        v-for="(tab, index) in filteredTabs"
        :key="tab.folderId"
        :name="tab.folderId"
        content-class="tab_content full-width"
        class="test-class"
        :data-test="`dashboard-folder-tab-${tab.folderId}`"
        >
        <div class="folder-item full-width row justify-between no-wrap">
            <span class="folder-name" :title="tab.name">{{
            tab.name
            }}</span>
            <div class="hover-actions">
            <q-btn
                v-if="index || (searchQuery?.length > 0 && index ==  0 && tab.folderId.toLowerCase() != 'default') "
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
    <div
        class="row justify-center full-width q-px-xs q-pb-xs"
        style="position: sticky; bottom: 0px"
    >
      <q-btn
          class="text-bold no-border full-width"
          padding="sm lg"
          color="secondary"
          no-caps
          label="New Folder"
          @click.stop="addFolder"
          data-test="dashboard-new-folder-btn"
        />
    </div>

      <q-dialog
          v-model="showAddFolderDialog"
          position="right"
          full-height
          maximized
          data-test="dashboard-folder-dialog"
        >
        <AddFolder  
        @update:modelValue="updateFolderList"
        :edit-mode="isFolderEditMode"
        :folder-id="selectedFolderToEdit ?? 'default'"
        :type="type"
        />
      </q-dialog>
    <ConfirmDialog
    title="Delete Folder"
    data-test="dashboard-confirm-delete-folder-dialog"
    message="Are you sure you want to delete this Folder?"
    @update:ok="deleteFolder"
    @update:cancel="confirmDeleteFolderDialog = false"
    v-model="confirmDeleteFolderDialog"
    />
  </template>



  <script lang="ts">
  // @ts-nocheck
  import {
    computed,
    defineAsyncComponent,
    defineComponent,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
  } from "vue";
  import { useStore } from "vuex";
  import { useQuasar, date, debounce } from "quasar";
  import { useI18n } from "vue-i18n";

  import dashboardService from "@/services/dashboards";
  import QTablePagination from "@/components/shared/grid/Pagination.vue";
  import NoData from "@/components/shared/grid/NoData.vue";
  import { useRoute, useRouter } from "vue-router";
  import { toRaw } from "vue";
  import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
  import ConfirmDialog from "@/components/ConfirmDialog.vue";
  import {
    deleteDashboardById,
    deleteFolderById,
    deleteFolderByIdByType,
    getAllDashboards,
    getAllDashboardsByFolderId,
    getDashboard,
    getFoldersList,
    getFoldersListByType
  } from "@/utils/commons";
  import {
    outlinedDelete,
    outlinedDriveFileMove,
    outlinedEdit,
  } from "@quasar/extras/material-icons-outlined";
  import AddFolder from "./AddFolder.vue";
  import useNotifications from "@/composables/useNotifications";
  import { filter, forIn } from "lodash-es";
  import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
  import { useLoading } from "@/composables/useLoading";

  const MoveDashboardToAnotherFolder = defineAsyncComponent(() => {
    return import("@/components/common/sidebar/MoveAcrossFolders.vue");
  });

  const AddDashboard = defineAsyncComponent(() => {
    return import("@/components/dashboards/AddDashboard.vue");
  });

export default defineComponent({  
    name: "FolderList",
    components: {
      AddDashboard,
      QTablePagination,
      NoData,
      ConfirmDialog,
      AddFolder,
      MoveDashboardToAnotherFolder,
    },
    props: {
      type: {
        type: String,
        default: "alerts",
      },
    },
    emits: ['update:folders', 'update:activeFolderId'],
    setup(props, { emit }) {
      const store = useStore();
      const { showPositiveNotification, showErrorNotification } =
      useNotifications();
      const activeFolderId = ref("");
      const showAddFolderDialog = ref(false);
      const isFolderEditMode = ref(false);
      const selectedFolderToEdit = ref(null);
      const selectedFolderDelete = ref(null);
      const confirmDeleteFolderDialog = ref(false);
      const searchQuery = ref('');


      const router = useRouter();

      onMounted(async () => {
        if(store.state.organizationData.foldersByType.length == 0) {
          await getFoldersListByType(store, "alerts");
        }
        if(router.currentRoute.value.query.folder) {
          activeFolderId.value = router.currentRoute.value.query.folder;
        }
        else {
          activeFolderId.value = "default";
        }
      });
      watch(()=> router.currentRoute.value.query.folder, (newVal)=> {
        activeFolderId.value = newVal;
      })
      const addFolder = () => {
      isFolderEditMode.value = false;
      showAddFolderDialog.value = true;
     };

      const updateFolderList = async (folders: any) => {
        showAddFolderDialog.value = false;
        isFolderEditMode.value = false;
        emit('update:folders', folders);
      };
      const showDeleteFolderDialogFn = (folderId: any) => {
        selectedFolderDelete.value = folderId;
        confirmDeleteFolderDialog.value = true;
      };

      const deleteFolder = async () => {
      if (selectedFolderDelete.value) {
        try {
          //delete folder
          await deleteFolderByIdByType(store, selectedFolderDelete.value, "alerts");

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

    const editFolder = (folderId: any) => {
      selectedFolderToEdit.value = folderId;
      isFolderEditMode.value = true;
      showAddFolderDialog.value = true;
    };

    watch(()=> activeFolderId.value, (newVal)=> {
      emit("update:activeFolderId", newVal);
    })

    const filteredTabs = computed(() => { 
      if(!searchQuery.value || searchQuery.value == ""){
        return store.state.organizationData.foldersByType[props.type]
      }
      return store.state.organizationData.foldersByType[props.type]?.filter(tab => {
        return tab.name.toLowerCase().includes(searchQuery.value.toLowerCase());
      });
    });




      return {
        activeFolderId,
        showAddFolderDialog,
        isFolderEditMode,
        selectedFolderToEdit,
        addFolder,
        updateFolderList,
        store,
        outlinedDelete,
        outlinedEdit,
        deleteFolder,
        selectedFolderDelete,
        confirmDeleteFolderDialog,
        showDeleteFolderDialogFn,
        editFolder,
        filteredTabs,
        searchQuery,

      };
    },
  });
  </script>

<style lang="scss" scoped>
.folders-tabs {
  .test-class {
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
          background-color: $primary;
          color: white;
        }
      }
    }
  }
}

.dashboards-list-page {
  :deep(.q-table th),
  :deep(.q-table td) {
    padding: 0px 16px;
    height: 32px;
  }
}

.folder-name {
  text-transform: none !important;
}
</style>