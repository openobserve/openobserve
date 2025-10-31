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
  <div
    data-test="pipeline-history-page"
    class="q-pa-none flex"
    style="height: calc(100vh - 65px)"
    :class="store.state.theme === 'dark' ? 'dark-theme' : 'light-theme'"
  >
    <div
      class="flex justify-between full-width tw-py-3 tw-px-4 items-center tw-border-b-[1px]"
      :class="
        store.state.theme === 'dark'
          ? 'tw-border-gray-500'
          : 'tw-border-gray-200'
      "
    >
      <div class="flex items-center">
        <q-btn
          icon="arrow_back"
          flat
          round
          @click="goBack"
          class="q-mr-md"
          data-test="pipeline-history-back-btn"
        />
        <div
          class="q-table__title tw-font-[600]"
          data-test="pipeline-history-title"
        >
          {{ t(`pipeline.history`) }}
        </div>
      </div>
      <div class="flex q-ml-auto items-center">
        <div class="q-mr-md">
          <DateTime
            ref="dateTimeRef"
            auto-apply
            :default-type="dateTimeType"
            :default-absolute-time="{
              startTime: absoluteTime.startTime,
              endTime: absoluteTime.endTime,
            }"
            :default-relative-time="relativeTime"
            data-test="pipeline-history-date-picker"
            @on:date-change="updateDateTime"
          />
        </div>
        <q-select
          v-model="selectedPipeline"
          dense
          borderless
          use-input
          hide-selected
          fill-input
          input-debounce="0"
          :options="filteredPipelineOptions"
          @filter="filterPipelineOptions"
          @input-value="setSearchQuery"
          @update:model-value="onPipelineSelected"
          :placeholder="
            t(`pipeline.searchHistory`) || 'Select or search pipeline...'
          "
          data-test="pipeline-history-search-select"
          class="o2-search-input q-mr-md"
          style="min-width: 250px"
          :class="
            store.state.theme === 'dark'
              ? 'o2-search-input-dark'
              : 'o2-search-input-light'
          "
          clearable
          @clear="clearSearch"
        >
          <template v-slot:prepend>
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
          <template v-slot:no-option>
            <q-item>
              <q-item-section class="text-grey">
                No pipelines found
              </q-item-section>
            </q-item>
          </template>
        </q-select>
        <q-btn
          icon="search"
          flat
          round
          @click="manualSearch"
          data-test="pipeline-history-manual-search-btn"
          :disable="loading"
          class="q-mr-md"
        >
          <q-tooltip>{{ t("common.search") || "Search" }}</q-tooltip>
        </q-btn>
        <q-btn
          icon="refresh"
          flat
          round
          @click="refreshData"
          data-test="pipeline-history-refresh-btn"
          :loading="loading"
        >
          <q-tooltip>{{ t("common.refresh") || "Refresh" }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div
      class="full-width pipeline-history-table"
      style="height: calc(100vh - 138px)"
    >
      <q-table
        data-test="pipeline-history-table"
        ref="qTable"
        :rows="rows"
        :columns="columns"
        row-key="id"
        v-model:pagination="pagination"
        :loading="loading"
        :rows-per-page-options="rowsPerPageOptions"
        @request="onRequest"
        binary-state-sort
        flat
        bordered
        class="full-height"
      >
        <template #no-data>
          <div class="full-width row flex-center q-py-lg text-grey-7">
            <q-icon name="info" size="2em" class="q-mr-sm" />
            <span>{{
              t("pipeline.noHistory") || "No pipeline history found"
            }}</span>
          </div>
        </template>

        <template #body-cell-timestamp="props">
          <q-td :props="props">
            {{ formatDate(props.row.timestamp) }}
          </q-td>
        </template>

        <template #body-cell-status="props">
          <q-td :props="props">
            <q-chip
              :color="getStatusColor(props.row.status)"
              text-color="white"
              size="sm"
              dense
            >
              {{ props.row.status }}
            </q-chip>
          </q-td>
        </template>

        <template #body-cell-is_realtime="props">
          <q-td :props="props">
            <q-icon
              :name="props.row.is_realtime ? 'check_circle' : 'schedule'"
              :color="props.row.is_realtime ? 'positive' : 'grey'"
              size="sm"
            >
              <q-tooltip>
                {{ props.row.is_realtime ? "Real-time" : "Scheduled" }}
              </q-tooltip>
            </q-icon>
          </q-td>
        </template>

        <template #body-cell-is_silenced="props">
          <q-td :props="props">
            <q-icon
              v-if="props.row.is_silenced"
              name="volume_off"
              color="warning"
              size="sm"
            >
              <q-tooltip>Silenced</q-tooltip>
            </q-icon>
          </q-td>
        </template>

        <template #body-cell-duration="props">
          <q-td :props="props">
            {{ formatDuration(props.row.end_time - props.row.start_time) }}
          </q-td>
        </template>

        <template #body-cell-error="props">
          <q-td :props="props">
            <q-icon
              v-if="props.row.error"
              name="error"
              color="negative"
              size="sm"
              class="cursor-pointer"
              @click="showErrorDialog(props.row.error)"
            >
              <q-tooltip>Click to view error</q-tooltip>
            </q-icon>
          </q-td>
        </template>

        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              icon="visibility"
              flat
              dense
              round
              @click="showDetailsDialog(props.row)"
              data-test="pipeline-history-view-details"
            >
              <q-tooltip>View Details</q-tooltip>
            </q-btn>
          </q-td>
        </template>

        <template #bottom="scope">
          <QTablePagination
            :scope="scope"
            :position="'bottom'"
            :resultTotal="pagination.rowsNumber"
            :perPageOptions="rowsPerPageOptions"
            @update:changeRecordPerPage="changePagination"
          />
        </template>
      </q-table>
    </div>

    <!-- Details Dialog -->
    <q-dialog v-model="detailsDialog" position="standard">
      <q-card
        style="width: 700px; max-width: 80vw; max-height: 90vh"
        class="pipeline-details-dialog"
      >
        <q-card-section class="row items-center q-pb-xs bg-primary text-white">
          <div class="text-h6">Pipeline Execution Details</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section
          class="scroll"
          style="max-height: 70vh"
          v-if="selectedRow"
        >
          <div class="q-gutter-sm">
            <!-- Basic Information -->
            <div class="detail-section">
              <div class="row q-col-gutter-md">
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">
                    Pipeline Name
                  </div>
                  <div class="text-body2 text-weight-medium">
                    {{ selectedRow.pipeline_name }}
                  </div>
                </div>
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">Status</div>
                  <q-chip
                    :color="getStatusColor(selectedRow.status)"
                    text-color="white"
                    size="sm"
                    dense
                    square
                  >
                    {{ selectedRow.status }}
                  </q-chip>
                </div>
              </div>
            </div>

            <q-separator class="q-my-sm" />

            <!-- Time Information -->
            <div class="detail-section">
              <div class="row q-col-gutter-md">
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">Timestamp</div>
                  <div class="text-body2">
                    {{ formatDate(selectedRow.timestamp) }}
                  </div>
                </div>
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">Duration</div>
                  <div class="text-body2">
                    {{
                      formatDuration(
                        selectedRow.end_time - selectedRow.start_time,
                      )
                    }}
                  </div>
                </div>
              </div>
            </div>

            <q-separator class="q-my-sm" />

            <!-- Pipeline Configuration -->
            <div class="detail-section">
              <div class="row q-col-gutter-md">
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">Type</div>
                  <div class="text-body2">
                    <q-icon
                      :name="selectedRow.is_realtime ? 'speed' : 'schedule'"
                      class="q-mr-xs"
                      size="xs"
                    />
                    {{ selectedRow.is_realtime ? "Real-time" : "Scheduled" }}
                  </div>
                </div>
                <div class="col-6">
                  <div class="text-caption text-grey-7 q-mb-xs">Silenced</div>
                  <div class="text-body2">
                    <q-icon
                      v-if="selectedRow.is_silenced"
                      name="volume_off"
                      color="warning"
                      size="xs"
                      class="q-mr-xs"
                    />
                    <q-icon
                      v-else
                      name="volume_up"
                      color="positive"
                      size="xs"
                      class="q-mr-xs"
                    />
                    {{ selectedRow.is_silenced ? "Yes" : "No" }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Performance Metrics (if available) -->
            <template
              v-if="
                selectedRow.evaluation_took_in_secs ||
                selectedRow.query_took ||
                selectedRow.retries > 0
              "
            >
              <q-separator class="q-my-sm" />
              <div class="detail-section">
                <div class="row q-col-gutter-md">
                  <div v-if="selectedRow.evaluation_took_in_secs" class="col-4">
                    <div class="text-caption text-grey-7 q-mb-xs">
                      Evaluation Time
                    </div>
                    <div class="text-body2">
                      {{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s
                    </div>
                  </div>
                  <div v-if="selectedRow.query_took" class="col-4">
                    <div class="text-caption text-grey-7 q-mb-xs">
                      Query Time
                    </div>
                    <div class="text-body2">
                      {{ (selectedRow.query_took / 1000).toFixed(2) }}ms
                    </div>
                  </div>
                  <div v-if="selectedRow.retries > 0" class="col-4">
                    <div class="text-caption text-grey-7 q-mb-xs">Retries</div>
                    <div class="text-body2">{{ selectedRow.retries }}</div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Source Node (if available) -->
            <template v-if="selectedRow.source_node">
              <q-separator class="q-my-sm" />
              <div class="detail-section">
                <div class="text-caption text-grey-7 q-mb-xs">Source Node</div>
                <div class="text-body2 text-mono">
                  {{ selectedRow.source_node }}
                </div>
              </div>
            </template>

            <!-- Error Details (if available) -->
            <template v-if="selectedRow.error">
              <q-separator class="q-my-sm" />
              <div class="detail-section">
                <div class="text-caption text-grey-7 q-mb-xs">
                  <q-icon
                    name="error"
                    color="negative"
                    size="xs"
                    class="q-mr-xs"
                  />
                  Error Details
                </div>
                <q-card flat bordered class="q-pa-sm bg-negative-1 q-mt-xs">
                  <pre
                    class="text-body2"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
                      font-family: &quot;Courier New&quot;, monospace;
                      font-size: 12px;
                    "
                    >{{ selectedRow.error }}</pre
                  >
                </q-card>
              </div>
            </template>

            <!-- Success Response (if available) -->
            <template v-if="selectedRow.success_response">
              <q-separator class="q-my-sm" />
              <div class="detail-section">
                <div class="text-caption text-grey-7 q-mb-xs">
                  <q-icon
                    name="check_circle"
                    color="positive"
                    size="xs"
                    class="q-mr-xs"
                  />
                  Response
                </div>
                <q-card flat bordered class="q-pa-sm bg-positive-1 q-mt-xs">
                  <pre
                    class="text-body2"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
                      font-family: &quot;Courier New&quot;, monospace;
                      font-size: 12px;
                    "
                    >{{ selectedRow.success_response }}</pre
                  >
                </q-card>
              </div>
            </template>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Error Dialog -->
    <q-dialog v-model="errorDialog">
      <q-card style="min-width: 500px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Error Details</div>
          <q-space />
          <q-btn icon="close" flat round dense @click="errorDialog = false" />
        </q-card-section>

        <q-card-section>
          <q-card flat bordered class="q-pa-sm bg-negative-1">
            <pre style="white-space: pre-wrap; word-break: break-word">{{
              errorMessage
            }}</pre>
          </q-card>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import DateTime from "@/components/DateTime.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import pipelinesService from "@/services/pipelines";
import http from "@/services/http";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const $q = useQuasar();

// Data
const loading = ref(false);
const rows = ref<any[]>([]);
const searchQuery = ref("");
const selectedPipeline = ref<string | null>(null);
const allPipelines = ref<any[]>([]);
const filteredPipelineOptions = ref<string[]>([]);
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  rowsNumber: 0,
  sortBy: null,
  descending: false,
});

const rowsPerPageOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

// Date time - default to last 15 minutes (relative)
const dateTimeRef = ref<any>(null);
const dateTimeType = ref("relative");
const relativeTime = ref("15m");
const now = Date.now();
const fifteenMinutesAgo = now - 15 * 60 * 1000;
const absoluteTime = ref({
  startTime: fifteenMinutesAgo * 1000, // Convert to microseconds
  endTime: now * 1000, // Convert to microseconds
});

// Internal datetime values for API calls
const dateTimeValues = ref({
  startTime: fifteenMinutesAgo * 1000,
  endTime: now * 1000,
  type: "relative",
  relativeTimePeriod: "15m",
});

// Dialogs
const detailsDialog = ref(false);
const errorDialog = ref(false);
const selectedRow = ref<any>(null);
const errorMessage = ref("");

// Table columns
const columns = ref([
  {
    name: "timestamp",
    label: "Timestamp",
    field: "timestamp",
    align: "left",
    sortable: true,
  },
  {
    name: "pipeline_name",
    label: "Pipeline Name",
    field: "pipeline_name",
    align: "left",
    sortable: true,
  },
  {
    name: "status",
    label: "Status",
    field: "status",
    align: "center",
    sortable: true,
  },
  {
    name: "is_realtime",
    label: "Type",
    field: "is_realtime",
    align: "center",
    sortable: false,
  },
  {
    name: "is_silenced",
    label: "Is Silenced",
    field: "is_silenced",
    align: "center",
    sortable: false,
  },
  {
    name: "duration",
    label: "Duration",
    field: (row: any) => row.end_time - row.start_time,
    align: "right",
    sortable: true,
  },
  {
    name: "retries",
    label: "Retries",
    field: "retries",
    align: "center",
    sortable: true,
  },
  {
    name: "error",
    label: "Errors",
    field: "error",
    align: "center",
    sortable: false,
  },
  {
    name: "actions",
    label: "Actions",
    field: "actions",
    align: "center",
    sortable: false,
  },
]);

// Computed
const filteredRows = computed(() => {
  // Removed client-side filtering as we're using server-side pagination
  return rows.value;
});

// Methods
const fetchPipelinesList = async () => {
  try {
    const org = store.state.selectedOrganization.identifier;

    // Fetch all pipelines for the organization
    const res = await pipelinesService.getPipelines(org);

    if (res.data && res.data.list) {
      // Extract pipeline names and sort them
      allPipelines.value = res.data.list
        .map((pipeline: any) => pipeline.name)
        .sort();
      filteredPipelineOptions.value = [...allPipelines.value];
    }
  } catch (error: any) {
    console.error("Error fetching pipelines list:", error);
    // Silently fail - user can still type pipeline names manually
  }
};

const filterPipelineOptions = (val: string, update: any) => {
  update(() => {
    const needle = val.toLowerCase();
    filteredPipelineOptions.value = allPipelines.value.filter((v) =>
      v.toLowerCase().includes(needle),
    );
  });
};

const setSearchQuery = (val: string) => {
  searchQuery.value = val;
};

const onPipelineSelected = (val: string | null) => {
  if (val) {
    searchQuery.value = val;
  }
};

const clearSearch = () => {
  searchQuery.value = "";
  selectedPipeline.value = null;
};

const manualSearch = () => {
  pagination.value.page = 1;
  fetchPipelineHistory();
};

const fetchPipelineHistory = async () => {
  loading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;

    // Use the stored datetime values (already in microseconds)
    const startTime = dateTimeValues.value.startTime;
    const endTime = dateTimeValues.value.endTime;

    const params: any = {
      start_time: startTime.toString(),
      end_time: endTime.toString(),
      from: (
        (pagination.value.page - 1) *
        pagination.value.rowsPerPage
      ).toString(),
      size: pagination.value.rowsPerPage.toString(),
    };

    // Add pipeline_name filter if search query is provided
    if (searchQuery.value && searchQuery.value.trim()) {
      params.pipeline_name = searchQuery.value.trim();
    }

    const url = `/api/${org}/pipelines/history`;
    const response = await http().get(url, { params });

    if (response.data) {
      // Handle the response data
      const historyData = response.data;

      // Map the hits array or handle empty response
      rows.value = (historyData.hits || []).map((hit: any, index: number) => ({
        ...hit,
        id: `${hit.timestamp}_${index}`,
      }));

      // Update pagination total
      pagination.value.rowsNumber = historyData.total || 0;

      if (rows.value.length === 0) {
        console.warn("No pipeline history found for the selected time range");
      }
    }
  } catch (error: any) {
    console.error("Error fetching pipeline history:", error);
    console.error("Error response:", error.response);
    $q.notify({
      type: "negative",
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to fetch pipeline history",
    });
  } finally {
    loading.value = false;
  }
};

const updateDateTime = (value: any) => {
  // Store the datetime values for API calls
  dateTimeValues.value = {
    startTime: value.startTime,
    endTime: value.endTime,
    type: value.relativeTimePeriod ? "relative" : "absolute",
    relativeTimePeriod: value.relativeTimePeriod || "",
  };

  // Update the component state
  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
    absoluteTime.value = {
      startTime: value.startTime,
      endTime: value.endTime,
    };
  }

  // Reset pagination and fetch new data
  pagination.value.page = 1;
  fetchPipelineHistory();
};

