<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  DateTimeRangeProps,
  DateTimeRangeEmits,
  DateTimeRangeSlots,
  DateTimeRangeAbsoluteValue,
  DateTimeRangeRelativeValue,
  RelativeUnit,
  DateTimeMode,
} from "./ODateTimeRange.types";
import { computed, ref, watch } from "vue";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  RangeCalendarRoot,
  RangeCalendarGrid,
  RangeCalendarGridBody,
  RangeCalendarGridHead,
  RangeCalendarGridRow,
  RangeCalendarHeadCell,
  RangeCalendarCell,
  RangeCalendarCellTrigger,
  RangeCalendarHeader,
  RangeCalendarHeading,
  RangeCalendarNext,
  RangeCalendarPrev,
} from "reka-ui";
import type { DateRange } from "reka-ui";
import OTime from "@/lib/forms/Time/OTime.vue";
import { parseDate } from "@internationalized/date";
import type { DateValue } from "@internationalized/date";

const props = withDefaults(defineProps<DateTimeRangeProps>(), {
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  mode: "relative",
  relativeUnit: "minutes",
  relativeAmount: 0,
  withSeconds: false,
  autoApply: false,
  disableRelative: false,
  hideTime: false,
  showTimezone: false,
  disabled: false,
  placeholder: "Select date range",
});

const emit = defineEmits<DateTimeRangeEmits>();
defineSlots<DateTimeRangeSlots>();

// ── Popover ────────────────────────────────────────────────────
const _popoverOpen = ref(false);
const popoverOpen = computed({
  get: () => _popoverOpen.value,
  set: (val: boolean) => {
    if (!props.disabled) _popoverOpen.value = val;
  },
});

// ── Staged state ───────────────────────────────────────────────
const activeTab = ref<DateTimeMode>(props.disableRelative ? "absolute" : props.mode);
const stagedRange = ref<DateRange>({
  start: props.startDate ? tryParseDate(props.startDate) : undefined,
  end: props.endDate ? tryParseDate(props.endDate) : undefined,
} as DateRange);
const stagedStartTime = ref(props.startTime);
const stagedEndTime = ref(props.endTime);
const stagedTimezone = ref(props.timezone ?? "");
const stagedRelativeUnit = ref<RelativeUnit>(props.relativeUnit);
const stagedRelativeAmount = ref(props.relativeAmount);
const customAmount = ref(String(Math.max(1, props.relativeAmount)));
const customUnit = ref<RelativeUnit>(props.relativeUnit);

watch(_popoverOpen, (open) => {
  if (!open) {
    tzOpen.value = false;
    tzSearch.value = "";
    return;
  }
  activeTab.value = props.disableRelative ? "absolute" : props.mode;
  stagedRange.value = {
    start: props.startDate ? tryParseDate(props.startDate) : undefined,
    end: props.endDate ? tryParseDate(props.endDate) : undefined,
  } as DateRange;
  stagedStartTime.value = props.startTime;
  stagedEndTime.value = props.endTime;
  stagedTimezone.value = props.timezone ?? "";
  stagedRelativeUnit.value = props.relativeUnit;
  stagedRelativeAmount.value = props.relativeAmount;
  customAmount.value = String(Math.max(1, props.relativeAmount));
  customUnit.value = props.relativeUnit;
});

function tryParseDate(s: string): DateValue | undefined {
  try {
    return parseDate(s);
  } catch {
    return undefined;
  }
}

// ── Relative config ────────────────────────────────────────────
const RELATIVE_UNITS: RelativeUnit[] = [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
];

const RELATIVE_OPTIONS: Record<RelativeUnit, number[]> = {
  seconds: [1, 5, 10, 15, 30, 45],
  minutes: [1, 5, 10, 15, 30, 45],
  hours: [1, 2, 3, 6, 8, 12],
  days: [1, 2, 3, 4, 5, 6],
  weeks: [1, 2, 3, 4, 5, 6],
  months: [1, 2, 3, 4, 5, 6],
};

