<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { TextareaProps, TextareaEmits, TextareaSlots } from "./OTextarea.types";
import { computed, nextTick, onMounted, ref, useAttrs, useId, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

// Forward the consumer's `data-test` from <OTextarea data-test="…"> onto the
// root wrapper so E2E selectors can scope to the specific field instance.
// (Same pattern as ODialog / OInput.)
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the real control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const rest = { ...$attrs };
  delete rest.tabindex;
  return rest;
});

const props = withDefaults(defineProps<TextareaProps>(), {
  rows: 3,
  size: "md",
  disabled: false,
  readonly: false,
  autofocus: false,
  autogrow: false,
  fill: false,
});

const emit = defineEmits<TextareaEmits>();

defineSlots<TextareaSlots>();

const _fallbackId = useId();
const textareaId = computed(() => props.id ?? _fallbackId);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// ── Error state ────────────────────────────────────────────────────────────
// Error is only shown when `props.error` is true. A static `errorMessage`
// string alone must not surface the error — otherwise any field with a
// pre-bound error message renders the error on mount regardless of state.
const effectiveError = computed(() => {
  if (!props.error) return null;
  return props.errorMessage || " ";
});
const hasError = computed(() => !!effectiveError.value);

// ── Autogrow ───────────────────────────────────────────────────────────────
function resizeTextarea() {
  if (!props.autogrow) return;
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

onMounted(() => {
  if (props.autogrow) nextTick(resizeTextarea);
});

watch(
  () => props.modelValue,
  () => {
    if (props.autogrow) nextTick(resizeTextarea);
  },
);

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
  return props.modelValue ? props.modelValue.length : 0;
});

const wrapperClasses = computed(() => [
  "flex items-stretch w-full rounded-default border transition-[color,background-color,border-color,box-shadow] duration-150",
  "ring-offset-1 ring-offset-surface-base",
  "bg-input-bg",
  /* Keep the red error border on focus (don't let the focus color override it);
     focus border color applies only when there's no error. See OInput.vue. */
  hasError.value
    ? "border-input-border-error"
    : "border-input-border hover:border-input-border-hover focus-within:border-input-border-focus",
  /* Same opacity+dashed treatment as OInput so disabled textareas are
     visually obvious vs enabled ones. */
  props.disabled
    ? "bg-input-disabled-bg border-input-disabled-border cursor-not-allowed border-dashed"
    : "",
]);
</script>

<template>
  <div
    v-bind="wrapperAttrs"
    :class="['flex flex-col gap-1', fieldWidthClass, fill && 'h-full min-h-0']"
  >
    <!-- Label -->
    <label
      v-if="label || $slots.tooltip"
      :for="textareaId"
      :class="[
        'o-input-label text-compact flex items-center gap-1 leading-tight',
        props.disabled
          ? 'text-input-label-text-disabled font-normal'
          : 'text-input-label-text font-medium',
      ]"
    >
      {{ label }}<span v-if="required" aria-hidden="true" class="select-none">*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
        ><slot name="tooltip"
      /></OIcon>
    </label>

    <!-- Textarea wrapper -->
    <div :class="[wrapperClasses, fill && 'min-h-0 flex-1']">
      <textarea
        :id="textareaId"
        ref="textareaRef"
        :value="modelValue ?? ''"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :rows="autogrow ? 1 : rows"
        :autocomplete="autocomplete"
        :tabindex="inputTabindex"
        :data-test="parentDataTest ? `${parentDataTest}-field` : undefined"
        :style="autogrow ? { overflow: 'hidden' } : undefined"
        :class="[
          'min-w-0 flex-1 bg-transparent outline-none',
          'text-input-text placeholder:text-input-placeholder',
          'disabled:cursor-not-allowed',
          'px-3 py-2 text-sm',
          fill ? 'h-full min-h-0 resize-none' : 'min-h-20',
          !fill && (autogrow ? 'resize-none' : 'resize-y'),
        ]"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
      />
    </div>

    <!-- Bottom row: helpText / error / counter -->
    <div
      v-if="effectiveError || helpText || maxlength"
      class="flex items-center justify-between gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        :data-test="parentDataTest ? `${parentDataTest}-error` : undefined"
        class="text-input-error-text text-xs leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span v-else-if="helpText" class="text-input-hint text-xs leading-none">
        {{ helpText }}
      </span>
      <span v-else class="flex-1" />

      <span
        v-if="maxlength"
        :class="[
          'shrink-0 text-xs leading-none tabular-nums',
          charCount > maxlength ? 'text-input-error-text' : 'text-input-hint',
        ]"
      >
        {{ charCount }}/{{ maxlength }}
      </span>
    </div>

    <slot name="append" />
  </div>
</template>
