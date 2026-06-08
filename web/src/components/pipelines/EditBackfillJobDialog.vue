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
  <ODialog
    v-model:open="show"
    size="sm"
    title="Edit Backfill Job"
    secondary-button-label="Cancel"
    primary-button-label="Update Job"
    :primary-button-loading="loading"
    @click:secondary="onCancel"
    @click:primary="onSubmit"
    data-test="edit-backfill-job-dialog"
  >
    <div id="edit-backfill-form">
          <!-- Time Range Section -->
          <div>
            <div class="tw:text-sm tw:font-medium tw:mb-2">
              Time Range <span class="text-red-600">*</span>
            </div>
            <date-time
              ref="dateTimeRef"
              auto-apply
              default-type="absolute"
              @on:date-change="updateDateTime"
              data-test="time-range-picker"
              disable-relative
              min-date="1999/01/01"
            />
            <div
              v-if="formData.startTimeMicros <= 0 || formData.endTimeMicros <= 0"
              class="tw:text-xs text-red-600 tw:mt-1"
            >
              Please select a valid time range
            </div>
          </div>

          <!-- Advanced Options -->
          <OCollapsible
            class="tw:mt-2"
            v-model="showAdvanced"
            icon="settings"
            label="Advanced Options"
            data-test="advanced-options-expansion"
          >
            <div class="tw:p-3 tw:space-y-2 tw:mt-2">
              <!-- Chunk Period -->
              <div>
                <div class="tw:text-xs tw:mb-1">
                  Chunk Period (minutes)
                  <OIcon name="info-outline" size="sm" />
                    <OTooltip content="Size of each processing chunk in minutes. Default: 60" />
                </div>
                <OInput
                  v-model="formData.chunkPeriodMinutes"
                  type="number"
                  placeholder="60"
                  :error="!!chunkPeriodError"
                  :error-message="chunkPeriodError"
                  @update:model-value="chunkPeriodError = ''"
                  data-test="chunk-period-input"
                />
              </div>

              <!-- Delay Between Chunks -->
              <div>
                <div class="tw:text-xs tw:mb-1">
                  Delay Between Chunks (seconds)
                  <OIcon name="info-outline" size="sm" />
                    <OTooltip content="Delay between processing chunks in seconds. Default: 5" />
                </div>
                <OInput
                  v-model="formData.delayBetweenChunks"
                  type="number"
                  placeholder="5"
                  :error="!!delayBetweenError"
                  :error-message="delayBetweenError"
                  @update:model-value="delayBetweenError = ''"
                  data-test="delay-between-chunks-input"
                />
              </div>

              <!-- Delete Before Backfill -->
              <div>
                <OCheckbox
                  v-model="formData.deleteBeforeBackfill"
                  label="Delete existing data before backfill"
                  data-test="delete-before-backfill-checkbox"
                />
                <div
                  v-if="formData.deleteBeforeBackfill"
                  class="tw-mt-2 tw-p-3 tw-bg-orange-100 tw-rounded tw-border tw-border-orange-300"
                >
                  <div class="tw:flex tw:items-start">
                    <OIcon name="warning" size="sm" class="tw:mr-2 tw-mt-0.5" />
                    <div class="tw:text-xs text-orange-800">
                      <div class="tw-font-semibold tw-mb-1">Warning: Irreversible Data Deletion</div>
                      <div class="tw-mb-2">
                        This will permanently delete all data in the destination stream for the specified time
                        range before running the backfill. This action cannot be undone.
                      </div>
                      <div class="tw-font-semibold tw-text-xs tw-mb-1">Time Alignment Requirements (UTC):</div>
                      <ul class="tw-ml-5 tw-space-y-0.5 tw-list-disc tw-text-xs">
                        <li><strong>Logs</strong> streams: Times must align to hour boundaries in UTC (e.g., 10:00:00, not 10:15:00)</li>
                        <li><strong>Metrics/Traces</strong> streams: Times must align to day boundaries in UTC (e.g., 00:00:00)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </OCollapsible>

      <!-- Error Message -->
      <div v-if="errorMessage" class="tw:text-red-500">
        <OIcon name="error" size="sm" class="tw:mr-2" />
        {{ errorMessage }}
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import backfillService, { type BackfillJob } from "../../services/backfill";
import DateTime from "@/components/DateTime.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";

interface Props {
  modelValue: boolean;
  job: BackfillJob | null;
}

