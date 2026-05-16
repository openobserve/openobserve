<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type {
  OptionGroupProps,
  OptionGroupEmits,
  OptionGroupSlots,
  OptionPrimitive,
} from "./OOptionGroup.types";
import ORadioGroup from "../Radio/ORadioGroup.vue";
import ORadio from "../Radio/ORadio.vue";
import OCheckboxGroup from "../Checkbox/OCheckboxGroup.vue";
import OCheckbox from "../Checkbox/OCheckbox.vue";
import { computed, useAttrs } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<OptionGroupProps>(), {
  type: "radio",
  orientation: "vertical",
  disabled: false,
  size: "md",
});

const emit = defineEmits<OptionGroupEmits>();

defineSlots<OptionGroupSlots>();

const effectiveError = computed(
  () => props.errorMessage || (props.error ? " " : null) || null,
);

const checkboxValue = computed<(string | number)[]>(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v.filter(
    (x): x is string | number => typeof x === "string" || typeof x === "number",
  );
  return [];
});

const optionLayoutClasses = computed(() =>
  props.orientation === "horizontal"
    ? "tw:flex tw:flex-row tw:flex-wrap tw:gap-3"
    : "tw:flex tw:flex-col tw:gap-2",
);

function handleRadio(val: OptionPrimitive) {
  emit("update:modelValue", val);
  emit("change", val);
}

function handleCheckbox(val: (string | number)[]) {
  emit("update:modelValue", val);
  emit("change", val);
}
</script>

<template>
  <div v-bind="$attrs" class="tw:flex tw:flex-col tw:gap-2 tw:w-full">
    <div
      v-if="$slots.label || label || $slots.tooltip"
      :class="[
        'tw:text-xs tw:font-medium tw:leading-none tw:flex tw:items-center tw:gap-1',
        disabled
          ? 'tw:text-option-group-label-disabled'
          : 'tw:text-option-group-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        :class="[
          'tw:cursor-help',
          disabled ? 'tw:text-option-group-label-disabled' : 'tw:text-option-group-label',
        ]"
      ><slot name="tooltip" /></OIcon>
    </div>

    <ORadioGroup
      v-if="type === 'radio'"
      :model-value="(modelValue as OptionPrimitive | undefined)"
      :disabled="disabled"
      :orientation="orientation"
      :name="name"
      :label="label"
      @update:model-value="handleRadio"
    >
      <ORadio
        v-for="opt in options"
        :key="String(opt.value)"
        :value="opt.value"
        :label="opt.label"
        :disabled="disabled || opt.disabled"
        :size="size"
      />
    </ORadioGroup>

    <OCheckboxGroup
      v-else
      :model-value="checkboxValue"
      :disabled="disabled"
      @update:model-value="handleCheckbox"
    >
      <div :class="optionLayoutClasses">
        <OCheckbox
          v-for="opt in options"
          :key="String(opt.value)"
          :value="(opt.value as string)"
          :label="opt.label"
          :disabled="disabled || opt.disabled"
          :size="size"
        />
      </div>
    </OCheckboxGroup>

    <div v-if="effectiveError || helpText" class="tw:flex tw:items-center tw:gap-2">
      <span
        v-if="effectiveError && effectiveError.trim()"
        class="tw:text-xs tw:text-option-group-error-text tw:leading-none"
        role="alert"
      >
        {{ effectiveError }}
      </span>
      <span
        v-else-if="helpText"
        class="tw:text-xs tw:text-option-group-label tw:leading-none"
      >
        {{ helpText }}
      </span>
    </div>
  </div>
</template>
