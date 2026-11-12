<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  DateRangeCalendarProps,
  DateRangeCalendarEmits,
  DateRangeCalendarExposed,
} from "./ODateRangeCalendar.types";
import { computed, nextTick, onMounted, ref, watch, type Ref } from "vue";
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

const rowClass = computed(() => (props.fill ? "grid grid-cols-7" : "mb-1 flex gap-1"));
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
// The hovered or focused cell while awaiting the second pick, so only start → it previews.
const hoverDate = ref<DateValue | undefined>(undefined) as Ref<DateValue | undefined>;
const rootEl = ref<{ $el?: HTMLElement } | null>(null);

const syncFromProps = () => {
  const hidden = props.hideSelection;
  internalStart.value =
    props.startDate && !hidden ? tryParseDate(toIso(props.startDate)) : undefined;
  internalEnd.value = props.endDate && !hidden ? tryParseDate(toIso(props.endDate)) : undefined;
  hoverDate.value = undefined;
};

// Array-of-getters form, so a fresh array per render never clobbers the in-progress preview.
watch([() => props.startDate, () => props.endDate], syncFromProps, { immediate: true });
// A first pick from a hidden (rolling) selection unhides it; the pick must stay a lone start.
watch(
  () => props.hideSelection,
  () => {
    if (internalStart.value && !internalEnd.value) return;
    syncFromProps();
  },
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

const unavailableFloor = computed(() =>
  props.unavailableBefore ? tryParseDate(toIso(props.unavailableBefore)) : undefined,
);

const isDateUnavailable = (d: DateValue): boolean =>
  !!unavailableFloor.value && d.compare(unavailableFloor.value) < 0;

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

const isPreviewEnd = (d: DateValue): boolean =>
  isAwaitingEndClick.value && !!hoverDate.value && hoverDate.value.compare(d) === 0;

// The band runs behind the day cells so the tint is continuous across a week row.
function bandClass(d: DateValue): string {
  const start = internalStart.value;
  const end = internalEnd.value;
  if (!props.bandRange || !start || !end || start.compare(end) === 0) return "";
  if (d.compare(start) < 0 || d.compare(end) > 0) return "";
  const edge =
    d.compare(start) === 0 ? "before:start-1/2" : d.compare(end) === 0 ? "before:end-1/2" : "";
  return `before:bg-datepicker-day-range-bg before:absolute before:inset-y-0 before:start-0 before:end-0 ${edge}`;
}

// Today is a dot under the number, so it never reads as a selected or boxed day.
const todayClass = computed(() => {
  if (!props.bandRange) return "data-today:border data-today:border-datepicker-day-today-border";
  return "o-range-cal__today data-today:font-semibold";
});

const setHover = (d: DateValue | undefined) => {
  if (!isAwaitingEndClick.value) return;
  hoverDate.value = d;
  emit("update:previewDate", d ? fromIso(d.toString()) : null);
};

function handleCellMouseEnter(d: DateValue) {
  setHover(d);
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
  hoverDate.value = undefined;
  emit("update:previewDate", null);

  // Only commit to parent when we have a complete range. While only start is
  // picked, we keep the parent's old (valid) range in place so the trigger's
  // display string doesn't break.
  if (start && end) {
    emit("update:startDate", fromIso(start.toString()));
    emit("update:endDate", fromIso(end.toString()));
  }
  emit("update:pendingDate", start && !end ? fromIso(start.toString()) : null);
}

const rootElement = (): HTMLElement | null => rootEl.value?.$el ?? null;

// Other months are reached through reka's own month buttons, then the cell is looked up once it is drawn.
const focusDay = async (from: DateValue, d: DateValue) => {
  const months = (d.year - from.year) * 12 + (d.month - from.month);
  const button = rootElement()?.querySelector<HTMLElement>(
    `[data-test='daterangecalendar-${months < 0 ? "prev" : "next"}']`,
  );
  for (let step = 0; step < Math.abs(months); step += 1) {
    button?.click();
    await nextTick();
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nextTick();
    const cell = rootElement()?.querySelector<HTMLElement>(
      `[data-value='${d.toString()}']:not([data-outside-view])`,
    );
    if (cell) {
      cell.focus();
      return;
    }
  }
};

// Reka moves by day and week only; months and week ends follow the date-grid pattern.
const keyedDay = (event: KeyboardEvent, d: DateValue): DateValue | null => {
  const weekStart = props.weekStartsOn ?? 0;
  const column = (d.toDate("UTC").getUTCDay() - weekStart + 7) % 7;
  if (event.key === "PageUp") return d.subtract(event.shiftKey ? { years: 1 } : { months: 1 });
  if (event.key === "PageDown") return d.add(event.shiftKey ? { years: 1 } : { months: 1 });
  if (event.key === "Home") return d.subtract({ days: column });
  if (event.key === "End") return d.add({ days: 6 - column });
  return null;
};

const clampDay = (d: DateValue): DateValue => {
  if (calendarMinDate.value && d.compare(calendarMinDate.value) < 0) return calendarMinDate.value;
  if (calendarMaxDate.value && d.compare(calendarMaxDate.value) > 0) return calendarMaxDate.value;
  return d;
};

const onGridKeydown = (event: KeyboardEvent) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const value = target.getAttribute("data-value");
  const day = value ? tryParseDate(value) : undefined;
  if (!day) return;
  const next = keyedDay(event, day);
  if (!next) return;
  event.preventDefault();
  const landed = clampDay(next);
  setHover(landed);
  void focusDay(day, landed);
};

