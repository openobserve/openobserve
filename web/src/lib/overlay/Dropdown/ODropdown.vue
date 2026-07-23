<script lang="ts">
// Module-level flag: true when the last document interaction was pointer-based.
// Shared across all ODropdown instances (only one is open at a time).
let lastWasPointer = false;
// Guard prevents duplicate listeners on HMR re-execution of this module block.
const _oDdKey = "__oDropdownListenersRegistered__";
if (typeof document !== "undefined" && !(globalThis as any)[_oDdKey]) {
  (globalThis as any)[_oDdKey] = true;
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
import type { DropdownProps, DropdownEmits, DropdownSlots } from "./ODropdown.types";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
} from "reka-ui";
import { computed, inject, onBeforeUnmount, provide, ref, watch, type Ref } from "vue";
import {
  O_DROPDOWN_NESTED_KEY,
  type DropdownNestedRegistry,
  setActiveOverlay,
  clearActiveOverlay,
} from "./ODropdown.context";

const props = withDefaults(defineProps<DropdownProps>(), {
  modal: false,
  side: "bottom",
  align: "start",
  sideOffset: 4,
  persistent: false,
});

const emit = defineEmits<DropdownEmits>();

defineSlots<DropdownSlots>();

// Vue boolean-casts absent `open` prop to `false`, which would lock
// DropdownMenuRoot into controlled-closed mode. We manage state ourselves
// so reka-ui stays responsive in both uncontrolled and controlled usage.
const internalOpen = ref(props.open ?? false);

// Ref to the DropdownMenuTrigger; its `$el` is the rendered trigger element.
// Used by the close-on-scroll handler to tell whether a scroll moves this
// dropdown's trigger (vs. an unrelated section).
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
  // Reka-ui programmatically focuses the trigger after closing, which browsers
  // treat as keyboard-like and show :focus-visible — turning the icons purple.
  // Mark the trigger with a data attribute so CSS can suppress the ring without
  // blurring the element (blur is async via rAF and breaks E2E focus timing).
  // Keyboard closes keep lastWasPointer=false so the ring stays for a11y.
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

// Register with the nearest ancestor ODropdown while this dropdown is open
// so the ancestor's pointer-down-outside handler ignores clicks from our portal.
const parentDropdownRegistry = inject<DropdownNestedRegistry | null>(O_DROPDOWN_NESTED_KEY, null);
let closeNestedRegistration: ((skipGrace?: boolean) => void) | null = null;
// Set to true in handlePointerDownOutside when this dropdown is about to close
// from a real outside click so the parent skips the grace period and also closes.
let closingFromOutside = false;

// flush:'sync' is required so the parent's nestedOverlayCount increments
// before reka-ui auto-focuses the new portal content (which would otherwise
// fire focus-outside on the parent and close it).
watch(
  internalOpen,
  (open) => {
    if (!parentDropdownRegistry) return;
    if (open && !closeNestedRegistration) {
      closeNestedRegistration = parentDropdownRegistry.open();
    } else if (!open && closeNestedRegistration) {
      const skipGrace = closingFromOutside;
      closingFromOutside = false;
      closeNestedRegistration(skipGrace);
      closeNestedRegistration = null;
    }
  },
  { flush: "sync" },
);

onBeforeUnmount(() => {
  if (closeNestedRegistration) {
    closeNestedRegistration();
    closeNestedRegistration = null;
  }
});

// Single-active-overlay coordination. Only top-level dropdowns participate —
// a dropdown nested inside another open ODropdown must not close its ancestor.
// Stable identity so set/clearActiveOverlay match across calls.
const closeSelf = () => handleOpenChange(false);
if (!parentDropdownRegistry) {
  watch(internalOpen, (open) => {
    if (open) setActiveOverlay(closeSelf);
    else clearActiveOverlay(closeSelf);
  });
  onBeforeUnmount(() => clearActiveOverlay(closeSelf));
}

// ═══════════════════════════════════════════════════════════════════════════
// Nested-overlay coordination
// ═══════════════════════════════════════════════════════════════════════════
// Descendant overlays (OSelect / OCombobox / nested ODropdown / etc.) call
// `open()` from the injected registry when they open and the returned
// `close` when they close. While at least one descendant is open — or one
// just closed within the same pointer-event tick — outside-clicks on us
// originate from the descendant's portal, not from a real "outside" click,
// so we silently swallow them.
const nestedOverlayCount = ref(0);
const lastNestedCloseAt = ref(0);
const NESTED_CLOSE_GRACE_MS = 50;