const UNIT_LABELS: Record<RelativeUnit, string> = {
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

const UNIT_TO_HOURS: Record<RelativeUnit, number> = {
  seconds: 1 / 3600,
  minutes: 1 / 60,
  hours: 1,
  days: 24,
  weeks: 168,
  months: 720,
};

function isRelativeDisabled(unit: RelativeUnit, amount: number): boolean {
  if (!props.maxHours) return false;
  return UNIT_TO_HOURS[unit] * amount > props.maxHours;
}

// ── Timezones ──────────────────────────────────────────────────
const timezones = computed((): string[] => {
  const list: string[] =
    (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  return ["", "UTC", ...list.filter((t) => t !== "UTC")];
});

function tzLabel(tz: string): string {
  return tz === "" ? "Browser Time" : tz;
}

const tzSearch = ref("");
const tzOpen = ref(false);

const filteredTimezones = computed((): string[] => {
  const term = tzSearch.value.trim().toLowerCase();
  if (!term) return timezones.value;
  return timezones.value.filter((tz) =>
    tzLabel(tz).toLowerCase().includes(term),
  );
});

function selectTimezone(tz: string) {
  stagedTimezone.value = tz;
  tzSearch.value = "";
  tzOpen.value = false;
}

// ── Trigger label ──────────────────────────────────────────────
const triggerLabel = computed((): string => {
  if (props.mode === "relative" && (props.relativeAmount ?? 0) > 0) {
    return formatRelativeLabel(props.relativeUnit, props.relativeAmount);
  }
  if (props.mode === "absolute" && (props.startDate || props.endDate)) {
    const start = [props.startDate, props.startTime].filter(Boolean).join(" ");
    const end = [props.endDate, props.endTime].filter(Boolean).join(" ");
    if (start && end) return `${start} → ${end}`;
    return start || end;
  }
  return props.placeholder ?? "Select date range";
});

function formatRelativeLabel(unit: RelativeUnit, amount: number): string {
  const singular: Record<RelativeUnit, string> = {
    seconds: "Second",
    minutes: "Minute",
    hours: "Hour",
    days: "Day",
    weeks: "Week",
    months: "Month",
  };
  const plural: Record<RelativeUnit, string> = {
    seconds: "Seconds",
    minutes: "Minutes",
    hours: "Hours",
    days: "Days",
    weeks: "Weeks",
    months: "Months",
  };
  return `Past ${amount} ${amount === 1 ? singular[unit] : plural[unit]}`;
}

// ── Calendar ───────────────────────────────────────────────────
const rangeLabel = computed((): string | null => {
  const start = stagedRange.value.start as DateValue | undefined;
  const end = stagedRange.value.end as DateValue | undefined;
  if (!start && !end) return null;
  if (start && !end) return start.toString();
  return `${start?.toString()} — ${end?.toString()}`;
});

function handleRangeChange(value: DateRange | undefined) {
  if (!value) return;
  stagedRange.value = value as DateRange;
  if (props.autoApply && value.start && value.end) emitAbsolute();
}

// ── Apply actions ──────────────────────────────────────────────
function selectRelative(unit: RelativeUnit, amount: number) {
  if (isRelativeDisabled(unit, amount) || props.disabled) return;
  stagedRelativeUnit.value = unit;
  stagedRelativeAmount.value = amount;
  if (props.autoApply) commitRelative();
}

function commitRelative() {
  const value: DateTimeRangeRelativeValue = {
    type: "relative",
    unit: stagedRelativeUnit.value,
    amount: stagedRelativeAmount.value,
    timezone: stagedTimezone.value,
  };
  emit("update:mode", "relative");
  emit("update:relativeUnit", stagedRelativeUnit.value);
  emit("update:relativeAmount", stagedRelativeAmount.value);
  emit("update:timezone", stagedTimezone.value);
  emit("change", value);
  _popoverOpen.value = false;
}

function applyCustomRelative() {
  const amount = parseInt(customAmount.value, 10);
  if (isNaN(amount) || amount <= 0) return;
  selectRelative(customUnit.value, amount);
}

function emitAbsolute() {
  const start = stagedRange.value.start as DateValue | undefined;
  const end = stagedRange.value.end as DateValue | undefined;
  const value: DateTimeRangeAbsoluteValue = {
    type: "absolute",
    startDate: start?.toString() ?? "",
    startTime: stagedStartTime.value,
    endDate: end?.toString() ?? "",
    endTime: stagedEndTime.value,
    timezone: stagedTimezone.value,
  };
  emit("update:startDate", value.startDate);
  emit("update:startTime", value.startTime);
  emit("update:endDate", value.endDate);
  emit("update:endTime", value.endTime);
  emit("update:mode", "absolute");
  emit("update:timezone", value.timezone);
  emit("change", value);
}

function handleApply() {
  emitAbsolute();
  _popoverOpen.value = false;
}

// ── Trigger styling ────────────────────────────────────────────
const hasError = computed(() => !!props.errorMessage);
const isPlaceholder = computed(
  () => triggerLabel.value === (props.placeholder ?? "Select date range"),
);

const triggerClasses = computed(() => [
  "tw:flex tw:items-center tw:gap-2 tw:w-full tw:min-h-10 tw:px-3 tw:rounded-md tw:border tw:text-sm tw:transition-colors tw:duration-150 tw:outline-none tw:bg-datepicker-bg",
  hasError.value
    ? "tw:border-datepicker-error-border"
    : "tw:border-datepicker-border tw:hover:border-datepicker-hover-border",
  props.disabled
    ? "tw:opacity-60 tw:cursor-not-allowed tw:bg-datepicker-disabled-bg tw:border-datepicker-disabled-border"
    : "tw:cursor-pointer",
]);
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <!-- Label -->
    <div
      v-if="$slots.label || label"
      class="tw:text-xs tw:font-medium tw:text-datepicker-label tw:leading-none"
    >
      <slot name="label">{{ label }}</slot>
    </div>

    <!-- Trigger + Popover -->
    <PopoverRoot v-model:open="popoverOpen">
      <PopoverTrigger as-child>
        <div
          :class="triggerClasses"
          role="button"
          :aria-expanded="popoverOpen"
          :aria-haspopup="true"
          :aria-disabled="disabled || undefined"
          data-test="datetimerange-trigger"
        >
          <!-- Clock icon -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-4 tw:shrink-0 tw:text-datepicker-icon"
            aria-hidden="true"
          >
            <path
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Z"
            />
            <path
              d="M8 4a.5.5 0 0 1 .5.5V8H11a.5.5 0 0 1 0 1H7.5V4.5A.5.5 0 0 1 8 4Z"
            />
          </svg>
          <!-- Label -->
          <span
            class="tw:flex-1 tw:truncate"
            :class="
              isPlaceholder
                ? 'tw:text-datepicker-placeholder'
                : 'tw:text-datepicker-text'
            "
          >{{ triggerLabel }}</span>
          <!-- Chevron -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-4 tw:shrink-0 tw:text-datepicker-icon tw:transition-transform"
            :class="popoverOpen ? 'tw:rotate-180' : ''"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
      </PopoverTrigger>

      <PopoverContent
        :side-offset="4"
        align="start"
        class="tw:z-50 tw:rounded-lg tw:border tw:shadow-lg tw:bg-datepicker-popup-bg tw:border-datepicker-popup-border tw:w-80 tw:outline-none"
        data-test="datetimerange-popup"
      >
        <!-- Tab bar -->
        <div
          v-if="!disableRelative"
          class="tw:flex tw:border-b tw:border-datepicker-popup-border"
          data-test="datetimerange-tabs"
        >
          <button
            type="button"
            :class="[
              'tw:flex-1 tw:py-2.5 tw:text-sm tw:outline-none tw:transition-colors tw:border-b-2',
              activeTab === 'relative'
                ? 'tw:font-medium tw:border-datepicker-day-selected-bg tw:text-datepicker-day-selected-bg'
                : 'tw:border-transparent tw:text-datepicker-weekday-text tw:hover:text-datepicker-heading-text',
            ]"
            data-test="datetimerange-tab-relative"
            @click="activeTab = 'relative'"
          >
            Relative
          </button>
          <button
            type="button"
            :class="[
              'tw:flex-1 tw:py-2.5 tw:text-sm tw:outline-none tw:transition-colors tw:border-b-2',
              activeTab === 'absolute'
                ? 'tw:font-medium tw:border-datepicker-day-selected-bg tw:text-datepicker-day-selected-bg'
                : 'tw:border-transparent tw:text-datepicker-weekday-text tw:hover:text-datepicker-heading-text',
            ]"
            data-test="datetimerange-tab-absolute"
            @click="activeTab = 'absolute'"
          >
            Absolute
          </button>
        </div>

        <!-- ── RELATIVE TAB ──────────────────────────────────── -->
        <div
          v-if="activeTab === 'relative'"
          class="tw:p-3 tw:flex tw:flex-col tw:gap-2"
          data-test="datetimerange-relative-panel"
        >
          <!-- Quick-select rows -->
          <div
            v-for="unit in RELATIVE_UNITS"
            :key="unit"
            class="tw:flex tw:items-center tw:gap-2"
          >
            <span
              class="tw:w-14 tw:text-xs tw:text-datepicker-relative-label tw:shrink-0 tw:capitalize"
            >{{ UNIT_LABELS[unit] }}</span>
            <div class="tw:flex tw:gap-1 tw:flex-wrap">
              <button
                v-for="val in RELATIVE_OPTIONS[unit]"
                :key="val"
                type="button"
                :disabled="isRelativeDisabled(unit, val) || disabled"
                :class="[
                  'tw:w-8 tw:h-7 tw:rounded tw:text-xs tw:transition-colors tw:outline-none tw:tabular-nums',
                  stagedRelativeUnit === unit && stagedRelativeAmount === val && !isRelativeDisabled(unit, val)
                    ? 'tw:bg-datepicker-relative-btn-selected-bg tw:text-datepicker-relative-btn-selected-text'
                    : isRelativeDisabled(unit, val)
                      ? 'tw:bg-datepicker-relative-btn-bg tw:text-datepicker-day-disabled-text tw:cursor-not-allowed'
                      : 'tw:bg-datepicker-relative-btn-bg tw:text-datepicker-relative-btn-text tw:hover:bg-datepicker-relative-btn-hover-bg tw:cursor-pointer',
                ]"
                @click="selectRelative(unit, val)"
              >{{ val }}</button>
            </div>
          </div>

          <!-- Custom row -->
          <div
            class="tw:flex tw:items-center tw:gap-2 tw:mt-1 tw:pt-2 tw:border-t tw:border-datepicker-popup-border"
          >
            <span
              class="tw:w-14 tw:text-xs tw:text-datepicker-relative-label tw:shrink-0"
            >Custom</span>
            <input
              v-model="customAmount"
              type="number"
              min="1"
              :disabled="disabled"
              class="tw:w-16 tw:h-7 tw:rounded tw:border tw:border-datepicker-border tw:bg-datepicker-bg tw:text-datepicker-text tw:text-xs tw:px-2 tw:outline-none tw:focus:border-datepicker-focus-border tw:tabular-nums tw:disabled:opacity-50"
              data-test="datetimerange-custom-amount"
              @keydown.enter="applyCustomRelative"
            />
            <select
              v-model="customUnit"
              :disabled="disabled"
              class="tw:flex-1 tw:h-7 tw:rounded tw:border tw:border-datepicker-border tw:bg-datepicker-bg tw:text-datepicker-text tw:text-xs tw:px-2 tw:outline-none tw:focus:border-datepicker-focus-border tw:disabled:opacity-50"
              data-test="datetimerange-custom-unit"
            >
              <option
                v-for="u in RELATIVE_UNITS"
                :key="u"
                :value="u"
              >{{ UNIT_LABELS[u] }}</option>
            </select>
          </div>

          <!-- Timezone row -->
          <div
            v-if="showTimezone"
            class="tw:flex tw:flex-col tw:gap-1 tw:pt-2 tw:border-t tw:border-datepicker-popup-border"
          >
            <span
              class="tw:text-xs tw:text-datepicker-relative-label"
            >Timezone</span>
            <button
              type="button"
              :disabled="disabled"
              class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-7 tw:rounded tw:border tw:border-datepicker-border tw:bg-datepicker-bg tw:text-datepicker-text tw:text-xs tw:px-2 tw:outline-none tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
              data-test="datetimerange-timezone-trigger"
              @click="!disabled && (tzOpen = !tzOpen)"
            >
              <span class="tw:truncate">{{ tzLabel(stagedTimezone) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="tw:size-3 tw:shrink-0 tw:text-datepicker-icon tw:transition-transform"
                :class="tzOpen ? 'tw:rotate-180' : ''"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
            <div
              v-if="tzOpen && !disabled"
              class="tw:rounded tw:border tw:border-datepicker-border tw:overflow-hidden"
            >
              <input
                v-model="tzSearch"
                type="text"
                placeholder="Search timezone..."
                autofocus
                class="tw:w-full tw:h-7 tw:px-2 tw:text-xs tw:bg-datepicker-bg tw:text-datepicker-text tw:border-b tw:border-datepicker-border tw:outline-none tw:focus:border-datepicker-focus-border tw:placeholder:text-datepicker-placeholder"
                data-test="datetimerange-timezone-search"
              />
              <div class="tw:overflow-y-auto tw:max-h-36 tw:bg-datepicker-bg">
                <button
                  v-for="tz in filteredTimezones"
                  :key="tz"
                  type="button"
                  :class="[
                    'tw:w-full tw:text-left tw:px-2 tw:py-1 tw:text-xs tw:transition-colors tw:outline-none',
                    stagedTimezone === tz
                      ? 'tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text'
                      : 'tw:text-datepicker-text tw:hover:bg-datepicker-relative-btn-hover-bg',
                  ]"
                  @click="selectTimezone(tz)"
                >{{ tzLabel(tz) }}</button>
                <div
                  v-if="filteredTimezones.length === 0"
                  class="tw:px-2 tw:py-2 tw:text-xs tw:text-datepicker-weekday-text"
                >No timezones found</div>
              </div>
            </div>
          </div>

          <!-- Apply -->
          <div
            v-if="!autoApply"
            class="tw:flex tw:justify-end tw:pt-2 tw:border-t tw:border-datepicker-popup-border"
          >
            <button
              type="button"
              :disabled="disabled || stagedRelativeAmount <= 0"
              class="tw:px-4 tw:py-1.5 tw:rounded tw:text-sm tw:font-medium tw:transition-colors tw:outline-none tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text tw:hover:opacity-90 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
              data-test="datetimerange-relative-apply"
              @click="commitRelative"
            >Apply</button>
          </div>
        </div>

        <!-- ── ABSOLUTE TAB ──────────────────────────────────── -->
        <div
          v-if="activeTab === 'absolute'"
          class="tw:p-3 tw:flex tw:flex-col tw:gap-3 tw:overflow-y-auto tw:max-h-[70vh]"
          data-test="datetimerange-absolute-panel"
        >
          <!-- Range calendar -->
          <RangeCalendarRoot
            :model-value="stagedRange"
            :disabled="disabled"
            :min-value="minDate ? tryParseDate(minDate) : undefined"
            :max-value="maxDate ? tryParseDate(maxDate) : undefined"
            week-start-on="0"
            @update:model-value="handleRangeChange"
          >
            <template #default="{ weekDays, grid }">
              <RangeCalendarHeader
                class="tw:flex tw:items-center tw:justify-between tw:mb-3"
              >
                <RangeCalendarPrev
                  class="tw:flex tw:items-center tw:justify-center tw:size-7 tw:rounded tw:transition-colors tw:outline-none tw:text-datepicker-icon tw:hover:bg-datepicker-nav-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    class="tw:size-4"
                    aria-hidden="true"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </RangeCalendarPrev>
                <RangeCalendarHeading
                  class="tw:text-sm tw:font-medium tw:text-datepicker-heading-text"
                />
                <RangeCalendarNext
                  class="tw:flex tw:items-center tw:justify-center tw:size-7 tw:rounded tw:transition-colors tw:outline-none tw:text-datepicker-icon tw:hover:bg-datepicker-nav-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    class="tw:size-4"
                    aria-hidden="true"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06L7.28 11.78a.75.75 0 0 1-1.06-1.06L9.44 8 6.22 4.78a.75.75 0 0 1 0-1.06Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </RangeCalendarNext>
              </RangeCalendarHeader>

              <RangeCalendarGrid
                v-for="month in grid"
                :key="month.value.toString()"
              >
                <RangeCalendarGridHead>
                  <RangeCalendarGridRow class="tw:flex tw:gap-1 tw:mb-1">
                    <RangeCalendarHeadCell
                      v-for="day in weekDays"
                      :key="day"
                      class="tw:w-8 tw:h-6 tw:flex tw:items-center tw:justify-center tw:text-xs tw:font-medium tw:text-datepicker-weekday-text"
                    >
                      {{ day }}
                    </RangeCalendarHeadCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridHead>
                <RangeCalendarGridBody>
                  <RangeCalendarGridRow
                    v-for="(weekDates, idx) in month.rows"
                    :key="idx"
                    class="tw:flex tw:gap-1 tw:mb-1"
                  >
                    <RangeCalendarCell
                      v-for="date in weekDates"
                      :key="date.toString()"
                      :date="date"
                    >
                      <RangeCalendarCellTrigger
                        :day="date"
                        :month="month.value"
                        class="tw:flex tw:items-center tw:justify-center tw:size-8 tw:rounded tw:text-xs tw:cursor-pointer tw:outline-none tw:transition-colors tw:text-datepicker-day-text tw:hover:bg-datepicker-day-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:data-selected:bg-datepicker-day-selected-bg tw:data-selected:text-datepicker-day-selected-text tw:data-today:border tw:data-today:border-datepicker-day-today-border tw:data-outside-view:text-datepicker-day-outside-text tw:data-unavailable:text-datepicker-day-disabled-text tw:data-unavailable:cursor-not-allowed tw:data-highlighted:bg-datepicker-day-range-bg tw:data-highlighted:text-datepicker-day-range-text tw:data-selection-start:bg-datepicker-day-selected-bg tw:data-selection-start:text-datepicker-day-selected-text tw:data-selection-end:bg-datepicker-day-selected-bg tw:data-selection-end:text-datepicker-day-selected-text"
                      >{{ date.day }}</RangeCalendarCellTrigger>
                    </RangeCalendarCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridBody>
              </RangeCalendarGrid>
            </template>
          </RangeCalendarRoot>

          <!-- Range hint -->
          <p
            v-if="rangeLabel"
            class="tw:text-xs tw:text-datepicker-weekday-text tw:text-center"
            aria-live="polite"
          >
            {{ rangeLabel }}
          </p>

          <!-- Start / End time -->
          <div v-if="!hideTime" class="tw:flex tw:gap-3">
            <OTime
              v-model="stagedStartTime"
              label="Start time"
              :with-seconds="withSeconds"
              :disabled="disabled"
              data-test="datetimerange-start-time"
              @change="autoApply && emitAbsolute()"
            />
            <OTime
              v-model="stagedEndTime"
              label="End time"
              :with-seconds="withSeconds"
              :disabled="disabled"
              data-test="datetimerange-end-time"
              @change="autoApply && emitAbsolute()"
            />
          </div>

          <!-- Timezone -->
          <div v-if="showTimezone" class="tw:flex tw:flex-col tw:gap-1">
            <span class="tw:text-xs tw:text-datepicker-label">Timezone</span>
            <button
              type="button"
              :disabled="disabled"
              class="tw:flex tw:items-center tw:justify-between tw:w-full tw:h-9 tw:rounded-md tw:border tw:border-datepicker-border tw:bg-datepicker-bg tw:text-datepicker-text tw:text-sm tw:px-3 tw:outline-none tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
              data-test="datetimerange-timezone-trigger"
              @click="!disabled && (tzOpen = !tzOpen)"
            >
              <span class="tw:truncate">{{ tzLabel(stagedTimezone) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="tw:size-4 tw:shrink-0 tw:text-datepicker-icon tw:transition-transform"
                :class="tzOpen ? 'tw:rotate-180' : ''"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
            <div
              v-if="tzOpen && !disabled"
              class="tw:rounded-md tw:border tw:border-datepicker-border tw:overflow-hidden"
            >
              <input
                v-model="tzSearch"
                type="text"
                placeholder="Search timezone..."
                autofocus
                class="tw:w-full tw:h-9 tw:px-3 tw:text-sm tw:bg-datepicker-bg tw:text-datepicker-text tw:border-b tw:border-datepicker-border tw:outline-none tw:focus:border-datepicker-focus-border tw:placeholder:text-datepicker-placeholder"
                data-test="datetimerange-timezone-search"
              />
              <div class="tw:overflow-y-auto tw:max-h-40 tw:bg-datepicker-bg">
                <button
                  v-for="tz in filteredTimezones"
                  :key="tz"
                  type="button"
                  :class="[
                    'tw:w-full tw:text-left tw:px-3 tw:py-1.5 tw:text-sm tw:transition-colors tw:outline-none',
                    stagedTimezone === tz
                      ? 'tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text'
                      : 'tw:text-datepicker-text tw:hover:bg-datepicker-relative-btn-hover-bg',
                  ]"
                  @click="selectTimezone(tz)"
                >{{ tzLabel(tz) }}</button>
                <div
                  v-if="filteredTimezones.length === 0"
                  class="tw:px-3 tw:py-2 tw:text-sm tw:text-datepicker-weekday-text"
                >No timezones found</div>
              </div>
            </div>
          </div>

          <!-- Apply -->
          <div v-if="!autoApply" class="tw:flex tw:justify-end">
            <button
              type="button"
              :disabled="disabled"
              class="tw:px-4 tw:py-1.5 tw:rounded tw:text-sm tw:font-medium tw:transition-colors tw:outline-none tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text tw:hover:opacity-90 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
              data-test="datetimerange-apply"
              @click="handleApply"
            >Apply</button>
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>

    <!-- Error / help text -->
    <div
      v-if="errorMessage || helpText"
      class="tw:flex tw:items-center tw:gap-2"
    >
      <span
        v-if="errorMessage"
        class="tw:text-xs tw:text-datepicker-error-text tw:leading-none"
        role="alert"
      >{{ errorMessage }}</span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-datepicker-label tw:leading-none"
      >{{ helpText }}</span>
    </div>
  </div>
</template>
