<script setup lang="ts">
import type {
  ToggleGroupProps,
  ToggleGroupEmits,
  ToggleGroupSlots,
} from "./OToggleGroup.types";
import { ToggleGroupAnimatedKey } from "./OToggleGroup.types";
import { ToggleGroupRoot } from "reka-ui";
import {
  computed,
  provide,
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
} from "vue";

const props = withDefaults(defineProps<ToggleGroupProps>(), {
  type: "single",
  disabled: false,
  orientation: "horizontal",
  variant: "default",
  labelPosition: "left",
});

const emit = defineEmits<ToggleGroupEmits>();

const slots = defineSlots<ToggleGroupSlots>();

const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined,
);

// Sliding-selection indicator ------------------------------------------------
// On by default for every single-select group (one active item to track). A
// multiple-select group has no single active item, so it keeps per-item fills.
const animate = computed(() => props.type === "single");

// Tell descendant items to defer their active fill to the shared indicator.
provide(ToggleGroupAnimatedKey, animate);

const indicatorRef = ref<HTMLElement | null>(null);
// Runtime, per-render geometry of the active item — inherently pixel values from
// layout, so they live in an inline :style binding (there is no token/utility that
// can express "wherever the active item currently sits"). Mirrors the OToast
// progress-bar precedent for genuinely runtime style longhands.
const indicatorStyle = ref<Record<string, string>>({});
const indicatorVisible = ref(false);
// Suppressed on first paint so the pill doesn't slide in from the corner on load;
// enabled once positioned, so every later selection change animates.
const transitionEnabled = ref(false);

let resizeObserver: ResizeObserver | null = null;

const measure = () => {
  const indicator = indicatorRef.value;
  const track = indicator?.parentElement;
  if (!indicator || !track) return;

  const active = track.querySelector<HTMLElement>('[data-state="on"]');
  if (!active) {
    indicatorVisible.value = false;
    return;
  }

  // Position relative to the track's padding box (where an absolute left:0/top:0
  // child originates), subtracting the track border so the bordered variant lines
  // up as exactly as the borderless one.
  const trackRect = track.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  const trackStyle = getComputedStyle(track);
  const borderLeft = parseFloat(trackStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(trackStyle.borderTopWidth) || 0;
  const x = activeRect.left - trackRect.left - borderLeft;
  const y = activeRect.top - trackRect.top - borderTop;

  indicatorVisible.value = true;
  indicatorStyle.value = {
    width: `${activeRect.width}px`,
    height: `${activeRect.height}px`,
    transform: `translate(${x}px, ${y}px)`,
  };
};

const remeasure = async () => {
  if (!animate.value) return;
  await nextTick();
  measure();
};

// Reposition when the selection changes (the slide) …
watch(() => props.modelValue, remeasure);

onMounted(async () => {
  if (!animate.value) return;
  await nextTick();
  measure();
  // First position is set; from the next frame on, changes animate.
  requestAnimationFrame(() => {
    transitionEnabled.value = true;
  });
  // … and when item sizes change (responsive icon-only mode, items shown/hidden).
  const track = indicatorRef.value?.parentElement;
  if (track && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(track);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

const indicatorClasses = computed(() => [
  "pointer-events-none absolute left-0 top-0 rounded-default bg-toggle-item-active-bg",
  transitionEnabled.value &&
    "transition-[transform,width,height] duration-300 ease-out motion-reduce:transition-none",
  indicatorVisible.value ? "opacity-100" : "opacity-0",
]);

// Wrapper layout depends on label position: top stacks vertically, left/right
// sits inline. When there is no label, render only the ToggleGroupRoot.
const wrapperClasses = computed(() => {
  if (!hasLabel.value) return "";
  return [
    "inline-flex gap-2",
    props.labelPosition === "top"
      ? "flex-col items-start"
      : props.labelPosition === "right"
        ? "flex-row-reverse items-center"
        : "flex-row items-center",
  ].join(" ");
});
</script>

<template>
  <!-- With label: wrap in a flex container so the label and toggle bar sit
       together. Without label: render the ToggleGroupRoot directly to keep
       the existing inline-flex/sizing contract. -->
  <div v-if="hasLabel" :class="wrapperClasses">
    <span
      :class="[
        'o-input-label text-compact select-none leading-tight',
        disabled ? 'font-normal text-input-label-text-disabled' : 'font-medium text-input-label-text',
      ]"
    >
      <slot name="label">{{ label }}</slot>
    </span>

    <ToggleGroupRoot
      :type="type"
      :model-value="modelValue"
      :disabled="disabled"
      :orientation="orientation"
      :data-variant="variant"
      :class="[
        'relative inline-flex items-stretch',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        'bg-toggle-track-bg rounded-default p-0.5',
      ]"
      @update:model-value="
        (v) => {
          if (type === 'single' && (v === null || v === undefined || v === '')) return;
          emit('update:modelValue', v);
        }
      "
    >
      <!-- Sliding active-selection indicator (opt-in via animatedSelection) -->
      <div
        v-if="animate"
        ref="indicatorRef"
        aria-hidden="true"
        :class="indicatorClasses"
        :style="indicatorStyle"
      />
      <slot />
    </ToggleGroupRoot>
  </div>

  <ToggleGroupRoot
    v-else
    :type="type"
    :model-value="modelValue"
    :disabled="disabled"
    :orientation="orientation"
    :data-variant="variant"
    :class="[
      'relative inline-flex items-stretch',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
      'bg-toggle-track-bg rounded-default p-0.5',
      'border border-toggle-border',
    ]"
    @update:model-value="
      (v) => {
        if (type === 'single' && (v === null || v === undefined || v === '')) return;
        emit('update:modelValue', v);
      }
    "
  >
    <!-- Sliding active-selection indicator (opt-in via animatedSelection) -->
    <div
      v-if="animate"
      ref="indicatorRef"
      aria-hidden="true"
      :class="indicatorClasses"
      :style="indicatorStyle"
    />
    <slot />
  </ToggleGroupRoot>
</template>
