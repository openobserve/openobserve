<script setup lang="ts">
import type { OCollapsibleProps, OCollapsibleEmits, OCollapsibleSlots } from "./OCollapsible.types";
import { useCollapsibleGroup } from "./useCollapsibleGroup";
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui";
import { ref, computed, watch, useSlots } from "vue";
import OIcon from "../Icon/OIcon.vue";
import OTruncatedText from "../Typography/OTruncatedText.vue";

const props = withDefaults(defineProps<OCollapsibleProps>(), {
  defaultOpen: false,
  // An explicit undefined keeps Vue's absent-boolean coercion from reading as "closed".
  open: undefined as boolean | undefined,
});

const emit = defineEmits<OCollapsibleEmits>();
defineSlots<OCollapsibleSlots>();

const slots = useSlots();
const hasCustomTrigger = computed(() => !!slots.trigger);

const storageKey = props.persistKey ? `o2.collapsible.${props.persistKey}` : null;

function readPersisted(): boolean | null {
  if (!storageKey) return null;
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? null : stored === "1";
  } catch {
    return null;
  }
}

function writePersisted(value: boolean) {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, value ? "1" : "0");
  } catch {
    // Storage can be blocked (private mode); the section still works for this visit.
  }
}

const internalOpen = ref(readPersisted() ?? props.defaultOpen);

const group = props.group ? useCollapsibleGroup(props.group) : null;

const isOpen = computed<boolean>(() => {
  if (props.open !== undefined) return props.open;
  if (group) return group.isOpen.value;
  return internalOpen.value;
});

function handleOpenChange(value: boolean) {
  if (group) {
    if (value) group.open();
    else group.close();
  } else {
    internalOpen.value = value;
  }
  writePersisted(value);
  emit("update:open", value);

  if (value) {
    emit("open");
    // Reka animates with CSS, so "opened" fires on the next tick as an approximation.
    Promise.resolve().then(() => emit("opened"));
  } else {
    emit("close");
    Promise.resolve().then(() => emit("closed"));
  }
}

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);
</script>

<template>
  <CollapsibleRoot :open="isOpen" @update:open="handleOpenChange" v-bind="$attrs">
    <CollapsibleTrigger
      class="rounded-default hover:bg-collapsible-trigger-hover-bg active:bg-collapsible-trigger-active-bg focus-visible:ring-collapsible-trigger-focus-ring min-h-control-md flex w-full cursor-pointer items-center gap-1 ps-1 pe-2 text-start transition-colors duration-(--duration-control) ease-(--ease-control) outline-none select-none focus-visible:ring-2"
      data-test="o-collapsible-trigger"
    >
      <OIcon
        name="chevron-right"
        size="sm"
        class="text-collapsible-icon shrink-0 transition-transform duration-(--duration-indicator) ease-(--ease-control)"
        :class="isOpen ? 'rotate-90' : 'rotate-0'"
      />
      <span v-if="hasCustomTrigger" class="flex min-w-0 flex-1 items-center gap-2">
        <slot name="trigger" :open="isOpen" />
      </span>
      <template v-else>
        <OTruncatedText
          class="text-collapsible-label text-compact min-w-0 flex-1 font-medium"
          data-test="o-collapsible-title"
          >{{ title }}</OTruncatedText
        >
        <span
          v-if="summary"
          class="text-text-muted shrink-0 text-xs whitespace-nowrap"
          data-test="o-collapsible-summary"
          >{{ summary }}</span
        >
      </template>
    </CollapsibleTrigger>

    <!-- data-test lets e2e wait for the height animation before using the section. -->
    <CollapsibleContent
      class="o-collapsible-content overflow-hidden"
      data-test="o-collapsible-content"
    >
      <div class="ps-6">
        <slot />
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
/* keep(keyframes): reka's height animation reads --reka-collapsible-content-height;
   no utility expresses it, and the keyframes are only referenced from this block. */
.o-collapsible-content[data-state="open"] {
  animation: o-collapsible-open var(--duration-expand) var(--ease-control);
}

.o-collapsible-content[data-state="closed"] {
  animation: o-collapsible-close var(--duration-expand) var(--ease-overlay-out);
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
