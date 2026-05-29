import { ref, computed } from "vue";
import type { Ref } from "vue";

/**
 * Module-level registry of accordion groups.
 * Each group key maps to the currently active item's symbol ID (or null = all closed).
 */
const groupRegistry = new Map<string, Ref<symbol | null>>();

/**
 * Provides accordion (only-one-open) behavior for a group of OCollapsible items.
 * Items sharing the same `group` string coordinate through this composable.
 */
export function useCollapsibleGroup(group: string) {
  if (!groupRegistry.has(group)) {
    groupRegistry.set(group, ref(null));
  }

  const activeId = groupRegistry.get(group)!;

  /** Unique identity for this instance */
  const id: symbol = Symbol();

  const isOpen = computed(() => activeId.value === id);

  function open() {
    activeId.value = id;
  }

  function close() {
    if (activeId.value === id) {
      activeId.value = null;
    }
  }

  function toggle() {
    if (isOpen.value) {
      close();
    } else {
      open();
    }
  }

  return { isOpen, open, close, toggle };
}
