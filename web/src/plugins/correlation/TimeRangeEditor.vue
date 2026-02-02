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
  <q-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    @hide="handleClose"
    data-test="time-range-editor-dialog"
  >
    <q-card style="min-width: 500px; max-width: 600px">
      <!-- Header -->
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ t('correlation.logs.timeRange.title') }}</div>
        <q-space />
        <q-btn
          icon="close"
          flat
          round
          dense
          v-close-popup
          :aria-label="t('common.close')"
          data-test="close-dialog-btn"
        />
      </q-card-section>

      <q-separator class="q-mt-md" />

      <!-- Content -->
      <q-card-section class="q-pt-md">
        <!-- Source Log Time -->
        <div class="tw:mb-6">
          <div class="tw:text-sm tw:font-semibold tw:mb-2">
            {{ t('correlation.logs.timeRange.sourceTime') }}
          </div>
          <div
            class="tw:p-3 tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded tw:bg-gray-50 tw:flex tw:items-center tw:gap-2"
          >
            <q-icon name="schedule" size="sm" color="primary" />
            <span class="tw:font-mono tw:text-sm">{{ formatTimestamp(sourceTimestamp) }}</span>
          </div>
        </div>

        <!-- Time Window Presets -->
        <div class="tw:mb-6">
          <div class="tw:text-sm tw:font-semibold tw:mb-3">
            {{ t('correlation.logs.timeRange.window') }}
          </div>

          <div class="tw:space-y-2">
            <q-radio
              v-model="selectedWindow"
              val="1min"
              :label="t('correlation.logs.timeRange.minute1')"
              @update:model-value="applyPreset"
              data-test="window-1min"
            />
            <q-radio
              v-model="selectedWindow"
              val="5min"
              :label="t('correlation.logs.timeRange.minute5')"
              @update:model-value="applyPreset"
              data-test="window-5min"
            />
            <q-radio
              v-model="selectedWindow"
              val="15min"
              :label="t('correlation.logs.timeRange.minute15')"
              @update:model-value="applyPreset"
              data-test="window-15min"
            />
            <q-radio
              v-model="selectedWindow"
              val="30min"
              :label="t('correlation.logs.timeRange.minute30')"
              @update:model-value="applyPreset"
              data-test="window-30min"
            />
            <q-radio
              v-model="selectedWindow"
              val="1hour"
              :label="t('correlation.logs.timeRange.hour1')"
              @update:model-value="applyPreset"
              data-test="window-1hour"
            />
            <q-radio
              v-model="selectedWindow"
              val="custom"
              :label="t('correlation.logs.timeRange.custom')"
              @update:model-value="selectedWindow = 'custom'"
              data-test="window-custom"
            />
          </div>
        </div>

        <!-- Custom Time Range Inputs (only shown when custom is selected) -->
        <div v-if="selectedWindow === 'custom'" class="tw:mb-4 tw:space-y-3">
          <div>
            <div class="tw:text-sm tw:font-semibold tw:mb-2">
              {{ t('correlation.logs.timeRange.customStart') }}
            </div>
            <q-input
              v-model="customStartTime"
              type="datetime-local"
              outlined
              dense
              :rules="[validateStartTime]"
              data-test="custom-start-input"
            />
          </div>

          <div>
            <div class="tw:text-sm tw:font-semibold tw:mb-2">
              {{ t('correlation.logs.timeRange.customEnd') }}
            </div>
            <q-input
              v-model="customEndTime"
              type="datetime-local"
              outlined
              dense
              :rules="[validateEndTime]"
              data-test="custom-end-input"
            />
          </div>
        </div>

        <!-- Current Range Display -->
        <div
          class="tw:p-3 tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded tw:bg-blue-50"
        >
          <div class="tw:text-xs tw:font-semibold tw:mb-2 tw:opacity-70">
            {{ t('correlation.logs.timeRange.currentRange') }}
          </div>
          <div class="tw:flex tw:flex-col tw:gap-1 tw:text-sm">
            <div class="tw:flex tw:items-center tw:gap-2">
              <span class="tw:font-semibold">{{ t('correlation.logs.timeRange.start') }}:</span>
              <span class="tw:font-mono">{{ formatTimestamp(pendingStartTime) }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:gap-2">
              <span class="tw:font-semibold">{{ t('correlation.logs.timeRange.end') }}:</span>
              <span class="tw:font-mono">{{ formatTimestamp(pendingEndTime) }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:mt-1">
              <span class="tw:font-semibold">{{ t('correlation.logs.timeRange.duration') }}:</span>
              <span>{{ formatDuration(pendingEndTime - pendingStartTime) }}</span>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <!-- Actions -->
      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          flat
          :label="t('common.cancel')"
          @click="handleCancel"
          data-test="cancel-btn"
        />
        <q-btn
          flat
          :label="t('common.reset')"
          icon="restart_alt"
          @click="handleReset"
          data-test="reset-btn"
        />
        <q-btn
          :label="t('common.apply')"
          color="primary"
          class="o2-primary-button"
          @click="handleApply"
          :disable="!isValid"
          data-test="apply-btn"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { date } from 'quasar';

interface Props {
  modelValue: boolean;
  currentRange: { startTime: number; endTime: number };
  sourceTimestamp: number;
}

// Props & Emits
const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'update:range': [startTime: number, endTime: number];
  'close': [];
}>();

// Composables
const { t } = useI18n();

// State
const selectedWindow = ref<string>('5min');
const pendingStartTime = ref<number>(props.currentRange.startTime);
const pendingEndTime = ref<number>(props.currentRange.endTime);
const customStartTime = ref<string>('');
const customEndTime = ref<string>('');

// Computed
const isValid = computed(() => {
  if (selectedWindow.value === 'custom') {
    return (
      customStartTime.value &&
      customEndTime.value &&
      pendingStartTime.value < pendingEndTime.value
    );
  }
  return pendingStartTime.value < pendingEndTime.value;
});

/**
 * Format timestamp (microseconds) to human-readable format
 */
const formatTimestamp = (timestamp: number): string => {
  const ms = Math.floor(timestamp / 1000);
  return date.formatDate(ms, 'YYYY-MM-DD HH:mm:ss.SSS');
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

/**
 * Apply preset time window
 */
const applyPreset = () => {
  let windowMicros: number;

  switch (selectedWindow.value) {
    case '1min':
      windowMicros = 1 * 60 * 1000 * 1000; // 1 minute in microseconds
      break;
    case '5min':
      windowMicros = 5 * 60 * 1000 * 1000; // 5 minutes
      break;
    case '15min':
      windowMicros = 15 * 60 * 1000 * 1000; // 15 minutes
      break;
    case '30min':
      windowMicros = 30 * 60 * 1000 * 1000; // 30 minutes
      break;
    case '1hour':
      windowMicros = 60 * 60 * 1000 * 1000; // 1 hour
      break;
    default:
      return; // Custom - don't apply preset
  }

  // Calculate ±window around source timestamp
  pendingStartTime.value = props.sourceTimestamp - windowMicros;
  pendingEndTime.value = props.sourceTimestamp + windowMicros;
};

/**
 * Convert datetime-local input to microsecond timestamp
 */
const datetimeToMicros = (datetime: string): number => {
  return new Date(datetime).getTime() * 1000; // Convert ms to microseconds
};

/**
 * Convert microsecond timestamp to datetime-local format
 */
const microsToDatetime = (micros: number): string => {
  const ms = Math.floor(micros / 1000);
  return date.formatDate(ms, 'YYYY-MM-DDTHH:mm');
};

/**
 * Validate start time
 */
const validateStartTime = (val: string): boolean | string => {
  if (!val) return t('validation.required');

  const startMicros = datetimeToMicros(val);
  pendingStartTime.value = startMicros;

  if (startMicros >= pendingEndTime.value) {
    return t('correlation.logs.timeRange.startBeforeEnd');
  }

  return true;
};

/**
 * Validate end time
 */
const validateEndTime = (val: string): boolean | string => {
  if (!val) return t('validation.required');

  const endMicros = datetimeToMicros(val);
  pendingEndTime.value = endMicros;

  if (endMicros <= pendingStartTime.value) {
    return t('correlation.logs.timeRange.endAfterStart');
  }

  return true;
};

/**
 * Detect current window from time range
 */
const detectCurrentWindow = () => {
  const duration = pendingEndTime.value - pendingStartTime.value;
  const center = (pendingStartTime.value + pendingEndTime.value) / 2;

  // Check if range is symmetric around source timestamp (within 1 second tolerance)
  const isSymmetric = Math.abs(center - props.sourceTimestamp) < 1000000; // 1 second in microseconds

  if (!isSymmetric) {
    selectedWindow.value = 'custom';
    return;
  }

  // Detect preset based on duration
  const durationMinutes = duration / (60 * 1000 * 1000);

  if (Math.abs(durationMinutes - 2) < 0.1) {
    // ±1 min = 2 min total
    selectedWindow.value = '1min';
  } else if (Math.abs(durationMinutes - 10) < 0.1) {
    // ±5 min = 10 min total
    selectedWindow.value = '5min';
  } else if (Math.abs(durationMinutes - 30) < 0.1) {
    // ±15 min = 30 min total
    selectedWindow.value = '15min';
  } else if (Math.abs(durationMinutes - 60) < 0.1) {
    // ±30 min = 60 min total
    selectedWindow.value = '30min';
  } else if (Math.abs(durationMinutes - 120) < 0.1) {
    // ±1 hour = 120 min total
    selectedWindow.value = '1hour';
  } else {
    selectedWindow.value = 'custom';
  }
};

/**
 * Handle apply button click
 */
const handleApply = () => {
  if (selectedWindow.value === 'custom') {
    // Use custom times
    const startMicros = datetimeToMicros(customStartTime.value);
    const endMicros = datetimeToMicros(customEndTime.value);

    if (startMicros < endMicros) {
      emit('update:range', startMicros, endMicros);
      emit('update:modelValue', false);
    }
  } else {
    // Use preset times
    emit('update:range', pendingStartTime.value, pendingEndTime.value);
    emit('update:modelValue', false);
  }
};

/**
 * Handle cancel button click
 */
const handleCancel = () => {
  // Restore original range
  pendingStartTime.value = props.currentRange.startTime;
  pendingEndTime.value = props.currentRange.endTime;
  detectCurrentWindow();
  emit('update:modelValue', false);
  emit('close');
};

/**
 * Handle reset button click
 */
const handleReset = () => {
  // Reset to ±5 minutes
  selectedWindow.value = '5min';
  applyPreset();
};

/**
 * Handle dialog close
 */
const handleClose = () => {
  // Restore original range
  pendingStartTime.value = props.currentRange.startTime;
  pendingEndTime.value = props.currentRange.endTime;
  detectCurrentWindow();
  emit('close');
};

// Watch for prop changes
watch(
  () => props.currentRange,
  (newRange) => {
    pendingStartTime.value = newRange.startTime;
    pendingEndTime.value = newRange.endTime;
    detectCurrentWindow();
  },
  { deep: true }
);

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      // Reset pending times when dialog opens
      pendingStartTime.value = props.currentRange.startTime;
      pendingEndTime.value = props.currentRange.endTime;
      detectCurrentWindow();

      // Initialize custom datetime inputs
      customStartTime.value = microsToDatetime(pendingStartTime.value);
      customEndTime.value = microsToDatetime(pendingEndTime.value);
    }
  }
);

// Watch custom inputs and update pending times
watch(customStartTime, (newVal) => {
  if (newVal) {
    pendingStartTime.value = datetimeToMicros(newVal);
  }
});

watch(customEndTime, (newVal) => {
  if (newVal) {
    pendingEndTime.value = datetimeToMicros(newVal);
  }
});

// Initialize on mount
detectCurrentWindow();
</script>

<style lang="scss" scoped>
.tw\\:bg-gray-50 {
  background-color: rgba(0, 0, 0, 0.02);
}

.tw\\:bg-blue-50 {
  background-color: rgba(33, 150, 243, 0.05);
}

// Dark theme adjustments
:deep(.q-dark) {
  .tw\\:bg-gray-50 {
    background-color: rgba(255, 255, 255, 0.03);
  }

  .tw\\:bg-blue-50 {
    background-color: rgba(33, 150, 243, 0.1);
  }

  .tw\\:text-gray-600 {
    color: rgba(255, 255, 255, 0.7);
  }
}
</style>
