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
  <ODrawer
    v-model:open="show"
    :width="40"
    title="Backfill Job Details"
    data-test="backfill-job-details-dialog"
  >

    <div v-if="loading" class="tw:flex tw:justify-center tw:p-4">
      <OSpinner size="lg" />
    </div>

    <div v-else-if="job" class="tw:flex tw:flex-col tw:gap-5 tw:px-6 tw:py-4">
          <!-- Status and Actions -->
          <div class="tw:flex tw:items-center tw:justify-between">
            <OBadge
              :variant="getStatusColor(job.status, job.deletion_status)"
              size="md"
            >
              {{ getStatusLabel(job.status, job.deletion_status) }}
            </OBadge>
            <OButton
              v-if="canCancelJob"
              variant="outline-destructive"
              size="sm-action"
              @click="confirmCancelJob"
              data-test="cancel-job-btn"
            >Cancel Job</OButton>
          </div>

          <!-- Job Information -->
          <section class="tw:flex tw:flex-col tw:gap-3">
            <h3 class="tw:text-base tw:font-semibold">Job Information</h3>
            <div class="tw:grid tw:grid-cols-2 tw:gap-x-6 tw:gap-y-3 tw:rounded-md tw:border tw:border-card-border tw:bg-card-bg tw:p-4">
              <div>
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Job ID</div>
                <div class="tw:font-mono tw:text-sm tw:break-all">{{ job.job_id }}</div>
              </div>
              <div>
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Pipeline</div>
                <div class="tw:text-sm tw:font-medium">{{ job.pipeline_name || job.pipeline_id }}</div>
              </div>
              <div>
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Time Range</div>
                <div class="tw:text-sm">{{ formatTimestamp(job.start_time) }} – {{ formatTimestamp(job.end_time) }}</div>
              </div>
              <div>
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Created</div>
                <div class="tw:text-sm">{{ formatTimestampFull(job.created_at) }}</div>
              </div>
            </div>
          </section>

          <!-- Progress -->
          <section class="tw:flex tw:flex-col tw:gap-3">
            <h3 class="tw:text-base tw:font-semibold">Progress</h3>
            <div class="tw:rounded-md tw:border tw:border-card-border tw:bg-card-bg tw:p-4 tw:flex tw:flex-col tw:gap-4">
              <div>
                <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
                  <div class="tw:text-sm tw:font-medium">Overall Progress</div>
                  <div class="tw:text-xl tw:font-semibold">{{ job.progress_percent }}%</div>
                </div>
                <OProgressBar
                  :value="job.progress_percent / 100"
                  variant="default"
                  size="sm"
                />
              </div>

              <div class="tw:grid tw:grid-cols-2 tw:gap-x-6 tw:gap-y-3">
                <div>
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Phase</div>
                  <div class="tw:text-sm">{{ getCurrentPhase }}</div>
                </div>
                <div v-if="job.chunks_total">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Chunks</div>
                  <div class="tw:text-sm">{{ job.chunks_completed || 0 }} / {{ job.chunks_total }}</div>
                </div>
                <div>
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Current Position</div>
                  <div class="tw:text-sm">{{ formatTimestamp(job.current_position) }}</div>
                </div>
                <div v-if="estimatedCompletion">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Estimated Completion</div>
                  <div class="tw:text-sm">{{ estimatedCompletion }}</div>
                </div>
              </div>
            </div>
          </section>

          <!-- Deletion Details (if applicable) -->
          <section v-if="job.delete_before_backfill || job.deletion_status" class="tw:flex tw:flex-col tw:gap-3">
            <h3 class="tw:text-base tw:font-semibold">Deletion Details</h3>
            <div class="tw:rounded-md tw:border tw:border-card-border tw:bg-card-bg tw:p-4 tw:flex tw:flex-col tw:gap-3">
              <div class="tw:grid tw:grid-cols-2 tw:gap-x-6 tw:gap-y-3">
                <div>
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Status</div>
                  <OBadge :variant="getDeletionStatusColor(job.deletion_status)" size="sm">
                    {{ getDeletionStatusLabel(job.deletion_status) }}
                  </OBadge>
                </div>
                <div v-if="job.deletion_job_ids && job.deletion_job_ids.length > 0">
                  <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Deletion Job IDs ({{ job.deletion_job_ids.length }})</div>
                  <div v-for="(jobId, idx) in job.deletion_job_ids" :key="idx" class="tw:font-mono tw:text-xs tw:break-all">
                    {{ jobId }}
                  </div>
                </div>
              </div>
              <div v-if="typeof job.deletion_status === 'object' && job.deletion_status.failed">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Error</div>
                <div class="tw:text-sm tw:text-red-500">{{ job.deletion_status.failed }}</div>
              </div>
            </div>
          </section>

          <!-- Error Details (if present) -->
          <section v-if="job.error" class="tw:flex tw:flex-col tw:gap-3">
            <h3 class="tw:text-base tw:font-semibold">Error Details</h3>
            <div class="tw:rounded-md tw:border tw:border-red-300 tw:bg-red-50 tw:p-4 tw:flex tw:items-start tw:gap-3">
              <OIcon name="error" size="md" class="tw:text-red-500 tw:mt-0.5 tw:shrink-0" />
              <div class="tw:flex-1 tw:min-w-0">
                <div class="tw:text-xs tw:text-gray-400 tw:mb-1">Error Message</div>
                <div class="tw:text-sm tw:text-red-700 tw:whitespace-pre-wrap tw:break-words">
                  {{ job.error }}
                </div>
              </div>
            </div>
          </section>

          <!-- Timeline -->
          <section class="tw:flex tw:flex-col tw:gap-3">
            <h3 class="tw:text-base tw:font-semibold">Timeline</h3>
            <OTimeline>
              <OTimelineItem
                title="Job Created"
                :subtitle="formatTimestampFull(job.created_at)"
                icon="add-circle"
              />
              <OTimelineItem
                v-if="job.deletion_status && job.deletion_status !== 'not_required'"
                :title="getDeletionTimelineTitle"
                :subtitle="getDeletionTimelineSubtitle"
                :icon="getDeletionTimelineIcon"
                :variant="getDeletionTimelineColor"
              />
              <OTimelineItem
                v-if="job.progress_percent > 20 || (job.deletion_status === 'completed')"
                title="Backfill Started"
                :subtitle="getBackfillStartTime"
                icon="play-arrow"
              />
              <OTimelineItem
                v-if="job.status === 'running'"
                :title="`Processing Chunk ${job.chunks_completed || 0}/${job.chunks_total || 'N/A'}`"
                subtitle="In Progress"
                icon="hourglass-empty"
                variant="info"
              />
              <OTimelineItem
                v-if="job.status === 'completed'"
                title="Job Completed"
                subtitle="All data processed successfully"
                icon="check-circle"
                variant="success"
              />
              <OTimelineItem
                v-if="job.status === 'failed'"
                title="Job Failed"
                subtitle="An error occurred during processing"
                icon="error"
                variant="destructive"
              />
              <OTimelineItem
                v-if="job.status === 'canceled'"
                title="Job Canceled"
                subtitle="Job was canceled by user"
                icon="cancel"
                variant="muted"
              />
            </OTimeline>
          </section>
        </div>

    <div v-else class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:p-4">
      <OIcon name="error-outline" style="width: 64px; height: 64px;" />
      <div class="tw:text-xl tw:font-semibold tw:mt-3 tw:text-gray-400">Job not found</div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import backfillService, { type BackfillJob } from "../../services/backfill";
