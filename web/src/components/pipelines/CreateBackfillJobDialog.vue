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
    form-id="create-backfill-form"
    @click:secondary="onCancel"
    data-test="create-backfill-job-dialog"
  >
    <template #header-left>
      <span
        :class="[
          'tw:font-semibold tw:px-2 tw:py-1 tw:rounded-md tw:inline-block',
          store.state.theme === 'dark'
            ? 'tw:text-blue-400 tw:bg-blue-900/50'
            : 'tw:text-blue-600 tw:bg-blue-50'
        ]"
      >
        {{ pipelineName }}
        <OTooltip v-if="pipelineName && pipelineName.length > 25" :content="pipelineName" />
      </span>
    </template>

    <div class="tw:mx-6 tw:my-3 tw:space-y-3">
          <!-- Advanced Options + numeric ranges are form-owned. The time range is
               a form-owned field too (OFormDateTimeRange). -->
          <OForm id="create-backfill-form" :form="form">
          <!-- Time Range Section (form-owned via OFormDateTimeRange). -->
          <div>
            <OFormDateTimeRange
              name="timerange"
              label="Time Range"
              required
              disable-relative
              min-date="1999/01/01"
              auto-apply
              data-test="time-range-picker"
            />
            <div
              v-if="timerangeError"
              class="tw:text-xs text-red-600 tw:mt-1"
            >
              {{ timerangeError }}
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
                  <div class="tw:text-sm tw:font-medium tw:mb-1">
                    Chunk Period (minutes)
                  </div>
                  <div :class="['tw:text-xs', store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600']">
                    Size of each processing chunk
                  </div>
                </div>
                <div class="tw:col-span-7">
                  <OFormInput
                    name="chunkPeriodMinutes"
                    type="number"
                    :placeholder="String(scheduleFrequency || 60)"
                    data-test="chunk-period-input"
                  >
                    <template #icon-right>
                      <OIcon name="info-outline" size="sm" />
                        <OTooltip content="Default: {{ scheduleFrequency || 60 }} minutes" />
                    </template>
                  </OFormInput>
                </div>
              </div>

              <!-- Delay Between Chunks -->
              <div class="tw:grid tw:grid-cols-12 tw:gap-4 tw:items-start">
                <div class="tw:col-span-5">
                  <div class="tw:text-sm tw:font-medium tw:mb-1">
                    Delay Between Chunks (seconds)
                  </div>
                  <div :class="['tw:text-xs', store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600']">
                    Wait time between processing chunks
                  </div>
                </div>
                <div class="tw:col-span-7">
                  <OFormInput
                    name="delayBetweenChunks"
                    type="number"
                    placeholder="5"
                    data-test="delay-between-chunks-input"
                  >
                    <template #icon-right>
                      <OIcon name="info-outline" size="sm" />
                        <OTooltip content="Default: 5 seconds" />
                    </template>
                  </OFormInput>
                </div>
              </div>

              <!-- Delete Before Backfill -->
              <div class="tw:pt-2">
                <OFormCheckbox
                  name="deleteBeforeBackfill"
                  label="Delete existing data before backfill"
                  data-test="delete-before-backfill-checkbox"
                  class="tw:font-medium"
                />
                <div
                  v-if="deleteBeforeBackfill"
                  :class="[
                    'tw:mt-3 tw:p-4 tw:rounded-lg tw:border',
                    store.state.theme === 'dark'
                      ? 'tw:bg-orange-900/20 tw:border-orange-700'
                      : 'tw:bg-orange-50 tw:border-orange-400'
                  ]"
                >
                  <div class="tw:flex tw:items-start tw:gap-3">
                    <OIcon name="warning" size="md" class="tw:mt-0.5 tw:text-orange-500 dark:tw:text-orange-400" />
                    <div>
                      <div :class="['tw:font-semibold tw:mb-2', store.state.theme === 'dark' ? 'tw:text-orange-200' : 'tw:text-orange-900']">Warning: Irreversible Data Deletion</div>
                      <div :class="['tw:text-xs tw:mb-3', store.state.theme === 'dark' ? 'tw:text-orange-300' : 'tw:text-orange-800']">
                        This will permanently delete all data in the destination stream for the specified time range before running the backfill. This action cannot be undone.
                      </div>
                      <div :class="['tw:font-semibold tw:text-sm tw:mb-1', store.state.theme === 'dark' ? 'tw:text-orange-200' : 'tw:text-orange-900']">Time Alignment Requirements (UTC):</div>
                      <ul :class="['tw:text-xs tw:ml-5 tw:space-y-1 tw:list-disc', store.state.theme === 'dark' ? 'tw:text-orange-300' : 'tw:text-orange-800']">
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
              store.state.theme === 'dark'
                ? 'tw:bg-blue-900/20 tw:border-blue-700'
                : 'tw:bg-blue-50 tw:border-blue-200'
            ]"
          >
            <div :class="store.state.theme === 'dark' ? 'tw:text-blue-200' : 'tw:text-blue-800'">
              <div class="tw:flex tw:items-center tw:gap-2 tw:font-medium tw:mb-1">
                <OIcon name="schedule" size="sm" />
                <span>Estimated Processing Time: {{ estimatedInfo.time }}</span>
              </div>
              <div v-if="estimatedInfo.chunks" class="tw:text-xs tw:ml-6">
                Estimated Chunks: {{ estimatedInfo.chunks }}
              </div>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="errorMessage" class="tw:text-red-500">
            <OIcon name="error" size="sm" class="tw:mr-2" />
            {{ errorMessage }}
          </div>
          </OForm>
        </div>

        </ODrawer>

  <!-- Confirmation Dialog for Delete Before Backfill -->
  <ODialog data-test="create-backfill-job-delete-confirmation-dialog" v-model:open="showDeleteConfirmation" persistent size="sm"
    title="Confirm Data Deletion"
    secondary-button-label="Cancel"
    primary-button-label="Yes, Delete and Backfill"
    primary-button-variant="destructive"
    :primary-button-loading="loading"
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
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import backfillService from "../../services/backfill";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { backfillSchema, type BackfillForm } from "./backfillJob.schema";

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

