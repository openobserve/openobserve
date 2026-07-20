<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  CheckboxProps,
  CheckboxEmits,
  CheckboxSlots,
  CheckboxPrimitive,
  CheckboxModelValue,
} from "./OCheckbox.types";
import { CHECKBOX_GROUP_KEY } from "./OCheckbox.types";
import { computed, inject } from "vue";

const props = withDefaults(defineProps<CheckboxProps>(), {
  size: "md",
  color: "primary",
  disabled: false,
});

const emit = defineEmits<CheckboxEmits>();

defineSlots<CheckboxSlots>();

// ── Group context ──────────────────────────────────────────────────────────
const groupContext = inject(CHECKBOX_GROUP_KEY, null);

const resolvedValue = computed<CheckboxPrimitive | undefined>(
  () => props.value ?? props.val,
);

const isGroupMember = computed(
  () => groupContext !== null && resolvedValue.value !== undefined,
);

const isArrayModel = computed(
  () => Array.isArray(props.modelValue) && resolvedValue.value !== undefined,
);

const hasCustomValues = computed(
  () => props.trueValue !== undefined || props.falseValue !== undefined,
);

/** Whether this checkbox is checked, considering the group context if present */
const checked = computed((): boolean | "indeterminate" => {
  if (
    isGroupMember.value &&
    groupContext &&
    resolvedValue.value !== undefined
  ) {
    return groupContext.isChecked(resolvedValue.value);
  }

  if (isArrayModel.value && resolvedValue.value !== undefined) {
    return (props.modelValue as CheckboxPrimitive[]).includes(
      resolvedValue.value,
    );
  }

  if (hasCustomValues.value) {
    if (
      props.indeterminateValue !== undefined &&
      props.modelValue === props.indeterminateValue
    ) {
      return "indeterminate";
    }
    if (props.trueValue !== undefined) {
      return props.modelValue === props.trueValue;
    }
    return Boolean(props.modelValue);
  }

  if (props.modelValue === "indeterminate") return "indeterminate";
  return Boolean(props.modelValue);
});

const isDisabled = computed(
  () => props.disabled || (groupContext?.disabled ?? false),
);

const dataState = computed<"checked" | "unchecked" | "indeterminate">(() => {
  if (checked.value === "indeterminate") return "indeterminate";
  return checked.value ? "checked" : "unchecked";
});

function mapToCustomValue(
  value: boolean | "indeterminate",
): CheckboxModelValue {
  if (!hasCustomValues.value) return value;
  if (value === "indeterminate") {
    return props.indeterminateValue ?? "indeterminate";
  }
  if (value) {
    return props.trueValue ?? true;
  }
  return props.falseValue ?? false;
}

function toggle() {
  if (isDisabled.value) return;

  if (
    isGroupMember.value &&
    groupContext &&
    resolvedValue.value !== undefined
  ) {
    groupContext.toggle(resolvedValue.value);
    emit("change", !groupContext.isChecked(resolvedValue.value));
    return;
  }

  if (isArrayModel.value && resolvedValue.value !== undefined) {
    const current = [...(props.modelValue as CheckboxPrimitive[])];
    const next = current.includes(resolvedValue.value)
      ? current.filter((item) => item !== resolvedValue.value)
      : [...current, resolvedValue.value];
    emit("update:modelValue", next);
    emit("change", next);
    return;
  }

  // Indeterminate transitions to checked, then unchecked → checked → unchecked
  const nextBool = checked.value === true ? false : true;
  const nextValue = mapToCustomValue(nextBool);
  emit("update:modelValue", nextValue);
  emit("change", nextValue);
}

// ── Style ──────────────────────────────────────────────────────────────────
const boxSizeClasses: Record<NonNullable<CheckboxProps["size"]>, string> = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
};

const labelSizeClasses: Record<NonNullable<CheckboxProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-xs",
  md: "text-sm",
};
</script>

<template>
  <label
    :class="[
      'inline-flex items-center gap-2',
      isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    ]"
    @click.stop
  >
    <!-- Plain button — avoids reka-ui controlled-component timing issues -->
    <button
      :id="id"
      :name="name"
      type="button"
      role="checkbox"
      :aria-checked="checked === 'indeterminate' ? 'mixed' : checked"
      :data-state="dataState"
      :disabled="isDisabled"
      :class="[
        'shrink-0 rounded-checkbox border cursor-[inherit]',
        boxSizeClasses[size ?? 'md'],
        // Base / unchecked
        'bg-checkbox-bg border-checkbox-border',
        // Hover
        'enabled:hover:border-checkbox-hover-border',
        // Checked
        color === 'primary' && 'data-[state=checked]:bg-checkbox-checked-bg',
        color === 'primary' && 'data-[state=checked]:border-checkbox-checked-border',
        color === 'negative' && 'data-[state=checked]:bg-error-600',
        color === 'negative' && 'data-[state=checked]:border-error-600',
        // Indeterminate
        color === 'primary' && 'data-[state=indeterminate]:bg-checkbox-checked-bg',
        color === 'primary' && 'data-[state=indeterminate]:border-checkbox-checked-border',
        color === 'negative' && 'data-[state=indeterminate]:bg-error-600',
        color === 'negative' && 'data-[state=indeterminate]:border-error-600',
        // Disabled
        'disabled:bg-checkbox-disabled-bg',
        'disabled:border-checkbox-disabled-border',
        // Focus
        'outline-none ring-offset-1 ring-offset-surface-base focus-visible:ring-2 focus-visible:ring-checkbox-focus-ring',
        // Transition
        'transition-[color,background-color,border-color,box-shadow] duration-150',
        // Centering for indicator
        'flex items-center justify-center',
      ]"
      @click="toggle"
    >
      <span
        v-if="checked === true"
        class="flex items-center justify-center text-checkbox-checked-fg size-full"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-full p-0.5"
          aria-hidden="true"
        >
          <polyline points="2,6 5,9 10,3" />
        </svg>
      </span>
      <span
        v-else-if="checked === 'indeterminate'"
        class="flex items-center justify-center text-checkbox-checked-fg size-full"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          class="size-full p-0.5"
          aria-hidden="true"
        >
          <line x1="2" y1="6" x2="10" y2="6" />
        </svg>
      </span>
    </button>

    <span
      v-if="$slots.label || label"
      :class="[
        'o-input-label text-compact select-none leading-tight',
        isDisabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text',
      ]"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true">&nbsp;*</span>
    </span>
  </label>
</template>