import { formatDistanceToNow } from "date-fns";
import { timestampToTimezoneDate } from "../../utils/zincutils";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

interface Props {
  modelValue: boolean;
  jobId: string;
  pipelineId: string;
}

interface Emits {
  (e: "update:modelValue", value: boolean): void;
  (e: "job-canceled"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const store = useStore();

const { confirm } = useConfirmDialog();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const loading = ref(false);
const job = ref<BackfillJob | null>(null);

const loadJobDetails = async () => {
  loading.value = true;

  try {
    const response = await backfillService.getBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: props.pipelineId,
      job_id: props.jobId,
    });
    job.value = response;
  } catch (error: any) {
    console.error("Error loading backfill job details:", error);
    job.value = null;
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.jobId,
  (newJobId) => {
    if (newJobId && props.modelValue) {
      loadJobDetails();
    }
  },
  { immediate: true }
);

watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue && props.jobId) {
      loadJobDetails();
    }
  }
);

const canCancelJob = computed(() => {
  return job.value && ["running", "pending"].includes(job.value.status);
});

const confirmCancelJob = async () => {
  const ok = await confirm({
    title: "Cancel Backfill Job",
    message: "Are you sure you want to cancel this backfill job?",
  });
  if (ok) {
    await cancelJob();
  }
};

const cancelJob = async () => {
  if (!job.value || !job.value.pipeline_id) {
    toast({
      variant: "error",
      message: "Job information not available. Please try again.",
    });
    return;
  }

  try {
    await backfillService.cancelBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: job.value.pipeline_id,
      job_id: job.value.job_id,
    });

    toast({
      variant: "success",
      message: "Backfill job canceled successfully",
    });

    emit("job-canceled");
    loadJobDetails();
  } catch (error: any) {
    console.error("Error canceling backfill job:", error);
    toast({
      variant: "error",
      message: error?.response?.data?.error || "Failed to cancel backfill job",
      timeout: 5000,
    });
  }
};

