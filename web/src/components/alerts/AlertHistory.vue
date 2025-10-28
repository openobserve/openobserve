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
    data-test="alert-history-page"
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
          data-test="alert-history-back-btn"
        />
        <div
          class="q-table__title tw-font-[600]"
          data-test="alerts-history-title"
        >
          {{ t("alerts.history") || "Alert History" }}
        </div>
      </div>
      <div class="flex q-ml-auto items-center">
        <div class="q-mr-md">
          <DateTimePicker
            v-model="dateTime"
            @update:model-value="onDateChange"
            data-test="alert-history-date-picker"
          />
        </div>
        <q-input
          v-model="searchQuery"
          dense
          borderless
          :placeholder="t('alerts.searchHistory') || 'Search alert history...'"
          data-test="alert-history-search-input"
          class="o2-search-input q-mr-md"
          :class="
            store.state.theme === 'dark'
              ? 'o2-search-input-dark'
              : 'o2-search-input-light'
          "
        >
          <template #prepend>
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
        </q-input>
        <q-btn
          icon="refresh"
          flat
          round
          @click="refreshData"
          data-test="alert-history-refresh-btn"
          :loading="loading"
        >
          <q-tooltip>{{ t("common.refresh") || "Refresh" }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div
      class="full-width alert-history-table"
      style="height: calc(100vh - 138px)"
    >
      <q-table
        data-test="alert-history-table"
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
            <span>{{ t("alerts.noHistory") || "No alert history found" }}</span>
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
              data-test="alert-history-view-details"
            >
              <q-tooltip>View Details</q-tooltip>
            </q-btn>
          </q-td>
        </template>

        <template #bottom>
          <QTablePagination
            :pagination="pagination"
            :rows-per-page-options="rowsPerPageOptions"
            @update:pagination="onRequest({ pagination: $event })"
          />
        </template>
      </q-table>
    </div>

    <!-- Details Dialog -->
    <q-dialog v-model="detailsDialog" maximized>
      <q-card class="full-width">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">Alert Execution Details</div>
          <q-space />
          <q-btn icon="close" flat round dense @click="detailsDialog = false" />
        </q-card-section>

        <q-card-section v-if="selectedRow">
          <div class="q-gutter-md">
            <div class="row q-col-gutter-md">
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Alert Name</div>
                <div>{{ selectedRow.alert_name }}</div>
              </div>
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Status</div>
                <q-chip
                  :color="getStatusColor(selectedRow.status)"
                  text-color="white"
                  size="sm"
                  dense
                >
                  {{ selectedRow.status }}
                </q-chip>
              </div>
            </div>

            <div class="row q-col-gutter-md">
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Timestamp</div>
                <div>{{ formatDate(selectedRow.timestamp) }}</div>
              </div>
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Duration</div>
                <div>
                  {{
                    formatDuration(
                      selectedRow.end_time - selectedRow.start_time,
                    )
                  }}
                </div>
              </div>
            </div>

            <div class="row q-col-gutter-md">
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Type</div>
                <div>
                  {{ selectedRow.is_realtime ? "Real-time" : "Scheduled" }}
                </div>
              </div>
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Silenced</div>
                <div>{{ selectedRow.is_silenced ? "Yes" : "No" }}</div>
              </div>
            </div>

            <div v-if="selectedRow.retries > 0" class="row q-col-gutter-md">
              <div class="col-12">
                <div class="text-subtitle2 q-mb-xs">Retries</div>
                <div>{{ selectedRow.retries }}</div>
              </div>
            </div>

            <div
              v-if="selectedRow.evaluation_took_in_secs"
              class="row q-col-gutter-md"
            >
              <div class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Evaluation Time</div>
                <div>{{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s</div>
              </div>
              <div v-if="selectedRow.query_took" class="col-md-6">
                <div class="text-subtitle2 q-mb-xs">Query Time</div>
                <div>{{ (selectedRow.query_took / 1000).toFixed(2) }}ms</div>
              </div>
            </div>

            <div v-if="selectedRow.source_node" class="row q-col-gutter-md">
              <div class="col-12">
                <div class="text-subtitle2 q-mb-xs">Source Node</div>
                <div>{{ selectedRow.source_node }}</div>
              </div>
            </div>

            <div v-if="selectedRow.error" class="row q-col-gutter-md">
              <div class="col-12">
                <div class="text-subtitle2 q-mb-xs">Error</div>
                <q-card flat bordered class="q-pa-sm bg-negative-1">
                  <pre style="white-space: pre-wrap; word-break: break-word">{{
                    selectedRow.error
                  }}</pre>
                </q-card>
              </div>
            </div>

            <div
              v-if="selectedRow.success_response"
              class="row q-col-gutter-md"
            >
              <div class="col-12">
                <div class="text-subtitle2 q-mb-xs">Response</div>
                <q-card flat bordered class="q-pa-sm">
                  <pre style="white-space: pre-wrap; word-break: break-word">{{
                    selectedRow.success_response
                  }}</pre>
                </q-card>
              </div>
            </div>
          </div>
        </q-card-section>
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
import { useQuasar, date, debounce } from "quasar";
import DateTimePicker from "@/components/DateTimePicker.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const $q = useQuasar();

// Data
const loading = ref(false);
const rows = ref<any[]>([]);
const searchQuery = ref("");
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  rowsNumber: 0,
});
const rowsPerPageOptions = [10, 20, 50, 100];

// Date time picker - default to last 15 minutes
const now = new Date();
const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
const dateTime = ref({
  startTime: fifteenMinutesAgo.toISOString(),
  endTime: now.toISOString(),
  selectedDate: "custom",
  selectedTime: "15m",
  valueType: "relative",
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
    label: t("common.timestamp") || "Timestamp",
    field: "timestamp",
    align: "left",
    sortable: true,
  },
  {
    name: "alert_name",
    label: t("alerts.name") || "Alert Name",
    field: "alert_name",
    align: "left",
    sortable: true,
  },
  {
    name: "status",
    label: t("common.status") || "Status",
    field: "status",
    align: "center",
    sortable: true,
  },
  {
    name: "is_realtime",
    label: t("alerts.type") || "Type",
    field: "is_realtime",
    align: "center",
    sortable: false,
  },
  {
    name: "is_silenced",
    label: t("alerts.silenced") || "Silenced",
    field: "is_silenced",
    align: "center",
    sortable: false,
  },
  {
    name: "duration",
    label: t("common.duration") || "Duration",
    field: (row: any) => row.end_time - row.start_time,
    align: "right",
    sortable: true,
  },
  {
    name: "retries",
    label: t("alerts.retries") || "Retries",
    field: "retries",
    align: "center",
    sortable: true,
  },
  {
    name: "error",
    label: t("common.error") || "Error",
    field: "error",
    align: "center",
    sortable: false,
  },
  {
    name: "actions",
    label: t("common.actions") || "Actions",
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
const fetchAlertHistory = async () => {
  loading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;

    // Convert dates to microseconds
    const startTime = new Date(dateTime.value.startTime).getTime() * 1000;
    const endTime = new Date(dateTime.value.endTime).getTime() * 1000;

    const query: any = {
      start_time: startTime.toString(),
      end_time: endTime.toString(),
      from: (
        (pagination.value.page - 1) *
        pagination.value.rowsPerPage
      ).toString(),
      size: pagination.value.rowsPerPage.toString(),
    };

    // Add alert_name filter if search query is provided
    if (searchQuery.value && searchQuery.value.trim()) {
      query.alert_name = searchQuery.value.trim();
    }

    console.log("Fetching alert history with query:", query);
    console.log("Organization:", org);
    console.log("API URL:", `/api/${org}/alerts/history`);

    const response = await alertsService.getHistory(org, query);

    console.log("Alert history response:", response);

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

      console.log("Processed rows:", rows.value);
      console.log("Total records:", pagination.value.rowsNumber);

      if (rows.value.length === 0) {
        console.log("No alert history found for the selected time range");
      }
    }
  } catch (error: any) {
    console.error("Error fetching alert history:", error);
    console.error("Error response:", error.response);
    $q.notify({
      type: "negative",
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to fetch alert history",
    });
  } finally {
    loading.value = false;
  }
};

const onDateChange = () => {
  pagination.value.page = 1;
  fetchAlertHistory();
};

const onRequest = (props: any) => {
  const { page, rowsPerPage, sortBy, descending } = props.pagination;

  pagination.value.page = page;
  pagination.value.rowsPerPage = rowsPerPage;
  pagination.value.sortBy = sortBy;
  pagination.value.descending = descending;

  fetchAlertHistory();
};

const refreshData = () => {
  fetchAlertHistory();
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
  router.push({ name: "alertList" });
};

// Debounced search
const debouncedSearch = debounce(() => {
  pagination.value.page = 1;
  fetchAlertHistory();
}, 500);

// Lifecycle
onMounted(() => {
  fetchAlertHistory();
});

// Watch for organization change
watch(
  () => store.state.selectedOrganization.identifier,
  () => {
    fetchAlertHistory();
  },
);

// Watch for search query changes
watch(searchQuery, () => {
  debouncedSearch();
});
</script>

<style scoped lang="scss">
.alert-history-table {
  :deep(.q-table) {
    width: 100%;

    td {
      vertical-align: middle;
    }
  }
}
</style>
