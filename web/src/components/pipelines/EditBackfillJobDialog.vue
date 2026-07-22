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
    form-id="edit-backfill-form"
    @click:secondary="onCancel"
    data-test="edit-backfill-job-dialog"
  >
    <div>
      <!-- Advanced Options + numeric ranges + the time range are form-owned. -->
      <OForm id="edit-backfill-form" :form="form">
        <!-- Time Range Section (form-owned via OFormDateTimeRange). The label is
               rendered inline beside the picker (flex row) to match the Create
               dialog; OFormDateTimeRange's built-in label stacks, so it's omitted. -->
        <div>
          <div class="flex items-center gap-4">
            <div class="text-sm font-medium whitespace-nowrap">
              Time Range <span class="text-status-error-text">*</span>
            </div>
            <OFormDateTimeRange
              name="timerange"
              disable-relative
              min-date="1999/01/01"
              auto-apply
              data-test="time-range-picker"
            />
          </div>
          <div v-if="timerangeError" class="text-xs text-status-error-text mt-1">
            {{ timerangeError }}
          </div>
        </div>

        <!-- Advanced Options -->
        <OCollapsible
          class="mt-2"
          v-model="showAdvanced"
          icon="settings"
          label="Advanced Options"
          data-test="advanced-options-expansion"
        >
          <div class="p-3 space-y-2 mt-2">
            <!-- Chunk Period -->
            <div>
              <div class="text-xs mb-1">
                Chunk Period (minutes)
                <OIcon name="info-outline" size="sm" />
                <OTooltip content="Size of each processing chunk in minutes. Default: 60" />
              </div>
              <OFormInput
                name="chunkPeriodMinutes"
                type="number"
                placeholder="60"
                data-test="chunk-period-input"
              />
            </div>

            <!-- Delay Between Chunks -->
            <div>
              <div class="text-xs mb-1">
                Delay Between Chunks (seconds)
                <OIcon name="info-outline" size="sm" />
                <OTooltip content="Delay between processing chunks in seconds. Default: 5" />
              </div>
              <OFormInput
                name="delayBetweenChunks"
                type="number"
                placeholder="5"
                data-test="delay-between-chunks-input"
              />
            </div>

            <!-- Delete Before Backfill -->
            <div>
              <OFormCheckbox
                name="deleteBeforeBackfill"
                label="Delete existing data before backfill"
                data-test="delete-before-backfill-checkbox"
              />
              <div
                v-if="deleteBeforeBackfill"
                class="mt-2 p-3 rounded-default border bg-banner-warning-bg border-banner-warning-border"
              >
                <div class="flex items-start">
                  <OIcon name="warning" size="sm" class="mr-2 mt-0.5" />
                  <div class="text-xs text-banner-warning-text">
                    <div class="font-semibold mb-1">Warning: Irreversible Data Deletion</div>
                    <div class="mb-2">
                      This will permanently delete all data in the destination stream for the
                      specified time range before running the backfill. This action cannot be
                      undone.
                    </div>
                    <div class="font-semibold text-xs mb-1">Time Alignment Requirements (UTC):</div>
                    <ul class="ml-5 space-y-0.5 list-disc text-xs">
                      <li>
                        <strong>Logs</strong> streams: Times must align to hour boundaries in UTC
                        (e.g., 10:00:00, not 10:15:00)
                      </li>
                      <li>
                        <strong>Metrics/Traces</strong> streams: Times must align to day boundaries
                        in UTC (e.g., 00:00:00)
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </OCollapsible>

        <!-- Error Message -->
        <div v-if="errorMessage" class="text-status-error-text">
          <OIcon name="error" size="sm" class="mr-2" />
          {{ errorMessage }}
        </div>
      </OForm>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormDateTimeRange from "@/lib/forms/DateTime/OFormDateTimeRange.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import backfillService, { type BackfillJob } from "../../services/backfill";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { makeBackfillSchema, type BackfillForm } from "./backfillJob.schema";

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
const { t } = useI18n();

const { confirm } = useConfirmDialog();

const show = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit("update:modelValue", val),
});

const showAdvanced = ref(false);
const errorMessage = ref("");

