<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { fitVisibleCount } from "@/utils/fitVisibleCount";

const props = defineProps<{ items: T[] }>();

defineSlots<{
  default?: (scope: { item: T; index: number }) => unknown;
  more?: (scope: { count: number }) => unknown;
}>();

const MAX_SETTLE_PASSES = 2;

const root = ref<HTMLElement | null>(null);
const moreEl = ref<HTMLElement | null>(null);
const visibleCount = ref(props.items.length);
const hiddenCount = computed(() => Math.max(0, props.items.length - visibleCount.value));

let frame = 0;
// Cached by label because the style write in naturalWidths forces a layout per row, on every drag frame.
let firstItemLabel: string | null = null;
let firstItemWidth = 0;

function naturalWidths(el: HTMLElement): number[] {
  const nodes = Array.from(el.querySelectorAll<HTMLElement>(":scope > [data-fit-item]"));
  const first = nodes[0];
  if (first && first.textContent !== firstItemLabel) {
    // Only the first item can shrink; freeze it so a truncated item still reports its full width.
    first.style.flexShrink = "0";
    firstItemWidth = first.offsetWidth;
    first.style.flexShrink = "";
    firstItemLabel = first.textContent;
  }
  return nodes.map((node, index) => (index === 0 ? firstItemWidth : node.offsetWidth));
}

function measure(pass = 0): void {
  const el = root.value;
  if (!el) return;
  const available = el.clientWidth;
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  // A zero width means no layout yet, and the observer fires again once there is one.
  const next = available
    ? fitVisibleCount(naturalWidths(el), available, gap, moreEl.value?.offsetWidth ?? 0)
    : props.items.length;
  if (next === visibleCount.value) return;
  visibleCount.value = next;
  // The +N only exists after this render, and its digits can change its width.
  if (pass < MAX_SETTLE_PASSES) void nextTick(() => measure(pass + 1));
}

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

// Measuring inside a ResizeObserver callback changes layout mid-delivery, so it waits for the next frame.
function scheduleMeasure(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => measure());
}

onMounted(() => {
  measure();
  if (!root.value) return;
  resizeObserver = new ResizeObserver(scheduleMeasure);
  resizeObserver.observe(root.value);
  // A truncated item keeps its box when its label changes, so only the text itself can signal it.
  mutationObserver = new MutationObserver(scheduleMeasure);
  mutationObserver.observe(root.value, { childList: true, characterData: true, subtree: true });
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
});
</script>

<template>
  <!-- Inline-size containment stops auto-layout tables from growing a column to fit every item. -->
  <div
    ref="root"
    class="relative flex w-full min-w-0 items-center gap-1 overflow-hidden [contain:inline-size]"
    data-test="fit-items"
  >
    <div
      v-for="(item, index) in items"
      :key="index"
      data-fit-item
      class="w-max"
      :class="[
        index >= visibleCount && 'invisible absolute',
        index < visibleCount && (visibleCount > 1 || index > 0) && 'shrink-0',
        index === 0 && 'min-w-0 overflow-hidden',
      ]"
    >
      <slot :item="item" :index="index" />
    </div>
    <div v-if="hiddenCount > 0" ref="moreEl" class="shrink-0" data-test="fit-items-more">
      <slot name="more" :count="hiddenCount" />
    </div>
  </div>
</template>
