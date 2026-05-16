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
    :width="60"
    :title="t('alert_list.alert_history')"
    @update:open="emit('update:open', $event)"
  >
    <!-- #header override required: header contains alert name/type badges,
         tab toggle, and datetime picker — too complex for title + sub-slots -->
    <template #header-left>
          <div
            class="tw:flex tw:items-center tw:gap-2"
            data-test="alert-details-title"
          >
            <!-- Alert Name Badge -->
            <span
              v-if="alertDetails"
              :class="[
                'tw:font-bold tw:text-[18px] tw:mr-2 tw:px-2 tw:py-1 tw:rounded-md tw:ml-2 tw:max-w-44 tw:truncate tw:inline-block',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50',
              ]"
              data-test="alert-history-name-badge"
            >
              {{ alertDetails.name }}
              <OTooltip
                v-if="alertDetails.name && alertDetails.name.length > 35"
                :content="alertDetails.name"
              />
            </span>
            <!-- Alert Type Badge -->
            <div
              v-if="alertDetails"
              :class="[
                'tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded-md tw:border',
                store.state.theme === 'dark'
                  ? 'tw:bg-gray-800/50 tw:border-gray-600'
                  : 'tw:bg-gray-50 tw:border-gray-200',
              ]"
            >
              <q-icon
                :name="
                  isAnomaly
                    ? 'query_stats'
                    : alertDetails.is_real_time
                      ? 'bolt'
                      : 'schedule'
                "
                size="14px"
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
    <div class="tw:flex tw:flex-col" v-if="alertDetails">
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
          class="tw:flex tw:flex-col tw:h-full tw:p-0 tw:overflow-hidden"
        >
          <div
            class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden tw:px-2 tw:pt-1"
          >
            <!-- Loading state -->
            <div
              v-if="isLoadingHistory"
              class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:gap-3"
            >
              <OSpinner size="sm" />
              <div
                class="tw:text-sm"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-gray-400'
                    : 'tw:text-gray-500'
                "
              >
                {{ t("alerts.alertDetails.loadingHistory") }}
              </div>
            </div>

            <!-- Empty state -->
            <div
              v-else-if="alertHistory.length === 0"
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
                <q-icon
                  name="history_toggle_off"
                  size="28px"
                  :color="store.state.theme === 'dark' ? 'grey-6' : 'grey-5'"
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
              class="code-block tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden tw:mb-2"
              :class="
                store.state.theme === 'dark'
                  ? 'code-block-dark'
                  : 'code-block-light'
              "
            >
              <q-table
                ref="qTableRef"
                :rows="alertHistory"
                :columns="historyTableColumns"
                row-key="timestamp"
                v-model:pagination="pagination"
                @request="onRequest"
                style="flex: 1; overflow: hidden"
                class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky history-table"
                data-test="alert-details-history-table"
              >
                <template v-slot:body="props">
                  <q-tr :props="props" :class="getRowClass(props.row.status)">
                    <q-td
                      v-for="col in historyTableColumns"
                      :key="col.name"
                      :props="props"
                    >
                      <template v-if="col.name === '#'">
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
                            props.rowIndex +
                            1
                          }}
                        </span>
                      </template>
                      <template v-else-if="col.name === 'status'">
                        <q-chip
                          dense
                          size="sm"
                          :icon="getStatusChipIcon(props.row.status)"
                          :label="formatStatus(props.row.status)"
                          :color="getStatusChipColor(props.row.status)"
                          :text-color="getStatusChipTextColor(props.row.status)"
                          class="tw:cursor-default"
                          data-test="alert-history-status-chip"
                        >
                          <OTooltip
                            v-if="props.row.error"
                            :max-width="'300px'"
                            :content="props.row.error"
                          />
                        </q-chip>
                      </template>
                      <template v-else-if="col.name === 'timestamp'">
                        <span class="tw:text-[13px]">{{
                          formatTimestamp(props.row.timestamp)
                        }}</span>
                        <OTooltip :content="formatTimestampFull(props.row.timestamp)" />
                      </template>
                      <template v-else-if="col.name === 'evaluation_time'">
                        <span class="tw:text-[13px] tw:tabular-nums">
                          {{
                            props.row.evaluation_took_in_secs
                              ? props.row.evaluation_took_in_secs.toFixed(3) +
                                "s"
                              : "—"
                          }}
                        </span>
                      </template>
                      <template v-else-if="col.name === 'query_time'">
                        <span class="tw:text-[13px] tw:tabular-nums">
                          {{
                            props.row.query_took
                              ? props.row.query_took + "ms"
                              : "—"
                          }}
                        </span>
                      </template>
                      <template v-else-if="col.name === 'anomaly_count'">
                        <span
                          class="tw:text-[13px] tw:tabular-nums"
                          :class="
                            props.row.anomaly_count > 0
                              ? 'tw:text-red-500 tw:font-medium'
                              : ''
                          "
                        >
                          {{
                            props.row.anomaly_count != null
                              ? props.row.anomaly_count
                              : "—"
                          }}
                        </span>
                      </template>
                    </q-td>
                  </q-tr>
                </template>

                <template #bottom="scope">
                  <div class="tw:flex tw:items-center tw:w-full tw:h-[48px]">
                    <div
                      class="o2-table-footer-title tw:flex tw:items-center tw:w-[220px]"
                    >
                      {{ resultTotal }} {{ t("alerts.alertDetails.results") }}
                    </div>
                    <QTablePagination
                      :scope="scope"
                      :position="'bottom'"
                      :resultTotal="resultTotal"
                      :perPageOptions="perPageOptions"
                      @update:changeRecordPerPage="changePagination"
                      @update:changePagination="onPageChange"
                    />
                  </div>
                </template>
              </q-table>
            </div>
          </div>
        </OTabPanel>

        <!-- Condition Panel -->
        <OTabPanel
          name="condition"
          class="tw:flex tw:flex-col tw:h-full tw:overflow-hidden tw:p-0"
        >
          <div
            class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden tw:px-2 tw:pt-2 tw:pb-2"
          >
            <!-- Anomaly detection condition view — mirrors the alert SQL code block -->
            <template v-if="isAnomaly">
              <div
                class="code-block tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden"
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
                    @click="copyToClipboard(anomalySql, 'SQL')"
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="anomaly-details-copy-sql-btn"
                  >
                    <q-icon name="content_copy" />
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
                        alertDetails.type === 'sql'
                          ? t('alerts.alertDetails.sqlQuery')
                          : alertDetails.type === 'promql'
                            ? t('alerts.alertDetails.promqlQuery')
                            : t('alerts.alertDetails.conditions'),
                      )
                    "
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="alert-details-copy-conditions-btn"
                  >
                    <q-icon name="content_copy" />
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
                <q-icon name="info_outline" size="13px" />
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
import { useQuasar, date } from "quasar";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import DateTime from "@/components/DateTime.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import anomalyDetectionService from "@/services/anomaly_detection";
import { buildAnomalyPreviewSql } from "@/utils/alerts/anomalySqlBuilder";
import type { Ref } from "vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

