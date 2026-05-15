<!-- Copyright 2026 OpenObserve Inc.
Licensed under AGPL v3. -->

<template>
  <div class="mobile-card-skeleton" :aria-busy="true" aria-live="polite">
    <div
      v-for="n in count"
      :key="n"
      class="mobile-card-skeleton__row"
      :style="{ height: height }"
    >
      <div class="mobile-card-skeleton__stripe" />
      <div class="mobile-card-skeleton__body">
        <SkeletonBox
          class="mobile-card-skeleton__title"
          width="60%"
          height="14px"
          rounded
        />
        <SkeletonBox
          class="mobile-card-skeleton__meta"
          width="40%"
          height="10px"
          rounded
        />
      </div>
      <SkeletonBox
        class="mobile-card-skeleton__action"
        width="24px"
        height="24px"
        circle
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonBox from "./SkeletonBox.vue";

interface Props {
  count?: number;
  height?: string;
}

withDefaults(defineProps<Props>(), {
  count: 4,
  height: "68px",
});
</script>

<style scoped lang="scss">
.mobile-card-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;

  &__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 12px 18px;
    border-radius: 10px;
    background: var(--o2-card-bg, rgba(128, 128, 128, 0.06));
    overflow: hidden;
  }

  &__stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--o2-border-subtle, rgba(128, 128, 128, 0.25));
    border-top-left-radius: 10px;
    border-bottom-left-radius: 10px;
  }

  &__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__action {
    flex: 0 0 auto;
  }
}
</style>
