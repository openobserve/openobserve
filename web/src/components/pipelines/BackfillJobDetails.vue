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
  <q-dialog
    v-model="show"
    position="right"
    full-height
    maximized
    data-test="backfill-job-details-dialog"
  >
    <q-card class="tw-w-full" style="width: 700px">
      <q-card-section class="q-pa-md">
        <div class="flex items-center justify-between">
          <div class="text-h6" data-test="dialog-title">Backfill Job Details</div>
          <q-btn
            icon="close"
            flat
            round
            dense
            v-close-popup
            data-test="close-dialog-btn"
          />
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md" style="max-height: calc(100vh - 100px); overflow-y: auto">
        <div v-if="loading" class="flex justify-center q-pa-lg">
          <q-spinner color="primary" size="50px" />
        </div>

        <div v-else-if="job" class="tw-space-y-6">
          <!-- Status and Actions -->
          <div class="flex items-center justify-between">
            <q-badge
              :color="getStatusColor(job.status, job.deletion_status)"
              :label="getStatusLabel(job.status, job.deletion_status)"
              class="text-lg q-pa-sm"
            />
            <q-btn
              v-if="canCancelJob"
              label="Cancel Job"
              color="negative"
              outline
              @click="confirmCancelJob"
              data-test="cancel-job-btn"
            />
          </div>

          <!-- Job Information -->
          <div class="tw-space-y-3">
            <div class="text-subtitle1 tw-font-semibold">Job Information</div>
            <div class="tw-grid tw-grid-cols-2 tw-gap-4">
              <div>
                <div class="text-caption text-grey-6">Job ID</div>
                <div class="tw-font-mono text-sm">{{ job.job_id }}</div>
              </div>
              <div>
                <div class="text-caption text-grey-6">Pipeline</div>
                <div class="tw-font-medium">{{ job.pipeline_name || job.pipeline_id }}</div>
              </div>
              <div>
                <div class="text-caption text-grey-6">Time Range</div>
                <div class="text-sm">{{ formatTimestamp(job.start_time) }} - {{ formatTimestamp(job.end_time) }}</div>
              </div>
              <div>
                <div class="text-caption text-grey-6">Created</div>
                <div class="text-sm">{{ formatTimestampFull(job.created_at) }}</div>
              </div>
            </div>
          </div>

          <!-- Progress -->
          <div class="tw-space-y-3">
            <div class="text-subtitle1 tw-font-semibold">Progress</div>
            <q-card flat bordered class="q-pa-md">
              <div class="flex items-center justify-between q-mb-sm">
                <div class="tw-font-medium">Overall Progress</div>
                <div class="text-h6">{{ job.progress_percent }}%</div>
              </div>
              <q-linear-progress
                :value="job.progress_percent / 100"
                :color="getProgressColor(job.deletion_status)"
                size="12px"
                rounded
                class="q-mb-md"
              />

              <div class="tw-grid tw-grid-cols-2 tw-gap-4 text-sm">
                <div>
                  <div class="text-caption text-grey-6">Phase</div>
                  <div>{{ getCurrentPhase }}</div>
                </div>
                <div v-if="job.chunks_total">
                  <div class="text-caption text-grey-6">Chunks</div>
                  <div>{{ job.chunks_completed || 0 }} / {{ job.chunks_total }}</div>
                </div>
                <div>
                  <div class="text-caption text-grey-6">Current Position</div>
                  <div>{{ formatTimestamp(job.current_position) }}</div>
                </div>
                <div v-if="estimatedCompletion">
                  <div class="text-caption text-grey-6">Estimated Completion</div>
                  <div>{{ estimatedCompletion }}</div>
                </div>
              </div>
            </q-card>
          </div>

          <!-- Deletion Details (if applicable) -->
          <div v-if="job.delete_before_backfill || job.deletion_status" class="tw-space-y-3">
            <div class="text-subtitle1 tw-font-semibold">Deletion Details</div>
            <q-card flat bordered class="q-pa-md">
              <div class="tw-grid tw-grid-cols-2 tw-gap-4 text-sm">
                <div>
                  <div class="text-caption text-grey-6">Status</div>
                  <div>
                    <q-badge
                      :color="getDeletionStatusColor(job.deletion_status)"
                      :label="getDeletionStatusLabel(job.deletion_status)"
                    />
                  </div>
                </div>
                <div v-if="job.deletion_job_ids && job.deletion_job_ids.length > 0">
                  <div class="text-caption text-grey-6">Deletion Job IDs ({{ job.deletion_job_ids.length }})</div>
                  <div v-for="(jobId, idx) in job.deletion_job_ids" :key="idx" class="tw-font-mono text-xs">
                    {{ jobId }}
                  </div>
                </div>
              </div>
              <div v-if="typeof job.deletion_status === 'object' && job.deletion_status.failed" class="tw-mt-3">
                <div class="text-caption text-grey-6">Error</div>
                <div class="text-sm text-negative">{{ job.deletion_status.failed }}</div>
              </div>
            </q-card>
          </div>

          <!-- Error Details (if present) -->
          <div v-if="job.error" class="tw-space-y-3">
            <div class="text-subtitle1 tw-font-semibold">Error Details</div>
            <q-card flat bordered class="q-pa-md tw-bg-red-50 tw-border-red-200">
              <div class="flex items-start">
                <q-icon name="error" color="negative" size="24px" class="q-mr-sm tw-mt-1" />
                <div class="tw-flex-1">
                  <div class="text-caption text-grey-6 q-mb-xs">Error Message</div>
                  <div class="text-sm tw-text-red-800 tw-whitespace-pre-wrap tw-break-words">
                    {{ job.error }}
                  </div>
                </div>
              </div>
            </q-card>
          </div>

          <!-- Timeline -->
          <div class="tw-space-y-3">
            <div class="text-subtitle1 tw-font-semibold">Timeline</div>
            <q-timeline color="primary">
              <q-timeline-entry
                title="Job Created"
                :subtitle="formatTimestampFull(job.created_at)"
                icon="add_circle"
              />
              <q-timeline-entry
                v-if="job.deletion_status && job.deletion_status !== 'not_required'"
                :title="getDeletionTimelineTitle"
                :subtitle="getDeletionTimelineSubtitle"
                :icon="getDeletionTimelineIcon"
                :color="getDeletionTimelineColor"
              />
              <q-timeline-entry
                v-if="job.progress_percent > 20 || (job.deletion_status === 'completed')"
                title="Backfill Started"
                :subtitle="getBackfillStartTime"
                icon="play_arrow"
              />
              <q-timeline-entry
                v-if="job.status === 'running'"
                :title="`Processing Chunk ${job.chunks_completed || 0}/${job.chunks_total || 'N/A'}`"
                subtitle="In Progress"
                icon="hourglass_empty"
                color="blue"
              />
              <q-timeline-entry
                v-if="job.status === 'completed'"
                title="Job Completed"
                subtitle="All data processed successfully"
                icon="check_circle"
                color="positive"
              />
              <q-timeline-entry
                v-if="job.status === 'failed'"
                title="Job Failed"
                subtitle="An error occurred during processing"
                icon="error"
                color="negative"
              />
              <q-timeline-entry
                v-if="job.status === 'canceled'"
                title="Job Canceled"
                subtitle="Job was canceled by user"
                icon="cancel"
                color="grey"
              />
            </q-timeline>
          </div>
        </div>

        <div v-else class="flex flex-column items-center justify-center q-pa-lg">
          <q-icon name="error_outline" size="64px" color="grey-5" />
          <div class="text-h6 q-mt-md text-grey-7">Job not found</div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import { format, formatDistanceToNow } from "date-fns";

