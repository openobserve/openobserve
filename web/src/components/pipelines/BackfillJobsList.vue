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
  <q-page data-test="backfill-jobs-list-page">
    <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
      <!-- Header -->
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:px-4 tw:h-[68px]">
          <div class="tw:flex tw:items-center">
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
            <div class="q-table__title tw:font-[600] q-ml-sm">
              Backfill Jobs
            </div>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2">
            <!-- Filters -->
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

      <!-- Jobs Table -->
      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
        <div class="card-container tw:h-[calc(100vh-127px)]">
        <q-table
          ref="qTableRef"
          :rows="filteredJobs"
          :columns="columns"
          row-key="job_id"
          :loading="loading"
          :pagination="pagination"
          binary-state-sort
          :style="filteredJobs.length > 0
            ? 'width: 100%; height: calc(100vh - 130px)'
            : 'width: 100%'"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          data-test="backfill-jobs-table"
        >
          <!-- Empty State -->
          <template v-slot:no-data>
            <NoData />
          </template>

          <!-- Pipeline Name Column -->
          <template v-slot:body-cell-pipeline_name="props">
            <q-td :props="props">
              <div class="tw:font-medium">{{ props.row.pipeline_name || props.row.pipeline_id }}</div>
            </q-td>
          </template>

          <!-- Time Range Column -->
          <template v-slot:body-cell-time_range="props">
            <q-td :props="props">
              <div class="text-caption">
                {{ formatTimeRange(props.row.start_time, props.row.end_time) }}
              </div>
            </q-td>
          </template>

          <!-- Progress Column -->
          <template v-slot:body-cell-progress_percent="props">
            <q-td :props="props">
              <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
                <div class="tw:flex-1 tw:relative">
                  <q-linear-progress
                    :value="props.row.progress_percent / 100"
                    :color="getProgressColor(props.row.deletion_status)"
                    size="20px"
                    rounded
                    data-test="progress-bar"
                  >
                    <div class="tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center">
                      <div class="text-caption tw:font-semibold tw:text-white tw:drop-shadow-sm">
                        {{ props.row.progress_percent }}%
                      </div>
                    </div>
                  </q-linear-progress>
                </div>
                <div v-if="props.row.chunks_total" class="text-caption text-grey-6 tw:whitespace-nowrap tw:pr-8">
                  {{ props.row.chunks_completed || 0 }}/{{ props.row.chunks_total }} chunks
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
              <div class="tw:flex tw:items-center tw:justify-center">
                <q-btn
                  v-if="canPauseJob(props.row.status)"
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="pause"
                  round
                  flat
                  @click="confirmPauseJob(props.row)"
                  data-test="pause-job-btn"
                >
                  <q-tooltip>Pause Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canResumeJob(props.row.status)"
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="play_arrow"
                  round
                  flat
                  @click="confirmResumeJob(props.row)"
                  data-test="resume-job-btn"
                >
                  <q-tooltip>Resume Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canEditJob(props.row.status)"
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="edit"
                  round
                  flat
                  @click="editJob(props.row)"
                  data-test="edit-job-btn"
                >
                  <q-tooltip>Edit Job</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="canDeleteJob(props.row.status)"
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="delete"
                  round
                  flat
                  @click="confirmDeleteJob(props.row)"
                  data-test="delete-job-btn"
                >
                  <q-tooltip>Delete Job</q-tooltip>
                </q-btn>
                <q-btn
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="info"
                  round
                  flat
                  @click="viewJob(props.row)"
                  data-test="view-job-btn"
                >
                  <q-tooltip>View Details</q-tooltip>
                </q-btn>
                <q-btn
                  v-if="props.row.error"
                  padding="sm"
                  unelevated
                  size="sm"
                  icon="error"
                  round
                  flat
                  color="negative"
                  @click="showErrorDialog(props.row)"
                  data-test="error-indicator-btn"
                >
                  <q-tooltip>Error: {{ props.row.error }}</q-tooltip>
                </q-btn>
              </div>
            </q-td>
          </template>

          <template v-slot:header="props">
              <q-tr :props="props">
                <!-- Rendering the rest of the columns -->
                <q-th
                  v-for="col in props.cols"
                  :key="col.name"
                  :props="props"
                  :class="col.classes"
                  :style="col.style"
                >
                  {{ col.label }}
                </q-th>
              </q-tr>
          </template>

          <!-- Bottom Pagination -->
          <template #bottom="scope">
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="filteredJobs.length"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </template>
        </q-table>
        </div>
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

    <!-- Confirm Dialogs -->
    <ConfirmDialog
      ref="confirmPauseDialogRef"
      title="Pause Backfill Job"
      :message="`Are you sure you want to pause the backfill job for &quot;${selectedJobForAction?.pipeline_name || selectedJobForAction?.pipeline_id}&quot;? You can resume it later.`"
      @confirm="pauseJob(selectedJobForAction!.job_id)"
    />

    <ConfirmDialog
      ref="confirmResumeDialogRef"
      title="Resume Backfill Job"
      :message="`Are you sure you want to resume the backfill job for &quot;${selectedJobForAction?.pipeline_name || selectedJobForAction?.pipeline_id}&quot;?`"
      @confirm="resumeJob(selectedJobForAction!.job_id)"
    />

    <ConfirmDialog
      ref="confirmDeleteDialogRef"
      title="Delete Backfill Job"
      :message="`Are you sure you want to delete the backfill job for &quot;${selectedJobForAction?.pipeline_name || selectedJobForAction?.pipeline_id}&quot;? This will remove the job from the list but will not affect the backfilled data.`"
      @confirm="deleteJob(selectedJobForAction!.job_id)"
    />
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import BackfillJobDetails from "./BackfillJobDetails.vue";
import EditBackfillJobDialog from "./EditBackfillJobDialog.vue";
import NoData from "../shared/grid/NoData.vue";
import QTablePagination from "../shared/grid/Pagination.vue";
import ConfirmDialog from "../ConfirmDialog.vue";

