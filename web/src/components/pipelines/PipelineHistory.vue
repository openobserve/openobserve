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
    data-test="pipeline-history-page"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0"
  >
    <!-- Controls live in the shell header (Functions.vue #o2-page-actions),
         next to the "Pipelines › History" breadcrumb — no bespoke 2nd header.
         `defer` (Vue 3.5+) waits for the target to be rendered in the same
         tick — needed because #o2-page-actions is created by the parent shell
         (Functions.vue) which may not have fully rendered when this component
         mounts on initial page load. -->
    <Teleport to="#o2-page-actions" defer>
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
      <OSelect
        v-model="selectedPipeline"
        :options="allPipelines"
        labelKey="label"
        valueKey="value"
        searchable
        @update:model-value="onPipelineSelected"
        :placeholder="
          t(`pipeline.searchHistory`) || 'Select or search pipeline...'
        "
        data-test="pipeline-history-search-select"
        class="tw:min-w-[250px]"
        clearable
      >
        <template #empty>
          <span>No pipelines found</span>
        </template>
      </OSelect>
      <OButton
        variant="ghost"
        size="icon-xs-sq"
        @click="refreshData"
        data-test="pipeline-history-refresh-btn"
        :loading="loading"
        icon-left="refresh"
      >
        <OTooltip :content="t('common.refresh') || 'Refresh'" side="top" />
      </OButton>
    </Teleport>
    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <div
        data-test="pipeline-history-table"
        class="pipeline-history-table card-container tw:h-full"
      >
        <OTable
          :frame="false"
          :data="rows"
          :columns="columns"
          :default-columns="false"
          row-key="id"
          width="100%"
          class="tw:w-full tw:h-full"
          pagination="server"
          :current-page="pagination.page"
          :page-size="pagination.rowsPerPage"
          :total-count="pagination.rowsNumber"
          :page-size-options="pageSizeOptions"
          sorting="server"
          :sort-by="pagination.sortBy"
          :sort-order="pagination.descending ? 'desc' : 'asc'"
          :loading="loading"
          :show-global-filter="false"
          dense
          bordered
          sticky-header
          @pagination-change="onPaginationChange"
          @sort-change="onSortChange"
        >
          <template #cell-timestamp="{ row }">
            {{ formatDate(row.timestamp) }}
          </template>

          <template #cell-start_time="{ row }">
            {{ formatDate(row.start_time) }}
          </template>

          <template #cell-end_time="{ row }">
            {{ formatDate(row.end_time) }}
          </template>

          <template #cell-status="{ row }">
            <OBadge
              :variant="getStatusVariant(row.status)"
              size="sm"
              data-test="pipeline-history-status-badge"
              :data-test-status="(row.status || '').toLowerCase()"
            >
              {{ row.status }}
            </OBadge>
          </template>

          <template #cell-is_realtime="{ row }">
            <OTooltip :content="row.is_realtime ? 'Real-time' : 'Scheduled'">
              <OIcon
                :name="row.is_realtime ? 'check-circle' : 'schedule'"
                :class="row.is_realtime ? 'tw:text-[var(--o2-positive)]' : 'tw:text-gray-500'"
                size="md"
              />
            </OTooltip>
          </template>

          <template #cell-is_silenced="{ row }">
            <OTooltip :content="row.is_silenced ? 'Silenced' : 'Not Silenced'">
              <OIcon
                :name="row.is_silenced ? 'volume-off' : 'volume-up'"
                :class="row.is_silenced ? 'tw:text-gray-500' : 'tw:text-[var(--o2-positive)]'"
                size="md"
              />
            </OTooltip>
          </template>

          <template #cell-duration="{ row }">
            {{ formatDuration(row.end_time - row.start_time) }}
          </template>

          <template #cell-is_partial="{ row }">
            <OIcon
              v-if="
                row.is_partial !== null &&
                row.is_partial !== undefined
              "
              :name="row.is_partial ? 'warning' : 'check-circle'"
              :class="row.is_partial ? 'tw:text-[var(--o2-warning)]' : 'tw:text-[var(--o2-positive)]'"
              size="xs"
            >
              <OTooltip
                :content="
                  row.is_partial
                    ? 'Partial Results'
                    : 'Complete Results'
                "
              />
            </OIcon>
            <span v-else>-</span>
          </template>

          <template #cell-delay_in_secs="{ row }">
            {{
              row.delay_in_secs !== null &&
              row.delay_in_secs !== undefined
                ? row.delay_in_secs + "s"
                : "-"
            }}
          </template>

          <template #cell-evaluation_took_in_secs="{ row }">
            {{
              row.evaluation_took_in_secs !== null &&
              row.evaluation_took_in_secs !== undefined
                ? row.evaluation_took_in_secs.toFixed(2) + "s"
                : "-"
            }}
          </template>

          <template #cell-query_took="{ row }">
            {{
              row.query_took !== null &&
              row.query_took !== undefined
                ? (row.query_took / 1000).toFixed(2) + "ms"
                : "-"
            }}
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-pipeline-history"
              :filtered="!!searchQuery"
              :hide-action="!searchQuery"
              @action="(id) => id === 'clear-filters' && clearSearch()"
            />
          </template>

          <template #bottom="{ totalRows }">
            <div
              class="tw:flex tw:items-center tw:font-bold tw:text-[14px] tw:mr-4 tw:py-2"
            >
              {{ totalRows }} {{ t("pipeline.header") }}
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <!-- Details Dialog -->
    <ODialog
      data-test="pipeline-history-details-dialog"
      v-model:open="detailsDialog"
      size="lg"
      title="Pipeline Execution Details"
      primary-button-label="Close"
      @click:primary="detailsDialog = false"
    >
      <div class="scroll" style="max-height: 70vh" v-if="selectedRow">
        <div class="tw:gap-2">
          <!-- Basic Information -->
          <div class="detail-section">
            <div class="tw:flex tw:gap-3">
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">
                  Pipeline Name
                </div>
                <div class="tw:text-sm text-weight-medium">
                  {{ selectedRow.pipeline_name }}
                </div>
              </div>
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Status</div>
                <OBadge
                  :variant="getStatusVariant(selectedRow.status)"
                  size="sm"
                >
                  {{ selectedRow.status }}
                </OBadge>
              </div>
            </div>
          </div>

          <OSeparator class="tw:my-2" />

          <!-- Time Information -->
          <div class="detail-section">
            <div class="tw:flex tw:gap-3">
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Timestamp</div>
                <div class="tw:text-sm">
                  {{ formatDate(selectedRow.timestamp) }}
                </div>
              </div>
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Duration</div>
                <div class="tw:text-sm">
                  {{
                    formatDuration(
                      selectedRow.end_time - selectedRow.start_time,
                    )
                  }}
                </div>
              </div>
            </div>
          </div>

          <OSeparator class="tw:my-2" />

          <!-- Pipeline Configuration -->
          <div class="detail-section">
            <div class="tw:flex tw:gap-3">
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Type</div>
                <div class="tw:text-sm">
                  <OIcon
                    :name="selectedRow.is_realtime ? 'speed' : 'schedule'"
                    class="tw:mr-1"
                    size="xs"
                  />
                  {{ selectedRow.is_realtime ? "Real-time" : "Scheduled" }}
                </div>
              </div>
              <div class="tw:w-1/2">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Silenced</div>
                <div class="tw:text-sm">
                  <OIcon
                    v-if="selectedRow.is_silenced"
                    name="volume-off"
                    size="xs"
                    class="tw:mr-1"
                  />
                  <OIcon v-else name="volume-up" size="xs" class="tw:mr-1" />
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
              selectedRow.retries > 0 ||
              selectedRow.delay_in_secs ||
              (selectedRow.is_partial !== null &&
                selectedRow.is_partial !== undefined)
            "
          >
            <OSeparator class="tw:my-2" />
            <div class="detail-section">
              <div class="tw:flex tw:gap-3">
                <div v-if="selectedRow.evaluation_took_in_secs" class="tw:w-1/3">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">
                    Evaluation Time
                  </div>
                  <div class="tw:text-sm">
                    {{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s
                  </div>
                </div>
                <div v-if="selectedRow.query_took" class="tw:w-1/3">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Query Time</div>
                  <div class="tw:text-sm">
                    {{ (selectedRow.query_took / 1000).toFixed(2) }}ms
                  </div>
                </div>
                <div v-if="selectedRow.retries > 0" class="tw:w-1/3">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Retries</div>
                  <div class="tw:text-sm">{{ selectedRow.retries }}</div>
                </div>
                <div v-if="selectedRow.delay_in_secs" class="tw:w-1/3">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Delay</div>
                  <div class="tw:text-sm">{{ selectedRow.delay_in_secs }}s</div>
                </div>
                <div
                  v-if="
                    selectedRow.is_partial !== null &&
                    selectedRow.is_partial !== undefined
                  "
                  class="tw:w-1/3"
                >
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">
                    Result Status
                  </div>
                  <div class="tw:text-sm">
                    <OIcon
                      :name="
                        selectedRow.is_partial ? 'warning' : 'check-circle'
                      "
                      :class="['tw:mr-1', selectedRow.is_partial ? 'tw:text-[var(--o2-warning)]' : 'tw:text-[var(--o2-positive)]']"
                      size="xs"
                    />
                    {{ selectedRow.is_partial ? "Partial" : "Complete" }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Source Node (if available) -->
          <template v-if="selectedRow.source_node">
            <OSeparator class="tw:my-2" />
            <div class="detail-section">
              <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Source Node</div>
              <div class="tw:text-sm text-mono">
                {{ selectedRow.source_node }}
              </div>
            </div>
          </template>

          <!-- Error Details (if available) -->
          <template v-if="selectedRow.error">
            <OSeparator class="tw:my-2" />
            <div class="detail-section">
              <div class="tw:text-xs tw:text-gray-400 tw:mb-1">
                <OIcon name="error" size="xs" class="tw:mr-1" />
                Error Details
              </div>
              <div
                class="tw:rounded tw:border tw:border-solid tw:border-negative/30 tw:p-2 tw:mt-2 tw:bg-red-500/5"
              >
                <pre
                  class="tw:text-sm"
                  style="
                    white-space: pre-wrap;
                    word-break: break-word;
                    margin: 0;
                    font-family: &quot;Courier New&quot;, monospace;
                    font-size: 12px;
                  "
                  >{{ selectedRow.error }}</pre
                >
              </div>
            </div>
          </template>

          <!-- Success Response (if available) -->
          <template v-if="selectedRow.success_response">
            <OSeparator class="tw:my-2" />
            <div class="detail-section">
              <div class="tw:text-xs tw:text-gray-400 tw:mb-1">
                <OIcon name="check-circle" size="xs" class="tw:mr-1" />
                Response
              </div>
              <div
                class="tw:rounded tw:border tw:border-solid tw:border-positive/30 tw:p-2 tw:mt-2 tw:bg-green-500/5"
              >
                <pre
                  class="tw:text-sm"
                  style="
                    white-space: pre-wrap;
                    word-break: break-word;
                    margin: 0;
                    font-family: &quot;Courier New&quot;, monospace;
                    font-size: 12px;
                  "
                  >{{ selectedRow.success_response }}</pre
                >
              </div>
            </div>
          </template>
        </div>
      </div>
    </ODialog>

    <!-- Error Dialog -->
    <ODialog
      data-test="pipeline-history-error-dialog"
      v-model:open="errorDialog"
      size="sm"
      :title="errorMessage?.pipeline_name"
      :sub-title="
        errorMessage?.last_error_timestamp
          ? `Last error: ${new Date(errorMessage.last_error_timestamp / 1000).toLocaleString()}`
          : undefined
      "
      primary-button-label="Close"
      @update:open="(v) => !v && closeErrorDialog()"
      @click:primary="closeErrorDialog"
    >
      <template #header-left>
        <OIcon name="error" size="md" class="error-icon" />
      </template>
      <div class="tw:mb-4">
        <div class="section-label tw:mb-2">Error Summary</div>
        <div class="error-summary-box">
          {{ errorMessage?.error }}
        </div>
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import * as dateUtils from "@/utils/date";
import DateTime from "@/components/DateTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import pipelinesService from "@/services/pipelines";
import http from "@/services/http";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

const { t } = useI18n();
const store = useStore();

// Data
const loading = ref(false);
const rows = ref<any[]>([]);
const searchQuery = ref("");
const selectedPipeline = ref<any>();
const allPipelines = ref<any[]>([]);
const filteredPipelineOptions = ref<any[]>([]);
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  rowsNumber: 0,
  sortBy: "timestamp",
  descending: true,
});

const pageSizeOptions = [10, 20, 50, 100];

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
const errorMessage = ref<any>(null);

// Table columns
const columns = ref([
  {
    id: "row_number",
    header: "#",
    accessorKey: "#",
    size: TABLE_INDEX_COL_SIZE,
    meta: { align: "left" as const },
  },
  {
    id: "pipeline_name",
    header: "Pipeline Name",
    accessorKey: "pipeline_name",
    sortable: true,
    size: 320,
    minSize: 320,
    meta: { align: "left" as const },
  },
  {
    id: "is_realtime",
    header: "Type",
    accessorKey: "is_realtime",
    sortable: true,
    size: 70,
    meta: { align: "center" as const },
  },
  {
    id: "is_silenced",
    header: "Is Silenced",
    accessorKey: "is_silenced",
    sortable: true,
    size: 100,
    meta: { align: "center" as const },
  },
  {
    id: "timestamp",
    header: "Timestamp",
    accessorKey: "timestamp",
    sortable: true,
    size: 160,
    meta: { align: "left" as const },
  },
  {
    id: "start_time",
    header: "Start Time",
    accessorKey: "start_time",
    sortable: true,
    size: 160,
    meta: { align: "left" as const },
  },
  {
    id: "end_time",
    header: "End Time",
    accessorKey: "end_time",
    sortable: true,
    size: 160,
    meta: { align: "left" as const },
  },
  {
    id: "duration",
    header: "Duration",
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: true,
    size: 90,
    meta: { align: "right" as const },
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortable: true,
    size: 150,
    meta: { align: "center" as const },
  },
  {
    id: "retries",
    header: "Retries",
    accessorKey: "retries",
    sortable: true,
    size: 50,
    meta: { align: "center" as const },
  },
  {
    id: "is_partial",
    header: "Partial",
    accessorKey: "is_partial",
    sortable: false,
    size: 60,
    meta: { align: "center" as const },
  },
  {
    id: "delay_in_secs",
    header: "Delay (s)",
    accessorKey: "delay_in_secs",
    sortable: true,
    size: 80,
    meta: { align: "right" as const },
  },
  {
    id: "evaluation_took_in_secs",
    header: "Eval Time (s)",
    accessorKey: "evaluation_took_in_secs",
    sortable: true,
    size: 100,
    meta: { align: "right" as const },
  },
  {
    id: "query_took",
    header: "Query Time (ms)",
    accessorKey: "query_took",
    sortable: true,
    size: 110,
    meta: { align: "right" as const },
  },
]);

// Methods
const fetchPipelinesList = async () => {
  try {
    const org = store.state.selectedOrganization.identifier;

    // Fetch all pipelines for the organization
    const res = await pipelinesService.getPipelines(org);

    if (res.data && res.data.list) {
      // Store complete pipeline objects and sort by name
      allPipelines.value = res.data.list
        .map((pipeline: any) => ({
          label: pipeline.name,
          value: pipeline.pipeline_id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
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
      v.label.toLowerCase().includes(needle),
    );
  });
};

const onPipelineSelected = (val: any) => {
  // OSelect with valueKey="value" emits the primitive value (pipeline id) or null on clear
  searchQuery.value = val ?? "";
  pagination.value.page = 1;
  fetchPipelineHistory();
};

const clearSearch = () => {
  searchQuery.value = "";
  selectedPipeline.value = undefined;
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
      params.pipeline_id = searchQuery.value.trim();
    }

    // Add sorting parameters
    if (pagination.value.sortBy) {
      params.sort_by = pagination.value.sortBy;
      params.sort_order = pagination.value.descending ? "desc" : "asc";
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
        "#":
          index +
          1 +
          (pagination.value.page - 1) * pagination.value.rowsPerPage,
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
    toast({
      variant: "error",
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

const onPaginationChange = (params: { page: number; size: number }) => {
  pagination.value.page = params.page;
  pagination.value.rowsPerPage = params.size;
  fetchPipelineHistory();
};

const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  pagination.value.sortBy = params.column;
  pagination.value.descending = params.order === "desc";
  pagination.value.page = 1;
  fetchPipelineHistory();
};

const refreshData = () => {
  fetchPipelineHistory();
};

const formatDate = (timestamp: number) => {
  if (!timestamp) return "-";
  // Convert microseconds to milliseconds
  const dateObj = new Date(timestamp / 1000);
  return dateUtils.formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
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

const getStatusVariant = (status: string) => {
  switch (status?.toLowerCase()) {
    case "success":
    case "ok":
    case "completed":
      return "success-outline";
    case "error":
    case "failed":
      return "error-outline";
    case "warning":
      return "warning-outline";
    case "pending":
    case "running":
      return "primary-outline";
    default:
      return "default-outline";
  }
};

const showDetailsDialog = (row: any) => {
  selectedRow.value = row;
  detailsDialog.value = true;
};

const showErrorDialog = (error: any) => {
  errorMessage.value = error;
  errorDialog.value = true;
};

const closeErrorDialog = () => {
  errorDialog.value = false;
  errorMessage.value = null;
};

// Lifecycle
onMounted(async () => {
  // Fetch pipelines list for the dropdown.
  // The history fetch is triggered by <DateTime>'s on-mount @on:date-change event,
  // so we don't call fetchPipelineHistory() here to avoid a duplicate request.
  await fetchPipelinesList();
});

// Watch for organization change (skip the initial firing — onMounted already fetched)
watch(
  () => store.state.selectedOrganization.identifier,
  async (newId, oldId) => {
    if (!oldId || newId === oldId) return;
    await fetchPipelinesList();
    clearSearch();
    fetchPipelineHistory();
  },
);
</script>

<style scoped lang="scss">
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
.pipeline-error-header {
  padding: 20px 24px 16px;

  .error-icon {
    color: #ef4444;
  }

  .pipeline-name {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .error-timestamp {
    display: flex;
    align-items: center;
    font-size: 13px;
    opacity: 0.7;
    margin-left: 36px;
  }

  .close-btn {
    opacity: 0.6;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1;
    }
  }
}

.pipeline-error-content {
  padding: 20px 24px;
  max-height: 60vh;
  overflow-y: auto;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.error-summary-box {
  padding: 16px;
  border-radius: 8px;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #dc2626;
}
.pipeline-error-actions {
  padding: 16px 24px;
  justify-content: flex-end;
}
</style>
