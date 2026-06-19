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
  <div class="tw:bg-surface-panel tw:h-full tw:flex tw:flex-col tw:pb-[0.3rem] tw:border-r tw:border-border-default">
      <div class="folder-header tw:bg-transparent">
        <div class="tw:font-semibold tw:text-sm tw:text-text-primary tw:px-2 tw:py-2 tw:flex tw:items-center tw:justify-between tw:gap-2">
          {{ t('dashboard.folders') }}
          <div>
            <OButton
              variant="ghost"
              size="icon"
              @click.stop="addFolder"
              data-test="dashboard-new-folder-btn"
              title="Add Folder"
            >
              <OIcon name="add" size="sm" />
            </OButton>
          </div>
        </div>
        <!-- Search Input -->
        <div class="tw:p-2">
          <OSearchInput
            v-model="searchQuery"
            data-test="folder-search"
            :placeholder="t('dashboard.searchFolder')"
            clearable
            class="tw:w-full"
          />
        </div>
      </div>
      <div class="folders-tabs tw:flex-1 tw:px-1 tw:overflow-y-auto">
        <OTabs
          orientation="vertical"
          dense
          v-model="activeFolderId"
          data-test="dashboards-folder-tabs"
      >
          <OTab
          v-for="(tab, index) in filteredTabs"
          :key="tab.folderId"
          :name="tab.folderId"
          class="test-class tw:min-h-[1.5rem]"
          :data-test="`dashboard-folder-tab-${tab.folderId}`"
          >
          <div class="folder-item tw:w-full tw:flex tw:items-center tw:justify-between tw:flex-nowrap tw:gap-2 tw:min-h-6 tw:group/row" :data-test="`dashboard-folder-tab-name-${tab.name}`">
              <span class="folder-name tw:flex-1 tw:min-w-0 tw:text-left tw:truncate" :title="tab.name" :data-test="`dashboard-folder-name-${tab.name}`">{{
              tab.name
              }}</span>
              <div class="tw:hidden tw:group-hover/row:flex tw:has-[[data-state=open]]:flex tw:items-center tw:shrink-0">
              <ODropdown
                v-if="index || (searchQuery?.length > 0 && index ==  0 && tab.folderId.toLowerCase() != 'default') "
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
                  data-test="dashboard-edit-folder-icon"
                  @select="editFolder(tab.folderId)"
                >
                  <template #icon-left>
                    <OIcon name="edit" size="xs" />
                  </template>
                  {{ t('common.edit') }}
                </ODropdownItem>
                <ODropdownItem
                  variant="destructive"
                  data-test="dashboard-delete-folder-icon"
                  @select="showDeleteFolderDialogFn(tab.folderId)"
                >
                  <template #icon-left>
                    <OIcon name="delete" size="xs" />
                  </template>
                  {{ t('common.delete') }}
                </ODropdownItem>
              </ODropdown>
              </div>
          </div>
          </OTab>
      </OTabs>
      </div>
    </div>
      <AddFolder
          v-model:open="showAddFolderDialog"
          @update:modelValue="updateFolderList"
          :edit-mode="isFolderEditMode"
          :folder-id="selectedFolderToEdit ?? 'default'"
          :type="type"
        />
    <ConfirmDialog
    :title="t('dashboard.deleteFolder')"
    data-test="dashboard-confirm-delete-folder-dialog"
    :message="t('dashboard.deleteFolderMessage')"
    @update:ok="deleteFolder"
    @update:cancel="confirmDeleteFolderDialog = false"
    v-model="confirmDeleteFolderDialog"
    />
  </template>



  <script lang="ts">
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import OButton from '@/lib/core/Button/OButton.vue';
import ODropdown from '@/lib/overlay/Dropdown/ODropdown.vue';
import ODropdownItem from '@/lib/overlay/Dropdown/ODropdownItem.vue';
  // @ts-nocheck
  import {
    computed,
    defineAsyncComponent,
    defineComponent,
    onBeforeMount,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
  } from "vue";
  import { useStore } from "vuex";
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
  import AddFolder from "./AddFolder.vue";
  import useNotifications from "@/composables/useNotifications";
  import { filter, forIn } from "lodash-es";
  import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
  import { useLoading } from "@/composables/useLoading";
  import { useReo } from "@/services/reodotdev_analytics";

  const MoveDashboardToAnotherFolder = defineAsyncComponent(() => {
    return import("@/components/common/sidebar/MoveAcrossFolders.vue");
  });

  const AddDashboard = defineAsyncComponent(() => {
    return import("@/components/dashboards/AddDashboard.vue");
  });

export default defineComponent({
    name: "FolderList",
    components: {
      OSeparator,
      OIcon,
      AddDashboard,
      QTablePagination,
      NoData,
      ConfirmDialog,
      AddFolder,
      MoveDashboardToAnotherFolder,
      OTabs,
      OTab,
      OButton,
      OSearchInput,
      ODropdown,
      ODropdownItem,
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
      const { t } = useI18n();
      const { showPositiveNotification, showErrorNotification } =
      useNotifications();
      const activeFolderId = ref("");
      const showAddFolderDialog = ref(false);
      const isFolderEditMode = ref(false);
      const selectedFolderToEdit = ref(null);
      const selectedFolderDelete = ref(null);
      const confirmDeleteFolderDialog = ref(false);
      const searchQuery = ref('');
      const { track } = useReo();


      const router = useRouter();


      onMounted(async () => {
        if(!store.state.organizationData.foldersByType?.[props.type]) {
          await getFoldersListByType(store, props.type);
        }
        if(router.currentRoute.value.query.folder) {
          activeFolderId.value = router.currentRoute.value.query.folder;
        }
        else {
          activeFolderId.value = "default";
        }
      });

      watch(()=> router.currentRoute.value.query.folder, (newVal)=> {
        activeFolderId.value = newVal || "default";
      })
      const addFolder = () => {
      isFolderEditMode.value = false;
      showAddFolderDialog.value = true;
      track("Button Click", {
        button: "Add Folder",
        page: "Folders",
      });
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
          await deleteFolderByIdByType(store, selectedFolderDelete.value, props.type);

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
        t,
        activeFolderId,
        showAddFolderDialog,
        isFolderEditMode,
        selectedFolderToEdit,
        addFolder,
        updateFolderList,
        store,
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

<style>
.folders-tabs .o-tabs {
  height: auto !important;
  max-height: none !important;
}


.folders-tabs .o-tabs--vertical {
  margin: 0;
}

.folders-tabs .o-tabs--vertical .o-tab {
  justify-content: flex-start;
  padding: 0 0.625rem;
  border-radius: 0.5rem;
  /* No forced capitalize — folder names render as authored. Weight 500
     (record-name weight), not 600, so the list reads calm. Active state is
     inherited from OTab vertical (tint bg + primary text) so the folder rail
     matches the IAM/Settings rails exactly. */
  font-weight: 500;
}

.folders-tabs .o-tabs--vertical .o-tab__content.tab_content .o-tab__icon + .o-tab__label {
  padding-left: 0.875rem;
  font-weight: 500;
}

</style>
