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
      'bg-dialog-bg rounded-surface fixed start-[calc(var(--o-window-x,0)*1rem)] top-[calc(var(--o-window-y,0)*1rem)] flex w-[calc(var(--o-window-w,0)*1rem)] flex-col border shadow-lg forced-colors:border-[CanvasText]',
      focused
        ? 'border-border-strong z-5100 forced-colors:border-[Highlight]'
        : 'border-border-default z-5000',
      obscured === 'collapsed' ? 'h-10 overflow-hidden' : 'h-[calc(var(--o-window-h,0)*1rem)]',
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
          ref="grip"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 cursor-move"
          :aria-label="
            t(mode === 'resize' ? 'assistant.window.gripResize' : 'assistant.window.gripMove', {
              title: raw(titleText),
            })
          "
          :aria-describedby="mode ? hintId : undefined"
          data-test="assistant-window-grip"
          @click="endMode('keep')"
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
          :label="t('assistant.window.close')"
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

/** The page card's own gutter; a window never comes closer than this to any edge of the page. */
const EDGE_GAP_REM = 0.5;

const GRIP = "[data-test='assistant-window-grip']";

const CONTROLS = "button, a, input, textarea, select, [role='button'], [role='menuitem']";

const CHROME = "[data-assistant-chrome]";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  WINDOW_NARROW_REM,
  clampRect,
  defaultGeometry,
  dropTargetAt,
  geometryOf,
  rectOf,
  registerEscapeRung,
  resizeRect,
  snapRect,
  useAssistantName,
  useAssistantStore,
  type DropTarget,
  type WindowRect,
} from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped } from "@/types/i18n";

import AssistantShell from "./AssistantShell.vue";
import { tearOffRequest, type WindowKeyboardMode } from "./assistantWindowHost";

const props = withDefaults(defineProps<AssistantWindowProps>(), {
  obscured: null,
  tearOff: null,
});

const emit = defineEmits<{
  minimise: [reason: MinimiseReason];
  close: [];
  pin: [];
  "drop-target": [target: DropTarget];
  announce: [key: "windowPlaced" | "moveCancelled"];
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
// The tray band already keeps its own gap, so the bottom inset applies only without it.
const bounds = computed<PageArea>(() => {
  const { start, end, top, bottom, viewport } = props.area;
  return {
    start: start + EDGE_GAP_REM,
    end: end - EDGE_GAP_REM,
    top: top + EDGE_GAP_REM,
    bottom: props.bandRem > 0 ? bottom : bottom - EDGE_GAP_REM,
    viewport,
  };
});
const rect = computed(
  () =>
    live.value ??
    clampRect(rectOf(props.win.geometry, props.area, props.bandRem), bounds.value, props.bandRem),
);
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
  if (!target.closest(GRIP) && (!target.closest(CHROME) || target.closest(CONTROLS))) return;
  event.preventDefault();
  startGesture("drag", event.pointerId, event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = ((event.clientX - gesture.x) / 16) * direction();
  const dy = (event.clientY - gesture.y) / 16;
  if (gesture.kind === "drag") return dragTo(dx, dy, event);
  live.value = resizeRect(gesture.start, gesture.kind, dx, dy, bounds.value, props.bandRem);
}

function dragTo(dx: number, dy: number, event: PointerEvent): void {
  if (!gesture) return;
  const moved = { ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy };
  live.value = clampRect(snapRect(moved, props.area, props.bandRem), bounds.value, props.bandRem);
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
  // A snapped edge sits at the same inset the default window keeps from its corner.
  const inset = defaultGeometry().dxRem;
  const atX = next.x === start + inset || next.x + next.w === end - inset;
  const atY = next.y === top + inset || next.y + next.h === bottom - inset;
  if (atX && atY) return "corner";
  return atX || atY ? "edge" : "none";
}

function onFocusIn(): void {
  store.raiseWindow(props.win.sid);
}

function place(next: WindowRect): void {
  store.setWindowGeometry(props.win.sid, geometryOf(next, props.area));
}

// Switching between move and resize keeps the first saved rect, so Escape undoes the whole session.
function beginMode(next: WindowKeyboardMode): void {
  if (mode.value === next) return;
  if (!mode.value) before.value = rect.value;
  mode.value = next;
  emit("mode-started", next);
}

async function startMode(next: WindowKeyboardMode): Promise<void> {
  beginMode(next);
  await nextTick();
  (grip.value?.$el as HTMLElement | undefined)?.focus();
}

function endMode(outcome: "keep" | "restore"): void {
  if (!mode.value) return;
  const saved = before.value;
  mode.value = null;
  before.value = null;
  if (outcome === "restore" && saved) place(saved);
  emit("announce", outcome === "restore" ? "moveCancelled" : "windowPlaced");
}

function onGripBlur(): void {
  endMode("keep");
}

function keyDelta(event: KeyboardEvent): { dx: number; dy: number } | null {
  const start = direction() * KEY_STEP_REM;
  if (event.key === "ArrowLeft") return { dx: -start, dy: 0 };
  if (event.key === "ArrowRight") return { dx: start, dy: 0 };
  if (event.key === "ArrowUp") return { dx: 0, dy: -KEY_STEP_REM };
  return event.key === "ArrowDown" ? { dx: 0, dy: KEY_STEP_REM } : null;
}

function onGripKey(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    return endMode("keep");
  }
  const delta = keyDelta(event);
  if (!delta) return;
  event.preventDefault();
  beginMode(event.shiftKey ? "resize" : "move");
  const current = rect.value;
  // A resize grows from the far corner and stops at the page's edge instead of pushing the window back.
  const next =
    mode.value === "move"
      ? clampRect(
          { ...current, x: current.x + delta.dx, y: current.y + delta.dy },
          bounds.value,
          props.bandRem,
        )
      : resizeRect(current, "se", delta.dx, delta.dy, bounds.value, props.bandRem);
  place(next);
}

const unregisterRung = registerEscapeRung("e", (event) => {
  const from = event.target instanceof Node ? event.target : document.activeElement;
  if (!mode.value || !root.value?.contains(from)) return false;
  endMode("restore");
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

defineExpose({ startMode });
</script>
