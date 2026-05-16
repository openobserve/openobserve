<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { TimeProps, TimeEmits, TimeSlots } from "./OTime.types";
import { computed, ref, useAttrs, useId, watch } from "vue";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<TimeProps>(), {
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
  withSeconds: false,
});

const emit = defineEmits<TimeEmits>();
defineSlots<TimeSlots>();

const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
const hasError = computed(() => !!effectiveError.value);

// ── Popover state ──────────────────────────────────────────────
const popoverOpen = ref(false);

// ── Analog clock state ─────────────────────────────────────────
type ClockMode = "hour" | "minute" | "second";
const clockMode = ref<ClockMode>("hour");
const internalHour = ref(0);   // 0-23
const internalMinute = ref(0); // 0-59
const internalSecond = ref(0); // 0-59

const isAM = computed(() => internalHour.value < 12);

watch(popoverOpen, (open) => {
  if (!open) return;
  clockMode.value = "hour";
  if (!props.modelValue) {
    internalHour.value = 0;
    internalMinute.value = 0;
    internalSecond.value = 0;
    return;
  }
  const parts = props.modelValue.split(":").map(Number);
  internalHour.value = parts[0] ?? 0;
  internalMinute.value = parts[1] ?? 0;
  internalSecond.value = parts[2] ?? 0;
});

watch(
  () => props.modelValue,
  (val) => {
    if (!popoverOpen.value || !val) return;
    const parts = val.split(":").map(Number);
    internalHour.value = parts[0] ?? 0;
    internalMinute.value = parts[1] ?? 0;
    internalSecond.value = parts[2] ?? 0;
  },
);

// ── SVG clock geometry ─────────────────────────────────────────
const SVG_CX = 110;
const SVG_CY = 110;
const NUM_RADIUS = 82;
const HAND_RADIUS = 68;

function calcPos(index: number, total: number, radius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    x: SVG_CX + radius * Math.cos(angle),
    y: SVG_CY + radius * Math.sin(angle),
  };
}

interface ClockNum {
  value: number;
  label: string;
  x: number;
  y: number;
}

const clockNumbers = computed((): ClockNum[] => {
  if (clockMode.value === "hour") {
    return Array.from({ length: 12 }, (_, i) => {
      const h = i + 1;
      const index = h % 12;
      const pos = calcPos(index, 12, NUM_RADIUS);
      return { value: h, label: String(h), ...pos };
    });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const pos = calcPos(i, 12, NUM_RADIUS);
    return { value: i * 5, label: String(i * 5).padStart(2, "0"), ...pos };
  });
});

const handPos = computed(() => {
  let index: number;
  if (clockMode.value === "hour") {
    index = internalHour.value % 12;
  } else {
    const val =
      clockMode.value === "minute" ? internalMinute.value : internalSecond.value;
    index = Math.floor(val / 5) % 12;
  }
  return calcPos(index, 12, HAND_RADIUS);
});

function isClockNumSelected(num: ClockNum): boolean {
  if (clockMode.value === "hour") {
    return (internalHour.value % 12 || 12) === num.value;
  }
  const val =
    clockMode.value === "minute" ? internalMinute.value : internalSecond.value;
  return Math.floor(val / 5) * 5 === num.value;
}

// ── Clock interactions ─────────────────────────────────────────
function onClockClick(num: ClockNum) {
  if (props.disabled || props.readonly) return;

  if (clockMode.value === "hour") {
    const h12 = num.value;
    const h24 = isAM.value
      ? h12 === 12 ? 0 : h12
      : h12 === 12 ? 12 : h12 + 12;
    internalHour.value = h24;
    clockMode.value = "minute";
    emitCurrentValue();
  } else if (clockMode.value === "minute") {
    internalMinute.value = num.value;
    emitCurrentValue();
    if (props.withSeconds) {
      clockMode.value = "second";
    } else {
      popoverOpen.value = false;
    }
  } else {
    internalSecond.value = num.value;
    emitCurrentValue();
    popoverOpen.value = false;
  }
}

function setAM() {
  if (!isAM.value) {
    internalHour.value -= 12;
    emitCurrentValue();
  }
}

function setPM() {
  if (isAM.value) {
    internalHour.value += 12;
    emitCurrentValue();
  }
}

function emitCurrentValue() {
  const h = String(internalHour.value).padStart(2, "0");
  const m = String(internalMinute.value).padStart(2, "0");
  const str = props.withSeconds
    ? `${h}:${m}:${String(internalSecond.value).padStart(2, "0")}`
    : `${h}:${m}`;
  emit("update:modelValue", str);
  emit("change", str);
}

// ── Header display ─────────────────────────────────────────────
const displayHour = computed(() =>
  String(internalHour.value % 12 || 12).padStart(2, "0"),
);
const displayMinute = computed(() =>
  String(internalMinute.value).padStart(2, "0"),
);
const displaySecond = computed(() =>
  String(internalSecond.value).padStart(2, "0"),
);

