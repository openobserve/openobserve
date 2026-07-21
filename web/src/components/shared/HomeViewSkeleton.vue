<template>
  <!-- Mirrors the loaded UsageTab layout 1:1 so nothing shifts when data lands:
       Streams header → KPI tile strip → resources rail + two chart cards. No
       outer card-container (the loaded content has none either). -->
  <div
    class="home-view-skeleton w-full h-full flex flex-col px-page-edge pt-2 pb-1 overflow-hidden"
  >
    <!-- Streams section header -->
    <div data-test="home-view-skeleton-streams-header" class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <OSkeleton class="w-8 h-8" />
        <OSkeleton type="text" class="w-24 h-5" />
      </div>
      <OSkeleton class="w-8 h-8" />
    </div>

    <!-- KPI tile strip (mirrors KpiCardRow / KpiCard) -->
    <div class="grid gap-2.5 mb-4 grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
      <div
        v-for="n in 5"
        :key="`kpi-${n}`"
        data-test="home-view-skeleton-tile"
        class="bg-card-glass-bg rounded-default border border-border-default px-3.5 py-2.5 flex flex-col gap-1"
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <OSkeleton type="text" class="w-20 h-4" />
          <OSkeleton class="w-10 h-10" />
        </div>
        <OSkeleton type="text" class="w-24 h-7" />
      </div>
    </div>

    <!-- Main region: resources rail + two status-chart cards -->
    <div class="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 flex-1 min-h-0">
      <!-- Resources rail -->
      <div
        data-test="home-view-skeleton-rail"
        class="rounded-default p-4 bg-card-glass-bg border border-card-glass-border flex flex-col"
      >
        <OSkeleton type="text" class="w-24 h-4 mb-2" />
        <div v-for="n in 2" :key="`res-${n}`" class="flex items-center gap-2.5 py-2">
          <OSkeleton class="w-8 h-8" />
          <OSkeleton type="text" class="flex-1 h-4" />
          <OSkeleton type="text" class="w-6 h-4" />
        </div>
        <div class="h-px bg-border-default my-3"></div>
        <OSkeleton type="text" class="w-16 h-3.5 mb-2" />
        <div v-for="n in 4" :key="`exp-${n}`" class="flex items-center gap-2.5 py-2">
          <OSkeleton class="w-8 h-8" />
          <OSkeleton type="text" class="flex-1 h-4" />
        </div>
      </div>

      <!-- Alerts + Pipelines chart cards (identical shells) -->
      <div
        v-for="n in 2"
        :key="`chart-${n}`"
        data-test="home-view-skeleton-chart"
        class="rounded-default p-4 bg-card-glass-bg border border-card-glass-border flex flex-col min-h-0"
      >
        <!-- Header -->
        <div class="flex justify-between items-center">
          <span class="flex items-center gap-2">
            <OSkeleton class="w-10 h-10" />
            <OSkeleton type="text" class="w-24 h-5" />
          </span>
          <OSkeleton class="w-8 h-8" />
        </div>
        <!-- Stats row -->
        <div class="flex pt-3 gap-4">
          <div class="flex flex-col gap-1">
            <OSkeleton type="text" class="w-16 h-3.5" />
            <OSkeleton type="text" class="w-8 h-5" />
          </div>
          <OSeparator vertical />
          <div class="flex flex-col gap-1">
            <OSkeleton type="text" class="w-16 h-3.5" />
            <OSkeleton type="text" class="w-8 h-5" />
          </div>
        </div>
        <!-- Chart area -->
        <div class="flex-1 min-h-50 w-full mt-3">
          <!-- custom-radius, not the boolean radius prop, is what actually lands
               lg corners here: OSkeleton type="text" base `rounded-default` beats
               `rounded-default` on Tailwind's alphabetical emit order, while this
               inline binding beats both. -->
          <OSkeleton type="text" custom-radius="var(--radius-surface)" class="w-full h-full" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
</script>
