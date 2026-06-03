<template>
  <div
    class="qkpi-skel"
    :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
  >
    <div
      v-for="n in count"
      :key="n"
      class="qkpi-skel__tile"
      :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
      data-test="quality-kpi-skeleton"
    >
      <SkeletonBox width="55%" height="11px" rounded />
      <div class="qkpi-skel__row">
        <SkeletonBox width="50%" height="22px" rounded />
        <SkeletonBox width="22%" height="11px" rounded />
      </div>
      <div class="qkpi-skel__spark">
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

<style lang="scss" scoped>
.qkpi-skel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.dark-tile-content {
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
}

.light-tile-content {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
}

.qkpi-skel__tile {
  padding: 12px 14px 10px;
  background: var(--tile-bg);
  border: 1px solid var(--tile-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 96px;
}

.qkpi-skel__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.qkpi-skel__spark {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 28px;
  margin-top: auto;
}

/* Wave overrides — same recipe as LLMInsightsSkeleton.
   The shared SkeletonBox component's default gradient is theme-agnostic; the
   :deep() override pierces its scoped style so it animates correctly. */
:deep(.skeleton-box) {
  position: relative;
  overflow: hidden;
  background-size: 200% 100%;
  animation: qkpi-skel-wave 1.5s ease-in-out infinite;
}

.light-tile-content :deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0.04)
  );
}

.dark-tile-content :deep(.skeleton-box) {
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
