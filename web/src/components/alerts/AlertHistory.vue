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
    data-test="alert-history-page"
    class="tw:p-0 tw:flex"
  >
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pt-[0.325rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="tw:flex tw:justify-between tw:w-full tw:h-[68px] tw:px-2 tw:py-3"
        >
          <div class="tw:flex tw:items-center">
            <OButton
              padding="xs"
              variant="outline"
              size="icon-sm"
              icon-left="arrow-back-ios-new"
              @click="goBack"
              data-test="alert-history-back-btn"
            />
            <div
              class="tw:text-xl tw:tracking-[0.005em] tw:font-[600] tw:ml-2"
              data-test="alerts-history-title"
            >
              {{ t(`alerts.history`) }}
            </div>
          </div>
          <div class="tw:flex tw:ml-auto tw:items-center">
            <div class="tw:mr-2">
              <DateTime
                ref="dateTimeRef"
                auto-apply
                :default-type="dateTimeType"
                :default-absolute-time="{
                  startTime: absoluteTime.startTime,
                  endTime: absoluteTime.endTime,
                }"
                :default-relative-time="relativeTime"
                data-test="alert-history-date-picker"
                @on:date-change="updateDateTime"
              />
            </div>
            <OSelect
              v-model="selectedAlert"
              :options="filteredAlertOptions"
              labelKey="label"
              valueKey="value"
              @update:model-value="onAlertSelected"
              :placeholder="t(`alerts.searcHistory`) || 'Select or search alert...'"
              data-test="alert-history-search-select"
              class="o2-search-input tw:mr-2"
              style="min-width: 250px"
              clearable
              @clear="clearSearch"
            >
              <template #icon-left>
                <OIcon
                  class="o2-search-input-icon"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-search-input-icon-dark'
                      : 'o2-search-input-icon-light'
                  "
                  name="search" size="sm"
                />
              </template>
              <template #empty>
                <div class="tw:px-3 tw:py-2 tw:text-muted-foreground">
                  No alerts found
                </div>
              </template>
            </OSelect>
            <OButton
              variant="ghost"
              icon-left="search"
              size="icon-sm"
              @click="manualSearch"
              data-test="alert-history-manual-search-btn"
              :disabled="loading"
              class="tw:mr-2"
            >
              <OTooltip :content="t('common.search') || 'Search'" />
            </OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="refresh"
              @click="refreshData"
              data-test="alert-history-refresh-btn"
              :loading="loading"
            >
              <OTooltip :content="t('common.refresh') || 'Refresh'" />
            </OButton>
          </div>
        </div>
      </div>
    </div>
    <div class="tw:w-full tw:h-full tw:px-[0.625rem]">
      <div class="alert-history-table card-container tw:h-[calc(100vh-130px)]">
        <OTable
          data-test="alert-history-table"
          :data="rows"
          :columns="columns"
          row-key="id"
          pagination="server"
          :current-page="currentPage"
          :page-size="pageSize"
          :page-size-options="pageSizeOptions"
          :total-count="totalCount"
          sorting="server"
          :sort-by="sortBy"
          :sort-order="sortOrder"
          :loading="loading"
          :show-global-filter="false"
          :default-columns="false"
          width="100%"
          max-height="calc(100vh - 130px)"
          @pagination-change="onPaginationChange"
          @sort-change="onSortChange"
        >
          <template #empty>
            <div class="tw:h-[100vh] tw:w-full">
              <no-data />
            </div>
          </template>

          <template #cell-timestamp="{ value }">
            {{ formatDate(value) }}
          </template>

          <template #cell-start_time="{ value }">
            {{ formatDate(value) }}
          </template>

          <template #cell-end_time="{ value }">
            {{ formatDate(value) }}
          </template>

          <template #cell-status="{ value }">
            <OBadge
              :variant="getStatusVariant(value)"
              size="sm"
            >
              {{ value }}
            </OBadge>
          </template>

          <template #cell-is_realtime="{ value }">
            <OIcon
              :name="value ? 'check-circle' : 'schedule'"
              :class="value ? 'tw:text-[var(--o2-positive)]' : 'tw:text-gray-500'"
              size="xs"
            >
              <OTooltip :content="value ? 'Real-time' : 'Scheduled'" />
            </OIcon>
          </template>

          <template #cell-is_silenced="{ value }">
            <OIcon
              :name="value ? 'volume-off' : 'volume-up'"
              :class="value ? 'tw:text-gray-500' : 'tw:text-[var(--o2-positive)]'"
              size="md"
            >
              <OTooltip :content="value ? 'Silenced' : 'Not Silenced'" />
            </OIcon>
          </template>

          <template #cell-duration="{ row }">
            {{ formatDuration(row.end_time - row.start_time) }}
          </template>

          <template #cell-dedup="{ row }">
            <span v-if="!row.dedup_enabled" class="tw:text-gray-400">-</span>
            <div v-else-if="row.dedup_suppressed" class="tw:text-red-500">
              <OIcon name="block" size="sm">
                <OTooltip>
                  <template #content>
                    Suppressed by deduplication
                    <div v-if="row.dedup_count">
                      {{ row.dedup_count }} occurrence{{ row.dedup_count > 1 ? 's' : '' }}
                    </div>
                  </template>
                </OTooltip>
              </OIcon>
            </div>
            <div v-else-if="row.grouped" class="text-primary tw:flex tw:items-center tw:justify-center">
              <OIcon name="group-work" size="md">
                <OTooltip>
                  <template #content>
                    Grouped notification
                    <div>{{ row.group_size }} alerts batched together</div>
                  </template>
                </OTooltip>
              </OIcon>
              <span class="tw:text-xs tw:ml-1">×{{ row.group_size || 1 }}</span>
            </div>
            <div v-else class="tw:text-green-500 tw:flex tw:items-center tw:justify-center">
              <OIcon name="check-circle" size="md">
                <OTooltip>
                  <template #content>
                    Notification sent
                    <div v-if="row.dedup_count && row.dedup_count > 1">
                      {{ row.dedup_count }} occurrences deduplicated
                    </div>
                  </template>
                </OTooltip>
              </OIcon>
              <span v-if="row.dedup_count && row.dedup_count > 1" class="tw:text-xs tw:ml-1">
                ×{{ row.dedup_count }}
              </span>
            </div>
          </template>

          <template #cell-actions="{ row }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="visibility"
              @click="showDetailsDialog(row)"
              data-test="alert-history-view-details"
            >
              <OTooltip content="View Details" />
            </OButton>
            <OButton
              v-if="row.error"
              :data-test="`pipeline-list-${row.name}-error-indicator`"
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="error"
              @click.stop="showErrorDialog(row)"
            >
              <OTooltip :content="`Last error: ${new Date(row.timestamp / 1000).toLocaleString()}`" />
            </OButton>
          </template>
        </OTable>
      </div>
    </div>

    <!-- Details Dialog -->
    <ODialog data-test="alert-history-details-dialog"
      v-model:open="detailsDialog"
      :width="55"
      title="Alert Execution Details"
      primary-button-label="Close"
      @click:primary="detailsDialog = false"
    >
      <div v-if="selectedRow" class="tw:gap-2">
            <!-- Basic Information -->
            <div class="detail-section">
              <div class="tw:flex tw:gap-3">
                <div class="tw:w-1/2">
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Alert Name</div>
                  <div class="tw:text-sm tw:font-medium">
                    {{ selectedRow.alert_name }}
                  </div>
                </div>
                <div class="tw:w-1/2">
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Status</div>
                  <OBadge
                    :variant="getStatusVariant(selectedRow.status)"
                    size="sm"
                    dot
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
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Timestamp</div>
                  <div class="tw:text-sm">
                    {{ formatDate(selectedRow.timestamp) }}
                  </div>
                </div>
                <div class="tw:w-1/2">
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Duration</div>
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

            <!-- Alert Configuration -->
            <div class="detail-section">
              <div class="tw:flex tw:gap-3">
                <div class="tw:w-1/2">
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Type</div>
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
                  <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Silenced</div>
                  <div class="tw:text-sm">
                    <OIcon
                      v-if="selectedRow.is_silenced"
                      name="volume-off"
                      size="xs"
                      class="tw:mr-1"
                    />
                    <OIcon
                      v-else
                      name="volume-up"
                      size="xs"
                      class="tw:mr-1"
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
              <OSeparator class="tw:my-2" />
              <div class="detail-section">
                <div class="tw:flex tw:gap-3">
                  <div v-if="selectedRow.evaluation_took_in_secs" class="tw:w-1/3">
                    <div class="tw:text-xs tw:text-text-secondary tw:mb-1">
                      Evaluation Time
                    </div>
                    <div class="tw:text-sm">
                      {{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s
                    </div>
                  </div>
                  <div v-if="selectedRow.query_took" class="tw:w-1/3">
                    <div class="tw:text-xs tw:text-text-secondary tw:mb-1">
                      Query Time
                    </div>
                    <div class="tw:text-sm">
                      {{ (selectedRow.query_took / 1000).toFixed(2) }}ms
                    </div>
                  </div>
                  <div v-if="selectedRow.retries > 0" class="tw:w-1/3">
                    <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Retries</div>
                    <div class="tw:text-sm">{{ selectedRow.retries }}</div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Source Node (if available) -->
            <template v-if="selectedRow.source_node">
              <OSeparator class="tw:my-2" />
              <div class="detail-section">
                <div class="tw:text-xs tw:text-text-secondary tw:mb-1">Source Node</div>
                <div class="tw:text-sm tw:font-mono">
                  {{ selectedRow.source_node }}
                </div>
              </div>
            </template>

            <!-- Error Details (if available) -->
            <template v-if="selectedRow.error">
              <OSeparator class="tw:my-2" />
              <div class="detail-section">
                <div class="tw:text-xs tw:text-text-secondary tw:mb-1">
                  <OIcon
                    name="error"
                    size="xs"
                    class="tw:mr-1"
                  />
                  Error Details
                </div>
                <div class="tw:rounded tw:border tw:border-solid tw:border-negative/30 tw:p-2 tw:mt-2 tw:bg-red-500/5">
                  <pre
                    class="tw:text-sm"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
                      font-family: 'Courier New', monospace;
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
                <div class="tw:text-xs tw:text-text-secondary tw:mb-1">
                  <OIcon
                    name="check-circle"
                    size="xs"
                    class="tw:mr-1"
                  />
                  Response
                </div>
                <div class="tw:rounded tw:border tw:border-solid tw:border-positive/30 tw:p-2 tw:mt-2 tw:bg-green-500/5">
                  <pre
                    class="tw:text-sm"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
                      font-family: 'Courier New', monospace;
                      font-size: 12px;
                    "
                    >{{ selectedRow.success_response }}</pre
                  >
                </div>
              </div>
            </template>
      </div>
    </ODialog>

    <!-- Error Dialog -->
    <ODialog data-test="alert-history-error-dialog"
      v-model:open="errorDialog"
      size="md"
      :title="errorMessage.alert_name"
      primary-button-label="Close"
      @click:primary="closeErrorDialog"
    >
      <template #header-left>
        <OIcon name="error" size="sm" class="error-icon" />
      </template>
      <template #header-right>
        <div class="error-timestamp tw:text-xs">
          <span class="tw:mr-1">Last error:</span>
          <OIcon name="schedule" size="xs" class="tw:mr-1" />
          {{ errorMessage.last_error_timestamp && new Date(errorMessage.last_error_timestamp / 1000).toLocaleString() }}
        </div>
      </template>

      <div class="tw:mb-4">
        <div class="section-label tw:mb-2">Error Summary</div>
        <div class="error-summary-box">
          {{ errorMessage.error }}
        </div>
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">

import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatDate } from "@/utils/date";
import DateTime from "@/components/DateTime.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import NoData from "@/components/shared/grid/NoData.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

// Data
const loading = ref(false);
const rows = ref<any[]>([]);
const searchQuery = ref("");
const selectedAlert = ref<any>(null);
const allAlerts = ref<any[]>([]);
const filteredAlertOptions = ref<any[]>([]);
const currentPage = ref(1);
const pageSize = ref(20);
const totalCount = ref(0);
const sortBy = ref("timestamp");
const sortOrder = ref<"asc" | "desc">("desc");

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
const errorMessage = ref("");

// Table columns
const columns = ref<OTableColumnDef[]>([
  { id: "#", header: "#", accessorKey: "#", size: TABLE_INDEX_COL_SIZE, minSize: TABLE_INDEX_COL_SIZE, maxSize: TABLE_INDEX_COL_SIZE, sortable: false, meta: { align: "left" } },
  {
    id: "alert_name",
    header: t("alerts.alertName") || "Alert Name",
    accessorKey: "alert_name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "is_realtime",
    header: t("alerts.type") || "Type",
    accessorKey: "is_realtime",
    sortable: true,
    size: 37,
    minSize: 37,
    maxSize: 37,
    cell: " ",
    meta: { align: "center" },
  },
  {
    id: "is_silenced",
    header: t("alerts.isSilenced") || "Is Silenced",
    accessorKey: "is_silenced",
    sortable: true,
    size: 37,
    minSize: 37,
    maxSize: 37,
    cell: " ",
    meta: { align: "center" },
  },
  {
    id: "timestamp",
    header: t("alerts.timestamp") || "Timestamp",
    accessorKey: "timestamp",
    sortable: true,
    size: 160,
    maxSize: 160,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "start_time",
    header: t("alerts.startTime") || "Start Time",
    accessorKey: "start_time",
    sortable: true,
    size: 160,
    maxSize: 160,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "end_time",
    header: t("alerts.endTime") || "End Time",
    accessorKey: "end_time",
    sortable: true,
    size: 160,
    maxSize: 160,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "duration",
    header: t("alerts.duration") || "Duration",
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: false,
    size: COL.duration,
    maxSize: COL.duration,
    cell: " ",
    meta: { align: "right" },
  },
  {
    id: "status",
    header: t("alerts.status") || "Status",
    accessorKey: "status",
    sortable: true,
    size: COL.status,
    maxSize: COL.status,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "retries",
    header: t("alerts.retries") || "Retries",
    accessorKey: "retries",
    sortable: true,
    size: 64,
    maxSize: 64,
    meta: { align: "center" },
  },
  {
    id: "dedup",
    header: t("alerts.dedup") || "Dedup",
    sortable: false,
    size: 80,
    maxSize: 80,
    cell: " ",
    meta: { align: "center" },
  },
  {
    id: "actions",
    header: t("common.actions") || "Actions",
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    sortable: false,
    meta: { align: "center", actionCount: 2 },
  },
]);

// Computed
const filteredRows = computed(() => {
  // Removed client-side filtering as we're using server-side pagination
  return rows.value;
});

// Methods
const fetchAlertsList = async () => {
  try {
    const org = store.state.selectedOrganization.identifier;

    // Fetch all alerts for the organization
    const res = await alertsService.listByFolderId(
      1,
      1000,
      "name",
      false,
      "",
      org,
      "", // all folders
      "", // no query filter
    );

    if (res.data && res.data.list) {
      // Store complete alert objects and sort by name
      allAlerts.value = res.data.list
        .map((alert: any) => ({
          label: alert.name,
          value: alert.alert_id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      filteredAlertOptions.value = [...allAlerts.value];
    }
  } catch (error: any) {
    console.error("Error fetching alerts list:", error);
    // Silently fail - user can still type alert names manually
  }
};

const filterAlertOptions = (val: string, update: any) => {
  update(() => {
    const needle = val.toLowerCase();
    filteredAlertOptions.value = allAlerts.value.filter((v) =>
      v.label.toLowerCase().includes(needle),
    );
  });
};

const onAlertSelected = (val: any) => {
  if (val) {
    // Extract the alert_id from the selected object
    if (typeof val === 'object' && val.value) {
      searchQuery.value = val.value;
    } else if (typeof val === 'string') {
      searchQuery.value = val;
    }
  }
};

const clearSearch = () => {
  searchQuery.value = "";
  selectedAlert.value = null;
};

const manualSearch = () => {
  currentPage.value = 1;
  fetchAlertHistory();
};

const fetchAlertHistory = async () => {
  loading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;

    const startTime = dateTimeValues.value.startTime;
    const endTime = dateTimeValues.value.endTime;

    const query: any = {
      start_time: startTime.toString(),
      end_time: endTime.toString(),
      from: ((currentPage.value - 1) * pageSize.value).toString(),
      size: pageSize.value.toString(),
    };

    if (searchQuery.value && searchQuery.value.trim()) {
      query.alert_id = searchQuery.value.trim();
    }

    if (sortBy.value) {
      query.sort_by = sortBy.value;
      query.sort_order = sortOrder.value;
    }

    const response = await alertsService.getHistory(org, query);
    if (response.data) {
      const historyData = response.data;

      rows.value = (historyData.hits || []).map((hit: any, index: number) => ({
        ...hit,
        id: `${hit.timestamp}_${index}`,
        "#": (index + 1) + (currentPage.value - 1) * pageSize.value,
      }));

      totalCount.value = historyData.total || 0;

      if (rows.value.length === 0) {
        console.warn("No alert history found for the selected time range");
      }
    }
  } catch (error: any) {
    console.error("Error fetching alert history:", error);
    console.error("Error response:", error.response);
    toast({
      variant: "error",
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to fetch alert history",
    });
  } finally {
    loading.value = false;
  }
};

const updateDateTime = (value: any) => {
  dateTimeValues.value = {
    startTime: value.startTime,
    endTime: value.endTime,
    type: value.relativeTimePeriod ? "relative" : "absolute",
    relativeTimePeriod: value.relativeTimePeriod || "",
  };

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

  currentPage.value = 1;
  fetchAlertHistory();
};

const onPaginationChange = (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  pageSize.value = params.size;
  fetchAlertHistory();
};

const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  sortBy.value = params.column;
  sortOrder.value = params.order;
  fetchAlertHistory();
};

const refreshData = () => {
  fetchAlertHistory();
};

const formatDate = (timestamp: number) => {
  if (!timestamp) return "-";
  // Convert microseconds to milliseconds
  const dateObj = new Date(timestamp / 1000);
  return formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
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

const showErrorDialog = (error: string) => {
  errorMessage.value = error;
  errorDialog.value = true;
};

const closeErrorDialog = () => {
  errorDialog.value = false;
  errorMessage.value = null;
};

const goBack = () => {
  router.push({ name: "alertList", query: { org_identifier: store.state.selectedOrganization.identifier } });
};

// Lifecycle
onMounted(async () => {
  // Fetch alerts list for dropdown
  await fetchAlertsList();
  // Fetch initial alert history
  fetchAlertHistory();
});

// Watch for organization change
watch(
  () => store.state.selectedOrganization.identifier,
  async () => {
    // Re-fetch alerts list when organization changes
    await fetchAlertsList();
    // Reset search
    clearSearch();
    // Fetch history for new organization
    fetchAlertHistory();
  },
);
</script>

<style scoped lang="scss">
.alert-history-table {
  :deep(table) {
    width: 100%;

    td {
      vertical-align: middle;
    }
  }
}

.alert-details-dialog {
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

  .tw:bg-red-500-1 {
    background-color: rgba(255, 0, 0, 0.05);
  }

  .tw:bg-green-500-1 {
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
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.error-summary-box {
  padding: 16px;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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
