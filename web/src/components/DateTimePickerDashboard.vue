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
  <DateTime
    ref="dateTimePicker"
    :default-type="modelValue.valueType"
    :default-absolute-time="{
      startTime: modelValue.startTime,
      endTime: modelValue.endTime,
    }"
    :default-relative-time="modelValue.relativeTimePeriod"
    @on:date-change="updateDateTime"
    @on:timezone-change="onTimezoneChange"
    :initialTimezone="initialTimezone"
    :disable="disable"
    :hide-relative-timezone="hideRelativeTimezone"
    :hide-range-shift="hideRangeShift"
    :menu-align="menuAlign"
    :variant="variant"
    :preset="preset"
    :capabilities="capabilities"
    :host-name="hostName"
    :panel-time-mark="panelTimeMark"
    :limit-refused="limitRefused"
    @apply="onApply"
    @hide="onHide"
    @show="onShow"
  >
  </DateTime>
</template>

<script lang="ts">
import { ref, defineComponent, onUnmounted, type PropType } from "vue";
import DateTime from "@/components/DateTime.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import type {
  TimeRange,
  TimeRangeApplyMeta,
  TimeRangeCapabilities,
  TimeRangeHostPreset,
} from "@/utils/timeRangeModel";

export default defineComponent({
  name: "DateTimePickerDashboard",
  components: {
    DateTime,
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
    disable: {
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
      default: "start",
      type: String as PropType<"center" | "start" | "end">,
    },
    variant: {
      required: false,
      default: "outline",
      type: String as PropType<ButtonVariant>,
    },
    preset: {
      required: false,
      default: "dashboard",
      type: String as PropType<TimeRangeHostPreset>,
    },
    capabilities: {
      required: false,
      default: () => ({}),
      type: Object as PropType<TimeRangeCapabilities>,
    },
    hostName: {
      required: false,
      default: "",
      type: String,
    },
    /** A panel on the dashboard keeps its own time; the trigger marks it. */
    panelTimeMark: {
      required: false,
      default: false,
      type: Boolean,
    },
    /** The page refused this range as over its limit; the trigger keeps it with a lock. */
    limitRefused: {
      required: false,
      default: false,
      type: Boolean,
    },
  },
  emits: ["update:modelValue", "hide", "show", "timezone-change", "apply"],

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

      // The second argument tells a page the picker's own corrections apart from a user's pick.
      emit("update:modelValue", newValue, { userChanged: date.userChangedValue !== false });
    };

    const onApply = (range: TimeRange, meta: TimeRangeApplyMeta) => {
      emit("apply", range, meta);
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

    // The picker's own undo, for a page control that goes back a step; false before mount or with nothing to undo.
    const undo = (): boolean => dateTimePicker.value?.undo() ?? false;

    const onHide = () => {
      emit("hide");
    };

    const onShow = () => {
      emit("show");
    };

    const onTimezoneChange = () => {
      emit("timezone-change");
    };

    onUnmounted(() => {
      if (dateTimePicker.value) {
        dateTimePicker.value = null;
      }
    });

    return {
      updateDateTime,
      onApply,
      refresh,
      dateTimePicker,
      setCustomDate,
      getConsumableDateTime,
      setSavedDate,
      undo,
      onShow,
      onHide,
      onTimezoneChange,
    };
  },
});
</script>
