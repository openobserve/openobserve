<template>
  <div
    class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-[10px]"
    :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
  >
    <div
      v-for="n in count"
      :key="n"
      class="pt-3 px-3.5 pb-2.5 bg-(--color-surface-base) border border-(--color-border-default) rounded-lg flex flex-col gap-2 min-h-24"
      :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
      data-test="quality-kpi-skeleton"
    >
      <SkeletonBox width="55%" height="11px" rounded />
      <div class="flex items-baseline justify-between gap-2">
        <SkeletonBox width="50%" height="22px" rounded />
        <SkeletonBox width="22%" height="11px" rounded />
      </div>
      <div class="flex items-end gap-[3px] h-[28px] mt-auto">
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
