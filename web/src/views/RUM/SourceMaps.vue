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
    class="source-maps-container bg-card-glass-bg flex flex-col h-full overflow-hidden"
  >
    <!-- Filters Section -->
    <div class="px-page-edge py-3 bg-surface-base">
      <div class="flex justify-between items-end">
      <div class="flex gap-4 items-end">
          <!-- Version Filter -->
          <OSelect
            v-model="filters.version"
            :options="versionOptions"
            :label="t('common.version')"
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
            :label="t('rum.service')"
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
            :label="t('rum.environment')"
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
          >{{ t('rum.applyFilters') }}</OButton>

      </div>

        <!-- Columns + Refresh + Upload Buttons -->
        <div class="flex gap-2 items-center">
          <OTableColumnToggle
            :columns="columns"
            :column-visibility="columnVisibility"
            @update:column-visibility="setColumnVisibility"
          />
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="isLoading"
            data-test="source-maps-refresh-btn"
            @click="fetchSourceMaps"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="sourceMapsRefresh" />
          </OButton>
          <OButton
            variant="outline"
            size="sm-action"
            @click="navigateToUpload"
          >{{ t('rum.uploadSourceMaps') }}</OButton>
        </div>
      </div>
    </div>

    <OSeparator />

    <!-- Source Maps List -->
    <div class="source-maps-list flex-1 min-h-0">
      <!-- Source Maps Table (OTable handles loading skeleton) -->
        <OTable
          :data="groupedSourceMaps"
          :columns="columns"
          :column-visibility="columnVisibility"
          row-key="id"
          :loading="isLoading"
          pagination="client"
          :page-size="selectedPerPage"
          :page-size-options="perPageOptionsList"
          :show-global-filter="false"
          :footer-title="t('rum.sourceMaps')"
          expansion="single"
          expand-on-row-click
          v-model:expanded-ids="expandedIds"
          class="w-full"
        >
          <template #expansion="{ row }">
            <div class="p-3 bg-surface-base border-t border-(--color-border-default,var(--color-border-default))">
              <div class="text-sm font-medium mb-2">
                Source Map Files ({{ row.files.length }})
              </div>
              <ul
                class="flex flex-col divide-y divide-border border rounded-default overflow-y-auto"
                style="max-height: 400px"
              >
                <li
                  v-for="(file, index) in row.files"
                  :key="index"
                  data-test="source-maps-file-item"
                  class="flex items-center gap-2 px-3 py-2"
                >
                  <div class="flex flex-col flex-1 min-w-0">
                    <span class="block text-xs text-muted-foreground">Source File</span>
                    <span class="font-mono break-all text-sm">{{ file.source_file_name }}</span>
                  </div>
                  <div class="flex flex-col flex-1 min-w-0">
                    <span class="block text-xs text-muted-foreground">Source Map File</span>
                    <span class="font-mono break-all text-sm">{{ file.source_map_file_name }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </template>

          <template #cell-uploaded_at="{ row }">
            <div class="cursor-pointer hover:bg-black/3 dark:hover:bg-white/5">{{ formatTimestamp(row.uploaded_at) }}</div>
          </template>

          <template #cell-actions="{ row }">
            <OButton
              :data-test="`source-maps-${row.service}-delete`"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('common.delete')"
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
      :secondary-button-label="t('common.cancel')"
      :primary-button-label="t('common.ok')"
      @click:secondary="deleteDialog.show = false"
      @click:primary="deleteSourceMap(); deleteDialog.show = false"
    >
      <p class="para">{{ deleteDialog.message }}</p>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in RealUserMonitoring.vue matches this
// view. Without it the name is inferred from the FILENAME, so renaming the file
// would silently drop it from the cache and bring back the refetch-on-return.
defineOptions({ name: "SourceMaps" });


import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import sourcemapsService from "@/services/sourcemaps";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

const { t } = useI18n();
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

// State
const isLoading = ref(false);
const sourceMaps = ref<any[]>([]);
const groupedSourceMaps = ref<any[]>([]);
const expandedIds = ref<string[]>([]);

// Table columns
const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(
  "rum-source-maps-list",
);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "service",
    header: t("rum.service"),
    accessorKey: "service",
    sortable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("common.version"),
    accessorKey: "version",
    sortable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "environment",
    header: t("rum.environment"),
    accessorKey: "env",
    sortable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "file_count",
    header: t("rum.files"),
    accessorKey: "fileCount",
    sortable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "uploaded_at",
    header: t("rum.uploadedAt"),
    accessorKey: "uploaded_at",
    sortable: true,
    hideable: true,
    meta: {
      align: "left",
      format: (_v: any, row: any) => formatTimestamp(row.uploaded_at),
    },
  },
  {
    id: "actions",
    header: t("common.actions"),
    accessorKey: "actions",
    meta: { align: "center", actionCount: 1 },
    isAction: true,
    size: 80,
  },
]);

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

useShortcuts([
  { id: "sourceMapsRefresh", handler: () => { if (!isInputFocused()) fetchSourceMaps(); } },
]);
</script>
