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
  <div
    data-test="backfill-jobs-list-page"
    class="flex flex-col h-full min-h-0"
  >
    <!-- Filters live in the shell header (Functions.vue #o2-page-actions),
         next to the "Pipelines › Backfill Jobs" breadcrumb.
         `defer` (Vue 3.5+) waits for the target to be rendered in the same
         tick — needed because #o2-page-actions is created by the parent shell
         (Functions.vue) which may not have fully rendered when this component
         mounts on initial page load. -->
    <Teleport to="#o2-page-actions" defer>
      <OSelect
        v-model="filters.status"
        :options="allStatusOptions"
        :placeholder="t('common.status')"
        clearable
        searchable
        class="w-37.5"
        data-test="status-filter"
      />
      <OSelect
        v-model="filters.pipelineId"
        :options="allPipelineOptions"
        labelKey="label"
        valueKey="value"
        :placeholder="t('pipeline.pipelineLabel')"
        clearable
        searchable
        class="w-62.5"
        data-test="pipeline-filter"
      />
      <OButton
        variant="outline"
        size="sm"
        @click="clearFilters"
        data-test="clear-filters-btn"
      >
        {{ t('pipeline.clearFilters') }}
      </OButton>
      <OTableColumnToggle
        :columns="columns"
        :column-visibility="columnVisibility"
        @update:column-visibility="setColumnVisibility"
      />
      <OButton
        variant="outline"
        size="icon-sm"
        class="shrink-0"
        @click="refreshJobs"
        :disabled="loading"
        data-test="refresh-btn"
        icon-left="refresh"
      >
        <OTooltip :content="t('common.refresh')" side="top" />
      </OButton>
    </Teleport>

    <!-- Jobs Table -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="rounded-default h-full">
          <OTable
            ref="qTableRef"
            :frame="false"
            :data="filteredJobs"
            :columns="columns"
            :column-visibility="columnVisibility"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="pipelines-backfill-jobs-list"
            row-key="job_id"
            :loading="loading"
            pagination="client"
            :page-size="selectedPerPage"
            :page-size-options="perPageOptionsList"
            sorting="client"
            filter-mode="client"
            :show-global-filter="false"
            width="100%"
            class="w-full h-full"
            data-test="backfill-jobs-table"
          >
            <!-- Empty State -->
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-backfill-jobs"
                :filtered="!!(filters.status || filters.pipelineId)"
                :hide-action="!(filters.status || filters.pipelineId)"
                @action="(id) => id === 'clear-filters' && ((filters.status = ''), (filters.pipelineId = ''))"
              />
            </template>

            <!-- Bottom footer -->
            <template #bottom="{ totalRows }">
              <div
                class="flex items-center text-xs font-normal mr-4 py-2"
              >
                {{ totalRows }} {{ t('pipeline.backfillJobLabel') }}{{ totalRows === 1 ? "" : "s" }}
              </div>
            </template>

            <!-- Pipeline Name Column -->
            <template #cell-pipeline_name="{ row }">
              <div class="font-medium">
                {{ row.pipeline_name || row.pipeline_id }}
              </div>
            </template>

            <!-- Time Range Column -->
            <template #cell-time_range="{ row }">
              <div class="text-xs">
                {{
                  formatTimeRange(row.start_time, row.end_time)
                }}
              </div>
            </template>

            <!-- Progress Column -->
            <template #cell-progress_percent="{ row }">
              <div class="flex items-center gap-2 w-full">
                <div class="flex-1 relative">
                  <OProgressBar
                    :value="row.progress_percent / 100"
                    variant="default"
                    size="lg"
                    data-test="progress-bar"
                  >
                    {{ row.progress_percent }}%
                  </OProgressBar>
                </div>
                <div
                  class="text-xs text-text-body whitespace-nowrap pr-2 w-24 shrink-0"
                >
                  <template v-if="row.chunks_total">
                    {{ row.chunks_completed || 0 }}/{{
                      row.chunks_total
                    }}
                    {{ t('pipeline.chunksUnit') }}
                  </template>
                </div>
              </div>
            </template>

            <!-- Created At Column -->
            <template #cell-created_at="{ row }">
              <OTimeCell
                :value="row.created_at"
                unit="us"
                :timezone="store.state.timezone"
                :empty-label="t('pipeline.notAvailable')"
              />
            </template>

            <!-- Last Triggered At Column -->
            <template #cell-last_triggered_at="{ row }">
              <OTimeCell
                :value="row.last_triggered_at"
                unit="us"
                mode="absolute"
                :timezone="store.state.timezone"
                :empty-label="t('pipeline.never')"
              />
            </template>

            <!-- Actions Column -->
            <template #cell-actions="{ row }">
              <div class="flex items-center justify-center">
                <OButton
                  v-if="canPauseJob(row)"
                  variant="ghost-destructive"
                  size="icon-sm"
                  @click="confirmPauseJob(row)"
                  data-test="pause-job-btn"
                  icon-left="pause"
                >
                  <OTooltip :content="t('pipeline.jobTooltipLabel')" />
                </OButton>
                <OButton
                  v-if="canResumeJob(row)"
                  variant="ghost-success"
                  size="icon-sm"
                  @click="confirmResumeJob(row)"
                  data-test="resume-job-btn"
                  icon-left="play-arrow"
                >
                  <OTooltip :content="t('pipeline.resumeJob')" />
                </OButton>
                <OButton
                  v-if="canEditJob(row.status)"
                  variant="ghost"
                  size="icon-sm"
                  @click="editJob(row)"
                  data-test="edit-job-btn"
                  icon-left="edit"
                >
                  <OTooltip :content="t('pipeline.editJob')" />
                </OButton>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  @click="viewJob(row)"
                  data-test="view-job-btn"
                  icon-left="visibility"
                >
                  <OTooltip :content="t('pipeline.viewDetails')" />
                </OButton>
                <OButton
                  v-if="canDeleteJob(row.status)"
                  variant="ghost-destructive"
                  size="icon-sm"
                  @click="confirmDeleteJob(row)"
                  data-test="delete-job-btn"
                  icon-left="delete"
                >
                  <OTooltip :content="t('pipeline.deleteJobTooltip')" />
                </OButton>
                <OButton
                  v-if="row.error"
                  variant="ghost-destructive"
                  size="icon-sm"
                  @click="showErrorDialog(row)"
                  data-test="error-indicator-btn"
                  icon-left="error"
                >
                  <OTooltip :content="`Error: ${row.error}`" />
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
    </div>

    <!-- Job Details Dialog -->
    <BackfillJobDetails
      v-model="showDetailsDialog"
      :job-id="selectedJobId"
      :pipeline-id="selectedPipelineId"
      @job-canceled="onJobCanceled"
    />

    <!-- Edit Job Dialog -->
    <EditBackfillJobDialog
      v-model="showEditDialog"
      :job="selectedJob"
      @job-updated="onJobUpdated"
    />

    <!-- Error Dialog -->
    <ODialog data-test="backfill-jobs-list-error-dialog"
      v-model:open="errorDialogVisible"
      size="md"
      :title="t('pipeline.backfillJobErrorTitle')"
      :primary-button-label="t('common.close')"
      @update:open="(v) => !v && closeErrorDialog()"
      @click:primary="errorDialogVisible = false; closeErrorDialog()"
    >
      <template #header-left>
        <OIcon name="error" size="sm" />
      </template>

      <div v-if="errorDialogData">
        <div class="mb-3">
          <div class="text-xs text-text-label">{{ t('pipeline.jobIdLabel') }}</div>
          <div class="text-sm font-medium">
            {{ errorDialogData.job_id }}
          </div>
        </div>

        <div class="mb-3">
          <div class="text-xs text-text-label">{{ t('pipeline.pipelineLabel') }}</div>
          <div class="text-sm">
            {{ errorDialogData.pipeline_name || errorDialogData.pipeline_id }}
          </div>
        </div>

        <div>
          <div class="text-xs text-text-label mb-2">{{ t('pipeline.errorMessageLabel') }}</div>
          <div class="p-3 rounded-default bg-banner-error-soft-bg border-l-[3px] border-l-status-negative font-mono text-compact leading-[1.6] whitespace-pre-wrap wrap-break-word text-banner-error-soft-text">
            {{ errorDialogData.error }}
          </div>
        </div>
      </div>

    </ODialog>

    <!-- Confirm Dialog -->
    <ConfirmDialog
      v-model="confirmDialog.show"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      @update:ok="confirmDialog.onConfirm"
      @update:cancel="resetConfirmDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTableColumnToggle from "@/lib/core/Table/sub-components/OTableColumnToggle.vue";
import useExternalColumnToggle from "@/composables/useExternalColumnToggle";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import BackfillJobDetails from "./BackfillJobDetails.vue";
import EditBackfillJobDialog from "./EditBackfillJobDialog.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import { timestampToTimezoneDate } from "../../utils/zincutils";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18n } from "vue-i18n";

const store = useStore();
const { t } = useI18n();

// Refs
const qTableRef = ref();

const loading = ref(false);
const jobs = ref<BackfillJob[]>([]);
const showDetailsDialog = ref(false);
const selectedJobId = ref("");
const selectedPipelineId = ref("");
const showEditDialog = ref(false);
const selectedJob = ref<BackfillJob | null>(null);
const errorDialogVisible = ref(false);
const errorDialogData = ref<BackfillJob | null>(null);

// Confirm dialog
const confirmDialog = ref({
  show: false,
  title: "",
  message: "",
  onConfirm: () => {},
});

const filters = ref({
  status: undefined as string | undefined,
  pipelineId: undefined as any,
});

const selectedPerPage = ref(10);

const perPageOptionsList = [10, 20, 50, 100];

const { columnVisibility, setColumnVisibility } = useExternalColumnToggle(
  "pipelines-backfill-jobs-list",
);

const columns: OTableColumnDef[] = [
  { id: "pipeline_name", header: "Pipeline", accessorKey: "pipeline_name", sortable: true, hideable: true, size: COL.streamName, meta: { align: "left", flex: true } },
  { id: "time_range", header: "Time Range", accessorKey: "start_time", sortable: true, hideable: true, size: COL.date, meta: { align: "left" } },
  { id: "progress_percent", header: "Progress", accessorKey: "progress_percent", sortable: true, hideable: true, size: 400, meta: { align: "left" } },
  { id: "created_at", header: "Created", accessorKey: "created_at", sortable: true, hideable: true, size: COL.createdAt, meta: { align: "left" } },
  { id: "last_triggered_at", header: "Last Triggered", accessorKey: "last_triggered_at", sortable: true, hideable: true, size: COL.dateAbsolute, meta: { align: "left" } },
  { id: "actions", header: "Actions", accessorKey: "actions", meta: { align: "center", actionCount: 4 }, isAction: true, size: 128 },
];

const allStatusOptions = ["running", "completed", "paused", "failed"];
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
    toast({
      variant: "error",
      message: "Failed to load backfill jobs",
    });
  } finally {
    loading.value = false;
  }
};

