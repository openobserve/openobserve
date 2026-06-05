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

<script setup lang="ts" generic="T">
import { computed, ref, watch } from "vue";
import { useVirtualScroll } from "./useVirtualScroll";
import type {
  OVirtualScrollProps,
  OVirtualScrollEmits,
  OVirtualScrollSlots,
} from "./OVirtualScroll.types";

const props = withDefaults(defineProps<OVirtualScrollProps<T>>(), {
  estimateSize: 40,
  overscan: 5,
  scrollTarget: null,
  height: "100%",
  dynamicRowHeight: false
});

const emit = defineEmits<OVirtualScrollEmits>();
defineSlots<OVirtualScrollSlots<T>>();

// Ref to the component's own scroll container.
// When scrollTarget is provided this element is NOT the scroll driver —
// it still acts as the positioning parent for absolutely placed items.
const parentRef = ref<HTMLElement | null>(null);

// Wrap the scrollTarget prop in a ref so useVirtualScroll can watch it.
const scrollTargetRef = computed(() => props.scrollTarget ?? null);

const itemsRef = computed(() => props.items);

const dynamicRowHeightRef = computed(() => props.dynamicRowHeight);

const { virtualItems, totalSize, scrollMargin, visibleRange, scrollToIndex, scrollToTop, measure, measureElement } =
  useVirtualScroll({
    items: itemsRef,
    parentRef,
    scrollTarget: scrollTargetRef,
    estimateSize: props.estimateSize,
    overscan: props.overscan,
    dynamicRowHeight: dynamicRowHeightRef,
  });

// Emit virtual-scroll event on mount and whenever the rendered range changes.
watch(virtualItems, (items) => {
  if (!items.length) return;
  const range = visibleRange.value;
  emit("virtual-scroll", {
    startIndex: items[0].index,
    endIndex: items[items.length - 1].index,
    visibleStartIndex: range?.startIndex ?? items[0].index,
    visibleEndIndex: range?.endIndex ?? items[items.length - 1].index,
  });
}, { immediate: true });

// Whether we own the scroll container (no external scrollTarget).
const ownsScroll = computed(() => !props.scrollTarget);

// CSS for the outer container
const containerStyle = computed(() => {
  if (!ownsScroll.value) {
    // External element scrolls — our container is just a positioning parent.
    return { position: "relative" as const };
  }
  return {
    overflowY: "auto" as const,
    position: "relative" as const,
    height: props.height,
  };
});


// Expose scroll helpers for parent components.
defineExpose({
  scrollToIndex,
  scrollToTop,
  measure,
  ...(props.dynamicRowHeight ? { measureElement } : {}),
});
</script>

<template>
  <div
    ref="parentRef"
    class="o2-virtual-scroll"
    data-test="o2-virtual-scroll"
    :style="containerStyle"
  >
    <!-- Spacer div that gives the scroll container the full virtual height.
         Subtract scrollMargin so the spacer covers only the items themselves —
         the header/histogram above this container already occupies that space. -->
    <div
      class="o2-virtual-scroll__content"
      :style="{ height: `${totalSize - scrollMargin}px`, position: 'relative' }"
    >
      <!-- One wrapper per visible virtual item — absolutely positioned.
           vItem.start is relative to the scroll container top (includes scrollMargin),
           so subtract scrollMargin to get the offset relative to this spacer. -->
      <div
        v-for="vItem in virtualItems"
        :key="String(vItem.key)"
        :data-virtual-index="vItem.index"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${vItem.start - scrollMargin}px)`,
        }"
        :ref="(node) => dynamicRowHeight && vItem && measureElement(node)"
      >
        <slot :item="(items[vItem.index] as T)" :index="vItem.index" />
      </div>
    </div>
  </div>
</template>
