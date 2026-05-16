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
    :width="47"
    title="Create Backfill Job for"
    secondary-button-label="Cancel"
    primary-button-label="Create Backfill Job"
    :primary-button-loading="loading"
    @click:secondary="onCancel"
    @click:primary="onSubmit"
    data-test="create-backfill-job-dialog"
  >
    <template #header-right>
      <span
        :class="[
          'text-h6 tw:font-bold tw:px-2 tw:py-1 tw:rounded-md tw:max-w-xs tw:truncate tw:inline-block',
          $q.dark.isActive
            ? 'tw:text-blue-400 tw:bg-blue-900/50'
            : 'tw:text-blue-600 tw:bg-blue-50'
        ]"
      >
        {{ pipelineName }}
        <OTooltip v-if="pipelineName && pipelineName.length > 25" :content="pipelineName" />
      </span>
    </template>

    <div class="tw:mx-6 tw:my-3 tw:space-y-3">
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
                <OIcon name="settings" size="md" />
                <span class="tw:text-sm tw:font-semibold">Advanced Options</span>
              </div>
              <OButton
                variant="ghost-muted"
                size="icon-xs-sq"
                :title="showAdvanced ? 'Collapse' : 'Expand'"
                :icon-left="showAdvanced ? 'unfold-less' : 'unfold-more'"
                @click.stop="showAdvanced = !showAdvanced"
                class="expand-toggle-btn-wrapper"
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
                  <OInput
                    v-model="formData.chunkPeriodMinutes"
                    type="number"
                    :placeholder="String(scheduleFrequency || 60)"
                    :error="!!chunkPeriodError"
                    :error-message="chunkPeriodError"
                    @update:model-value="chunkPeriodError = ''"
                    data-test="chunk-period-input"
                  >
                    <template #append>
                      <OIcon name="info-outline" size="sm">
                        <OTooltip content="Default: {{ scheduleFrequency || 60 }} minutes" />
                      </OIcon>
                    </template>
                  </OInput>
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
                  <OInput
                    v-model="formData.delayBetweenChunks"
                    type="number"
                    placeholder="5"
                    :error="!!delayBetweenError"
                    :error-message="delayBetweenError"
                    @update:model-value="delayBetweenError = ''"
                    data-test="delay-between-chunks-input"
                  >
                    <template #append>
                      <OIcon name="info-outline" size="sm">
                        <OTooltip content="Default: 5 seconds" />
                      </OIcon>
                    </template>
                  </OInput>
                </div>
              </div>

              <!-- Delete Before Backfill -->
              <div class="tw:pt-2">
                <OCheckbox
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
                    <OIcon name="warning" :color="$q.dark.isActive ? 'orange-4' : 'orange'" size="md" class="tw:mt-0.5" />
                    <div>
                      <div :class="['tw:font-semibold tw:mb-2', $q.dark.isActive ? 'tw:text-orange-200' : 'tw:text-orange-900']">Warning: Irreversible Data Deletion</div>
                      <div :class="['text-caption tw:mb-3', $q.dark.isActive ? 'tw:text-orange-300' : 'tw:text-orange-800']">
                        This will permanently delete all data in the destination stream for the specified time range before running the backfill. This action cannot be undone.
                      </div>
                      <div :class="['tw:font-semibold tw:text-sm tw:mb-1', $q.dark.isActive ? 'tw:text-orange-200' : 'tw:text-orange-900']">Time Alignment Requirements (UTC):</div>
                      <ul :class="['text-caption tw:ml-5 tw:space-y-1 tw:list-disc', $q.dark.isActive ? 'tw:text-orange-300' : 'tw:text-orange-800']">
                        <li><strong>Logs</strong> streams: Times must align to hour boundaries in UTC (e.g., 10:00:00, not 10:15:00)</li>
                        <li><strong>Metrics/Traces</strong> streams: Times must align to day boundaries in UTC (e.g., 00:00:00)</li>
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
                <OIcon name="schedule" size="sm" />
                <span>Estimated Processing Time: {{ estimatedInfo.time }}</span>
              </div>
              <div v-if="estimatedInfo.chunks" class="text-caption tw:ml-6">
                Estimated Chunks: {{ estimatedInfo.chunks }}
              </div>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="errorMessage" class="text-negative">
            <OIcon name="error" size="sm" class="q-mr-sm" />
            {{ errorMessage }}
          </div>
        </div>

        </ODrawer>

  <!-- Confirmation Dialog for Delete Before Backfill -->
  <ODialog data-test="create-backfill-job-delete-confirmation-dialog" v-model:open="showDeleteConfirmation" persistent size="sm"
    title="Confirm Data Deletion"
    secondary-button-label="Cancel"
    primary-button-label="Yes, Delete and Backfill"
    primary-button-variant="destructive"
    @click:secondary="showDeleteConfirmation = false"
    @click:primary="confirmDelete"
  >
    <p class="tw:mb-4">
      You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range.
    </p>
    <p class="tw:font-semibold tw:text-red-600">
      This action CANNOT be undone or cancelled once the job is created.
    </p>
    <p class="tw:mt-4">Are you sure you want to proceed?</p>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
const chunkPeriodError = ref("");
const delayBetweenError = ref("");
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
  chunkPeriodError.value = "";
  delayBetweenError.value = "";

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

  .expand-toggle-btn-wrapper {
    opacity: 0.5;
    transition: all 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
