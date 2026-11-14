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
import { computed, inject, useSlots } from "vue";
import { useLockedDisabled } from "@/composables/useFeatureLock";

const props = withDefaults(defineProps<CheckboxProps>(), {
  disabled: false,
  indeterminate: false,
});

const emit = defineEmits<CheckboxEmits>();

defineSlots<CheckboxSlots>();
const slots = useSlots();
const hasText = computed(() => Boolean(slots.label || props.label || props.description));

// ── Group context ──────────────────────────────────────────────────────────
const groupContext = inject(CHECKBOX_GROUP_KEY, null);

const resolvedValue = computed<CheckboxPrimitive | undefined>(() => props.value);

const isGroupMember = computed(() => groupContext !== null && resolvedValue.value !== undefined);

const isArrayModel = computed(
  () => Array.isArray(props.modelValue) && resolvedValue.value !== undefined,
);

const hasCustomValues = computed(
  () => props.trueValue !== undefined || props.falseValue !== undefined,
);

/** Whether this checkbox is checked, considering the group context if present */
const checked = computed((): boolean | "indeterminate" => {
  if (props.indeterminate) return "indeterminate";
  if (isGroupMember.value && groupContext && resolvedValue.value !== undefined) {
    return groupContext.isChecked(resolvedValue.value);
  }

  if (isArrayModel.value && resolvedValue.value !== undefined) {
    return (props.modelValue as CheckboxPrimitive[]).includes(resolvedValue.value);
  }

  if (hasCustomValues.value) {
    if (props.indeterminateValue !== undefined && props.modelValue === props.indeterminateValue) {
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

const isDisabled = useLockedDisabled(() => props.disabled || (groupContext?.disabled ?? false));

const dataState = computed<"checked" | "unchecked" | "indeterminate">(() => {
  if (checked.value === "indeterminate") return "indeterminate";
  return checked.value ? "checked" : "unchecked";
});

function mapToCustomValue(value: boolean | "indeterminate"): CheckboxModelValue {
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

  if (isGroupMember.value && groupContext && resolvedValue.value !== undefined) {
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
</script>

<template>
  <label
    :class="[
      'inline-flex items-start gap-2',
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
      :aria-label="ariaLabel"
      :aria-checked="checked === 'indeterminate' ? 'mixed' : checked"
      :data-state="dataState"
      :disabled="isDisabled"
      :class="[
        'rounded-chip size-4 shrink-0 cursor-[inherit] border',
        hasText && 'mt-0.5',
        // Base / unchecked
        'bg-checkbox-bg border-checkbox-border',
        // Hover
        'enabled:hover:border-checkbox-hover-border',
        // Checked and mixed
        'data-[state=checked]:bg-checkbox-checked-bg data-[state=checked]:border-checkbox-checked-border',
        'data-[state=indeterminate]:bg-checkbox-checked-bg data-[state=indeterminate]:border-checkbox-checked-border',
        // Disabled
        'disabled:bg-checkbox-disabled-bg',
        'disabled:border-checkbox-disabled-border',
        // Focus
        'ring-offset-surface-base focus-visible:ring-checkbox-focus-ring ring-offset-1 outline-none focus-visible:ring-2',
        // Transition
        'transition-[color,background-color,border-color,box-shadow] duration-150',
        // Centering for indicator
        'flex items-center justify-center',
      ]"
      @click="toggle"
    >
      <!-- Clicks pass through the tick: unchecking removes it mid-click, and the label then re-clicks the box. -->
      <span
        v-if="checked === true"
        class="text-checkbox-checked-fg pointer-events-none flex size-full items-center justify-center"
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
        class="text-checkbox-checked-fg pointer-events-none flex size-full items-center justify-center"
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

    <span v-if="hasText" class="flex min-w-0 flex-col">
      <span
        v-if="$slots.label || label"
        :class="[
          'o-input-label text-compact leading-5 font-normal select-none',
          isDisabled ? 'text-input-label-text-disabled' : 'text-input-label-text',
        ]"
      >
        <slot name="label">{{ label }}</slot
        ><span v-if="required" aria-hidden="true">&nbsp;*</span>
      </span>
      <span v-if="description" class="text-text-muted text-xs leading-4">{{ description }}</span>
    </span>
  </label>
</template>
