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
        <div class="flex justify-between full-width tw-h-[68px] tw-px-4 tw-py-3">
          <div class="flex items-center">
            <q-btn
              no-caps
              padding="xs"
              outline
              icon="arrow_back_ios_new"
              class="hideOnPrintMode"
              :class="
                store.state.theme === 'dark'
                  ? 'o2-secondary-button-dark'
                  : 'o2-secondary-button-light'
              "
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
        <div class="flex items-center tw-gap-4">
          <q-select
            v-model="filters.status"
            :options="statusOptions"
            label="Status"
            outlined
            dense
            clearable
            style="width: 150px"
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
            style="width: 250px"
            data-test="pipeline-filter"
          />
          <q-btn
            label="Clear Filters"
            outline
            no-caps
            padding="xs sm"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
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
              <div class="text-caption">
                {{ formatTimestamp(props.row.created_at) }}
              </div>
            </q-td>
          </template>

          <!-- Last Triggered At Column -->
          <template v-slot:body-cell-last_triggered_at="props">
            <q-td :props="props">
              <div class="text-caption">
                {{ formatTimestamp(props.row.last_triggered_at) }}
              </div>
            </q-td>
          </template>

          <!-- Actions Column -->
          <template v-slot:body-cell-actions="props">
            <q-td :props="props">
              <div class="flex items-center justify-end tw-gap-1">
                <q-btn
                  v-if="canPauseJob(props.row.status)"
                  flat
                  dense
                  round
                  icon="pause"
                  size="sm"
                  color="warning"
                  @click="confirmPauseJob(props.row)"
                  data-test="pause-job-btn"
                >
                  <q-tooltip>Pause Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canResumeJob(props.row.status)"
                  flat
                  dense
                  round
                  icon="play_arrow"
                  size="sm"
                  color="positive"
                  @click="confirmResumeJob(props.row)"
                  data-test="resume-job-btn"
                >
                  <q-tooltip>Resume Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canEditJob(props.row.status)"
                  flat
                  dense
                  round
                  icon="edit"
                  size="sm"
                  color="primary"
                  @click="editJob(props.row)"
                  data-test="edit-job-btn"
                >
                  <q-tooltip>Edit Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canDeleteJob(props.row.status)"
                  flat
                  dense
                  round
                  icon="delete"
                  size="sm"
                  color="negative"
                  @click="confirmDeleteJob(props.row)"
                  data-test="delete-job-btn"
                >
                  <q-tooltip>Delete Job</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  dense
                  round
                  icon="info"
                  size="sm"
                  @click="viewJob(props.row)"
                  data-test="view-job-btn"
                >
                  <q-tooltip>View Details</q-tooltip>
                </q-btn>
                <!-- Error Indicator - Always render to maintain alignment -->
                <div class="backfill-error-slot">
                  <q-btn
                    v-if="props.row.error"
                    flat
                    dense
                    round
                    icon="error"
                    size="sm"
                    color="negative"
                    @click="showErrorDialog(props.row)"
                    data-test="error-indicator-btn"
                  >
                    <q-tooltip>Error: {{ props.row.error }}</q-tooltip>
                  </q-btn>
                </div>
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

    <!-- Edit Job Dialog -->
    <EditBackfillJobDialog
      v-model="showEditDialog"
      :job="selectedJob"
      @job-updated="onJobUpdated"
    />

    <!-- Error Dialog -->
    <q-dialog v-model="errorDialogVisible" @hide="closeErrorDialog">
      <q-card class="backfill-error-dialog" style="min-width: 500px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">
            <q-icon name="error" color="negative" size="24px" class="q-mr-sm" />
            Backfill Job Error
          </div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section v-if="errorDialogData">
          <div class="q-mb-md">
            <div class="text-caption text-grey-6">Job ID</div>
            <div class="text-body2 text-weight-medium">{{ errorDialogData.job_id }}</div>
          </div>

          <div class="q-mb-md">
            <div class="text-caption text-grey-6">Pipeline</div>
            <div class="text-body2">{{ errorDialogData.pipeline_name || errorDialogData.pipeline_id }}</div>
          </div>

          <div>
            <div class="text-caption text-grey-6 q-mb-sm">Error Message</div>
            <div class="error-message-box">
              {{ errorDialogData.error }}
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import BackfillJobDetails from "./BackfillJobDetails.vue";
import EditBackfillJobDialog from "./EditBackfillJobDialog.vue";

const router = useRouter();
const $q = useQuasar();
const store = useStore();

