<template>
  <!-- Same KpiCardRow grid and the same card padding/background as the real
       QualityKpiCard, so the tiles don't resize or change colour on load. -->
  <KpiCardRow>
    <div
      v-for="n in count"
      :key="n"
      class="bg-card-glass-bg border-border-default rounded-default flex min-h-24 flex-col gap-2 border px-3.5 py-2.5"
      data-test="quality-kpi-skeleton"
    >
      <OSkeleton type="text" class="h-2.75 w-[55%]" />
      <div class="flex items-baseline justify-between gap-2">
        <OSkeleton type="text" class="h-5.5 w-[50%]" />
        <OSkeleton type="text" class="h-2.75 w-[22%]" />
      </div>
      <div class="mt-auto flex h-7 items-end gap-0.75">
        <OSkeleton
          type="text"
          v-for="bar in 14"
          :key="bar"
          :style="{ height: `${30 + ((bar * 23) % 65)}%` }"
          class="w-full"
        />
      </div>
    </div>
  </KpiCardRow>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 5 });
</script>
