<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { DateRangeCalendarProps, DateRangeCalendarEmits } from "./ODateRangeCalendar.types";
import { computed, ref, watch, type Ref } from "vue";
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
import type { DateRange, DateValue } from "reka-ui";
import { parseDate } from "@internationalized/date";

const props = defineProps<DateRangeCalendarProps>();
const emit = defineEmits<DateRangeCalendarEmits>();

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

// Internal calendar state. We do NOT commit to parent until both ends are
// picked, so the parent's startDate/endDate stay valid (avoiding "[object
// Object]" display artifacts from formatters that assume both are non-empty).
// Casts: ref() deep-unwraps DateValue's class type structurally, breaking DateValue params
const internalStart = ref<DateValue | undefined>(undefined) as Ref<DateValue | undefined>;
const internalEnd = ref<DateValue | undefined>(undefined) as Ref<DateValue | undefined>;
// Tracks the hovered cell while awaiting the second click — used to render
// the dashed preview range only between start and hover (not all valid-to-pick
// cells, which is what reka-ui's data-highlighted alone would give us).
const hoverDate = ref<DateValue | undefined>(undefined) as Ref<DateValue | undefined>;

// Resync internal state when parent provides new dates (initial load, external
// changes, or after a committed range round-trip).
// NOTE: use the array-of-getters form `[() => …, () => …]` rather than
// `() => [props.startDate, props.endDate]` — the latter returns a fresh array
// on every render and fires the watcher every tick, which would clobber the
// in-progress preview state.
watch(
  [() => props.startDate, () => props.endDate],
  ([newStart, newEnd]) => {
    internalStart.value = newStart ? tryParseDate(toIso(newStart)) : undefined;
    internalEnd.value = newEnd ? tryParseDate(toIso(newEnd)) : undefined;
    hoverDate.value = undefined;
  },
  { immediate: true },
);

const calendarRange = computed(
  (): DateRange =>
    ({
      start: internalStart.value,
      end: internalEnd.value,
    }) as DateRange,
);

const calendarMinDate = computed(() =>
  props.minDate ? tryParseDate(toIso(props.minDate)) : undefined,
);

const calendarMaxDate = computed(() =>
  props.maxDate ? tryParseDate(toIso(props.maxDate)) : undefined,
);

// "Awaiting second click" — start is picked but end isn't. While in this
// state, cells get a dashed-outline preview based on hover position.
const isAwaitingEndClick = computed(() => !!internalStart.value && !internalEnd.value);

function isCellInPreview(d: DateValue): boolean {
  if (!isAwaitingEndClick.value || !hoverDate.value || !internalStart.value) {
    return false;
  }
  const start = internalStart.value;
  const hover = hoverDate.value;
  const lo = hover.compare(start) < 0 ? hover : start;
  const hi = hover.compare(start) < 0 ? start : hover;
  return d.compare(lo) >= 0 && d.compare(hi) <= 0;
}

function handleCellMouseEnter(d: DateValue) {
  if (isAwaitingEndClick.value) {
    hoverDate.value = d;
  }
}

function handleRangeChange(value: DateRange | undefined) {
  if (!value) return;
  let start = value.start;
  let end = value.end;

  // Auto-swap when user picks end-before-start (e.g., clicked May 15 first,
  // then May 10) — they're picking a range in reverse direction.
  if (start && end && end.compare(start) < 0) {
    [start, end] = [end, start];
  }

  internalStart.value = start;
  internalEnd.value = end;
  // Reset hover state on any click — it's stale by definition.
  hoverDate.value = undefined;

  // Only commit to parent when we have a complete range. While only start is
  // picked, we keep the parent's old (valid) range in place so the trigger's
  // display string doesn't break.
  if (start && end) {
    emit("update:startDate", fromIso(start.toString()));
    emit("update:endDate", fromIso(end.toString()));
  }
}
</script>

<template>
  <RangeCalendarRoot
    :model-value="calendarRange"
    :min-value="calendarMinDate"
    :max-value="calendarMaxDate"
    :disabled="disabled"
    week-start-on="0"
    :class="['o-range-cal', isAwaitingEndClick ? 'o-range-cal--awaiting' : 'o-range-cal--complete']"
    data-test="daterangecalendar-root"
    @update:model-value="handleRangeChange"
  >
    <template #default="{ weekDays, grid }">
      <RangeCalendarHeader class="mb-3 flex items-center justify-between">
        <RangeCalendarPrev
          class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex size-7 items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
          data-test="daterangecalendar-prev"
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
        <RangeCalendarHeading
          class="text-datepicker-heading-text text-sm font-medium"
          data-test="daterangecalendar-heading"
        />
        <RangeCalendarNext
          class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex size-7 items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
          data-test="daterangecalendar-next"
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
          <RangeCalendarGridRow class="mb-1 flex gap-1">
            <RangeCalendarHeadCell
              v-for="day in weekDays"
              :key="day"
              class="text-datepicker-weekday-text flex h-6 w-8 items-center justify-center text-xs font-medium"
              >{{ day }}</RangeCalendarHeadCell
            >
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow
            v-for="(weekDates, idx) in month.rows"
            :key="idx"
            class="mb-1 flex gap-1"
          >
            <RangeCalendarCell v-for="d in weekDates" :key="d.toString()" :date="d">
              <RangeCalendarCellTrigger
                :day="d"
                :month="month.value"
                :data-test="`daterangecalendar-cell-${d.toString()}`"
                :data-preview="isCellInPreview(d) ? '' : undefined"
                @mouseenter="handleCellMouseEnter(d)"
                class="rounded-default ring-offset-surface-base text-datepicker-day-text hover:bg-datepicker-day-hover-bg focus-visible:ring-datepicker-focus-ring data-selected:bg-datepicker-day-selected-bg data-selected:text-datepicker-day-selected-text data-today:border-datepicker-day-today-border data-outside-view:text-datepicker-day-outside-text data-unavailable:text-datepicker-day-disabled-text data-disabled:text-datepicker-day-disabled-text data-highlighted:bg-datepicker-day-range-bg data-highlighted:text-datepicker-day-range-text data-selection-start:bg-datepicker-day-selected-bg data-selection-start:text-datepicker-day-selected-text data-selection-end:bg-datepicker-day-selected-bg data-selection-end:text-datepicker-day-selected-text flex size-8 cursor-pointer items-center justify-center text-xs ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-today:border data-unavailable:pointer-events-none data-unavailable:cursor-not-allowed"
                >{{ d.day }}</RangeCalendarCellTrigger
              >
            </RangeCalendarCell>
          </RangeCalendarGridRow>
        </RangeCalendarGridBody>
      </RangeCalendarGrid>
    </template>
  </RangeCalendarRoot>
</template>

<style scoped>
/* keep(lib-override:reka-ui): while awaiting the second click, reka flags every
   still-pickable cell with [data-highlighted] (start → max-date), washing out
   the future calendar. Strip that and paint only our own [data-preview] cells
   (set between start and hover). The :not([data-selected]) guards keep the
   chosen start cell's solid background. Targets reka-generated cell DOM state,
   so the selectors need :deep. */
.o-range-cal--awaiting :deep([data-highlighted]:not([data-selected])) {
  background-color: transparent;
  color: inherit;
}
.o-range-cal--awaiting :deep([data-preview]:not([data-selected])) {
  background-color: var(--color-datepicker-day-range-bg);
  color: var(--color-datepicker-day-range-text);
  outline: 1px dashed currentColor;
  outline-offset: -0.125rem;
}
</style>
