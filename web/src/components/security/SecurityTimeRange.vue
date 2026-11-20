<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type {
  DateTimeRangeChange,
  DateTimeRangeType,
} from "@/lib/forms/DateTimeRange/ODateTimeRange.types";

defineProps<{
  pickerProps: {
    defaultType: DateTimeRangeType;
    defaultRelativeTime: string;
    defaultAbsoluteTime?: { startTime: number; endTime: number };
  };
  dataTest: string;
}>();
const emit = defineEmits<{ change: [change: DateTimeRangeChange] }>();
</script>

<template>
  <ODateTimeRange
    v-bind="pickerProps"
    apply-presets
    hide-range-shift
    :data-test-name="dataTest"
    @on:date-change="emit('change', $event)"
  />
</template>
