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
    class="flex flex-col h-full min-h-0"
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
        class="min-w-62.5"
        clearable
      >
        <template #empty>
          <span>{{ t('pipeline.noPipelinesFound') }}</span>
        </template>
      </OSelect>
      <OTableColumnToggle
        :columns="columns"
        :column-visibility="columnVisibility"
        @update:column-visibility="setColumnVisibility"
      />
      <OButton
        variant="outline"
        size="icon-sm"
        class="shrink-0"
        @click="refreshData"
        data-test="pipeline-history-refresh-btn"
        :loading="loading"
        icon-left="refresh"
      >
        <OTooltip :content="t('common.refresh') || 'Refresh'" side="top" />
      </OButton>
    </Teleport>
    <div class="flex-1 min-h-0 overflow-hidden">
      <div
        data-test="pipeline-history-table"
        class="pipeline-history-table bg-card-glass-bg h-full"
      >
        <OTable
          :frame="false"
          :data="rows"
          :columns="columns"
          :column-visibility="columnVisibility"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="pipelines-pipeline-history-list"
          row-key="id"
          width="100%"
          class="w-full h-full"
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
            <OTimeCell
              :value="row.timestamp"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
            />
          </template>

          <template #cell-start_time="{ row }">
            <OTimeCell
              :value="row.start_time"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
            />
          </template>

          <template #cell-end_time="{ row }">
            <OTimeCell
              :value="row.end_time"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
            />
          </template>

          <template #cell-status="{ row }">
            <span
              data-test="pipeline-history-status-badge"
              :data-test-status="(row.status || '').toLowerCase()"
            >
              <OTag type="queryStatus" :value="row.status" />
            </span>
          </template>

          <template #cell-is_realtime="{ row }">
            <OTooltip :content="row.is_realtime ? 'Real-time' : 'Scheduled'">
              <OIcon
                :name="row.is_realtime ? 'check-circle' : 'schedule'"
                :class="row.is_realtime ? 'text-status-positive' : 'text-text-muted'"
                size="md"
              />
            </OTooltip>
          </template>

          <template #cell-is_silenced="{ row }">
            <OTooltip :content="row.is_silenced ? 'Silenced' : 'Not Silenced'">
              <OIcon
                :name="row.is_silenced ? 'volume-off' : 'volume-up'"
                :class="row.is_silenced ? 'text-text-muted' : 'text-status-positive'"
                size="md"
              />
            </OTooltip>
          </template>

          <template #cell-duration="{ row }">
            <ONumberCell
              :value="row.end_time - row.start_time"
              format="durationUs"
            />
          </template>

          <template #cell-is_partial="{ row }">
            <OIcon
              v-if="
                row.is_partial !== null &&
                row.is_partial !== undefined
              "
              :name="row.is_partial ? 'warning' : 'check-circle'"
              :class="row.is_partial ? 'text-warning' : 'text-status-positive'"
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
              class="flex items-center text-xs font-normal mr-4 py-2"
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
      :title="t('pipeline.executionDetailsTitle')"
      :primary-button-label="t('common.close')"
      @click:primary="detailsDialog = false"
    >
      <div class="scroll" style="max-height: 70vh" v-if="selectedRow">
        <div class="gap-2">
          <!-- Basic Information -->
          <div class="py-1">
            <div class="flex gap-3">
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">
                  {{ t('pipeline.pipelineNameLabel') }}
                </div>
                <div class="text-sm font-medium">
                  {{ selectedRow.pipeline_name }}
                </div>
              </div>
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">{{ t('common.status') }}</div>
                <OTag type="queryStatus" :value="selectedRow.status" />
              </div>
            </div>
          </div>

          <OSeparator class="my-2" />

          <!-- Time Information -->
          <div class="py-1">
            <div class="flex gap-3">
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">{{ t('pipeline.timestampLabel') }}</div>
                <div class="text-sm">
                  {{ formatDate(selectedRow.timestamp) }}
                </div>
              </div>
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">{{ t('common.duration') }}</div>
                <div class="text-sm">
                  {{
                    formatDuration(
                      selectedRow.end_time - selectedRow.start_time,
                    )
                  }}
                </div>
              </div>
            </div>
          </div>

          <OSeparator class="my-2" />

          <!-- Pipeline Configuration -->
          <div class="py-1">
            <div class="flex gap-3">
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">{{ t('common.type') }}</div>
                <div class="text-sm">
                  <OIcon
                    :name="selectedRow.is_realtime ? 'speed' : 'schedule'"
                    class="mr-1"
                    size="xs"
                  />
                  {{ selectedRow.is_realtime ? "Real-time" : "Scheduled" }}
                </div>
              </div>
              <div class="w-1/2">
                <div class="text-xs text-text-label mb-1">{{ t('pipeline.silencedLabel') }}</div>
                <div class="text-sm">
                  <OIcon
                    v-if="selectedRow.is_silenced"
                    name="volume-off"
                    size="xs"
                    class="mr-1"
                  />
                  <OIcon v-else name="volume-up" size="xs" class="mr-1" />
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
            <OSeparator class="my-2" />
            <div class="py-1">
              <div class="flex gap-3">
                <div v-if="selectedRow.evaluation_took_in_secs" class="w-1/3">
                  <div class="text-xs text-text-label mb-1">
                    {{ t('pipeline.evaluationTimeLabel') }}
                  </div>
                  <div class="text-sm">
                    <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- SI unit abbreviation for seconds, appended directly to a numeric value; not natural-language text -->
                    {{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s
                  </div>
                </div>
                <div v-if="selectedRow.query_took" class="w-1/3">
                  <div class="text-xs text-text-label mb-1">{{ t('pipeline.queryTimeLabel') }}</div>
                  <div class="text-sm">
                    <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- SI unit abbreviation for milliseconds, appended directly to a numeric value; not natural-language text -->
                    {{ (selectedRow.query_took / 1000).toFixed(2) }}ms
                  </div>
                </div>
                <div v-if="selectedRow.retries > 0" class="w-1/3">
                  <div class="text-xs text-text-label mb-1">{{ t('pipeline.retriesLabel') }}</div>
                  <div class="text-sm">{{ selectedRow.retries }}</div>
                </div>
                <div v-if="selectedRow.delay_in_secs" class="w-1/3">
                  <div class="text-xs text-text-label mb-1">{{ t('pipeline.delay') }}</div>
                  <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- SI unit abbreviation for seconds, appended directly to a numeric value; not natural-language text -->
                  <div class="text-sm">{{ selectedRow.delay_in_secs }}s</div>
                </div>
                <div
                  v-if="
                    selectedRow.is_partial !== null &&
                    selectedRow.is_partial !== undefined
                  "
                  class="w-1/3"
                >
                  <div class="text-xs text-text-label mb-1">
                    {{ t('pipeline.resultStatusLabel') }}
                  </div>
                  <div class="text-sm">
                    <OIcon
                      :name="
                        selectedRow.is_partial ? 'warning' : 'check-circle'
                      "
                      :class="['mr-1', selectedRow.is_partial ? 'text-warning' : 'text-status-positive']"
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
            <OSeparator class="my-2" />
            <div class="py-1">
              <div class="text-xs text-text-label mb-1">{{ t('pipeline.sourceNodeLabel') }}</div>
              <div class="text-sm font-mono text-compact">
                {{ selectedRow.source_node }}
              </div>
            </div>
          </template>

          <!-- Error Details (if available) -->
          <template v-if="selectedRow.error">
            <OSeparator class="my-2" />
            <div class="py-1">
              <div class="text-xs text-text-label mb-1">
                <OIcon name="error" size="xs" class="mr-1" />
                {{ t('pipeline.errorDetailsLabel') }}
              </div>
              <div
                class="rounded-default border border-solid border-status-negative/30 p-2 mt-2 bg-status-error-bg"
              >
                <pre
                  class="text-sm whitespace-pre-wrap m-0"
                  style="
                    word-break: break-word;
                    font-family: var(--font-mono);
                    font-size: var(--text-xs);
                  "
                  >{{ selectedRow.error }}</pre
                >
              </div>
            </div>
          </template>

          <!-- Success Response (if available) -->
          <template v-if="selectedRow.success_response">
            <OSeparator class="my-2" />
            <div class="py-1">
              <div class="text-xs text-text-label mb-1">
                <OIcon name="check-circle" size="xs" class="mr-1" />
                {{ t('pipeline.responseLabel') }}
              </div>
              <div
                class="rounded-default border border-solid border-status-positive/30 p-2 mt-2 bg-status-success-bg"
              >
                <pre
                  class="text-sm whitespace-pre-wrap m-0"
                  style="
                    word-break: break-word;
                    font-family: var(--font-mono);
                    font-size: var(--text-xs);
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
      :primary-button-label="t('common.close')"
      @update:open="(v) => !v && closeErrorDialog()"
      @click:primary="closeErrorDialog"
    >
      <template #header-left>
        <OIcon name="error" size="md" class="text-status-error-text" />
      </template>
      <div class="mb-4">
        <div class="text-compact font-semibold tracking-[0.02em] opacity-80 mb-2">{{ t('pipeline.errorSummaryLabel') }}</div>
        <div class="p-4 rounded-default font-mono text-compact leading-[1.6] whitespace-pre-wrap wrap-break-word bg-banner-error-soft-bg border border-banner-error-soft-border text-banner-error-soft-text">
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
import OTag from "@/lib/core/Badge/OTag.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import ONumberCell from "@/lib/core/Table/cells/ONumberCell.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import pipelinesService from "@/services/pipelines";
import http from "@/services/http";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";

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

const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(
  "pipelines-pipeline-history-list",
);

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
const columns = ref<OTableColumnDef[]>([
  {
    id: "pipeline_name",
    header: "Pipeline Name",
    accessorKey: "pipeline_name",
    sortable: true,
    hideable: true,
    size: 320,
    minSize: 320,
    meta: { align: "left" as const },
  },
  {
    id: "is_realtime",
    header: "Type",
    accessorKey: "is_realtime",
    sortable: true,
    hideable: true,
    size: 70,
    meta: { align: "left" as const },
  },
  {
    id: "is_silenced",
    header: "Is Silenced",
    accessorKey: "is_silenced",
    sortable: true,
    hideable: true,
    size: 100,
    meta: { align: "left" as const },
  },
  {
    id: "timestamp",
    header: "Timestamp",
    accessorKey: "timestamp",
    sortable: true,
    hideable: true,
    size: COL.dateAbsolute,
    meta: { align: "left" as const },
  },
  {
    id: "start_time",
    header: "Start Time",
    accessorKey: "start_time",
    sortable: true,
    hideable: true,
    size: COL.dateAbsolute,
    meta: { align: "left" as const },
  },
  {
    id: "end_time",
    header: "End Time",
    accessorKey: "end_time",
    sortable: true,
    hideable: true,
    size: COL.dateAbsolute,
    meta: { align: "left" as const },
  },
  {
    id: "duration",
    header: "Duration",
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: true,
    hideable: true,
    size: 90,
    meta: { align: "right" as const },
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortable: true,
    hideable: true,
    // Wide enough for the longest status chip ("Condition Not Satisfied");
    // minSize stops the column shrinking and clipping the pill on narrow
    // viewports (the cell clips non-wrapped content by design).
    size: 200,
    minSize: 200,
    meta: { align: "left" as const },
  },
  {
    id: "retries",
    header: "Retries",
    accessorKey: "retries",
    sortable: true,
    hideable: true,
    // Wide enough for the header word "Retries" + the sort icon; at 50px the
    // header truncated to just "R…". minSize keeps it legible after a resize.
    size: 90,
    minSize: 80,
    meta: { align: "right" as const },
  },
  {
    id: "is_partial",
    header: "Partial",
    accessorKey: "is_partial",
    sortable: false,
    hideable: true,
    size: 60,
    meta: { align: "left" as const },
  },
  {
    id: "delay_in_secs",
    header: "Delay (s)",
    accessorKey: "delay_in_secs",
    sortable: true,
    hideable: true,
    size: 80,
    meta: { align: "right" as const },
  },
  {
    id: "evaluation_took_in_secs",
    header: "Eval Time (s)",
    accessorKey: "evaluation_took_in_secs",
    sortable: true,
    hideable: true,
    size: 100,
    meta: { align: "right" as const },
  },
  {
    id: "query_took",
    header: "Query Time (ms)",
    accessorKey: "query_took",
    sortable: true,
    hideable: true,
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
        .sort((a: { label: string; value: string }, b: { label: string; value: string }) =>
          a.label.localeCompare(b.label),
        );
      filteredPipelineOptions.value = [...allPipelines.value];
    }
  } catch (error: any) {
    console.error("Error fetching pipelines list:", error);
    // Silently fail - user can still type pipeline names manually
  }
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
