<script setup lang="ts">
import type {
  DropdownProps,
  DropdownEmits,
  DropdownSlots,
} from "./ODropdown.types";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
} from "reka-ui";
import { computed, provide, ref, watch } from "vue";
import { O_DROPDOWN_NESTED_KEY } from "./ODropdown.context";

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

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);

function handleOpenChange(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
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
    return () => {
      nestedOverlayCount.value = Math.max(0, nestedOverlayCount.value - 1);
      lastNestedCloseAt.value = Date.now();
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
  }
}

function handleFocusOutside(event: Event) {
  if (nestedOverlayCount.value > 0 || withinNestedCloseGrace()) {
    event.preventDefault();
  }
}
</script>

<template>
  <DropdownMenuRoot
    :open="internalOpen"
    :modal="modal"
    @update:open="handleOpenChange"
  >
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        @pointer-down-outside="handlePointerDownOutside"
        @focus-outside="handleFocusOutside"
        :class="[
          // Layout + stacking (must be above Quasar header/drawer: 2000/3000)
          'tw:min-w-40 tw:p-1 tw:z-[6000]',
          // Surface
          'tw:bg-dropdown-bg tw:border tw:border-dropdown-border tw:rounded-lg tw:shadow-md',
          // Typography
          'tw:text-sm tw:text-dropdown-item-text',
          // Animation — uses Reka data attributes
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:zoom-in-95',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95',
          'tw:data-[side=bottom]:slide-in-from-top-2 tw:data-[side=top]:slide-in-from-bottom-2',
        ]"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
