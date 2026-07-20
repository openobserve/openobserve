<script setup lang="ts">
import type {
  ToggleGroupProps,
  ToggleGroupEmits,
  ToggleGroupSlots,
  ToggleGroupContext,
} from "./OToggleGroup.types";
import { TOGGLE_GROUP_CONTEXT_KEY } from "./OToggleGroup.types";
import { ToggleGroupRoot } from "reka-ui";
import { computed, provide, ref } from "vue";

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

const hasLabel = computed(
  () => Boolean(slots.label) || props.label !== undefined,
);

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
        'o-input-label text-sm font-medium select-none leading-tight',
        disabled && 'o-input-label--disabled',
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
        'inline-flex items-stretch',
        orientation === 'vertical' ? 'flex-col' : 'flex-row',
        'bg-[var(--color-toggle-track-bg)] rounded-lg p-0.5',
      ]"
      v-bind="dragListeners"
      @update:model-value="
        (v) => {
          if (type === 'single' && (v === null || v === undefined || v === '')) return;
          emit('update:modelValue', v);
        }
      "
    >
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
      'inline-flex items-stretch',
      orientation === 'vertical' ? 'flex-col' : 'flex-row',
      'bg-[var(--color-toggle-track-bg)] rounded-lg p-0.5',
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
    <slot />
  </ToggleGroupRoot>
</template>
