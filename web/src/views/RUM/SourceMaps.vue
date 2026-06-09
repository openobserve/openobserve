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
    class="source-maps-container card-container tw:flex tw:flex-col tw:h-full tw:overflow-hidden"
  >
    <!-- Filters Section -->
    <div class="filters-section tw:p-3">
      <div class="tw:flex tw:justify-between tw:items-end">
      <div class="tw:flex tw:gap-4 tw:items-end">
          <!-- Version Filter -->
          <OSelect
            v-model="filters.version"
            :options="versionOptions"
            label="Version"
            clearable
            searchable
            creatable
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          />

        <!-- Service Filter -->
          <OSelect
            v-model="filters.service"
            :options="serviceOptions"
            label="Service"
            clearable
            searchable
            creatable
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          />

        <!-- Environment Filter -->
          <OSelect
            v-model="filters.environment"
            :options="environmentOptions"
            label="Environment"
            clearable
            searchable
            creatable
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          />

        <!-- Apply Button -->
          <OButton
            variant="outline"
            size="sm-action"
            @click="applyFilters"
            :loading="isLoading"
          >Apply Filters</OButton>

      </div>

        <!-- Upload Button -->

          <OButton
            variant="outline"
            size="sm-action"
            @click="navigateToUpload"
          >Upload Source Maps</OButton>
      </div>
    </div>

    <OSeparator />

    <!-- Source Maps List -->
    <div class="source-maps-list tw:flex-1 tw:min-h-0">
      <!-- Source Maps Table (OTable handles loading skeleton) -->
        <OTable
          :data="groupedSourceMaps"
          :columns="columns"
          row-key="id"
          :loading="isLoading"
          pagination="client"
          :page-size="selectedPerPage"
          :page-size-options="perPageOptionsList"
          :show-global-filter="false"
          footer-title="Source Maps"
          expansion="single"
          expand-on-row-click
          v-model:expanded-ids="expandedIds"
          class="tw:w-full"
        >
          <template #expansion="{ row }">
            <div class="expanded-details tw:p-3">
              <div class="tw:text-sm tw:font-medium tw:mb-2">
                Source Map Files ({{ row.files.length }})
              </div>
              <ul
                class="tw:rounded tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md"
                style="max-height: 400px; overflow-y: auto;"
              >
                <li
                  v-for="(file, index) in row.files"
                  :key="index"
                  data-test="source-maps-file-item"
                  class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2"
                >
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                    <span class="tw:block tw:text-xs tw:text-muted-foreground">Source File</span>
                    <span class="text-code tw:text-sm">{{ file.source_file_name }}</span>
                  </div>
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                    <span class="tw:block tw:text-xs tw:text-muted-foreground">Source Map File</span>
                    <span class="text-code tw:text-sm">{{ file.source_map_file_name }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </template>

          <template #cell-uploaded_at="{ row }">
            <div class="tw:cursor-pointer">{{ formatTimestamp(row.uploaded_at) }}</div>
          </template>

          <template #cell-actions="{ row }">
            <OButton
              :data-test="`source-maps-${row.service}-delete`"
              variant="ghost-destructive"
              size="icon-sm"
              title="Delete"
              @click="confirmDeleteSourceMap(row)"
            >
              <OIcon name="delete" size="sm" />
            </OButton>
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-source-maps"
              :filtered="!!(filters.version || filters.service || filters.environment)"
              :hide-action="!(filters.version || filters.service || filters.environment)"
              @action="(id) => id === 'upload' && navigateToUpload()"
            />
          </template>
        </OTable>
    </div>

    <!-- Delete Confirmation Dialog -->
    <ODialog
      v-model:open="deleteDialog.show"
      size="xs"
      :title="deleteDialog.title"
      data-test="delete-source-maps-dialog"
      secondary-button-label="Cancel"
      primary-button-label="OK"
      @click:secondary="deleteDialog.show = false"
      @click:primary="deleteSourceMap(); deleteDialog.show = false"
    >
      <p class="para">{{ deleteDialog.message }}</p>
    </ODialog>
  </div>
</template>

<script setup lang="ts">

import { ref, onMounted, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

const store = useStore();
const router = useRouter();

// Delete dialog state
const deleteDialog = ref({
  show: false,
  title: "",
  message: "",
  data: null as any,
});

// Filter Options from API
const versionOptions = ref<string[]>([]);
const serviceOptions = ref<string[]>([]);
const environmentOptions = ref<string[]>([]);

// Filtered options for search
const filteredVersionOptions = ref<string[]>([]);
const filteredServiceOptions = ref<string[]>([]);
const filteredEnvironmentOptions = ref<string[]>([]);

// Filters
const filters = ref<{
  version?: string;
  service?: string;
  environment?: string;
}>({});

// Fetch filter values from API
const fetchFilterValues = async () => {
  try {
    const response = await sourcemapsService.getSourceMapsValues(
      store.state.selectedOrganization.identifier
    );

    // Store the top 10 values from API
    versionOptions.value = response.data.versions || [];
    serviceOptions.value = response.data.services || [];
    environmentOptions.value = response.data.envs || [];

    // Initialize filtered options
    filteredVersionOptions.value = versionOptions.value;
    filteredServiceOptions.value = serviceOptions.value;
    filteredEnvironmentOptions.value = environmentOptions.value;
  } catch (error) {
    console.error("Error fetching filter values:", error);
    // Initialize with empty arrays on error
    versionOptions.value = [];
    serviceOptions.value = [];
    environmentOptions.value = [];
    filteredVersionOptions.value = [];
    filteredServiceOptions.value = [];
    filteredEnvironmentOptions.value = [];
  }
};

// Filter functions for dropdowns
const filterVersions = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (val === '') {
      filteredVersionOptions.value = versionOptions.value;
    } else {
      const needle = val.toLowerCase();
      filteredVersionOptions.value = versionOptions.value.filter(
        v => v.toLowerCase().includes(needle)
      );
    }
  });
};

