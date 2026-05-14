<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  TextareaProps,
  TextareaEmits,
  TextareaSlots,
} from "./OTextarea.types";
import { computed, nextTick, onMounted, ref, useAttrs, useId, watch } from "vue";

// Forward the consumer's `data-test` from <OTextarea data-test="…"> onto the
// root wrapper so E2E selectors can scope to the specific field instance.
// (Same pattern as ODialog / OInput.)
defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(
  () => $attrs["data-test"] as string | undefined,
);

const props = withDefaults(defineProps<TextareaProps>(), {
  rows: 3,
  size: "md",
  disabled: false,
  readonly: false,
  autofocus: false,
  autogrow: false,
});

const emit = defineEmits<TextareaEmits>();

defineSlots<TextareaSlots>();

const _fallbackId = useId();
const textareaId = computed(() => props.id ?? _fallbackId);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// ── Error state ────────────────────────────────────────────────────────────
const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);
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
      return "tw:w-[var(--spacing-field-width-xs)]";
    case "sm":
      return "tw:w-[var(--spacing-field-width-sm)]";
    case "md":
      return "tw:w-[var(--spacing-field-width-md)]";
    case "lg":
      return "tw:w-[var(--spacing-field-width-lg)]";
    default:
      return "tw:w-full";
  }
});

const charCount = computed(() => {
  if (!props.maxlength) return 0;
  return props.modelValue ? props.modelValue.length : 0;
});

const wrapperClasses = computed(() => [
  "tw:flex tw:items-stretch tw:w-full tw:rounded-md tw:border tw:transition-colors tw:duration-150",
  "tw:bg-input-bg",
  hasError.value
    ? "tw:border-input-border-error"
    : "tw:border-input-border tw:hover:border-input-border-hover",
  "tw:focus-within:border-input-border-focus",
  "tw:focus-within:ring-2 tw:focus-within:ring-input-focus-ring",
  props.disabled
    ? "tw:bg-input-disabled-bg tw:border-input-disabled-border tw:cursor-not-allowed"
    : "",
]);
</script>

<template>
  <div v-bind="$attrs" :class="['tw:flex tw:flex-col tw:gap-1', fieldWidthClass]">
    <!-- Label -->
    <label
      v-if="label || $slots.tooltip"
      :for="textareaId"
      class="tw:text-xs tw:font-medium tw:text-input-label tw:leading-none tw:flex tw:items-center tw:gap-1"
    >
      {{ label }}
      <q-icon
        v-if="$slots.tooltip"
        name="info"
        size="16px"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help tw:text-input-label"
      ><slot name="tooltip" /></q-icon>
    </label>

    <!-- Textarea wrapper -->
    <div :class="wrapperClasses">
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
        :style="autogrow ? { overflow: 'hidden' } : undefined"
        :class="[
          'tw:flex-1 tw:min-w-0 tw:bg-transparent tw:outline-none',
          'tw:text-input-text tw:placeholder:text-input-placeholder',
          'tw:disabled:cursor-not-allowed',
          'tw:py-2 tw:px-3 tw:text-sm',
          'tw:min-h-[80px]',
          autogrow ? 'tw:resize-none' : 'tw:resize-y',
        ]"
        @input="
          emit(
            'update:modelValue',
            ($event.target as HTMLTextAreaElement).value,
          )
        "
        @blur="emit('blur', $event)"
        @focus="emit('focus', $event)"
        @keydown="emit('keydown', $event)"
      />
    </div>

    <!-- Bottom row: helpText / error / counter -->
    <div
      v-if="effectiveError || helpText || maxlength"
      class="tw:flex tw:items-center tw:justify-between tw:gap-2"
    >
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-input-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-input-hint tw:leading-none"
      >
        {{ helpText }}
      </span>
      <span v-else class="tw:flex-1" />

      <span
        v-if="maxlength"
        :class="[
          'tw:text-xs tw:leading-none tw:tabular-nums tw:shrink-0',
          charCount > maxlength
            ? 'tw:text-input-error-text'
            : 'tw:text-input-hint',
        ]"
      >
        {{ charCount }}/{{ maxlength }}
      </span>
    </div>

    <slot name="append" />
  </div>
</template>
