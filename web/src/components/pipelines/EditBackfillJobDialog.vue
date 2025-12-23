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
    data-test="edit-backfill-job-dialog"
  >
    <q-card class="tw-w-full" style="width: 600px">
      <q-card-section class="q-pa-md">
        <div class="flex items-center justify-between">
          <div class="text-h6" data-test="dialog-title">
            Edit Backfill Job
          </div>
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

      <q-card-section class="q-pa-md">
        <q-form @submit="onSubmit" class="tw-space-y-4">
          <!-- Time Range Section -->
          <div>
            <div class="text-subtitle2 q-mb-sm">
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
              class="text-caption text-red-600 q-mt-xs"
            >
              Please select a valid time range
            </div>
          </div>

          <!-- Advanced Options -->
          <q-expansion-item
            v-model="showAdvanced"
            icon="settings"
            label="Advanced Options"
            data-test="advanced-options-expansion"
          >
            <q-card flat bordered class="q-pa-md tw-space-y-4">
              <!-- Chunk Period -->
              <div>
                <div class="text-caption q-mb-xs">
                  Chunk Period (minutes)
                  <q-icon name="info_outline" size="16px" color="grey-6">
                    <q-tooltip>
                      Size of each processing chunk in minutes. Default: 60
                    </q-tooltip>
                  </q-icon>
                </div>
                <q-input
                  v-model.number="formData.chunkPeriodMinutes"
                  type="number"
                  outlined
                  dense
                  placeholder="60"
                  :rules="[(val) => !val || (val >= 1 && val <= 1440) || 'Must be between 1 and 1440']"
                  data-test="chunk-period-input"
                />
              </div>

              <!-- Delay Between Chunks -->
              <div>
                <div class="text-caption q-mb-xs">
                  Delay Between Chunks (seconds)
                  <q-icon name="info_outline" size="16px" color="grey-6">
                    <q-tooltip>
                      Delay between processing chunks in seconds. Default: 5
                    </q-tooltip>
                  </q-icon>
                </div>
                <q-input
                  v-model.number="formData.delayBetweenChunks"
                  type="number"
                  outlined
                  dense
                  placeholder="5"
                  :rules="[(val) => !val || (val >= 1 && val <= 3600) || 'Must be between 1 and 3600']"
                  data-test="delay-between-chunks-input"
                />
              </div>

              <!-- Delete Before Backfill -->
              <div>
                <q-checkbox
                  v-model="formData.deleteBeforeBackfill"
                  label="Delete existing data before backfill"
                  data-test="delete-before-backfill-checkbox"
                />
                <div
                  v-if="formData.deleteBeforeBackfill"
                  class="tw-mt-2 tw-p-3 tw-bg-orange-100 tw-rounded tw-border tw-border-orange-300"
                >
                  <div class="flex items-start">
                    <q-icon name="warning" color="orange" class="q-mr-sm" />
                    <div class="text-caption text-orange-800">
                      <strong>Warning:</strong> This will permanently delete all
                      data in the destination stream for the specified time
                      range before running the backfill. This action cannot be
                      undone.
                    </div>
                  </div>
                </div>
              </div>
            </q-card>
          </q-expansion-item>

          <!-- Error Message -->
          <div v-if="errorMessage" class="text-negative">
            <q-icon name="error" class="q-mr-sm" />
            {{ errorMessage }}
          </div>

          <!-- Form Actions -->
          <div class="flex justify-end tw-gap-2 q-mt-md">
            <q-btn
              flat
              label="Cancel"
              color="grey-8"
              @click="onCancel"
              data-test="cancel-btn"
            />
            <q-btn
              type="submit"
              label="Update Job"
              color="primary"
              :loading="loading"
              :disable="loading"
              data-test="update-btn"
            />
          </div>
        </q-form>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import backfillService, { type BackfillJob } from "../../services/backfill";
import DateTime from "@/components/DateTime.vue";

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

const $q = useQuasar();
const store = useStore();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const showAdvanced = ref(false);
const loading = ref(false);
const errorMessage = ref("");
const dateTimeRef = ref<InstanceType<typeof DateTime> | null>(null);

const formData = ref({
  startTimeMicros: 0,
  endTimeMicros: 0,
  chunkPeriodMinutes: null as number | null,
  delayBetweenChunks: null as number | null,
  deleteBeforeBackfill: false,
});

// Watch for job changes to populate form
watch(
  () => props.job,
  (job) => {
    if (job) {
      formData.value = {
        startTimeMicros: job.start_time,
        endTimeMicros: job.end_time,
        chunkPeriodMinutes: job.chunk_period_minutes || null,
        delayBetweenChunks: job.delay_between_chunks_secs || null,
        deleteBeforeBackfill: job.delete_before_backfill || false,
      };

      // Set date time component
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
    $q.dialog({
      title: "Confirm Data Deletion",
      message:
        "You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range. This action CANNOT be undone or cancelled once the job is updated. Are you sure you want to proceed?",
      cancel: {
        label: "Cancel",
        color: "grey-8",
        flat: true,
      },
      ok: {
        label: "Yes, Delete and Backfill",
        color: "negative",
      },
      persistent: true,
      focus: "cancel", // Focus on cancel button by default for safety
    }).onOk(() => {
      updateBackfillJobRequest();
    });
  } else {
    updateBackfillJobRequest();
  }
};

const updateBackfillJobRequest = async () => {
  loading.value = true;

  try {
    await backfillService.updateBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      job_id: props.job!.job_id,
      data: {
        start_time: formData.value.startTimeMicros,
        end_time: formData.value.endTimeMicros,
        chunk_period_minutes: formData.value.chunkPeriodMinutes || undefined,
        delay_between_chunks_secs: formData.value.delayBetweenChunks || undefined,
        delete_before_backfill: formData.value.deleteBeforeBackfill,
      },
    });

    $q.notify({
      type: "positive",
      message: "Backfill job updated successfully",
      timeout: 3000,
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
