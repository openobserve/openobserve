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
  disabled: false,
  labelPosition: "end",
  offTone: "brand",
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

const isChecked = computed((): boolean => Boolean(internalValue.value));

function toggle() {
  if (isDisabled.value) return;
  const next = !isChecked.value;
  internalValue.value = next;
  emit("update:modelValue", next);
  emit("change", next);
}

const offClasses = computed(() =>
  props.offTone === "neutral"
    ? { border: "border-switch-border-off-neutral", thumb: "bg-switch-thumb-off-neutral" }
    : { border: "border-switch-border-off", thumb: "bg-switch-thumb-off" },
);

const slots = useSlots();
const autoId = useId();
const buttonId = computed(() => props.id ?? autoId);
const labelId = computed(() => `${buttonId.value}-label`);
const hasLabel = computed(
  () =>
    Boolean(slots.label) ||
    props.label !== undefined ||
    props.description !== undefined ||
    Boolean(slots.tooltip),
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
      'inline-flex items-start gap-2',
      labelPosition === 'start' ? 'flex-row-reverse' : 'flex-row',
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
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border p-px',
        (hasLabel || stateText) && 'mt-0.5',
        /* Three visually distinct states:
           ON       → primary FILLED track + white thumb (high contrast)
           OFF      → transparent track + primary outline + primary thumb
           DISABLED → transparent + grey dashed outline + grey thumb */
        isDisabled
          ? 'border-switch-disabled-border border-dashed bg-transparent'
          : isChecked
            ? 'bg-switch-track-on border-switch-border'
            : [offClasses.border, 'bg-transparent'],
        isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        'outline-none',
        'focus-visible:ring-focus-ring-accent focus-visible:ring-4',
        'transition-[color,background-color,border-color,box-shadow] duration-(--duration-control) ease-(--ease-control)',
      ]"
    >
      <span
        :class="[
          'block size-3 rounded-full',
          'transition-transform duration-(--duration-indicator) ease-(--ease-control)',
          isDisabled ? 'bg-switch-disabled-thumb' : isChecked ? 'bg-white' : offClasses.thumb,
          isChecked ? 'translate-x-3 rtl:-translate-x-3' : 'translate-x-0',
        ]"
      />
    </button>

    <span
      v-if="stateText"
      aria-hidden="true"
      :data-test="parentDataTest ? `${parentDataTest}-state` : undefined"
      :class="[
        'text-compact min-w-6 leading-5 select-none',
        isDisabled
          ? 'text-input-label-text-disabled'
          : isChecked
            ? 'text-text-heading'
            : 'text-text-secondary',
      ]"
      >{{ isChecked ? t("common.switchOn") : t("common.switchOff") }}</span
    >

    <span v-if="hasLabel" class="flex min-w-0 flex-col">
      <span
        :id="labelId"
        :class="[
          'o-input-label text-compact flex items-center gap-1 leading-5 font-normal select-none',
          isDisabled ? 'text-input-label-text-disabled' : 'text-input-label-text',
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
      <span v-if="description" class="text-text-muted text-xs leading-4">{{ description }}</span>
    </span>
  </div>
</template>