// ── Clear ──────────────────────────────────────────────────────
function handleClear(e: Event) {
  e.stopPropagation();
  emit("update:modelValue", "");
  emit("clear");
}

// ── Field wrapper classes ──────────────────────────────────────
const heightClasses: Record<NonNullable<TimeProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-xs",
  md: "tw:h-10 tw:text-sm",
};

const fieldClasses = computed(() => [
  "tw:flex tw:items-center tw:w-full tw:rounded-md tw:border tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150",
  "tw:ring-offset-1 tw:ring-offset-surface-base",
  "tw:bg-datepicker-bg",
  hasError.value
    ? "tw:border-datepicker-error-border"
    : "tw:border-datepicker-border tw:hover:border-datepicker-hover-border",
  props.disabled
    ? "tw:bg-datepicker-disabled-bg tw:border-datepicker-disabled-border tw:opacity-60 tw:cursor-not-allowed"
    : "tw:cursor-pointer",
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

    <PopoverRoot v-model:open="popoverOpen">
      <PopoverTrigger
        as="div"
        :id="inputId"
        role="group"
        :aria-invalid="hasError || undefined"
        :aria-disabled="disabled || undefined"
        :class="fieldClasses"
        :data-disabled="disabled || undefined"
        @focus.capture="emit('focus', $event)"
        @blur.capture="emit('blur', $event)"
      >
        <span
          class="tw:flex tw:items-center tw:ps-3 tw:text-datepicker-icon tw:shrink-0 tw:select-none"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="tw:size-4"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Z" />
            <path d="M8 4a.5.5 0 0 1 .5.5V8H11a.5.5 0 0 1 0 1H7.5V4.5A.5.5 0 0 1 8 4Z" />
          </svg>
        </span>

        <span
          :class="[
            'tw:flex-1 tw:min-w-0 tw:ps-2 tw:select-none',
            clearable ? 'tw:pe-2' : 'tw:pe-3',
            modelValue
              ? 'tw:text-datepicker-text tw:tabular-nums'
              : 'tw:text-datepicker-placeholder',
          ]"
        >
          {{ modelValue || (withSeconds ? "hh:mm:ss" : "hh:mm") }}
        </span>

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
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </PopoverTrigger>

      <PopoverContent
        :side-offset="4"
        align="start"
        class="tw:z-60 tw:rounded-lg tw:border tw:shadow-md tw:overflow-hidden tw:bg-datepicker-popup-bg tw:border-datepicker-popup-border tw:outline-none tw:w-56"
        data-test="otime-popup"
      >
        <!-- Time display + AM/PM pill (no heavy header band) -->
        <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:pt-4 tw:pb-2">
          <!-- Segmented time display -->
          <div class="tw:flex tw:items-end tw:gap-0.5">
            <button
              type="button"
              :class="[
                'tw:text-2xl tw:font-semibold tw:tabular-nums tw:rounded-sm tw:px-1 tw:pb-0.5 tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:border-b-2 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                clockMode === 'hour'
                  ? 'tw:text-datepicker-day-selected-bg tw:border-datepicker-day-selected-bg'
                  : 'tw:text-datepicker-heading-text tw:border-transparent tw:hover:text-datepicker-day-selected-bg',
              ]"
              :aria-label="`Hour: ${displayHour}`"
              @click="clockMode = 'hour'"
            >{{ displayHour }}</button>
            <span class="tw:text-2xl tw:font-semibold tw:text-datepicker-weekday-text tw:pb-0.5 tw:select-none">:</span>
            <button
              type="button"
              :class="[
                'tw:text-2xl tw:font-semibold tw:tabular-nums tw:rounded-sm tw:px-1 tw:pb-0.5 tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:border-b-2 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                clockMode === 'minute'
                  ? 'tw:text-datepicker-day-selected-bg tw:border-datepicker-day-selected-bg'
                  : 'tw:text-datepicker-heading-text tw:border-transparent tw:hover:text-datepicker-day-selected-bg',
              ]"
              :aria-label="`Minute: ${displayMinute}`"
              @click="clockMode = 'minute'"
            >{{ displayMinute }}</button>
            <template v-if="withSeconds">
              <span class="tw:text-2xl tw:font-semibold tw:text-datepicker-weekday-text tw:pb-0.5 tw:select-none">:</span>
              <button
                type="button"
                :class="[
                  'tw:text-2xl tw:font-semibold tw:tabular-nums tw:rounded-sm tw:px-1 tw:pb-0.5 tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:border-b-2 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                  clockMode === 'second'
                    ? 'tw:text-datepicker-day-selected-bg tw:border-datepicker-day-selected-bg'
                    : 'tw:text-datepicker-heading-text tw:border-transparent tw:hover:text-datepicker-day-selected-bg',
                ]"
                :aria-label="`Second: ${displaySecond}`"
                @click="clockMode = 'second'"
              >{{ displaySecond }}</button>
            </template>
          </div>

          <!-- AM / PM horizontal pill -->
          <div
            class="tw:flex tw:rounded-md tw:border tw:border-datepicker-border tw:overflow-hidden tw:ms-3 tw:shrink-0"
          >
            <button
              type="button"
              :class="[
                'tw:px-2.5 tw:py-1 tw:text-xs tw:font-medium tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                isAM
                  ? 'tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text'
                  : 'tw:text-datepicker-weekday-text tw:hover:bg-datepicker-clock-hover-bg',
              ]"
              aria-label="AM"
              @click="setAM"
            >AM</button>
            <div class="tw:w-px tw:bg-datepicker-border tw:shrink-0" aria-hidden="true" />
            <button
              type="button"
              :class="[
                'tw:px-2.5 tw:py-1 tw:text-xs tw:font-medium tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                !isAM
                  ? 'tw:bg-datepicker-day-selected-bg tw:text-datepicker-day-selected-text'
                  : 'tw:text-datepicker-weekday-text tw:hover:bg-datepicker-clock-hover-bg',
              ]"
              aria-label="PM"
              @click="setPM"
            >PM</button>
          </div>
        </div>

        <!-- Clock face SVG -->
        <div class="tw:px-3 tw:pb-1 tw:flex tw:justify-center">
          <svg
            viewBox="0 0 220 220"
            width="200"
            height="200"
            role="img"
            :aria-label="`Select ${clockMode}`"
            data-test="otime-clock-face"
          >
            <circle
              cx="110"
              cy="110"
              r="100"
              class="tw:fill-datepicker-clock-face-bg tw:stroke-datepicker-popup-border"
              stroke-width="1"
            />
            <line
              x1="110"
              y1="110"
              :x2="handPos.x"
              :y2="handPos.y"
              class="tw:stroke-datepicker-clock-hand"
              stroke-width="2"
              stroke-linecap="round"
            />
            <circle cx="110" cy="110" r="4" class="tw:fill-datepicker-clock-hand" />
            <g
              v-for="num in clockNumbers"
              :key="num.value"
              role="button"
              tabindex="0"
              :aria-label="`${num.label} ${clockMode}`"
              :aria-pressed="isClockNumSelected(num)"
              class="tw:cursor-pointer tw:group"
              @click="onClockClick(num)"
              @keydown.enter.prevent="onClockClick(num)"
              @keydown.space.prevent="onClockClick(num)"
            >
              <circle
                :cx="num.x"
                :cy="num.y"
                r="15"
                :class="isClockNumSelected(num)
                  ? 'tw:fill-datepicker-clock-selected-bg'
                  : 'tw:fill-transparent tw:group-hover:fill-datepicker-clock-hover-bg'"
              />
              <text
                :x="num.x"
                :y="num.y"
                text-anchor="middle"
                dominant-baseline="central"
                font-size="13"
                class="tw:pointer-events-none tw:select-none"
                :class="isClockNumSelected(num)
                  ? 'tw:fill-datepicker-clock-selected-text'
                  : 'tw:fill-datepicker-day-text'"
              >{{ num.label }}</text>
            </g>
          </svg>
        </div>

        <!-- Footer: step dots + Close -->
        <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:pb-3">
          <div class="tw:flex tw:items-center tw:gap-1.5" role="group" aria-label="Step">
            <button
              type="button"
              :class="[
                'tw:rounded-full tw:transition-all tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                clockMode === 'hour'
                  ? 'tw:w-4 tw:h-2 tw:bg-datepicker-day-selected-bg'
                  : 'tw:size-2 tw:bg-datepicker-border tw:hover:bg-datepicker-weekday-text',
              ]"
              aria-label="Hour"
              @click="clockMode = 'hour'"
            />
            <button
              type="button"
              :class="[
                'tw:rounded-full tw:transition-all tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                clockMode === 'minute'
                  ? 'tw:w-4 tw:h-2 tw:bg-datepicker-day-selected-bg'
                  : 'tw:size-2 tw:bg-datepicker-border tw:hover:bg-datepicker-weekday-text',
              ]"
              aria-label="Minute"
              @click="clockMode = 'minute'"
            />
            <button
              v-if="withSeconds"
              type="button"
              :class="[
                'tw:rounded-full tw:transition-all tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring',
                clockMode === 'second'
                  ? 'tw:w-4 tw:h-2 tw:bg-datepicker-day-selected-bg'
                  : 'tw:size-2 tw:bg-datepicker-border tw:hover:bg-datepicker-weekday-text',
              ]"
              aria-label="Second"
              @click="clockMode = 'second'"
            />
          </div>
          <button
            type="button"
            class="tw:text-xs tw:font-medium tw:text-datepicker-day-selected-bg tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base tw:hover:opacity-80 tw:focus-visible:ring-2 tw:focus-visible:ring-datepicker-focus-ring tw:transition-[box-shadow] tw:duration-150"
            data-test="otime-close"
            @click="popoverOpen = false"
          >Close</button>
        </div>
      </PopoverContent>
    </PopoverRoot>

    <div
      v-if="effectiveError || helpText"
      class="tw:flex tw:items-center tw:gap-2"
    >
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
