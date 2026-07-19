<template>
  <!-- Same KpiCardRow grid and the same card padding/background as the real
       QualityKpiCard, so the tiles don't resize or change colour on load. -->
  <KpiCardRow>
    <div
      v-for="n in count"
      :key="n"
      class="px-3.5 py-2.5 bg-card-glass-bg border border-border-default rounded-default flex flex-col gap-2 min-h-24"
      data-test="quality-kpi-skeleton"
    >
      <OSkeleton type="text" class="w-[55%] h-2.75" />
      <div class="flex items-baseline justify-between gap-2">
        <OSkeleton type="text" class="w-[50%] h-5.5" />
        <OSkeleton type="text" class="w-[22%] h-2.75" />
      </div>
      <div class="flex items-end gap-0.75 h-7 mt-auto">
        <OSkeleton type="text" v-for="bar in 14" :key="bar" :style="{ height: `${30 + ((bar * 23) % 65)}%` }" class="w-full" />
      </div>
    </div>
  </KpiCardRow>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 5 });
</script>