const loadPipelineOptions = () => {
  // Extract unique pipelines from jobs
  const pipelineMap = new Map(
    jobs.value.map((job) => [
      job.pipeline_id,
      {
        label: job.pipeline_name || job.pipeline_id,
        value: job.pipeline_id,
      },
    ]),
  );
  const uniquePipelines = Array.from(pipelineMap.values());

  allPipelineOptions.value = uniquePipelines;
  pipelineOptions.value = uniquePipelines;
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
    filtered = filtered.filter(
      (job) => job.pipeline_id === filters.value.pipelineId,
    );
  }

  return filtered;
});

const clearFilters = () => {
  filters.value = {
    status: undefined,
    pipelineId: undefined,
  };
};

const refreshJobs = () => {
  loadJobs();
};

const viewJob = (job: BackfillJob) => {
  selectedJobId.value = job.job_id;
  selectedPipelineId.value = job.pipeline_id;
  showDetailsDialog.value = true;
};

const editJob = (job: BackfillJob) => {
  selectedJob.value = job;
  showEditDialog.value = true;
};

const onJobUpdated = () => {
  loadJobs();
};

const canPauseJob = (job: BackfillJob) => {
  // Can pause if enabled and not completed/failed
  return job.enabled && job.status !== "completed" && job.status !== "failed";
};

