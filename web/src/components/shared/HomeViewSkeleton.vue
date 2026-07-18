<template>
  <!-- No card-container: the loaded UsageTab content has no outer border, so the
       skeleton must not add one (otherwise a top/outer border flashes only while
       loading and disappears once data arrives). -->
  <div
    class="home-view-skeleton w-full px-[0.625rem] py-[0.625rem] flex flex-col h-[calc(100vh-3.25rem)]"
  >
    <!-- 1st section - Streams container -->
    <div
      data-test="home-view-skeleton-streams-container"
      class="feature-card bg-surface-base border border-card-glass-border rounded-lg p-4"
    >
      <!-- Header -->
      <div data-test="home-view-skeleton-streams-header" class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-2">
          <OSkeleton type="circle" class="w-10" />
          <OSkeleton type="text" class="w-25" />
        </div>
        <OSkeleton class="w-10 h-10" />
      </div>

      <!-- Tiles using same grid as HomeView -->
      <div class="tiles-grid grid gap-4 grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        <div v-for="n in 5" :key="n" data-test="home-view-skeleton-tile" class="rounded-md border border-card-glass-border">
          <div
            class="tile-content h-full p-4 gap-2 rounded-sm text-center flex flex-col justify-between bg-surface-base border border-border-default text-text-body"
          >
            <!-- Top Section (60%) -->
            <div class="flex flex-col justify-between">
              <!-- Title row -->
              <div class="flex justify-between">
                <OSkeleton type="text" class="w-25 h-5" />
                <OSkeleton type="circle" class="w-10" />
              </div>
            </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display flex items-end text-3xl font-semibold leading-8">
              <OSkeleton type="text" class="w-20 h-8" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2nd section - functions and dashboards tiles + 2 charts -->
    <div class="charts-main-container grid grid-cols-1 grid-rows-[auto_auto_auto] xl:grid-cols-[minmax(min-content,max-content)_1fr_2fr] xl:grid-rows-none gap-4 mt-4 items-stretch">
      <!-- Functions and Dashboards column -->
      <div class="functions-dashboards-column flex flex-col md:flex-row xl:flex-col gap-4 w-full">
        <!-- Functions tile -->
        <div class="tile-wrapper flex-1 flex min-w-0 w-full">
          <div
            class="feature-card bg-surface-base border border-border-default p-4 w-full rounded-sm text-center flex flex-col justify-between text-text-body"
          >
            <div class="flex flex-col justify-between">
              <div
                class="flex items-center gap-2 flex-nowrap w-full"
              >
                <OSkeleton type="circle" class="w-10" />
                <OSkeleton type="text" class="w-25 h-5" />
                <OSkeleton class="w-10 h-10" />
              </div>
            </div>
            <div class="data-to-display flex items-end text-3xl font-semibold leading-8">
              <OSkeleton type="text" class="w-15 h-8" />
            </div>
          </div>
        </div>

        <!-- Dashboards tile -->
        <div class="tile-wrapper flex-1 flex min-w-0 w-full">
          <div
            class="feature-card bg-surface-base border border-border-default p-4 w-full rounded-sm text-center flex flex-col justify-between text-text-body"
          >
            <div class="flex flex-col justify-between">
              <div
                class="flex items-center gap-2 flex-nowrap w-full"
              >
                <OSkeleton type="circle" class="w-10" />
                <OSkeleton type="text" class="w-25 h-5" />
                <OSkeleton class="w-10 h-10" />
              </div>
            </div>
            <div class="data-to-display flex items-end text-3xl font-semibold leading-8">
              <OSkeleton type="text" class="w-15 h-8" />
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts Chart -->
      <div
        class="feature-card first-chart-container bg-surface-base border border-border-default rounded-sm p-4"
      >
        <div class="details-container flex flex-col gap-3 mb-4">
          <!-- Header -->
          <div class="flex justify-between items-center">
            <span class="text-title flex items-center gap-2 text-lg font-medium leading-5">
              <OSkeleton type="circle" class="w-10" />
              <OSkeleton type="text" class="w-30 h-5" />
            </span>
            <OSkeleton class="w-10 h-10" />
          </div>
          <!-- Stats row -->
          <div class="flex pt-2 gap-4">
            <div class="flex flex-col">
              <OSkeleton type="text" class="w-25 h-3.5 mb-1" />
              <OSkeleton type="text" class="w-10 h-5" />
            </div>
            <OSeparator vertical />
            <div class="flex flex-col">
              <OSkeleton type="text" class="w-20 h-3.5 mb-1" />
              <OSkeleton type="text" class="w-10 h-5" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-first-chart my-auto xl:min-h-50 h-[calc(100vh-500px)] md:h-[calc(100vh-500px)] lg:h-[calc(100vh-550px)] xl:h-[calc(100vh-645px)] w-full"
        >
          <!-- custom-radius, not the boolean radius prop, is what actually lands
               lg corners here: OSkeleton type="text" base `rounded-sm` beats
               `rounded-lg` on Tailwind's alphabetical emit order, while this
               inline binding beats both. -->
          <OSkeleton type="text" custom-radius="var(--radius-lg)" class="w-full h-full" />
        </div>
      </div>

      <!-- Pipelines Chart -->
      <div
        class="feature-card second-chart-container bg-surface-base border border-border-default rounded-sm p-4"
      >
        <div class="details-container flex flex-col gap-3 mb-4">
          <!-- Header -->
          <div class="flex justify-between items-center">
            <span class="text-title flex items-center gap-2 text-lg font-medium leading-5">
              <OSkeleton type="circle" class="w-10" />
              <OSkeleton type="text" class="w-35 h-5" />
            </span>
            <OSkeleton class="w-10 h-10" />
          </div>
          <!-- Stats row -->
          <div class="flex pt-2 gap-4">
            <div class="flex flex-col">
              <OSkeleton type="text" class="w-30 h-3.5 mb-1" />
              <OSkeleton type="text" class="w-10 h-5" />
            </div>
            <OSeparator vertical />
            <div class="flex flex-col">
              <OSkeleton type="text" class="w-25 h-3.5 mb-1" />
              <OSkeleton type="text" class="w-10 h-5" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-second-chart my-auto xl:min-h-50 h-[calc(100vh-500px)] md:h-[calc(100vh-500px)] lg:h-[calc(100vh-550px)] xl:h-[calc(100vh-645px)]"
        >
          <!-- custom-radius, not the boolean radius prop, is what actually lands
               lg corners here: OSkeleton type="text" base `rounded-sm` beats
               `rounded-lg` on Tailwind's alphabetical emit order, while this
               inline binding beats both. -->
          <OSkeleton type="text" custom-radius="var(--radius-lg)" class="w-full h-full" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
</script>
