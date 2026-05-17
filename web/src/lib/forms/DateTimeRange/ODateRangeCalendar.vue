// Copyright 2026 OpenObserve Inc.
<script setup lang="ts">
import { computed } from "vue";
import {
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
import { parseDate } from "@internationalized/date";

const props = defineProps<{
  /** Start date in YYYY/MM/DD format */
  startDate?: string;
  /** End date in YYYY/MM/DD format */
  endDate?: string;
  /** Min selectable date in YYYY/MM/DD format */
  minDate?: string;
  /** Max selectable date in YYYY/MM/DD format */
  maxDate?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:startDate": [value: string];
  "update:endDate": [value: string];
}>();

function tryParseDate(s: string) {
  try {
    return parseDate(s);
  } catch {
    return undefined;
  }
}

/** Convert YYYY/MM/DD → YYYY-MM-DD for reka-ui parseDate */
function toIso(s: string) {
  return s.replace(/\//g, "-");
}

/** Convert YYYY-MM-DD → YYYY/MM/DD for the internal date format */
function fromIso(s: string) {
  return s.replace(/-/g, "/");
}

const calendarRange = computed(
  (): DateRange =>
    ({
      start: props.startDate ? tryParseDate(toIso(props.startDate)) : undefined,
      end: props.endDate ? tryParseDate(toIso(props.endDate)) : undefined,
    }) as DateRange,
);

const calendarMinDate = computed(() =>
  props.minDate ? tryParseDate(toIso(props.minDate)) : undefined,
);

const calendarMaxDate = computed(() =>
  props.maxDate ? tryParseDate(toIso(props.maxDate)) : undefined,
);

function handleRangeChange(value: DateRange | undefined) {
  if (!value) return;
  if (value.start) emit("update:startDate", fromIso(value.start.toString()));
  if (value.end) emit("update:endDate", fromIso(value.end.toString()));
}
</script>

<template>
  <RangeCalendarRoot
    :model-value="calendarRange"
    :min-value="calendarMinDate"
    :max-value="calendarMaxDate"
    :disabled="disabled"
    week-start-on="0"
    @update:model-value="handleRangeChange"
  >
    <template #default="{ weekDays, grid }">
      <RangeCalendarHeader
        class="tw:flex tw:items-center tw:justify-between tw:mb-3"
      >
        <RangeCalendarPrev
          class="tw:flex tw:items-center tw:justify-center tw:size-7 tw:rounded tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:text-datepicker-icon tw:hover:bg-datepicker-nav-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
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
          class="tw:flex tw:items-center tw:justify-center tw:size-7 tw:rounded tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:text-datepicker-icon tw:hover:bg-datepicker-nav-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring"
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

      <RangeCalendarGrid v-for="month in grid" :key="month.value.toString()">
        <RangeCalendarGridHead>
          <RangeCalendarGridRow class="tw:flex tw:gap-1 tw:mb-1">
            <RangeCalendarHeadCell
              v-for="day in weekDays"
              :key="day"
              class="tw:w-8 tw:h-6 tw:flex tw:items-center tw:justify-center tw:text-xs tw:font-medium tw:text-datepicker-weekday-text"
              >{{ day }}</RangeCalendarHeadCell
            >
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow
            v-for="(weekDates, idx) in month.rows"
            :key="idx"
            class="tw:flex tw:gap-1 tw:mb-1"
          >
            <RangeCalendarCell
              v-for="d in weekDates"
              :key="d.toString()"
              :date="d"
            >
              <RangeCalendarCellTrigger
                :day="d"
                :month="month.value"
                class="tw:flex tw:items-center tw:justify-center tw:size-8 tw:rounded tw:text-xs tw:cursor-pointer tw:outline-none tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:ring-offset-1 tw:ring-offset-surface-base tw:text-datepicker-day-text tw:hover:bg-datepicker-day-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:data-selected:bg-datepicker-day-selected-bg tw:data-selected:text-datepicker-day-selected-text tw:data-today:border tw:data-today:border-datepicker-day-today-border tw:data-outside-view:text-datepicker-day-outside-text tw:data-unavailable:text-datepicker-day-disabled-text tw:data-unavailable:cursor-not-allowed tw:data-highlighted:bg-datepicker-day-range-bg tw:data-highlighted:text-datepicker-day-range-text tw:data-selection-start:bg-datepicker-day-selected-bg tw:data-selection-start:text-datepicker-day-selected-text tw:data-selection-end:bg-datepicker-day-selected-bg tw:data-selection-end:text-datepicker-day-selected-text"
                >{{ d.day }}</RangeCalendarCellTrigger
              >
            </RangeCalendarCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridBody>
      </RangeCalendarGrid>
    </template>
  </RangeCalendarRoot>
</template>