provide(O_DROPDOWN_NESTED_KEY, {
  open: () => {
    nestedOverlayCount.value++;
    return (skipGrace?: boolean) => {
      nestedOverlayCount.value = Math.max(0, nestedOverlayCount.value - 1);
      // Skip grace when the child closed because of a real outside click —
      // the parent should honour that same click and close too.
      if (!skipGrace) lastNestedCloseAt.value = Date.now();
    };
  },
});

function withinNestedCloseGrace(): boolean {
  return Date.now() - lastNestedCloseAt.value < NESTED_CLOSE_GRACE_MS;
}

// ═══════════════════════════════════════════════════════════════════════════
// `persistent` prop — controls how many real outside-clicks must happen
// before the dropdown actually dismisses. See ODropdown.types.ts for spec.
// ═══════════════════════════════════════════════════════════════════════════
const persistenceBudget = computed<number>(() => {
  if (props.persistent === false) return 0;
  if (props.persistent === true) return Number.POSITIVE_INFINITY;
  // Numeric value: clamp at >= 1 so any positive number means "needs at
  // least one swallow".
  const n = Number(props.persistent);
  return Number.isFinite(n) && n > 0 ? n : 0;
});

// Counts how many outside-clicks the dropdown has already swallowed in
// the current open-session. Reset each time we open.
const swallowedOutsideClicks = ref(0);

watch(internalOpen, (open) => {
  if (open) swallowedOutsideClicks.value = 0;
});

function shouldSwallowRealOutsideClick(): boolean {
  if (persistenceBudget.value === 0) return false;
  if (persistenceBudget.value === Number.POSITIVE_INFINITY) return true;
  if (swallowedOutsideClicks.value < persistenceBudget.value) {
    swallowedOutsideClicks.value++;
    return true;
  }
  return false;
}

function handlePointerDownOutside(event: Event) {
  // Click came from a still-open descendant overlay, OR a descendant just
  // closed in the same pointer-event tick → never our problem.
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
    return;
  }
  // Real outside click. Honour `persistent` (false / true / number).
  if (shouldSwallowRealOutsideClick()) {
    event.preventDefault();
    return;
  }
  // This dropdown is closing from a real outside click. Signal to the parent
  // (if any) to skip the grace period so it also closes on this same click.
  closingFromOutside = true;
}

function handleFocusOutside(event: Event) {
  // When nested inside a parent ODropdown, reka-ui focuses parent items on
  // pointermove (hover), stealing focus from this portal. Suppress focus-outside
  // so the inner dropdown only closes via click-outside or Escape.
  if (parentDropdownRegistry) {
    event.preventDefault();
    return;
  }
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
  }
}

// Close this dropdown when the nearest sidebar scroll container scrolls,
// preventing the portal from floating disconnected at the top of the screen.
const sidebarScrollTick = inject<Ref<number> | null>("sidebarScrollTick", null);
if (sidebarScrollTick) {
  watch(sidebarScrollTick, () => {
    if (internalOpen.value) handleOpenChange(false);
  });
}

// Generic close-on-scroll: while open, any scroll on an ancestor scroll
// container (the page, the query-builder area, a joins popup, etc.) would
// otherwise leave the portaled menu floating detached from its trigger. We
// close instead. Scrolls that originate *inside* an open menu (a long,
// scrollable menu list) are ignored so the menu itself stays scrollable.
function handleViewportScroll(event: Event) {
  if (!internalOpen.value) return;
  const target = event.target as (Element & Node) | Document | null;
  if (!target) return;
  // Ignore scrolls inside an open menu so long menu lists stay scrollable.
  if (target instanceof Element && target.closest?.('[role="menu"]')) return;
  // Only close when the scrolled container actually holds this dropdown's
  // trigger — scrolling an unrelated section must not dismiss the menu.
  const triggerEl = triggerRef.value?.$el as Node | undefined;
  if (triggerEl && target.contains(triggerEl)) {
    handleOpenChange(false);
  }
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
  <DropdownMenuRoot :open="internalOpen" :modal="modal" @update:open="handleOpenChange">
    <DropdownMenuTrigger ref="triggerRef" as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :hide-when-detached="true"
        @pointer-down-outside="handlePointerDownOutside"
        @focus-outside="handleFocusOutside"
        :class="[
          // Layout + stacking — z-menu is the shared overlay layer (tokens/base.css)
          'z-menu min-w-40 p-1',
          // Surface
          'bg-dropdown-bg border-dropdown-border rounded-default border shadow-md',
          // Typography
          'text-dropdown-item-text text-sm',
          // Animation — clip-path reveal: the menu is unveiled at full size from
          // its trigger edge (no scale/squish). Wipes down by default; top-placed
          // menus wipe up. Soft ease-out-expo in (200ms), quick wipe out (140ms).
          'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
          'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
          props.contentClass,
        ]"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
