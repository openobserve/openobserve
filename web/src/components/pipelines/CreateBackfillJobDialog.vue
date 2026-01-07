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
    <q-card class="tw-w-full tw:flex tw:flex-col" style="width: 600px; height: 100%;">
      <q-card-section class="q-pa-md tw:flex-shrink-0">
        <div class="flex items-center justify-between">
          <div class="tw:flex tw:items-center tw:gap-2" data-test="dialog-title">
            <span class="text-h6">Create Backfill Job for</span>
            <span
              :class="[
                'text-h6 tw:font-bold tw:px-2 tw:py-1 tw:rounded-md tw:max-w-xs tw:truncate tw:inline-block',
                $q.dark.isActive
                  ? 'tw:text-blue-400 tw:bg-blue-900/50'
                  : 'tw:text-blue-600 tw:bg-blue-50'
              ]"
            >
              {{ pipelineName }}
              <q-tooltip v-if="pipelineName && pipelineName.length > 25" class="tw:text-xs">
                {{ pipelineName }}
              </q-tooltip>
            </span>
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

      <q-card-section class="q-pa-md tw:flex-1 tw:overflow-y-auto">
        <div class="tw:space-y-6">
          <!-- Time Range Section -->
          <div>
            <div class="tw:flex tw:items-center tw:gap-4">
              <div class="text-subtitle2 tw:whitespace-nowrap">
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
            </div>
            <div
              v-if="formData.startTimeMicros <= 0 || formData.endTimeMicros <= 0"
              class="text-caption text-red-600 q-mt-xs"
            >
              Please select a valid time range
            </div>
          </div>

          <!-- Advanced Options -->
          <div class="collapsible-section card-container" data-test="advanced-options-section">
            <div
              class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
              @click="showAdvanced = !showAdvanced"
            >
              <div class="tw:flex tw:items-center tw:gap-2">
                <q-icon name="settings" size="20px" />
                <span class="tw:text-sm tw:font-semibold">Advanced Options</span>
              </div>
              <q-btn
                flat
                dense
                round
                size="xs"
                :icon="showAdvanced ? 'expand_less' : 'expand_more'"
                @click.stop
                class="expand-toggle-btn"
              />
            </div>
            <div v-show="showAdvanced" class="section-content">
              <div class="tw:space-y-4">
              <!-- Chunk Period -->
              <div class="tw:grid tw:grid-cols-12 tw:gap-4 tw:items-start">
                <div class="tw:col-span-5">
                  <div class="text-subtitle2 tw:mb-1">
                    Chunk Period (minutes)
                  </div>
                  <div :class="['text-caption', $q.dark.isActive ? 'tw:text-gray-400' : 'tw:text-gray-600']">
                    Size of each processing chunk
                  </div>
                </div>
                <div class="tw:col-span-7">
                  <q-input
                    v-model.number="formData.chunkPeriodMinutes"
                    type="number"
                    borderless
                    dense
                    :placeholder="String(scheduleFrequency || 60)"
                    :rules="[(val) => !val || (val >= 1 && val <= 1440) || 'Must be between 1 and 1440']"
                    data-test="chunk-period-input"
                  >
                    <template v-slot:append>
                      <q-icon name="info_outline" size="18px" color="grey-6">
                        <q-tooltip class="tw:text-xs">
                          Default: {{ scheduleFrequency || 60 }} minutes
                        </q-tooltip>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
              </div>

              <!-- Delay Between Chunks -->
              <div class="tw:grid tw:grid-cols-12 tw:gap-4 tw:items-start">
                <div class="tw:col-span-5">
                  <div class="text-subtitle2 tw:mb-1">
                    Delay Between Chunks (seconds)
                  </div>
                  <div :class="['text-caption', $q.dark.isActive ? 'tw:text-gray-400' : 'tw:text-gray-600']">
                    Wait time between processing chunks
                  </div>
                </div>
                <div class="tw:col-span-7">
                  <q-input
                    v-model.number="formData.delayBetweenChunks"
                    type="number"
                    borderless
                    dense
                    placeholder="5"
                    :rules="[(val) => !val || (val >= 1 && val <= 3600) || 'Must be between 1 and 3600']"
                    data-test="delay-between-chunks-input"
                  >
                    <template v-slot:append>
                      <q-icon name="info_outline" size="18px" color="grey-6">
                        <q-tooltip class="tw:text-xs">
                          Default: 5 seconds
                        </q-tooltip>
                      </q-icon>
                    </template>
                  </q-input>
                </div>
              </div>

              <!-- Delete Before Backfill -->
              <div class="tw:pt-2">
                <q-checkbox
                  v-model="formData.deleteBeforeBackfill"
                  label="Delete existing data before backfill"
                  data-test="delete-before-backfill-checkbox"
                  class="tw:font-medium"
                />
                <div
                  v-if="formData.deleteBeforeBackfill"
                  :class="[
                    'tw:mt-3 tw:p-4 tw:rounded-lg tw:border',
                    $q.dark.isActive
                      ? 'tw:bg-orange-900/20 tw:border-orange-700'
                      : 'tw:bg-orange-50 tw:border-orange-400'
                  ]"
                >
                  <div class="tw:flex tw:items-start tw:gap-3">
                    <q-icon name="warning" :color="$q.dark.isActive ? 'orange-4' : 'orange'" size="20px" class="tw:mt-0.5" />
                    <div>
                      <div :class="['tw:font-semibold tw:mb-2', $q.dark.isActive ? 'tw:text-orange-200' : 'tw:text-orange-900']">Warning: Irreversible Data Deletion</div>
                      <div :class="['text-caption tw:mb-3', $q.dark.isActive ? 'tw:text-orange-300' : 'tw:text-orange-800']">
                        This will permanently delete all data in the destination stream for the specified time range before running the backfill. This action cannot be undone.
                      </div>
                      <div :class="['tw:font-semibold tw:text-sm tw:mb-1', $q.dark.isActive ? 'tw:text-orange-200' : 'tw:text-orange-900']">Time Alignment Requirements:</div>
                      <ul :class="['text-caption tw:ml-5 tw:space-y-1 tw:list-disc', $q.dark.isActive ? 'tw:text-orange-300' : 'tw:text-orange-800']">
                        <li><strong>Logs</strong> streams: Times must align to hour boundaries (e.g., 10:00:00, not 10:15:00)</li>
                        <li><strong>Metrics/Traces</strong> streams: Times must align to day boundaries (e.g., 00:00:00)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <!-- Estimated Info -->
          <div
            v-if="estimatedInfo"
            :class="[
              'tw:p-3 tw:rounded-lg tw:border',
              $q.dark.isActive
                ? 'tw:bg-blue-900/20 tw:border-blue-700'
                : 'tw:bg-blue-50 tw:border-blue-200'
            ]"
          >
            <div :class="$q.dark.isActive ? 'tw:text-blue-200' : 'tw:text-blue-800'">
              <div class="tw:flex tw:items-center tw:gap-2 tw:font-medium tw:mb-1">
                <q-icon name="schedule" size="18px" />
                <span>Estimated Processing Time: {{ estimatedInfo.time }}</span>
              </div>
              <div v-if="estimatedInfo.chunks" class="text-caption tw:ml-6">
                Estimated Chunks: {{ estimatedInfo.chunks }}
              </div>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="errorMessage" class="text-negative">
            <q-icon name="error" class="q-mr-sm" />
            {{ errorMessage }}
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <!-- Form Actions -->
      <q-card-actions class="q-pa-md tw:flex-shrink-0">
        <q-form @submit="onSubmit" class="tw:w-full">
          <div class="flex justify-end tw:gap-2">
            <q-btn
              flat
              label="Cancel"
              class="o2-secondary-button"
              @click="onCancel"
              data-test="cancel-btn"
            />
            <q-btn
              type="submit"
              label="Create Backfill Job"
              class="o2-primary-button"
              :loading="loading"
              :disable="loading"
              data-test="create-btn"
            />
          </div>
        </q-form>
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- Confirmation Dialog for Delete Before Backfill -->
  <q-dialog v-model="showDeleteConfirmation" persistent>
    <q-card style="min-width: 400px">
      <q-card-section class="tw:pb-2">
        <div class="text-h6">Confirm Data Deletion</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <p class="tw:mb-4">
          You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range.
        </p>
        <p class="tw:font-semibold tw:text-red-600">
          This action CANNOT be undone or cancelled once the job is created.
        </p>
        <p class="tw:mt-4">Are you sure you want to proceed?</p>
      </q-card-section>

      <q-card-actions align="right" class="q-px-md q-pb-md">
        <q-btn
          flat
          label="Cancel"
          class="o2-secondary-button"
          @click="showDeleteConfirmation = false"
          data-test="delete-confirm-cancel-btn"
          autofocus
        />
        <q-btn
          unelevated
          label="Yes, Delete and Backfill"
          class="o2-primary-button"
          @click="confirmDelete"
          data-test="delete-confirm-yes-btn"
        />
      </q-card-actions>
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
const showDeleteConfirmation = ref(false);
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
    showDeleteConfirmation.value = true;
  } else {
    createBackfillJobRequest();
  }
};

const confirmDelete = () => {
  showDeleteConfirmation.value = false;
  createBackfillJobRequest();
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
      error?.response?.data?.message ||
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
}

// Advanced Options Collapsible Styling - matching AlertWizardRightColumn.vue
.collapsible-section {
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 5px 1px var(--o2-hover-shadow);
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
  overflow: hidden;

  .section-header {
    flex-shrink: 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    transition: all 0.2s ease;
    border-radius: 0.375rem 0.375rem 0 0;
    user-select: none;

    &:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    &:active {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .section-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 16px;
  }

  .expand-toggle-btn {
    opacity: 0.5;
    transition: all 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