const onGridFocusin = (event: FocusEvent) => {
  const value =
    event.target instanceof HTMLElement ? event.target.getAttribute("data-value") : null;
  const day = value ? tryParseDate(value) : undefined;
  if (day) setHover(day);
};

const clearPending = (): boolean => {
  if (!isAwaitingEndClick.value) return false;
  syncFromProps();
  emit("update:previewDate", null);
  emit("update:pendingDate", null);
  return true;
};

defineExpose<DateRangeCalendarExposed>({ clearPending });

onMounted(async () => {
  if (!props.autoFocus) return;
  await nextTick();
  const root = rootElement();
  const cell =
    root?.querySelector<HTMLElement>("[data-selection-start]:not([data-outside-view])") ??
    root?.querySelector<HTMLElement>("[data-today]:not([data-outside-view])") ??
    root?.querySelector<HTMLElement>("[data-reka-calendar-cell-trigger][tabindex='0']");
  cell?.focus();
});
</script>

<template>
  <RangeCalendarRoot
    ref="rootEl"
    :model-value="calendarRange"
    :locale="locale"
    :calendar-label="calendarLabel"
    :is-date-unavailable="unavailableFloor ? isDateUnavailable : undefined"
    :min-value="calendarMinDate"
    :max-value="calendarMaxDate"
    :disabled="disabled"
    :prevent-deselect="preventDeselect"
    :week-starts-on="weekStartsOn ?? 0"
    :class="[
      'o-range-cal',
      isAwaitingEndClick ? 'o-range-cal--awaiting' : 'o-range-cal--complete',
      { 'o-range-cal--band': bandRange, 'w-full': fill },
    ]"
    data-test="daterangecalendar-root"
    @update:model-value="handleRangeChange"
    @keydown="onGridKeydown"
    @focusin="onGridFocusin"
  >
    <template #default="{ weekDays, grid }">
      <RangeCalendarHeader
        class="flex items-center justify-between"
        :class="compact ? 'mb-0.5' : fill ? 'mb-1' : 'mb-3'"
      >
        <RangeCalendarPrev
          class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
          :class="compact ? 'size-6' : 'size-7'"
          :aria-label="prevLabel"
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
          class="text-datepicker-heading-text"
          :class="fill ? 'text-compact font-semibold' : 'text-sm font-medium'"
          data-test="daterangecalendar-heading"
        />
        <RangeCalendarNext
          class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40"
          :class="compact ? 'size-6' : 'size-7'"
          :aria-label="nextLabel"
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

      <RangeCalendarGrid
        v-for="month in grid"
        :key="month.value.toString()"
        :class="fill ? 'w-full' : undefined"
      >
        <RangeCalendarGridHead>
          <RangeCalendarGridRow :class="rowClass">
            <RangeCalendarHeadCell
              v-for="day in weekDays"
              :key="day"
              class="text-datepicker-weekday-text flex items-center justify-center text-xs font-medium"
              :class="[fill ? 'w-full' : 'w-8', compact ? 'h-5' : 'h-6']"
              >{{ day }}</RangeCalendarHeadCell
            >
          </RangeCalendarGridRow>
        </RangeCalendarGridHead>
        <RangeCalendarGridBody>
          <RangeCalendarGridRow v-for="(weekDates, idx) in month.rows" :key="idx" :class="rowClass">
            <RangeCalendarCell
              v-for="d in weekDates"
              :key="d.toString()"
              :date="d"
              class="relative"
              :class="bandClass(d)"
            >
              <RangeCalendarCellTrigger
                :day="d"
                :month="month.value"
                :data-test="`daterangecalendar-cell-${d.toString()}`"
                :data-preview="isCellInPreview(d) ? '' : undefined"
                :data-preview-end="isPreviewEnd(d) ? '' : undefined"
                :title="isDateUnavailable(d) ? unavailableReason : undefined"
                @mouseenter="handleCellMouseEnter(d)"
                :class="[
                  bandRange
                    ? 'text-compact relative mx-auto w-8'
                    : fill
                      ? 'w-full text-xs'
                      : 'w-8 text-xs',
                  todayClass,
                  compact ? 'h-6.5' : 'h-8',
                ]"
                class="rounded-default ring-offset-surface-base text-datepicker-day-text hover:bg-datepicker-day-hover-bg focus-visible:ring-datepicker-focus-ring data-selected:bg-datepicker-day-selected-bg data-selected:text-datepicker-day-selected-text data-outside-view:text-datepicker-day-outside-text data-unavailable:text-datepicker-day-disabled-text data-disabled:text-datepicker-day-disabled-text data-highlighted:bg-datepicker-day-range-bg data-highlighted:text-datepicker-day-range-text data-selection-start:bg-datepicker-day-selected-bg data-selection-start:text-datepicker-day-selected-text data-selection-end:bg-datepicker-day-selected-bg data-selection-end:text-datepicker-day-selected-text flex cursor-pointer items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-unavailable:cursor-not-allowed data-unavailable:line-through"
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
  background-color: var(--color-surface-accent-hover);
  color: var(--color-datepicker-day-range-text);
}
.o-range-cal--awaiting :deep([data-preview-end]:not([data-selected])) {
  /* eslint-disable-next-line local/no-hardcoded-px -- hairline: the would-be end's 1-device-pixel ring must not scale with text */
  outline: 1px solid var(--color-accent);
  outline-offset: -0.125rem;
}
/* keep(lib-override:reka-ui): reka marks the whole range [data-selected]; the band keeps both ends solid and the cell behind paints the tint between. */
.o-range-cal--band :deep([data-selected]:not([data-selection-start]):not([data-selection-end])) {
  background-color: transparent;
  color: var(--color-datepicker-day-range-text);
}
.o-range-cal :deep(.o-range-cal__today[data-today]::after) {
  content: "";
  position: absolute;
  bottom: 0.125rem;
  inset-inline-start: 50%;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: var(--radius-full);
  background-color: currentColor;
  transform: translateX(-50%);
}
/* Forced colours drop backgrounds, so selection and preview carry system colours and an outline. */
@media (forced-colors: active) {
  .o-range-cal :deep([data-selection-start]),
  .o-range-cal :deep([data-selection-end]),
  .o-range-cal--band :deep([data-selected]) {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
  .o-range-cal--awaiting :deep([data-preview]:not([data-selected])) {
    outline: 0.125rem solid Highlight;
  }
  .o-range-cal :deep([data-disabled]),
  .o-range-cal :deep([data-unavailable]) {
    color: GrayText;
  }
  .o-range-cal :deep(.o-range-cal__today[data-today]::after) {
    background-color: CanvasText;
  }
}
</style>
