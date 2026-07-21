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
import { iconRegistry } from "../Icon/OIcon.icons";

const props = withDefaults(defineProps<OCollapsibleProps>(), {
  defaultOpen: false,
  variant: "default",
  // Provide explicit undefined default so Vue 3's boolean-prop auto-false
  // (applied to `boolean?` props) does not shadow the defaultOpen-based path.
  modelValue: undefined as boolean | undefined,
});

const emit = defineEmits<OCollapsibleEmits>();
defineSlots<OCollapsibleSlots>();

const slots = useSlots();
const hasCustomTrigger = computed(() => !!slots.trigger);

/** True when the icon name is registered in the OIcon SVG registry (kebab-case) */
const isOIcon = computed<boolean>(() =>
  Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry),
);

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
        'w-full flex items-center gap-2 text-start cursor-pointer select-none',
        'transition-colors duration-150 outline-none',
        'hover:bg-collapsible-trigger-hover-bg active:bg-collapsible-trigger-active-bg',
        'focus-visible:ring-2 focus-visible:ring-collapsible-trigger-focus-ring focus-visible:ring-offset-1',
        variant === 'sidebar'
          ? 'px-3 py-0 min-h-9 rounded-none'
          : 'px-2 py-2 rounded-default',
        triggerClass,
      ]"
    >
      <!-- Sidebar: left-side chevron (always before slot or label) -->
      <OIcon
        v-if="variant === 'sidebar'"
        name="chevron-right"
        size="md"
        class="text-collapsible-icon transition-transform duration-200"
        :class="isOpen ? 'rotate-90' : 'rotate-0'"
      />

      <!-- Custom trigger slot - renders after sidebar chevron if present -->
      <template v-if="hasCustomTrigger">
        <slot name="trigger" :open="isOpen" />
      </template>

      <!-- Default trigger ΓÇö label / icon / caption / chevron -->
      <template v-else>
        <!-- OIcon registry name (kebab-case SVG icon) -->
        <OIcon
          v-if="icon && isOIcon"
          :name="(icon as any)"
          size="md"
          class="text-collapsible-icon shrink-0"
        />
        <!-- Fallback: Material icon font glyph (legacy underscore names) -->
        <span
          v-else-if="icon"
          class="material-icons-outlined text-icon-md text-collapsible-icon shrink-0"
          aria-hidden="true"
          >{{ icon }}</span
        >

        <span class="flex flex-col flex-1 min-w-0">
          <span
            :class="[
              'font-medium text-collapsible-label truncate',
              variant === 'sidebar' ? 'text-compact' : 'text-sm',
            ]"
            >{{ label }}</span
          >
          <span
            v-if="caption"
            class="text-xs text-collapsible-caption truncate"
            >{{ caption }}</span
          >
        </span>

        <!-- Right chevron — default variant only -->
        <OIcon
          v-if="variant === 'default'"
          name="expand-more"
          size="md"
          class="text-collapsible-icon transition-transform duration-200"
          :class="isOpen ? 'rotate-180' : 'rotate-0'"
        />
      </template>
    </CollapsibleTrigger>

    <!-- Animated content -->
    <CollapsibleContent class="o-collapsible-content overflow-hidden">
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
/* keep(keyframes): reka-ui height animation keyed off [data-state] +
   --reka-collapsible-content-height; no utility can express it.
   These keyframes are referenced ONLY from the CSS in this block (never from a
   template `[animation:…]` utility), so `scoped` is safe: Vue renames the
   @keyframes and the `animation:` shorthands together and stays consistent.
   That is also why they do NOT belong in styles/keyframes.css.
   `.o-collapsible-content` sits on reka's CollapsibleContent in THIS
   component's template, so it carries this scope id. FieldExpansion.vue reaches
   the same class through its own `:deep()`, which is unaffected. */
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
