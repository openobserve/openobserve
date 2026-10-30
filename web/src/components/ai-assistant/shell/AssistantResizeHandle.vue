<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    ref="handle"
    role="separator"
    aria-orientation="vertical"
    :aria-label="t('assistant.shell.resizeHandle')"
    :aria-valuemin="minRem"
    :aria-valuemax="rounded(maxRem)"
    :aria-valuenow="rounded(widthRem)"
    :aria-valuetext="t('assistant.shell.resizeHandleValue', { width: rounded(widthRem) })"
    tabindex="0"
    data-test="assistant-shell-resize-handle"
    :data-dragging="dragging ? '' : undefined"
    :class="[HANDLE_BASE, HANDLE_EDGE[edge]]"
  >
    <span
      aria-hidden="true"
      class="group-hover:bg-border-strong group-focus-visible:bg-focus-ring-accent group-data-[dragging]:bg-border-strong mx-auto block h-full w-0.5 bg-transparent group-focus-visible:w-1 motion-safe:transition-colors"
    />
  </div>
</template>

<script lang="ts">
export interface AssistantResizeHandleProps {
  widthRem: number;
  minRem: number;
  maxRem: number;
  /** `inside` where the panel clips its own edge (the floating card). */
  edge?: "straddle" | "inside";
}

export interface AssistantResizeHandleEmits {
  /** Live while dragging; nothing is stored until `commit`. */
  (e: "resize", rem: number): void;
  /** A drag released or a key step: the width to store. */
  (e: "commit", rem: number): void;
  (e: "reset"): void;
}

// A touch gets a wider target than the visible strip, but never wider than the panel's own side gutter.
const HANDLE_BASE =
  "group absolute inset-y-0 start-0 z-1 cursor-col-resize touch-none outline-none select-none pointer-coarse:before:absolute pointer-coarse:before:inset-y-0 pointer-coarse:before:content-['']";

// The floating card clips whatever lies outside it, so its target stays within the card's gutter.
const HANDLE_EDGE = {
  straddle:
    "w-3 -translate-x-1/2 rtl:translate-x-1/2 pointer-coarse:before:-start-4 pointer-coarse:before:w-11",
  inside: "w-2 pointer-coarse:before:start-0 pointer-coarse:before:w-3",
} as const;

/** One arrow press moves the edge by this much. */
export const RESIZE_STEP_REM = 1;

/** The panel's width for a pointer at `clientX`; the panel grows as its inner edge moves towards the page. */
export function dragWidth(
  start: { clientX: number; widthRem: number },
  clientX: number,
  rtl: boolean,
  bounds: { minRem: number; maxRem: number },
): number {
  const delta = (start.clientX - clientX) / 16;
  return clampRem(start.widthRem + (rtl ? -delta : delta), bounds);
}

export function clampRem(rem: number, bounds: { minRem: number; maxRem: number }): number {
  return Math.min(Math.max(rem, bounds.minRem), Math.max(bounds.minRem, bounds.maxRem));
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<AssistantResizeHandleProps>(), { edge: "straddle" });
const emit = defineEmits<AssistantResizeHandleEmits>();

const { t } = useI18nTyped();
const dragging = ref(false);
const handle = ref<HTMLElement | null>(null);
let start: { clientX: number; widthRem: number; pointerId: number } | null = null;
let live = props.widthRem;

const listeners: [string, (event: never) => void][] = [
  ["pointerdown", onPointerDown],
  ["pointermove", onPointerMove],
  ["pointerup", onPointerUp],
  ["pointercancel", onPointerCancel],
  ["lostpointercapture", onPointerCancel],
  ["keydown", onKeydown],
  ["dblclick", () => emit("reset")],
];

// A focusable separator is a widget the template lint does not know, so it listens directly.
onMounted(() => {
  for (const [type, listener] of listeners)
    handle.value?.addEventListener(type, listener as EventListener);
});

onBeforeUnmount(() => {
  for (const [type, listener] of listeners)
    handle.value?.removeEventListener(type, listener as EventListener);
});

function rounded(rem: number): number {
  return Math.round(rem * 10) / 10;
}

function isRtl(el: Element | null): boolean {
  return !!el && getComputedStyle(el).direction === "rtl";
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture?.(event.pointerId);
  start = { clientX: event.clientX, widthRem: props.widthRem, pointerId: event.pointerId };
  live = props.widthRem;
  dragging.value = true;
  el.focus({ preventScroll: true });
}

function onPointerMove(event: PointerEvent): void {
  if (!start || event.pointerId !== start.pointerId) return;
  const rtl = isRtl(event.currentTarget as Element);
  live = dragWidth(start, event.clientX, rtl, props);
  emit("resize", live);
}

function onPointerUp(event: PointerEvent): void {
  if (!start || event.pointerId !== start.pointerId) return;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  start = null;
  dragging.value = false;
  emit("commit", live);
}

// A cancelled drag keeps the last live width, so the panel never jumps back under the pointer.
function onPointerCancel(): void {
  if (!start) return;
  start = null;
  dragging.value = false;
  emit("commit", live);
}

// The edge moves the way the arrow points: towards the page widens the panel.
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const rtl = isRtl(event.currentTarget as Element);
  const grow = rtl ? "ArrowRight" : "ArrowLeft";
  const shrink = rtl ? "ArrowLeft" : "ArrowRight";
  let next: number | null = null;
  if (event.key === grow) next = props.widthRem + RESIZE_STEP_REM;
  else if (event.key === shrink) next = props.widthRem - RESIZE_STEP_REM;
  else if (event.key === "Home") next = props.minRem;
  else if (event.key === "End") next = props.maxRem;
  if (next === null) return;
  event.preventDefault();
  emit("commit", clampRem(next, props));
}
</script>
