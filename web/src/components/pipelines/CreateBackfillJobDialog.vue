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
    data-test="create-backfill-job-dialog"
  >
    <q-card class="tw-w-full" style="width: 600px">
      <q-card-section class="q-pa-md">
        <div class="flex items-center justify-between">
          <div class="text-h6" data-test="dialog-title">
            Create Backfill Job for {{ pipelineName }}
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
                  :placeholder="String(scheduleFrequency || 60)"
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

          <!-- Estimated Info -->
          <div
            v-if="estimatedInfo"
            class="tw-p-3 tw-bg-blue-50 tw-rounded tw-border tw-border-blue-200"
          >
            <div class="text-caption text-blue-800">
              <div>Estimated Processing Time: {{ estimatedInfo.time }}</div>
              <div v-if="estimatedInfo.chunks">
                Estimated Chunks: {{ estimatedInfo.chunks }}
              </div>
            </div>
          </div>

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
              label="Create Backfill Job"
              color="primary"
              :loading="loading"
              :disable="loading"
              data-test="create-btn"
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
import backfillService from "../../services/backfill";
import DateTime from "@/components/DateTime.vue";

interface Props {
  modelValue: boolean;
  pipelineId: string;
  pipelineName: string;
  scheduleFrequency?: number; // Pipeline schedule frequency in minutes
}

interface Emits {
  (e: "update:modelValue", value: boolean): void;
  (e: "success", jobId: string): void;
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
  chunkPeriodMinutes: (props.scheduleFrequency || 60) as number | null,
  delayBetweenChunks: null as number | null,
  deleteBeforeBackfill: false,
});

// Handle datetime changes from the DateTime component
const updateDateTime = (value: any) => {
  formData.value.startTimeMicros = value.startTime;
  formData.value.endTimeMicros = value.endTime;
};

// Calculate estimated processing info
const estimatedInfo = computed(() => {
  if (!formData.value.startTimeMicros || !formData.value.endTimeMicros) return null;

  // Convert microseconds to milliseconds
  const diffMs = (formData.value.endTimeMicros - formData.value.startTimeMicros) / 1000;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes <= 0) return null;

  const chunkPeriod = formData.value.chunkPeriodMinutes || 60;
  const chunks = Math.ceil(diffMinutes / chunkPeriod);
  const delaySeconds = formData.value.delayBetweenChunks || 5;
  const estimatedSeconds = chunks * delaySeconds;

  const hours = Math.floor(estimatedSeconds / 3600);
  const minutes = Math.floor((estimatedSeconds % 3600) / 60);

  let timeStr = "";
  if (hours > 0) timeStr += `${hours}h `;
  if (minutes > 0 || hours === 0) timeStr += `${minutes}m`;

  return {
    time: timeStr.trim() || "< 1m",
    chunks,
  };
});

// Watch for pipeline changes to reset form
watch(
  () => props.pipelineId,
  () => {
    resetForm();
  }
);

const resetForm = () => {
  formData.value = {
    startTimeMicros: 0,
    endTimeMicros: 0,
    chunkPeriodMinutes: (props.scheduleFrequency || 60) as number | null,
    delayBetweenChunks: null,
    deleteBeforeBackfill: false,
  };
  showAdvanced.value = false;
  errorMessage.value = "";

  // Reset the DateTime component to default
  if (dateTimeRef.value) {
    dateTimeRef.value.resetTime("", "");
  }
};

const onCancel = () => {
  resetForm();
  show.value = false;
};

const onSubmit = async () => {
  // Validate time range
  if (formData.value.startTimeMicros <= 0 || formData.value.endTimeMicros <= 0) {
    $q.notify({
      type: "negative",
      message: "Please select a valid time range",
      timeout: 3000,
    });
    return;
  }

  if (formData.value.startTimeMicros >= formData.value.endTimeMicros) {
    $q.notify({
      type: "negative",
      message: "Start time must be before end time",
      timeout: 3000,
    });
    return;
  }

  // Show confirmation dialog if delete_before_backfill is enabled
  if (formData.value.deleteBeforeBackfill) {
    $q.dialog({
      title: "Confirm Data Deletion",
      message:
        "You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range. This action CANNOT be undone or cancelled once the job is created. Are you sure you want to proceed?",
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
      createBackfillJobRequest();
    });
  } else {
    createBackfillJobRequest();
  }
};

const createBackfillJobRequest = async () => {
  errorMessage.value = "";
  loading.value = true;

  try {
    const requestData = {
      start_time: formData.value.startTimeMicros,
      end_time: formData.value.endTimeMicros,
      ...(formData.value.chunkPeriodMinutes && {
        chunk_period_minutes: formData.value.chunkPeriodMinutes,
      }),
      ...(formData.value.delayBetweenChunks && {
        delay_between_chunks_secs: formData.value.delayBetweenChunks,
      }),
      delete_before_backfill: formData.value.deleteBeforeBackfill,
    };

    const response = await backfillService.createBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: props.pipelineId,
      data: requestData,
    });

    $q.notify({
      type: "positive",
      message: "Backfill job created successfully",
      timeout: 3000,
    });

    emit("success", response.job_id);
    resetForm();
    show.value = false;
  } catch (error: any) {
    console.error("Error creating backfill job:", error);
    errorMessage.value =
      error?.response?.data?.error ||
      error?.message ||
      "Failed to create backfill job";

    $q.notify({
      type: "negative",
      message: errorMessage.value,
      timeout: 5000,
    });
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped lang="scss">
.text-h6 {
  font-size: 1.125rem;
  font-weight: 600;
}

.text-subtitle2 {
  font-size: 0.875rem;
  font-weight: 500;
}

.text-caption {
  font-size: 0.75rem;
  color: #666;
}
</style>
