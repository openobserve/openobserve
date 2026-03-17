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
    style="width: 50vw"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <!-- Header -->
    <div
      class="drawer-header"
      :class="
        store.state.theme === 'dark'
          ? 'drawer-header-dark'
          : 'drawer-header-light'
      "
    >
      <div class="tw-flex tw-items-center tw-justify-between tw-w-full">
        <!-- Left: Title -->
        <div
          class="tw-flex tw-items-center tw-gap-2 tw-min-w-0"
          data-test="alert-details-title"
        >
          <q-icon
            name="history"
            size="18px"
            :color="store.state.theme === 'dark' ? 'blue-4' : 'primary'"
          />
          <span class="tw-font-semibold tw-text-[15px] tw-whitespace-nowrap">{{
            t("alert_list.alert_history")
          }}</span>
          <q-icon
            name="chevron_right"
            size="16px"
            color="grey-5"
            class="tw-shrink-0"
          />
          <!-- Alert Name Badge -->
          <span
            v-if="alertDetails"
            :class="[
              'tw-font-medium tw-text-[13px] tw-px-2 tw-py-0.5 tw-rounded tw-truncate tw-max-w-[220px] tw-inline-block',
              store.state.theme === 'dark'
                ? 'tw-text-blue-300 tw-bg-blue-900/40'
                : 'tw-text-blue-700 tw-bg-blue-50',
            ]"
          >
            {{ alertDetails.name }}
            <q-tooltip
              v-if="alertDetails.name && alertDetails.name.length > 28"
              class="tw-text-xs"
            >
              {{ alertDetails.name }}
            </q-tooltip>
          </span>
          <!-- Alert Type Chip -->
          <q-chip
            v-if="alertDetails"
            dense
            size="sm"
            :icon="alertDetails.is_real_time ? 'bolt' : 'schedule'"
            :label="alertDetails.is_real_time ? 'Real-time' : 'Scheduled'"
            :color="alertDetails.is_real_time ? 'orange-2' : 'grey-2'"
            :text-color="alertDetails.is_real_time ? 'orange-9' : 'grey-8'"
            class="tw-shrink-0"
          />
        </div>

        <!-- Right: Actions -->
        <div class="tw-flex tw-items-center tw-gap-1 tw-shrink-0">
          <DateTime
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
          <q-btn
            data-test="alert-details-edit-btn"
            flat
            round
            dense
            size="sm"
            icon="edit"
            @click="editAlertFromDrawer"
          >
            <q-tooltip>{{ t("alerts.edit") }}</q-tooltip>
          </q-btn>
          <q-btn
            data-test="alert-details-close-btn"
            v-close-popup="true"
            flat
            round
            dense
            size="sm"
            icon="close"
          />
        </div>
      </div>
    </div>

    <!-- Content -->
    <div
      class="tw-flex tw-flex-col"
      style="height: calc(100vh - 57px); overflow: hidden"
      v-if="alertDetails"
    >
      <!-- Query / Conditions Block -->
      <div class="tw-px-4 tw-pt-3 tw-pb-2 tw-shrink-0">
        <div
          class="code-block"
          :class="
            store.state.theme === 'dark'
              ? 'code-block-dark'
              : 'code-block-light'
          "
        >
          <!-- Code block header bar -->
          <div
            class="code-block-header"
            :class="
              store.state.theme === 'dark'
                ? 'code-block-header-dark'
                : 'code-block-header-light'
            "
          >
            <div class="tw-flex tw-items-center tw-gap-1.5">
              <span
                class="tw-text-[11px] tw-font-medium"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw-text-gray-400'
                    : 'tw-text-gray-500'
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
            <q-btn
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
              flat
              dense
              size="xs"
              icon="content_copy"
              :color="store.state.theme === 'dark' ? 'grey-5' : 'grey-7'"
              data-test="alert-details-copy-conditions-btn"
            >
              <q-tooltip>{{ t("alerts.alertDetails.copy") }}</q-tooltip>
            </q-btn>
          </div>
          <!-- Code content -->
          <pre
            class="code-block-content tw-text-[13px] tw-m-0 tw-leading-relaxed"
            >{{
              alertDetails.conditions !== "" && alertDetails.conditions !== "--"
                ? alertDetails.type === "sql" || alertDetails.type === "promql"
                  ? alertDetails.conditions
                  : alertDetails.conditions.length !== 2
                    ? `if ${alertDetails.conditions}`
                    : t("alerts.alertDetails.noCondition")
                : t("alerts.alertDetails.noCondition")
            }}</pre
          >
        </div>

        <!-- Description (only show if exists) -->
        <div v-if="alertDetails.description" class="tw-mt-2">
          <div
            class="tw-flex tw-items-center tw-gap-1.5 tw-text-[12px] tw-font-semibold tw-uppercase tw-tracking-wider tw-mb-1"
            :class="
              store.state.theme === 'dark'
                ? 'tw-text-gray-400'
                : 'tw-text-gray-500'
            "
          >
            <q-icon name="info_outline" size="13px" />
            {{ t("common.description") }}
          </div>
          <div
            class="tw-text-[13px] tw-px-3 tw-py-2 tw-rounded tw-leading-relaxed"
            :class="
              store.state.theme === 'dark'
                ? 'tw-bg-gray-800 tw-text-gray-300'
                : 'tw-bg-gray-50 tw-text-gray-700'
            "
          >
            {{ alertDetails.description }}
          </div>
        </div>
      </div>

      <!-- History Section -->
      <div
        class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-px-4 tw-pt-2"
        :class="
          store.state.theme === 'dark'
            ? 'tw-border-t tw-border-gray-700'
            : 'tw-border-t tw-border-gray-200'
        "
      >
        <!-- Loading state -->
        <div
          v-if="isLoadingHistory"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-gap-3"
        >
          <q-spinner-hourglass size="32px" color="primary" />
          <div
            class="tw-text-sm"
            :class="
              store.state.theme === 'dark'
                ? 'tw-text-gray-400'
                : 'tw-text-gray-500'
            "
          >
            {{ t("alerts.alertDetails.loadingHistory") }}
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="alertHistory.length === 0"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-gap-2"
        >
          <div
            class="tw-w-14 tw-h-14 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-mb-1"
            :class="
              store.state.theme === 'dark' ? 'tw-bg-gray-800' : 'tw-bg-gray-100'
            "
          >
            <q-icon
              name="history_toggle_off"
              size="28px"
              :color="store.state.theme === 'dark' ? 'grey-6' : 'grey-5'"
            />
          </div>
          <div
            class="tw-text-sm tw-font-medium"
            :class="
              store.state.theme === 'dark'
                ? 'tw-text-gray-400'
                : 'tw-text-gray-600'
            "
          >
            {{ t("alerts.alertDetails.noHistoryAvailable") }}
          </div>
          <div
            class="tw-text-xs"
            :class="
              store.state.theme === 'dark'
                ? 'tw-text-gray-600'
                : 'tw-text-gray-400'
            "
          >
            Try expanding the time range
          </div>
        </div>

        <!-- History Table -->
        <div
          v-else
          class="code-block tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-mb-2"
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
                      class="tw-text-[13px] tw-tabular-nums"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw-text-gray-500'
                          : 'tw-text-gray-400'
                      "
                    >
                      {{
                        (currentPage - 1) * selectedPerPage + props.rowIndex + 1
                      }}
                    </span>
                  </template>
                  <template v-else-if="col.name === 'status'">
                    <div class="tw-flex tw-items-center tw-gap-1.5">
                      <span
                        class="status-dot"
                        :class="getStatusDotClass(props.row.status)"
                      />
                      <span
                        class="tw-text-[13px] tw-font-medium"
                        :class="getStatusTextClass(props.row.status)"
                      >
                        {{ formatStatus(props.row.status) }}
                      </span>
                    </div>
                  </template>
                  <template v-else-if="col.name === 'timestamp'">
                    <span class="tw-text-[13px]">{{
                      formatTimestamp(props.row.timestamp)
                    }}</span>
                    <q-tooltip class="tw-text-xs">
                      {{ formatTimestampFull(props.row.timestamp) }}
                    </q-tooltip>
                  </template>
                  <template v-else-if="col.name === 'evaluation_time'">
                    <span class="tw-text-[13px] tw-tabular-nums">
                      {{
                        props.row.evaluation_took_in_secs
                          ? props.row.evaluation_took_in_secs.toFixed(3) + "s"
                          : "—"
                      }}
                    </span>
                  </template>
                  <template v-else-if="col.name === 'query_time'">
                    <span class="tw-text-[13px] tw-tabular-nums">
                      {{
                        props.row.query_took ? props.row.query_took + "ms" : "—"
                      }}
                    </span>
                  </template>
                  <template v-else-if="col.name === 'error'">
                    <div
                      v-if="props.row.error"
                      class="tw-flex tw-items-center tw-gap-1"
                    >
                      <q-icon
                        name="error_outline"
                        size="16px"
                        class="tw-text-red-500"
                      />
                      <span
                        class="tw-text-[12px] tw-text-red-500 tw-truncate tw-max-w-[120px]"
                      >
                        {{ props.row.error }}
                      </span>
                      <q-tooltip class="tw-text-xs tw-max-w-xs tw-break-words">
                        {{ props.row.error }}
                      </q-tooltip>
                    </div>
                    <span v-else class="tw-text-gray-400">—</span>
                  </template>
                </q-td>
              </q-tr>
            </template>

            <template #bottom="scope">
              <div class="tw-flex tw-items-center tw-w-full tw-h-[48px]">
                <div
                  class="o2-table-footer-title tw-flex tw-items-center tw-w-[220px]"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import DateTime from "@/components/DateTime.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import type { Ref } from "vue";

