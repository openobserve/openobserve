<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { InputProps, InputEmits, InputSlots } from "./OInput.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  useId,
  watch,
} from "vue";

// Forward the consumer's `data-test` from <OInput data-test="…"> onto the
// root wrapper so E2E selectors can scope to the specific field instance
// using the audit pattern: [data-test="<parent>"] [data-test="<parent>-info"].
// (Without inheritAttrs:false the data-test would still land on the root, but
// we need $attrs access to derive the tooltip icon's companion selector.)
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  return rest;
});

const props = withDefaults(defineProps<InputProps>(), {
  type: "text",
  size: "md",
  disabled: false,
  readonly: false,
  clearable: false,
  autofocus: false,
  autogrow: false,
  rows: 3,
  labelPosition: "outside",
});

const emit = defineEmits<InputEmits>();

defineSlots<InputSlots>();

// useId() must be called at setup top-level — not inside computed — otherwise
// each re-evaluation produces a new id, breaking the <label :for> association.
const _fallbackId = useId();
const inputId = computed(() => props.id ?? _fallbackId);
const inputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);
const debounceTimer = ref<ReturnType<typeof setTimeout> | null>(null);

function handleBlur(event: FocusEvent) {
  // Flush any pending debounced emit immediately on blur so that tabbing away
  // or clicking Apply right after typing does not lose the typed value.
  if (debounceTimer.value) {
    clearTimeout(debounceTimer.value);
    debounceTimer.value = null;
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    const normalized = normalizeByModifiers(target.value);
    emit("update:modelValue", normalized);
  }
  emit("blur", event);
}

// ── Error state ────────────────────────────────────────────────────────────
// Error is only shown when `props.error` is true. A static `errorMessage`
// string alone must not surface the error — otherwise any field with a
// pre-bound error message renders the error on mount regardless of state.
const effectiveError = computed(() => {
  if (!props.error) return null;
  return props.errorMessage || " ";
});
const hasError = computed(() => !!effectiveError.value);

const isTextarea = computed(() => props.type === "textarea");

// ── Width ──────────────────────────────────────────────────────────────────
const fieldWidthClass = computed(() => {
  switch (props.width) {
    case "xs":
      return "w-field-width-xs";
    case "sm":
      return "w-field-width-sm";
    case "md":
      return "w-field-width-md";
    case "lg":
      return "w-field-width-lg";
    default:
      return "w-full";
  }
});

const charCount = computed(() => {
  if (!props.maxlength) return 0;
  const val = props.modelValue;
  return val !== undefined && val !== null ? String(val).length : 0;
});

// All masks are digit-extracting formatters: non-digit characters are stripped.
// Only use `mask` on inputs that accept purely numeric content (times, dates).
function applyMask(raw: string): string {
  if (!props.mask) return raw;

  const digits = raw.replace(/\D/g, "");

  if (props.mask === "time") {
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    return [hh, mm].filter(Boolean).join(":");
  }

  if (props.mask === "fulltime") {
    const hh = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const ss = digits.slice(4, 6);
    return [hh, mm, ss].filter(Boolean).join(":");
  }

  if (props.mask === "DD-MM-YYYY") {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    return [dd, mm, yyyy].filter(Boolean).join("-");
  }

  return raw;
}

function normalizeByModifiers(value: string): string | number {
  let normalized = value;

  if (props.modelModifiers?.trim) {
    normalized = normalized.trim();
  }

  if (props.modelModifiers?.number) {
    if (normalized === "") return "";
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? normalized : parsed;
  }

  return normalized;
}

function resizeTextarea() {
  if (!isTextarea.value || !props.autogrow) return;
  const el = inputRef.value;
  if (!el || !(el instanceof HTMLTextAreaElement)) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  let val = target.value;

  if (props.mask) {
    val = applyMask(val);
    if (val !== target.value) {
      target.value = val;
    }
  }

  const emitValue = () => {
    const normalized = normalizeByModifiers(val);
    emit("update:modelValue", normalized);
  };

  if ((props.debounce ?? 0) > 0) {
    if (debounceTimer.value) clearTimeout(debounceTimer.value);
    debounceTimer.value = setTimeout(emitValue, props.debounce);
    return;
  }

  emitValue();
  if (props.autogrow && isTextarea.value) {
    nextTick(resizeTextarea);
  }
}

