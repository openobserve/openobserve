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
  <div style="width: 50vw;" :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'">
    <!-- Header -->
    <q-card-section class="q-ma-none">
      <div class="row items-center no-wrap">
        <div class="col">
          <div class="tw-text-[18px] tw-flex tw-items-center" data-test="alert-details-title">
            {{ t('alert_list.alert_history') }}
            <!-- Alert Name Badge -->
            <span
              v-if="alertDetails"
              :class="[
                'tw-font-bold tw-mr-4 tw-px-2 tw-py-1 tw-rounded-md tw-ml-2 tw-max-w-xs tw-truncate tw-inline-block',
                store.state.theme === 'dark'
                  ? 'tw-text-blue-400 tw-bg-blue-900/50'
                  : 'tw-text-blue-600 tw-bg-blue-50'
              ]"
            >
              {{ alertDetails.name }}
              <q-tooltip v-if="alertDetails.name && alertDetails.name.length > 35" class="tw-text-xs">
                {{ alertDetails.name }}
              </q-tooltip>
            </span>
          </div>
        </div>
        <div class="col-auto tw-flex tw-items-center tw-gap-2">
          <q-btn
            data-test="alert-details-refresh-btn"
            class="text-bold no-border o2-secondary-button tw-h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            flat
            no-caps
            @click="refreshHistory"
            :loading="isLoadingHistory"
            :disable="isLoadingHistory"
          >
            <q-icon name="refresh" size="18px" />
            <span class="tw-ml-2">{{ t("common.refresh") }}</span>
          </q-btn>
          <q-btn
            data-test="alert-details-close-btn"
            v-close-popup="true"
            round
            dense
            flat
            icon="cancel"
          />
        </div>
      </div>
    </q-card-section>
    <q-separator />

    <!-- Content -->
    <div class="tw-mx-2 q-py-md alert-details-content" v-if="alertDetails">
      <!-- SQL Query / Conditions -->
      <div class="tw-mb-3">
        <div class="tw-flex tw-items-center tw-justify-between tw-mb-1">
          <div class="section-label">
            {{ alertDetails.type == "sql" ? t('alerts.alertDetails.sqlQuery') : t('alerts.alertDetails.conditions') }}
          </div>
          <q-btn
            v-if="alertDetails.conditions != '' && alertDetails.conditions != '--'"
            @click="copyToClipboard(alertDetails.conditions, t('alerts.alertDetails.conditions'))"
            size="sm"
            flat
            dense
            icon="content_copy"
            class="tw-ml-2"
            data-test="alert-details-copy-conditions-btn"
          >
            <q-tooltip>{{ t('alerts.alertDetails.copy') }}</q-tooltip>
          </q-btn>
        </div>
        <pre
          class="el-border el-border-radius tw-p-2 tw-text-sm tw-overflow-x-auto"
          style="white-space: pre-wrap"
        >{{
          alertDetails.conditions != "" && alertDetails.conditions != "--"
            ? (alertDetails.type == 'sql' ? alertDetails.conditions : alertDetails.conditions.length != 2 ? `if ${alertDetails.conditions}` : t('alerts.alertDetails.noCondition'))
            : t('alerts.alertDetails.noCondition')
        }}</pre>
      </div>

      <!-- Description (only show if exists) -->
      <div v-if="alertDetails.description" class="tw-mb-3">
        <div class="section-label tw-mb-1">{{ t('common.description') }}</div>
        <pre
          class="el-border el-border-radius tw-p-2 tw-text-sm"
          style="white-space: pre-wrap"
        >{{ alertDetails.description }}</pre>
      </div>

      <!-- Alert History Table -->
      <div class="tw-mb-6 tw-flex tw-flex-col" style="min-height: 300px;">
        <div v-if="isLoadingHistory" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1">
          <q-spinner-hourglass size="32px" color="primary" />
          <div class="tw-text-sm tw-mt-3" :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-600'">
            {{ t('alerts.alertDetails.loadingHistory') }}
          </div>
        </div>

        <div
          v-else-if="alertHistory.length === 0"
          class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1"
          :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
        >
          <q-icon name="history" size="48px" class="tw-mb-2 tw-opacity-30" />
          <div class="tw-text-sm">{{ t('alerts.alertDetails.noHistoryAvailable') }}</div>
        </div>

        <q-table
          v-else
          ref="qTableRef"
          :rows="alertHistory"
          :columns="historyTableColumns"
          row-key="timestamp"
          :pagination="pagination"
          :style="tableHeight"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          data-test="alert-details-history-table"
        >
          <template v-slot:body="props">
            <q-tr :props="props">
              <q-td v-for="col in historyTableColumns" :key="col.name" :props="props">
                <template v-if="col.name === 'status'">
                  <q-badge
                    :color="getStatusColor(props.row.status)"
                    :label="formatStatus(props.row.status)"
                  />
                </template>
                <template v-else-if="col.name === 'timestamp'">
                  {{ formatTimestamp(props.row.timestamp) }}
                </template>
                <template v-else-if="col.name === 'evaluation_time'">
                  {{ props.row.evaluation_took_in_secs ? props.row.evaluation_took_in_secs.toFixed(3) : '-' }}
                </template>
                <template v-else-if="col.name === 'query_time'">
                  {{ props.row.query_took || '-' }}
                </template>
                <template v-else-if="col.name === 'error'">
                  <div v-if="props.row.error" class="tw-flex tw-items-center">
                    <q-icon name="error" size="20px" class="tw-text-red-500 tw-cursor-pointer">
                      <q-tooltip class="tw-text-xs tw-max-w-md">
                        {{ props.row.error }}
                      </q-tooltip>
                    </q-icon>
                  </div>
                  <span v-else>--</span>
                </template>
              </q-td>
            </q-tr>
          </template>

          <template #bottom="scope">
            <div class="bottom-btn tw-h-[48px] tw-flex tw-w-full">
              <div class="o2-table-footer-title tw-flex tw-items-center tw-w-[220px] tw-mr-md">
                {{ alertHistory.length }} {{ t('alerts.results') }}
              </div>
              <QTablePagination
                :scope="scope"
                :position="'bottom'"
                :resultTotal="alertHistory.length"
                :perPageOptions="perPageOptions"
                @update:changeRecordPerPage="changePagination"
              />
            </div>
          </template>
        </q-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
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

