<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { DateProps, DateEmits, DateSlots } from "./ODate.types";
import { computed, ref, useAttrs, useId, type Ref } from "vue";
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

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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

const effectiveError = computed(() => props.errorMessage || (props.error ? " " : null) || null);
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
// Cast: ref() deep-unwraps DateValue's class type structurally, breaking DateValue bindings
const stagedDate = ref<DateValue | undefined>(rekaValue.value) as Ref<DateValue | undefined>;

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
  sm: "h-6 text-sm",
  md: "h-8.5 text-sm",
};

const wrapperClasses = computed(() => [
  "flex items-center w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "ring-offset-1 ring-offset-surface-base",
  "bg-datepicker-bg",
  hasError.value
    ? "border-datepicker-error-border"
    : "border-datepicker-border hover:border-datepicker-hover-border",
  "focus-within:border-datepicker-focus-border",
  "focus-within:ring-[0.125rem] focus-within:ring-primary-500/25",
  props.disabled ? "bg-datepicker-disabled-bg border-datepicker-disabled-border opacity-60" : "",
  heightClasses[props.size ?? "md"],
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex w-full flex-col gap-1">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="o-input-label flex items-center gap-1 text-sm leading-tight font-semibold"
    >
      <slot name="label">{{ label }}</slot
      ><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="text-datepicker-label cursor-help"
        ><slot name="tooltip"
      /></OIcon>
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
        :data-test="parentDataTest ? `${parentDataTest}-group` : undefined"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
      >
        <!-- Calendar trigger (calendar icon) -->
        <DatePickerTrigger
          class="text-datepicker-icon flex shrink-0 cursor-pointer items-center ps-3 outline-none disabled:cursor-not-allowed"
          aria-label="Open calendar"
        >
          <OIcon name="calendar-month" size="sm" aria-hidden="true" />
        </DatePickerTrigger>

        <!-- Segmented date field -->
        <DatePickerField
          :id="inputId"
          :tabindex="inputTabindex"
          :class="[
            'flex min-w-0 flex-1 items-center gap-px ps-2 outline-none',
            clearable ? 'pe-2' : 'pe-3',
            heightClasses[size ?? 'md'],
          ]"
        >
          <template #default="{ segments }">
            <template v-for="seg in segments" :key="seg.part">
              <DatePickerInput
                :part="seg.part"
                :class="[
                  'text-datepicker-text',
                  seg.part !== 'literal'
                    ? 'rounded-default data-placeholder:text-datepicker-placeholder focus:bg-datepicker-segment-focus-bg focus:text-datepicker-segment-focus-text focus:data-placeholder:text-datepicker-segment-focus-text px-px tabular-nums outline-none'
                    : 'text-datepicker-placeholder select-none',
                ]"
                >{{ seg.value }}</DatePickerInput
              >
            </template>
          </template>
        </DatePickerField>

        <!-- Clear button -->
        <button
          v-if="clearable && modelValue"
          type="button"
          tabindex="-1"
          aria-label="Clear"
          class="text-datepicker-icon flex items-center pe-2 transition-colors hover:opacity-80"
          @click="handleClear"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="size-3.5"
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
        class="rounded-default bg-datepicker-popup-bg border-datepicker-popup-border z-50 border p-3 shadow-md"
      >
        <DatePickerCalendar v-slot="{ weekDays, grid }">
          <DatePickerHeader class="mb-3 flex items-center justify-between">
            <DatePickerPrev
              class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex size-7 items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2"
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
            </DatePickerPrev>

            <DatePickerHeading class="text-datepicker-heading-text text-sm font-medium" />

            <DatePickerNext
              class="rounded-default ring-offset-surface-base text-datepicker-icon hover:bg-datepicker-nav-hover-bg focus-visible:ring-datepicker-focus-ring flex size-7 items-center justify-center ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2"
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
            </DatePickerNext>
          </DatePickerHeader>

          <DatePickerGrid v-for="month in grid" :key="month.value.toString()">
            <DatePickerGridHead>
              <DatePickerGridRow class="mb-1 flex gap-1">
                <DatePickerHeadCell
                  v-for="day in weekDays"
                  :key="day"
                  class="text-datepicker-weekday-text flex h-6 w-8 items-center justify-center text-xs font-medium"
                >
                  {{ day }}
                </DatePickerHeadCell>
              </DatePickerGridRow>
            </DatePickerGridHead>

            <DatePickerGridBody>
              <DatePickerGridRow
                v-for="(weekDates, idx) in month.rows"
                :key="idx"
                class="mb-1 flex gap-1"
              >
                <DatePickerCell v-for="date in weekDates" :key="date.toString()" :date="date">
                  <DatePickerCellTrigger
                    :day="date"
                    :month="month.value"
                    class="rounded-default ring-offset-surface-base text-datepicker-day-text hover:bg-datepicker-day-hover-bg focus-visible:ring-datepicker-focus-ring data-selected:bg-datepicker-day-selected-bg data-selected:text-datepicker-day-selected-text data-today:border-datepicker-day-today-border data-outside-view:text-datepicker-day-outside-text data-unavailable:text-datepicker-day-disabled-text flex size-8 cursor-pointer items-center justify-center text-xs ring-offset-1 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none focus-visible:ring-2 data-today:border data-unavailable:cursor-not-allowed data-unavailable:hover:bg-transparent"
                  >
                    {{ date.day }}
                  </DatePickerCellTrigger>
                </DatePickerCell>
              </DatePickerGridRow>
            </DatePickerGridBody>
          </DatePickerGrid>
        </DatePickerCalendar>

        <!-- Apply button (only when autoApply=false) -->
        <div
          v-if="autoApply === false"
          class="border-datepicker-popup-border mt-2 flex justify-end border-t pt-2"
        >
          <button
            type="button"
            :disabled="disabled"
            class="rounded-default bg-datepicker-day-selected-bg text-datepicker-day-selected-text ring-offset-surface-base focus-visible:ring-datepicker-focus-ring px-4 py-1.5 text-xs font-medium ring-offset-1 transition-[box-shadow] duration-150 outline-none hover:opacity-90 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            @click="handleApply"
          >
            Apply
          </button>
        </div>
      </DatePickerContent>
    </DatePickerRoot>

    <div v-if="effectiveError || helpText" class="flex items-center gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="text-datepicker-error-text text-xs leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span v-else-if="helpText" class="text-datepicker-label text-xs leading-none">
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