const canResumeJob = (job: BackfillJob) => {
  // Can resume if disabled and not completed/failed
  return !job.enabled && job.status !== "completed" && job.status !== "failed";
};

const canEditJob = (status: string) => {
  return status === "paused" || status === "completed";
};

const canDeleteJob = (status: string) => {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "canceled" ||
    status === "paused"
  );
};

const resetConfirmDialog = () => {
  confirmDialog.value = {
    show: false,
    title: "",
    message: "",
    onConfirm: () => {},
  };
};

const confirmPauseJob = (job: BackfillJob) => {
  confirmDialog.value = {
    show: true,
    title: "Backfill Job",
    message: `Are you sure you want to pause the backfill job for "${job.pipeline_name || job.pipeline_id}"? You can resume it later.`,
    onConfirm: () => pauseJob(job.pipeline_id, job.job_id),
  };
};

const confirmResumeJob = (job: BackfillJob) => {
  confirmDialog.value = {
    show: true,
    title: "Resume Backfill Job",
    message: `Are you sure you want to resume the backfill job for "${job.pipeline_name || job.pipeline_id}"?`,
    onConfirm: () => resumeJob(job.pipeline_id, job.job_id),
  };
};

const confirmDeleteJob = (job: BackfillJob) => {
  confirmDialog.value = {
    show: true,
    title: "Delete Backfill Job",
    message: `Are you sure you want to delete the backfill job for "${job.pipeline_name || job.pipeline_id}"? This will remove the job from the list but will not affect the backfilled data.`,
    onConfirm: () => deleteJob(job.pipeline_id, job.job_id),
  };
};

