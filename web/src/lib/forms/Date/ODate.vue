<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { DateProps, DateEmits, DateSlots } from "./ODate.types";
import { computed, ref, useAttrs, useId } from "vue";
import {
  DatePickerRoot,
  DatePickerField,
  DatePickerInput,
  DatePickerTrigger,
  DatePickerContent,
  DatePickerCalendar,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerNext,
  DatePickerPrev,
} from "reka-ui";
import { parseDate } from "@internationalized/date";
import type { DateValue } from "@internationalized/date";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<DateProps>(), {
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
  autoApply: true,
});

const emit = defineEmits<DateEmits>();
defineSlots<DateSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

// ── Popup open state (needed to close it from Apply button) ───
const isOpen = ref(false);

function tryParse(s: string | undefined): DateValue | undefined {
  if (!s) return undefined;
  try {
    return parseDate(s) as unknown as DateValue;
  } catch {
    return undefined;
  }
}

// Bridge: YYYY-MM-DD string → CalendarDate
const rekaValue = computed(() => tryParse(props.modelValue));

// Staged selection for autoApply=false mode
const stagedDate = ref<DateValue | undefined>(rekaValue.value);

// What the calendar shows — staged when manual apply, live otherwise
const calendarValue = computed(() =>
  props.autoApply === false ? stagedDate.value : rekaValue.value,
);

const rekaMin = computed(() => tryParse(props.min));
const rekaMax = computed(() => tryParse(props.max));

function handleDateChange(value: DateValue | null | undefined) {
  stagedDate.value = value ?? undefined;
  if (props.autoApply !== false) {
    const str = value ? value.toString() : "";
    emit("update:modelValue", str);
    emit("change", str);
  }
}

function handleApply() {
  const str = stagedDate.value ? stagedDate.value.toString() : "";
  emit("update:modelValue", str);
  emit("change", str);
  isOpen.value = false;
}

function handleClear() {
  stagedDate.value = undefined;
  emit("update:modelValue", "");
  emit("clear");
}

function onFocusIn(e: FocusEvent) {
  const wrapper = e.currentTarget as HTMLElement;
  if (!wrapper.contains(e.relatedTarget as Node | null)) {
    emit("focus", e);
  }
}

function onFocusOut(e: FocusEvent) {
  const wrapper = e.currentTarget as HTMLElement;
  if (!wrapper.contains(e.relatedTarget as Node | null)) {
    emit("blur", e);
  }
}

const heightClasses: Record<NonNullable<DateProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-xs",
  md: "tw:h-10 tw:text-sm",
};

const wrapperClasses = computed(() => [
  "tw:flex tw:items-center tw:w-full tw:rounded-md tw:border tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150",
  "tw:ring-offset-1 tw:ring-offset-surface-base",
  "tw:bg-datepicker-bg",
  hasError.value
    ? "tw:border-datepicker-error-border"
    : "tw:border-datepicker-border tw:hover:border-datepicker-hover-border",
  "tw:focus-within:border-datepicker-focus-border",
  "tw:focus-within:ring-2 tw:focus-within:ring-datepicker-focus-ring",
  props.disabled
    ? "tw:bg-datepicker-disabled-bg tw:border-datepicker-disabled-border tw:opacity-60"
    : "",
  heightClasses[props.size ?? "md"],
]);
</script>

