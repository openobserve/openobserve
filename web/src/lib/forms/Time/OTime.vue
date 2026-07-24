<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { TimeProps, TimeEmits, TimeSlots } from "./OTime.types";
import { computed, ref, useAttrs, useId, watch } from "vue";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "reka-ui";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex: _tabindex, ...rest } = $attrs;
  return rest;
});

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

// ── Native time input handler ───────────────────────────────
function handleNativeTimeChange(e: Event) {
  const val = (e.target as HTMLInputElement).value;
  if (!val) {
    emit("update:modelValue", "");
    emit("change", "");
    return;
  }
  const parts = val.split(":").map(Number);
  internalHour.value = parts[0] ?? 0;
  internalMinute.value = parts[1] ?? 0;
  internalSecond.value = parts[2] ?? 0;
  emit("update:modelValue", val);
  emit("change", val);
}

// ── Field wrapper classes ──────────────────────────────────────
const heightClasses: Record<NonNullable<TimeProps["size"]>, string> = {
  sm: "h-6 text-sm",
  md: "h-8.5 text-sm",
};

const fieldClasses = computed(() => [
  "flex items-center w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "ring-offset-1 ring-offset-surface-base",
  "bg-datepicker-bg",
  hasError.value
    ? "border-datepicker-error-border"
    : "border-datepicker-border hover:border-datepicker-hover-border",
  "focus-within:border-datepicker-focus-border",
  "focus-within:ring-[0.125rem] focus-within:ring-accent/25",
  props.disabled
    ? "bg-datepicker-disabled-bg border-datepicker-disabled-border opacity-60 cursor-not-allowed"
    : "",
  heightClasses[props.size ?? "md"],
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="flex flex-col gap-1 w-full">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="o-input-label text-sm font-semibold leading-tight flex items-center gap-1"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help text-datepicker-label"
      ><slot name="tooltip" /></OIcon>
    </label>

    <PopoverRoot v-model:open="popoverOpen">
      <div
        :id="inputId"
        role="group"
        :aria-invalid="hasError || undefined"
        :aria-disabled="disabled || undefined"
        :class="fieldClasses"
        :data-disabled="disabled || undefined"
        :data-test="parentDataTest"
      >
        <PopoverTrigger
          as="button"
          type="button"
          tabindex="-1"
          class="flex items-center ps-3 text-datepicker-icon shrink-0 select-none outline-none cursor-pointer focus-visible:opacity-80"
          :disabled="disabled || undefined"
          :aria-label="t('components.time.openTimePicker')"
        >
          <OIcon name="schedule" size="sm" />
        </PopoverTrigger>

        <input
          type="time"
          :value="modelValue ?? ''"
          :tabindex="inputTabindex"
          :step="withSeconds ? 1 : 60"
          :disabled="disabled || undefined"
          :readonly="readonly || undefined"
          :class="[
            'flex-1 min-w-0 ps-2 bg-transparent outline-none text-datepicker-text',
            clearable ? 'pe-2' : 'pe-3',
          ]"
          @input="handleNativeTimeChange"
          @focus="emit('focus', $event)"
          @blur="emit('blur', $event)"
        />

        <button
          v-if="clearable && modelValue"
          type="button"
          tabindex="-1"
          :aria-label="t('components.time.clear')"
          class="flex items-center pe-2 text-datepicker-icon hover:opacity-80 transition-colors"
          @click="handleClear"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="size-3.5"
            aria-hidden="true"
          >
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>

      <PopoverContent
        :side-offset="4"
        align="start"
        :class="[
          'z-60 rounded-default border shadow-md overflow-hidden bg-datepicker-popup-bg border-datepicker-popup-border outline-none',
          withSeconds ? 'w-64' : 'w-56',
        ]"
        data-test="otime-popup"
      >
        <!-- Time display + AM/PM pill (no heavy header band) -->
        <div class="flex items-center justify-between px-4 pt-4 pb-2">
          <!-- Segmented time display -->
          <div class="flex items-end gap-0.5">
            <button
              type="button"
              :class="[
                'text-2xl font-semibold tabular-nums rounded-default px-1 pb-0.5 outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 border-b-2 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                clockMode === 'hour'
                  ? 'text-datepicker-day-selected-bg border-datepicker-day-selected-bg'
                  : 'text-datepicker-heading-text border-transparent hover:text-datepicker-day-selected-bg',
              ]"
              :aria-label="`Hour: ${displayHour}`"
              @click="clockMode = 'hour'"
            >{{ displayHour }}</button>
            <span class="text-2xl font-semibold text-datepicker-weekday-text pb-0.5 select-none">:</span>
            <button
              type="button"
              :class="[
                'text-2xl font-semibold tabular-nums rounded-default px-1 pb-0.5 outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 border-b-2 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                clockMode === 'minute'
                  ? 'text-datepicker-day-selected-bg border-datepicker-day-selected-bg'
                  : 'text-datepicker-heading-text border-transparent hover:text-datepicker-day-selected-bg',
              ]"
              :aria-label="`Minute: ${displayMinute}`"
              @click="clockMode = 'minute'"
            >{{ displayMinute }}</button>
            <template v-if="withSeconds">
              <span class="text-2xl font-semibold text-datepicker-weekday-text pb-0.5 select-none">:</span>
              <button
                type="button"
                :class="[
                  'text-2xl font-semibold tabular-nums rounded-default px-1 pb-0.5 outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 border-b-2 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                  clockMode === 'second'
                    ? 'text-datepicker-day-selected-bg border-datepicker-day-selected-bg'
                    : 'text-datepicker-heading-text border-transparent hover:text-datepicker-day-selected-bg',
                ]"
                :aria-label="`Second: ${displaySecond}`"
                @click="clockMode = 'second'"
              >{{ displaySecond }}</button>
            </template>
          </div>

          <!-- AM / PM horizontal pill -->
          <div
            class="flex rounded-default border border-datepicker-border overflow-hidden ms-3 shrink-0"
          >
            <button
              type="button"
              :class="[
                'px-2.5 py-1 text-xs font-medium outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                isAM
                  ? 'bg-datepicker-day-selected-bg text-datepicker-day-selected-text'
                  : 'text-datepicker-weekday-text hover:bg-datepicker-clock-hover-bg',
              ]"
              :aria-label="t('components.time.am')"
              @click="setAM"
            >{{ t('components.time.am') }}</button>
            <div class="w-px bg-datepicker-border shrink-0" aria-hidden="true" />
            <button
              type="button"
              :class="[
                'px-2.5 py-1 text-xs font-medium outline-none ring-offset-1 ring-offset-surface-base transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                !isAM
                  ? 'bg-datepicker-day-selected-bg text-datepicker-day-selected-text'
                  : 'text-datepicker-weekday-text hover:bg-datepicker-clock-hover-bg',
              ]"
              :aria-label="t('components.time.pm')"
              @click="setPM"
            >{{ t('components.time.pm') }}</button>
          </div>
        </div>

        <!-- Clock face SVG -->
        <div class="px-3 pb-1 flex justify-center">
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
              class="fill-datepicker-clock-face-bg stroke-datepicker-popup-border"
              stroke-width="1"
            />
            <line
              x1="110"
              y1="110"
              :x2="handPos.x"
              :y2="handPos.y"
              class="stroke-datepicker-clock-hand"
              stroke-width="2"
              stroke-linecap="round"
            />
            <circle cx="110" cy="110" r="4" class="fill-datepicker-clock-hand" />
            <g
              v-for="num in clockNumbers"
              :key="num.value"
              role="button"
              tabindex="0"
              :aria-label="`${num.label} ${clockMode}`"
              :aria-pressed="isClockNumSelected(num)"
              class="cursor-pointer group"
              @click="onClockClick(num)"
              @keydown.enter.prevent="onClockClick(num)"
              @keydown.space.prevent="onClockClick(num)"
            >
              <circle
                :cx="num.x"
                :cy="num.y"
                r="15"
                :class="isClockNumSelected(num)
                  ? 'fill-datepicker-clock-selected-bg'
                  : 'fill-transparent group-hover:fill-datepicker-clock-hover-bg'"
              />
              <text
                :x="num.x"
                :y="num.y"
                text-anchor="middle"
                dominant-baseline="central"
                font-size="13"
                class="pointer-events-none select-none"
                :class="isClockNumSelected(num)
                  ? 'fill-datepicker-clock-selected-text'
                  : 'fill-datepicker-day-text'"
              >{{ num.label }}</text>
            </g>
          </svg>
        </div>

        <!-- Footer: step dots + Close -->
        <div class="flex items-center justify-between px-4 pb-3">
          <div class="flex items-center gap-1.5" role="group" :aria-label="t('components.time.step')">
            <button
              type="button"
              :class="[
                'rounded-full transition-all outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                clockMode === 'hour'
                  ? 'w-4 h-2 bg-datepicker-day-selected-bg'
                  : 'size-2 bg-datepicker-border hover:bg-datepicker-weekday-text',
              ]"
              :aria-label="t('components.time.hour')"
              @click="clockMode = 'hour'"
            />
            <button
              type="button"
              :class="[
                'rounded-full transition-all outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                clockMode === 'minute'
                  ? 'w-4 h-2 bg-datepicker-day-selected-bg'
                  : 'size-2 bg-datepicker-border hover:bg-datepicker-weekday-text',
              ]"
              :aria-label="t('components.time.minute')"
              @click="clockMode = 'minute'"
            />
            <button
              v-if="withSeconds"
              type="button"
              :class="[
                'rounded-full transition-all outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring',
                clockMode === 'second'
                  ? 'w-4 h-2 bg-datepicker-day-selected-bg'
                  : 'size-2 bg-datepicker-border hover:bg-datepicker-weekday-text',
              ]"
              :aria-label="t('components.time.second')"
              @click="clockMode = 'second'"
            />
          </div>
          <button
            type="button"
            class="text-xs font-medium text-datepicker-day-selected-bg outline-none ring-offset-1 ring-offset-surface-base hover:opacity-80 focus-visible:ring-2 focus-visible:ring-datepicker-focus-ring transition-[box-shadow] duration-150"
            data-test="otime-close"
            @click="popoverOpen = false"
          >{{ t('common.close') }}</button>
        </div>
      </PopoverContent>
    </PopoverRoot>

    <div
      v-if="effectiveError || helpText"
      class="flex items-center gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="text-xs text-datepicker-error-text leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="text-xs text-datepicker-label leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* keep(lib-override:native-time): hide the browser's native clock-picker
   indicator on <input type=time> (a custom analog-clock popover replaces it).
   Scoped so the override only affects this component's input. */
input[type="time"]::-webkit-calendar-picker-indicator {
  display: none;
}
</style>