// Composables
const { t } = useI18n();
const store = useStore();
const $q = useQuasar();

// Props & Emits
interface Props {
  alertDetails: any;
  alertId: string;
}

const props = defineProps<Props>();

const emit = defineEmits(["edit"]);

const resultTotal = ref(0);

// Refs
const alertHistory: Ref<any[]> = ref([]);
const isLoadingHistory = ref(false);
const qTableRef: Ref<any> = ref(null);
const isInitialized = ref(false);

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

// Constants
const historyTableColumns = [
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

// Helper Functions
const getStatusDotClass = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
      return "status-dot-error";
    case "ok":
    case "success":
      return "status-dot-success";
    case "skipped":
      return "status-dot-warning";
    case "pending":
      return "status-dot-info";
    default:
      return "status-dot-default";
  }
};

const getStatusTextClass = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
      return "tw-text-red-500";
    case "ok":
    case "success":
      return "tw-text-green-600";
    case "skipped":
      return "tw-text-amber-600";
    case "pending":
      return "tw-text-blue-500";
    default:
      return store.state.theme === "dark"
        ? "tw-text-gray-400"
        : "tw-text-gray-500";
  }
};

const getRowClass = (status: string) => {
  if (store.state.theme === "dark") {
    switch (status?.toLowerCase()) {
      case "firing":
      case "error":
        return "row-error-dark";
      default:
        return "";
    }
  } else {
    switch (status?.toLowerCase()) {
      case "firing":
      case "error":
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

    const response = await alertsService.getHistory(
      store?.state?.selectedOrganization?.identifier,
      {
        alert_id: alertId,
        size: selectedPerPage.value,
        from: from,
        start_time: startTime,
        end_time: endTime,
      },
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

  // Skip fetch on initial DateTime mount — the watch handles the first load
  if (!isInitialized.value) return;

  pagination.value.page = 1;
  currentPage.value = 1;
  if (props.alertId) {
    isLoadingHistory.value = true;
    fetchAlertHistory(props.alertId).finally(() => {
      isLoadingHistory.value = false;
    });
  }
};

const editAlertFromDrawer = () => {
  if (!props.alertDetails) return;
  emit("edit", props.alertDetails);
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
      isInitialized.value = true;
    }
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
/* ── Header ── */
.drawer-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid;
}
.drawer-header-light {
  border-color: #e5e7eb;
  background: #fff;
}
.drawer-header-dark {
  border-color: #374151;
  background: #1f2937;
}

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

/* ── Status Dot ── */
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot-error {
  background: #ef4444;
  box-shadow: 0 0 0 2px #fecaca;
}
.status-dot-success {
  background: #22c55e;
  box-shadow: 0 0 0 2px #bbf7d0;
}
.status-dot-warning {
  background: #f59e0b;
  box-shadow: 0 0 0 2px #fde68a;
}
.status-dot-info {
  background: #3b82f6;
  box-shadow: 0 0 0 2px #bfdbfe;
}
.status-dot-default {
  background: #9ca3af;
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
</style>