<template>
  <div v-bind="$attrs" class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-datepicker-label tw:leading-none tw:flex tw:items-center tw:gap-1"
    >
      <slot name="label">{{ label }}</slot>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help tw:text-datepicker-label"
      ><slot name="tooltip" /></OIcon>
    </label>

    <DatePickerRoot
      v-model:open="isOpen"
      :model-value="autoApply === false ? stagedDate : rekaValue"
      :min-value="rekaMin"
      :max-value="rekaMax"
      :disabled="disabled"
      :readonly="readonly"
      :name="name"
      @update:model-value="handleDateChange"
    >
      <div
        :class="wrapperClasses"
        :aria-invalid="hasError || undefined"
        role="group"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
      >
        <!-- Calendar trigger (calendar icon) -->
        <DatePickerTrigger
          class="tw:flex tw:items-center tw:ps-3 tw:text-datepicker-icon tw:shrink-0 tw:outline-none tw:cursor-pointer tw:disabled:cursor-not-allowed"
          aria-label="Open calendar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-4"
            aria-hidden="true"
          >
            <path
              d="M4 1.5a.5.5 0 0 1 .5.5V3h7V2a.5.5 0 0 1 1 0v1h.5A1.5 1.5 0 0 1 14.5 4.5v9A1.5 1.5 0 0 1 13 15H3a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 3 3h.5V2a.5.5 0 0 1 .5-.5Zm-1.5 4v8a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-8h-11Z"
            />
          </svg>
        </DatePickerTrigger>

        <!-- Segmented date field -->
        <DatePickerField
          :id="inputId"
          :class="[
            'tw:flex tw:items-center tw:flex-1 tw:min-w-0 tw:ps-2 tw:gap-px tw:outline-none',
            clearable ? 'tw:pe-2' : 'tw:pe-3',
            heightClasses[size ?? 'md'],
          ]"
        >
          <template #default="{ segments }">
            <template v-for="seg in segments" :key="seg.part">
              <DatePickerInput
                :part="seg.part"
                :class="[
                  'tw:text-datepicker-text',
                  seg.part !== 'literal'
                    ? 'tw:rounded-sm tw:px-px tw:outline-none tw:tabular-nums tw:data-placeholder:text-datepicker-placeholder tw:focus:bg-datepicker-segment-focus-bg tw:focus:text-datepicker-segment-focus-text'
                    : 'tw:select-none tw:text-datepicker-placeholder',
                ]"
              >{{ seg.value }}</DatePickerInput>
            </template>
          </template>
        </DatePickerField>

        <!-- Clear button -->
        <button
          v-if="clearable && modelValue"
          type="button"
          tabindex="-1"
          aria-label="Clear"
          class="tw:flex tw:items-center tw:pe-2 tw:text-datepicker-icon tw:hover:opacity-80 tw:transition-colors"
          @click="handleClear"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-3.5"
            aria-hidden="true"
          >
            <path
              d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
            />
          </svg>
        </button>
      </div>

      <!-- Calendar popup -->
      <DatePickerContent
        :side-offset="4"
        align="start"
        class="tw:z-50 tw:rounded-lg tw:border tw:shadow-md tw:p-3 tw:bg-datepicker-popup-bg tw:border-datepicker-popup-border"
      >
        <DatePickerCalendar v-slot="{ weekDays, grid }">
          <DatePickerHeader
            class="tw:flex tw:items-center tw:justify-between tw:mb-3"
          >
            <DatePickerPrev
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
            </DatePickerPrev>

            <DatePickerHeading
              class="tw:text-sm tw:font-medium tw:text-datepicker-heading-text"
            />

            <DatePickerNext
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
            </DatePickerNext>
          </DatePickerHeader>

          <DatePickerGrid
            v-for="month in grid"
            :key="month.value.toString()"
          >
            <DatePickerGridHead>
              <DatePickerGridRow class="tw:flex tw:gap-1 tw:mb-1">
                <DatePickerHeadCell
                  v-for="day in weekDays"
                  :key="day"
                  class="tw:w-8 tw:h-6 tw:flex tw:items-center tw:justify-center tw:text-xs tw:font-medium tw:text-datepicker-weekday-text"
                >
                  {{ day }}
                </DatePickerHeadCell>
              </DatePickerGridRow>
            </DatePickerGridHead>

            <DatePickerGridBody>
              <DatePickerGridRow
                v-for="(weekDates, idx) in month.rows"
                :key="idx"
                class="tw:flex tw:gap-1 tw:mb-1"
              >
                <DatePickerCell
                  v-for="date in weekDates"
                  :key="date.toString()"
                  :date="date"
                >
                  <DatePickerCellTrigger
                    :day="date"
                    :month="month.value"
                    class="tw:flex tw:items-center tw:justify-center tw:size-8 tw:rounded tw:text-xs tw:cursor-pointer tw:outline-none tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:ring-offset-1 tw:ring-offset-surface-base tw:text-datepicker-day-text tw:hover:bg-datepicker-day-hover-bg tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:data-selected:bg-datepicker-day-selected-bg tw:data-selected:text-datepicker-day-selected-text tw:data-today:border tw:data-today:border-datepicker-day-today-border tw:data-outside-view:text-datepicker-day-outside-text tw:data-unavailable:text-datepicker-day-disabled-text tw:data-unavailable:cursor-not-allowed tw:data-unavailable:hover:bg-transparent"
                  >
                    {{ date.day }}
                  </DatePickerCellTrigger>
                </DatePickerCell>
              </DatePickerGridRow>
            </DatePickerGridBody>
          </DatePickerGrid>
        </DatePickerCalendar>

        <!-- Apply button (only when autoApply=false) -->
        <div v-if="autoApply === false" class="tw:flex tw:justify-end tw:mt-2 tw:pt-2 tw:border-t tw:border-datepicker-popup-border">
          <button
            type="button"
            :disabled="disabled"
            class="tw:px-4 tw:py-1.5 tw:rounded tw:text-xs tw:font-medium tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:hover:opacity-90 tw:transition-[box-shadow] tw:duration-150 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:disabled:opacity-50 tw:disabled:cursor-not-allowed"
            @click="handleApply"
          >Apply</button>
        </div>
      </DatePickerContent>
    </DatePickerRoot>

    <div v-if="effectiveError || helpText" class="tw:flex tw:items-center tw:gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-datepicker-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-datepicker-label tw:leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
