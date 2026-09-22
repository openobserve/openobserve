// Copyright 2026 OpenObserve Inc.
//
// Rotates a reassuring "still working" message while something long-running
// with no incremental progress to report is in flight — a static message
// reads as stuck; a changing one reads as alive.

import { onScopeDispose, ref } from "vue";

const ROTATE_MS = 5000;

export default function useAnalyzingMessage(messages: string[]) {
  const current = ref("");
  let timer: ReturnType<typeof setInterval> | null = null;

  function pick() {
    current.value = messages[Math.floor(Math.random() * messages.length)];
  }

  function start() {
    stop();
    if (!messages.length) return;
    pick();
    timer = setInterval(pick, ROTATE_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  onScopeDispose(stop);

  return { current, start, stop };
}