const pauseJob = async (pipelineId: string, jobId: string) => {
  try {
    await backfillService.enableBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: pipelineId,
      job_id: jobId,
      enable: false,
    });

    toast({
      variant: "success",
      message: "Backfill job paused successfully",
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error pausing backfill job:", error);
    toast({
      variant: "error",
      message: error?.response?.data?.error || "Failed to pause backfill job",
      timeout: 5000,
    });
  }
};

const resumeJob = async (pipelineId: string, jobId: string) => {
  try {
    await backfillService.enableBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: pipelineId,
      job_id: jobId,
      enable: true,
    });

    toast({
      variant: "success",
      message: "Backfill job resumed successfully",
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error resuming backfill job:", error);
    toast({
      variant: "error",
      message: error?.response?.data?.error || "Failed to resume backfill job",
      timeout: 5000,
    });
  }
};

const deleteJob = async (pipelineId: string, jobId: string) => {
  try {
    await backfillService.deleteBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: pipelineId,
      job_id: jobId,
    });

    toast({
      variant: "success",
      message: "Backfill job deleted successfully",
    });

    loadJobs();
  } catch (error: any) {
    console.error("Error deleting backfill job:", error);
    toast({
      variant: "error",
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
const formatTimeRange = (startTime: number, endTime: number) => {
  const userTimezone =
    store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Convert from microseconds to milliseconds
  const start = timestampToTimezoneDate(
    startTime / 1000,
    userTimezone,
    "MMM dd, yyyy",
  );
  const end = timestampToTimezoneDate(
    endTime / 1000,
    userTimezone,
    "MMM dd, yyyy",
  );
  return `${start} - ${end}`;
};

</script>

