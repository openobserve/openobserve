<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { TimeProps, TimeEmits, TimeSlots } from "./OTime.types";
import { computed, ref, useAttrs, useId, watch, nextTick } from "vue";
import { PopoverRoot, PopoverTrigger, PopoverContent } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
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

// ── Internal time state ────────────────────────────────────────
const internalHour = ref(0);
const internalMinute = ref(0);
const internalSecond = ref(0);

// ── Scroll column refs ─────────────────────────────────────────
const hourColRef = ref<HTMLElement | null>(null);
const minuteColRef = ref<HTMLElement | null>(null);
const secondColRef = ref<HTMLElement | null>(null);

const ITEM_HEIGHT = 32; // px per item row

watch(popoverOpen, (open) => {
  if (!open) return;
  if (!props.modelValue) {
    internalHour.value = 0;
    internalMinute.value = 0;
    internalSecond.value = 0;
  } else {
  const parts = props.modelValue.split(":").map(Number);
  internalHour.value = parts[0] ?? 0;
  internalMinute.value = parts[1] ?? 0;
  internalSecond.value = parts[2] ?? 0;
  }
  nextTick(() => scrollAllToSelected());
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

// ── Scroll helpers ─────────────────────────────────────────────
function scrollToItem(container: HTMLElement | null, index: number) {
  if (!container) return;
  container.scrollTo({ top: index * ITEM_HEIGHT, behavior: "smooth" });
}

function scrollAllToSelected() {
  scrollToItem(hourColRef.value, internalHour.value);
  scrollToItem(minuteColRef.value, internalMinute.value);
  scrollToItem(secondColRef.value, internalSecond.value);
}

// ── Selection handlers ─────────────────────────────────────────
function selectHour(h: number) {
  if (props.disabled || props.readonly) return;
  internalHour.value = h;
    emitCurrentValue();
  scrollToItem(hourColRef.value, h);
}

function selectMinute(m: number) {
  if (props.disabled || props.readonly) return;
  internalMinute.value = m;
    emitCurrentValue();
  scrollToItem(minuteColRef.value, m);
}

function selectSecond(s: number) {
  if (props.disabled || props.readonly) return;
  internalSecond.value = s;
    emitCurrentValue();
  scrollToItem(secondColRef.value, s);
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

// ── Clear ──────────────────────────────────────────────────────
function handleClear(e: Event) {
  e.stopPropagation();
  emit("update:modelValue", "");
  emit("clear");
}

// ── Time text input handler (24-hour format) ────────────────
const displayTimeText = computed(() => {
  if (!props.modelValue) return "";
  return props.modelValue;
});

function handleTextTimeChange(e: Event) {
  const val = (e.target as HTMLInputElement).value.trim();
  if (!val) {
    emit("update:modelValue", "");
    emit("change", "");
    return;
  }
  const timeRegex = props.withSeconds
    ? /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/
    : /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(val)) {
    (e.target as HTMLInputElement).value = props.modelValue ?? "";
    return;
  }
  const parts = val.split(":").map(Number);
  internalHour.value = parts[0] ?? 0;
  internalMinute.value = parts[1] ?? 0;
  internalSecond.value = parts[2] ?? 0;
  emit("update:modelValue", val);
  emit("change", val);
}

// ── Lists for scroll columns ───────────────────────────────────
const hours = Array.from({ length: 24 }, (_, i) => i);
const minutes = Array.from({ length: 60 }, (_, i) => i);
const seconds = Array.from({ length: 60 }, (_, i) => i);

// ── Field wrapper classes ──────────────────────────────────────
const heightClasses: Record<NonNullable<TimeProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-xs",
  md: "tw:h-10 tw:text-sm",
};

const fieldClasses = computed(() => [
  "tw:inline-flex tw:items-center tw:w-fit tw:min-w-0 tw:rounded-md tw:border tw:transition-[color,background-color,border-color,box-shadow] tw:duration-150",
  "tw:ring-offset-1 tw:ring-offset-surface-base",
  "tw:bg-datepicker-bg",
  hasError.value
    ? "tw:border-datepicker-error-border"
    : "tw:border-datepicker-border tw:hover:border-datepicker-hover-border",
  props.disabled
    ? "tw:bg-datepicker-disabled-bg tw:border-datepicker-disabled-border tw:opacity-60 tw:cursor-not-allowed"
    : "",
  heightClasses[props.size ?? "md"],
]);
</script>

<template>
  <div v-bind="wrapperAttrs" class="tw:flex tw:flex-col tw:gap-1 tw:w-fit tw:min-w-0">
    <label
      v-if="$slots.label || label || $slots.tooltip"
      :for="inputId"
      class="tw:text-xs tw:font-medium tw:text-datepicker-label tw:leading-none tw:flex tw:items-center tw:gap-1"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true" class="tw:select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help tw:text-datepicker-label"
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
          class="tw:flex tw:items-center tw:ps-3 tw:text-datepicker-icon tw:shrink-0 tw:select-none tw:outline-none tw:cursor-pointer tw:focus-visible:opacity-80"
          :disabled="disabled || undefined"
          aria-label="Open time picker"
        >
          <OIcon name="schedule" size="sm" />
        </PopoverTrigger>

        <input
          type="text"
          :value="displayTimeText"
          :placeholder="withSeconds ? '00:00:00' : '00:00'"
          :size="withSeconds ? 8 : 5"
          :tabindex="inputTabindex"
          :disabled="disabled || undefined"
          :readonly="readonly || undefined"
          :class="[
            'otime-input tw:min-w-0 tw:ps-2 tw:bg-transparent tw:outline-none tw:text-datepicker-text',
            clearable ? 'tw:pe-2' : 'tw:pe-3',
          ]"
          @change="handleTextTimeChange"
          @focus="emit('focus', $event)"
          @blur="emit('blur', $event)"
        />

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
      </div>

      <PopoverContent
        :side-offset="4"
        align="start"
        :class="[
          'tw:z-60 tw:rounded-lg tw:border tw:shadow-md tw:overflow-hidden tw:bg-datepicker-popup-bg tw:border-datepicker-popup-border tw:outline-none',
          withSeconds ? 'tw:w-52' : 'tw:w-36',
        ]"
        data-test="otime-popup"
      >
        <!-- Scroll columns -->
        <div class="tw:flex tw:divide-x tw:divide-datepicker-border otime-scroll-columns">
          <!-- Hour column -->
          <div
            ref="hourColRef"
            class="tw:flex-1 tw:overflow-y-auto tw:h-[224px] otime-scroll-col"
            role="listbox"
            aria-label="Hour"
          >
            <div
              v-for="h in hours"
              :key="h"
              role="option"
              :aria-selected="h === internalHour"
                :class="[
                'tw:h-8 tw:flex tw:items-center tw:justify-center tw:text-sm tw:cursor-pointer tw:select-none tw:tabular-nums tw:transition-colors tw:duration-100',
                h === internalHour
                  ? 'tw:text-datepicker-day-selected-bg tw:font-semibold tw:border tw:border-datepicker-day-selected-bg tw:rounded-sm tw:mx-1'
                  : 'tw:text-datepicker-day-text tw:hover:bg-datepicker-clock-hover-bg tw:mx-1 tw:rounded-sm',
                ]"
              @click="selectHour(h)"
            >{{ String(h).padStart(2, '0') }}</div>
          </div>

          <!-- Minute column -->
          <div
            ref="minuteColRef"
            class="tw:flex-1 tw:overflow-y-auto tw:h-[224px] otime-scroll-col"
            role="listbox"
            aria-label="Minute"
          >
            <div
              v-for="m in minutes"
              :key="m"
              role="option"
              :aria-selected="m === internalMinute"
              :class="[
                'tw:h-8 tw:flex tw:items-center tw:justify-center tw:text-sm tw:cursor-pointer tw:select-none tw:tabular-nums tw:transition-colors tw:duration-100',
                m === internalMinute
                  ? 'tw:text-datepicker-day-selected-bg tw:font-semibold tw:border tw:border-datepicker-day-selected-bg tw:rounded-sm tw:mx-1'
                  : 'tw:text-datepicker-day-text tw:hover:bg-datepicker-clock-hover-bg tw:mx-1 tw:rounded-sm',
              ]"
              @click="selectMinute(m)"
            >{{ String(m).padStart(2, '0') }}</div>
        </div>

          <!-- Second column (conditional) -->
          <div
              v-if="withSeconds"
            ref="secondColRef"
            class="tw:flex-1 tw:overflow-y-auto tw:h-[224px] otime-scroll-col"
            role="listbox"
            aria-label="Second"
          >
            <div
              v-for="s in seconds"
              :key="s"
              role="option"
              :aria-selected="s === internalSecond"
              :class="[
                'tw:h-8 tw:flex tw:items-center tw:justify-center tw:text-sm tw:cursor-pointer tw:select-none tw:tabular-nums tw:transition-colors tw:duration-100',
                s === internalSecond
                  ? 'tw:text-datepicker-day-selected-bg tw:font-semibold tw:border tw:border-datepicker-day-selected-bg tw:rounded-sm tw:mx-1'
                  : 'tw:text-datepicker-day-text tw:hover:bg-datepicker-clock-hover-bg tw:mx-1 tw:rounded-sm',
              ]"
              @click="selectSecond(s)"
            >{{ String(s).padStart(2, '0') }}</div>
          </div>
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

<style>
/* Size the input exactly to its content where supported (Chrome/Edge/Safari).
   The `size` attribute remains as a fallback for browsers without field-sizing. */
.otime-input {
  field-sizing: content;
}

.otime-scroll-col::-webkit-scrollbar {
  width: 4px;
}
.otime-scroll-col::-webkit-scrollbar-thumb {
  background-color: var(--o2-border, #ddd);
  border-radius: 2px;
}
.otime-scroll-col::-webkit-scrollbar-track {
  background: transparent;
}
</style>