// Composables
const { t } = useI18n();
const store = useStore();
const $q = useQuasar();

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
const qTableRef: Ref<any> = ref(null);

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

// Pagination (server-side pagination)
const selectedPerPage = ref<number>(50);
const currentPage = ref<number>(1);
const pagination: any = ref({
  page: 1,
  rowsPerPage: 50,
  rowsNumber: 0,
});

const perPageOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

const onRequest = async (requestProps: any) => {
  const { page, rowsPerPage } = requestProps.pagination;
  currentPage.value = page;
  selectedPerPage.value = rowsPerPage;
  isLoadingHistory.value = true;
  await fetchAlertHistory(props.alertId);
  pagination.value.page = page;
  pagination.value.rowsPerPage = rowsPerPage;
  isLoadingHistory.value = false;
};

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  pagination.value.page = 1;
  qTableRef.value?.requestServerInteraction({
    pagination: pagination.value,
  });
};

const onPageChange = (page: number) => {
  pagination.value.page = page;
  qTableRef.value?.requestServerInteraction({
    pagination: pagination.value,
  });
};

// Columns
const alertHistoryColumns = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left" as const,
    sortable: false,
    style: "width: 48px;",
  },
  {
    name: "timestamp",
    label: t("alerts.historyTable.timestamp"),
    field: "timestamp",
    align: "left" as const,
    sortable: true,
    style: "width: 140px;",
  },
  {
    name: "status",
    label: t("alerts.historyTable.status"),
    field: "status",
    align: "left" as const,
    sortable: true,
    style: "width: 110px;",
  },
  {
    name: "evaluation_time",
    label: t("alerts.historyTable.evaluationTime"),
    field: "evaluation_took_in_secs",
    align: "right" as const,
    sortable: true,
    style: "width: 130px;",
  },
  {
    name: "query_time",
    label: t("alerts.historyTable.queryTime"),
    field: "query_took",
    align: "right" as const,
    sortable: true,
    style: "width: 120px;",
  },
  {
    name: "error",
    label: t("alerts.historyTable.error"),
    field: "error",
    align: "left" as const,
    sortable: false,
  },
];

