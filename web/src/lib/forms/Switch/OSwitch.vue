<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchEmits, SwitchSlots } from "./OSwitch.types";
import { computed, ref, useAttrs, useId, useSlots, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

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
// border-2 (2px each side) + p-0.5 (2px each side) = 4px eaten from each dimension
// thumb = track_height - 4(border) - 4(padding), translate = track_width - 4 - 4 - thumb
type TrackSize = { track: string; thumb: string; thumbTranslate: string };

const trackSizes: Record<NonNullable<SwitchProps["size"]>, TrackSize> = {
  sm: {
    track: "tw:w-6 tw:h-3.5",
    thumb: "tw:size-1.5",
    thumbTranslate: "tw:translate-x-2",
  },
  md: {
    track: "tw:w-7 tw:h-4.5",
    thumb: "tw:size-2.5",
    thumbTranslate: "tw:translate-x-2.5",
  },
  lg: {
    track: "tw:w-8 tw:h-5",
    thumb: "tw:size-3",
    thumbTranslate: "tw:translate-x-3",
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
const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined || Boolean(slots.tooltip),
);
</script>

<template>
  <div
    v-bind="$attrs"
    :class="[
      'tw:inline-flex tw:items-center tw:gap-2',
      labelPosition === 'left' ? 'tw:flex-row-reverse' : 'tw:flex-row',
      disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
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
        'tw:p-0.5 tw:items-center tw:bg-transparent tw:border-2',
        currentSizes.track,
        props.disabled
          ? 'tw:border-switch-disabled-border'
          : isChecked
            ? 'tw:border-switch-border'
            : 'tw:border-switch-border-off',
        props.disabled ? 'tw:cursor-not-allowed' : 'tw:cursor-pointer',
        'tw:outline-none tw:ring-offset-1 tw:ring-offset-surface-base',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-switch-focus-ring',
        'tw:transition-[color,background-color,border-color,box-shadow] tw:duration-200',
      ]"
    >
      <span
        :class="[
          'tw:block tw:rounded-full',
          'tw:transition-transform tw:duration-200',
          currentSizes.thumb,
          props.disabled
            ? 'tw:bg-switch-disabled-thumb'
            : isChecked
              ? 'tw:bg-switch-thumb-on'
              : 'tw:bg-switch-thumb-off',
          isChecked ? currentSizes.thumbTranslate : 'tw:translate-x-0',
        ]"
      />
    </button>

    <span
      v-if="hasLabel || $slots.tooltip"
      :id="labelId"
      :class="[
        labelSize[size ?? 'md'],
        'tw:select-none tw:leading-none tw:flex tw:items-center tw:gap-1',
        disabled ? 'tw:text-switch-label-disabled' : 'tw:text-switch-label',
      ]"
    >
      <slot name="label">{{ label }}</slot>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="tw:cursor-help"
      ><slot name="tooltip" /></OIcon>
    </span>
  </div>
</template>
