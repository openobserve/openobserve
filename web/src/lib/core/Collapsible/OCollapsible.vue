<script setup lang="ts">
import type {
  OCollapsibleProps,
  OCollapsibleEmits,
  OCollapsibleSlots,
} from "./OCollapsible.types";
import { useCollapsibleGroup } from "./useCollapsibleGroup";
import {
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
} from "reka-ui";
import { ref, computed, watch, useSlots } from "vue";
import OIcon from "../Icon/OIcon.vue";

const props = withDefaults(defineProps<OCollapsibleProps>(), {
  defaultOpen: false,
  variant: "default",
});

const emit = defineEmits<OCollapsibleEmits>();
defineSlots<OCollapsibleSlots>();

const slots = useSlots();
const hasCustomTrigger = computed(() => !!slots.trigger);

// ΓöÇΓöÇ Open state management ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/** Internal open state for uncontrolled mode */
const internalOpen = ref(props.defaultOpen);

/** Group accordion coordination (only active when `group` is set) */
const group = props.group ? useCollapsibleGroup(props.group) : null;

/**
 * Resolved open state:
 * 1. If `modelValue` is provided ΓåÆ parent-controlled
 * 2. If `group` is set ΓåÆ group accordion controls it
 * 3. Otherwise ΓåÆ internal uncontrolled state
 */
const isOpen = computed<boolean>(() => {
  if (props.modelValue !== undefined) return props.modelValue;
  if (group) return group.isOpen.value;
  return internalOpen.value;
});

function handleOpenChange(value: boolean) {
  if (group) {
    if (value) {
      group.open();
    } else {
      group.close();
    }
  } else {
    internalOpen.value = value;
  }

  emit("update:modelValue", value);

  if (value) {
    emit("open");
    // Reka UI CollapsibleContent uses CSS transitions;
    // "opened" fires on the next tick as an approximation.
    Promise.resolve().then(() => emit("opened"));
  } else {
    emit("close");
    Promise.resolve().then(() => emit("closed"));
  }
}

// Keep internalOpen in sync when modelValue is updated externally
watch(
  () => props.modelValue,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);
</script>

<template>
  <CollapsibleRoot
    :open="isOpen"
    @update:open="handleOpenChange"
    v-bind="$attrs"
  >
    <!-- Trigger -->
    <CollapsibleTrigger
      :class="[
        'tw:w-full tw:flex tw:items-center tw:gap-2 tw:text-start tw:cursor-pointer tw:select-none',
        'tw:transition-colors tw:duration-150 tw:outline-none',
        'tw:hover:bg-collapsible-trigger-hover-bg tw:active:bg-collapsible-trigger-active-bg',
        'tw:focus-visible:ring-2 tw:focus-visible:ring-collapsible-trigger-focus-ring tw:focus-visible:ring-offset-1',
        variant === 'sidebar'
          ? 'tw:px-3 tw:py-0 tw:min-h-[36px] tw:rounded-none'
          : 'tw:px-4 tw:py-2 tw:rounded-md',
      ]"
    >
      <!-- Sidebar: left-side chevron (always before slot or label) -->
      <OIcon
        v-if="variant === 'sidebar'"
        name="chevron-right"
        size="md"
        class="tw:text-collapsible-icon tw:transition-transform tw:duration-200"
        :class="isOpen ? 'tw:rotate-90' : 'tw:rotate-0'"
      />

      <!-- Custom trigger slot - renders after sidebar chevron if present -->
      <template v-if="hasCustomTrigger">
        <slot name="trigger" :open="isOpen" />
      </template>

      <!-- Default trigger ΓÇö label / icon / caption / chevron -->
      <template v-else>
        <span
          v-if="icon"
          class="material-icons-outlined tw:text-icon-md tw:text-collapsible-icon tw:shrink-0"
          aria-hidden="true"
          >{{ icon }}</span
        >

        <span class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
          <span
            :class="[
              'tw:font-semibold tw:text-collapsible-label tw:truncate',
              variant === 'sidebar' ? 'tw:text-[13px]' : 'tw:text-sm',
            ]"
            >{{ label }}</span
          >
          <span
            v-if="caption"
            class="tw:text-xs tw:text-collapsible-caption tw:truncate"
            >{{ caption }}</span
          >
        </span>

        <!-- Right chevron — default variant only -->
        <OIcon
          v-if="variant === 'default'"
          name="expand-more"
          size="md"
          class="tw:text-collapsible-icon tw:transition-transform tw:duration-200"
          :class="isOpen ? 'tw:rotate-180' : 'tw:rotate-0'"
        />
      </template>
    </CollapsibleTrigger>

    <!-- Animated content -->
    <CollapsibleContent class="o-collapsible-content">
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style>
.o-collapsible-content {
  overflow: hidden;
}

.o-collapsible-content[data-state="open"] {
  animation: o-collapsible-open 200ms ease-out;
}

.o-collapsible-content[data-state="closed"] {
  animation: o-collapsible-close 200ms ease-out;
}

@keyframes o-collapsible-open {
  from {
    height: 0;
  }
  to {
    height: var(--reka-collapsible-content-height);
  }
}

@keyframes o-collapsible-close {
  from {
    height: var(--reka-collapsible-content-height);
  }
  to {
    height: 0;
  }
}
</style>
