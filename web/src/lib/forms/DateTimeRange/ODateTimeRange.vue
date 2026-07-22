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
import { computed, ref, useAttrs, watch, type Ref } from "vue";
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
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);
// Forward tabindex to the real trigger; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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
// Cast: ref() deep-unwraps DateRange's class members structurally, breaking DateRange bindings
const stagedRange = ref<DateRange>({
  start: props.startDate ? tryParseDate(props.startDate) : undefined,
  end: props.endDate ? tryParseDate(props.endDate) : undefined,
} as DateRange) as Ref<DateRange>;
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
const RELATIVE_UNITS: RelativeUnit[] = ["seconds", "minutes", "hours", "days", "weeks", "months"];

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
    (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
      "timeZone",
    ) ?? [];
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
  return timezones.value.filter((tz) => tzLabel(tz).toLowerCase().includes(term));
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
  return start && end
    ? `${start.toString()} — ${end.toString()}`
    : ((start ?? end)?.toString() ?? null);
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
  "flex items-center gap-2 w-full min-h-10 px-3 rounded-default border text-sm transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring bg-datepicker-bg",
  hasError.value
    ? "border-datepicker-error-border"
    : "border-datepicker-border hover:border-datepicker-hover-border",
  props.disabled
    ? "opacity-60 cursor-not-allowed bg-datepicker-disabled-bg border-datepicker-disabled-border"
    : "cursor-pointer",
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex flex-col gap-1 w-full">
    <!-- Label -->
    <div
      v-if="$slots.label || label || $slots.tooltip"
      class="text-xs font-medium text-datepicker-label leading-none flex items-center gap-1"
    >
      <slot name="label">{{ label }}</slot
      ><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help text-datepicker-label"
        ><slot name="tooltip"
      /></OIcon>
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
          :tabindex="inputTabindex"
          data-test="datetimerange-trigger"
        >
          <!-- Clock icon -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="size-4 shrink-0 text-datepicker-icon"
            aria-hidden="true"
          >
            <path
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Z"
            />
            <path d="M8 4a.5.5 0 0 1 .5.5V8H11a.5.5 0 0 1 0 1H7.5V4.5A.5.5 0 0 1 8 4Z" />
          </svg>
          <!-- Label -->
          <span
            class="flex-1 truncate"
            :class="isPlaceholder ? 'text-datepicker-placeholder' : 'text-datepicker-text'"
            >{{ triggerLabel }}</span
          >
          <!-- Chevron -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="size-4 shrink-0 text-datepicker-icon transition-transform"
            :class="popoverOpen ? 'rotate-180' : ''"
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
        class="z-50 rounded-default border shadow-lg bg-datepicker-popup-bg border-datepicker-popup-border w-80 outline-none"
        data-test="datetimerange-popup"
      >
        <!-- Tab bar -->
        <div
          v-if="!disableRelative"
          class="flex border-b border-datepicker-popup-border"
          data-test="datetimerange-tabs"
        >
          <button
            type="button"
            :class="[
              'flex-1 py-2.5 text-sm outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 border-b-2 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
              activeTab === 'relative'
                ? 'font-medium border-datepicker-day-selected-bg text-datepicker-day-selected-bg'
                : 'border-transparent text-datepicker-weekday-text hover:text-datepicker-heading-text',
            ]"
            data-test="datetimerange-tab-relative"
            @click="activeTab = 'relative'"
          >
            Relative
          </button>
          <button
            type="button"
            :class="[
              'flex-1 py-2.5 text-sm outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 border-b-2 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
              activeTab === 'absolute'
                ? 'font-medium border-datepicker-day-selected-bg text-datepicker-day-selected-bg'
                : 'border-transparent text-datepicker-weekday-text hover:text-datepicker-heading-text',
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
          class="p-3 flex flex-col gap-2"
          data-test="datetimerange-relative-panel"
        >
          <!-- Quick-select rows -->
          <div v-for="unit in RELATIVE_UNITS" :key="unit" class="flex items-center gap-2">
            <span class="w-14 text-xs text-datepicker-relative-label shrink-0 capitalize">{{
              UNIT_LABELS[unit]
            }}</span>
            <div class="flex gap-1 flex-wrap">
              <button
                v-for="val in RELATIVE_OPTIONS[unit]"
                :key="val"
                type="button"
                :disabled="isRelativeDisabled(unit, val) || disabled"
                :class="[
                  'w-8 h-7 rounded-default text-xs transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring tabular-nums',
                  stagedRelativeUnit === unit &&
                  stagedRelativeAmount === val &&
                  !isRelativeDisabled(unit, val)
                    ? 'bg-datepicker-relative-btn-selected-bg text-datepicker-relative-btn-selected-text'
                    : isRelativeDisabled(unit, val)
                      ? 'bg-datepicker-relative-btn-bg text-datepicker-day-disabled-text cursor-not-allowed'
                      : 'bg-datepicker-relative-btn-bg text-datepicker-relative-btn-text hover:bg-datepicker-relative-btn-hover-bg cursor-pointer',
                ]"
                @click="selectRelative(unit, val)"
              >
                {{ val }}
              </button>
            </div>
          </div>

          <!-- Custom row -->
          <div class="flex items-center gap-2 mt-1 pt-2 border-t border-datepicker-popup-border">
            <span class="w-14 text-xs text-datepicker-relative-label shrink-0">Custom</span>
            <input
              v-model="customAmount"
              type="number"
              min="1"
              :disabled="disabled"
              class="w-16 h-7 rounded-default border border-datepicker-border bg-datepicker-bg text-datepicker-text text-xs px-2 outline-none focus:border-datepicker-focus-border tabular-nums disabled:opacity-50"
              data-test="datetimerange-custom-amount"
              @keydown.enter="applyCustomRelative"
            />
            <select
              v-model="customUnit"
              :disabled="disabled"
              class="flex-1 h-7 rounded-default border border-datepicker-border bg-datepicker-bg text-datepicker-text text-xs px-2 outline-none focus:border-datepicker-focus-border disabled:opacity-50"
              data-test="datetimerange-custom-unit"
            >
              <option v-for="u in RELATIVE_UNITS" :key="u" :value="u">{{ UNIT_LABELS[u] }}</option>
            </select>
          </div>

          <!-- Timezone row -->
          <div
            v-if="showTimezone"
            class="flex flex-col gap-1 pt-2 border-t border-datepicker-popup-border"
          >
            <span class="text-xs text-datepicker-relative-label">Timezone</span>
            <button
              type="button"
              :disabled="disabled"
              class="flex items-center justify-between w-full h-7 rounded-default border border-datepicker-inner-border bg-datepicker-bg text-datepicker-text text-xs px-2 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              data-test="datetimerange-timezone-trigger"
              @click="!disabled && (tzOpen = !tzOpen)"
            >
              <span class="truncate">{{ tzLabel(stagedTimezone) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="size-3 shrink-0 text-datepicker-icon transition-transform"
                :class="tzOpen ? 'rotate-180' : ''"
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
              class="rounded-default border border-datepicker-inner-border overflow-hidden"
            >
              <input
                v-model="tzSearch"
                type="text"
                placeholder="Search timezone..."
                autofocus
                class="w-full h-7 px-2 text-xs bg-datepicker-bg text-datepicker-text border-b border-datepicker-inner-border outline-none focus:border-datepicker-focus-border placeholder:text-datepicker-placeholder"
                data-test="datetimerange-timezone-search"
              />
              <div class="overflow-y-auto max-h-36 bg-datepicker-bg">
                <button
                  v-for="tz in filteredTimezones"
                  :key="tz"
                  type="button"
                  :class="[
                    'w-full text-left px-2 py-1 text-xs transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                    stagedTimezone === tz
                      ? 'bg-datepicker-day-selected-bg text-datepicker-day-selected-text'
                      : 'text-datepicker-text hover:bg-datepicker-relative-btn-hover-bg',
                  ]"
                  @click="selectTimezone(tz)"
                >
                  {{ tzLabel(tz) }}
                </button>
                <div
                  v-if="filteredTimezones.length === 0"
                  class="px-2 py-2 text-xs text-datepicker-weekday-text"
                >
                  No timezones found
                </div>
              </div>
            </div>
          </div>

          <!-- Apply -->
          <div
            v-if="!autoApply"
            class="flex justify-end pt-2 border-t border-datepicker-popup-border"
          >
            <button
              type="button"
              :disabled="disabled || stagedRelativeAmount <= 0"
              class="px-4 py-1.5 rounded-default text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base bg-datepicker-day-selected-bg text-datepicker-day-selected-text hover:opacity-90 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
              data-test="datetimerange-relative-apply"
              @click="commitRelative"
            >
              Apply
            </button>
          </div>
        </div>

        <!-- ── ABSOLUTE TAB ──────────────────────────────────── -->
        <div
          v-if="activeTab === 'absolute'"
          class="p-3 flex flex-col gap-3 overflow-y-auto max-h-[70vh]"
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
              <RangeCalendarHeader class="flex items-center justify-between mb-3">
                <RangeCalendarPrev
                  class="flex items-center justify-center size-7 rounded-default transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    class="size-4"
                    aria-hidden="true"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </RangeCalendarPrev>
                <RangeCalendarHeading class="text-sm font-medium text-datepicker-heading-text" />
                <RangeCalendarNext
                  class="flex items-center justify-center size-7 rounded-default transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    class="size-4"
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

              <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()">
                <RangeCalendarGridHead>
                  <RangeCalendarGridRow class="flex gap-1 mb-1">
                    <RangeCalendarHeadCell
                      v-for="day in weekDays"
                      :key="day"
                      class="w-8 h-6 flex items-center justify-center text-xs font-medium text-datepicker-weekday-text"
                    >
                      {{ day }}
                    </RangeCalendarHeadCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridHead>
                <RangeCalendarGridBody>
                  <RangeCalendarGridRow
                    v-for="(weekDates, idx) in month.rows"
                    :key="idx"
                    class="flex gap-1 mb-1"
                  >
                    <RangeCalendarCell
                      v-for="date in weekDates"
                      :key="date.toString()"
                      :date="date"
                    >
                      <RangeCalendarCellTrigger
                        :day="date"
                        :month="month.value"
                        class="flex items-center justify-center size-8 rounded-default text-xs cursor-pointer outline-none transition-[color,background-color,border-color,box-shadow] duration-150 ring-offset-1 ring-offset-surface-base text-datepicker-day-text hover:bg-datepicker-day-hover-bg focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring data-selected:bg-datepicker-day-selected-bg data-selected:text-datepicker-day-selected-text data-today:border data-today:border-datepicker-day-today-border data-outside-view:text-datepicker-day-outside-text data-unavailable:text-datepicker-day-disabled-text data-unavailable:cursor-not-allowed data-highlighted:bg-datepicker-day-range-bg data-highlighted:text-datepicker-day-range-text data-selection-start:bg-datepicker-day-selected-bg data-selection-start:text-datepicker-day-selected-text data-selection-end:bg-datepicker-day-selected-bg data-selection-end:text-datepicker-day-selected-text"
                        >{{ date.day }}</RangeCalendarCellTrigger
                      >
                    </RangeCalendarCell>
                  </RangeCalendarGridRow>
                </RangeCalendarGridBody>
              </RangeCalendarGrid>
            </template>
          </RangeCalendarRoot>

          <!-- Range hint -->
          <p
            v-if="rangeLabel"
            class="text-xs text-datepicker-weekday-text text-center"
            aria-live="polite"
          >
            {{ rangeLabel }}
          </p>

          <!-- Start / End time -->
          <div
            v-if="!hideTime"
            class="flex gap-3 [--color-datepicker-border:var(--color-datepicker-inner-border)]"
          >
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
          <div v-if="showTimezone" class="flex flex-col gap-1">
            <span class="text-xs text-datepicker-label">Timezone</span>
            <button
              type="button"
              :disabled="disabled"
              class="flex items-center justify-between w-full h-9 rounded-default border border-datepicker-inner-border bg-datepicker-bg text-datepicker-text text-sm px-3 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              data-test="datetimerange-timezone-trigger"
              @click="!disabled && (tzOpen = !tzOpen)"
            >
              <span class="truncate">{{ tzLabel(stagedTimezone) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="size-4 shrink-0 text-datepicker-icon transition-transform"
                :class="tzOpen ? 'rotate-180' : ''"
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
              class="rounded-default border border-datepicker-inner-border overflow-hidden"
            >
              <input
                v-model="tzSearch"
                type="text"
                placeholder="Search timezone..."
                autofocus
                class="w-full h-9 px-3 text-sm bg-datepicker-bg text-datepicker-text border-b border-datepicker-inner-border outline-none focus:border-datepicker-focus-border placeholder:text-datepicker-placeholder"
                data-test="datetimerange-timezone-search"
              />
              <div class="overflow-y-auto max-h-40 bg-datepicker-bg">
                <button
                  v-for="tz in filteredTimezones"
                  :key="tz"
                  type="button"
                  :class="[
                    'w-full text-left px-3 py-1.5 text-sm transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                    stagedTimezone === tz
                      ? 'bg-datepicker-day-selected-bg text-datepicker-day-selected-text'
                      : 'text-datepicker-text hover:bg-datepicker-relative-btn-hover-bg',
                  ]"
                  @click="selectTimezone(tz)"
                >
                  {{ tzLabel(tz) }}
                </button>
                <div
                  v-if="filteredTimezones.length === 0"
                  class="px-3 py-2 text-sm text-datepicker-weekday-text"
                >
                  No timezones found
                </div>
              </div>
            </div>
          </div>

          <!-- Apply -->
          <div v-if="!autoApply" class="flex justify-end">
            <button
              type="button"
              :disabled="disabled"
              class="px-4 py-1.5 rounded-default text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 outline-none ring-offset-1 ring-offset-surface-base bg-datepicker-day-selected-bg text-datepicker-day-selected-text hover:opacity-90 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
              data-test="datetimerange-apply"
              @click="handleApply"
            >
              Apply
            </button>
          </div>
        </div>
      </PopoverContent>
    </PopoverRoot>

    <!-- Error / help text -->
    <div v-if="errorMessage || helpText" class="flex items-center gap-2">
      <span
        v-if="errorMessage"
        class="text-xs text-datepicker-error-text leading-none"
        role="alert"
        >{{ errorMessage }}</span
      >
      <span v-else-if="helpText" class="text-xs text-datepicker-label leading-none">{{
        helpText
      }}</span>
    </div>
  </div>
</template>