const loading = ref(false);
const jobs = ref<BackfillJob[]>([]);
const showDetailsDialog = ref(false);
const selectedJobId = ref("");
const showEditDialog = ref(false);
const selectedJob = ref<BackfillJob | null>(null);
const errorDialogVisible = ref(false);
const errorDialogData = ref<BackfillJob | null>(null);

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
    align: "left" as const,
    field: "pipeline_name",
    sortable: true,
  },
  {
    name: "progress_percent",
    label: "Progress",
    align: "left" as const,
    field: "progress_percent",
    sortable: true,
  },
  {
    name: "created_at",
    label: "Created",
    align: "left" as const,
    field: "created_at",
    sortable: true,
  },
  {
    name: "last_triggered_at",
    label: "Last Triggered",
    align: "left" as const,
    field: "last_triggered_at",
    sortable: true,
  },
  {
    name: "actions",
    label: "Actions",
    align: "right" as const,
    field: "actions",
  },
];

const statusOptions = ["running", "completed", "paused"];
const pipelineOptions = ref<any[]>([]);
const allPipelineOptions = ref<any[]>([]);

onMounted(() => {
  loadJobs();
});

const loadJobs = async () => {
  loading.value = true;

  try {
    const response = await backfillService.listBackfillJobs({
      org_id: store.state.selectedOrganization.identifier,
    });
    jobs.value = response;
    pagination.value.rowsNumber = response.length;
    loadPipelineOptions();
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
  const pipelineMap = new Map(
    jobs.value.map(job => [job.pipeline_id, {
      label: job.pipeline_name || job.pipeline_id,
      value: job.pipeline_id,
    }])
  );
  const uniquePipelines = Array.from(pipelineMap.values());

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
    filtered = filtered.filter((job) => {
      // Map actual status to display status
      let displayStatus = job.status;
      if (job.status === "waiting" || job.status === "pending") {
        displayStatus = "running";
      }
      // paused and completed stay as-is
      return displayStatus === filters.value.status;
    });
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

const editJob = (job: BackfillJob) => {
  selectedJob.value = job;
  showEditDialog.value = true;
};

const onJobUpdated = () => {
  loadJobs();
};

const canPauseJob = (status: string) => {
  return status === "running" || status === "waiting";
};

const canResumeJob = (status: string) => {
  return status === "paused";
};

const canEditJob = (status: string) => {
  return status === "paused" || status === "completed";
};

const canDeleteJob = (status: string) => {
  return status === "completed" || status === "failed" || status === "canceled" || status === "paused";
};

const confirmPauseJob = (job: BackfillJob) => {
  $q.dialog({
    title: "Pause Backfill Job",
    message: `Are you sure you want to pause the backfill job for "${job.pipeline_name || job.pipeline_id}"? You can resume it later.`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await pauseJob(job.job_id);
  });
};

const confirmResumeJob = (job: BackfillJob) => {
  $q.dialog({
    title: "Resume Backfill Job",
    message: `Are you sure you want to resume the backfill job for "${job.pipeline_name || job.pipeline_id}"?`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await resumeJob(job.job_id);
  });
};

const confirmDeleteJob = (job: BackfillJob) => {
  $q.dialog({
    title: "Delete Backfill Job",
    message: `Are you sure you want to delete the backfill job for "${job.pipeline_name || job.pipeline_id}"? This will remove the job from the list but will not affect the backfilled data.`,
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await deleteJob(job.job_id);
  });
};

const pauseJob = async (jobId: string) => {
  try {
    await backfillService.pauseBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job paused successfully",
      timeout: 3000,
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error pausing backfill job:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Failed to pause backfill job",
      timeout: 5000,
    });
  }
};

const resumeJob = async (jobId: string) => {
  try {
    await backfillService.resumeBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job resumed successfully",
      timeout: 3000,
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error resuming backfill job:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Failed to resume backfill job",
      timeout: 5000,
    });
  }
};

const deleteJob = async (jobId: string) => {
  try {
    await backfillService.deleteBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job deleted successfully",
      timeout: 3000,
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error deleting backfill job:", error);
    $q.notify({
      type: "negative",
      message: error?.response?.data?.error || "Failed to delete backfill job",
      timeout: 5000,
    });
  }
};

const onJobCanceled = () => {
  loadJobs();
};

const showErrorDialog = (job: BackfillJob) => {
  errorDialogData.value = job;
  errorDialogVisible.value = true;
};

const closeErrorDialog = () => {
  errorDialogVisible.value = false;
  errorDialogData.value = null;
};

// Helper functions
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
  const unixSeconds = timestamp / 1e6; // Convert from microseconds to seconds
  const dateToFormat = new Date(unixSeconds * 1000);
  const formattedDate = dateToFormat.toISOString();
  return date.formatDate(formattedDate, "YYYY-MM-DDTHH:mm:ssZ");
};
</script>

<style scoped lang="scss">
.card-container {
  border-radius: 8px;
}

.backfill-error-slot {
  display: inline-block;
  width: 32px;
  height: 32px;
  vertical-align: middle;
}

.error-message-box {
  padding: 12px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.08);
  border-left: 3px solid #ef4444;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: #991b1b;
}
</style>