function handleClear() {
  if (debounceTimer.value) clearTimeout(debounceTimer.value);
  emit("update:modelValue", "");
  emit("clear");
  inputRef.value?.focus();
}

onBeforeUnmount(() => {
  if (debounceTimer.value) clearTimeout(debounceTimer.value);
});

onMounted(() => {
  if (props.autogrow && isTextarea.value) {
    nextTick(resizeTextarea);
  }
});

watch(
  () => props.modelValue,
  () => {
    if (props.autogrow && isTextarea.value) {
      nextTick(resizeTextarea);
    }
  },
);

// ── Styles ─────────────────────────────────────────────────────────────────
// Height applied to the wrapper (so border is included in the box, matching
// OSelect); the inner input fills it via h-full. 34px control height per the
// design system.
const heightClasses: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "h-[2.125rem]",
  md: "h-[2.125rem]",
};
const textSizeClasses: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-sm",
};

const wrapperClasses = computed(() => [
  "flex items-stretch w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "bg-input-bg",
  !isTextarea.value ? heightClasses[props.size ?? "md"] : "",
  /* Focus affordance = soft glow: a 4px translucent halo hugging the border
     plus the focus border color. When the field has an ERROR, keep the red
     error border on focus (don't let the focus color override it) and tint the
     glow red — otherwise the focus border (blue) would hide the error state
     while the field is focused. */
  hasError.value
    ? "border-input-border-error focus-within:ring-[0.125rem] focus-within:ring-input-border-error/30"
    : "border-input-border hover:border-input-border-hover focus-within:border-input-border-focus focus-within:ring-[0.125rem] focus-within:ring-primary-500/25",
  /* Disabled inputs get a muted bg + dashed border so they read as obviously
     inactive at a glance. */
  props.disabled
    ? "bg-input-disabled-bg border-input-disabled-border cursor-not-allowed border-dashed"
    : "",
  props.readonly ? "border-input-border bg-input-bg" : "",
  // Inside-label mode: wrapper is relative so the floating label can be absolutely placed
  props.labelPosition === "inside" && props.label && !isTextarea.value ? "relative" : "",
]);
</script>

