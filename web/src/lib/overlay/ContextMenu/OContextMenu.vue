<script setup lang="ts">
import type {
  ContextMenuProps,
  ContextMenuEmits,
  ContextMenuSlots,
} from "./OContextMenu.types";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
} from "reka-ui";
import { onBeforeUnmount, ref, watch } from "vue";
import {
  setActiveOverlay,
  clearActiveOverlay,
} from "../Dropdown/ODropdown.context";

const props = withDefaults(defineProps<ContextMenuProps>(), {
  disabled: false,
  modal: false,
});

const emit = defineEmits<ContextMenuEmits>();

defineSlots<ContextMenuSlots>();

// ContextMenuRoot owns `open` internally (it must, since the pointer position
// is captured by the trigger at right-click time and there is no way to supply
// it from outside). We mirror the state so we can participate in the shared
// single-active-overlay coordination and close on scroll.
const isOpen = ref(false);

function handleOpenChange(open: boolean) {
  isOpen.value = open;
  emit("update:open", open);
}

// ContextMenuRoot owns `open` with no imperative close and no `open` prop, so
// the only way to dismiss it from outside is the path reka-ui already listens
// on: an Escape keystroke on `window` (DismissableLayer binds it there).
function closeSelf() {
  if (!isOpen.value || typeof window === "undefined") return;
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

// Opening a context menu must dismiss any dropdown/select left open, and vice
// versa — otherwise two unrelated overlays float at once.
watch(isOpen, (open) => {
  if (open) setActiveOverlay(closeSelf);
  else clearActiveOverlay(closeSelf);
});

onBeforeUnmount(() => clearActiveOverlay(closeSelf));

// The menu is anchored to a fixed pointer coordinate, so any scroll leaves it
// stranded away from the content it describes. Close instead. Scrolls that
// originate inside the menu itself (a long, scrollable menu) are ignored.
function handleViewportScroll(event: Event) {
  if (!isOpen.value) return;
  const target = event.target;
  if (target instanceof Element && target.closest?.('[role="menu"]')) return;
  closeSelf();
}

watch(isOpen, (open) => {
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
  <ContextMenuRoot :modal="modal" @update:open="handleOpenChange">
    <ContextMenuTrigger :disabled="disabled" as-child>
      <slot name="trigger" />
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        :hide-when-detached="true"
        :collision-padding="8"
        :class="[
          // Layout + stacking — z-menu is the shared overlay layer (tokens/base.css)
          'min-w-40 p-1 z-menu',
          // Surface — a context menu is visually the same object as a dropdown
          // menu, so it deliberately shares the dropdown token set rather than
          // duplicating one that would have to be kept in sync.
          'bg-dropdown-bg border border-dropdown-border rounded-default shadow-md',
          // Typography
          'text-sm text-dropdown-item-text',
          // Animation — same clip-path reveal as ODropdown, wiping away from
          // the pointer. Soft ease-out-expo in, quick wipe out.
          'data-[state=open]:animate-[o2-reveal-down-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:animate-[o2-reveal-down-out_100ms_cubic-bezier(0.4,0,1,1)]',
          'data-[side=top]:data-[state=open]:animate-[o2-reveal-up-in_140ms_cubic-bezier(0.16,1,0.3,1)]',
          'data-[side=top]:data-[state=closed]:animate-[o2-reveal-up-out_100ms_cubic-bezier(0.4,0,1,1)]',
          props.contentClass,
        ]"
      >
        <slot />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
