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
  <div data-test="pipeline-history-page" class="q-pa-none flex">
    <div class="tw:w-full tw:h-full tw:pr-[0.625rem]">
      <div class="card-container tw:mb-[0.625rem]">
        <div
          class="flex justify-between full-width tw:h-[68px] tw:px-2 tw:py-3"
        >
          <div class="flex items-center">
            <q-btn
              no-caps
              padding="xs"
              outline
              icon="arrow_back_ios_new"
              class="hideOnPrintMode el-border"
              @click="goBack"
              data-test="alert-history-back-btn"
            />
            <div
              class="q-table__title tw:font-[600] q-ml-sm tw:flex tw:items-center tw:gap-2"
              data-test="pipeline-history-title"
            >
              {{ t(`pipeline.history`) }}
              <q-icon name="info" size="18px" color="grey-6">
                <q-tooltip>
                  History is only available for scheduled and manually triggered pipelines.
                  Real-time pipelines do not generate history records.
                </q-tooltip>
              </q-icon>
            </div>
          </div>
          <div class="flex q-ml-auto items-center">
            <div class="q-mr-sm">
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
              option-label="label"
              option-value="value"
              @filter="filterPipelineOptions"
              @update:model-value="onPipelineSelected"
              :placeholder="
                t(`pipeline.searchHistory`) || 'Select or search pipeline...'
              "
              data-test="pipeline-history-search-select"
              class="o2-search-input q-mr-sm"
              style="min-width: 250px"
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
              dense
              @click="manualSearch"
              data-test="pipeline-history-manual-search-btn"
              :disable="loading"
              class="q-mr-sm download-logs-btn q-px-sm q-py-sm element-box-shadow el-border"
            >
              <q-tooltip>{{ t("common.search") || "Search" }}</q-tooltip>
            </q-btn>
            <q-btn
              icon="refresh"
              flat
              dense
              @click="refreshData"
              class="download-logs-btn q-px-sm q-py-sm element-box-shadow el-border"
              data-test="pipeline-history-refresh-btn"
              :loading="loading"
            >
              <q-tooltip>{{ t("common.refresh") || "Refresh" }}</q-tooltip>
            </q-btn>
          </div>
        </div>
      </div>
    </div>
    <div class="tw:w-full tw:h-full tw:pr-[0.625rem]">
      <div class="pipeline-history-table card-container tw:h-[calc(100vh-127px)]">
        <q-table
          data-test="pipeline-history-table"
          ref="qTable"
          :rows="rows"
          :columns="columns"
          row-key="id"
          v-model:pagination="pagination"
          :rows-per-page-options="rowsPerPageOptions"
          @request="onRequest"
          :loading="loading"
          binary-state-sort
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          style="width: 100%; height: calc(100vh - 127px)"
        >
          <template #no-data>
            <div class="tw:h-[calc(100vh-136px)] full-width">
              <no-data />
            </div>
          </template>

          <template #body-cell-timestamp="props">
            <q-td :props="props">
              {{ formatDate(props.row.timestamp) }}
            </q-td>
          </template>

          <template #body-cell-start_time="props">
            <q-td :props="props">
              {{ formatDate(props.row.start_time) }}
            </q-td>
          </template>

          <template #body-cell-end_time="props">
            <q-td :props="props">
              {{ formatDate(props.row.end_time) }}
            </q-td>
          </template>

          <template #body-cell-status="props">
            <q-td :props="props">
              <q-chip
                :color="getStatusColor(props.row.status)"
                text-color="white"
                size="0.8rem"
                dense
                outline
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
                size="xs"
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
                :name="props.row.is_silenced ? 'volume_off' : 'volume_up'"
                :color="props.row.is_silenced ? 'grey' : 'positive'"
                size="20px"
              >
                <q-tooltip>
                  {{ props.row.is_silenced ? "Silenced" : "Not Silenced" }}
                </q-tooltip>
              </q-icon>
            </q-td>
          </template>

          <template #body-cell-duration="props">
            <q-td :props="props">
              {{ formatDuration(props.row.end_time - props.row.start_time) }}
            </q-td>
          </template>

          <template #body-cell-is_partial="props">
            <q-td :props="props">
              <q-icon
                v-if="props.row.is_partial !== null && props.row.is_partial !== undefined"
                :name="props.row.is_partial ? 'warning' : 'check_circle'"
                :color="props.row.is_partial ? 'warning' : 'positive'"
                size="xs"
              >
                <q-tooltip>
                  {{ props.row.is_partial ? "Partial Results" : "Complete Results" }}
                </q-tooltip>
              </q-icon>
              <span v-else>-</span>
            </q-td>
          </template>

          <template #body-cell-delay_in_secs="props">
            <q-td :props="props">
              {{ props.row.delay_in_secs !== null && props.row.delay_in_secs !== undefined ? props.row.delay_in_secs + 's' : '-' }}
            </q-td>
          </template>

          <template #body-cell-evaluation_took_in_secs="props">
            <q-td :props="props">
              {{ props.row.evaluation_took_in_secs !== null && props.row.evaluation_took_in_secs !== undefined ? props.row.evaluation_took_in_secs.toFixed(2) + 's' : '-' }}
            </q-td>
          </template>

          <template #body-cell-query_took="props">
            <q-td :props="props">
              {{ props.row.query_took !== null && props.row.query_took !== undefined ? (props.row.query_took / 1000).toFixed(2) + 'ms' : '-' }}
            </q-td>
          </template>

          <template #bottom="scope">
                <div class="bottom-btn tw:h-[48px] tw:w-full tw:flex tw:items-center">
                <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[120px] tw:mr-md">
                      {{ pagination.rowsNumber }} {{ t('pipeline.header') }}
                    </div>
                    <QTablePagination
                      :scope="scope"
                      :position="'bottom'"
                      :resultTotal="pagination.rowsNumber"
                      :perPageOptions="rowsPerPageOptions"
                      @update:changeRecordPerPage="changePagination"
                    />
                  </div>
          </template>
        </q-table>
      </div>
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
                    size="0.8rem"
                    dense
                    outline
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
                selectedRow.retries > 0 ||
                selectedRow.delay_in_secs ||
                selectedRow.is_partial !== null && selectedRow.is_partial !== undefined
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
                  <div v-if="selectedRow.delay_in_secs" class="col-4">
                    <div class="text-caption text-grey-7 q-mb-xs">
                      Delay
                    </div>
                    <div class="text-body2">
                      {{ selectedRow.delay_in_secs }}s
                    </div>
                  </div>
                  <div v-if="selectedRow.is_partial !== null && selectedRow.is_partial !== undefined" class="col-4">
                    <div class="text-caption text-grey-7 q-mb-xs">
                      Result Status
                    </div>
                    <div class="text-body2">
                      <q-icon
                        :name="selectedRow.is_partial ? 'warning' : 'check_circle'"
                        :color="selectedRow.is_partial ? 'warning' : 'positive'"
                        size="xs"
                        class="q-mr-xs"
                      />
                      {{ selectedRow.is_partial ? 'Partial' : 'Complete' }}
                    </div>
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
        <q-card-section class="pipeline-error-header row items-center q-pb-none">
          <div class="tw:flex-1">
            <div class="tw:flex tw:items-center tw:gap-3 tw:mb-1">
              <q-icon name="error" size="24px" class="error-icon" />
              <span class="pipeline-name">{{ errorMessage.pipeline_name }}</span>
            </div>
            <div class="error-timestamp">
              <span class="tw:ml-1">Last error:</span>
              <q-icon name="schedule" size="14px" class="tw:mr-1" />
              {{ errorMessage.last_error_timestamp && new Date(errorMessage.last_error_timestamp / 1000).toLocaleString() }}
            </div>
          </div>
          <q-btn
            icon="close"
            flat
            round
            dense
            @click="closeErrorDialog"
            class="close-btn"
          />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="tw:mb-4">
            <div class="section-label tw:mb-2">Error Summary</div>
              <div class="error-summary-box">
                {{ errorMessage.error }}
              </div>
          </div>
        </q-card-section>
        <q-card-actions class="pipeline-error-actions">
          <q-btn
            flat
            no-caps
            label="Close"
            class="o2-secondary-button tw:h-[36px]"
            @click="closeErrorDialog"
          />
        </q-card-actions>
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
import NoData from "@/components/shared/grid/NoData.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const $q = useQuasar();