interface Emits {
  (e: "update:modelValue", value: boolean): void;
  (e: "job-updated"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const store = useStore();

const { confirm } = useConfirmDialog();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const showAdvanced = ref(false);
const loading = ref(false);
const errorMessage = ref("");
const chunkPeriodError = ref("");
const delayBetweenError = ref("");
const dateTimeRef = ref<InstanceType<typeof DateTime> | null>(null);

const formData = ref({
  startTimeMicros: 0,
  endTimeMicros: 0,
  chunkPeriodMinutes: null as number | null,
  delayBetweenChunks: null as number | null,
  deleteBeforeBackfill: false,
});

// Watch for dialog opening and job changes to populate form
watch(
  () => [props.modelValue, props.job] as const,
  async ([isOpen, job]) => {
    if (isOpen && job) {
      formData.value = {
        startTimeMicros: job.start_time,
        endTimeMicros: job.end_time,
        chunkPeriodMinutes: job.chunk_period_minutes || null,
        delayBetweenChunks: job.delay_between_chunks_secs || null,
        deleteBeforeBackfill: job.delete_before_backfill || false,
      };

      // Wait for the next tick to ensure dateTimeRef is mounted
      await nextTick();

      // Set date time component with the job's time range
      if (dateTimeRef.value) {
        dateTimeRef.value.setCustomDate("absolute", {
          start: job.start_time / 1000, // Convert from microseconds to milliseconds
          end: job.end_time / 1000,
        });
      }
    }
  },
  { immediate: true }
);

// Handle datetime changes from the DateTime component
const updateDateTime = (value: any) => {
  formData.value.startTimeMicros = value.startTime;
  formData.value.endTimeMicros = value.endTime;
};

const resetForm = () => {
  formData.value = {
    startTimeMicros: 0,
    endTimeMicros: 0,
    chunkPeriodMinutes: null,
    delayBetweenChunks: null,
    deleteBeforeBackfill: false,
  };
  showAdvanced.value = false;
  errorMessage.value = "";
};

const onCancel = () => {
  resetForm();
  show.value = false;
};

const onSubmit = async () => {
  errorMessage.value = "";
  chunkPeriodError.value = "";
  delayBetweenError.value = "";

  // Validate optional numeric range fields
  let hasError = false;
  if (formData.value.chunkPeriodMinutes !== null && formData.value.chunkPeriodMinutes !== undefined &&
    (formData.value.chunkPeriodMinutes < 1 || formData.value.chunkPeriodMinutes > 1440)) {
    chunkPeriodError.value = "Must be between 1 and 1440";
    hasError = true;
  }
  if (formData.value.delayBetweenChunks !== null && formData.value.delayBetweenChunks !== undefined &&
    (formData.value.delayBetweenChunks < 1 || formData.value.delayBetweenChunks > 3600)) {
    delayBetweenError.value = "Must be between 1 and 3600";
    hasError = true;
  }
  if (hasError) return;

  if (!props.job) {
    errorMessage.value = "No job selected";
    return;
  }

  if (
    formData.value.startTimeMicros <= 0 ||
    formData.value.endTimeMicros <= 0
  ) {
    errorMessage.value = "Please select a valid time range";
    return;
  }

  if (formData.value.startTimeMicros >= formData.value.endTimeMicros) {
    errorMessage.value = "End time must be after start time";
    return;
  }

  // Show confirmation dialog if delete_before_backfill is enabled
  if (formData.value.deleteBeforeBackfill) {
    const ok = await confirm({
      title: "Confirm Data Deletion",
      message:
        "You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range. This action CANNOT be undone or cancelled once the job is updated. Are you sure you want to proceed?",
      confirmLabel: "Yes, Delete and Backfill",
      cancelLabel: "Cancel",
    });
    if (ok) {
      updateBackfillJobRequest();
    }
  } else {
    updateBackfillJobRequest();
  }
};

const updateBackfillJobRequest = async () => {
  loading.value = true;

  try {
    await backfillService.updateBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: props.job!.pipeline_id,
      job_id: props.job!.job_id,
      data: {
        start_time: formData.value.startTimeMicros,
        end_time: formData.value.endTimeMicros,
        chunk_period_minutes: formData.value.chunkPeriodMinutes || undefined,
        delay_between_chunks_secs: formData.value.delayBetweenChunks || undefined,
        delete_before_backfill: formData.value.deleteBeforeBackfill,
      },
    });

    toast({
      variant: "success",
      message: "Backfill job updated successfully",
    });

    emit("job-updated");
    show.value = false;
    resetForm();
  } catch (error: any) {
    console.error("Error updating backfill job:", error);
    errorMessage.value =
      error?.response?.data?.error ||
      error?.message ||
      "Failed to update backfill job";
  } finally {
    loading.value = false;
  }
};
</script>
