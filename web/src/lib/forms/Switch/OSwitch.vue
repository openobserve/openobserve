<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { SwitchProps, SwitchEmits, SwitchSlots } from "./OSwitch.types";
import { computed, onMounted, ref, useAttrs, useId, useSlots, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { splitControlAttrs, warnIfUnlabelled } from "@/lib/forms/controlAttrs";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { useI18nTyped } from "@/types/i18n";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Forward tabindex to the switch control; keep it off the wrapper (avoids a double tab-stop).
const inputTabindex = computed(() => $attrs["tabindex"] as number | string | undefined);
const split = computed(() => splitControlAttrs($attrs));
const wrapperAttrs = computed(() => split.value.wrapperAttrs);
const controlAttrs = computed(() => split.value.controlAttrs);

const props = withDefaults(defineProps<SwitchProps>(), {
  size: "md",
  disabled: false,
  labelPosition: "right",
  stateText: false,
});

const { t } = useI18nTyped();

const emit = defineEmits<SwitchEmits>();

defineSlots<SwitchSlots>();

const isDisabled = useLockedDisabled(() => props.disabled);

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
  if (isDisabled.value) return;
  const next = !isChecked.value;
  let emitValue: typeof props.modelValue;
  if (props.checkedValue !== undefined || props.uncheckedValue !== undefined) {
    emitValue = next ? (props.checkedValue ?? true) : (props.uncheckedValue ?? false);
  } else {
    emitValue = next;
  }
  internalValue.value = emitValue;
  emit("update:modelValue", emitValue);
  emit("change", emitValue);
}

// ── Track sizes ────────────────────────────────────────────────────────────
// p-0.5 eats 2px per side: thumb = height - 4, translate = width - 4 - thumb.
type TrackSize = {
  track: string;
  thumb: string;
  thumbTranslate: string;
};

const trackSizes: Record<NonNullable<SwitchProps["size"]>, TrackSize> = {
  sm: {
    track: "w-6 h-3.5",
    thumb: "size-2.5",
    thumbTranslate: "translate-x-2.5 rtl:-translate-x-2.5",
  },
  md: {
    track: "w-8 h-4.5",
    thumb: "size-3.5",
    thumbTranslate: "translate-x-3.5 rtl:-translate-x-3.5",
  },
  lg: {
    track: "w-9 h-5",
    thumb: "size-4",
    thumbTranslate: "translate-x-4 rtl:-translate-x-4",
  },
  xl: {
    track: "w-11.5 h-6",
    thumb: "size-5",
    thumbTranslate: "translate-x-5.5 rtl:-translate-x-5.5",
  },
};

const currentSizes = computed(() => trackSizes[props.size ?? "md"]);

const slots = useSlots();
const autoId = useId();
const buttonId = computed(() => props.id ?? autoId);
const labelId = computed(() => `${buttonId.value}-label`);
const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined || Boolean(slots.tooltip),
);
onMounted(() =>
  warnIfUnlabelled(
    "OSwitch",
    hasLabel.value || Boolean($attrs["aria-label"] || $attrs["aria-labelledby"]),
  ),
);
</script>

<template>
  <div
    v-bind="wrapperAttrs"
    :class="[
      'inline-flex items-center gap-2',
      labelPosition === 'left' ? 'flex-row-reverse' : 'flex-row',
      isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
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
      :disabled="isDisabled"
      :tabindex="inputTabindex"
      v-bind="controlAttrs"
      :class="[
        'relative inline-flex shrink-0 rounded-full',
        'items-center p-0.5',
        currentSizes.track,
        isChecked ? 'bg-switch-track-on' : 'bg-switch-track-off',
        isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        'outline-none',
        'focus-visible:outline-focus-ring-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
        'transition-[color,background-color,opacity] duration-200',
      ]"
    >
      <span
        :class="[
          'block rounded-full',
          'transition-transform duration-200',
          currentSizes.thumb,
          'shadow-switch-thumb dark:bg-text-heading bg-white',
          isChecked ? currentSizes.thumbTranslate : 'translate-x-0',
        ]"
      />
    </button>

    <span
      v-if="stateText"
      aria-hidden="true"
      :data-test="parentDataTest ? `${parentDataTest}-state` : undefined"
      :class="[
        'text-compact min-w-6 select-none',
        isDisabled
          ? 'text-input-label-text-disabled'
          : isChecked
            ? 'text-text-heading'
            : 'text-text-secondary',
      ]"
      >{{ isChecked ? t("common.switchOn") : t("common.switchOff") }}</span
    >

    <span
      v-if="hasLabel || $slots.tooltip"
      :id="labelId"
      :class="[
        'o-input-label text-compact flex items-center gap-1 leading-tight select-none',
        isDisabled
          ? 'text-input-label-text-disabled font-normal'
          : 'text-input-label-text font-medium',
      ]"
    >
      <slot name="label">{{ label }}</slot
      ><span v-if="required" aria-hidden="true">&nbsp;*</span>
      <OIcon
        v-if="$slots.tooltip"
        name="info-outline"
        size="sm"
        :data-test="parentDataTest ? `${parentDataTest}-info` : undefined"
        class="cursor-help"
        ><slot name="tooltip"
      /></OIcon>
    </span>
  </div>
</template>
