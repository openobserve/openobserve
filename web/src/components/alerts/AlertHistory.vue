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
  <OPageLayout
    data-test="alert-history-page"
    :title="t('alerts.history')"
    title-data-test="alerts-history-title"
    :back="{ onClick: goBack, dataTest: 'alert-history-back-btn' }"
    bleed
  >
      <template #actions>
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
        <OSelect
          v-model="selectedAlert"
          :options="filteredAlertOptions"
          labelKey="label"
          valueKey="value"
          @update:model-value="onAlertSelected"
          :placeholder="t(`alerts.searcHistory`) || 'Select or search alert...'"
          data-test="alert-history-search-select"
          class="o2-search-input min-w-62.5"
          clearable
          @clear="clearSearch"
        >
          <template #icon-left>
            <OIcon
              class="o2-search-input-icon"
              name="search" size="sm"
            />
          </template>
          <template #empty>
            <div class="px-3 py-2 text-muted-foreground">
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
      </template>
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
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
          show-index
          :show-global-filter="false"
          :default-columns="false"
          width="100%"
          max-height="calc(100vh - 130px)"
          @pagination-change="onPaginationChange"
          @sort-change="onSortChange"
        >
          <template #empty>
            <div class="h-screen w-full">
              <no-data />
            </div>
          </template>

          <template #cell-timestamp="{ value }">
            <OTimeCell :value="value" unit="us" mode="absolute" :timezone="store.state.timezone" empty-label="—" />
          </template>

          <template #cell-start_time="{ value }">
            <OTimeCell :value="value" unit="us" mode="absolute" :timezone="store.state.timezone" empty-label="—" />
          </template>

          <template #cell-end_time="{ value }">
            <OTimeCell :value="value" unit="us" mode="absolute" :timezone="store.state.timezone" empty-label="—" />
          </template>

          <template #cell-status="{ value }">
            <OTag type="alertState" :value="value" data-test="alert-history-status-badge" />
          </template>

          <template #cell-is_realtime="{ value }">
            <OIcon
              :name="value ? 'check-circle' : 'schedule'"
              :class="value ? 'text-status-positive' : 'text-text-body'"
              size="xs"
            >
              <OTooltip :content="value ? 'Real-time' : 'Scheduled'" />
            </OIcon>
          </template>

          <template #cell-is_silenced="{ value }">
            <OIcon
              :name="value ? 'volume-off' : 'volume-up'"
              :class="value ? 'text-text-body' : 'text-status-positive'"
              size="md"
            >
              <OTooltip :content="value ? 'Silenced' : 'Not Silenced'" />
            </OIcon>
          </template>

          <template #cell-duration="{ row }">
            {{ formatDuration(row.end_time - row.start_time) }}
          </template>

          <template #cell-dedup="{ row }">
            <span v-if="!row.dedup_enabled" class="text-text-secondary">-</span>
            <div v-else-if="row.dedup_suppressed" class="text-status-error-text">
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
            <div v-else-if="row.grouped" class="text-primary flex items-center justify-center">
              <OIcon name="group-work" size="md">
                <OTooltip>
                  <template #content>
                    Grouped notification
                    <div>{{ row.group_size }} alerts batched together</div>
                  </template>
                </OTooltip>
              </OIcon>
              <span class="text-xs ml-1">×{{ row.group_size || 1 }}</span>
            </div>
            <div v-else class="text-status-positive flex items-center justify-center">
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
              <span v-if="row.dedup_count && row.dedup_count > 1" class="text-xs ml-1">
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
      <div v-if="selectedRow" class="gap-2">
            <!-- Basic Information -->
            <div class="py-1 px-0">
              <div class="flex gap-3">
                <div class="w-1/2">
                  <div class="text-xs text-text-secondary mb-1">Alert Name</div>
                  <div class="text-sm font-medium">
                    {{ selectedRow.alert_name }}
                  </div>
                </div>
                <div class="w-1/2">
                  <div class="text-xs text-text-secondary mb-1">Status</div>
                  <OTag type="alertState" :value="selectedRow.status" />
                </div>
              </div>
            </div>

            <OSeparator class="my-2" />

            <!-- Time Information -->
            <div class="py-1 px-0">
              <div class="flex gap-3">
                <div class="w-1/2">
                  <div class="text-xs text-text-secondary mb-1">Timestamp</div>
                  <div class="text-sm">
                    {{ formatDate(selectedRow.timestamp) }}
                  </div>
                </div>
                <div class="w-1/2">
                  <div class="text-xs text-text-secondary mb-1">Duration</div>
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

            <!-- Alert Configuration -->
            <div class="py-1 px-0">
              <div class="flex gap-3">
                <div class="w-1/2">
                  <div class="text-xs text-text-secondary mb-1">Type</div>
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
                  <div class="text-xs text-text-secondary mb-1">Silenced</div>
                  <div class="text-sm">
                    <OIcon
                      v-if="selectedRow.is_silenced"
                      name="volume-off"
                      size="xs"
                      class="mr-1"
                    />
                    <OIcon
                      v-else
                      name="volume-up"
                      size="xs"
                      class="mr-1"
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
              <OSeparator class="my-2" />
              <div class="py-1 px-0">
                <div class="flex gap-3">
                  <div v-if="selectedRow.evaluation_took_in_secs" class="w-1/3">
                    <div class="text-xs text-text-secondary mb-1">
                      Evaluation Time
                    </div>
                    <div class="text-sm">
                      {{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s
                    </div>
                  </div>
                  <div v-if="selectedRow.query_took" class="w-1/3">
                    <div class="text-xs text-text-secondary mb-1">
                      Query Time
                    </div>
                    <div class="text-sm">
                      {{ (selectedRow.query_took / 1000).toFixed(2) }}ms
                    </div>
                  </div>
                  <div v-if="selectedRow.retries > 0" class="w-1/3">
                    <div class="text-xs text-text-secondary mb-1">Retries</div>
                    <div class="text-sm">{{ selectedRow.retries }}</div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Source Node (if available) -->
            <template v-if="selectedRow.source_node">
              <OSeparator class="my-2" />
              <div class="py-1 px-0">
                <div class="text-xs text-text-secondary mb-1">Source Node</div>
                <div class="text-sm font-mono">
                  {{ selectedRow.source_node }}
                </div>
              </div>
            </template>

            <!-- Error Details (if available) -->
            <template v-if="selectedRow.error">
              <OSeparator class="my-2" />
              <div class="py-1 px-0">
                <div class="text-xs text-text-secondary mb-1">
                  <OIcon
                    name="error"
                    size="xs"
                    class="mr-1"
                  />
                  Error Details
                </div>
                <div class="rounded-default border border-solid border-negative/30 p-2 mt-2 bg-status-error-bg">
                  <pre
                    class="text-sm"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
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
              <div class="py-1 px-0">
                <div class="text-xs text-text-secondary mb-1">
                  <OIcon
                    name="check-circle"
                    size="xs"
                    class="mr-1"
                  />
                  Response
                </div>
                <div class="rounded-default border border-solid border-positive/30 p-2 mt-2 bg-status-success-bg">
                  <pre
                    class="text-sm"
                    style="
                      white-space: pre-wrap;
                      word-break: break-word;
                      margin: 0;
                      font-family: var(--font-mono);
                      font-size: var(--text-xs);
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
        <OIcon name="error" size="sm" class="text-status-error-text" />
      </template>
      <template #header-right>
        <div class="flex items-center text-compact opacity-70 ml-9 text-xs">
          <span class="mr-1">Last error:</span>
          <OIcon name="schedule" size="xs" class="mr-1" />
          {{ errorMessage.last_error_timestamp && new Date(errorMessage.last_error_timestamp / 1000).toLocaleString() }}
        </div>
      </template>

      <div class="mb-4">
        <div class="text-sm font-semibold tracking-[0.02em] opacity-80 mb-2">Error Summary</div>
        <div class="p-4 rounded-default font-mono text-compact leading-[1.6] whitespace-pre-wrap wrap-break-word bg-status-error-bg border border-solid border-status-negative text-status-error-text">
          {{ errorMessage.error }}
        </div>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">

import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatDate } from "@/utils/date";
import DateTime from "@/components/DateTime.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import NoData from "@/components/shared/grid/NoData.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { COL } from "@/lib/core/Table/OTable.types";

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
    meta: { align: "left" },
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
    meta: { align: "left" },
  },
  {
    id: "timestamp",
    header: t("alerts.timestamp") || "Timestamp",
    accessorKey: "timestamp",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "start_time",
    header: t("alerts.startTime") || "Start Time",
    accessorKey: "start_time",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "end_time",
    header: t("alerts.endTime") || "End Time",
    accessorKey: "end_time",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
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
    meta: { align: "right" },
  },
  {
    id: "dedup",
    header: t("alerts.dedup") || "Dedup",
    sortable: false,
    size: 80,
    maxSize: 80,
    cell: " ",
    meta: { align: "left" },
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
