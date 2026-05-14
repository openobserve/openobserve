<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchEmits, SwitchSlots } from "./OSwitch.types";
import { computed, ref, useId, useSlots, watch } from "vue";

const props = withDefaults(defineProps<SwitchProps>(), {
  size: "md",
  disabled: false,
  labelPosition: "right",
});

const emit = defineEmits<SwitchEmits>();

defineSlots<SwitchSlots>();

// ── Local state — immediate visual feedback ────────────────────────────────
const internalValue = ref(props.modelValue);

watch(
  () => props.modelValue,
  (v) => {
    internalValue.value = v;
  },
);

const isChecked = computed((): boolean => {
  const v = internalValue.value;
  if (props.checkedValue !== undefined) return v === props.checkedValue;
  return Boolean(v);
});

function toggle() {
  if (props.disabled) return;
  const next = !isChecked.value;
  let emitValue: typeof props.modelValue;
  if (props.checkedValue !== undefined || props.uncheckedValue !== undefined) {
    emitValue = next
      ? (props.checkedValue ?? true)
      : (props.uncheckedValue ?? false);
  } else {
    emitValue = next;
  }
  internalValue.value = emitValue;
  emit("update:modelValue", emitValue);
  emit("change", emitValue);
}

// ── Track sizes ────────────────────────────────────────────────────────────
type TrackSize = { track: string; thumb: string; thumbTranslate: string };

const trackSizes: Record<NonNullable<SwitchProps["size"]>, TrackSize> = {
  sm: {
    track: "tw:w-7 tw:h-4",
    thumb: "tw:size-3",
    thumbTranslate: "tw:translate-x-3",
  },
  md: {
    track: "tw:w-9 tw:h-5",
    thumb: "tw:size-4",
    thumbTranslate: "tw:translate-x-4",
  },
  lg: {
    track: "tw:w-11 tw:h-6",
    thumb: "tw:size-5",
    thumbTranslate: "tw:translate-x-5",
  },
};

const labelSize: Record<NonNullable<SwitchProps["size"]>, string> = {
  sm: "tw:text-xs",
  md: "tw:text-sm",
  lg: "tw:text-sm",
};

const currentSizes = computed(() => trackSizes[props.size ?? "md"]);

const slots = useSlots();
const autoId = useId();
const buttonId = computed(() => props.id ?? autoId);
const labelId = computed(() => `${buttonId.value}-label`);
const hasLabel = computed(() => Boolean(slots.label) || props.label !== undefined);
</script>

<template>
  <div
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      labelPosition === 'left' ? 'tw:flex-row-reverse' : 'tw:flex-row',
      disabled ? 'tw:cursor-not-allowed tw:opacity-60' : 'tw:cursor-pointer',
    ]"
    @click="toggle"
  >
    <!-- Plain button — avoids reka-ui controlled-component timing issues -->
    <button
      :id="buttonId"
      :name="name"
      type="button"
      role="switch"
      :aria-checked="isChecked"
      :aria-labelledby="hasLabel ? labelId : undefined"
      :data-state="isChecked ? 'checked' : 'unchecked'"
      :disabled="disabled"
      :class="[
        'tw:relative tw:inline-flex tw:shrink-0 tw:rounded-full',
        'tw:p-0.5 tw:items-center',
        currentSizes.track,
        isChecked ? 'tw:bg-switch-track-on' : 'tw:bg-switch-track-off',
        disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
        disabled && isChecked
          ? 'tw:opacity-60 tw:bg-switch-disabled-track-on'
          : disabled
            ? 'tw:opacity-60 tw:bg-switch-disabled-track-off'
            : '',
        'tw:outline-none',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-switch-focus-ring',
        'tw:transition-colors tw:duration-200',
      ]"
    >
      <span
        :class="[
          'tw:block tw:rounded-full tw:shadow-sm',
          'tw:transition-transform tw:duration-200',
          currentSizes.thumb,
          disabled ? 'tw:bg-switch-disabled-thumb' : 'tw:bg-switch-thumb',
          isChecked ? currentSizes.thumbTranslate : 'tw:translate-x-0',
        ]"
      />
    </button>

    <span
      v-if="hasLabel"
      :id="labelId"
      :class="[
        labelSize[size ?? 'md'],
        'tw:select-none tw:leading-none',
        disabled ? 'tw:text-switch-label-disabled' : 'tw:text-switch-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>
  </div>
</template>
