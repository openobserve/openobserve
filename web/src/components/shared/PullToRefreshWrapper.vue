<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <div ref="containerRef" class="ptr-wrapper">
    <div
      class="ptr-indicator"
      :class="{ 'ptr-indicator--refreshing': isRefreshing }"
      :style="indicatorStyle"
      aria-hidden="true"
    >
      <q-spinner
        v-if="isRefreshing"
        color="primary"
        size="22px"
      />
      <q-icon
        v-else
        name="arrow_downward"
        size="22px"
        :style="{ transform: `rotate(${arrowRotation}deg)` }"
      />
    </div>
    <div class="ptr-content" :style="contentStyle">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from "vue";
import { usePullToRefresh } from "@/composables/usePullToRefresh";

export default defineComponent({
  name: "PullToRefreshWrapper",
  props: {
    threshold: {
      type: Number,
      default: 70,
    },
  },
  emits: ["refresh"],
  setup(props, { emit }) {
    const containerRef = ref<HTMLElement | null>(null);
    let resolveRefresh: ((v?: unknown) => void) | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      resolveRefresh?.();
      resolveRefresh = null;
    };

    const onRefresh = () =>
      new Promise((resolve) => {
        // Defensive: usePullToRefresh already guards against re-entry while
        // isRefreshing is true, but if a caller invokes onRefresh directly
        // we don't want to abandon a prior, unresolved promise.
        settle();
        resolveRefresh = resolve;
        emit("refresh", settle);
        // Fallback: auto-resolve after 8s so the spinner never sticks forever
        // if the parent forgets to call the ack callback.
        fallbackTimer = setTimeout(settle, 8000);
      });

    onBeforeUnmount(settle);

    const { pullDistance, isRefreshing, threshold } = usePullToRefresh(
      containerRef,
      { threshold: props.threshold, onRefresh },
    );

    const arrowRotation = computed(() =>
      pullDistance.value >= threshold ? 180 : 0,
    );

    const indicatorStyle = computed(() => {
      if (isRefreshing.value) {
        return { opacity: 1, transform: "translateY(20px)" };
      }
      const opacity = Math.min(pullDistance.value / threshold, 1);
      return {
        opacity,
        transform: `translateY(${pullDistance.value - 30}px)`,
      };
    });

    const contentStyle = computed(() => {
      if (isRefreshing.value) {
        return { transform: "translateY(40px)", transition: "transform 200ms ease" };
      }
      if (pullDistance.value === 0) {
        return { transform: "translateY(0)", transition: "transform 200ms ease" };
      }
      return { transform: `translateY(${pullDistance.value}px)` };
    });

    return {
      containerRef,
      isRefreshing,
      arrowRotation,
      indicatorStyle,
      contentStyle,
    };
  },
});
</script>

<style scoped lang="scss">
.ptr-wrapper {
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  height: 100%;
  overscroll-behavior-y: contain;
}

.ptr-indicator {
  position: absolute;
  top: 0;
  left: 50%;
  margin-left: -20px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--o2-card-bg, #ffffff);
  border: 1px solid var(--o2-border-color, #e0e0e0);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  z-index: 2;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;

  &--refreshing {
    transition:
      opacity 200ms ease,
      transform 200ms ease;
  }
}

.ptr-content {
  min-height: 100%;
  will-change: transform;
}
</style>
