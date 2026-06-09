<template>
  <!-- No card-container: the loaded UsageTab content has no outer border, so the
       skeleton must not add one (otherwise a top/outer border flashes only while
       loading and disappears once data arrives). -->
  <div
    class="tw:w-full tw:px-[0.625rem] tw:py-[0.625rem]"
    style="display: flex; flex-direction: column; height: calc(100vh - 52px)"
  >
    <!-- 1st section - Streams container -->
    <div
      class="feature-card"
      :class="
        store.state.theme === 'dark'
          ? 'dark-stream-container'
          : 'light-stream-container'
      "
    >
      <!-- Header -->
      <div class="tw:flex tw:justify-between tw:items-center streams-header">
        <div class="tw:flex tw:items-center tw:gap-2">
          <SkeletonBox variant="avatar" width="40px" height="40px" />
          <SkeletonBox variant="title" width="100px" />
        </div>
        <SkeletonBox variant="button" width="40px" height="40px" />
      </div>

      <!-- Tiles using same grid as HomeView -->
      <div class="tiles-grid">
        <div v-for="n in 5" :key="n" class="tile">
          <div
            class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
            :class="
              store.state.theme === 'dark'
                ? 'dark-tile-content'
                : 'light-tile-content'
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
            <div class="data-to-display tw:flex tw:items-end">
              <SkeletonBox variant="title" width="80px" height="32px" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 2nd section - functions and dashboards tiles + 2 charts -->
    <div class="charts-main-container">
      <!-- Functions and Dashboards column -->
      <div class="functions-dashboards-column">
        <!-- Functions tile -->
        <div class="tile-wrapper">
          <div
            class="feature-card tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
            :class="
              store.state.theme === 'dark'
                ? 'dark-tile-content'
                : 'light-tile-content'
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
            <div class="data-to-display tw:flex tw:items-end">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>

        <!-- Dashboards tile -->
        <div class="tile-wrapper">
          <div
            class="feature-card tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
            :class="
              store.state.theme === 'dark'
                ? 'dark-tile-content'
                : 'light-tile-content'
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
            <div class="data-to-display tw:flex tw:items-end">
              <SkeletonBox variant="title" width="60px" height="32px" />
            </div>
          </div>
        </div>
      </div>

      <!-- Alerts Chart -->
      <div
        class="feature-card first-chart-container tw:rounded tw:p-4"
        :class="
          store.state.theme === 'dark'
            ? 'chart-container-dark'
            : 'chart-container-light'
        "
      >
        <div class="details-container">
          <!-- Header -->
          <div class="tw:flex tw:justify-between tw:items-center">
            <span class="text-title tw:flex tw:items-center tw:gap-2">
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
          class="custom-first-chart tw:my-auto xl:tw:min-h-[200px] tw:h-[calc(100vh-500px)] md:tw:h-[calc(100vh-500px)] lg:tw:h-[calc(100vh-550px)] xl:tw:h-[calc(100vh-645px)] tw:w-full"
        >
          <div
            class="skeleton-box"
            style="width: 100%; height: 100%; border-radius: 8px"
          ></div>
        </div>
      </div>

      <!-- Pipelines Chart -->
      <div
        class="feature-card second-chart-container tw:rounded tw:p-4"
        :class="
          store.state.theme === 'dark'
            ? 'chart-container-dark'
            : 'chart-container-light'
        "
      >
        <div class="details-container">
          <!-- Header -->
          <div class="tw:flex tw:justify-between tw:items-center">
            <span class="text-title tw:flex tw:items-center tw:gap-2">
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
          class="custom-second-chart tw:my-auto xl:tw:min-h-[200px] tw:h-[calc(100vh-500px)] md:tw:h-[calc(100vh-500px)] lg:tw:h-[calc(100vh-550px)] xl:tw:h-[calc(100vh-645px)]"
        >
          <div
            class="skeleton-box"
            style="width: 100%; height: 100%; border-radius: 8px"
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

<style scoped lang="scss">
// Import the same structure as HomeView.vue
.feature-card {
  background: var(--tile-bg);
  border: 0.0625rem solid var(--o2-border-color);
  border-radius: 0.5rem;
  padding: 1rem;
}

.dark-stream-container,
.light-stream-container {
  background: var(--tile-bg);
  border: 0.0625rem solid var(--o2-border-color);
}

.streams-header {
  margin-bottom: 16px;
}

// Modern CSS Grid for responsive tiles - matching HomeView
.tiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.tile {
  border-radius: 0.325rem;
  border: 0.0625rem solid var(--o2-border-color);
}

.tile-content {
  height: 100%;
  padding: 1rem;
  border-radius: 0.5rem;
  gap: 0.5rem;
}

.dark-tile-content,
.light-tile-content {
  background: var(--tile-bg);
  border: 1px solid var(--tile-border);
  color: var(--text-primary);
}

.dark-tile-content {
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
  --text-primary: #cccfd1;
}

.light-tile-content {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
  --text-primary: #2e3133;
}

.data-to-display {
  font-size: 28px;
  font-weight: 600;
  line-height: 32px;
}

// Layout for charts section - matching HomeView
.charts-main-container {
  display: grid;
  grid-template-columns: minmax(min-content, max-content) 1fr 2fr;
  gap: 1rem;
  margin-top: 1rem;
  align-items: stretch;

  @media (max-width: 1280px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
  }
}

.functions-dashboards-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;

  @media (max-width: 1280px) {
    flex-direction: row;
  }

  @media (max-width: 768px) {
    flex-direction: column;
  }
}

.tile-wrapper {
  flex: 1;
  display: flex;
  min-width: 0;
  width: 100%;

  .feature-card {
    width: 100%;
  }
}

.chart-container-light {
  border: 1px solid var(--tile-border);
  background: var(--tile-bg);
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
}

.chart-container-dark {
  border: 1px solid var(--tile-border);
  background: var(--tile-bg);
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
}

.text-title {
  font-size: 18px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0%;
}

.details-container {
  gap: 12px;
  margin-bottom: 16px;
}

/* Flat base + sliding ::after overlay — same pattern as OSkeleton/SkeletonBox.
   Dark/light theme overrides set the base colour explicitly since this is
   a legacy component that may load before the O2 token root is applied. */
.skeleton-box {
  background-color: var(--color-skeleton-base, #f5f5f5);
  position: relative;
  overflow: hidden;
}

.skeleton-box::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent       0%,
    transparent      30%,
    var(--color-skeleton-shimmer, rgba(255, 255, 255, 0.8)) 50%,
    transparent      70%,
    transparent     100%
  );
  animation: skeleton-shimmer 1.8s ease-in-out infinite;
}

/* Dark theme — swap to dark surface base, dimmer shimmer */
.dark-stream-container .skeleton-box,
.dark-tile-content .skeleton-box,
.chart-container-dark .skeleton-box {
  background-color: #262626;
}

.dark-stream-container .skeleton-box::after,
.dark-tile-content .skeleton-box::after,
.chart-container-dark .skeleton-box::after {
  background: linear-gradient(
    90deg,
    transparent                   0%,
    transparent                  30%,
    rgba(255, 255, 255, 0.07)    50%,
    transparent                  70%,
    transparent                 100%
  );
}

/* Light theme — explicit override in case token isn't resolved */
.light-stream-container .skeleton-box,
.light-tile-content .skeleton-box,
.chart-container-light .skeleton-box {
  background-color: #f5f5f5;
}

@keyframes skeleton-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
