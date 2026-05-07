<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  CheckboxProps,
  CheckboxEmits,
  CheckboxSlots,
} from "./OCheckbox.types";
import { CHECKBOX_GROUP_KEY } from "./OCheckbox.types";
import { CheckboxRoot, CheckboxIndicator } from "reka-ui";
import { computed, inject } from "vue";

const props = withDefaults(defineProps<CheckboxProps>(), {
  size: "md",
  disabled: false,
});

const emit = defineEmits<CheckboxEmits>();

defineSlots<CheckboxSlots>();

// ── Group context ──────────────────────────────────────────────────────────
const groupContext = inject(CHECKBOX_GROUP_KEY, null);

const isGroupMember = computed(
  () => groupContext !== null && props.value !== undefined,
);

/** Whether this checkbox is checked, considering the group context if present */
const checked = computed<boolean | "indeterminate">(() => {
  if (isGroupMember.value && groupContext && props.value !== undefined) {
    return groupContext.isChecked(props.value);
  }
  return props.modelValue ?? false;
});

const isDisabled = computed(
  () => props.disabled || (groupContext?.disabled ?? false),
);

function handleUpdate(value: boolean | "indeterminate") {
  if (isGroupMember.value && groupContext && props.value !== undefined) {
    groupContext.toggle(props.value);
    emit("change", value);
  } else {
    emit("update:modelValue", value);
    emit("change", value);
  }
}

// ── Style ──────────────────────────────────────────────────────────────────
const boxSizeClasses: Record<NonNullable<CheckboxProps["size"]>, string> = {
  sm: "tw:size-3.5",
  md: "tw:size-4",
};

const labelSizeClasses: Record<NonNullable<CheckboxProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-sm",
};
</script>

<template>
  <label
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      isDisabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
  >
    <CheckboxRoot
      :id="id"
      :name="name"
      :checked="checked"
      :disabled="isDisabled"
      :class="[
        // Layout
        'tw:shrink-0 tw:rounded-sm tw:border',
        // Sizing
        boxSizeClasses[size ?? 'md'],
        // Base state
        'tw:bg-checkbox-bg tw:border-checkbox-border',
        // Hover
        'tw:enabled:hover:border-checkbox-hover-border',
        // Checked state
        'tw:data-[state=checked]:bg-checkbox-checked-bg',
        'tw:data-[state=checked]:border-checkbox-checked-border',
        // Indeterminate state
        'tw:data-[state=indeterminate]:bg-checkbox-indeterminate-bg',
        'tw:data-[state=indeterminate]:border-checkbox-indeterminate-border',
        // Disabled state
        'tw:data-[disabled]:bg-checkbox-disabled-bg',
        'tw:data-[disabled]:border-checkbox-disabled-border',
        // Focus
        'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-checkbox-focus-ring',
        // Transition
        'tw:transition-colors tw:duration-150',
        // Flex centering for indicator
        'tw:flex tw:items-center tw:justify-center',
      ]"
      @update:checked="handleUpdate"
    >
      <CheckboxIndicator
        :class="[
          'tw:flex tw:items-center tw:justify-center',
          'tw:text-checkbox-checked-fg',
        ]"
      >
        <!-- checkmark -->
        <svg
          v-if="checked !== 'indeterminate'"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="tw:size-full tw:p-0.5"
          aria-hidden="true"
        >
          <polyline points="2,6 5,9 10,3" />
        </svg>
        <!-- dash for indeterminate -->
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          class="tw:size-full tw:p-0.5"
          aria-hidden="true"
        >
          <line x1="2" y1="6" x2="10" y2="6" />
        </svg>
      </CheckboxIndicator>
    </CheckboxRoot>

    <span
      v-if="$slots.label || label"
      :class="[
        labelSizeClasses[size ?? 'md'],
        'tw:select-none tw:leading-none',
        isDisabled
          ? 'tw:text-checkbox-label-disabled'
          : 'tw:text-checkbox-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>
  </label>
</template>