const anomalyHistoryColumns = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left" as const,
    sortable: false,
    style: "width: 48px;",
  },
  {
    name: "timestamp",
    label: t("alerts.historyTable.timestamp"),
    field: "timestamp",
    align: "left" as const,
    sortable: true,
    style: "width: 140px;",
  },
  {
    name: "status",
    label: "Result",
    field: "status",
    align: "left" as const,
    sortable: true,
    style: "width: 120px;",
  },
  {
    name: "evaluation_time",
    label: t("alerts.historyTable.evaluationTime"),
    field: "evaluation_took_in_secs",
    align: "right" as const,
    sortable: true,
    style: "width: 130px;",
  },
  {
    name: "anomaly_count",
    label: "Anomalies",
    field: "anomaly_count",
    align: "right" as const,
    sortable: true,
    style: "width: 120px;",
  },
];

const historyTableColumns = computed(() =>
  isAnomaly.value ? anomalyHistoryColumns : alertHistoryColumns,
);

// Helper Functions

const getRowClass = (status: string) => {
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
      return "error_outline";
    case "ok":
    case "success":
    case "normal":
      return "check_circle_outline";
    case "skipped":
      return "block";
    case "pending":
      return "schedule";
    default:
      return "help_outline";
  }
};

const getStatusChipColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
    case "anomaly":
      return "red-1";
    case "ok":
    case "success":
    case "normal":
      return "green-1";
    case "skipped":
      return "amber-1";
    case "pending":
      return "blue-1";
    default:
      return "grey-3";
  }
};

const getStatusChipTextColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
    case "anomaly":
      return "red-9";
    case "ok":
    case "success":
    case "normal":
      return "green-9";
    case "skipped":
      return "amber-9";
    case "pending":
      return "blue-9";
    default:
      return "grey-8";
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
  return date.formatDate(timestamp / 1000, "MMM DD, HH:mm");
};

const formatTimestampFull = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return date.formatDate(timestamp / 1000, "MMM DD, YYYY HH:mm:ss");
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
    pagination.value.rowsNumber = response.data?.total || 0;
  } catch (error: any) {
    alertHistory.value = [];
    resultTotal.value = 0;
    pagination.value.rowsNumber = 0;
    $q.notify({
      type: "negative",
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

  pagination.value.page = 1;
  currentPage.value = 1;
  if (props.alertId) {
    isLoadingHistory.value = true;
    fetchAlertHistory(props.alertId).finally(() => {
      isLoadingHistory.value = false;
    });
  }
};

const copyToClipboard = (text: string, type: string) => {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      $q.notify({
        type: "positive",
        message: `${type} Copied Successfully!`,
        timeout: 3000,
      });
    })
    .catch(() => {
      $q.notify({
        type: "negative",
        message: "Error while copy content.",
        timeout: 3000,
      });
    });
};

// Watchers
watch(
  () => props.alertId,
  async (newVal) => {
    if (newVal) {
      pagination.value.page = 1;
      currentPage.value = 1;
      if (!qTableRef.value) {
        isLoadingHistory.value = true;
        await fetchAlertHistory(newVal);
        isLoadingHistory.value = false;
      } else {
        qTableRef.value?.requestServerInteraction({
          pagination: pagination.value,
        });
      }
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
  background: #111827;
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
  background: #1f2937;
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
