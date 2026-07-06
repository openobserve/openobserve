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
    data-test="time-range-editor-dialog"
    :open="modelValue"
    @update:open="
      (v) => {
        $emit('update:modelValue', v);
        if (!v) handleClose();
      }
    "
    size="sm"
    form-id="time-range-editor-form"
    :title="t('correlation.logs.timeRange.title')"
    :secondary-button-label="t('common.cancel')"
    :neutral-button-label="t('common.reset')"
    :primary-button-label="t('common.apply')"
    @click:secondary="handleCancel"
    @click:neutral="handleReset"
  >
    <OForm id="time-range-editor-form" :form="form">
      <!-- Source Log Time -->
      <div class="mb-6">
        <div class="text-sm font-semibold mb-2">
          {{ t("correlation.logs.timeRange.sourceTime") }}
        </div>
        <div
          class="p-3 border border-solid border-[var(--o2-border-color)] rounded bg-surface-panel flex items-center gap-2"
        >
          <OIcon name="schedule" size="sm" />
          <span class="font-mono text-sm">{{
            formatTimestamp(sourceTimestamp)
          }}</span>
        </div>
      </div>

      <!-- Time Window Presets -->
      <div class="mb-6">
        <div class="text-sm font-semibold mb-3">
          {{ t("correlation.logs.timeRange.window") }}
        </div>

        <div class="space-y-2">
          <OFormRadioGroup name="selectedWindow" orientation="vertical">
            <ORadio
              val="1min"
              :label="t('correlation.logs.timeRange.minute1')"
              data-test="window-1min"
            />
            <ORadio
              val="5min"
              :label="t('correlation.logs.timeRange.minute5')"
              data-test="window-5min"
            />
            <ORadio
              val="15min"
              :label="t('correlation.logs.timeRange.minute15')"
              data-test="window-15min"
            />
            <ORadio
              val="30min"
              :label="t('correlation.logs.timeRange.minute30')"
              data-test="window-30min"
            />
            <ORadio
              val="1hour"
              :label="t('correlation.logs.timeRange.hour1')"
              data-test="window-1hour"
            />
            <ORadio
              val="custom"
              :label="t('correlation.logs.timeRange.custom')"
              data-test="window-custom"
            />
          </OFormRadioGroup>
        </div>
      </div>

      <!-- Custom Time Range Inputs (only shown when custom is selected) -->
      <div v-if="mSelectedWindow === 'custom'" class="mb-4 space-y-3">
        <div>
          <div class="text-sm font-semibold mb-2">
            {{ t("correlation.logs.timeRange.customStart") }}
          </div>
          <OFormInput
            name="customStartTime"
            type="datetime-local"
            data-test="custom-start-input"
          />
        </div>

        <div>
          <div class="text-sm font-semibold mb-2">
            {{ t("correlation.logs.timeRange.customEnd") }}
          </div>
          <OFormInput
            name="customEndTime"
            type="datetime-local"
            data-test="custom-end-input"
          />
        </div>
      </div>

      <!-- Current Range Display -->
    <div
      class="p-3 border border-solid border-[var(--o2-border-color)] rounded bg-blue-50"
    >
      <div class="text-xs font-semibold mb-2 opacity-70">
        {{ t("correlation.logs.timeRange.currentRange") }}
      </div>
      <div class="flex flex-col gap-1 text-sm">
        <div class="flex items-center gap-2">
          <span class="font-semibold"
            >{{ t("correlation.logs.timeRange.start") }}:</span
          >
          <span class="font-mono">{{
            formatTimestamp(pendingStartTime)
          }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-semibold"
            >{{ t("correlation.logs.timeRange.end") }}:</span
          >
          <span class="font-mono">{{
            formatTimestamp(pendingEndTime)
          }}</span>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <span class="font-semibold"
            >{{ t("correlation.logs.timeRange.duration") }}:</span
          >
          <span>{{ formatDuration(pendingEndTime - pendingStartTime) }}</span>
        </div>
      </div>
    </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { formatDate } from "@/utils/date";
import { timestampToTimezoneDate } from "@/utils/timezone";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import {
  makeTimeRangeEditorSchema,
  type TimeRangeEditorForm,
} from "./TimeRangeEditor.schema";

interface Props {
  modelValue: boolean;
  currentRange: { startTime: number; endTime: number };
  sourceTimestamp: number;
}

// Props & Emits
const props = defineProps<Props>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "update:range": [startTime: number, endTime: number];
  close: [];
}>();

// Composables
const { t } = useI18n();
const store = useStore();
const timeRangeEditorSchema = makeTimeRangeEditorSchema(t);

// Preset window half-widths (±) in microseconds.
const WINDOW_MICROS: Record<string, number> = {
  "1min": 1 * 60 * 1000 * 1000,
  "5min": 5 * 60 * 1000 * 1000,
  "15min": 15 * 60 * 1000 * 1000,
  "30min": 30 * 60 * 1000 * 1000,
  "1hour": 60 * 60 * 1000 * 1000,
};

/** Convert a datetime-local string to a microsecond timestamp. */
const datetimeToMicros = (datetime: string): number =>
  new Date(datetime).getTime() * 1000;

/** Convert a microsecond timestamp to datetime-local (minute precision). */
const microsToDatetime = (micros: number): string => {
  const ms = Math.floor(micros / 1000);
  return formatDate(ms, "YYYY-MM-DDTHH:mm");
};

