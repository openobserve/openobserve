<template>
  <!-- Mirrors the loaded UsageTab layout 1:1 so nothing shifts when data lands:
       Streams header → KPI tile strip → resources rail + two chart cards. No
       outer card-container (the loaded content has none either). -->
  <div
    class="home-view-skeleton px-page-edge flex h-full w-full flex-col overflow-hidden pt-2 pb-1"
  >
    <!-- Streams section header -->
    <div
      data-test="home-view-skeleton-streams-header"
      class="mb-2 flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <OSkeleton class="h-8 w-8" />
        <OSkeleton type="text" class="h-5 w-24" />
      </div>
      <OSkeleton class="h-8 w-8" />
    </div>

    <!-- KPI tile strip (mirrors KpiCardRow / KpiCard) -->
    <div class="mb-4 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2.5">
      <div
        v-for="n in 5"
        :key="`kpi-${n}`"
        data-test="home-view-skeleton-tile"
        class="bg-card-glass-bg rounded-default border-border-default flex flex-col gap-1 border px-3.5 py-2.5"
      >
        <div class="mb-1 flex items-center justify-between gap-2">
          <OSkeleton type="text" class="h-4 w-20" />
          <OSkeleton class="h-10 w-10" />
        </div>
        <OSkeleton type="text" class="h-7 w-24" />
      </div>
    </div>

    <!-- Main region: resources rail + two status-chart cards -->
    <div
      class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <!-- Resources rail -->
      <div
        data-test="home-view-skeleton-rail"
        class="rounded-default bg-card-glass-bg border-card-glass-border flex flex-col border p-4"
      >
        <OSkeleton type="text" class="mb-2 h-4 w-24" />
        <div v-for="n in 2" :key="`res-${n}`" class="flex items-center gap-2.5 py-2">
          <OSkeleton class="h-8 w-8" />
          <OSkeleton type="text" class="h-4 flex-1" />
          <OSkeleton type="text" class="h-4 w-6" />
        </div>
        <div class="bg-border-default my-3 h-px"></div>
        <OSkeleton type="text" class="mb-2 h-3.5 w-16" />
        <div v-for="n in 4" :key="`exp-${n}`" class="flex items-center gap-2.5 py-2">
          <OSkeleton class="h-8 w-8" />
          <OSkeleton type="text" class="h-4 flex-1" />
        </div>
      </div>

      <!-- Alerts + Pipelines chart cards (identical shells) -->
      <div
        v-for="n in 2"
        :key="`chart-${n}`"
        data-test="home-view-skeleton-chart"
        class="rounded-default bg-card-glass-bg border-card-glass-border flex min-h-0 flex-col border p-4"
      >
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-2">
            <OSkeleton class="h-10 w-10" />
            <OSkeleton type="text" class="h-5 w-24" />
          </span>
          <OSkeleton class="h-8 w-8" />
        </div>
        <!-- Stats row -->
        <div class="flex gap-4 pt-3">
          <div class="flex flex-col gap-1">
            <OSkeleton type="text" class="h-3.5 w-16" />
            <OSkeleton type="text" class="h-5 w-8" />
          </div>
          <OSeparator vertical />
          <div class="flex flex-col gap-1">
            <OSkeleton type="text" class="h-3.5 w-16" />
            <OSkeleton type="text" class="h-5 w-8" />
          </div>
        </div>
        <!-- Chart area -->
        <div class="mt-3 min-h-50 w-full flex-1">
          <!-- custom-radius, not the boolean radius prop, is what actually lands
               lg corners here: OSkeleton type="text" base `rounded-default` beats
               `rounded-default` on Tailwind's alphabetical emit order, while this
               inline binding beats both. -->
          <OSkeleton type="text" custom-radius="var(--radius-surface)" class="h-full w-full" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
</script>