const router = useRouter();
const $q = useQuasar();
const store = useStore();

// Refs
const qTableRef = ref();

const loading = ref(false);
const jobs = ref<BackfillJob[]>([]);
const showDetailsDialog = ref(false);
const selectedJobId = ref("");
const showEditDialog = ref(false);
const selectedJob = ref<BackfillJob | null>(null);
const errorDialogVisible = ref(false);
const errorDialogData = ref<BackfillJob | null>(null);

// Confirm dialogs
const confirmPauseDialogRef = ref();
const confirmResumeDialogRef = ref();
const confirmDeleteDialogRef = ref();
const selectedJobForAction = ref<BackfillJob | null>(null);

const filters = ref({
  status: null as string | null,
  pipelineId: null as any,
});

const pagination = ref({
  rowsPerPage: 20,
});

const selectedPerPage = ref(10);

const perPageOptions = [
  { label: "10", value: 10 },
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

const changePagination = (key:any) => {
  selectedPerPage.value = key.value;
  pagination.value.rowsPerPage = key.value;
  qTableRef.value?.setPagination(pagination.value);
};

const columns = [
  {
    name: "pipeline_name",
    label: "Pipeline",
    align: "left" as const,
    field: "pipeline_name",
    sortable: true,
  },
  {
    name: "time_range",
    label: "Time Range",
    align: "left" as const,
    field: "start_time",
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
    align: "center" as const,
    field: "actions",
    classes:'actions-column',
    style: 'width: 150px;',
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
  selectedJobForAction.value = job;
  confirmPauseDialogRef.value.show();
};

const confirmResumeJob = (job: BackfillJob) => {
  selectedJobForAction.value = job;
  confirmResumeDialogRef.value.show();
};

const confirmDeleteJob = (job: BackfillJob) => {
  selectedJobForAction.value = job;
  confirmDeleteDialogRef.value.show();
};

const pauseJob = async (jobId: string) => {
  try {
    await backfillService.enableBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
      enable: false,
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
    await backfillService.enableBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: jobId,
      enable: true,
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
