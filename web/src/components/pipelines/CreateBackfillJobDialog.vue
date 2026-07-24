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
    :title="t('pipeline.createBackfillJobTitle')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('pipeline.createBackfillJob')"
    form-id="create-backfill-form"
    @click:secondary="onCancel"
    data-test="create-backfill-job-dialog"
  >
    <template #header-left>
      <span
        class="font-semibold px-2 py-1 rounded-default inline-block text-badge-blue-soft-text bg-badge-blue-soft-bg"
      >
        {{ pipelineName }}
        <OTooltip v-if="pipelineName && pipelineName.length > 25" :content="pipelineName" />
      </span>
    </template>

    <div class="mx-6 my-3">
          <!-- Advanced Options + numeric ranges are form-owned. The time range is
               a form-owned field too (OFormDateTimeRange). `space-y-3` lives on the
               <form> (via OForm) so it spaces the sibling sections below — on the
               outer div it would no-op (the <form> is its only child). -->
          <OForm id="create-backfill-form" :form="form" class="space-y-3">
          <!-- Time Range Section (form-owned via OFormDateTimeRange). The label is
               rendered inline beside the picker (flex row); OFormDateTimeRange's
               built-in label stacks above the control, so it's omitted here. -->
          <div>
            <div class="flex items-center gap-4">
              <div class="text-sm font-medium whitespace-nowrap">
                {{ t('pipeline.timeRange') }} <span class="text-status-error-text">*</span>
              </div>
              <OFormDateTimeRange
                name="timerange"
                disable-relative
                min-date="1999/01/01"
                auto-apply
                data-test="time-range-picker"
              />
            </div>
            <div
              v-if="timerangeError"
              class="text-xs text-status-error-text mt-1"
            >
              {{ timerangeError }}
            </div>
          </div>

          <!-- Advanced Options -->
          <div class="collapsible-section flex flex-col transition-all overflow-hidden bg-card-glass-bg rounded-default shadow-[0_0_5px_1px_var(--color-hover-shadow)] border border-card-glass-border" data-test="advanced-options-section">
            <div
              class="section-header flex items-center justify-between px-4 py-3 cursor-pointer shrink-0 border-b border-border-default transition-all rounded-t-default select-none hover:bg-interactive-hover-bg active:bg-interactive-hover-bg"
              @click="showAdvanced = !showAdvanced"
            >
              <div class="flex items-center gap-2">
                <OIcon name="settings" size="md" />
                <span class="text-sm font-semibold">{{ t('pipeline.advancedOptions') }}</span>
              </div>
              <OButton
                variant="ghost-muted"
                size="icon-xs-sq"
                :title="showAdvanced ? 'Collapse' : 'Expand'"
                :icon-left="showAdvanced ? 'unfold-less' : 'unfold-more'"
                @click.stop="showAdvanced = !showAdvanced"
                class="opacity-50 transition-all duration-200 hover:opacity-100"
              />
            </div>
            <div v-show="showAdvanced" class="flex flex-col flex-1 overflow-hidden p-4">
              <div class="space-y-4">
              <!-- Chunk Period -->
              <div class="grid grid-cols-12 gap-4 items-start">
                <div class="col-span-5">
                  <div class="text-sm font-medium mb-1">
                    {{ t('pipeline.chunkPeriodMinutesLabel') }}
                  </div>
                  <div class="text-xs text-text-secondary">
                    {{ t('pipeline.chunkPeriodDescription') }}
                  </div>
                </div>
                <div class="col-span-7">
                  <OFormInput
                    name="chunkPeriodMinutes"
                    type="number"
                    :placeholder="String(scheduleFrequency || 60)"
                    data-test="chunk-period-input"
                  >
                    <template #icon-right>
                      <OIcon name="info-outline" size="sm" />
                        <OTooltip :content="t('pipeline.defaultChunkPeriodTooltip', { minutes: scheduleFrequency || 60 })" />
                    </template>
                  </OFormInput>
                </div>
              </div>

              <!-- Delay Between Chunks -->
              <div class="grid grid-cols-12 gap-4 items-start">
                <div class="col-span-5">
                  <div class="text-sm font-medium mb-1">
                    {{ t('pipeline.delayBetweenChunksLabel') }}
                  </div>
                  <div class="text-xs text-text-secondary">
                    {{ t('pipeline.delayBetweenChunksDescription') }}
                  </div>
                </div>
                <div class="col-span-7">
                  <OFormInput
                    name="delayBetweenChunks"
                    type="number"
                    :placeholder="t('pipeline.defaultDelaySecondsPlaceholder')"
                    data-test="delay-between-chunks-input"
                  >
                    <template #icon-right>
                      <OIcon name="info-outline" size="sm" />
                        <OTooltip :content="t('pipeline.defaultDelayTooltip')" />
                    </template>
                  </OFormInput>
                </div>
              </div>

              <!-- Delete Before Backfill -->
              <div class="pt-2">
                <OFormCheckbox
                  name="deleteBeforeBackfill"
                  :label="t('pipeline.deleteDataBeforeBackfill')"
                  data-test="delete-before-backfill-checkbox"
                  class="font-medium"
                />
                <div
                  v-if="deleteBeforeBackfill"
                  class="mt-3 p-4 rounded-default border bg-banner-warning-bg border-banner-warning-border"
                >
                  <div class="flex items-start gap-3">
                    <OIcon name="warning" size="md" class="mt-0.5 text-banner-warning-text" />
                    <div>
                      <div class="font-semibold mb-2 text-banner-warning-text">{{ t('pipeline.irreversibleDeletionWarning') }}</div>
                      <div class="text-xs mb-3 text-banner-warning-text">
                        {{ t('pipeline.deleteBackfillWarningMessage') }}
                      </div>
                      <div class="font-semibold text-sm mb-1 text-banner-warning-text">{{ t('pipeline.timeAlignmentRequirements') }}</div>
                      <ul class="text-xs ml-5 space-y-1 list-disc text-banner-warning-text">
                        <li><strong>{{ t('common.logs') }}</strong> {{ t('pipeline.logsHourBoundaryNote') }}</li>
                        <li><strong>{{ t('pipeline.metricsTracesLabel') }}</strong> {{ t('pipeline.dayBoundaryNote') }}</li>
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
            class="p-3 rounded-default border bg-banner-info-bg border-banner-info-border"
          >
            <div class="text-banner-info-text">
              <div class="flex items-center gap-2 font-medium mb-1">
                <OIcon name="schedule" size="sm" />
                <span>{{ t('pipeline.estimatedProcessingTime') }} {{ estimatedInfo.time }}</span>
              </div>
              <div v-if="estimatedInfo.chunks" class="text-xs ml-6">
                {{ t('pipeline.estimatedChunks') }} {{ estimatedInfo.chunks }}
              </div>
            </div>
          </div>

          <!-- Error Message -->
          <div v-if="errorMessage" class="text-status-error-text">
            <OIcon name="error" size="sm" class="mr-2" />
            {{ errorMessage }}
          </div>
          </OForm>
        </div>

        </ODrawer>

  <!-- Confirmation Dialog for Delete Before Backfill -->
  <ODialog data-test="create-backfill-job-delete-confirmation-dialog" v-model:open="showDeleteConfirmation" persistent size="sm"
    :title="t('pipeline.confirmDataDeletion')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('pipeline.yesDeleteAndBackfill')"
    primary-button-variant="destructive"
    :primary-button-loading="loading"
    @click:secondary="showDeleteConfirmation = false"
    @click:primary="confirmDelete"
  >
    <p class="mb-4">
      {{ t('pipeline.deleteBackfillConfirmMessage') }}
    </p>
    <p class="font-semibold text-status-error-text">
      {{ t('pipeline.actionCannotBeUndone') }}
    </p>
    <p class="mt-4">{{ t('pipeline.areYouSureProceed') }}</p>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
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
import { makeBackfillSchema, type BackfillForm } from "./backfillJob.schema";

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
const { t } = useI18n();

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
  schema: makeBackfillSchema(t),
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
