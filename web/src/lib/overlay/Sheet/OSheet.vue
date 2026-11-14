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
  <Teleport to="body" :disabled="inline">
    <div
      v-if="open || keepMounted"
      v-show="open"
      ref="root"
      v-bind="overlayScope"
      role="dialog"
      aria-modal="false"
      :aria-label="ariaLabel"
      :data-test="dataTest"
      :data-dd-privacy="privacy"
      :data-snap="snap"
      :class="[SHEET_BASE, SHEET_HEIGHT[snap]]"
      :style="{ zIndex: sheetZIndex }"
    >
      <OButton
        v-if="peekRow"
        variant="ghost"
        block
        data-sheet-drag
        class="h-14! shrink-0 cursor-grab touch-none justify-start! rounded-none! px-4 data-sheet-drag:focus-visible:-outline-offset-2!"
        :data-test="testId('peek-row')"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="dragStart = null"
        @click="onPeekClick"
      >
        <slot name="peek" />
        <!-- The row's name starts with what it shows, so voice control can say it; the action follows -->
        <span class="sr-only">{{ expandLabel }}</span>
      </OButton>
      <div v-show="!peekRow" class="flex min-h-0 flex-1 flex-col">
        <OButton
          v-if="handleToggle"
          variant="ghost"
          block
          data-sheet-drag
          :aria-label="handleName"
          aria-keyshortcuts="ArrowUp ArrowDown"
          class="relative h-11! shrink-0 cursor-grab touch-none rounded-none! data-sheet-drag:focus-visible:-outline-offset-2!"
          :data-test="testId('handle')"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="dragStart = null"
          @click="onHandleClick"
          @keydown="onHandleKey"
        >
          <span
            aria-hidden="true"
            class="bg-border-strong rounded-default absolute inset-x-0 top-2 mx-auto h-1 w-9"
          />
        </OButton>
        <div
          v-else
          :data-test="testId('handle')"
          class="relative flex h-11 shrink-0 cursor-grab touch-none items-center justify-end gap-1 px-2"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="dragStart = null"
        >
          <span
            aria-hidden="true"
            class="bg-border-strong rounded-default absolute inset-x-0 top-2 mx-auto h-1 w-9"
          />
          <OButton
            v-if="smaller"
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :data-test="testId('peek')"
            @click="emit('update:snap', smaller)"
          >
            {{ collapseLabel }}
          </OButton>
          <OButton
            v-if="larger"
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :data-test="testId('expand')"
            @click="emit('update:snap', larger)"
          >
            {{ expandLabel }}
          </OButton>
        </div>
        <div v-if="$slots.header" class="shrink-0">
          <slot name="header" />
        </div>
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="shrink-0">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
const INSET_VAR = "--o-assistant-inset-bottom";

// Every open sheet's covered height, so closing one never drops the inset another still needs.
const covered = new Map<symbol, number>();

