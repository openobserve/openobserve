<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  OPopover — the non-menu popup primitive (sibling to ODropdown, which is a
  MENU). Wraps reka-ui's Popover: arbitrary content, normal Tab order, arrow
  keys free for the content (no menu semantics). Use for pickers, filter forms,
  info cards — anything that isn't a list of action items.

  Shares ODropdown's overlay coordination so descendant overlays (OSelect /
  OCombobox / nested dropdowns) opening INSIDE the popover never dismiss it.

  Props: open (v-model) | side | align | sideOffset | hideWhenDetached | modal | ariaLabel | contentClass | collisionPadding | autoFocus | privacy
  Slots: trigger | anchor (positions without a trigger) | default
  Emits: update:open | open-auto-focus
-->
<script lang="ts">
import type { I18nText } from "@/types/i18n";
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
import { PopoverAnchor, PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from "reka-ui";
import { inject, onBeforeUnmount, provide, ref, watch, type Ref } from "vue";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  O_DROPDOWN_NESTED_KEY,
  type DropdownNestedRegistry,
  setActiveOverlay,
  clearActiveOverlay,
} from "@/lib/overlay/Dropdown/ODropdown.context";

const { lgUp } = useBreakpoint();

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
    ariaLabel?: I18nText;
    /** Content stacking order. Default sits above the app header/drawer (2000/3000). */
    zIndex?: number;
    /** Extra classes merged onto the content surface. */
    contentClass?: string;
    /** Overrides the default (0 desktop / 8 tablet-down) collision inset, e.g. to clear a fixed header on a flipped side. */
    collisionPadding?: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    /** `false` keeps focus where it is on open and close: a listbox driven from a textbox. */
    autoFocus?: boolean;
    /** Session replay masks the portalled content, which sits outside any masked ancestor. */
    privacy?: "mask";
  }>(),
  {
    modal: false,
    side: "bottom",
    align: "start",
    sideOffset: 4,
    hideWhenDetached: true,
    zIndex: 6000,
    autoFocus: true,
  },
);

const emit = defineEmits<{
  "update:open": [boolean];
  /** Forwards reka's initial-focus event so a consumer can redirect it (call `preventDefault()` to opt out of the default first-tabbable focus). */
  "open-auto-focus": [Event];
}>();

const slots = defineSlots<{
  trigger?: () => unknown;
  anchor?: () => unknown;
  default?: () => unknown;
}>();

const FOCUSABLE =
  "button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex='-1'])";

const anchorRef = ref<{ $el?: Element } | null>(null);
let closedFromOutside = false;
let invoker: HTMLElement | null = null;

// An anchor can hold several controls; the one the user last pressed or focused is the one focus returns to.
function rememberInvoker(event: Event) {
  const el = event.target instanceof Element ? event.target.closest<HTMLElement>(FOCUSABLE) : null;
  if (el) invoker = el;
}

watch(
  () => anchorRef.value?.$el,
  (el, _was, onCleanup) => {
    if (!(el instanceof HTMLElement)) return;
    el.addEventListener("focusin", rememberInvoker);
    el.addEventListener("pointerdown", rememberInvoker, true);
    onCleanup(() => {
      el.removeEventListener("focusin", rememberInvoker);
      el.removeEventListener("pointerdown", rememberInvoker, true);
    });
  },
  { flush: "post" },
);

function onOpenAutoFocus(event: Event) {
  closedFromOutside = false;
  emit("open-auto-focus", event);
  if (!props.autoFocus) event.preventDefault();
}

// Reka returns focus only to a trigger, so an anchored popover hands it back to its anchor unless the user clicked away.
function onCloseAutoFocus(event: Event) {
  if (!props.autoFocus) return event.preventDefault();
  const anchor = anchorRef.value?.$el;
  if (!slots.anchor || !(anchor instanceof HTMLElement) || closedFromOutside) return;
  event.preventDefault();
  // The exit animation delays this past the caller's own focus move (Tab out, the open chord); never undo it.
  const active = document.activeElement;
  const content = event.target;
  if (
    active &&
    active !== document.body &&
    !(content instanceof Element && content.contains(active))
  )
    return;
  const pressed = invoker?.isConnected && anchor.contains(invoker) ? invoker : null;
  const target =
    pressed ?? (anchor.matches(FOCUSABLE) ? anchor : anchor.querySelector<HTMLElement>(FOCUSABLE));
  target?.focus();
}

// An IME candidate list owns its Escape: cancelling it never closes the popover.
function onEscapeKeyDown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) event.preventDefault();
}

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
    return;
  }
  closedFromOutside = true;
}
function handleFocusOutside(event: Event) {
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
    return;
  }
  closedFromOutside = true;
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
    <PopoverAnchor v-if="slots.anchor" ref="anchorRef" as-child>
      <slot name="anchor" />
    </PopoverAnchor>
    <PopoverTrigger v-if="slots.trigger" ref="triggerRef" as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-o-popover-content
        :data-dd-privacy="privacy"
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :hide-when-detached="hideWhenDetached"
        :collision-padding="collisionPadding ?? (lgUp ? 0 : 8)"
        :aria-label="ariaLabel"
        :style="{ zIndex }"
        @pointer-down-outside="handlePointerDownOutside"
        @focus-outside="handleFocusOutside"
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
        @escape-key-down="onEscapeKeyDown"
        :class="[
          'outline-none max-lg:max-w-[calc(100vw-1rem)]',
          'max-lg:max-h-[var(--reka-popper-available-height,75vh)] max-lg:overflow-y-auto',
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
