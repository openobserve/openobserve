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
      v-if="place"
      ref="paneRef"
      class="bg-select-content-bg border-dropdown-border rounded-default text-select-item-text fixed flex flex-col overflow-hidden border shadow-lg"
      :style="paneStyle"
      data-test="recent-searches-details"
      @pointerenter="onEnter"
      @pointerleave="onLeave"
      @focusout="onFocusOut"
      @keydown="onKeydown"
    >
      <div class="relative flex min-h-0 flex-1 flex-col">
        <pre
          ref="queryRef"
          class="m-0 min-h-0 flex-1 overflow-auto p-2 font-mono text-xs wrap-anywhere whitespace-pre-wrap"
          data-test="recent-searches-details-query"
          @scroll="updateFade"
          >{{ entry.query }}</pre>
        <div
          v-if="moreBelow"
          class="from-select-content-bg pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t to-transparent"
          data-test="recent-searches-details-fade"
        />
      </div>
      <div
        v-if="vrl"
        class="border-border-subtle flex max-h-32 shrink-0 flex-col border-t"
        data-test="recent-searches-details-function"
      >
        <div class="flex shrink-0 items-center gap-2 ps-2 pe-1 pt-1">
          <span class="text-text-secondary text-2xs flex-1 font-semibold uppercase">{{
            t("recentSearches.functionLabel")
          }}</span>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="content-copy"
            :aria-label="t('recentSearches.copyFunction')"
            data-test="recent-searches-details-copy-function"
            @click="copyFunction"
          >
            <OTooltip :content="t('recentSearches.copyFunction')" />
          </OButton>
        </div>
        <pre
          class="m-0 min-h-0 overflow-auto px-2 pb-2 font-mono text-xs wrap-anywhere whitespace-pre-wrap"
          data-test="recent-searches-details-function-text"
          >{{ vrl }}</pre>
      </div>
      <div
        class="bg-select-content-bg border-border-subtle flex shrink-0 flex-col gap-1 border-t px-2 py-1"
        data-test="recent-searches-details-footer"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div
            class="text-text-secondary text-2xs flex min-w-0 flex-1 flex-wrap gap-x-2"
            data-test="recent-searches-details-meta"
          >
            <span data-test="recent-searches-details-lines">{{
              t("recentSearches.lineCount", { count: lineCount }, lineCount)
            }}</span>
            <span v-if="entry.streams.length">{{ entry.streams.join(", ") }}</span>
            <span v-if="windowText(entry)">{{ windowText(entry) }}</span>
            <span>{{ spanText(entry) }}</span>
            <span v-if="entry.status === 'error'" class="text-status-error-text">{{
              t("recentSearches.failed")
            }}</span>
          </div>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="content-copy"
            class="shrink-0"
            :aria-label="t('recentSearches.copyQuery')"
            data-test="recent-searches-details-copy"
            @click="copyQuery"
          >
            <OTooltip :content="t('recentSearches.copyQuery')" />
          </OButton>
        </div>
        <div
          v-if="entry.status === 'error' && entry.context.error"
          class="text-status-error-text text-2xs max-h-16 overflow-auto wrap-anywhere whitespace-pre-wrap"
          data-test="recent-searches-details-error"
        >
          {{ entry.context.error }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useRecentEntryText } from "@/composables/queryHistory/useRecentEntryText";
import type { QueryHistoryEntry } from "@/services/query_history";
import { copyToClipboard } from "@/utils/clipboard";
import { logsEntryFunction } from "@/utils/queryHistory/logs";
import { observeMoves } from "@/utils/queryHistory/observeMoves";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const WIDTH_PX = 400;
const WIDE_WIDTH_PX = 560;
const WIDE_AFTER_LINES = 18;
const MAX_HEIGHT_PX = 320;
const GAP_PX = 4;
const VIEWPORT_GAP_PX = 8;
const Z_INDEX = 10050;
const PAGE_OVERLAP_PX = 16;

const props = defineProps<{
  entry: QueryHistoryEntry;
  anchor: HTMLElement | null;
}>();

const emit = defineEmits<{
  enter: [];
  leave: [event: PointerEvent];
  /** Focus left the pane, for the node it went to. */
  "focus-leave": [to: Node | null];
  /** Shift+Tab out of the pane, back to the row it details. */
  back: [];
  escape: [];
}>();

const { t } = useI18nTyped();
const { windowText, spanText } = useRecentEntryText();
const paneRef = ref<HTMLElement | null>(null);
const queryRef = ref<HTMLElement | null>(null);
const pointerInside = ref(false);

const onEnter = () => {
  pointerInside.value = true;
  emit("enter");
};

const onLeave = (event: PointerEvent) => {
  pointerInside.value = false;
  emit("leave", event);
};

const onFocusOut = (event: FocusEvent) => {
  const to = event.relatedTarget as Node | null;
  if (!paneRef.value?.contains(to)) emit("focus-leave", to);
};

// The pane is teleported after the whole page, so the browser's own Shift+Tab would leave the list.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Tab" && event.shiftKey) {
    event.preventDefault();
    emit("back");
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("escape");
  }
};

