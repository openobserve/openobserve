<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchEmits, SwitchSlots } from "./OSwitch.types";
import { computed, ref, useAttrs, useId, useSlots, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the switch control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const wrapperAttrs = computed(() => {
  const { tabindex, ...rest } = $attrs;
  return rest;
});

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
    track: "w-6 h-3.5",
    thumb: "size-1.5",
    thumbTranslate: "translate-x-2",
  },
  md: {
    track: "w-7 h-4.5",
    thumb: "size-2.5",
    thumbTranslate: "translate-x-2.5",
  },
  lg: {
    track: "w-8 h-5",
    thumb: "size-3",
    thumbTranslate: "translate-x-3",
  },
  xl: {
    track: "w-11.5 h-6",
    thumb: "size-4.5",
    thumbTranslate: "translate-x-5",
  },
};

const labelSize: Record<NonNullable<SwitchProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-sm",
  xl: "text-lg",
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
    v-bind="wrapperAttrs"
    :class="[
      'inline-flex items-center gap-2',
      labelPosition === 'left' ? 'flex-row-reverse' : 'flex-row',
      disabled ? 'cursor-not-allowed' : 'cursor-pointer',
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
      :data-test="parentDataTest ? `${parentDataTest}-btn` : undefined"
      :disabled="disabled"
      :tabindex="inputTabindex"
      :class="[
        'relative inline-flex shrink-0 rounded-full',
        'p-0.5 items-center border-2',
        currentSizes.track,
        /* Three visually distinct states:
           ON       → primary FILLED track + white thumb (high contrast)
           OFF      → transparent track + primary outline + primary thumb
           DISABLED → transparent + grey dashed outline + grey thumb */
        props.disabled
          ? 'bg-transparent border-switch-disabled-border border-dashed'
          : isChecked
            ? 'bg-primary-500 border-switch-border'
            : 'bg-transparent border-switch-border-off',
        props.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        'outline-none',
        'focus-visible:ring-4 focus-visible:ring-accent/25',
        'transition-[color,background-color,border-color,box-shadow] duration-200',
      ]"
    >
      <span
        :class="[
          'block rounded-full',
          'transition-transform duration-200',
          currentSizes.thumb,
          props.disabled
            ? 'bg-switch-disabled-thumb'
            : isChecked
              ? 'bg-white'
              : 'bg-switch-thumb-off',
          isChecked ? currentSizes.thumbTranslate : 'translate-x-0',
        ]"
      />
    </button>

    <span
      v-if="hasLabel || $slots.tooltip"
      :id="labelId"
      :class="[
        'o-input-label text-compact select-none leading-tight flex items-center gap-1',
        disabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text',
      ]"
    >
      <slot name="label">{{ label }}</slot><span v-if="required" aria-hidden="true">&nbsp;*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
      ><slot name="tooltip" /></OIcon>
    </span>
  </div>
</template>
