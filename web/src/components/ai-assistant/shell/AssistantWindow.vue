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
    ref="root"
    role="dialog"
    aria-modal="false"
    :aria-label="t('assistant.window.name', { product, title: raw(titleText) })"
    data-test="assistant-window"
    :data-assistant-window="win.sid"
    :data-focused="focused ? '' : undefined"
    :data-collapsed="obscured === 'collapsed' ? '' : undefined"
    :class="[
      'bg-surface-base rounded-surface fixed start-[calc(var(--o-window-x)*1rem)] top-[calc(var(--o-window-y)*1rem)] flex w-[calc(var(--o-window-w)*1rem)] flex-col border shadow-lg forced-colors:border-[CanvasText]',
      focused
        ? 'border-border-control z-5100 forced-colors:border-[Highlight]'
        : 'border-border-default z-5000',
      obscured === 'collapsed' ? 'h-10 overflow-hidden' : 'h-[calc(var(--o-window-h)*1rem)]',
      obscured === 'hidden' ? 'invisible' : '',
    ]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @focusin="onFocusIn"
  >
    <span
      v-for="edge in RESIZE_EDGES"
      :key="edge"
      aria-hidden="true"
      :data-resize-edge="edge"
      :class="['absolute', EDGE_CLASSES[edge]]"
    />
    <AssistantShell
      placement="window"
      :sid="win.sid"
      :focused="focused"
      :narrow="narrow"
      density="compact"
      class="rounded-surface min-h-0 flex-1 overflow-hidden"
    >
      <template #chrome-start>
        <OButton
          v-if="mode"
          ref="grip"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 cursor-move"
          :aria-label="
            t(mode === 'move' ? 'assistant.window.gripMove' : 'assistant.window.gripResize', {
              title: raw(titleText),
            })
          "
          :aria-describedby="hintId"
          data-test="assistant-window-grip"
          @click="endMode('keep', true)"
          @keydown="onGripKey"
          @blur="onGripBlur"
        >
          <OIcon :name="assistantGlyph.grip" size="sm" />
        </OButton>
      </template>
      <template #container-actions>
        <AssistantIconButton
          :label="t('assistant.window.minimise')"
          :icon="assistantGlyph.minimise"
          data-test="assistant-window-minimise"
          @click="emit('minimise', 'button')"
        />
        <AssistantIconButton
          :label="t('assistant.tray.close', { title: raw(titleText) })"
          :icon="assistantGlyph.close"
          data-test="assistant-window-close"
          @click="emit('close')"
        />
      </template>
    </AssistantShell>
    <OText
      v-if="mode"
      :id="hintId"
      as="p"
      variant="meta"
      class="bg-surface-panel border-border-default absolute inset-x-0 top-10 z-10 border-b px-2 py-1"
      data-test="assistant-window-move-mode"
    >
      {{ t(mode === "move" ? "assistant.window.moveModeHint" : "assistant.window.resizeModeHint") }}
    </OText>
  </div>
</template>

<script lang="ts">
import type { FloatingWindow, MinimiseReason, PageArea, ResizeEdge } from "@/composables/assistant";

import type { TearOffDrag } from "./assistantWindowHost";

export interface AssistantWindowProps {
  win: FloatingWindow;
  area: PageArea;
  /** The tray-and-notice band the window keeps clear of. */
  bandRem: number;
  focused: boolean;
  /** Focus-not-obscured: the window gave way to a keyboard-focused control beneath it. */
  obscured?: "collapsed" | "hidden" | null;
  /** The tear-off this window carries on, when it was born under the pointer. */
  tearOff?: TearOffDrag | null;
}

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const EDGE_CLASSES: Record<ResizeEdge, string> = {
  n: "inset-x-2 -top-2 h-2 cursor-ns-resize",
  s: "inset-x-2 -bottom-2 h-2 cursor-ns-resize",
  e: "inset-y-2 -end-2 w-2 cursor-ew-resize",
  w: "inset-y-2 -start-2 w-2 cursor-ew-resize",
  ne: "-end-2 -top-2 size-3 cursor-nesw-resize",
  nw: "-start-2 -top-2 size-3 cursor-nwse-resize",
  se: "-end-2 -bottom-2 size-3 cursor-nwse-resize",
  sw: "-start-2 -bottom-2 size-3 cursor-nesw-resize",
};

const KEY_STEP_REM = 1;

const KEY_SHIFT_STEP_REM = 4;

const CONTROLS = "button, a, input, textarea, select, [role='button'], [role='menuitem']";

const CHROME = "[data-assistant-chrome]";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  WINDOW_DEFAULT_H_REM,
  WINDOW_DEFAULT_W_REM,
  WINDOW_MIN_H_REM,
  WINDOW_MIN_W_REM,
  WINDOW_NARROW_REM,
  WINDOW_STEP_REM,
  atCorner,
  clampRect,
  dropTargetAt,
  geometryOf,
  otherCorners,
  rectOf,
  registerEscapeRung,
  resizeRect,
  sizeLimits,
  snapRect,
  useAssistantName,
  useAssistantStore,
  type DropTarget,
  type WindowCorner,
  type WindowRect,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantShell from "./AssistantShell.vue";
