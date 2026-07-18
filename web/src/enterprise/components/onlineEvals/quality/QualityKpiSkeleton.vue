<template>
  <div
    class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5"
  >
    <div
      v-for="n in count"
      :key="n"
      class="pt-3 px-3.5 pb-2.5 bg-surface-base border border-border-default rounded-default flex flex-col gap-2 min-h-24"
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
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

withDefaults(defineProps<{ count?: number }>(), { count: 5 });
</script>
