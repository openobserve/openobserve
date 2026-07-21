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
  <div class="bg-surface-panel h-full flex flex-col pb-1 border-r border-border-default">
      <div class="folder-header bg-transparent">
        <div class="font-semibold text-sm text-text-heading pl-page-edge pr-1.5 py-2 flex items-center justify-between gap-2">
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
        <div class="px-1.5 pb-2">
          <OSearchInput
            v-model="searchQuery"
            data-test="folder-search"
            :placeholder="t('dashboard.searchFolder')"
            clearable
            class="w-full"
          />
        </div>
      </div>
      <div class="folders-tabs flex-1 overflow-y-auto px-1.5">
        <OTabs
          orientation="vertical"
          dense
          v-model="activeFolderId"
          data-test="dashboards-folder-tabs"
      >
          <OTab
          v-for="tab in filteredTabs"
          :key="tab.folderId"
          :name="tab.folderId"
          class="test-class min-h-6"
          :data-test="`dashboard-folder-tab-${tab.folderId}`"
          @click="onTabClick(tab.folderId)"
          >
          <div class="folder-item w-full flex items-center justify-between flex-nowrap gap-2 min-h-6 group/row" :data-test="`dashboard-folder-tab-name-${tab.name}`">
              <div class="flex items-center gap-1.5 flex-1 min-w-0">
                <span class="folder-name min-w-0 text-left truncate" :title="tab.name" :data-test="`dashboard-folder-name-${tab.name}`">{{
                tab.name
                }}</span>
                <OIcon
                  v-if="tab.folderId === FAVORITES_FOLDER_ID"
                  name="favorite"
                  size="sm"
                  class="shrink-0 text-favorite"
                />
              </div>
              <div
                v-if="
                  tab.folderId.toLowerCase() != 'default' &&
                  tab.folderId !== FAVORITES_FOLDER_ID
                "
                class="hidden group-hover/row:flex has-[[data-state=open]]:flex items-center shrink-0"
              >
              <ODropdown side="bottom" align="start">
                <template #trigger>
                  <OButton
                    size="icon"
                    variant="ghost"
                    icon-left="more-vert"
                    class="h-6 w-6"
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
  import AddFolder from "./AddFolder.vue";
  import useNotifications from "@/composables/useNotifications";
  import { FAVORITES_FOLDER_ID } from "@/composables/useFavoriteDashboards";
  import { filter, forIn } from "lodash-es";
  import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
  import { useLoading } from "@/composables/useLoading";
  import { useReo } from "@/services/reodotdev_analytics";

export default defineComponent({
    name: "FolderList",
    components: {
      OIcon,
      ConfirmDialog,
      AddFolder,
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
      // Dashboards-only: prepends a fixed "Favorites" pseudo-folder entry at
      // the top of the rail. Alerts/Reports keep the plain folder list.
      showFavorites: {
        type: Boolean,
        default: false,
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
          activeFolderId.value = router.currentRoute.value.query.folder as string;
        }
        else if (!props.showFavorites) {
          activeFolderId.value = "default";
        }
        // With showFavorites, the owning view decides the landing folder
        // (favorites-first) and pushes it to the route; self-assigning
        // "default" here would race that decision and clobber it. The route
        // watcher below selects the tab once the owner has pushed.
      });

      watch(()=> router.currentRoute.value.query.folder as string | undefined, (newVal)=> {
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
          const e = err as { response?: { data?: { message?: string } }; message?: string };
          showErrorNotification(
            e?.response?.data?.message ||
              e?.message ||
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

    // The v-model watcher above only fires on CHANGE. Clicking the folder that
    // is already active must still notify the parent (e.g. the dashboards list
    // leaves its favorites view on any folder pick), so re-emit for that case.
    // Consumers treat the event as idempotent.
    const onTabClick = (folderId: string) => {
      if (folderId === activeFolderId.value) {
        emit("update:activeFolderId", folderId);
      }
    };

    const filteredTabs = computed(() => {
      const folders =
        store.state.organizationData.foldersByType[props.type] ?? [];
      // The Favorites pseudo-folder sits above everything, including Default,
      // and participates in the folder search like any other entry.
      const tabs = props.showFavorites
        ? [
            { folderId: FAVORITES_FOLDER_ID, name: t("dashboard.favorites") },
            ...folders,
          ]
        : folders;
      if (!searchQuery.value || searchQuery.value == "") {
        return tabs;
      }
      return tabs.filter((tab: { name: string }) =>
        tab.name.toLowerCase().includes(searchQuery.value.toLowerCase()),
      );
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
        onTabClick,
        FAVORITES_FOLDER_ID,

      };
    },
  });
  </script>

<style scoped>
/* keep(lib-override:OTabs): targets OTabs' internal rendered DOM (.o-tabs,
   .o-tab, .o-tab__label) which is a child component and never receives this
   component's scope id — reached via :deep(). Not expressible as template
   utilities. */
.folders-tabs :deep(.o-tabs) {
  height: auto !important;
  max-height: none !important;
}

.folders-tabs :deep(.o-tabs--vertical) {
  margin: 0;
}

/* Horizontal padding is deliberately NOT set here — OTab's vertical variant
   derives it from --spacing-page-edge so the rail lines up with the page
   header. Overriding it here is what used to push these rows out of line. */
.folders-tabs :deep(.o-tabs--vertical .o-tab) {
  justify-content: flex-start;
  border-radius: 0.5rem;
  /* No forced capitalize — folder names render as authored. Weight 500
     (record-name weight), not 600, so the list reads calm. Active state is
     inherited from OTab vertical (tint bg + primary text) so the folder rail
     matches the IAM/Settings rails exactly. */
  font-weight: 500;
}

.folders-tabs :deep(.o-tabs--vertical .o-tab__content.tab_content .o-tab__icon + .o-tab__label) {
  padding-left: 0.875rem;
  font-weight: 500;
}
</style>
