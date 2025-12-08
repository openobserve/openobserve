<!-- Copyright 2025 OpenObserve Inc.

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
  <div data-test="backfill-jobs-list-page" class="q-pa-none flex">
    <div class="tw-w-full tw-h-full tw-pr-[0.625rem]">
      <!-- Header -->
      <div class="card-container tw-mb-[0.625rem]">
        <div class="flex justify-between full-width tw-h-[68px] tw-px-2 tw-py-3">
          <div class="flex items-center">
            <q-btn
              no-caps
              padding="xs"
              outline
              icon="arrow_back_ios_new"
              class="hideOnPrintMode el-border"
              @click="goBack"
              data-test="backfill-jobs-back-btn"
            />
            <div class="q-table__title tw-font-[600] q-ml-sm">
              Backfill Jobs
            </div>
          </div>
          <div class="flex items-center">
            <q-btn
              icon="refresh"
              flat
              round
              dense
              @click="refreshJobs"
              :loading="loading"
              data-test="refresh-btn"
            >
              <q-tooltip>Refresh</q-tooltip>
            </q-btn>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="card-container tw-mb-[0.625rem] q-pa-md">
        <div class="tw-grid tw-grid-cols-1 md:tw-grid-cols-3 tw-gap-4">
          <q-select
            v-model="filters.status"
            :options="statusOptions"
            label="Status"
            outlined
            dense
            clearable
            data-test="status-filter"
          />
          <q-select
            v-model="filters.pipelineId"
            :options="pipelineOptions"
            option-label="label"
            option-value="value"
            label="Pipeline"
            outlined
            dense
            clearable
            use-input
            input-debounce="300"
            @filter="filterPipelines"
            data-test="pipeline-filter"
          />
          <q-btn
            label="Clear Filters"
            outline
            @click="clearFilters"
            data-test="clear-filters-btn"
          />
        </div>
      </div>

      <!-- Jobs Table -->
      <div class="card-container">
        <q-table
          :rows="filteredJobs"
          :columns="columns"
          row-key="job_id"
          :loading="loading"
          :pagination="pagination"
          @request="onRequest"
          binary-state-sort
          flat
          data-test="backfill-jobs-table"
        >
          <!-- Empty State -->
          <template v-slot:no-data>
            <div class="full-width tw-py-12 tw-text-center">
              <q-icon name="inbox" size="48px" color="grey-5" />
              <div class="text-h6 q-mt-md text-grey-7">No backfill jobs yet</div>
              <div class="text-caption text-grey-6 q-mt-sm">
                Create your first backfill job to fill gaps in your pipeline data
              </div>
            </div>
          </template>

          <!-- Pipeline Name Column -->
          <template v-slot:body-cell-pipeline_name="props">
            <q-td :props="props">
              <div class="tw-font-medium">{{ props.row.pipeline_name || props.row.pipeline_id }}</div>
              <div class="text-caption text-grey-6">
                {{ formatTimeRange(props.row.start_time, props.row.end_time) }}
              </div>
            </q-td>
          </template>

          <!-- Status Column -->
          <template v-slot:body-cell-status="props">
            <q-td :props="props">
              <q-badge
                :color="getStatusColor(props.row.status, props.row.deletion_status)"
                :label="getStatusLabel(props.row.status, props.row.deletion_status)"
                data-test="status-badge"
              />
            </q-td>
          </template>

          <!-- Progress Column -->
          <template v-slot:body-cell-progress_percent="props">
            <q-td :props="props">
              <div class="tw-w-full">
                <div class="text-caption q-mb-xs">{{ props.row.progress_percent }}%</div>
                <q-linear-progress
                  :value="props.row.progress_percent / 100"
                  :color="getProgressColor(props.row.deletion_status)"
                  size="8px"
                  rounded
                  data-test="progress-bar"
                />
                <div v-if="props.row.chunks_total" class="text-caption text-grey-6 q-mt-xs">
                  {{ props.row.chunks_completed || 0 }} / {{ props.row.chunks_total }} chunks
                </div>
              </div>
            </q-td>
          </template>

          <!-- Created At Column -->
          <template v-slot:body-cell-created_at="props">
            <q-td :props="props">
              <div class="text-caption">{{ formatTimestamp(props.row.created_at) }}</div>
            </q-td>
          </template>

          <!-- Actions Column -->
          <template v-slot:body-cell-actions="props">
            <q-td :props="props">
              <div class="flex tw-gap-2">
                <q-btn
                  flat
                  dense
                  round
                  icon="visibility"
                  size="sm"
                  @click="viewJob(props.row)"
                  data-test="view-job-btn"
                >
                  <q-tooltip>View Details</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canCancelJob(props.row.status)"
                  flat
                  dense
                  round
                  icon="cancel"
                  size="sm"
                  color="negative"
                  @click="confirmCancelJob(props.row)"
                  data-test="cancel-job-btn"
                >
                  <q-tooltip>Cancel Job</q-tooltip>
                </q-btn>
              </div>
            </q-td>
          </template>
        </q-table>
      </div>
    </div>

    <!-- Job Details Dialog -->
    <BackfillJobDetails
      v-model="showDetailsDialog"
      :job-id="selectedJobId"
      @job-canceled="onJobCanceled"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import BackfillJobDetails from "./BackfillJobDetails.vue";