import {
  assistantWindowHostKey,
  tearOffRequest,
  type WindowKeyboardMode,
  type WindowSizeStep,
} from "./assistantWindowHost";

const props = withDefaults(defineProps<AssistantWindowProps>(), {
  obscured: null,
  tearOff: null,
});

const emit = defineEmits<{
  minimise: [reason: MinimiseReason];
  close: [];
  pin: [];
  "drop-target": [target: DropTarget];
  announce: [key: "windowPlaced" | "moveCancelled" | "wider" | "narrower" | "taller" | "shorter"];
  "mode-started": [mode: WindowKeyboardMode];
}>();

const { t } = useI18nTyped();
const { product } = useAssistantName();
const store = useAssistantStore();
const root = ref<HTMLElement | null>(null);
const grip = ref<InstanceType<typeof OButton> | null>(null);
const hintId = useId();
const live = ref<WindowRect | null>(null);
const mode = ref<WindowKeyboardMode | null>(null);
const before = ref<WindowRect | null>(null);

let gesture: {
  kind: "drag" | ResizeEdge;
  pointerId: number;
  x: number;
  y: number;
  start: WindowRect;
} | null = null;
let dropTarget: DropTarget = null;

const titleText = computed(() =>
  String(store.state.sessions[props.win.sid]?.title ?? t("assistant.thread.newChatTitle")),
);
const rect = computed(() => live.value ?? rectOf(props.win.geometry, props.area, props.bandRem));
const narrow = computed(() => rect.value.w < WINDOW_NARROW_REM);

function writeRect(): void {
  const el = root.value;
  if (!el) return;
  const { x, y, w, h } = rect.value;
  el.style.setProperty("--o-window-x", String(x));
  el.style.setProperty("--o-window-y", String(y));
  el.style.setProperty("--o-window-w", String(w));
  el.style.setProperty("--o-window-h", String(h));
}

function direction(): 1 | -1 {
  return getComputedStyle(root.value ?? document.documentElement).direction === "rtl" ? -1 : 1;
}

function startGesture(kind: "drag" | ResizeEdge, id: number, x: number, y: number): void {
  gesture = { kind, pointerId: id, x, y, start: rect.value };
  root.value?.setPointerCapture?.(id);
  live.value = rect.value;
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || event.button !== 0) return;
  store.raiseWindow(props.win.sid);
  const edge = target.closest<HTMLElement>("[data-resize-edge]")?.dataset.resizeEdge;
  if (edge) {
    event.preventDefault();
    return startGesture(edge as ResizeEdge, event.pointerId, event.clientX, event.clientY);
  }
  if (!target.closest(CHROME) || target.closest(CONTROLS)) return;
  event.preventDefault();
  startGesture("drag", event.pointerId, event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = ((event.clientX - gesture.x) / 16) * direction();
  const dy = (event.clientY - gesture.y) / 16;
  if (gesture.kind === "drag") return dragTo(dx, dy, event);
  live.value = resizeRect(gesture.start, gesture.kind, dx, dy, props.area, props.bandRem);
}