const filterServices = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (val === '') {
      filteredServiceOptions.value = serviceOptions.value;
    } else {
      const needle = val.toLowerCase();
      filteredServiceOptions.value = serviceOptions.value.filter(
        s => s.toLowerCase().includes(needle)
      );
    }
  });
};

const filterEnvironments = (val: string, update: (fn: () => void) => void) => {
  update(() => {
    if (val === '') {
      filteredEnvironmentOptions.value = environmentOptions.value;
    } else {
      const needle = val.toLowerCase();
      filteredEnvironmentOptions.value = environmentOptions.value.filter(
        e => e.toLowerCase().includes(needle)
      );
    }
  });
};

// Add new value functions (for manual input)
const addNewVersion = (val: string, done: (item?: string) => void) => {
  if (val.length > 0) {
    done(val);
  }
};

const addNewService = (val: string, done: (item?: string) => void) => {
  if (val.length > 0) {
    done(val);
  }
};

const addNewEnvironment = (val: string, done: (item?: string) => void) => {
  if (val.length > 0) {
    done(val);
  }
};

// State
const isLoading = ref(false);
const sourceMaps = ref<any[]>([]);
const groupedSourceMaps = ref<any[]>([]);
const expandedIds = ref<string[]>([]);

// Table columns
const columns: OTableColumnDef[] = [
  {
    id: "service",
    header: "Service",
    accessorKey: "service",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: "Version",
    accessorKey: "version",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "environment",
    header: "Environment",
    accessorKey: "env",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "file_count",
    header: "Files",
    accessorKey: "fileCount",
    sortable: true,
    meta: { align: "left" },
  },
  {
    id: "uploaded_at",
    header: "Uploaded At",
    accessorKey: "uploaded_at",
    sortable: true,
    meta: {
      align: "left",
      format: (_v: any, row: any) => formatTimestamp(row.uploaded_at),
    },
  },
  {
    id: "actions",
    header: "Actions",
    accessorKey: "actions",
    meta: { align: "center", actionCount: 1 },
    isAction: true,
    size: 80,
  },
];

// Pagination
const selectedPerPage = ref<number>(20);

