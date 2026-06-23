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
  <ODrawer data-test="alert-history-drawer"
    :open="open"
    :width="65"
    :title="t('alert_list.alert_history')"
    @update:open="emit('update:open', $event)"
  >
    <!-- #header override required: header contains alert name/type badges,
         tab toggle, and datetime picker — too complex for title + sub-slots -->
    <template #header-left>
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:flex-1 tw:min-w-0"
            data-test="alert-details-title"
          >
            <!-- Alert Name Badge — truncates so a long name can never push the
                 tab toggle into the datetime picker; full name stays in tooltip -->
            <span
              v-if="alertDetails"
              :class="[
                'tw:font-semibold tw:text-[18px] tw:mr-2 tw:px-2 tw:py-1 tw:rounded-md tw:ml-2 tw:min-w-0 tw:truncate',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50',
              ]"
              data-test="alert-history-name-badge"
            >
              {{ alertDetails.name }}
              <OTooltip
                v-if="alertDetails.name"
                :content="alertDetails.name"
              />
            </span>
            <!-- Alert Type Badge -->
            <div
              v-if="alertDetails"
              :class="[
                'tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border tw:shrink-0',
                store.state.theme === 'dark'
                  ? 'tw:bg-gray-800/50 tw:border-gray-600'
                  : 'tw:bg-gray-50 tw:border-gray-200',
              ]"
            >
              <OIcon
                :name="
                  isAnomaly
                    ? 'query-stats'
                    : alertDetails.is-real-time
                      ? 'bolt'
                      : 'schedule'
                "
                size="sm"
                class="tw:opacity-70"
              />
              <span
                :class="[
                  'tw:text-xs tw:font-semibold',
                  store.state.theme === 'dark'
                    ? 'tw:text-gray-200'
                    : 'tw:text-gray-800',
                ]"
              >
                {{
                  isAnomaly
                    ? "Anomaly Detection"
                    : alertDetails.is_real_time
                      ? "Real-time"
                      : "Scheduled"
                }}
              </span>
            </div>
            <!-- Tab toggle -->
            <OToggleGroup
              class="tw:shrink-0"
              :model-value="activeTab"
              @update:model-value="activeTab = $event as string"
            >
              <OToggleGroupItem
                value="history"
                size="sm"
                data-test="alert-history-tab-history"
              >
                <template #icon-left>
                  <OIcon name="history" size="sm" />
                </template>
                History
              </OToggleGroupItem>
              <OToggleGroupItem
                value="condition"
                size="sm"
                data-test="alert-history-tab-condition"
              >
                <template #icon-left>
                  <OIcon name="code" size="sm" />
                </template>
                Condition
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
    </template>
    <template #header-right>
      <div class="col-auto tw:flex tw:items-center tw:gap-1">
        <DateTime
          :style="activeTab !== 'history' ? 'visibility: hidden' : ''"
          ref="dateTimeRef"
          auto-apply
          :default-type="dateTimeType"
          :default-absolute-time="{
            startTime: absoluteTime.startTime,
            endTime: absoluteTime.endTime,
          }"
          :default-relative-time="relativeTime"
          data-test="alert-history-drawer-date-picker"
          @on:date-change="updateDateTime"
        />
      </div>
    </template>

    <!-- Content -->
    <div class="tw:flex tw:flex-col tw:h-[calc(100vh-4rem)]" v-if="alertDetails">
      <!-- Tab Panels -->
      <OTabPanels
        v-model="activeTab"
        animated
        class="tw:flex-1 tw:overflow-hidden tw:bg-transparent"
        style="display: flex; flex-direction: column"
      >
        <!-- History Panel -->
        <OTabPanel
          name="history"
          layout="flex-col"
          stretch
        >
          <div
            class="tw:flex tw:h-full tw:flex-col tw:flex-1 tw:overflow-hidden tw:px-2 tw:py-2"
          >
            <!-- Empty state -->
            <div
              v-if="!isLoadingHistory && alertHistory.length === 0"
              class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:gap-2"
            >
              <div
                class="tw:w-14 tw:h-14 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:mb-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:bg-gray-800'
                    : 'tw:bg-gray-100'
                "
              >
                <OIcon
                  name="history-toggle-off"
                  size="lg"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                />
              </div>
              <div
                class="tw:text-sm tw:font-medium"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-gray-400'
                    : 'tw:text-gray-600'
                "
              >
                {{ t("alerts.alertDetails.noHistoryAvailable") }}
              </div>
              <div
                class="tw:text-xs"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-gray-600'
                    : 'tw:text-gray-400'
                "
              >
                Try expanding the time range
              </div>
            </div>

            <!-- History Table -->
            <div
              v-else
              class="code-block tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden"
              :class="
                store.state.theme === 'dark'
                  ? 'code-block-dark'
                  : 'code-block-light'
              "
            >
              <OTable
                :data="alertHistory"
                :columns="historyTableColumns"
                row-key="timestamp"
                pagination="server"
                v-model:current-page="currentPage"
                v-model:page-size="selectedPerPage"
                :total-count="resultTotal"
                :loading="isLoadingHistory"
                :row-class="getRowClass"
                :default-columns="false"
                :show-global-filter="false"
                class="history-table tw:flex-1 tw:overflow-hidden"
                data-test="alert-details-history-table"
                @pagination-change="onPaginationChange"
              >
                <template #[`cell-#`]="{ row }">
                  <span
                    class="tw:text-[13px] tw:tabular-nums"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-gray-500'
                        : 'tw:text-gray-400'
                    "
                  >
                    {{
                      (currentPage - 1) * selectedPerPage +
                      alertHistory.findIndex((r: any) => r.timestamp === row.timestamp) +
                      1
                    }}
                  </span>
                </template>
                <template #cell-status="{ row }">
                  <OBadge
                    size="sm"
                    :icon="getStatusChipIcon(row.status)"
                    :variant="getStatusChipVariant(row.status)"
                    class="tw:cursor-default"
                    data-test="alert-history-status-chip"
                  >
                    {{ formatStatus(row.status) }}
                    <OTooltip
                      v-if="row.error"
                      :max-width="'300px'"
                      :content="row.error"
                    />
                  </OBadge>
                </template>
                <template #cell-timestamp="{ row }">
                  <span class="tw:text-[13px]">{{
                    formatTimestamp(row.timestamp)
                  }}</span>
                  <OTooltip :content="formatTimestampFull(row.timestamp)" />
                </template>
                <template #cell-evaluation_time="{ row }">
                  <span class="tw:text-[13px] tw:tabular-nums">
                    {{
                      row.evaluation_took_in_secs
                        ? row.evaluation_took_in_secs.toFixed(3) + "s"
                        : "—"
                    }}
                  </span>
                </template>
                <template #cell-query_time="{ row }">
                  <span class="tw:text-[13px] tw:tabular-nums">
                    {{
                      row.query_took ? row.query_took + "ms" : "—"
                    }}
                  </span>
                </template>
                <template #cell-anomaly_count="{ row }">
                  <span
                    class="tw:text-[13px] tw:tabular-nums"
                    :class="
                      row.anomaly_count > 0
                        ? 'tw:text-red-500 tw:font-medium'
                        : ''
                    "
                  >
                    {{
                      row.anomaly_count != null ? row.anomaly_count : "—"
                    }}
                  </span>
                </template>
                <template #cell-error="{ row }">
                  <span class="tw:text-[13px]">{{ row.error || "—" }}</span>
                </template>

                <template #bottom="scope">
                  <div class="tw:flex tw:items-center tw:w-full tw:h-[48px]">
                    <div
                      class="o2-table-footer-title tw:flex tw:items-center tw:w-[220px]"
                    >
                      {{ resultTotal }} {{ t("alerts.alertDetails.results") }}
                    </div>
                  </div>
                </template>
              </OTable>
            </div>
          </div>
        </OTabPanel>

        <!-- Condition Panel -->
        <OTabPanel
          name="condition"
          layout="flex-col"
          stretch
        >
          <div
            class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden tw:px-2 tw:py-2"
          >
            <!-- Anomaly detection condition view — mirrors the alert SQL code block -->
            <template v-if="isAnomaly">
              <div
                class="code-block tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden "
                :class="
                  store.state.theme === 'dark'
                    ? 'code-block-dark'
                    : 'code-block-light'
                "
              >
                <div
                  class="code-block-header tw:shrink-0"
                  :class="
                    store.state.theme === 'dark'
                      ? 'code-block-header-dark'
                      : 'code-block-header-light'
                  "
                >
                  <div class="tw:flex tw:items-center tw:gap-1.5">
                    <span
                      class="tw:text-[11px] tw:font-medium"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-gray-400'
                          : 'tw:text-gray-500'
                      "
                    >
                      SQL
                    </span>
                  </div>
                  <OButton
                    v-if="anomalySql"
                    @click="copyToClipboard(anomalySql, { successMessage: 'SQL Copied Successfully!', timeout: 3000 })"
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="anomaly-details-copy-sql-btn"
                  >
                    <OIcon name="content-copy" size="sm" />
                    <OTooltip :content="t('alerts.alertDetails.copy')" />
                  </OButton>
                </div>
                <pre
                  class="code-block-content tw:text-[13px] tw:m-0 tw:leading-relaxed tw:flex-1 tw:overflow-y-auto"
                  >{{ anomalySql || t("alerts.alertDetails.noCondition") }}</pre
                >
              </div>
            </template>

            <!-- Regular alert condition view -->
            <template v-else>
              <div
                class="code-block tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden"
                :class="
                  store.state.theme === 'dark'
                    ? 'code-block-dark'
                    : 'code-block-light'
                "
              >
                <!-- Code block header bar — stays fixed -->
                <div
                  class="code-block-header tw:shrink-0"
                  :class="
                    store.state.theme === 'dark'
                      ? 'code-block-header-dark'
                      : 'code-block-header-light'
                  "
                >
                  <div class="tw:flex tw:items-center tw:gap-1.5">
                    <span
                      class="tw:text-[11px] tw:font-medium"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-gray-400'
                          : 'tw:text-gray-500'
                      "
                    >
                      {{
                        alertDetails.type === "sql"
                          ? "SQL"
                          : alertDetails.type === "promql"
                            ? "PromQL"
                            : "Conditions"
                      }}
                    </span>
                  </div>
                  <OButton
                    v-if="
                      alertDetails.conditions &&
                      alertDetails.conditions !== '' &&
                      alertDetails.conditions !== '--'
                    "
                    @click="
                      copyToClipboard(
                        alertDetails.conditions,
                        {
                          successMessage: (alertDetails.type === 'sql'
                            ? t('alerts.alertDetails.sqlQuery')
                            : alertDetails.type === 'promql'
                              ? t('alerts.alertDetails.promqlQuery')
                              : t('alerts.alertDetails.conditions')) + ' Copied Successfully!',
                        },
                      )
                    "
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="alert-details-copy-conditions-btn"
                  >
                    <OIcon name="content-copy" size="sm" />
                    <OTooltip :content="t('alerts.alertDetails.copy')" />
                  </OButton>
                </div>
                <!-- Code content — scrolls internally -->
                <pre
                  class="code-block-content tw:text-[13px] tw:m-0 tw:leading-relaxed tw:flex-1 tw:overflow-y-auto"
                  >{{
                    alertDetails.conditions !== "" &&
                    alertDetails.conditions !== "--"
                      ? alertDetails.type === "sql" ||
                        alertDetails.type === "promql"
                        ? alertDetails.conditions
                        : alertDetails.conditions.length !== 2
                          ? `if ${alertDetails.conditions}`
                          : t("alerts.alertDetails.noCondition")
                      : t("alerts.alertDetails.noCondition")
                  }}</pre
                >
              </div>
            </template>

            <!-- Description (only show if exists) -->
            <div v-if="alertDetails.description" class="tw:mt-3 tw:shrink-0">
              <div
                class="tw:flex tw:items-center tw:gap-1.5 tw:text-[12px] tw:font-semibold tw:uppercase tw:tracking-wider tw:mb-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-gray-400'
                    : 'tw:text-gray-500'
                "
              >
                <OIcon name="info-outline" size="xs" />
                {{ t("common.description") }}
              </div>
              <div
                class="tw:text-[13px] tw:px-3 tw:py-2 tw:rounded tw:leading-relaxed"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:bg-gray-800 tw:text-gray-300'
                    : 'tw:bg-gray-50 tw:text-gray-700'
                "
              >
                {{ alertDetails.description }}
              </div>
            </div>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatToTimeCompact, formatTimestamp } from "@/utils/date";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import DateTime from "@/components/DateTime.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import anomalyDetectionService from "@/services/anomaly_detection";
