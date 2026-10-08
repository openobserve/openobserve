<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "reka-ui";
import type { DropdownSubProps, DropdownSubEmits, DropdownSubSlots } from "./ODropdownSub.types";
import { O_DROPDOWN_NESTED_KEY, type DropdownNestedRegistry } from "./ODropdown.context";

defineOptions({ inheritAttrs: false });
const props = defineProps<DropdownSubProps>();
const emit = defineEmits<DropdownSubEmits>();
defineSlots<DropdownSubSlots>();

const internalOpen = ref(props.open ?? false);
const trigger = ref<{ $el: HTMLElement } | null>(null);
const drawerDepth = inject<number>("o2DrawerDepth", 0);
const dialogDepth = inject<number>("o2DialogDepth", 0);
const contentZIndex = computed(() => 6000 + Math.max(drawerDepth, dialogDepth) * 1000);
const parentRegistry = inject<DropdownNestedRegistry | null>(O_DROPDOWN_NESTED_KEY, null);
let closeRegistration: ((skipGrace?: boolean) => void) | null = null;

// The parent must ignore focus moving into the submenu's portal.
watch(
  internalOpen,
  (open) => {
    if (open && parentRegistry && !closeRegistration) closeRegistration = parentRegistry.open();
    if (!open) closeNestedOverlay();
  },
  { flush: "sync", immediate: true },
);
onBeforeUnmount(() => closeNestedOverlay());

watch(
  () => props.open,
  (open) => {
    if (open !== undefined) internalOpen.value = open;
  },
);

function onOpenChange(open: boolean) {
  internalOpen.value = open;
  emit("update:open", open);
}

function closeNestedOverlay(skipGrace = false) {
  closeRegistration?.(skipGrace);
  closeRegistration = null;
}

function onPointerDownOutside(event: Event) {
  if (
    event.defaultPrevented ||
    (event.target instanceof Node && trigger.value?.$el.contains(event.target))
  )
    return;
  closeNestedOverlay(true);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  // Reka's default Escape closes the root; keep the parent actions reachable.
  event.preventDefault();
  event.stopPropagation();
  onOpenChange(false);
  trigger.value?.$el.focus();
}
</script>

<template>
  <DropdownMenuSub :open="internalOpen" @update:open="onOpenChange">
    <DropdownMenuSubTrigger
      ref="trigger"
      v-bind="$attrs"
      as="button"
      type="button"
      :text-value="textValue"
      class="rounded-default text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg relative flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors duration-150 outline-none select-none"
    >
      <slot name="icon-left" />
      <slot name="trigger" />
      <slot name="icon-right" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        :style="{ zIndex: contentZIndex }"
        class="bg-dropdown-bg border-dropdown-border rounded-default text-dropdown-item-text max-h-[var(--reka-popper-available-height,75vh)] max-w-[calc(100vw-1rem)] min-w-40 overflow-y-auto border p-1 text-sm shadow-md"
        @keydown.capture="onKeydown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
