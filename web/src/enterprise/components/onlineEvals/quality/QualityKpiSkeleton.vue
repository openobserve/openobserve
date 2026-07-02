<template>
  <div
    class="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] tw:gap-[10px]"
    :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
  >
    <div
      v-for="n in count"
      :key="n"
      class="tw:pt-3 tw:px-3.5 tw:pb-2.5 tw:bg-(--tile-bg) tw:border tw:border-(--tile-border) tw:rounded-md tw:flex tw:flex-col tw:gap-2 tw:min-h-24"
      :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
      data-test="quality-kpi-skeleton"
    >
      <SkeletonBox width="55%" height="11px" rounded />
      <div class="tw:flex tw:items-baseline tw:justify-between tw:gap-2">
        <SkeletonBox width="50%" height="22px" rounded />
        <SkeletonBox width="22%" height="11px" rounded />
      </div>
      <div class="tw:flex tw:items-end tw:gap-[3px] tw:h-[28px] tw:mt-auto">
        <SkeletonBox
          v-for="bar in 14"
          :key="bar"
          width="100%"
          :height="`${30 + ((bar * 23) % 65)}%`"
          rounded
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 5 });

const store = useStore();
</script>

<style>
.dark-tile-content {
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
}

.light-tile-content {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
}

.skeleton-box {
  position: relative;
  overflow: hidden;
  background-size: 200% 100%;
  animation: qkpi-skel-wave 1.5s ease-in-out infinite;
}

.light-tile-content .skeleton-box {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0.04)
  );
}

.dark-tile-content .skeleton-box {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0.04)
  );
}

@keyframes qkpi-skel-wave {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
</style>