const store = useStore();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const showAdvanced = ref(false);
const showDeleteConfirmation = ref(false);
// `loading` only drives the delete-confirmation ODialog's primary button. The
// main create flow's spinner is form-driven (the form-id bridge mirrors the
// awaited onSubmit's isSubmitting onto the ODrawer footer).
const loading = ref(false);
const errorMessage = ref("");

// Typed dynamic defaults for the form-owned fields. The time range is an
// absolute range seeded empty (forces the picker to absolute mode).
const backfillDefaults = computed((): BackfillForm => ({
  timerange: { type: "absolute", from: undefined, to: undefined },
  chunkPeriodMinutes: (props.scheduleFrequency || 60) as number | null,
  delayBetweenChunks: null,
  deleteBeforeBackfill: false,
}));

// Rule ③ OWNER pattern: this component OWNS <OForm> and needs the live values
// (timerange/chunk/delay/deleteBeforeBackfill) for estimatedInfo + the delete
// warning `v-if`, so it creates the form here with useOForm and reads it
// reactively via form.useStore — a SINGLE source of truth (no mirror,
// no store.subscribe). The form is handed to <OForm :form="form">.
const form = useOForm<BackfillForm>({
  defaultValues: backfillDefaults.value,
  schema: backfillSchema,
  onSubmit: (value) => onSubmit(value),
});

const timerange = form.useStore((s: any) => s.values.timerange);
const formChunkPeriod = form.useStore((s: any) => s.values.chunkPeriodMinutes);
const formDelay = form.useStore((s: any) => s.values.delayBetweenChunks);
const deleteBeforeBackfill = form.useStore(
  (s: any) => s.values.deleteBeforeBackfill,
);

// Surface the form-level `timerange` error (OFormDateTimeRange renders none) —
// a reactive view of the SAME form, no mirror.
const timerangeErrors = form.useStore(
  (s: any) => s.fieldMeta?.timerange?.errors ?? [],
);
const timerangeError = computed(() =>
  timerangeErrors.value.length
    ? String(firstFieldError(timerangeErrors.value))
    : "",
);

// Calculate estimated processing info
const estimatedInfo = computed(() => {
  const from = timerange.value?.from;
  const to = timerange.value?.to;
  if (!from || !to) return null;

  // Convert microseconds to milliseconds
  const diffMs = (to - from) / 1000;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes <= 0) return null;

  const chunk = formChunkPeriod.value;
  const chunkPeriod =
    chunk === "" || chunk === null || chunk === undefined
      ? 60
      : Number(chunk) || 60;
  const chunks = Math.ceil(diffMinutes / chunkPeriod);
  const delay = formDelay.value;
  const delaySeconds =
    delay === "" || delay === null || delay === undefined
      ? 5
      : Number(delay) || 5;
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
  showAdvanced.value = false;
  errorMessage.value = "";

  // Reset the form-owned fields (including the time range) to their (current)
  // defaults.
  form.reset(backfillDefaults.value);
};

const onCancel = () => {
  resetForm();
  show.value = false;
};

// The validated value stashed for the delete-confirmation branch (so confirmDelete
// can save with the exact submitted payload).
const pendingValue = ref<BackfillForm | null>(null);

// @submit handler — OForm only calls it once the schema passes (the time-range
// cross-field guard + chunk/delay numeric ranges live in the schema), so the
// schema gates everything. `value` is the validated, single-source-of-truth
// payload.
const onSubmit = async (value: BackfillForm) => {
  pendingValue.value = value;
  // Show confirmation dialog if delete_before_backfill is enabled
  if (value.deleteBeforeBackfill) {
    showDeleteConfirmation.value = true;
  } else {
    await createBackfillJobRequest(value);
  }
};

const confirmDelete = async () => {
  showDeleteConfirmation.value = false;
  const value = pendingValue.value;
  if (!value) return;
  loading.value = true;
  try {
    await createBackfillJobRequest(value);
  } finally {
    loading.value = false;
  }
};

const createBackfillJobRequest = async (value: BackfillForm) => {
  errorMessage.value = "";

  try {
    const chunkPeriodMinutes =
      value.chunkPeriodMinutes === null || value.chunkPeriodMinutes === undefined
        ? null
        : Number(value.chunkPeriodMinutes);
    const delayBetweenChunks =
      value.delayBetweenChunks === null || value.delayBetweenChunks === undefined
        ? null
        : Number(value.delayBetweenChunks);
    const requestData = {
      start_time: value.timerange!.from as number,
      end_time: value.timerange!.to as number,
      ...(chunkPeriodMinutes && {
        chunk_period_minutes: chunkPeriodMinutes,
      }),
      ...(delayBetweenChunks && {
        delay_between_chunks_secs: delayBetweenChunks,
      }),
      delete_before_backfill: !!value.deleteBeforeBackfill,
    };

    const response = await backfillService.createBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: props.pipelineId,
      data: requestData,
    });

    toast({
      variant: "success",
      message: "Backfill job created successfully",
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

    toast({
      variant: "error",
      message: errorMessage.value,
      timeout: 5000,
    });
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
