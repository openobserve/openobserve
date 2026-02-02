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
  <q-dialog v-model="show" position="right" full-height maximized>
    <q-card style="width: 600px" class="flex column">
      <q-card-section class="q-px-md q-py-sm">
        <div class="row items-center no-wrap">
          <div class="col">
            <div class="text-body1 text-bold">Add Dashboard from Gallery</div>
          </div>
          <div class="col-auto">
            <q-btn
              v-close-popup
              round
              flat
              icon="cancel"
              data-test="add-dashboard-github-close"
            />
          </div>
        </div>
      </q-card-section>
      <q-separator />

      <q-card-section class="q-pt-md dashboard-content-section">
        <!-- Loading State -->
        <div v-if="loading" class="tw:flex tw:items-center tw:justify-center tw:py-8">
          <q-spinner color="primary" size="3em" />
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="tw:text-center tw:py-8">
          <q-icon name="error_outline" size="3em" color="negative" class="tw:mb-2" />
          <div class="text-negative">{{ error }}</div>
          <q-btn
            flat
            color="primary"
            label="Retry"
            @click="loadDashboards"
            class="tw:mt-4"
          />
        </div>

        <!-- Dashboard List -->
        <div v-else>
          <q-input
            v-model="searchQuery"
            placeholder="Search dashboards..."
            dense
            outlined
            clearable
            class="tw:mb-4"
            data-test="add-dashboard-github-search"
          >
            <template #prepend>
              <q-icon name="search" />
            </template>
          </q-input>

          <div class="tw:text-sm tw:text-gray-600 tw:mb-2">
            {{ filteredDashboards.length }} dashboard(s) available
          </div>

          <q-list bordered separator class="rounded-borders dashboard-list">
            <q-item
              v-for="dashboard in filteredDashboards"
              :key="dashboard.name"
              clickable
              v-ripple
              @click="toggleDashboard(dashboard)"
              :class="{ 'selected-item': isSelected(dashboard) }"
              data-test="add-dashboard-github-item"
            >
              <q-item-section side>
                <q-checkbox
                  :model-value="isSelected(dashboard)"
                  @update:model-value="toggleDashboard(dashboard)"
                  color="primary"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ dashboard.displayName }}
                </q-item-label>
                <q-item-label caption v-if="dashboard.description">
                  {{ dashboard.description }}
                </q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="dashboard-footer-section">
        <div class="flex justify-end q-gutter-sm">
          <q-btn
            flat
            label="Cancel"
            color="primary"
            v-close-popup
            data-test="add-dashboard-github-cancel"
          />
          <q-btn
            flat
            :label="`Next (${selectedDashboards.length})`"
            color="primary"
            :disable="selectedDashboards.length === 0"
            @click="handleNext"
            data-test="add-dashboard-github-next"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- Folder Selection Dialog -->
    <q-dialog v-model="showFolderSelection" persistent>
      <q-card style="min-width: 600px; max-width: 800px">
        <q-card-section>
          <div class="text-h6">Select Destination Folder</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="flex" style="align-items: flex-end">
            <div style="flex: 1">
              <q-select
                v-model="selectedFolderObj"
                :options="folderOptions"
                label="Folder"
                filled
                dense
                class="folder-select showLabelOnTop"
                data-test="add-dashboard-github-folder-select"
              >
                <template v-slot:selected>
                  <span v-if="selectedFolderObj">{{ selectedFolderObj.label }}</span>
                </template>
              </q-select>
            </div>
            <q-btn
              class="q-ml-sm add-folder-btn"
              style="width: 40px; height: 40px; margin-bottom: -8px"
              flat
              dense
              @click="showAddFolderDialog = true"
              data-test="add-dashboard-github-add-folder"
            >
              <q-icon name="add" size="xs" />
            </q-btn>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Back" color="primary" @click="showFolderSelection = false" />
          <q-btn
            flat
            label="Add Dashboard"
            color="primary"
            :disable="!selectedFolderObj"
            @click="confirmAdd"
            :loading="importing"
            data-test="add-dashboard-github-confirm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Add Folder Dialog -->
    <q-dialog
      v-model="showAddFolderDialog"
      position="right"
      full-height
      maximized
      data-test="add-dashboard-github-add-folder-dialog"
    >
      <AddFolder @update:modelValue="updateFolderList" :edit-mode="false" />
    </q-dialog>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { useQuasar } from 'quasar';
