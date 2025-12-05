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
            <div class="tw-grid tw-grid-cols-2 tw-gap-4">
              <div>
                <div class="text-caption q-mb-xs">Start Time</div>
                <q-input
                  v-model="formData.startTime"
                  type="datetime-local"
                  outlined
                  dense
                  :rules="[
                    (val) => !!val || 'Start time is required',
                    validateStartTime,
                  ]"
                  data-test="start-time-input"
                />
              </div>
              <div>
                <div class="text-caption q-mb-xs">End Time</div>
                <q-input
                  v-model="formData.endTime"
                  type="datetime-local"
                  outlined
                  dense
                  :rules="[
                    (val) => !!val || 'End time is required',
                    validateEndTime,
                  ]"
                  data-test="end-time-input"
                />
              </div>
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

interface Props {
  modelValue: boolean;
  pipelineId: string;
  pipelineName: string;
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

const formData = ref({
  startTime: "",
  endTime: "",
  chunkPeriodMinutes: null as number | null,
  delayBetweenChunks: null as number | null,
  deleteBeforeBackfill: false,
});

// Validation functions
const validateStartTime = (val: string) => {
  if (!val) return true;
  if (!formData.value.endTime) return true;
  const start = new Date(val);
  const end = new Date(formData.value.endTime);
  return start < end || "Start time must be before end time";
};

const validateEndTime = (val: string) => {
  if (!val) return true;
  if (!formData.value.startTime) return true;
  const start = new Date(formData.value.startTime);
  const end = new Date(val);
  return end > start || "End time must be after start time";
};

// Calculate estimated processing info
const estimatedInfo = computed(() => {
  if (!formData.value.startTime || !formData.value.endTime) return null;

  const start = new Date(formData.value.startTime);
  const end = new Date(formData.value.endTime);
  const diffMs = end.getTime() - start.getTime();
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
    startTime: "",
    endTime: "",
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
  loading.value = true;

  try {
    // Convert datetime-local to ISO 8601 format
    const startTime = new Date(formData.value.startTime).toISOString();
    const endTime = new Date(formData.value.endTime).toISOString();

    const requestData = {
      start_time: startTime,
      end_time: endTime,
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