// Typed dynamic defaults for the form-owned fields (seeded from props.job). The
// time range is an absolute range carrying the job's start/end (forces the
// picker to absolute mode + pre-fills it).
const backfillDefaults = computed(
  (): BackfillForm => ({
    timerange: {
      type: "absolute",
      from: props.job?.start_time,
      to: props.job?.end_time,
    },
    chunkPeriodMinutes: props.job?.chunk_period_minutes || null,
    delayBetweenChunks: props.job?.delay_between_chunks_secs || null,
    deleteBeforeBackfill: props.job?.delete_before_backfill || false,
  }),
);

// Blank defaults used by cancel/reset (the open-watch re-seeds from props.job).
const blankDefaults = (): BackfillForm => ({
  timerange: { type: "absolute", from: undefined, to: undefined },
  chunkPeriodMinutes: null,
  delayBetweenChunks: null,
  deleteBeforeBackfill: false,
});

// Rule ③ OWNER pattern: this component OWNS <OForm> and needs the live values
// for the delete-warning `v-if` + the update payload, so it creates the form
// here with useOForm and reads it reactively via form.useStore — a SINGLE
// source of truth (no mirror, no store.subscribe).
const form = useOForm<BackfillForm>({
  defaultValues: backfillDefaults.value,
  schema: makeBackfillSchema(t),
  onSubmit: (value) => onSubmit(value),
});

const deleteBeforeBackfill = form.useStore((s: any) => s.values.deleteBeforeBackfill);

// Surface the form-level `timerange` error (OFormDateTimeRange renders none).
const timerangeErrors = form.useStore((s: any) => s.fieldMeta?.timerange?.errors ?? []);
const timerangeError = computed(() =>
  timerangeErrors.value.length ? String(firstFieldError(timerangeErrors.value)) : "",
);

// Watch for dialog opening and job changes to re-seed the form from props.job
// (data arrives after mount, so reset on the next tick).
watch(
  () => [props.modelValue, props.job] as const,
  async ([isOpen, job]) => {
    if (isOpen && job) {
      await nextTick();
      form.reset(backfillDefaults.value);
    }
  },
  { immediate: true },
);

const resetForm = () => {
  showAdvanced.value = false;
  errorMessage.value = "";
  // Cancel/reset blanks the form-owned fields (the open-watch re-seeds them from
  // props.job on the next open).
  form.reset(blankDefaults());
};

const onCancel = () => {
  resetForm();
  show.value = false;
};

// @submit handler — OForm only calls it once the schema passes (the time-range
// cross-field guard + chunk/delay numeric ranges live in the schema). `value`
// is the validated, single-source-of-truth payload.
const onSubmit = async (value: BackfillForm) => {
  errorMessage.value = "";

  if (!props.job) {
    errorMessage.value = "No job selected";
    return;
  }

  // Show confirmation dialog if delete_before_backfill is enabled
  if (value.deleteBeforeBackfill) {
    const ok = await confirm({
      title: "Confirm Data Deletion",
      message:
        "You have selected to delete existing data before backfill. This will permanently delete all data in the destination stream for the specified time range. This action CANNOT be undone or cancelled once the job is updated. Are you sure you want to proceed?",
      confirmLabel: "Yes, Delete and Backfill",
      cancelLabel: "Cancel",
    });
    if (ok) {
      await updateBackfillJobRequest(value);
    }
  } else {
    await updateBackfillJobRequest(value);
  }
};

const updateBackfillJobRequest = async (value: BackfillForm) => {
  try {
    const chunkPeriodMinutes =
      value.chunkPeriodMinutes === null || value.chunkPeriodMinutes === undefined
        ? undefined
        : Number(value.chunkPeriodMinutes);
    const delayBetweenChunks =
      value.delayBetweenChunks === null || value.delayBetweenChunks === undefined
        ? undefined
        : Number(value.delayBetweenChunks);
    await backfillService.updateBackfillJob({
      org_id: store.state.selectedOrganization.identifier,
      pipeline_id: props.job!.pipeline_id,
      job_id: props.job!.job_id,
      data: {
        start_time: value.timerange!.from as number,
        end_time: value.timerange!.to as number,
        chunk_period_minutes: chunkPeriodMinutes,
        delay_between_chunks_secs: delayBetweenChunks,
        delete_before_backfill: !!value.deleteBeforeBackfill,
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
      error?.response?.data?.error || error?.message || "Failed to update backfill job";
  }
};
</script>