// Computed properties
const getCurrentPhase = computed(() => {
  if (!job.value) return "N/A";

  if (job.value.deletion_status) {
    const status = job.value.deletion_status;
    if (typeof status === "string" && ["pending", "in_progress"].includes(status)) {
      return "Deleting Data";
    }
    if (status === "completed") {
      return "Backfilling Data";
    }
    if (typeof status === "object" && "failed" in status) {
      return "Deletion Failed";
    }
  }

  if (job.value.progress_percent > 20) {
    return "Backfilling Data";
  }

  return "Initializing";
});

const estimatedCompletion = computed(() => {
  if (!job.value || job.value.status !== "running") return null;
  if (!job.value.chunks_total || !job.value.chunks_completed) return null;

  const remainingChunks = job.value.chunks_total - job.value.chunks_completed;
  const estimatedMinutes = remainingChunks * 1; // Rough estimate: 1 minute per chunk

  if (estimatedMinutes < 60) {
    return `~${estimatedMinutes}m`;
  }
  const hours = Math.floor(estimatedMinutes / 60);
  const minutes = estimatedMinutes % 60;
  return `~${hours}h ${minutes}m`;
});

const getDeletionTimelineTitle = computed(() => {
  if (!job.value?.deletion_status) return "";

  if (job.value.deletion_status === "completed") return "Deletion Completed";
  if (job.value.deletion_status === "in_progress") return "Deleting Data";
  if (job.value.deletion_status === "pending") return "Deletion Pending";
  if (typeof job.value.deletion_status === "object" && "failed" in job.value.deletion_status) {
    return "Deletion Failed";
  }
  return "";
});

const getDeletionTimelineSubtitle = computed(() => {
  if (!job.value?.deletion_status) return "";

  if (job.value.deletion_status === "completed") return "All existing data deleted";
  if (job.value.deletion_status === "in_progress") return "Deletion in progress";
  if (job.value.deletion_status === "pending") return "Waiting to start deletion";
  if (typeof job.value.deletion_status === "object" && "failed" in job.value.deletion_status) {
    return job.value.deletion_status.failed;
  }
  return "";
});

const getDeletionTimelineIcon = computed(() => {
  if (!job.value?.deletion_status) return "delete";

  if (job.value.deletion_status === "completed") return "delete-sweep";
  if (job.value.deletion_status === "in_progress") return "delete";
  if (job.value.deletion_status === "pending") return "schedule";
  return "error";
});

const getDeletionTimelineColor = computed<TimelineItemVariant>(() => {
  if (!job.value?.deletion_status) return "muted";

  if (job.value.deletion_status === "completed") return "success";
  if (job.value.deletion_status === "in_progress") return "info";
  if (job.value.deletion_status === "pending") return "primary";
  return "destructive";
});

const getBackfillStartTime = computed(() => {
  // This is approximate - would need actual timestamps from backend
  return "After deletion completed";
});

// Helper functions
const getStatusColor = (status: string, deletionStatus?: any): BadgeVariant => {
  if (deletionStatus && typeof deletionStatus === "object" && "failed" in deletionStatus) {
    return "error";
  }

  switch (status) {
    case "running":
      return "success";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "pending":
      return "warning";
    case "canceled":
      return "default";
    default:
      return "default";
  }
};

const getStatusLabel = (status: string, deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "object" && "failed" in deletionStatus) {
    return "Deletion Failed";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getProgressColor = (deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "string" && ["pending", "in_progress"].includes(deletionStatus)) {
    return "blue";
  }
  return "positive";
};

const getDeletionStatusColor = (status?: any): BadgeVariant => {
  if (!status) return "default";
  if (typeof status === "object" && "failed" in status) return "error";
  if (status === "completed") return "success";
  if (status === "in_progress") return "primary";
  if (status === "pending") return "warning";
  return "default";
};

const getDeletionStatusLabel = (status?: any) => {
  if (!status || status === "not_required") return "Not Required";
  if (typeof status === "object" && "failed" in status) return "Failed";
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In Progress";
  if (status === "pending") return "Pending";
  return "Unknown";
};

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return "N/A";
  const userTimezone = store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Convert from microseconds to milliseconds
  return timestampToTimezoneDate(timestamp / 1000, userTimezone, "MMM dd, yyyy HH:mm");
};

const formatTimestampFull = (timestamp?: number) => {
  if (!timestamp) return "N/A";
  const userTimezone = store.state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Date(timestamp / 1000); // Convert from microseconds
  const formattedDate = timestampToTimezoneDate(timestamp / 1000, userTimezone, "MMM dd, yyyy HH:mm:ss");
  const timezoneName = userTimezone === "UTC" ? "UTC" : userTimezone;
  return `${formattedDate} ${timezoneName} (${formatDistanceToNow(date, { addSuffix: true })})`;
};
</script>

