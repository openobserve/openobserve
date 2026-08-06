<script setup lang="ts">
import type { OCollapsibleProps, OCollapsibleEmits, OCollapsibleSlots } from "./OCollapsible.types";
import { useCollapsibleGroup } from "./useCollapsibleGroup";
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui";
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
  <CollapsibleRoot :open="isOpen" @update:open="handleOpenChange" v-bind="$attrs">
    <!-- Trigger -->
    <CollapsibleTrigger
      :class="[
        'flex w-full cursor-pointer items-center gap-2 text-start select-none',
        'transition-colors duration-150 outline-none',
        'hover:bg-collapsible-trigger-hover-bg active:bg-collapsible-trigger-active-bg',
        'focus-visible:ring-collapsible-trigger-focus-ring focus-visible:ring-2 focus-visible:ring-offset-1',
        variant === 'config'
          ? [
              'group min-h-9 rounded-none px-3 py-0',
              // z-20 keeps the sticky header above section content while
              // scrolling — OToggleGroup items are positioned at z-10, so a
              // z-10 header would tie and let the toggle bleed over it.
              'bg-surface-panel sticky top-11 z-20',
              'border-l-2 border-l-transparent',
              'data-[state=open]:bg-collapsible-trigger-open-bg',
              'data-[state=open]:border-l-collapsible-open-accent',
            ]
          : variant === 'sidebar'
            ? 'min-h-9 rounded-none px-3 py-0'
            : 'rounded-default px-2 py-2',
        triggerClass,
      ]"
    >
      <!--
        Config variant (dashboard panel config only): one consistent frame for
        every section header — [section icon] [content] [right chevron] — with
        an open-state accent and a sticky header. Sections that supply a custom
        #trigger (e.g. an info tooltip) get the same icon+chevron frame.
      -->
      <template v-if="variant === 'config'">
        <OIcon
          v-if="icon && isOIcon"
          :name="icon as any"
          size="sm"
          class="text-collapsible-icon group-data-[state=open]:text-collapsible-icon-open shrink-0"
        />
        <span
          v-else-if="icon"
          class="material-icons-outlined text-icon-sm text-collapsible-icon group-data-[state=open]:text-collapsible-icon-open shrink-0"
          aria-hidden="true"
          >{{ icon }}</span
        >

        <span
          v-if="hasCustomTrigger"
          class="group-data-[state=open]:text-collapsible-icon-open flex min-w-0 flex-1 items-center gap-2"
        >
          <slot name="trigger" :open="isOpen" />
        </span>
        <span v-else class="flex min-w-0 flex-1 flex-col">
          <span
            class="text-collapsible-label text-compact group-data-[state=open]:text-collapsible-icon-open truncate font-medium"
            >{{ label }}</span
          >
          <span v-if="caption" class="text-collapsible-caption truncate text-xs">{{
            caption
          }}</span>
        </span>

        <OIcon
          name="chevron-right"
          size="sm"
          class="text-collapsible-icon group-data-[state=open]:text-collapsible-icon-open shrink-0 transition-transform duration-200"
          :class="isOpen ? 'rotate-90' : 'rotate-0'"
        />
      </template>

      <!-- default / sidebar variants -->
      <template v-else>
        <!-- Sidebar: left-side chevron (always before slot or label) -->
        <OIcon
          v-if="variant === 'sidebar'"
          name="chevron-right"
          size="md"
          class="text-collapsible-icon transition-transform duration-200"
          :class="isOpen ? 'rotate-90' : 'rotate-0'"
        />

        <!-- Custom trigger slot -->
        <template v-if="hasCustomTrigger">
          <slot name="trigger" :open="isOpen" />
        </template>

        <!-- Default trigger — icon / label / caption / chevron -->
        <template v-else>
          <OIcon
            v-if="icon && isOIcon"
            :name="icon as any"
            size="md"
            class="text-collapsible-icon shrink-0"
          />
          <span
            v-else-if="icon"
            class="material-icons-outlined text-icon-md text-collapsible-icon shrink-0"
            aria-hidden="true"
            >{{ icon }}</span
          >

          <span class="flex min-w-0 flex-1 flex-col">
            <span
              :class="[
                'text-collapsible-label truncate font-medium',
                variant === 'sidebar' ? 'text-compact' : 'text-sm',
              ]"
              >{{ label }}</span
            >
            <span v-if="caption" class="text-collapsible-caption truncate text-xs">{{
              caption
            }}</span>
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
      </template>
    </CollapsibleTrigger>

    <!-- Animated content. data-test lets e2e wait for the open/close height
         animation to finish before interacting with section content (a repeated
         component-level hook, like o-dialog-primary-btn). -->
    <CollapsibleContent
      class="o-collapsible-content overflow-hidden"
      data-test="o-collapsible-content"
    >
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