const lineCount = computed(() => props.entry.query.split("\n").length);
const vrl = computed(() => logsEntryFunction(props.entry));
const wantedWidth = computed(() => (lineCount.value > WIDE_AFTER_LINES ? WIDE_WIDTH_PX : WIDTH_PX));

interface Place {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  beside: boolean;
}
const place = ref<Place | null>(null);

const paneStyle = computed(() => {
  const at = place.value;
  if (!at) return {};
  return {
    top: `${at.top}px`,
    left: `${at.left}px`,
    width: `${at.width}px`,
    maxHeight: `${at.maxHeight}px`,
    zIndex: Z_INDEX,
  };
});

const compute = (): Place | null => {
  const box = props.anchor?.getBoundingClientRect();
  if (!box) return null;
  const roomRight = window.innerWidth - VIEWPORT_GAP_PX - (box.right + GAP_PX);
  const roomLeft = box.left - GAP_PX - VIEWPORT_GAP_PX;
  const sideTop = Math.max(VIEWPORT_GAP_PX, box.top);
  const sideMaxHeight = Math.min(MAX_HEIGHT_PX, window.innerHeight - 2 * VIEWPORT_GAP_PX);
  if (roomRight >= WIDTH_PX) {
    const width = Math.min(wantedWidth.value, roomRight);
    return {
      top: sideTop,
      left: box.right + GAP_PX,
      width,
      maxHeight: sideMaxHeight,
      beside: true,
    };
  }
  if (roomLeft >= WIDTH_PX) {
    const width = Math.min(wantedWidth.value, roomLeft);
    const left = box.left - GAP_PX - width;
    return { top: sideTop, left, width, maxHeight: sideMaxHeight, beside: true };
  }
  const width = Math.min(wantedWidth.value, window.innerWidth - 2 * VIEWPORT_GAP_PX);
  const left = Math.max(
    VIEWPORT_GAP_PX,
    Math.min(box.left, window.innerWidth - VIEWPORT_GAP_PX - width),
  );
  const top = box.bottom + GAP_PX;
  const maxHeight = Math.min(MAX_HEIGHT_PX, window.innerHeight - top - VIEWPORT_GAP_PX);
  return maxHeight > 0 ? { top, left, width, maxHeight, beside: false } : null;
};

const liftIntoView = () => {
  const at = place.value;
  const height = paneRef.value?.offsetHeight ?? 0;
  if (!at?.beside || !height) return;
  const overflow = at.top + height - (window.innerHeight - VIEWPORT_GAP_PX);
  if (overflow > 0) place.value = { ...at, top: Math.max(VIEWPORT_GAP_PX, at.top - overflow) };
};

const moreBelow = ref(false);
const updateFade = () => {
  const el = queryRef.value;
  moreBelow.value = !!el && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
};

const reposition = () => {
  place.value = compute();
  nextTick(() => {
    liftIntoView();
    updateFade();
  });
};

let placedKey = "";
let stopObserving: (() => void) | null = null;
const anchorKey = () => {
  const box = props.anchor?.getBoundingClientRect();
  if (!box) return "";
  return `${box.left}|${box.top}|${box.right}|${box.bottom}|${window.innerWidth}|${window.innerHeight}`;
};
// The list moves with the caret, the page and the popover; only a real move re-places the pane.
const follow = () => {
  const key = anchorKey();
  if (key === placedKey) return;
  placedKey = key;
  reposition();
};

watch(
  () => props.entry,
  () => {
    if (queryRef.value) queryRef.value.scrollTop = 0;
    reposition();
  },
);

onMounted(() => {
  placedKey = anchorKey();
  reposition();
  if (props.anchor) stopObserving = observeMoves(props.anchor, follow);
});

onBeforeUnmount(() => stopObserving?.());

const copyQuery = () =>
  copyToClipboard(props.entry.query, t, { successMessage: t("recentSearches.queryCopied") });

const copyFunction = () =>
  copyToClipboard(vrl.value, t, { successMessage: t("recentSearches.functionCopied") });

/** Scrolls the query one page down (1) or up (-1); false when there is nothing to scroll. */
const scrollPage = (step: 1 | -1) => {
  const el = queryRef.value;
  if (!el) return false;
  el.scrollTop += step * Math.max(el.clientHeight - PAGE_OVERLAP_PX, PAGE_OVERLAP_PX);
  updateFade();
  return true;
};

/** Whether a node is inside the pane, which lives outside the list's own DOM. */
const contains = (node: Node | null) => !!node && !!paneRef.value?.contains(node);

const hasFocus = () => contains(document.activeElement);

const hasPointer = () => pointerInside.value;

/** Moves keyboard focus to the Copy button; false when the pane is not shown. */
const focusCopy = () => {
  const button = paneRef.value?.querySelector<HTMLElement>(
    '[data-test="recent-searches-details-copy"]',
  );
  if (!button) return false;
  button.focus();
  return true;
};

defineExpose({ scrollPage, contains, hasFocus, hasPointer, focusCopy });
</script>
