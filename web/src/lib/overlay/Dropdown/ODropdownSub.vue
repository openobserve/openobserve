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
import OText from "../../core/Typography/OText.vue";
import { movingIntoSubmenu } from "./submenuSafeArea";

defineOptions({ inheritAttrs: false });
const props = defineProps<DropdownSubProps>();
const emit = defineEmits<DropdownSubEmits>();
defineSlots<DropdownSubSlots>();

const attrs = useAttrs();
const id = useId();
const descriptionDomId = computed(
  () => props.descriptionId ?? `${attrs["data-test"] ?? id}-reason`,
);

const internalOpen = ref(props.open ?? false);
const trigger = ref<{ $el: HTMLElement } | null>(null);
const content = ref<{ $el: HTMLElement } | null>(null);
let safeApex: { x: number; y: number } | null = null;
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
    safeApex = null;
    if (typeof document === "undefined") return;
    if (open) document.addEventListener("pointermove", onSafeAreaPointerMove, true);
    else document.removeEventListener("pointermove", onSafeAreaPointerMove, true);
  },
  { flush: "sync", immediate: true },
);
onBeforeUnmount(() => {
  closeNestedOverlay();
  document.removeEventListener("pointermove", onSafeAreaPointerMove, true);
});

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

// Reka unwraps the open submenu's trigger ref, so re-highlighting its own trigger reads as another item and closes it.
function onTriggerPointerMove(event: PointerEvent) {
  if (!internalOpen.value || event.pointerType !== "mouse") return;
  event.preventDefault();
  const el = trigger.value?.$el;
  if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
}

function onTriggerPointerLeave(event: PointerEvent) {
  if (internalOpen.value && event.pointerType === "mouse")
    safeApex = { x: event.clientX, y: event.clientY };
}

// Reka's own safe area expires after 300 ms, so a slow diagonal over a sibling item (a flipped submenu in a narrow panel) closed it.
function onSafeAreaPointerMove(event: PointerEvent) {
  const panel = (content.value?.$el as HTMLElement | undefined)?.querySelector?.("[role=menu]");
  const target = event.target instanceof Node ? event.target : null;
  if (!safeApex || event.pointerType !== "mouse" || !panel?.getBoundingClientRect) return;
  if (target && (panel.contains(target) || trigger.value?.$el.contains(target))) return;
  const point = { x: event.clientX, y: event.clientY };
  if (!movingIntoSubmenu(safeApex, point, panel.getBoundingClientRect())) {
    safeApex = null;
    return;
  }
  event.preventDefault();
  safeApex = point;
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
      :text-value="textValue"
      :aria-describedby="description ? descriptionDomId : undefined"
      @pointermove.capture="onTriggerPointerMove"
      @pointerleave="onTriggerPointerLeave"
      class="group/sub rounded-default text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg relative flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-start transition-colors duration-(--duration-hover-out) outline-none select-none data-[highlighted]:duration-(--duration-hover-in)"
    >
      <slot name="icon-left" />
      <span v-if="description" class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span><slot name="trigger" /></span>
        <OText
          :id="descriptionDomId"
          :data-test="descriptionDomId"
          as="span"
          variant="meta"
          class="text-text-secondary! group-data-[highlighted]/sub:text-text-heading! leading-snug! whitespace-normal"
          >{{ description }}</OText
        >
      </span>
      <slot v-else name="trigger" />
      <slot name="icon-right" />
    </DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        ref="content"
        :side-offset="4"
        :collision-padding="8"
        :hide-when-detached="true"
        :style="{ zIndex: contentZIndex }"
        class="bg-dropdown-bg rounded-default text-dropdown-item-text shadow-overlay max-h-[var(--reka-popper-available-height,75vh)] max-w-[calc(100vw-1rem)] min-w-40 overflow-y-auto border border-transparent p-1 text-sm"
        @keydown.capture="onKeydown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
