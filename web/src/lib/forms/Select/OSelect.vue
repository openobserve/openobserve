<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SelectProps, SelectEmits, SelectSlots } from "./OSelect.types";
import OSelectItem from "./OSelectItem.vue";
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<SelectProps>(), {
  size: "md",
  disabled: false,
  clearable: false,
  error: false,
});

const emit = defineEmits<SelectEmits>();

defineSlots<SelectSlots>();

const hasError = computed(() => props.error === true || !!props.errorMessage);

const stringValue = computed(() =>
  props.modelValue !== undefined ? String(props.modelValue) : undefined,
);

function handleUpdate(value: string) {
  // Convert back to number if original options are numbers
  const opt = props.options?.find((o) => String(o.value) === value);
  emit("update:modelValue", opt !== undefined ? opt.value : value);
}

function handleClear() {
  emit("update:modelValue", undefined);
  emit("clear");
}

const heightClasses: Record<NonNullable<SelectProps["size"]>, string> = {
  sm: "tw:h-8 tw:text-sm",
  md: "tw:h-10 tw:text-sm",
};
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-1 tw:w-full">
    <!-- Label -->
    <label
      v-if="label"
      :for="id"
      class="tw:text-xs tw:font-medium tw:text-select-label tw:leading-none"
    >
      {{ label }}
    </label>

    <SelectRoot
      :model-value="stringValue"
      :disabled="disabled"
      :name="name"
      @update:model-value="handleUpdate"
    >
      <!-- Trigger -->
      <div class="tw:relative tw:flex tw:items-center">
        <SelectTrigger
          :id="id"
          :class="[
            'tw:flex tw:items-center tw:w-full tw:rounded-md tw:border tw:ps-3',
            'tw:bg-select-bg',
            hasError
              ? 'tw:border-select-border-error'
              : 'tw:border-select-border tw:hover:border-select-border-hover',
            'tw:focus:outline-none tw:focus:border-select-border-focus',
            'tw:focus:ring-2 tw:focus:ring-select-focus-ring',
            'tw:transition-colors tw:duration-150',
            'tw:data-[disabled]:bg-select-disabled-bg tw:data-[disabled]:opacity-60 tw:data-[disabled]:cursor-not-allowed',
            clearable && modelValue !== undefined ? 'tw:pe-7' : 'tw:pe-8',
            heightClasses[size ?? 'md'],
          ]"
        >
          <SelectValue
            :placeholder="placeholder"
            :class="[
              'tw:flex-1 tw:text-start tw:truncate',
              modelValue === undefined
                ? 'tw:text-select-placeholder'
                : 'tw:text-select-text',
            ]"
          >
            <slot name="trigger" :value="modelValue">
              <!-- default: auto-rendered from value -->
            </slot>
          </SelectValue>

          <!-- Chevron icon -->
          <span
            aria-hidden="true"
            class="tw:flex tw:items-center tw:justify-center tw:shrink-0 tw:pe-2 tw:text-select-icon"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="tw:size-4"
            >
              <path
                fill-rule="evenodd"
                d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </SelectTrigger>

        <!-- Clear button (rendered outside of SelectTrigger so it captures click) -->
        <button
          v-if="clearable && modelValue !== undefined"
          type="button"
          tabindex="-1"
          aria-label="Clear selection"
          :class="[
            'tw:absolute tw:end-7 tw:flex tw:items-center tw:justify-center',
            'tw:text-input-clear-btn tw:hover:text-input-clear-btn-hover',
            'tw:transition-colors tw:size-4',
          ]"
          @click.stop="handleClear"
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

      <!-- Dropdown content -->
      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :class="[
            'tw:z-50 tw:min-w-[var(--reka-select-trigger-width)]',
            'tw:max-h-60 tw:overflow-hidden',
            'tw:rounded-md tw:border tw:shadow-md',
            'tw:bg-select-content-bg tw:border-select-content-border',
            // Animations
            'tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out',
            'tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0',
            'tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95',
            'tw:data-[side=bottom]:slide-in-from-top-2',
            'tw:data-[side=top]:slide-in-from-bottom-2',
          ]"
        >
          <SelectScrollUpButton
            class="tw:flex tw:items-center tw:justify-center tw:h-6 tw:text-select-icon"
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
                d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l3 3a.75.75 0 0 1 0 1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollUpButton>

          <SelectViewport class="tw:p-1">
            <!-- Auto-render from options prop -->
            <template v-if="options && options.length && !$slots.default">
              <OSelectItem
                v-for="opt in options"
                :key="String(opt.value)"
                :value="opt.value"
                :label="opt.label"
                :disabled="opt.disabled"
              />
            </template>

            <!-- Custom slot content -->
            <slot />
          </SelectViewport>

          <SelectScrollDownButton
            class="tw:flex tw:items-center tw:justify-center tw:h-6 tw:text-select-icon"
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
                d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </SelectScrollDownButton>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>

    <!-- Error message -->
    <span
      v-if="errorMessage"
      class="tw:text-xs tw:text-select-error-text tw:leading-none"
      role="alert"
    >
      {{ errorMessage }}
    </span>
  </div>
</template>