// Data
const loading = ref(false);
const rows = ref<any[]>([]);
const searchQuery = ref("");
const selectedPipeline = ref<any>(null);
const allPipelines = ref<any[]>([]);
const filteredPipelineOptions = ref<any[]>([]);
const pagination = ref({
  page: 1,
  rowsPerPage: 20,
  rowsNumber: 0,
  sortBy: "timestamp",
  descending: true,
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
  { name: "#", label: "#", field: "#", align: "left", style: "width: 37px;" },
  {
    name: "pipeline_name",
    label: "Pipeline Name",
    field: "pipeline_name",
    align: "left",
    sortable: true,
  },
  {
    name: "is_realtime",
    label: "Type",
    field: "is_realtime",
    align: "center",
    sortable: true,
    style: "width: 37px;",
  },
  {
    name: "is_silenced",
    label: "Is Silenced",
    field: "is_silenced",
    align: "center",
    sortable: true,
    style: "width: 37px;",
  },
  {
    name: "timestamp",
    label: "Timestamp",
    field: "timestamp",
    align: "left",
    sortable: true,
    style: "width: 160px;",
  },
  {
    name: "start_time",
    label: "Start Time",
    field: "start_time",
    align: "left",
    sortable: true,
    style: "width: 160px;",
  },
  {
    name: "end_time",
    label: "End Time",
    field: "end_time",
    align: "left",
    sortable: true,
    style: "width: 160px;",
  },
  {
    name: "duration",
    label: "Duration",
    field: (row: any) => row.end_time - row.start_time,
    align: "right",
    sortable: true,
    style: "width: 50px;",
  },
  {
    name: "status",
    label: "Status",
    field: "status",
    align: "center",
    sortable: true,
    style: "width: 150px;",
  },
  {
    name: "retries",
    label: "Retries",
    field: "retries",
    align: "center",
    sortable: true,
    style: "width: 50px;",
  },
  {
    name: "is_partial",
    label: "Partial",
    field: "is_partial",
    align: "center",
    sortable: false,
    style: "width: 60px;",
  },
  {
    name: "delay_in_secs",
    label: "Delay (s)",
    field: "delay_in_secs",
    align: "right",
    sortable: true,
    style: "width: 80px;",
  },
  {
    name: "evaluation_took_in_secs",
    label: "Eval Time (s)",
    field: "evaluation_took_in_secs",
    align: "right",
    sortable: true,
    style: "width: 100px;",
  },
  {
    name: "query_took",
    label: "Query Time (ms)",
    field: "query_took",
    align: "right",
    sortable: true,
    style: "width: 110px;",
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
  if (val && val.value) {
    // Store the pipeline ID for the API call
    searchQuery.value = val.value;
    // Automatically trigger search when an item is selected
    pagination.value.page = 1;
    fetchPipelineHistory();
  }
};

const clearSearch = () => {
  searchQuery.value = "";
  selectedPipeline.value = null;
};

const manualSearch = () => {
  // Update searchQuery from selectedPipeline when manually searching
  if (selectedPipeline.value && selectedPipeline.value.value) {
    searchQuery.value = selectedPipeline.value.value;
  } else if (selectedPipeline.value && typeof selectedPipeline.value === 'string') {
    // Handle case where user typed a value without selecting from dropdown
    searchQuery.value = selectedPipeline.value;
  }
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
        "#": (index + 1) + (pagination.value.page - 1) * pagination.value.rowsPerPage,
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
    case "completed":
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
      return store.state.theme === "dark" ? "white" : "black";
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
  router.push({ 
    name: "pipelines",
    query: {
            org_identifier: store.state.selectedOrganization.identifier,
          }});
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

    // Align all sorting chevrons to the right
    th.sortable {
      .q-table__sort-icon {
        margin-left: auto;
        margin-right: 0;
      }
    }

    // Ensure header content and icon are in a flex container
    .q-table th .q-table__sort-icon {
      order: 2;
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