const onRequest = (props: any) => {
  // The pagination component passes the updated pagination object
  pagination.value = {
    ...pagination.value,
    ...props.pagination,
  };

  fetchPipelineHistory();
};

const refreshData = () => {
  fetchPipelineHistory();
};

const formatDate = (timestamp: number) => {
  if (!timestamp) return "-";
  // Convert microseconds to milliseconds
  const dateObj = new Date(timestamp / 1000);
  return date.formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
};

const formatDuration = (microseconds: number) => {
  if (!microseconds || microseconds <= 0) return "0s";
  const ms = microseconds / 1000;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case "success":
    case "ok":
      return "positive";
    case "error":
    case "failed":
      return "negative";
    case "warning":
      return "warning";
    case "pending":
    case "running":
      return "info";
    default:
      return "grey";
  }
};

const showDetailsDialog = (row: any) => {
  selectedRow.value = row;
  detailsDialog.value = true;
};

const showErrorDialog = (error: string) => {
  errorMessage.value = error;
  errorDialog.value = true;
};

const goBack = () => {
  router.push({ name: "pipelines" });
};

// Lifecycle
onMounted(async () => {
  // Fetch pipelines list for dropdown
  await fetchPipelinesList();
  // Fetch initial pipeline history
  fetchPipelineHistory();
});

