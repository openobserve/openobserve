<template>
  <div
    class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5"
  >
    <div
      v-for="n in count"
      :key="n"
      class="pt-3 px-3.5 pb-2.5 bg-surface-base border border-border-default rounded-lg flex flex-col gap-2 min-h-24"
      data-test="quality-kpi-skeleton"
    >
      <SkeletonBox width="55%" height="11px" rounded-sm />
      <div class="flex items-baseline justify-between gap-2">
        <SkeletonBox width="50%" height="22px" rounded-sm />
        <SkeletonBox width="22%" height="11px" rounded-sm />
      </div>
      <div class="flex items-end gap-[3px] h-7 mt-auto">
        <SkeletonBox
          v-for="bar in 14"
          :key="bar"
          width="100%"
          :height="`${30 + ((bar * 23) % 65)}%`"
          rounded-sm
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 5 });
</script>

<style>
/* keep(keyframes): the shimmer @keyframes cannot be a utility. `.skeleton-box`
   is SkeletonBox.vue's shared class (cross-file) — this global override drives
   the wave gradient + animation on that child element, so the block must stay
   unscoped (a scope id would never reach the child, and scoping renames the
   keyframe). */
.skeleton-box {
  position: relative;
  overflow: hidden;
  background-size: 200% 100%;
  background: linear-gradient(
    90deg,
    var(--color-skeleton-base),
    var(--color-skeleton-highlight),
    var(--color-skeleton-base)
  );
  animation: qkpi-skel-wave 1.5s ease-in-out infinite;
}

@keyframes qkpi-skel-wave {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
</style>