function publishInset(): void {
  const heights = [...covered.values()];
  const style = document.documentElement.style;
  if (heights.length) style.setProperty(INSET_VAR, String(Math.max(...heights)));
  else style.removeProperty(INSET_VAR);
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from "vue";
import { useOverlayScope } from "@/lib/overlay/overlayScope";
import { overlayLayerZIndex, useOverlayLayer } from "@/lib/overlay/Dialog/dialogStacking";

import OButton from "@/lib/core/Button/OButton.vue";

import {
  SHEET_SNAPS,
  type OSheetEmits,
  type OSheetProps,
  type OSheetSlots,
  type SheetSnap,
} from "./OSheet.types";

const props = withDefaults(defineProps<OSheetProps>(), {
  snapPoints: () => [...SHEET_SNAPS],
  anchorAbove: undefined,
  persistent: false,
  dataTest: "o-sheet",
  keepMounted: false,
  closeOnEscape: true,
  inline: false,
  alignTo: null,
  handleToggle: false,
  snapLabels: () => ({}),
});

const emit = defineEmits<OSheetEmits>();

defineSlots<OSheetSlots>();

const DRAG_THRESHOLD = 8;

// Below md every sheet spans the window; a narrower column is a tablet or desktop drawer.
const ALIGN_MIN_VIEWPORT_PX = 768;

// A target this close to the window's width is treated as the window.
const ALIGN_FULL_SLACK_PX = 48;

// The sheet sits above the keyboard and any anchored footer, so its offset and cap follow both.
const SHEET_BASE = [
  "fixed flex flex-col overflow-hidden",
  // eslint-disable-next-line local/no-hardcoded-px -- unit conversion of the unitless offsets JS writes
  "start-[calc(var(--o-sheet-start,0)*1px)] end-[calc(var(--o-sheet-end,0)*1px)]",
  "rounded-t-surface border-border-default bg-surface-base border-t shadow-lg",
  "pb-[env(safe-area-inset-bottom)]",
  "motion-safe:transition-[height] motion-safe:duration-200 motion-reduce:transition-none",
  // eslint-disable-next-line local/no-hardcoded-px -- unit conversion of the unitless offsets JS writes
  "bottom-[calc((var(--o-sheet-kb,0)+var(--o-sheet-anchor,0))*1px)]",
  // eslint-disable-next-line local/no-hardcoded-px -- unit conversion of the unitless offsets JS writes
  "max-h-[calc(100dvh-var(--navbar-height,2.25rem)-(var(--o-sheet-kb,0)+var(--o-sheet-anchor,0))*1px)]",
];

const SHEET_HEIGHT: Record<SheetSnap, string> = {
  peek: "h-14",
  half: "h-[50dvh]",
  full: "h-[calc(100dvh-var(--navbar-height,2.25rem))]",
};

const slots = useSlots();
const root = ref<HTMLElement | null>(null);
const dragStart = ref<number | null>(null);
const token = Symbol("sheet");
let resizeObserver: ResizeObserver | null = null;
let alignObserver: ResizeObserver | null = null;
let dragged = false;
let dragFromHeight = 0;

const peekRow = computed(() => props.snap === "peek" && !!slots.peek);

const points = computed(() => SHEET_SNAPS.filter((snap) => props.snapPoints.includes(snap)));
const larger = computed(() => points.value[points.value.indexOf(props.snap) + 1] ?? null);
const smaller = computed(() => {
  const index = points.value.indexOf(props.snap);
  return index > 0 ? points.value[index - 1] : null;
});

// Without the labelled buttons the snap is spoken with the action, so every size is known and reachable by keyboard.
const handleName = computed(() => {
  const action = String(larger.value ? props.expandLabel : props.collapseLabel);
  const at = props.snapLabels[props.snap];
  return at ? `${action}, ${String(at)}` : action;
});

function testId(part: string): string {
  return `${props.dataTest}-${part}`;
}

function onPointerDown(event: PointerEvent): void {
  if ((event.target as Element | null)?.closest("button:not([data-sheet-drag])")) return;
  dragStart.value = event.clientY;
  dragFromHeight = root.value?.getBoundingClientRect().height || snapHeights()[props.snap];
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
}

// A drag lands on the nearest snap, never a free height; a tap on the handle at peek opens half.
function onPointerUp(event: PointerEvent): void {
  const start = dragStart.value;
  dragStart.value = null;
  if (start === null) return;
  dragged = Math.abs(event.clientY - start) >= DRAG_THRESHOLD;
  if (!dragged) {
    if (props.handleToggle) return;
    if (props.snap === "peek" && larger.value && !peekRow.value) emit("update:snap", larger.value);
    return;
  }
  // The keyboard and an anchored footer lift the sheet, so the drag moves its rendered top, not the window-bottom distance.
  const height = dragFromHeight + start - event.clientY;
  const heights = snapHeights();
  if (!props.persistent && height < heights.peek / 2) {
    emit("update:open", false);
    emit("dismiss");
    return;
  }
  const nearest = snapsToward(event.clientY > start).reduce((best, snap) =>
    Math.abs(heights[snap] - height) < Math.abs(heights[best] - height) ? snap : best,
  );
  if (nearest !== props.snap) emit("update:snap", nearest);
}

// A capped sheet is shorter than its nominal snap, so a drag only ever lands on the current snap or one in its direction.
function snapsToward(down: boolean): SheetSnap[] {
  const index = points.value.indexOf(props.snap);
  if (index < 0) return points.value;
  return down ? points.value.slice(0, index + 1) : points.value.slice(index);
}

// The peek row is one button: a tap expands it, a drag snaps like the handle.
function onPeekClick(): void {
  if (dragged) {
    dragged = false;
    return;
  }
  if (larger.value) emit("update:snap", larger.value);
}

function onHandleClick(): void {
  if (dragged) {
    dragged = false;
    return;
  }
  const next = larger.value ?? smaller.value;
  if (next) emit("update:snap", next);
}

// Arrow keys reach every snap, peek included, which a tap alone never returns to.
function onHandleKey(event: KeyboardEvent): void {
  const next =
    event.key === "ArrowUp" ? larger.value : event.key === "ArrowDown" ? smaller.value : undefined;
  if (next === undefined) return;
  event.preventDefault();
  if (next) emit("update:snap", next);
}

// IME candidate lists own their Escape; a persistent or consumer-handled sheet keeps it.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
  if (props.persistent || !props.closeOnEscape) return;
  event.stopPropagation();
  emit("update:open", false);
  emit("dismiss");
}

function visibleControl(showsPeek: boolean): HTMLElement | null {
  const el = root.value?.querySelector<HTMLElement>(
    `[data-test="${testId(showsPeek ? "peek-row" : "handle")}"]`,
  );
  if (!el || el.matches("button")) return el ?? null;
  return el.querySelector<HTMLElement>("button");
}