import { buildAnomalyPreviewSql } from "@/utils/alerts/anomalySqlBuilder";
import type { Ref } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";

// Composables
const { t } = useI18n();
const store = useStore();

// Props & Emits
interface Props {
  alertDetails: any;
  alertId: string;
  alertType?: string;
  open?: boolean;
}

const props = defineProps<Props>();

const isAnomaly = computed(() => props.alertType === "anomaly_detection");

// Full config fetched from the dedicated anomaly detection endpoint.
// The list API only returns summary fields; we need this for the Condition tab.
const fullAnomalyConfig = ref<any>(null);

const anomalySql = computed(() => {
  const d = fullAnomalyConfig.value || props.alertDetails;
  if (!d) return "";
  return buildAnomalyPreviewSql(d);
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const resultTotal = ref(0);

// Tabs
const activeTab = ref("history");

// Refs
const alertHistory: Ref<any[]> = ref([]);
const isLoadingHistory = ref(false);

// Date time - default to last 15 minutes (relative)
const dateTimeRef = ref<any>(null);
const dateTimeType = ref("relative");
const relativeTime = ref("15m");
const _now = Date.now();
const _fifteenMinutesAgo = _now - 15 * 60 * 1000;
const absoluteTime = ref({
  startTime: _fifteenMinutesAgo * 1000, // microseconds
  endTime: _now * 1000, // microseconds
});
const dateTimeValues = ref({
  startTime: _fifteenMinutesAgo * 1000,
  endTime: _now * 1000,
  type: "relative",
  relativeTimePeriod: "15m",
});

// Pagination (server-side)
const selectedPerPage = ref<number>(50);
const currentPage = ref<number>(1);

const onPaginationChange = async (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  selectedPerPage.value = params.size;
  isLoadingHistory.value = true;
  await fetchAlertHistory(props.alertId);
  isLoadingHistory.value = false;
};

// Columns
const alertHistoryColumns = [
  {
    id: "#",
    header: "#",
    accessorFn: () => null,
    sortable: false,
    size: 48,
    meta: { align: "left" as const },
  },
  {
    id: "timestamp",
    header: t("alerts.historyTable.timestamp"),
    accessorKey: "timestamp",
    sortable: true,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "status",
    header: t("alerts.historyTable.status"),
    accessorKey: "status",
    sortable: true,
    size: 200,
    meta: { align: "left" as const },
  },
  {
    id: "evaluation_time",
    header: t("alerts.historyTable.evaluationTime"),
    accessorKey: "evaluation_took_in_secs",
    sortable: true,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "query_time",
    header: t("alerts.historyTable.queryTime"),
    accessorKey: "query_took",
    sortable: true,
    size: 100,
    meta: { align: "left" as const },
  },
  {
    id: "error",
    header: t("alerts.historyTable.error"),
    accessorKey: "true",
    sortable: false,
    size: COL.description,
    meta: { align: "left" as const, autoWidth: true },
  },
];

const anomalyHistoryColumns = [
  {
    id: "#",
    header: "#",
    accessorFn: () => null,
    sortable: false,
    size: 48,
    meta: { align: "left" as const },
  },
  {
    id: "timestamp",
    header: t("alerts.historyTable.timestamp"),
    accessorKey: "timestamp",
    sortable: false,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "status",
    header: "Result",
    accessorKey: "status",
    sortable: false,
    size: 120,
    meta: { align: "left" as const },
  },
  {
    id: "evaluation_time",
    header: t("alerts.historyTable.evaluationTime"),
    accessorKey: "evaluation_took_in_secs",
    sortable: false,
    size: 130,
    meta: { align: "right" as const },
  },
  {
    id: "anomaly_count",
    header: "Anomalies",
    accessorKey: "anomaly_count",
    sortable: false,
    size: 120,
    meta: { align: "right" as const },
  },
];

const historyTableColumns = computed(() =>
  isAnomaly.value ? anomalyHistoryColumns : alertHistoryColumns,
);

// Helper Functions

const getRowClass = (row: any) => {
  const status = row?.status;
  if (store.state.theme === "dark") {
    switch (status?.toLowerCase()) {
      case "firing":
      case "error":
      case "anomaly":
        return "row-error-dark";
      default:
        return "";
    }
  } else {
    switch (status?.toLowerCase()) {
      case "firing":
      case "error":
      case "anomaly":
        return "row-error-light";
      default:
        return "";
    }
  }
};

const formatStatus = (status: string) => {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getStatusChipIcon = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
    case "anomaly":
      return "error-outline";
    case "ok":
    case "success":
    case "normal":
      return "check-circle-outline";
    case "skipped":
      return "block";
    case "pending":
      return "schedule";
    default:
      return "help-outline";
  }
};

const getStatusChipVariant = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
    case "anomaly":
      return "error-soft";
    case "ok":
    case "success":
    case "normal":
      return "success-soft";
    case "skipped":
      return "warning-soft";
    case "pending":
      return "primary-soft";
    default:
      return "default-soft";
  }
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  const now = Date.now() * 1000; // microseconds
  const diff = now - timestamp;

  if (diff < 3600000000) {
    const minutes = Math.floor(diff / 60000000);
    return `${minutes} min ago`;
  }
  if (diff < 86400000000) {
    const hours = Math.floor(diff / 3600000000);
    return `${hours}h ago`;
  }
  if (diff < 604800000000) {
    const days = Math.floor(diff / 86400000000);
    return `${days}d ago`;
  }
  return formatToTimeCompact(timestamp);
};