const perPageOptionsList = [20, 50, 100, 250];

// Fetch source maps
const fetchSourceMaps = async () => {
  isLoading.value = true;

  try {
    const params: any = {};

    if (filters.value.version) params.version = filters.value.version;
    if (filters.value.service) params.service = filters.value.service;
    if (filters.value.environment) params.env = filters.value.environment;

    const response = await sourcemapsService.listSourceMaps(
      store.state.selectedOrganization.identifier,
      params
    );

    sourceMaps.value = response.data || [];

    // Group source maps by service, version, and environment
    groupSourceMaps();
  } catch (error) {
    console.error("Error fetching source maps:", error);
    sourceMaps.value = [];
    groupedSourceMaps.value = [];
  } finally {
    isLoading.value = false;
  }
};

// Group source maps by service, version, and environment
const groupSourceMaps = () => {
  const groups = new Map<string, any>();

  sourceMaps.value.forEach((sourceMap) => {
    const key = `${sourceMap.service}-${sourceMap.version}-${sourceMap.env}`;

    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        service: sourceMap.service,
        version: sourceMap.version,
        env: sourceMap.env,
        fileCount: 0,
        uploaded_at: sourceMap.created_at,
        files: [],
      });
    }

    const group = groups.get(key);
    group.fileCount++;
    group.files.push({
      source_file_name: sourceMap.source_file_name,
      source_map_file_name: sourceMap.source_map_file_name,
      file_type: sourceMap.file_type,
      created_at: sourceMap.created_at,
    });

    // Keep the most recent upload time
    if (sourceMap.created_at > group.uploaded_at) {
      group.uploaded_at = sourceMap.created_at;
    }
  });

  groupedSourceMaps.value = Array.from(groups.values());
};

// Apply filters
const applyFilters = () => {
  fetchSourceMaps();
};

// Format timestamp
const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "-";
  // Convert microseconds to milliseconds
  return new Date(timestamp / 1000).toLocaleString();
};

// Confirm delete source map
const confirmDeleteSourceMap = (sourceMap: any) => {
  deleteDialog.value = {
    show: true,
    title: "Delete Source Maps",
    message: `Are you sure you want to delete all source maps for ${sourceMap.service} (${sourceMap.version}) in ${sourceMap.env} environment? This will delete ${sourceMap.fileCount} file(s).`,
    data: sourceMap,
  };
};

// Delete source map
const deleteSourceMap = async () => {
  try {
    const sourceMap = deleteDialog.value.data;

    // Call delete API with service, version, and env params
    await sourcemapsService.deleteSourceMaps(
      store.state.selectedOrganization.identifier,
      {
        service: sourceMap.service,
        version: sourceMap.version,
        env: sourceMap.env,
      }
    );

    toast({
      variant: "success",
      message: `Source maps deleted successfully for ${sourceMap.service} (${sourceMap.version}) in ${sourceMap.env}`,
    });

    // Remove from local list
    groupedSourceMaps.value = groupedSourceMaps.value.filter(
      (item) => item.id !== sourceMap.id
    );
  } catch (error: any) {
    console.error("Error deleting source maps:", error);
    toast({
      variant: "error",
      message: error?.response?.data?.message || error?.message || "Failed to delete source maps",
    });
  }
};

// Navigate to upload page
const navigateToUpload = () => {
  router.push({
    name: "UploadSourceMaps",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

// On mount
onMounted(async () => {
  await fetchFilterValues();
  fetchSourceMaps();
});
</script>

<style lang="scss" scoped>
.source-maps-container {
  height: 100%;
  overflow-y: auto;
}

.filters-section {
  background-color: var(--q-background);
}

.text-code {
  font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Droid Sans Mono", monospace;
  font-size: 12px;
  word-break: break-all;
}

.cursor-pointer {
  cursor: pointer;

  &:hover {
    background-color: rgba(0, 0, 0, 0.03);
  }
}

:deep(.q-dark) {
  .cursor-pointer:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
}

.expanded-details {
  background-color: var(--q-background);
  border-top: 1px solid var(--q-border-color, #e0e0e0);
}
</style>
