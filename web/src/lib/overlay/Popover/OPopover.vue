<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  OPopover — the non-menu popup primitive (sibling to ODropdown, which is a
  MENU). Wraps reka-ui's Popover: arbitrary content, normal Tab order, arrow
  keys free for the content (no menu semantics). Use for pickers, filter forms,
  info cards — anything that isn't a list of action items.

  Shares ODropdown's overlay coordination so descendant overlays (OSelect /
  OCombobox / nested dropdowns) opening INSIDE the popover never dismiss it.

  Props: open (v-model) | side | align | sideOffset | hideWhenDetached | modal | ariaLabel | contentClass
  Slots: trigger | default
-->
<script lang="ts">
// True when the last document interaction was pointer-based (shared across
// instances). Lets a mouse-close avoid leaving a :focus-visible ring on the
// trigger, while keyboard closes keep it for a11y.
let lastWasPointer = false;
const _oPopKey = "__oPopoverListenersRegistered__";
if (typeof document !== "undefined" && !(globalThis as any)[_oPopKey]) {
  (globalThis as any)[_oPopKey] = true;
  document.addEventListener(
    "pointerdown",
    () => {
      lastWasPointer = true;
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      lastWasPointer = false;
    },
    true,
  );
}
</script>

<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from "reka-ui";
import { inject, onBeforeUnmount, provide, ref, watch, type Ref } from "vue";
import {
  O_DROPDOWN_NESTED_KEY,
  type DropdownNestedRegistry,
  setActiveOverlay,
  clearActiveOverlay,
} from "@/lib/overlay/Dropdown/ODropdown.context";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    /** Trap focus + block outside pointer events. Popovers are non-modal by default. */
    modal?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    sideOffset?: number;
    /** Hide the content when the trigger scrolls out of view (Floating UI). */
    hideWhenDetached?: boolean;
    ariaLabel?: string;
    /** Content stacking order. Default sits above the app header/drawer (2000/3000). */
    zIndex?: number;
    /** Extra classes merged onto the content surface. */
    contentClass?: string;
  }>(),
  {
    modal: false,
    side: "bottom",
    align: "start",
    sideOffset: 4,
    hideWhenDetached: true,
    zIndex: 6000,
  },
);

const emit = defineEmits<{ "update:open": [boolean] }>();

// Vue boolean-casts an absent `open` prop to `false`, which would lock
// PopoverRoot into controlled-closed mode. Manage state ourselves so it stays
// responsive in both controlled and uncontrolled usage.
const internalOpen = ref(props.open ?? false);
const triggerRef = ref<{ $el?: Node } | null>(null);

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);

function handleOpenChange(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
  // reka refocuses the trigger after closing; browsers treat that as
  // keyboard-like and show :focus-visible. Suppress the ring for pointer closes.
  if (!v && lastWasPointer) {
    const el = document.activeElement;
    if (el instanceof HTMLElement) {
      el.dataset.noFocusVisible = "true";
      el.addEventListener(
        "blur",
        () => {
          delete el.dataset.noFocusVisible;
        },
        { once: true },
      );
    }
  }
}

// ── Nested-overlay coordination (shared with ODropdown) ─────────────────────
// Register with an ancestor overlay so it ignores our portal's pointer events.
const parentRegistry = inject<DropdownNestedRegistry | null>(O_DROPDOWN_NESTED_KEY, null);
let closeNestedRegistration: (() => void) | null = null;
watch(internalOpen, (open) => {
  if (!parentRegistry) return;
  if (open && !closeNestedRegistration) {
    closeNestedRegistration = parentRegistry.open();
  } else if (!open && closeNestedRegistration) {
    closeNestedRegistration();
    closeNestedRegistration = null;
  }
});

// Provide a registry to descendant overlays (OSelect / OCombobox / nested
// dropdowns) so opening one inside us doesn't dismiss us.
const nestedOverlayCount = ref(0);
const lastNestedCloseAt = ref(0);
const NESTED_CLOSE_GRACE_MS = 50;
provide(O_DROPDOWN_NESTED_KEY, {
  open: () => {
    nestedOverlayCount.value++;
    return () => {
      nestedOverlayCount.value = Math.max(0, nestedOverlayCount.value - 1);
      lastNestedCloseAt.value = Date.now();
    };
  },
} as DropdownNestedRegistry);
function withinNestedCloseGrace(): boolean {
  return Date.now() - lastNestedCloseAt.value < NESTED_CLOSE_GRACE_MS;
}

// Single-active-overlay: only one top-level O overlay open at a time. Nested
// popovers opt out so they never close their ancestor.
const closeSelf = () => handleOpenChange(false);
if (!parentRegistry) {
  watch(internalOpen, (open) => {
    if (open) setActiveOverlay(closeSelf);
    else clearActiveOverlay(closeSelf);
  });
  onBeforeUnmount(() => clearActiveOverlay(closeSelf));
}

onBeforeUnmount(() => {
  if (closeNestedRegistration) {
    closeNestedRegistration();
    closeNestedRegistration = null;
  }
});

// Swallow the outside-pointer/focus events a descendant overlay's portal fires
// while it (or a just-closed one) is open, so we don't dismiss with it.
function handlePointerDownOutside(event: Event) {
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
  }
}
function handleFocusOutside(event: Event) {
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
  }
}

// Close on ancestor scroll so the portal never floats detached from its trigger.
const sidebarScrollTick = inject<Ref<number> | null>("sidebarScrollTick", null);
if (sidebarScrollTick) {
  watch(sidebarScrollTick, () => {
    if (internalOpen.value) handleOpenChange(false);
  });
}
function handleViewportScroll(event: Event) {
  if (!internalOpen.value) return;
  const target = event.target as (Element & Node) | Document | null;
  if (!target) return;
  // Ignore scrolls inside our own or a nested overlay's content.
  if (
    target instanceof Element &&
    target.closest?.("[data-o-popover-content], [role='menu'], [role='listbox']")
  )
    return;
  const triggerEl = triggerRef.value?.$el as Node | undefined;
  if (triggerEl && target.contains(triggerEl)) handleOpenChange(false);
}
watch(internalOpen, (open) => {
  if (typeof window === "undefined") return;
  if (open) {
    window.addEventListener("scroll", handleViewportScroll, {
      capture: true,
      passive: true,
    });
  } else {
    window.removeEventListener("scroll", handleViewportScroll, true);
  }
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("scroll", handleViewportScroll, true);
  }
});
</script>

<template>
  <PopoverRoot :open="internalOpen" :modal="modal" @update:open="handleOpenChange">
    <PopoverTrigger ref="triggerRef" as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-o-popover-content
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :hide-when-detached="hideWhenDetached"
        :aria-label="ariaLabel"
        :style="{ zIndex }"
        @pointer-down-outside="handlePointerDownOutside"
        @focus-outside="handleFocusOutside"
        :class="[
          'outline-none',
          // Surface
          'bg-dropdown-bg border-dropdown-border rounded-default border shadow-md',
          // Open/close reveal animation (matches ODropdown)
          'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
          'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
          contentClass,
        ]"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
