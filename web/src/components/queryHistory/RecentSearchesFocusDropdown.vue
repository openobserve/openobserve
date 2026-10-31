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
  <Teleport to="body">
    <div
      v-if="open && enabled && placement"
      ref="panelRef"
      class="bg-select-content-bg border-dropdown-border rounded-default fixed flex flex-col overflow-hidden border shadow-lg"
      :style="position"
      :data-side="placement.side"
      data-test="recent-searches-focus-dropdown"
    >
      <RecentSearchesPopover
        ref="listRef"
        :source="source"
        :active="open"
        :examples="examples"
        @run="(entry, when) => close(() => emit('run', entry, when))"
        @load="(entry, when) => close(() => emit('load', entry, when))"
        @view-all="(status) => close(() => emit('view-all', status))"
        @example="(query) => close(() => emit('example', query))"
        @close="close(() => emit('dismiss'))"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRecentSearches } from "@/composables/queryHistory/useRecentSearches";
import type { HistorySource, HistoryStatus, QueryHistoryEntry } from "@/services/query_history";
import { isQueryEditorInput, type RestoreTime } from "@/utils/queryHistory/recentSearches";
import { observeMoves } from "@/utils/queryHistory/observeMoves";
import RecentSearchesPopover from "./RecentSearchesPopover.vue";

// OPopover focuses its content on open; this panel must leave focus in the editor.
const DROPDOWN_Z_INDEX = 6000;
const EDGE_GAP_PX = 8;
const MIN_ROOM_PX = 160;
const CARET_SELECTOR = ".monaco-editor .cursors-layer .cursor";

const props = withDefaults(
  defineProps<{
    source: HistorySource;
    anchor: HTMLElement | null;
    examples?: string[];
  }>(),
  { examples: () => [] },
);

const emit = defineEmits<{
  run: [entry: QueryHistoryEntry, when: RestoreTime];
  load: [entry: QueryHistoryEntry, when: RestoreTime];
  "view-all": [status: HistoryStatus | null];
  example: [query: string];
  dismiss: [];
}>();

const open = defineModel<boolean>("open", { default: false });

const { enabled } = useRecentSearches();
const panelRef = ref<HTMLElement | null>(null);
const listRef = ref<InstanceType<typeof RecentSearchesPopover> | null>(null);

interface Placement {
  side: "below" | "above";
  viewportOffset: number;
  left: number;
  maxHeight: number;
}
const placement = ref<Placement | null>(null);

const position = computed(() => {
  const at = placement.value;
  if (!at) return { zIndex: DROPDOWN_Z_INDEX };
  return {
    [at.side === "below" ? "top" : "bottom"]: `${at.viewportOffset}px`,
    left: `${at.left}px`,
    maxHeight: `${at.maxHeight}px`,
    zIndex: DROPDOWN_Z_INDEX,
  };
});

const caretRect = () => props.anchor?.querySelector(CARET_SELECTOR)?.getBoundingClientRect();

const place = (): Placement | null => {
  const caret = caretRect();
  if (!caret || caret.bottom <= 0 || caret.top >= window.innerHeight) return null;
  const width = panelRef.value?.offsetWidth ?? 0;
  const left = Math.max(EDGE_GAP_PX, Math.min(caret.left, window.innerWidth - width - EDGE_GAP_PX));
  const roomBelow = window.innerHeight - caret.bottom - EDGE_GAP_PX;
  if (roomBelow >= MIN_ROOM_PX) {
    return { side: "below", viewportOffset: caret.bottom, left, maxHeight: roomBelow };
  }
  const roomAbove = caret.top - EDGE_GAP_PX;
  if (roomAbove >= MIN_ROOM_PX) {
    return {
      side: "above",
      viewportOffset: window.innerHeight - caret.top,
      left,
      maxHeight: roomAbove,
    };
  }
  return null;
};

const close = (then: () => void) => {
  open.value = false;
  then();
};

// Only the editor's text surface keeps the panel open; the AI prompt and buttons in the same box do not.
const onOutside = (event: Event) => {
  const target = event.target as Node | null;
  if (target && panelRef.value?.contains(target)) return;
  if (listRef.value?.ownsNode(target)) return;
  if (target && props.anchor?.contains(target) && isQueryEditorInput(target)) return;
  open.value = false;
};

let placedCaret = "";
let stopObserving: (() => void) | null = null;
let panelSizes: ResizeObserver | null = null;

const caretKey = () => {
  const caret = caretRect();
  const width = panelRef.value?.offsetWidth ?? 0;
  if (!caret) return "";
  return `${caret.left}|${caret.top}|${caret.bottom}|${width}|${window.innerWidth}|${window.innerHeight}`;
};

const reposition = () => {
  if (!open.value) return;
  placement.value = place();
  placedCaret = caretKey();
  if (!placement.value) open.value = false;
};

// Editors rewrite inline styles on every keystroke and paint, so only a real move re-places the panel.
const repositionIfMoved = () => {
  if (open.value && caretKey() !== placedCaret) reposition();
};

const listen = (on: boolean) => {
  const method = on ? "addEventListener" : "removeEventListener";
  document[method]("pointerdown", onOutside, true);
  document[method]("focusin", onOutside, true);
};

// Monaco moves its caret, and scrolls its lines, by rewriting inline styles inside the editor.
const observe = (anchor: HTMLElement | null) => {
  stopObserving?.();
  stopObserving = anchor ? observeMoves(anchor, repositionIfMoved, { subtreeStyles: true }) : null;
};

watch(panelRef, (panel) => {
  panelSizes?.disconnect();
  panelSizes = null;
  if (!panel || typeof ResizeObserver === "undefined") return;
  panelSizes = new ResizeObserver(repositionIfMoved);
  panelSizes.observe(panel);
});

watch(
  open,
  (isOpen) => {
    placement.value = isOpen ? place() : null;
    if (isOpen && !placement.value) {
      open.value = false;
      return;
    }
    placedCaret = isOpen ? caretKey() : "";
    listen(isOpen);
    observe(isOpen ? props.anchor : null);
  },
  { immediate: true },
);

// The anchor arrives with the editor's focus; the open watcher does the first placement.
watch(
  () => props.anchor,
  (anchor) => {
    if (!open.value || !placement.value) return;
    observe(anchor);
    reposition();
  },
);

onBeforeUnmount(() => {
  listen(false);
  observe(null);
  panelSizes?.disconnect();
});

/** Moves focus from the editor into the list; false when there is no row to focus. */
const focusFirst = () => listRef.value?.focusFirst() ?? false;

/** Runs, or with Shift loads, the hovered row while focus is still in the editor. */
const pickActive = (event: KeyboardEvent) => listRef.value?.pickActive(event) ?? false;

/** Pages the active row's details; false when no row is active, so the editor keeps the key. */
const scrollDetails = (step: 1 | -1) => listRef.value?.scrollDetails(step) ?? false;

defineExpose({ focusFirst, pickActive, scrollDetails });
</script>