<template>
  <div v-bind="wrapperAttrs" :class="['flex flex-col gap-1', fieldWidthClass]">
    <label
      v-if="(label || $slots.tooltip) && labelPosition !== 'inside'"
      :for="inputId"
      :class="[
        'o-input-label text-compact leading-tight flex items-center gap-1',
        props.disabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text',
      ]"
    >
      {{ label }}<span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
      ><slot name="tooltip" /></OIcon>
    </label>

    <!-- Input row -->
    <div :class="wrapperClasses">
      <!-- Inside label: floating mini-label at the top of the input border -->
      <span
        v-if="label && labelPosition === 'inside' && !isTextarea"
        class="absolute top-1 start-3 end-7 text-2xs font-medium leading-none text-text-secondary select-none pointer-events-none whitespace-nowrap overflow-hidden text-ellipsis"
      >{{ label }}<span v-if="required" aria-hidden="true">&nbsp;*</span></span>

      <!-- Icon-left slot (inside border, left — matches OButton #icon-left pattern) -->
      <span
        v-if="$slots['icon-left']"
        class="flex items-center ps-2 text-input-addon-text shrink-0 select-none"
      >
        <slot name="icon-left" />
      </span>

      <!-- Prefix slot (inside border) -->
      <span
        v-if="$slots.prefix || prefix"
        class="flex items-center ps-3 text-input-addon-text text-sm shrink-0 select-none"
      >
        <slot name="prefix">{{ prefix }}</slot>
      </span>

      <!-- Textarea -->
      <textarea
        v-if="isTextarea"
        :id="inputId"
        ref="inputRef"
        :data-test="parentDataTest ? `${parentDataTest}-field` : undefined"
        :value="String(modelValue ?? '')"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :rows="autogrow ? 1 : rows"
        :autocomplete="autocomplete"
        :tabindex="inputTabindex"
        :style="autogrow ? { overflow: 'hidden' } : undefined"
        :class="[
          'flex-1 min-w-0 bg-transparent outline-none rounded-[inherit]',
          'text-input-text placeholder:text-input-placeholder',
          'disabled:cursor-not-allowed disabled:text-input-disabled-text',
          'py-2',
          $slots['icon-left'] || $slots.prefix || prefix ? 'ps-2' : 'ps-3',
          $slots['icon-right'] || $slots.suffix || suffix || clearable ? 'pe-2' : 'pe-3',
          'text-sm',
          autogrow ? 'resize-none' : 'resize-y',
        ]"
        @input="handleInput"
        @blur="handleBlur"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
        @keypress="emit('keypress', $event)"
      />

      <!-- Text/number/etc input -->
      <input
        v-else
        :id="inputId"
        ref="inputRef"
        :data-test="parentDataTest ? `${parentDataTest}-field` : undefined"
        :value="String(modelValue ?? '')"
        :type="type"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :autocomplete="autocomplete"
        :tabindex="inputTabindex"
        :aria-invalid="hasError || undefined"
        :class="[
          'flex-1 min-w-0 bg-transparent outline-none rounded-[inherit]',
          'text-input-text placeholder:text-input-placeholder',
          'disabled:cursor-not-allowed disabled:text-input-disabled-text',
          'h-full',
          // Inside-label: push text down to leave room for the floating mini-label
          labelPosition === 'inside' && label ? 'pt-3 pb-0.5 text-xs font-semibold' : textSizeClasses[size ?? 'md'],
          $slots['icon-left'] || $slots.prefix || prefix ? 'ps-2' : 'ps-3',
          $slots['icon-right'] || $slots.suffix || suffix || clearable ? 'pe-2' : 'pe-3',
        ]"
        @input="handleInput"
        @blur="handleBlur"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
        @keyup="emit('keyup', $event)"
        @keypress="emit('keypress', $event)"
      />

      <!-- Clear button -->
      <button
        v-if="
          clearable &&
          modelValue !== '' &&
          modelValue !== undefined &&
          modelValue !== null
        "
        type="button"
        tabindex="-1"
        aria-label="Clear"
        :data-test="parentDataTest ? `${parentDataTest}-clear` : undefined"
        class="flex items-center pe-2 text-input-clear-btn hover:text-input-clear-btn-hover transition-colors"
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

      <!-- Suffix slot (inside border — text) -->
      <span
        v-if="$slots.suffix || suffix"
        class="flex items-center pe-3 text-input-addon-text text-sm shrink-0 select-none"
      >
        <slot name="suffix">{{ suffix }}</slot>
      </span>

      <!-- Icon-right slot (inside border, right — matches OButton #icon-right pattern) -->
      <span
        v-if="$slots['icon-right']"
        class="flex items-center pe-2 text-input-addon-text shrink-0 select-none"
      >
        <slot name="icon-right" />
      </span>
    </div>

    <!-- Bottom row: helpText / error / counter.
         `effectiveError` is " " when the field is invalid but its message is
         rendered elsewhere (OFormInput's #error slot). That carries no text, so
         it must not open this row — an empty row still costs the parent's gap-1
         and would grow the field on error, nudging anything aligned beside it. -->
    <div
      v-if="(effectiveError && effectiveError.trim()) || helpText || maxlength"
      class="flex items-center justify-between gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
        :data-test-error-text="effectiveError"
        class="text-xs text-input-error-text leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="text-xs text-input-hint leading-none"
      >
        {{ helpText }}
      </span>
      <span v-else class="flex-1" />

      <span
        v-if="maxlength"
        :class="[
          'text-xs leading-none tabular-nums shrink-0',
          charCount > maxlength
            ? 'text-input-error-text'
            : 'text-input-hint',
        ]"
      >
        {{ charCount }}/{{ maxlength }}
      </span>
    </div>

    <!-- Append slot (outside border) -->
    <slot name="append" />
  </div>
</template>