import dashboardsService from '@/services/dashboards';
import AddFolder from '@/components/dashboards/AddFolder.vue';

interface GitHubDashboard {
  name: string;
  displayName: string;
  description?: string;
  folderPath: string;
  jsonFiles: string[];
}

export default defineComponent({
  name: 'AddDashboardFromGitHub',
  components: { AddFolder },
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['update:modelValue', 'added'],
  setup(props, { emit }) {
    const store = useStore();
    const q = useQuasar();

    const show = computed({
      get: () => props.modelValue,
      set: (val) => emit('update:modelValue', val),
    });

    const loading = ref(false);
    const error = ref('');
    const dashboards = ref<GitHubDashboard[]>([]);
    const searchQuery = ref('');
    const selectedDashboards = ref<GitHubDashboard[]>([]);
    const showFolderSelection = ref(false);
    const selectedFolderObj = ref<{ label: string; value: string } | null>(null);
    const folderOptions = ref<{ label: string; value: string }[]>([]);
    const importing = ref(false);
    const showAddFolderDialog = ref(false);

    const filteredDashboards = computed(() => {
      if (!searchQuery.value) return dashboards.value;
      const query = searchQuery.value.toLowerCase();
      return dashboards.value.filter(
        (d) =>
          d.displayName.toLowerCase().includes(query) ||
          d.description?.toLowerCase().includes(query)
      );
    });

    const isSelected = (dashboard: GitHubDashboard) => {
      return selectedDashboards.value.some(d => d.name === dashboard.name);
    };

    const toggleDashboard = (dashboard: GitHubDashboard) => {
      const index = selectedDashboards.value.findIndex(d => d.name === dashboard.name);
      if (index > -1) {
        selectedDashboards.value.splice(index, 1);
      } else {
        selectedDashboards.value.push(dashboard);
      }
    };

    const loadDashboards = async () => {
      loading.value = true;
      error.value = '';
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
          'https://api.github.com/repos/openobserve/dashboards/contents'
        );
        if (!response.ok) throw new Error('Failed to fetch dashboards from gallery');

        const folders = await response.json();

        // Filter for directories only
        const dirFolders = folders.filter((item: any) => item.type === 'dir' && !item.name.startsWith('.'));

        // Create dashboard entries for all folders - we'll fetch JSON files lazily
        const dashboardList = dirFolders.map((folder: any) => ({
          name: folder.name,
          displayName: folder.name.replace(/_/g, ' '),
          folderPath: folder.name,
          jsonFiles: [], // Will be populated when selected
        })).sort((a: any, b: any) => a.displayName.localeCompare(b.displayName));

        // Update cache in Vuex store
        store.commit('setGithubDashboardGallery', dashboardList);
        dashboards.value = dashboardList;
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Failed to load dashboard gallery';
      } finally {
        loading.value = false;
      }
    };

    const loadFolders = async () => {
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const response = await dashboardsService.list_Folders(orgId);
        const folders = response.data?.list || [];

        folderOptions.value = folders.map((f: any) => ({
          label: f.name,
          value: f.folderId,
        }));

        // Don't auto-select - let user choose
        selectedFolderObj.value = null;
      } catch (err) {
        console.error('Error loading folders:', err);
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
                `https://api.github.com/repos/openobserve/dashboards/contents/${dashboard.folderPath}`
              );
              if (folderContents.ok) {
                const files = await folderContents.json();
                dashboard.jsonFiles = files
                  .filter((file: any) => file.type === 'file' && file.name.endsWith('.json'))
                  .map((file: any) => file.name);

                // Update the cache with the fetched JSON files
                const cache = store.state.githubDashboardGallery;
                const cachedDashboard = cache.dashboards.find((d: any) => d.name === dashboard.name);
                if (cachedDashboard) {
                  cachedDashboard.jsonFiles = dashboard.jsonFiles;
                  store.commit('setGithubDashboardGallery', cache.dashboards);
                }
              }
            } catch (err) {
              console.error(`Failed to fetch JSON files for ${dashboard.name}:`, err);
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
        selectedFolderObj.value = {
          label: newFolder.data.name,
          value: newFolder.data.folderId,
        };
      }
    };

    const confirmAdd = async () => {
      if (selectedDashboards.value.length === 0 || !selectedFolderObj.value) return;

      importing.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const folderId = selectedFolderObj.value.value;
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        // Import each selected dashboard and all its JSON files
        for (const dashboard of selectedDashboards.value) {
          for (const jsonFile of dashboard.jsonFiles) {
            try {
              // Check cache first
              const cacheKey = `${dashboard.folderPath}/${jsonFile}`;
              const jsonCache = store.state.githubDashboardGallery.dashboardJsonCache;
              let dashboardJson;

              if (jsonCache[cacheKey]) {
                // Use cached JSON
                dashboardJson = jsonCache[cacheKey];
              } else {
                // Download dashboard JSON from GitHub
                const rawUrl = `https://raw.githubusercontent.com/openobserve/dashboards/main/${dashboard.folderPath}/${jsonFile}`;
                const response = await fetch(rawUrl);
                if (!response.ok) {
                  throw new Error(`Failed to fetch ${jsonFile}: ${response.statusText}`);
                }
                dashboardJson = await response.json();

                // Cache the JSON for future use
                store.commit('setDashboardJsonCache', { key: cacheKey, json: dashboardJson });
              }

              const dashboardTitle = dashboardJson.title || jsonFile.replace('.json', '');

              // Check if dashboard already exists in the selected folder
              const dashboardsResponse = await dashboardsService.list(
                0,
                1000,
                'name',
                false,
                '',
                orgId,
                folderId,
                ''
              );

              const existingDashboard = dashboardsResponse.data?.dashboards?.find(
                (d: any) => d.title === dashboardTitle
              );

              if (existingDashboard) {
                // Delete existing dashboard before importing
                const existingDashboardId = existingDashboard?.dashboardId || existingDashboard?.dashboard_id || existingDashboard?.id;
                if (existingDashboardId) {
                  await dashboardsService.delete(orgId, existingDashboardId, folderId);
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }

              // Import dashboard
              await dashboardsService.create(orgId, dashboardJson, folderId);
              successCount++;
            } catch (err) {
              failCount++;
              errors.push(`${jsonFile}: ${err instanceof Error ? err.message : 'Unknown error'}`);
              console.error(`Failed to import ${jsonFile}:`, err);
            }
          }
        }

        // Show summary notification
        if (successCount > 0 && failCount === 0) {
          q.notify({
            type: 'positive',
            message: `Successfully imported ${successCount} dashboard(s)!`,
            timeout: 3000,
          });
        } else if (successCount > 0 && failCount > 0) {
          q.notify({
            type: 'warning',
            message: `Imported ${successCount} dashboard(s), but ${failCount} failed. Check console for details.`,
            timeout: 5000,
          });
        } else {
          q.notify({
            type: 'negative',
            message: `Failed to import dashboards: ${errors[0] || 'Unknown error'}`,
            timeout: 5000,
          });
        }

        show.value = false;
        showFolderSelection.value = false;
        emit('added');
      } catch (err) {
        q.notify({
          type: 'negative',
          message: `Failed to add dashboards: ${err instanceof Error ? err.message : 'Unknown error'}`,
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
        searchQuery.value = '';
        showFolderSelection.value = false;
      }
    });

    return {
      show,
      loading,
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
.dashboard-content-section {
  flex: 1;
  overflow-y: auto;
  max-height: calc(100vh - 140px);
}

.dashboard-footer-section {
  flex-shrink: 0;
}

.dashboard-list {
  .body--light & {
    .selected-item {
      background-color: rgba(33, 150, 243, 0.1);
    }
  }

  .body--dark & {
    .selected-item {
      background-color: rgba(255, 255, 255, 0.15);
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