/** Detect the preset window (or "custom") that produced a given range. Pure. */
const detectWindow = (
  range: { startTime: number; endTime: number },
  sourceTimestamp: number,
): string => {
  const duration = range.endTime - range.startTime;
  const center = (range.startTime + range.endTime) / 2;
  // Symmetric around the source timestamp (within 1 second tolerance)?
  const isSymmetric = Math.abs(center - sourceTimestamp) < 1000000;
  if (!isSymmetric) return "custom";

  const durationMinutes = duration / (60 * 1000 * 1000);
  if (Math.abs(durationMinutes - 2) < 0.1) return "1min"; // ±1 min
  if (Math.abs(durationMinutes - 10) < 0.1) return "5min"; // ±5 min
  if (Math.abs(durationMinutes - 30) < 0.1) return "15min"; // ±15 min
  if (Math.abs(durationMinutes - 60) < 0.1) return "30min"; // ±30 min
  if (Math.abs(durationMinutes - 120) < 0.1) return "1hour"; // ±1 hour
  return "custom";
};

// Dynamic (edit-prefill) defaults → a typed component computed. Seeds the
// detected window + the custom datetime inputs from the current range.
const timeRangeEditorDefaults = computed((): TimeRangeEditorForm => ({
  selectedWindow: detectWindow(props.currentRange, props.sourceTimestamp),
  customStartTime: microsToDatetime(props.currentRange.startTime),
  customEndTime: microsToDatetime(props.currentRange.endTime),
}));

// ── Owner-pattern form (Rule ③) ─────────────────────────────────────────────
// TimeRangeEditor OWNS the <OForm>, and its template needs form state to drive
// the custom-inputs v-if + the live "Current Range" preview. We create the form
// here with useOForm and read it reactively via form.useStore — ONE source of
// truth (no mirror ref / store.subscribe). Programmatic changes (reset / window)
// go THROUGH the form; the result is handed to <OForm :form="form">.
const form = useOForm<TimeRangeEditorForm>({
  defaultValues: timeRangeEditorDefaults.value,
  schema: timeRangeEditorSchema,
  onSubmit: handleApply,
});

// Reactive read-only views of the form-owned fields (NOT copies). useOForm
// keeps the form's TFormData generic, so cast the loose reads to the schema's
// string shape.
const mSelectedWindow = form.useStore((s) => s.values.selectedWindow as string);
const mCustomStart = form.useStore((s) => s.values.customStartTime as string);
const mCustomEnd = form.useStore((s) => s.values.customEndTime as string);

// Live preview range (microseconds), derived from the form-owned values:
//  • preset window → source ± window;
//  • custom → the custom datetime inputs (fall back to the current range while
//    a custom input is still blank).
const pendingStartTime = computed<number>(() => {
  if (mSelectedWindow.value === "custom") {
    return mCustomStart.value
      ? datetimeToMicros(mCustomStart.value)
      : props.currentRange.startTime;
  }
  return props.sourceTimestamp - (WINDOW_MICROS[mSelectedWindow.value] ?? 0);
});
const pendingEndTime = computed<number>(() => {
  if (mSelectedWindow.value === "custom") {
    return mCustomEnd.value
      ? datetimeToMicros(mCustomEnd.value)
      : props.currentRange.endTime;
  }
  return props.sourceTimestamp + (WINDOW_MICROS[mSelectedWindow.value] ?? 0);
});

/**
 * Format timestamp (microseconds) to human-readable format
 */
const formatTimestamp = (timestamp: number): string => {
  const ms = Math.floor(timestamp / 1000);
  return timestampToTimezoneDate(
    ms,
    store.state.timezone || "UTC",
    "yyyy-MM-dd HH:mm:ss.SSS",
  );
};

/**
 * Format duration (microseconds) to human-readable format
 */
const formatDuration = (durationMicros: number): string => {
  const durationMs = durationMicros / 1000;
  const durationSeconds = durationMs / 1000;

  if (durationSeconds < 60) {
    return `${Math.round(durationSeconds)} seconds`;
  } else if (durationSeconds < 3600) {
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = Math.round(durationSeconds % 60);
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} minutes`;
  } else {
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    return minutes > 0 ? `${hours} hour ${minutes} min` : `${hours} hours`;
  }
};

// Re-seed the form to the current range. `:default-values` is read once at
// mount, so re-seed explicitly on open + when currentRange changes while open.
const reseedForm = async () => {
  await nextTick();
  form.reset(timeRangeEditorDefaults.value);
};

/**
 * Apply handler — @submit fires only when the schema passes (custom → both
 * times present + start < end; presets always pass), so no manual gating.
 */
// Declared as a hoisted function so useOForm (above) can reference it.
function handleApply(value: TimeRangeEditorForm) {
  if (value.selectedWindow === "custom") {
    emit(
      "update:range",
      datetimeToMicros(value.customStartTime),
      datetimeToMicros(value.customEndTime),
    );
  } else {
    emit("update:range", pendingStartTime.value, pendingEndTime.value);
  }
  emit("update:modelValue", false);
}

/**
 * Handle cancel button click
 */
const handleCancel = () => {
  emit("update:modelValue", false);
  emit("close");
};

/**
 * Handle reset button click — reset to the ±5 minute preset (through the form).
 */
const handleReset = () => {
  form.setFieldValue("selectedWindow", "5min");
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  emit("close");
};

// Re-seed when the range changes while the dialog is open.
watch(
  () => props.currentRange,
  () => {
    if (props.modelValue) reseedForm();
  },
  { deep: true },
);

// On open, re-seed the form from the current range (covers overlays that keep
// the body mounted; a fresh remount also re-reads :default-values).
watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) reseedForm();
  },
);
</script>