function dragTo(dx: number, dy: number, event: PointerEvent): void {
  if (!gesture) return;
  const moved = { ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy };
  live.value = clampRect(snapRect(moved, props.area, props.bandRem), props.area, props.bandRem);
  const x = direction() === 1 ? event.clientX / 16 : props.area.viewport - event.clientX / 16;
  const target = dropTargetAt(x, event.clientY / 16, props.area);
  if (target !== dropTarget) {
    dropTarget = target;
    emit("drop-target", target);
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const { kind } = gesture;
  const finished = live.value;
  const target = dropTarget;
  endGesture();
  if (kind === "drag" && target === "sidebar") return emit("pin");
  if (kind === "drag" && target === "tray") return emit("minimise", "drop");
  if (!finished) return;
  store.setWindowGeometry(props.win.sid, geometryOf(finished, props.area));
  if (kind === "drag") trackAssistant("ai_window_moved", { snap: snapKind(finished) });
  else trackAssistant("ai_window_resized", {});
}

function onPointerCancel(): void {
  endGesture();
}

function endGesture(): void {
  if (gesture) root.value?.releasePointerCapture?.(gesture.pointerId);
  gesture = null;
  live.value = null;
  if (dropTarget) emit("drop-target", null);
  dropTarget = null;
}

function snapKind(next: WindowRect): "corner" | "edge" | "none" {
  const { start, end, top, bottom } = props.area;
  const atX = next.x === start + 1 || next.x + next.w === end - 1;
  const atY = next.y === top + 1 || next.y + next.h === bottom - 1;
  if (atX && atY) return "corner";
  return atX || atY ? "edge" : "none";
}

function onFocusIn(): void {
  store.raiseWindow(props.win.sid);
}

function place(next: WindowRect): void {
  store.setWindowGeometry(props.win.sid, geometryOf(next, props.area));
}

function stepRect(step: WindowSizeStep): WindowRect {
  const current = rect.value;
  const delta = step === "wider" || step === "taller" ? WINDOW_STEP_REM : -WINDOW_STEP_REM;
  if (step === "wider" || step === "narrower") return { ...current, w: current.w + delta };
  return { ...current, h: current.h + delta };
}

function sizeLimited(step: WindowSizeStep): boolean {
  const { maxW, maxH } = sizeLimits(props.area);
  const { w, h } = rect.value;
  if (step === "wider") return w >= maxW;
  if (step === "narrower") return w <= WINDOW_MIN_W_REM;
  return step === "taller" ? h >= maxH : h <= WINDOW_MIN_H_REM;
}

// A step keeps the window's corner, so it grows and shrinks away from where it is parked.
function stepSize(step: WindowSizeStep): void {
  const current = props.win.geometry;
  const next = stepRect(step);
  const { maxW, maxH } = sizeLimits(props.area);
  store.setWindowGeometry(props.win.sid, {
    ...current,
    wRem: Math.min(Math.max(next.w, WINDOW_MIN_W_REM), maxW),
    hRem: Math.min(Math.max(next.h, WINDOW_MIN_H_REM), maxH),
  });
  emit("announce", step);
}

function moveToCorner(corner: WindowCorner): void {
  store.setWindowGeometry(props.win.sid, atCorner(props.win.geometry, corner));
  trackAssistant("ai_window_moved", { snap: "corner" });
}

function resetSize(): void {
  store.setWindowGeometry(props.win.sid, {
    ...props.win.geometry,
    wRem: WINDOW_DEFAULT_W_REM,
    hRem: WINDOW_DEFAULT_H_REM,
  });
}

async function startMode(next: WindowKeyboardMode): Promise<void> {
  before.value = rect.value;
  mode.value = next;
  emit("mode-started", next);
  // The menu hands focus back to its trigger as it closes; the grip takes it after that.
  await nextTick();
  setTimeout(() => (grip.value?.$el as HTMLElement | undefined)?.focus(), 0);
}

function focusLayout(): void {
  const selector = narrow.value
    ? '[data-test="assistant-thread-title-button"]'
    : '[data-test="assistant-layout-button"]';
  root.value?.querySelector<HTMLElement>(selector)?.focus();
}

function endMode(outcome: "keep" | "restore", refocus: boolean): void {
  if (!mode.value) return;
  const saved = before.value;
  mode.value = null;
  before.value = null;
  if (outcome === "restore" && saved) place(saved);
  emit("announce", outcome === "restore" ? "moveCancelled" : "windowPlaced");
  if (refocus) void nextTick(focusLayout);
}

function onGripBlur(): void {
  endMode("keep", false);
}

function keyDelta(event: KeyboardEvent): { dx: number; dy: number } | null {
  const step = mode.value === "move" && event.shiftKey ? KEY_SHIFT_STEP_REM : KEY_STEP_REM;
  const start = direction() * step;
  if (event.key === "ArrowLeft") return { dx: -start, dy: 0 };
  if (event.key === "ArrowRight") return { dx: start, dy: 0 };
  if (event.key === "ArrowUp") return { dx: 0, dy: -step };
  return event.key === "ArrowDown" ? { dx: 0, dy: step } : null;
}

function onGripKey(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    return endMode("keep", true);
  }
  const delta = keyDelta(event);
  if (!delta) return;
  event.preventDefault();
  const current = rect.value;
  const next =
    mode.value === "move"
      ? { ...current, x: current.x + delta.dx, y: current.y + delta.dy }
      : { ...current, w: current.w + delta.dx, h: current.h + delta.dy };
  place(clampRect(next, props.area, props.bandRem));
}

provide(assistantWindowHostKey, {
  otherCorners: () => otherCorners(props.win.geometry.corner),
  moveTo: moveToCorner,
  sizeLimited,
  stepSize,
  resetSize,
  startMode: (next) => void startMode(next),
});

const unregisterRung = registerEscapeRung("e", (event) => {
  const from = event.target instanceof Node ? event.target : document.activeElement;
  if (!mode.value || !root.value?.contains(from)) return false;
  endMode("restore", true);
  return true;
});

watch(rect, writeRect, { flush: "post" });

onMounted(() => {
  writeRect();
  const drag = props.tearOff;
  if (!drag) return;
  tearOffRequest.value = null;
  startGesture("drag", drag.pointerId, drag.clientX, drag.clientY);
});

onBeforeUnmount(() => {
  unregisterRung();
  endGesture();
});

defineExpose({ startMode, stepSize, moveToCorner });
</script>
