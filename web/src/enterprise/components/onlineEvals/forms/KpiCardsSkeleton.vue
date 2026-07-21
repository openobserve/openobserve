<!-- Skeleton placeholder for the KPI strip on the Scorer / Eval Job detail
     drawers. Renders `count` card-shaped tiles (multi-root v-for) so they drop
     straight into the parent's KPI grid as direct children, keeping the same
     columns + gap. Card chrome mirrors SessionDetails.vue's `.kpi-card` so the
     skeleton matches the real cards it stands in for. Shimmer comes from
     OSkeleton (theme-aware), the single skeleton primitive. -->
<template>
  <div
    v-for="n in count"
    :key="n"
    class="kpi-card-skeleton rounded-default flex flex-col px-3.5 pt-2.5 pb-2.5 gap-2 bg-surface-base border border-border-default"
    data-test="kpi-cards-skeleton"
  >
    <OSkeleton type="text" class="w-[55%] h-3" />
    <OSkeleton type="text" class="w-[45%] h-5.5" />
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 4 });
</script>