function snapHeights(): Record<SheetSnap, number> {
  const style = getComputedStyle(document.documentElement);
  const remPx = parseFloat(style.fontSize) || 16;
  // The token is declared in px, while the class fallback is 2.25rem.
  const navbar = style.getPropertyValue("--navbar-height").trim();
  const header = navbar.endsWith("px") ? parseFloat(navbar) : parseFloat(navbar) * remPx;
  return {
    peek: 3.5 * remPx,
    half: window.innerHeight / 2,
    full: window.innerHeight - (header || 2.25 * remPx),
  };
}

// iOS overlays the keyboard instead of resizing the layout, so the covered height is measured.
function updateOffsets(): void {
  const el = root.value;
  if (!el) return;
  const viewport = window.visualViewport;
  const keyboard = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0;
  el.style.setProperty("--o-sheet-kb", String(Math.round(keyboard)));
  el.style.setProperty("--o-sheet-anchor", String(Math.round(anchorOffset())));
  const [start, end] = alignedEdges();
  el.style.setProperty("--o-sheet-start", String(start));
  el.style.setProperty("--o-sheet-end", String(end));
  updateInset();
}

// The inline edges of `alignTo` as distances from the window's start and end, in px; a phone or a full-width target spans the window.
function alignedEdges(): [number, number] {
  const rect = props.alignTo?.getBoundingClientRect();
  if (!rect || window.innerWidth < ALIGN_MIN_VIEWPORT_PX) return [0, 0];
  if (rect.width >= window.innerWidth - ALIGN_FULL_SLACK_PX) return [0, 0];
  const left = Math.max(0, Math.round(rect.left));
  const right = Math.max(0, Math.round(window.innerWidth - rect.right));
  return document.dir === "rtl" ? [right, left] : [left, right];
}

function updateInset(): void {
  const el = root.value;
  if (!el || !props.open) return;
  covered.set(token, Math.round(Math.max(0, window.innerHeight - el.getBoundingClientRect().top)));
  publishInset();
}

function anchorOffset(): number {
  const el = resolveAnchor();
  if (!el) return 0;
  return Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
}

function resolveAnchor(): HTMLElement | null {
  const anchor = props.anchorAbove;
  if (anchor instanceof HTMLElement) return anchor;
  if (typeof anchor === "string") return document.querySelector<HTMLElement>(anchor);
  return openDrawerFooter();
}

// ODrawer renders its footer as the sibling after the scrolling body.
function openDrawerFooter(): HTMLElement | null {
  const drawers = document.querySelectorAll<HTMLElement>('[data-o2-drawer][data-state="open"]');
  const drawer = drawers[drawers.length - 1];
  const body = drawer ? [...drawer.children].find((el) => el.matches(".overflow-y-auto")) : null;
  const footer = body?.nextElementSibling;
  return footer instanceof HTMLElement ? footer : null;
}

function attach(): void {
  root.value?.addEventListener("keydown", onKeydown);
  window.visualViewport?.addEventListener("resize", updateOffsets);
  window.visualViewport?.addEventListener("scroll", updateOffsets);
  window.addEventListener("resize", updateOffsets);
  if (typeof ResizeObserver !== "undefined" && root.value) {
    resizeObserver = new ResizeObserver(updateInset);
    resizeObserver.observe(root.value);
    // A drawer that widens once the sheet opens moves its edges, so the sheet follows it.
    alignObserver = new ResizeObserver(updateOffsets);
    if (props.alignTo) alignObserver.observe(props.alignTo);
  }
  updateOffsets();
}

function detach(): void {
  root.value?.removeEventListener("keydown", onKeydown);
  window.visualViewport?.removeEventListener("resize", updateOffsets);
  window.visualViewport?.removeEventListener("scroll", updateOffsets);
  window.removeEventListener("resize", updateOffsets);
  resizeObserver?.disconnect();
  resizeObserver = null;
  alignObserver?.disconnect();
  alignObserver = null;
  covered.delete(token);
  publishInset();
}

watch(
  () => props.open,
  async (open) => {
    detach();
    if (!open) return;
    await nextTick();
    attach();
  },
  { immediate: true },
);

watch(
  () => props.alignTo,
  (target, previous) => {
    if (previous) alignObserver?.unobserve(previous);
    if (target) alignObserver?.observe(target);
    if (props.open) updateOffsets();
  },
);

watch(
  () => props.snap,
  async () => {
    await nextTick();
    updateOffsets();
  },
);

// Peek hides the body and the peek row unmounts on expand, so focus inside the sheet moves to whichever control stays shown.
watch(peekRow, async (showsPeek) => {
  const hadFocus = !!root.value?.contains(document.activeElement);
  await nextTick();
  if (hadFocus) visibleControl(showsPeek)?.focus();
});

onBeforeUnmount(detach);

// A scope that provides attributes (the assistant surface) keeps them on content teleported out of it.
const overlayScope = useOverlayScope();

// On the dialog ladder, so a confirm or menu opened from the sheet stacks above it and its scrim dims it.
const sheetZIndex = overlayLayerZIndex(useOverlayLayer()).contentZIndex;
</script>