import { formatDistanceToNow } from "date-fns";

const router = useRouter();
const $q = useQuasar();
const store = useStore();

const loading = ref(false);
const jobs = ref<BackfillJob[]>([]);
const showDetailsDialog = ref(false);
const selectedJobId = ref("");

const filters = ref({
  status: null as string | null,
  pipelineId: null as any,
});

const pagination = ref({
  page: 1,
  rowsPerPage: 10,
  rowsNumber: 0,
});

const columns = [
  {
    name: "pipeline_name",
    label: "Pipeline",
    align: "left",
    field: "pipeline_name",
    sortable: true,
  },
  {
    name: "status",
    label: "Status",
    align: "left",
    field: "status",
    sortable: true,
  },
  {
    name: "progress_percent",
    label: "Progress",
    align: "left",
    field: "progress_percent",
    sortable: true,
  },
  {
    name: "created_at",
    label: "Created",
    align: "left",
    field: "created_at",
    sortable: true,
  },
  {
    name: "actions",
    label: "Actions",
    align: "right",
    field: "actions",
  },
];

const statusOptions = ["running", "completed", "failed", "pending", "canceled"];
const pipelineOptions = ref<any[]>([]);
const allPipelineOptions = ref<any[]>([]);

onMounted(() => {
  loadJobs();
  loadPipelineOptions();
});

const loadJobs = async () => {
  loading.value = true;

  try {
    const response = await backfillService.listBackfillJobs({
      org_id: store.state.selectedOrganization.identifier,
    });
    jobs.value = response;
    pagination.value.rowsNumber = response.length;
  } catch (error: any) {
    console.error("Error loading backfill jobs:", error);
    $q.notify({
      type: "negative",
      message: "Failed to load backfill jobs",
      timeout: 3000,
    });
  } finally {
    loading.value = false;
  }
};

const loadPipelineOptions = () => {
  // Extract unique pipelines from jobs
  const uniquePipelines = [...new Map(
    jobs.value.map(job => [job.pipeline_id, {
      label: job.pipeline_name || job.pipeline_id,
      value: job.pipeline_id,
    }])
  ).values()];

  allPipelineOptions.value = uniquePipelines;
  pipelineOptions.value = uniquePipelines;
};

const filterPipelines = (val: string, update: any) => {
  update(() => {
    const needle = val.toLowerCase();
    pipelineOptions.value = allPipelineOptions.value.filter(
      (v) => v.label.toLowerCase().indexOf(needle) > -1
    );
  });
};

const filteredJobs = computed(() => {
  let filtered = jobs.value;

  if (filters.value.status) {
    filtered = filtered.filter((job) => job.status === filters.value.status);
  }

  if (filters.value.pipelineId) {
    filtered = filtered.filter((job) => job.pipeline_id === filters.value.pipelineId.value);
  }

  return filtered;
});

const clearFilters = () => {
  filters.value = {
    status: null,
    pipelineId: null,
  };
};

const refreshJobs = () => {
  loadJobs();
};

const onRequest = (props: any) => {
  pagination.value = props.pagination;
};

const goBack = () => {
  router.back();
};

const viewJob = (job: BackfillJob) => {
  selectedJobId.value = job.job_id;
  showDetailsDialog.value = true;
};

const canCancelJob = (status: string) => {
  return status === "running" || status === "pending";
};

const confirmCancelJob = (job: BackfillJob) => {
  $q.dialog({
    title: "Cancel Backfill Job",
    message: `Are you sure you want to cancel the backfill job for "${job.pipeline_name || job.pipeline_id}"?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await cancelJob(job.job_id);
  });
};

const cancelJob = async (jobId: string) => {
  try {
    await backfillService.cancelBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job canceled successfully",
      timeout: 3000,
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error canceling backfill job:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Failed to cancel backfill job",
      timeout: 5000,
    });
  }
};

const onJobCanceled = () => {
  loadJobs();
};

// Helper functions
const getStatusColor = (status: string, deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "object" && "failed" in deletionStatus) {
    return "negative";
  }
  if (deletionStatus && ["pending", "in_progress"].includes(deletionStatus)) {
    return "blue";
  }

  switch (status) {
    case "running":
      return "positive";
    case "completed":
      return "positive";
    case "failed":
      return "negative";
    case "pending":
      return "warning";
    case "canceled":
      return "grey";
    default:
      return "grey";
  }
};

const getStatusLabel = (status: string, deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "object" && "failed" in deletionStatus) {
    return "Deletion Failed";
  }
  if (deletionStatus === "pending") {
    return "Deleting (Pending)";
  }
  if (deletionStatus === "in_progress") {
    return "Deleting";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getProgressColor = (deletionStatus?: any) => {
  if (deletionStatus && ["pending", "in_progress"].includes(deletionStatus)) {
    return "blue";
  }
  return "positive";
};

const formatTimeRange = (startTime: number, endTime: number) => {
  const start = new Date(startTime / 1000); // Convert from microseconds
  const end = new Date(endTime / 1000);
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
};

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp / 1000); // Convert from microseconds
  return formatDistanceToNow(date, { addSuffix: true });
};
</script>

<style scoped lang="scss">
.card-container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
}

.el-border {
  border: 1px solid #e0e0e0;
}
</style>