// Emit is not used since v-close-popup handles closing
// const emit = defineEmits(["close"]);

// Refs
const alertHistory: Ref<any[]> = ref([]);
const isLoadingHistory = ref(false);
const qTableRef: Ref<any> = ref(null);

// Pagination (offline pagination - fetch 100 records by default)
const selectedPerPage = ref<number>(100);
const pagination: any = ref({
  page: 1,
  rowsPerPage: 100,
});

const perPageOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 }
];

const changePagination = (val: { label: string; value: any }) => {
  selectedPerPage.value = val.value;
  pagination.value.rowsPerPage = val.value;
  pagination.value.page = 1; // Reset to first page when changing rows per page
  qTableRef.value?.setPagination(pagination.value);
};

// Computed property for dynamic table height
const tableHeight = computed(() => {
  // Base height calculation: 100vh - header - padding - conditions section
  // If description exists, reduce more height; otherwise give more space to table
  if (alertHistory.value.length === 0) {
    return 'width: 100%';
  }

  const hasDescription = props.alertDetails?.description;
  // With description: ~242px offset, Without description: ~190px offset (give ~52px more)
  const heightOffset = hasDescription ? '242px' : '166px';
  return `width: 100%; height: calc(100vh - ${heightOffset})`;
});

// Constants
const historyTableColumns = [
  {
    name: 'timestamp',
    label: t('alerts.historyTable.timestamp'),
    field: 'timestamp',
    align: 'left' as const,
    sortable: true
  },
  {
    name: 'status',
    label: t('alerts.historyTable.status'),
    field: 'status',
    align: 'center' as const,
    sortable: true
  },
  {
    name: 'evaluation_time',
    label: t('alerts.historyTable.evaluationTime'),
    field: 'evaluation_took_in_secs',
    align: 'center' as const,
    sortable: true
  },
  {
    name: 'query_time',
    label: t('alerts.historyTable.queryTime'),
    field: 'query_took',
    align: 'center' as const,
    sortable: true
  },
  {
    name: 'error',
    label: t('alerts.historyTable.error'),
    field: 'error',
    align: 'center' as const,
    sortable: false
  },
];

// Helper Functions
const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case "firing":
    case "error":
      return "negative";
    case "ok":
    case "success":
      return "positive";
    default:
      return "grey";
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

  // Less than 1 hour
  if (diff < 3600000000) {
    const minutes = Math.floor(diff / 60000000);
    return `${minutes} min ago`;
  }

  // Less than 24 hours
  if (diff < 86400000000) {
    const hours = Math.floor(diff / 3600000000);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }

  // Less than 7 days
  if (diff < 604800000000) {
    const days = Math.floor(diff / 86400000000);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  // Format as date
  return date.formatDate(timestamp / 1000, "MMM DD, YYYY HH:mm");
};

// Main Functions
const fetchAlertHistory = async (alertId: string) => {
  if (!alertId) return;

  isLoadingHistory.value = true;
  try {
    // Get history for last 30 days
    const endTime = Date.now() * 1000; // Convert to microseconds
    const startTime = endTime - (30 * 24 * 60 * 60 * 1000000); // 30 days ago in microseconds

    const response = await alertsService.getHistory(
      store?.state?.selectedOrganization?.identifier,
      {
        alert_id: alertId,
        size: 100, // Get last 100 evaluations for offline pagination
        start_time: startTime,
        end_time: endTime
      }
    );
    alertHistory.value = response.data?.hits || [];
  } catch (error: any) {
    alertHistory.value = [];
    $q.notify({
      type: "negative",
      message: error.response?.data?.message || error.message || t("alerts.failedToFetchHistory"),
      timeout: 5000,
    });
  } finally {
    isLoadingHistory.value = false;
  }
};

const refreshHistory = () => {
  if (props.alertId) {
    fetchAlertHistory(props.alertId);
  }
};

const copyToClipboard = (text: string, type: string) => {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      $q.notify({
        type: "positive",
        message: `${type} Copied Successfully!`,
        timeout: 5000,
      });
    })
    .catch(() => {
      $q.notify({
        type: "negative",
        message: "Error while copy content.",
        timeout: 5000,
      });
    });
};

// Watchers
watch(
  () => props.alertId,
  (newVal) => {
    if (newVal) {
      fetchAlertHistory(newVal);
    }
  },
  { immediate: true }
);
</script>

<style lang="scss" scoped>
.alert-details-content {
  max-height: calc(100vh - 80px);
}

.section-label {
  font-size: 0.875rem;
  font-weight: 600;
}
</style>
