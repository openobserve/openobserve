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
  <ODrawer data-test="add-dashboard-from-github-drawer"
    v-model:open="show"
    side="right"
    size="lg"
    title="Add Dashboard from Gallery"
    secondary-button-label="Cancel"
    :primary-button-label="`Next (${selectedDashboards.length})`"
    :primary-button-disabled="selectedDashboards.length === 0"
    @click:secondary="show = false"
    @click:primary="handleNext"
  >
        <!-- Loading State -->
        <div
          v-if="loading"
          class="tw:flex tw:flex-1 tw:items-center tw:justify-center"
        >
          <OSpinner size="lg" />
        </div>

        <!-- Error State -->
        <div
          v-else-if="error"
          class="tw:flex tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:text-center"
        >
          <OIcon
            name="error-outline"
            size="3em"
            class="tw:mb-2"
          />
          <div class="text-negative">{{ error }}</div>
          <OButton
            variant="primary"
            size="sm"
            class="tw:mt-4"
            @click="loadDashboards"
            >Retry</OButton
          >
        </div>

        <!-- Dashboard List -->
        <div v-else class="tw:flex tw:flex-col tw:mx-2 tw:my-2">
          <OInput
            v-model="searchQuery"
            placeholder="Search dashboards..."
            clearable
            class="tw:mb-4"
            data-test="add-dashboard-github-search"
          >
            <template #icon-left>
              <OIcon name="search" size="sm" />
            </template>
          </OInput>

          <div class="tw:text-xs tw:text-gray-500 tw:mb-2 tw:px-1">
            {{ filteredDashboards.length }} dashboard(s) available
          </div>

          <q-list
            :bordered="filteredDashboards.length > 0"
            dense
            class="rounded-borders dashboard-list tw:my-2"
          >
            <q-item
              v-for="dashboard in filteredDashboards"
              :key="dashboard.name"
              clickable
              v-ripple
              dense
              @click="toggleDashboard(dashboard)"
              class="tw:py-1 tw:transition-colors tw:duration-200"
              :class="[
                isSelected(dashboard)
                  ? 'selected-item tw:bg-primary/5 tw:border-l-4 tw:border-primary'
                  : 'tw:border-l-4 tw:border-transparent hover:tw:bg-gray-50',
              ]"
              data-test="add-dashboard-github-item"
            >
              <q-item-section side class="tw:pr-2">
                <OCheckbox
                  :model-value="isSelected(dashboard)"
                  @update:model-value="toggleDashboard(dashboard)"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium tw:text-sm">
                  {{ dashboard.displayName }}
                </q-item-label>
                <q-item-label
                  caption
                  v-if="dashboard.description"
                  class="tw:text-xs"
                >
                  {{ dashboard.description }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>

    <!-- Folder Selection Dialog -->
    <ODialog data-test="add-dashboard-from-github-folder-selection-dialog"
      v-model:open="showFolderSelection"
      persistent
      size="sm"
      title="Select Destination Folder"
      secondary-button-label="Back"
      primary-button-label="Add Dashboard"
      :primary-button-disabled="!selectedFolderObj"
      :primary-button-loading="importing"
      @click:secondary="showFolderSelection = false"
      @click:primary="confirmAdd"
    >
      <div class="tw:flex tw:items-center tw:gap-2">
        <OSelect
          v-model="selectedFolderObj"
          :options="folderOptions"
          label="Folder"
          class="tw:grow"
          data-test="add-dashboard-github-folder-select"
        />
        <OButton
          variant="ghost"
          size="icon"
          @click="showAddFolderDialog = true"
          data-test="add-dashboard-github-add-folder"
          title="Add New Folder"
        >
          <template #icon-left><OIcon name="add" size="sm" /></template>
        </OButton>
      </div>
    </ODialog>

    <!-- Add Folder Dialog -->
    <ODrawer
      v-model:open="showAddFolderDialog"
      size="lg"
      title="Add New Folder"
      primary-button-label="Save"
      secondary-button-label="Cancel"
      :primary-button-disabled="isAddingFolder"
      :primary-button-loading="isAddingFolder"
      @click:primary="handleAddFolder"
      @click:secondary="showAddFolderDialog = false"
      data-test="add-dashboard-github-add-folder-dialog"
    >
      <AddFolder
        ref="addFolderRef"
        @update:modelValue="updateFolderList"
        @close="showAddFolderDialog = false"
        :edit-mode="false"
      />
    </ODrawer>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import dashboardsService from "@/services/dashboards";
import AddFolder from "@/components/dashboards/AddFolder.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

interface GitHubDashboard {
  name: string;
  displayName: string;
  description?: string;
  folderPath: string;
  jsonFiles: string[];
}

export default defineComponent({
  name: "AddDashboardFromGitHub",
  components: { AddFolder, OButton, ODialog, ODrawer, OInput, OSelect, OCheckbox, OSpinner,
    OIcon,
},
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ["update:modelValue", "added"],
  setup(props, { emit }) {
    const store = useStore();
    const q = useQuasar();

    const show = computed({
      get: () => props.modelValue,
      set: (val) => emit("update:modelValue", val),
    });

    const loading = ref(false);
    const error = ref("");
    const dashboards = ref<GitHubDashboard[]>([]);
    const searchQuery = ref("");
    const selectedDashboards = ref<GitHubDashboard[]>([]);
    const showFolderSelection = ref(false);
    const selectedFolderObj = ref<string | null>(null);
    const folderOptions = ref<{ label: string; value: string }[]>([]);
    const importing = ref(false);
    const showAddFolderDialog = ref(false);
    const addFolderRef = ref<InstanceType<typeof AddFolder> | null>(null);
    const isAddingFolder = ref(false);

    const handleAddFolder = async () => {
      if (!addFolderRef.value || isAddingFolder.value) return;
      isAddingFolder.value = true;
      try {
        await addFolderRef.value.submit();
      } finally {
        isAddingFolder.value = false;
      }
    };

    const filteredDashboards = computed(() => {
      if (!searchQuery.value) return dashboards.value;
      const query = searchQuery.value.toLowerCase();
      return dashboards.value.filter(
        (d) =>
          d.displayName.toLowerCase().includes(query) ||
          d.description?.toLowerCase().includes(query),
      );
    });

    const isSelected = (dashboard: GitHubDashboard) => {
      return selectedDashboards.value.some((d) => d.name === dashboard.name);
    };

    const toggleDashboard = (dashboard: GitHubDashboard) => {
      const index = selectedDashboards.value.findIndex(
        (d) => d.name === dashboard.name,
      );
      if (index > -1) {
        selectedDashboards.value.splice(index, 1);
      } else {
        selectedDashboards.value.push(dashboard);
      }
    };

    const loadDashboards = async () => {
      loading.value = true;
      error.value = "";
      try {
        // Check if we have cached data that's still valid
        const cache = store.state.githubDashboardGallery;
        const now = Date.now();
        const cacheAge = cache.lastFetched ? now - cache.lastFetched : Infinity;

        if (cache.dashboards.length > 0 && cacheAge < cache.cacheExpiry) {
          // Use cached data
          dashboards.value = cache.dashboards;
          loading.value = false;
          return;
        }

        // Cache miss or expired - fetch from GitHub
        const response = await fetch(
          "https://api.github.com/repos/openobserve/dashboards/contents",
        );
        if (!response.ok)
          throw new Error("Failed to fetch dashboards from gallery");

        const folders = await response.json();

        // Filter for directories only
        const dirFolders = folders.filter(
          (item: any) => item.type === "dir" && !item.name.startsWith("."),
        );

        // Create dashboard entries for all folders - we'll fetch JSON files lazily
        const dashboardList = dirFolders
          .map((folder: any) => ({
            name: folder.name,
            displayName: folder.name.replace(/_/g, " "),
            folderPath: folder.name,
            jsonFiles: [], // Will be populated when selected
          }))
          .sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

        // Update cache in Vuex store
        store.commit("setGithubDashboardGallery", dashboardList);
        dashboards.value = dashboardList;
      } catch (err) {
        error.value =
          err instanceof Error
            ? err.message
            : "Failed to load dashboard gallery";
      } finally {
        loading.value = false;
      }
    };

    const loadFolders = async () => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const response = await dashboardsService.list_Folders(orgId);
        let folders: any[] = response.data?.list || [];

        // Ensure default folder is always present and pinned at top (same as getFoldersList in commons.ts)
        let defaultFolder = folders.find((f: any) => f.folderId === "default");
        folders = folders.filter((f: any) => f.folderId !== "default");

        if (!defaultFolder) {
          defaultFolder = {
            name: "default",
            folderId: "default",
            description: "default",
          };
        }

        const sorted = [
          defaultFolder,
          ...folders.sort((a: any, b: any) => a.name.localeCompare(b.name)),
        ];

        folderOptions.value = sorted.map((f: any) => ({
          label: f.name,
          value: f.folderId,
        }));

        // Don't auto-select - let user choose
        selectedFolderObj.value = null;
      } catch (err) {
        console.error("Error loading folders:", err);
      }
    };

    const handleNext = async () => {
      if (selectedDashboards.value.length === 0) return;

      loading.value = true;
      try {
        // Fetch JSON files for selected dashboards if not already loaded
        for (const dashboard of selectedDashboards.value) {
          if (dashboard.jsonFiles.length === 0) {
            try {
              const folderContents = await fetch(
                `https://api.github.com/repos/openobserve/dashboards/contents/${dashboard.folderPath}`,
              );
              if (folderContents.ok) {
                const files = await folderContents.json();
                dashboard.jsonFiles = files
                  .filter(
                    (file: any) =>
                      file.type === "file" && file.name.endsWith(".json"),
                  )
                  .map((file: any) => file.name);

                // Update the cache with the fetched JSON files
                const cache = store.state.githubDashboardGallery;
                const cachedDashboard = cache.dashboards.find(
                  (d: any) => d.name === dashboard.name,
                );
                if (cachedDashboard) {
                  cachedDashboard.jsonFiles = dashboard.jsonFiles;
                  store.commit("setGithubDashboardGallery", cache.dashboards);
                }
              }
            } catch (err) {
              console.error(
                `Failed to fetch JSON files for ${dashboard.name}:`,
                err,
              );
            }
          }
        }

        await loadFolders();
        showFolderSelection.value = true;
      } finally {
        loading.value = false;
      }
    };

    const updateFolderList = async (newFolder: any) => {
      showAddFolderDialog.value = false;
      if (newFolder && newFolder.data) {
        // Refresh folder list
        await loadFolders();
        // Auto-select the newly created folder
        selectedFolderObj.value = newFolder.data.folderId;
      }
    };

    const confirmAdd = async () => {
      if (selectedDashboards.value.length === 0 || !selectedFolderObj.value)
        return;

      importing.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const folderId = selectedFolderObj.value;
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        // Import each selected dashboard and all its JSON files
        for (const dashboard of selectedDashboards.value) {
          for (const jsonFile of dashboard.jsonFiles) {
            try {
              // Check cache first
              const cacheKey = `${dashboard.folderPath}/${jsonFile}`;
              const jsonCache =
                store.state.githubDashboardGallery.dashboardJsonCache;
              let dashboardJson;

              if (jsonCache[cacheKey]) {
                // Use cached JSON
                dashboardJson = jsonCache[cacheKey];
              } else {
                // Download dashboard JSON from GitHub
                const rawUrl = `https://raw.githubusercontent.com/openobserve/dashboards/main/${dashboard.folderPath}/${jsonFile}`;
                const response = await fetch(rawUrl);
                if (!response.ok) {
                  throw new Error(
                    `Failed to fetch ${jsonFile}: ${response.statusText}`,
                  );
                }
                dashboardJson = await response.json();

                // Cache the JSON for future use
                store.commit("setDashboardJsonCache", {
                  key: cacheKey,
                  json: dashboardJson,
                });
              }

              const dashboardTitle =
                dashboardJson.title || jsonFile.replace(".json", "");

              // Check if dashboard already exists in the selected folder
              const dashboardsResponse = await dashboardsService.list(
                0,
                1000,
                "name",
                false,
                "",
                orgId,
                folderId,
                "",
              );

              const existingDashboard =
                dashboardsResponse.data?.dashboards?.find(
                  (d: any) => d.title === dashboardTitle,
                );

              if (existingDashboard) {
                // Delete existing dashboard before importing
                const existingDashboardId =
                  existingDashboard?.dashboardId ||
                  existingDashboard?.dashboard_id ||
                  existingDashboard?.id;
                if (existingDashboardId) {
                  await dashboardsService.delete(
                    orgId,
                    existingDashboardId,
                    folderId,
                  );
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
              }

              // Import dashboard
              await dashboardsService.create(orgId, dashboardJson, folderId);
              successCount++;
            } catch (err) {
              failCount++;
              errors.push(
                `${jsonFile}: ${err instanceof Error ? err.message : "Unknown error"}`,
              );
              console.error(`Failed to import ${jsonFile}:`, err);
            }
          }
        }

        // Show summary notification
        if (successCount > 0 && failCount === 0) {
          q.notify({
            type: "positive",
            message: `Successfully imported ${successCount} dashboard(s)!`,
            timeout: 3000,
          });
        } else if (successCount > 0 && failCount > 0) {
          q.notify({
            type: "warning",
            message: `Imported ${successCount} dashboard(s), but ${failCount} failed. Check console for details.`,
            timeout: 5000,
          });
        } else {
          q.notify({
            type: "negative",
            message: `Failed to import dashboards: ${errors[0] || "Unknown error"}`,
            timeout: 5000,
          });
        }

        show.value = false;
        showFolderSelection.value = false;
        emit("added");
      } catch (err) {
        q.notify({
          type: "negative",
          message: `Failed to add dashboards: ${err instanceof Error ? err.message : "Unknown error"}`,
          timeout: 5000,
        });
      } finally {
        importing.value = false;
      }
    };

    // Load dashboards when dialog opens
    watch(show, (newVal) => {
      if (newVal) {
        loadDashboards();
      } else {
        // Reset state when closing
        selectedDashboards.value = [];
        searchQuery.value = "";
        showFolderSelection.value = false;
      }
    });

    return {
      show,
      loading,
      store,
      error,
      dashboards,
      searchQuery,
      filteredDashboards,
      selectedDashboards,
      showFolderSelection,
      selectedFolderObj,
      folderOptions,
      importing,
      showAddFolderDialog,
      addFolderRef,
      isAddingFolder,
      handleAddFolder,
      isSelected,
      toggleDashboard,
      loadDashboards,
      handleNext,
      confirmAdd,
      updateFolderList,
    };
  },
});
</script>

<style scoped lang="scss">
.dashboard-list {
  max-height: calc(100dvh - 230px);
  overflow-y: auto;

  .selected-item {
    background-color: var(--o2-tab-bg) !important;
  }

  .body--light & {
    .q-item:hover:not(.selected-item) {
      background-color: var(--o2-hover-gray);
    }
  }

  .body--dark & {
    .q-item:hover:not(.selected-item) {
      background-color: var(--o2-hover-gray);
    }
  }
}

.folder-select {
  :deep(.q-field__control) {
    min-height: 56px !important;
  }

  :deep(.q-field__native) {
    min-height: 20px !important;
  }
}
</style>
