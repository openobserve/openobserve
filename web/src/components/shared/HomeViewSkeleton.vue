<template>
  <!-- No card-container: the loaded UsageTab content has no outer border, so the
       skeleton must not add one (otherwise a top/outer border flashes only while
       loading and disappears once data arrives). -->
  <div
    class="home-view-skeleton w-full px-[0.625rem] py-[0.625rem]"
    style="display: flex; flex-direction: column; height: calc(100vh - 52px)"
  >
    <!-- 1st section - Streams container -->
    <div
      data-test="home-view-skeleton-streams-container"
      class="feature-card bg-(--tile-bg) border-[0.0625rem] border-(--o2-border-color) rounded-lg p-4"
    >
      <!-- Header -->
      <div data-test="home-view-skeleton-streams-header" class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-2">
          <SkeletonBox variant="avatar" width="40px" height="40px" />
          <SkeletonBox variant="title" width="100px" />
        </div>
        <SkeletonBox variant="button" width="40px" height="40px" />
      </div>

      <!-- Tiles using same grid as HomeView -->
      <div class="tiles-grid grid gap-4" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
        <div v-for="n in 5" :key="n" data-test="home-view-skeleton-tile" class="rounded-[0.325rem] border-[0.0625rem] border-(--o2-border-color)">
          <div
            class="tile-content h-full p-4 rounded-lg gap-2 rounded text-center flex flex-col justify-between bg-(--tile-bg) border border-(--tile-border) text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? '[--tile-bg:#2b2c2d] [--tile-border:#444444] [--text-primary:#cccfd1]'
                : '[--tile-bg:#ffffff] [--tile-border:#e7eaee] [--text-primary:#2e3133]'
            "
          >
            <!-- Top Section (60%) -->
            <div class="flex flex-col justify-between">
              <!-- Title row -->
              <div class="flex justify-between">
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="avatar" width="40px" height="40px" />
              </div>
            </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display flex items-end text-[28px] font-semibold leading-8">
              <SkeletonBox variant="title" width="80px" height="32px" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2nd section - functions and dashboards tiles + 2 charts -->
    <div class="charts-main-container grid gap-4 mt-4 items-stretch" style="grid-template-columns: minmax(min-content, max-content) 1fr 2fr">
      <!-- Functions and Dashboards column -->
      <div class="functions-dashboards-column flex flex-col gap-4 w-full">
        <!-- Functions tile -->
        <div class="tile-wrapper flex-1 flex min-w-0 w-full">
          <div
            class="feature-card bg-(--tile-bg) border-[0.0625rem] border-(--tile-border) rounded-lg p-4 w-full rounded text-center flex flex-col justify-between text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? '[--tile-bg:#2b2c2d] [--tile-border:#444444] [--text-primary:#cccfd1]'
                : '[--tile-bg:#ffffff] [--tile-border:#e7eaee] [--text-primary:#2e3133]'
            "
          >
            <div class="flex flex-col justify-between">
              <div
                class="flex items-center gap-2 flex-nowrap w-full"
              >
                <SkeletonBox variant="avatar" width="40px" height="40px" />
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="button" width="40px" height="40px" />
              </div>
            </div>
            <div class="data-to-display flex items-end text-[28px] font-semibold leading-8">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>

        <!-- Dashboards tile -->
        <div class="tile-wrapper flex-1 flex min-w-0 w-full">
          <div
            class="feature-card bg-(--tile-bg) border-[0.0625rem] border-(--tile-border) rounded-lg p-4 w-full rounded text-center flex flex-col justify-between text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? '[--tile-bg:#2b2c2d] [--tile-border:#444444] [--text-primary:#cccfd1]'
                : '[--tile-bg:#ffffff] [--tile-border:#e7eaee] [--text-primary:#2e3133]'
            "
          >
            <div class="flex flex-col justify-between">
              <div
                class="flex items-center gap-2 flex-nowrap w-full"
              >
                <SkeletonBox variant="avatar" width="40px" height="40px" />
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="button" width="40px" height="40px" />
              </div>
            </div>
            <div class="data-to-display flex items-end text-[28px] font-semibold leading-8">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts Chart -->
      <div
        class="feature-card first-chart-container bg-(--tile-bg) border-[0.0625rem] border-(--tile-border) rounded-lg rounded p-4"
        :class="
          store.state.theme === 'dark'
            ? '[--tile-bg:#2b2c2d] [--tile-border:#444444]'
            : '[--tile-bg:#ffffff] [--tile-border:#e7eaee]'
        "
      >
        <div class="details-container flex flex-col gap-3 mb-4">
          <!-- Header -->
          <div class="flex justify-between items-center">
            <span class="text-title flex items-center gap-2 text-lg font-medium leading-5">
              <SkeletonBox variant="avatar" width="40px" height="40px" />
              <SkeletonBox variant="text" width="120px" height="20px" />
            </span>
            <SkeletonBox variant="button" width="40px" height="40px" />
          </div>
          <!-- Stats row -->
          <div class="flex pt-2" style="gap: 16px">
            <div class="flex flex-col">
              <SkeletonBox
                variant="text"
                width="100px"
                height="14px"
                class="mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
            <OSeparator vertical />
            <div class="flex flex-col">
              <SkeletonBox
                variant="text"
                width="80px"
                height="14px"
                class="mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-first-chart my-auto xl:min-h-[200px] h-[calc(100vh-500px)] md:h-[calc(100vh-500px)] lg:h-[calc(100vh-550px)] xl:h-[calc(100vh-645px)] w-full"
        >
          <div
            class="skeleton-box bg-[var(--color-skeleton-base,#f5f5f5)] relative overflow-hidden rounded-lg"
            style="width: 100%; height: 100%"
          ></div>
        </div>
      </div>

      <!-- Pipelines Chart -->
      <div
        class="feature-card second-chart-container bg-(--tile-bg) border-[0.0625rem] border-(--tile-border) rounded-lg rounded p-4"
        :class="
          store.state.theme === 'dark'
            ? '[--tile-bg:#2b2c2d] [--tile-border:#444444]'
            : '[--tile-bg:#ffffff] [--tile-border:#e7eaee]'
        "
      >
        <div class="details-container flex flex-col gap-3 mb-4">
          <!-- Header -->
          <div class="flex justify-between items-center">
            <span class="text-title flex items-center gap-2 text-lg font-medium leading-5">
              <SkeletonBox variant="avatar" width="40px" height="40px" />
              <SkeletonBox variant="text" width="140px" height="20px" />
            </span>
            <SkeletonBox variant="button" width="40px" height="40px" />
          </div>
          <!-- Stats row -->
          <div class="flex pt-2" style="gap: 16px">
            <div class="flex flex-col">
              <SkeletonBox
                variant="text"
                width="120px"
                height="14px"
                class="mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
            <OSeparator vertical />
            <div class="flex flex-col">
              <SkeletonBox
                variant="text"
                width="100px"
                height="14px"
                class="mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-second-chart my-auto xl:min-h-[200px] h-[calc(100vh-500px)] md:h-[calc(100vh-500px)] lg:h-[calc(100vh-550px)] xl:h-[calc(100vh-645px)]"
        >
          <div
            class="skeleton-box bg-[var(--color-skeleton-base,#f5f5f5)] relative overflow-hidden rounded-lg"
            style="width: 100%; height: 100%"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import SkeletonBox from "./SkeletonBox.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const store = useStore();
</script>

<style>
/* Responsive overrides for charts-main-container */
@media (max-width: 1280px) {
  .charts-main-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
}

/* Responsive overrides for functions-dashboards-column */
@media (max-width: 1280px) {
  .functions-dashboards-column {
    flex-direction: row;
  }
}

@media (max-width: 768px) {
  .functions-dashboards-column {
    flex-direction: column;
  }
}

/* Skeleton base/shimmer theming for the child SkeletonBox component.
   The base ::after overlay + keyframes live in SkeletonBox.vue; these only
   override the surface colour + dim the shimmer per theme, scoped to this
   component so they don't leak to other SkeletonBox usages. The explicit
   colours guard against this legacy view loading before the token root. */
.home-view-skeleton .skeleton-box {
  background-color: #f5f5f5;
}

.dark .home-view-skeleton .skeleton-box {
  background-color: #262626;
}

.dark .home-view-skeleton .skeleton-box::after {
  background: linear-gradient(
    90deg,
    transparent                   0%,
    transparent                  30%,
    rgba(255, 255, 255, 0.07)    50%,
    transparent                  70%,
    transparent                 100%
  );
}
</style>