const formatTimestampFull = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return formatTimestamp(timestamp, "MMM DD, YYYY HH:mm:ss");
};

// Main Functions
const fetchAlertHistory = async (alertId: string) => {
  if (!alertId) return;

  try {
    const startTime = dateTimeValues.value.startTime;
    const endTime = dateTimeValues.value.endTime;
    const from = (currentPage.value - 1) * selectedPerPage.value;

    const historyParams: Record<string, any> = {
      size: selectedPerPage.value,
      from: from,
      start_time: startTime,
      end_time: endTime,
    };
    if (isAnomaly.value) {
      historyParams.anomaly_id = alertId;
    } else {
      historyParams.alert_id = alertId;
    }
    const response = await alertsService.getHistory(
      store?.state?.selectedOrganization?.identifier,
      historyParams,
    );
    alertHistory.value = response.data?.hits || [];
    resultTotal.value = response.data?.total || 0;
  } catch (error: any) {
    alertHistory.value = [];
    resultTotal.value = 0;
    toast({
      variant: "error",
      message:
        error.response?.data?.message ||
        error.message ||
        t("alerts.failedToFetchHistory"),
      timeout: 5000,
    });
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
  if (props.alertId) {
    isLoadingHistory.value = true;
    fetchAlertHistory(props.alertId).finally(() => {
      isLoadingHistory.value = false;
    });
  }
};

// Watchers
watch(
  () => props.alertId,
  async (newVal) => {
    if (newVal) {
      currentPage.value = 1;
      isLoadingHistory.value = true;
      await fetchAlertHistory(newVal);
      isLoadingHistory.value = false;
      // Fetch full config for the Condition tab when this is an anomaly detection alert.
      if (isAnomaly.value) {
        try {
          const org = store?.state?.selectedOrganization?.identifier;
          const res = await anomalyDetectionService.getConfig(org, newVal);
          fullAnomalyConfig.value = res.data;
        } catch {
          fullAnomalyConfig.value = null;
        }
      } else {
        fullAnomalyConfig.value = null;
      }
    }
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
/* ── Code Block ── */
.code-block {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid;
}
.code-block-light {
  border-color: #e5e7eb;
  background: #f9fafb;
}
.code-block-dark {
  border-color: #374151;
  // background: #111827;
}

.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid;
}
.code-block-header-light {
  background: #f3f4f6;
  border-color: #e5e7eb;
}
.code-block-header-dark {
  // background: #1f2937;
  border-color: #374151;
}

.code-block-content {
  padding: 10px 14px;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
  white-space: pre-wrap;
  overflow-x: auto;
  font-size: 13px;
}

/* ── Row tints ── */
.row-error-light {
  background: #fff5f5 !important;
}
.row-error-dark {
  background: #2d1b1b !important;
}

/* ── Table layout ── */
.history-table {
  border: none !important;
  box-shadow: none !important;
}

/* ── Tab panels fill height ── */
:deep(.o-tab-panels) {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
:deep(.o-tab-panel) {
  flex: 1;
}
</style>
