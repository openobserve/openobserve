<template>
  <!-- No card-container: the loaded UsageTab content has no outer border, so the
       skeleton must not add one (otherwise a top/outer border flashes only while
       loading and disappears once data arrives). -->
  <div
    class="home-view-skeleton tw:w-full tw:px-[0.625rem] tw:py-[0.625rem]"
    style="display: flex; flex-direction: column; height: calc(100vh - 52px)"
  >
    <!-- 1st section - Streams container -->
    <div
      data-test="home-view-skeleton-streams-container"
      class="feature-card tw:bg-(--tile-bg) tw:border-[0.0625rem] tw:border-(--o2-border-color) tw:rounded-lg tw:p-4"
    >
      <!-- Header -->
      <div data-test="home-view-skeleton-streams-header" class="tw:flex tw:justify-between tw:items-center tw:mb-4">
        <div class="tw:flex tw:items-center tw:gap-2">
          <SkeletonBox variant="avatar" width="40px" height="40px" />
          <SkeletonBox variant="title" width="100px" />
        </div>
        <SkeletonBox variant="button" width="40px" height="40px" />
      </div>

      <!-- Tiles using same grid as HomeView -->
      <div class="tiles-grid tw:grid tw:gap-4" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
        <div v-for="n in 5" :key="n" data-test="home-view-skeleton-tile" class="tw:rounded-[0.325rem] tw:border-[0.0625rem] tw:border-(--o2-border-color)">
          <div
            class="tile-content tw:h-full tw:p-4 tw:rounded-lg tw:gap-2 tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between tw:bg-(--tile-bg) tw:border tw:border-(--tile-border) tw:text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? 'tw:[--tile-bg:#2b2c2d] tw:[--tile-border:#444444] tw:[--text-primary:#cccfd1]'
                : 'tw:[--tile-bg:#ffffff] tw:[--tile-border:#e7eaee] tw:[--text-primary:#2e3133]'
            "
          >
            <!-- Top Section (60%) -->
            <div class="tw:flex tw:flex-col tw:justify-between">
              <!-- Title row -->
              <div class="tw:flex tw:justify-between">
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="avatar" width="40px" height="40px" />
              </div>
            </div>

            <!-- Bottom Section (40%) -->
            <div class="data-to-display tw:flex tw:items-end tw:text-[28px] tw:font-semibold tw:leading-8">
              <SkeletonBox variant="title" width="80px" height="32px" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2nd section - functions and dashboards tiles + 2 charts -->
    <div class="charts-main-container tw:grid tw:gap-4 tw:mt-4 tw:items-stretch" style="grid-template-columns: minmax(min-content, max-content) 1fr 2fr">
      <!-- Functions and Dashboards column -->
      <div class="functions-dashboards-column tw:flex tw:flex-col tw:gap-4 tw:w-full">
        <!-- Functions tile -->
        <div class="tile-wrapper tw:flex-1 tw:flex tw:min-w-0 tw:w-full">
          <div
            class="feature-card tw:bg-(--tile-bg) tw:border-[0.0625rem] tw:border-(--tile-border) tw:rounded-lg tw:p-4 tw:w-full tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between tw:text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? 'tw:[--tile-bg:#2b2c2d] tw:[--tile-border:#444444] tw:[--text-primary:#cccfd1]'
                : 'tw:[--tile-bg:#ffffff] tw:[--tile-border:#e7eaee] tw:[--text-primary:#2e3133]'
            "
          >
            <div class="tw:flex tw:flex-col tw:justify-between">
              <div
                class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap tw:w-full"
              >
                <SkeletonBox variant="avatar" width="40px" height="40px" />
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="button" width="40px" height="40px" />
              </div>
            </div>
            <div class="data-to-display tw:flex tw:items-end tw:text-[28px] tw:font-semibold tw:leading-8">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>

        <!-- Dashboards tile -->
        <div class="tile-wrapper tw:flex-1 tw:flex tw:min-w-0 tw:w-full">
          <div
            class="feature-card tw:bg-(--tile-bg) tw:border-[0.0625rem] tw:border-(--tile-border) tw:rounded-lg tw:p-4 tw:w-full tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between tw:text-(--text-primary)"
            :class="
              store.state.theme === 'dark'
                ? 'tw:[--tile-bg:#2b2c2d] tw:[--tile-border:#444444] tw:[--text-primary:#cccfd1]'
                : 'tw:[--tile-bg:#ffffff] tw:[--tile-border:#e7eaee] tw:[--text-primary:#2e3133]'
            "
          >
            <div class="tw:flex tw:flex-col tw:justify-between">
              <div
                class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap tw:w-full"
              >
                <SkeletonBox variant="avatar" width="40px" height="40px" />
                <SkeletonBox variant="text" width="100px" height="20px" />
                <SkeletonBox variant="button" width="40px" height="40px" />
              </div>
            </div>
            <div class="data-to-display tw:flex tw:items-end tw:text-[28px] tw:font-semibold tw:leading-8">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts Chart -->
      <div
        class="feature-card first-chart-container tw:bg-(--tile-bg) tw:border-[0.0625rem] tw:border-(--tile-border) tw:rounded-lg tw:rounded tw:p-4"
        :class="
          store.state.theme === 'dark'
            ? 'tw:[--tile-bg:#2b2c2d] tw:[--tile-border:#444444]'
            : 'tw:[--tile-bg:#ffffff] tw:[--tile-border:#e7eaee]'
        "
      >
        <div class="details-container tw:flex tw:flex-col tw:gap-3 tw:mb-4">
          <!-- Header -->
          <div class="tw:flex tw:justify-between tw:items-center">
            <span class="text-title tw:flex tw:items-center tw:gap-2 tw:text-lg tw:font-medium tw:leading-5">
              <SkeletonBox variant="avatar" width="40px" height="40px" />
              <SkeletonBox variant="text" width="120px" height="20px" />
            </span>
            <SkeletonBox variant="button" width="40px" height="40px" />
          </div>
          <!-- Stats row -->
          <div class="tw:flex tw:pt-2" style="gap: 16px">
            <div class="tw:flex tw:flex-col">
              <SkeletonBox
                variant="text"
                width="100px"
                height="14px"
                class="tw:mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
            <OSeparator vertical />
            <div class="tw:flex tw:flex-col">
              <SkeletonBox
                variant="text"
                width="80px"
                height="14px"
                class="tw:mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-first-chart tw:my-auto tw:xl:min-h-[200px] tw:h-[calc(100vh-500px)] tw:md:h-[calc(100vh-500px)] tw:lg:h-[calc(100vh-550px)] tw:xl:h-[calc(100vh-645px)] tw:w-full"
        >
          <div
            class="skeleton-box tw:bg-[var(--color-skeleton-base,#f5f5f5)] tw:relative tw:overflow-hidden tw:rounded-lg"
            style="width: 100%; height: 100%"
          ></div>
        </div>
      </div>

      <!-- Pipelines Chart -->
      <div
        class="feature-card second-chart-container tw:bg-(--tile-bg) tw:border-[0.0625rem] tw:border-(--tile-border) tw:rounded-lg tw:rounded tw:p-4"
        :class="
          store.state.theme === 'dark'
            ? 'tw:[--tile-bg:#2b2c2d] tw:[--tile-border:#444444]'
            : 'tw:[--tile-bg:#ffffff] tw:[--tile-border:#e7eaee]'
        "
      >
        <div class="details-container tw:flex tw:flex-col tw:gap-3 tw:mb-4">
          <!-- Header -->
          <div class="tw:flex tw:justify-between tw:items-center">
            <span class="text-title tw:flex tw:items-center tw:gap-2 tw:text-lg tw:font-medium tw:leading-5">
              <SkeletonBox variant="avatar" width="40px" height="40px" />
              <SkeletonBox variant="text" width="140px" height="20px" />
            </span>
            <SkeletonBox variant="button" width="40px" height="40px" />
          </div>
          <!-- Stats row -->
          <div class="tw:flex tw:pt-2" style="gap: 16px">
            <div class="tw:flex tw:flex-col">
              <SkeletonBox
                variant="text"
                width="120px"
                height="14px"
                class="tw:mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
            <OSeparator vertical />
            <div class="tw:flex tw:flex-col">
              <SkeletonBox
                variant="text"
                width="100px"
                height="14px"
                class="tw:mb-1"
              />
              <SkeletonBox variant="text" width="40px" height="20px" />
            </div>
          </div>
        </div>
        <!-- Chart area -->
        <div
          class="custom-second-chart tw:my-auto tw:xl:min-h-[200px] tw:h-[calc(100vh-500px)] tw:md:h-[calc(100vh-500px)] tw:lg:h-[calc(100vh-550px)] tw:xl:h-[calc(100vh-645px)]"
        >
          <div
            class="skeleton-box tw:bg-[var(--color-skeleton-base,#f5f5f5)] tw:relative tw:overflow-hidden tw:rounded-lg"
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