interface Props {
  modelValue: boolean;
  jobId: string;
}

interface Emits {
  (e: "update:modelValue", value: boolean): void;
  (e: "job-canceled"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const $q = useQuasar();
const store = useStore();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const loading = ref(false);
const job = ref<BackfillJob | null>(null);

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

const loadJobDetails = async () => {
  loading.value = true;

  try {
    const response = await backfillService.getBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
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

const canCancelJob = computed(() => {
  return job.value && ["running", "pending"].includes(job.value.status);
});

const confirmCancelJob = () => {
  $q.dialog({
    title: "Cancel Backfill Job",
    message: "Are you sure you want to cancel this backfill job?",
    cancel: true,
    persistent: true,
  }).onOk(async () => {
    await cancelJob();
  });
};

const cancelJob = async () => {
  if (!job.value) return;

  try {
    await backfillService.cancelBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: job.value.job_id,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job canceled successfully",
      timeout: 3000,
    });

    emit("job-canceled");
    loadJobDetails();
  } catch (error: any) {
    console.error("Error canceling backfill job:", error);
    $q.notify({
      type: "negative",
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

  if (job.value.deletion_status === "completed") return "delete_sweep";
  if (job.value.deletion_status === "in_progress") return "delete";
  if (job.value.deletion_status === "pending") return "schedule";
  return "error";
});

const getDeletionTimelineColor = computed(() => {
  if (!job.value?.deletion_status) return "grey";

  if (job.value.deletion_status === "completed") return "positive";
  if (job.value.deletion_status === "in_progress") return "blue";
  if (job.value.deletion_status === "pending") return "warning";
  return "negative";
});

const getBackfillStartTime = computed(() => {
  // This is approximate - would need actual timestamps from backend
  return "After deletion completed";
});

// Helper functions
const getStatusColor = (status: string, deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "object" && "failed" in deletionStatus) {
    return "negative";
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

  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getProgressColor = (deletionStatus?: any) => {
  if (deletionStatus && typeof deletionStatus === "string" && ["pending", "in_progress"].includes(deletionStatus)) {
    return "blue";
  }
  return "positive";
};

const getDeletionStatusColor = (status?: any) => {
  if (!status) return "grey";
  if (typeof status === "object" && "failed" in status) return "negative";
  if (status === "completed") return "positive";
  if (status === "in_progress") return "blue";
  if (status === "pending") return "warning";
  return "grey";
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
  const date = new Date(timestamp / 1000); // Convert from microseconds
  return format(date, "MMM dd, yyyy HH:mm");
};

const formatTimestampFull = (timestamp?: number) => {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp / 1000); // Convert from microseconds
  return `${format(date, "MMM dd, yyyy HH:mm:ss")} (${formatDistanceToNow(date, { addSuffix: true })})`;
};
</script>

<style scoped lang="scss">
.text-h6 {
  font-size: 1.125rem;
  font-weight: 600;
}

.text-subtitle1 {
  font-size: 1rem;
  font-weight: 500;
}

.text-caption {
  font-size: 0.75rem;
}
</style>
