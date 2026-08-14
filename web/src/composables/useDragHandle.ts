// Copyright 2026 OpenObserve Inc.
//
// Gates native drag so it starts only from a grip handle, not the row/chip body.
// Bind :draggable="isArmed(key)" on the element and @mousedown="arm(key)" on the
// grip. `key` is optional for single-source components.

import { onScopeDispose, ref } from "vue";

export default function useDragHandle() {
  const dragArmedKey = ref<string | null>(null);
  let cleanup: (() => void) | null = null;

  const disarm = () => {
    dragArmedKey.value = null;
    cleanup?.();
    cleanup = null;
  };

  const arm = (key = "*") => {
    dragArmedKey.value = key;
    // mouseup = click without drag; dragend = drag finished (may swallow mouseup)
    document.addEventListener("mouseup", disarm);
    document.addEventListener("dragend", disarm);
    cleanup = () => {
      document.removeEventListener("mouseup", disarm);
      document.removeEventListener("dragend", disarm);
    };
  };

  const isArmed = (key = "*") => dragArmedKey.value === key;

  onScopeDispose(disarm);

  return { dragArmedKey, arm, isArmed };
}
