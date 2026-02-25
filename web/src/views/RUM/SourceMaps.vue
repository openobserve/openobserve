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
  <div class="source-maps-container tw:mx-[0.625rem] card-container">
    <!-- Filters Section -->
    <div class="filters-section q-pa-md">
      <div class="tw:flex tw:justify-between tw:items-center">
      <div class="tw:flex tw:gap-4 tw:items-center">
        <!-- Version Filter -->
          <q-select
            v-model="filters.version"
            :options="filteredVersionOptions"
            label="Version"
            borderless
            dense
            clearable
            use-input
            input-debounce="0"
            @filter="filterVersions"
            @new-value="addNewVersion"
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  Type to add custom version
                </q-item-section>
              </q-item>
            </template>
          </q-select>

        <!-- Service Filter -->
          <q-select
            v-model="filters.service"
            :options="filteredServiceOptions"
            label="Service"
            borderless
            dense
            clearable
            use-input
            input-debounce="0"
            @filter="filterServices"
            @new-value="addNewService"
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  Type to add custom service
                </q-item-section>
              </q-item>
            </template>
          </q-select>

        <!-- Environment Filter -->
          <q-select
            v-model="filters.environment"
            :options="filteredEnvironmentOptions"
            label="Environment"
            borderless
            dense
            clearable
            use-input
            input-debounce="0"
            @filter="filterEnvironments"
            @new-value="addNewEnvironment"
            style="width: 200px;"
            class="o2-custom-select-dashboard"
          >
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  Type to add custom environment
                </q-item-section>
              </q-item>
            </template>
          </q-select>

        <!-- Apply Button -->
          <q-btn
            class="o2-secondary-button tw:h-[36px]"
            flat
            no-caps
            label="Apply Filters"
            @click="applyFilters"
            :loading="isLoading"
          />

      </div>

        <!-- Upload Button -->

          <q-btn
            class="o2-secondary-button tw:h-[36px]"
            flat
            no-caps
            label="Upload Source Maps"
            @click="navigateToUpload"
          />
      </div>
    </div>

    <q-separator />

    <!-- Source Maps List -->
    <div class="source-maps-list q-pa-md">
      <!-- Loading State -->
      <template v-if="isLoading">
        <div class="q-pa-lg flex items-center justify-center text-center">
          <div>
            <q-spinner-hourglass
              color="primary"
              size="2.5rem"
              class="tw:mx-auto tw:block"
            />
            <div class="text-center full-width q-mt-md">
              Loading source maps...
            </div>
          </div>
        </div>
      </template>

      <!-- Source Maps Table -->
      <template v-else-if="groupedSourceMaps.length > 0">
        <q-table
          ref="qTableRef"
          :rows="groupedSourceMaps"
          :columns="columns"
          :row-key="(row) => `${row.service}-${row.version}-${row.env}`"
          flat
          bordered
          :pagination="pagination"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          style="width: 100%; height: calc(100vh - 200px)"
        >
          <template v-slot:body="props">
            <q-tr :props="props">
              <q-td v-for="col in props.cols" :key="col.name" :props="props">
                <template v-if="col.name === 'expand'">
                  <div class="cursor-pointer" @click="toggleExpand(props.row)">
                    <q-btn
                      dense
                      flat
                      size="xs"
                      :icon="
                        expandedRow !== getRowKey(props.row)
                          ? 'expand_more'
                          : 'expand_less'
                      "
                    />
                  </div>
                </template>
                <template v-else-if="col.name === 'actions'">
                  <q-btn
                    :data-test="`source-maps-${props.row.service}-delete`"
                    padding="sm"
                    unelevated
                    size="sm"
                    round
                    flat
                    :icon="outlinedDelete"
                    title="Delete"
                    @click="confirmDeleteSourceMap(props.row)"
                  />
                </template>
                <template v-else>
                  <div class="cursor-pointer" @click="toggleExpand(props.row)">
                    {{ col.value }}
                  </div>
                </template>
              </q-td>
            </q-tr>
            <q-tr v-show="expandedRow === getRowKey(props.row)" :props="props">
              <q-td colspan="100%">
                <div class="expanded-details q-pa-md">
                  <div class="text-subtitle2 text-weight-bold q-mb-sm">
                    Source Map Files ({{ props.row.files.length }})
                  </div>
                  <q-list bordered separator class="rounded-borders" style="max-height: 400px; overflow-y: auto;">
                    <q-item v-for="(file, index) in props.row.files" :key="index">
                      <q-item-section>
                        <q-item-label caption>Source File</q-item-label>
                        <q-item-label class="text-code">{{ file.source_file_name }}</q-item-label>
                      </q-item-section>
                      <q-item-section>
                        <q-item-label caption>Source Map File</q-item-label>
                        <q-item-label class="text-code">{{ file.source_map_file_name }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </div>
              </q-td>
            </q-tr>
          </template>

          <template #bottom="scope">
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="resultTotal"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </template>
        </q-table>
      </template>

      <!-- Empty State -->
      <template v-else>
        <div class="q-pa-xl text-center text-grey-7">
          <q-icon name="code" size="4rem" color="grey-5" class="q-mb-md" />
          <div class="text-h6 q-mb-sm">No Source Maps Found</div>
          <div class="text-body2">
            Upload source maps to enable stack trace translation
          </div>
        </div>
      </template>
    </div>

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="deleteDialog.show">
      <q-card data-test="delete-source-maps-dialog" style="min-width: 300px; width: 370px;">
        <q-card-section class="confirmBody">
          <div class="head">{{ deleteDialog.title }}</div>
          <div class="para">{{ deleteDialog.message }}</div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn
            v-close-popup
            unelevated
            no-caps
            class="q-mr-sm o2-secondary-button"
            data-test="cancel-button"
          >
            Cancel
          </q-btn>
          <q-btn
            v-close-popup
            unelevated
            no-caps
            class="o2-primary-button"
            @click="deleteSourceMap"
            data-test="confirm-button"
          >
            OK
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import sourcemapsService from "@/services/sourcemaps";
import QTablePagination from "@/components/shared/grid/Pagination.vue";

const store = useStore();
const router = useRouter();
const $q = useQuasar();

const qTableRef = ref<any>(null);

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
const filters = ref({
  version: null as string | null,
  service: null as string | null,
  environment: null as string | null,
});

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
const expandedRow = ref<string | null>(null);

// Table columns
const columns = [
  {
    name: "expand",
    label: "#",
    field: "",
    align: "left" as const,
    sortable: false,
  },
  {
    name: "service",
    label: "Service",
    field: "service",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "version",
    label: "Version",
    field: "version",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "environment",
    label: "Environment",
    field: "env",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "file_count",
    label: "Files",
    field: "fileCount",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "uploaded_at",
    label: "Uploaded At",
    field: "uploaded_at",
    align: "left" as const,
    sortable: true,
    format: (val: number) => {
      if (!val) return "-";
      // Convert microseconds to milliseconds
      return new Date(val / 1000).toLocaleString();
    },
  },
  {
    name: "actions",
    field: "actions",
    label: "Actions",
    align: "center" as const,
    sortable: false,
    style: "width: 100px",
  },
];

// Pagination
const pagination = ref({
  sortBy: "created_at",
  descending: true,
  page: 1,
  rowsPerPage: 20,
});

const selectedPerPage = ref<number>(20);

const perPageOptions = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "250", value: 250 },
];

const resultTotal = computed(() => groupedSourceMaps.value.length);

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  qTableRef.value?.setPagination(pagination.value);
};

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

// Get unique row key
const getRowKey = (row: any) => {
  return `${row.service}-${row.version}-${row.env}`;
};

// Toggle expand/collapse
const toggleExpand = (row: any) => {
  const rowKey = getRowKey(row);
  if (expandedRow.value === rowKey) {
    expandedRow.value = null;
  } else {
    expandedRow.value = rowKey;
  }
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

    $q.notify({
      type: "positive",
      message: `Source maps deleted successfully for ${sourceMap.service} (${sourceMap.version}) in ${sourceMap.env}`,
    });

    // Remove from local list
    groupedSourceMaps.value = groupedSourceMaps.value.filter(
      (item) => getRowKey(item) !== getRowKey(sourceMap)
    );
  } catch (error: any) {
    console.error("Error deleting source maps:", error);
    $q.notify({
      type: "negative",
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
  height: calc(100vh - 3.25rem);
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