// Watch for organization change
watch(
  () => store.state.selectedOrganization.identifier,
  async () => {
    // Re-fetch pipelines list when organization changes
    await fetchPipelinesList();
    // Reset search
    clearSearch();
    // Fetch history for new organization
    fetchPipelineHistory();
  },
);
const changePagination = (val: { label: string; value: any }) => {
  pagination.value.rowsPerPage = val.value;
  pagination.value.page = 1; // Reset to first page when changing page size
  fetchPipelineHistory();
};
</script>

<style scoped lang="scss">
.pipeline-history-table {
  :deep(.q-table) {
    width: 100%;

    td {
      vertical-align: middle;
    }
  }
}

.pipeline-details-dialog {
  :deep(.q-dialog__inner) {
    padding: 24px;
  }

  .detail-section {
    padding: 4px 0;
  }

  .text-mono {
    font-family: "Courier New", monospace;
    font-size: 13px;
  }

  .bg-negative-1 {
    background-color: rgba(255, 0, 0, 0.05);
  }

  .bg-positive-1 {
    background-color: rgba(0, 128, 0, 0.05);
  }

  pre {
    max-height: 200px;
    overflow-y: auto;

    &::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    &::-webkit-scrollbar-track {
      background: #f1f1f1;
    }

    &::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 3px;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
  }
}
</style>
