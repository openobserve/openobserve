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
  <ODateTimeRange
    ref="dateTimePicker"
    :auto-apply="autoApplyDashboard"
    :default-type="modelValue.valueType"
    :default-absolute-time="{
      startTime: modelValue.startTime,
      endTime: modelValue.endTime,
    }"
    :default-relative-time="modelValue.relativeTimePeriod"
    @on:date-change="updateDateTime"
    @on:timezone-change="onTimezoneChange"
    :initialTimezone="initialTimezone"
    :disabled="disabled"
    :size="size"
    :hide-relative-timezone="hideRelativeTimezone"
    :hide-range-shift="hideRangeShift"
    :menu-align="menuAlign"
    :calendar-presets="calendarPresets"
    @hide="onHide"
    @show="onShow"
  >
  </ODateTimeRange>
</template>

<script lang="ts">
import { ref, defineComponent, onUnmounted, type PropType } from "vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type {
  DateTimeRangeMenuAlign,
  DateTimeRangeSize,
} from "@/lib/forms/DateTimeRange/ODateTimeRange.types";

export default defineComponent({
  name: "DateTimePickerDashboard",
  components: {
    ODateTimeRange,
  },
  props: {
    modelValue: {
      type: Object,
      default: () => ({
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "15m",
        valueType: "relative",
      }),
    },
    initialTimezone: {
      required: false,
      default: null,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    size: {
      type: String as PropType<DateTimeRangeSize>,
      default: "md",
    },
    autoApplyDashboard: {
      required: false,
      default: false,
    },
    hideRelativeTimezone: {
      required: false,
      default: false,
      type: Boolean,
    },
    hideRangeShift: {
      required: false,
      default: false,
      type: Boolean,
    },
    menuAlign: {
      required: false,
      default: "end",
      type: String as PropType<DateTimeRangeMenuAlign>,
    },
    calendarPresets: {
      required: false,
      default: false,
      type: Boolean,
    },
  },
  emits: ["update:modelValue", "hide", "show", "timezone-change"],

  setup(props, { emit }) {
    const dateTimePicker: any = ref(null);

    const updateDateTime = (date: any) => {
      const newValue = {
        startTime: date.startTime,
        endTime: date.endTime,
        relativeTimePeriod: date.relativeTimePeriod,
        valueType: ["relative", "relative-custom"].includes(date.valueType)
          ? "relative"
          : "absolute",
      };

      emit("update:modelValue", newValue);
    };

    const refresh = () => {
      dateTimePicker.value.refresh();
    };

    // setCustomDate with type of date(absolute) and dateObj(start and end)
    const setCustomDate = (type: string, dateObj: any) => {
      dateTimePicker.value.setCustomDate(type, dateObj);
    };

    const getConsumableDateTime = () => {
      return dateTimePicker.value.getConsumableDateTime();
    };

    // The picker reads its v-model only on mount; this moves an already-mounted one.
    const setSavedDate = (dateObj: any) => {
      dateTimePicker.value.setSavedDate(dateObj);
    };

    const onHide = () => {
      emit("hide");
    };

    const onShow = () => {
      emit("show");
    };

    const onTimezoneChange = () => {
      emit("timezone-change");
    };

    // Clean up resources on unmount to prevent memory leaks
    onUnmounted(() => {
      // If you add intervals, listeners, or subscriptions, clean them up here.
      // Example:
      // if (someInterval) clearInterval(someInterval);
      // if (someListener) someListener.off();
      if (dateTimePicker.value) {
        dateTimePicker.value = null;
      }
    });

    return {
      updateDateTime,
      refresh,
      dateTimePicker,
      setCustomDate,
      getConsumableDateTime,
      setSavedDate,
      onShow,
      onHide,
      onTimezoneChange,
    };
  },
});
</script>
