<script setup lang="ts">
import type {
  ToggleGroupProps,
  ToggleGroupEmits,
  ToggleGroupSlots,
  ToggleGroupContext,
} from "./OToggleGroup.types";
import {
  ToggleGroupAnimatedKey,
  TOGGLE_GROUP_CONTEXT_KEY,
} from "./OToggleGroup.types";
import { ToggleGroupRoot, type AcceptableValue } from "reka-ui";
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
  reorderable: false,
});

const emit = defineEmits<ToggleGroupEmits>();

const slots = defineSlots<ToggleGroupSlots>();

// reka-ui's ToggleGroupRoot omits `boolean` from its model type; our public API
// allows it (boolean-valued groups round-trip fine), so narrow at the boundary.
const rekaModelValue = computed(
  () => props.modelValue as AcceptableValue | AcceptableValue[],
);

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
// True once the indicator holds a real, laid-out position. Until then (and after
// any reveal) the next placement snaps rather than slides.
const hasValidPosition = ref(false);
// Drives whether the transition is present in the *after-change* style: only a
// genuine selection change turns it on, so mount/reveal/reflow snap into place.
const transitionOn = ref(false);

let resizeObserver: ResizeObserver | null = null;

/**
 * Place the indicator over the active item.
 * @param animated slide to the new position (a real selection change) vs. snap
 *   instantly (mount, reveal, or reflow — never animate those).
 */
const measure = (animated: boolean) => {
  const indicator = indicatorRef.value;
  const track = indicator?.parentElement;
  if (!indicator || !track) return;

  const active = track.querySelector<HTMLElement>('[data-state="on"]');
  // Skip while the group (or an ancestor) is hidden / not laid out — e.g. a tab
  // panel that isn't the visible one. Measuring here would store a bogus
  // 0-position, and revealing later would slide the pill in from the corner
  // (the "random animation" bug). Keep the last valid position instead.
  if (!active || active.offsetParent === null) return;

  // Position relative to the track's padding box (where an absolute left:0/top:0
  // child originates), subtracting the track border so the bordered variant lines
  // up as exactly as the borderless one.
  const trackRect = track.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (activeRect.width === 0) return; // laid out but zero-sized → not ready yet
  const trackStyle = getComputedStyle(track);
  const borderLeft = parseFloat(trackStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(trackStyle.borderTopWidth) || 0;
  const x = activeRect.left - trackRect.left - borderLeft;
  const y = activeRect.top - trackRect.top - borderTop;

  // Transition only when asked AND we already had a valid position (i.e. the group
  // was already visible). The very first placement always snaps. Setting the flag
  // and the style in the same tick means the transition property and the transform
  // update together, so `false` reliably suppresses the slide.
  transitionOn.value = animated && hasValidPosition.value;
  hasValidPosition.value = true;
  indicatorVisible.value = true;
  indicatorStyle.value = {
    width: `${activeRect.width}px`,
    height: `${activeRect.height}px`,
    transform: `translate(${x}px, ${y}px)`,
  };
};

// Slide when the selection changes …
watch(
  () => props.modelValue,
  async () => {
    if (!animate.value) return;
    await nextTick();
    measure(true);
  },
);

onMounted(async () => {
  if (!animate.value) return;
  await nextTick();
  measure(false);
  // … but only snap when item sizes/visibility change (responsive icon-only mode,
  // items shown/hidden, the group being revealed) — these are not user selections.
  const track = indicatorRef.value?.parentElement;
  if (track && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => measure(false));
    resizeObserver.observe(track);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

const indicatorClasses = computed(() => [
  "pointer-events-none absolute left-0 top-0 rounded-default bg-toggle-item-active-bg",
  transitionOn.value &&
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

// ── Drag-to-reorder (opt-in via `reorderable`) ─────────────────────────────
// Handlers are delegated on the ToggleGroupRoot: drag events bubble up from the
// draggable items. State is reactive (not imperative DOM styling) so the
// dragged item dims and the drop target shows an insertion line via
// OToggleGroupItem. OToggleGroup doesn't own the item list, so on drop it only
// reports the intended move (by item value + side) via `reorder`; the parent
// applies it to its data.
const isVertical = computed(() => props.orientation === "vertical");

const draggingValue = ref<string | null>(null);
const dropTargetValue = ref<string | null>(null);
const dropBefore = ref(true);

function clearDrag(): void {
  draggingValue.value = null;
  dropTargetValue.value = null;
}

function itemElFromEvent(e: DragEvent): HTMLElement | null {
  return (
    (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-otoggle-value]",
    ) ?? null
  );
}

function onItemDragStart(e: DragEvent): void {
  if (!props.reorderable) return;
  const el = itemElFromEvent(e);
  const value = el?.dataset.otoggleValue ?? null;
  if (value == null) return;
  draggingValue.value = value;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", value);
  }
}

function onItemDragOver(e: DragEvent): void {
  if (!props.reorderable || draggingValue.value == null) return;
  e.preventDefault(); // required to allow a drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const el = itemElFromEvent(e);
  const value = el?.dataset.otoggleValue ?? null;
  if (el == null || value == null || value === draggingValue.value) {
    dropTargetValue.value = null;
    return;
  }
  // Pointer past the item's midpoint → drop after it, else before it.
  const rect = el.getBoundingClientRect();
  dropBefore.value = isVertical.value
    ? e.clientY < rect.top + rect.height / 2
    : e.clientX < rect.left + rect.width / 2;
  dropTargetValue.value = value;
}

function onItemDrop(e: DragEvent): void {
  if (!props.reorderable) return;
  e.preventDefault();
  const from =
    draggingValue.value ?? e.dataTransfer?.getData("text/plain") ?? null;
  const to = dropTargetValue.value;
  if (from != null && to != null && from !== to) {
    emit("reorder", { from, to, before: dropBefore.value });
  }
  clearDrag();
}

function onItemDragEnd(): void {
  clearDrag();
}

/**
 * Listeners are attached only in reorderable mode so non-reorderable groups
 * keep their existing (listener-free) DOM contract.
 */
const dragListeners = computed(() =>
  props.reorderable
    ? {
        onDragstart: onItemDragStart,
        onDragover: onItemDragOver,
        onDrop: onItemDrop,
        onDragend: onItemDragEnd,
      }
    : {},
);

/** Provide drag state to OToggleGroupItem descendants */
const context = computed<ToggleGroupContext>(() => ({
  reorderable: props.reorderable,
  draggingValue: draggingValue.value,
  dropTargetValue: dropTargetValue.value,
  dropBefore: dropBefore.value,
  isVertical: isVertical.value,
}));

provide(TOGGLE_GROUP_CONTEXT_KEY, context);
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
      :model-value="rekaModelValue"
      :disabled="disabled"
      :orientation="orientation"
      :data-variant="variant"
      :class="[
        'relative inline-flex items-stretch',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        'bg-toggle-track-bg rounded-default p-0.5',
      ]"
      v-bind="dragListeners"
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
    :model-value="rekaModelValue"
    :disabled="disabled"
    :orientation="orientation"
    :data-variant="variant"
    :class="[
      'relative inline-flex items-stretch',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
      'bg-toggle-track-bg rounded-default p-0.5',
      'border border-toggle-border',
    ]"
    v-bind="dragListeners"
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
