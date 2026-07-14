<!-- Skeleton placeholder for the KPI strip on the Scorer / Eval Job detail
     drawers. Renders `count` card-shaped tiles (multi-root v-for) so they drop
     straight into the parent's KPI grid as direct children, keeping the same
     columns + gap. Card chrome mirrors SessionDetails.vue's `.kpi-card` so the
     skeleton matches the real cards it stands in for. Shimmer comes from the
     shared SkeletonBox (theme-aware), same approach as LLMInsightsSkeleton. -->
<template>
  <div
    v-for="n in count"
    :key="n"
    class="kpi-card-skeleton rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.5rem]"
    data-test="kpi-cards-skeleton"
  >
    <SkeletonBox width="55%" height="12px" rounded />
    <SkeletonBox width="45%" height="22px" rounded />
  </div>
</template>

<script setup lang="ts">
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>

<style lang="scss" scoped>
// Same chrome as the real `.kpi-card` (SessionDetails.vue) — scoped styles
// don't pierce into child components, so the skeleton carries its own copy.
.kpi-card-skeleton {
  background: var(--color-surface-base);
  border: 1px solid var(--color-border-default);
}
</style>
