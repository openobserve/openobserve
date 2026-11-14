<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useAttrs, useId, watch } from "vue";
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "reka-ui";
import type { DropdownSubProps, DropdownSubEmits, DropdownSubSlots } from "./ODropdownSub.types";
import { O_DROPDOWN_NESTED_KEY, type DropdownNestedRegistry } from "./ODropdown.context";
import OIcon from "../../core/Icon/OIcon.vue";
import OMenuItemContent from "@/lib/overlay/shared/OMenuItemContent.vue";
import { MENU_SURFACE, menuItemClasses } from "@/lib/overlay/shared/menuItem";

defineOptions({ inheritAttrs: false });
const props = defineProps<DropdownSubProps>();
const emit = defineEmits<DropdownSubEmits>();
defineSlots<DropdownSubSlots>();

const attrs = useAttrs();
const id = useId();
const descriptionDomId = computed(() => `${attrs["data-test"] ?? id}-reason`);

const internalOpen = ref(props.open ?? false);
const trigger = ref<{ $el: HTMLElement } | null>(null);
const drawerDepth = inject<number>("o2DrawerDepth", 0);
const dialogDepth = inject<number>("o2DialogDepth", 0);
const contentZIndex = computed(() => 6000 + Math.max(drawerDepth, dialogDepth) * 1000);
const parentRegistry = inject<DropdownNestedRegistry | null>(O_DROPDOWN_NESTED_KEY, null);
let closeRegistration: ((skipGrace?: boolean) => void) | null = null;

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
      :text-value="label"
      :aria-describedby="description ? descriptionDomId : undefined"
      :class="[menuItemClasses('default', false, !!description), 'text-start']"
    >
      <OMenuItemContent :icon="icon" :note="description" :note-id="descriptionDomId">
        {{ label }}
        <template #end>
          <slot name="end" />
          <OIcon name="chevron-right" size="sm" class="text-text-muted ms-auto shrink-0" />
        </template>
      </OMenuItemContent>
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        :style="{ zIndex: contentZIndex }"
        :class="[
          MENU_SURFACE,
          'max-h-[var(--reka-popper-available-height,75vh)] max-w-[calc(100vw-1rem)] overflow-y-auto',
        ]"
        @keydown.capture="onKeydown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
