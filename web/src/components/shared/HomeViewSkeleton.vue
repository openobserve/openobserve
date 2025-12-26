<template>
  <div>

    <!-- 1st section - Streams container -->
      <div class="streams-container q-px-lg q-py-md"
           :class="store.state.theme === 'dark' ? 'dark-stream-container' : 'light-stream-container'">
        <!-- Header -->
        <div class="row justify-between items-center q-mb-md">
          <SkeletonBox variant="title" width="80px" />
          <SkeletonBox variant="button" width="60px" />
        </div>

        <!-- Tiles -->
        <div class="row wrap justify-evenly q-gutter-md">
          <div 
            v-for="n in 5" 
            :key="n" 
            class="tile" 
            style="min-width: 240px; flex-grow: 1; max-width: 100%;"
          >
            <div class="tile-content q-pa-md rounded-borders column justify-between"
                 :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
                 style="height: 140px; gap: 12px;">
              <!-- Top Section -->
              <div class="column justify-between">
                <!-- Title row -->
                <div class="row justify-between items-center">
                  <SkeletonBox variant="text" width="100px" />
                  <SkeletonBox variant="avatar" width="32px" height="32px" />
                </div>
              </div>

              <!-- Bottom Section - Data -->
              <div class="row items-end">
                <SkeletonBox variant="title" width="80px" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2nd section - functions and dashboards tiles + 2 charts -->
      <div class="charts-main-container row tw-gap-4 q-mt-md xl:tw-min-h-[330px]" style="display: flex; gap: 16px; height: calc(100% - 22px);">
        <!-- Functions and Dashboards tiles -->
        <div class="xl:tw-flex-col lg:tw-flex md:tw-flex-row tw-justify-evenly sm:tw-justify-start tw-gap-4 md:tw-w-full xl:tw-w-fit">
          <!-- Functions tile -->
          <div class="tw-w-full lg:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="dashboards-tile-content tw-h-[180px] q-pa-md rounded-borders column justify-between"
                 :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
                 style="min-height: 150px; gap: 12px;">
              <div class="column justify-between">
                <div class="row justify-between items-center">
                  <div class="skeleton-box" style="width: 100px; height: 16px; border-radius: 4px;"></div>
                  <div class="skeleton-box" style="width: 32px; height: 32px; border-radius: 4px;"></div>
                </div>
              </div>
              <div class="row items-end justify-between">
                <div class="skeleton-box" style="width: 50px; height: 24px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 60px; height: 32px; border-radius: 4px;"></div>
              </div>
            </div>
          </div>

          <!-- Dashboards tile -->
          <div class="tw-w-full lg:tw-w-[calc(50%-0.5rem)] xl:tw-w-[240px] tw-max-w-full">
            <div class="functions-tile-content tw-h-[180px] q-pa-md rounded-borders column justify-between"
                 :class="store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'"
                 style="min-height: 150px; gap: 12px;">
              <div class="column justify-between">
                <div class="row justify-between items-center">
                  <div class="skeleton-box" style="width: 100px; height: 16px; border-radius: 4px;"></div>
                  <div class="skeleton-box" style="width: 32px; height: 32px; border-radius: 4px;"></div>
                </div>
              </div>
              <div class="row items-end justify-between">
                <div class="skeleton-box" style="width: 50px; height: 24px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 60px; height: 32px; border-radius: 4px;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Alerts Chart -->
        <div class="first-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[31%] tw-p-4"
             style="display: flex; flex-direction: column;"
             :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'">
          <div class="details-container" style="margin-bottom: 16px;">
            <!-- Header -->
            <div class="row justify-between items-center">
              <div class="row items-center" style="gap: 8px;">
                <div class="skeleton-box" style="width: 33px; height: 33px; border-radius: 9px;"></div>
                <div class="skeleton-box" style="width: 120px; height: 18px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-box" style="width: 60px; height: 32px; border-radius: 4px;"></div>
            </div>
            <!-- Stats row -->
            <div class="row q-pt-sm" style="gap: 16px;">
              <div class="column">
                <div class="skeleton-box q-mb-xs" style="width: 100px; height: 14px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 40px; height: 20px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-box" style="width: 1px; height: 40px;"></div>
              <div class="column">
                <div class="skeleton-box q-mb-xs" style="width: 80px; height: 14px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 40px; height: 20px; border-radius: 4px;"></div>
              </div>
            </div>
          </div>
          <!-- Chart area -->
          <div class="custom-first-chart tw-my-auto xl:tw-min-h-[200px] tw-h-[calc(100vh-500px)] md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)] tw-w-full">
            <div class="skeleton-box" style="width: 100%; height: 100%; border-radius: 8px;"></div>
          </div>
        </div>

        <!-- Pipelines Chart -->
        <div class="second-chart-container rounded-borders tw-w-full tw-max-w-full xl:tw-w-[calc(49%+5px)] tw-p-4"
             style="display: flex; flex-direction: column;"
             :class="store.state.theme === 'dark' ? 'chart-container-dark' : 'chart-container-light'">
          <div class="details-container" style="margin-bottom: 16px;">
            <!-- Header -->
            <div class="row justify-between items-center">
              <div class="row items-center" style="gap: 8px;">
                <div class="skeleton-box" style="width: 33px; height: 33px; border-radius: 9px;"></div>
                <div class="skeleton-box" style="width: 140px; height: 18px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-box" style="width: 60px; height: 32px; border-radius: 4px;"></div>
            </div>
            <!-- Stats row -->
            <div class="row q-pt-sm" style="gap: 16px;">
              <div class="column">
                <div class="skeleton-box q-mb-xs" style="width: 120px; height: 14px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 40px; height: 20px; border-radius: 4px;"></div>
              </div>
              <div class="skeleton-box" style="width: 1px; height: 40px;"></div>
              <div class="column">
                <div class="skeleton-box q-mb-xs" style="width: 100px; height: 14px; border-radius: 4px;"></div>
                <div class="skeleton-box" style="width: 40px; height: 20px; border-radius: 4px;"></div>
              </div>
            </div>
          </div>
          <!-- Chart area -->
          <div class="custom-second-chart tw-my-auto xl:tw-min-h-[200px] tw-h-[calc(100vh-500px)] md:tw-h-[calc(100vh-500px)] lg:tw-h-[calc(100vh-550px)] xl:tw-h-[calc(100vh-645px)]">
            <div class="skeleton-box" style="width: 100%; height: 100%; border-radius: 8px;"></div>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import SkeletonBox from "./SkeletonBox.vue";

const store = useStore();
</script>

<style scoped lang="scss">
.streams-container {
  background: linear-gradient(to bottom, #fdfdfe, #f3f3f9);
  border-radius: 8px;
  box-sizing: border-box;
}

.dark-stream-container {
  background: #222526;
  border: 1px solid #444444;
}

.light-stream-container {
  background: linear-gradient(to bottom, #fdfdfe, #f3f3f9);
  border: 1px solid #E7EAEE;
}

.tile {
  flex: 1 1 240px;
  max-width: 100%;
}

.tile-content {
  height: 140px !important;
  padding: 16px;
  border-radius: 8px;
}

.dark-tile-content {
  background: #2B2C2D;
  border: 1px solid #444444;
  color: #D2D2D2;
}

.light-tile-content {
  background: #ffffff;
  border: 1px solid #E7EAEE;
  color: #2D2D2D;
}

.chart-container-light {
  border: 1px solid #E7EAEE;
  background: #ffffff;
}

.chart-container-dark {
  border: 1px solid #444444;
  background: #2B2C2D;
}

.charts-main-container {
  gap: 12px;
}

.ai-enabled-home-view {
  height: calc(100vh - 120px);
}

/* Skeleton Animation */
.skeleton-box {
  background: linear-gradient(90deg, 
    transparent, 
    rgba(255, 255, 255, 0.15), 
    transparent
  );
  background-size: 200% 100%;
  animation: skeleton-wave 1.5s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

/* Dark theme skeleton */
.dark-stream-container .skeleton-box,
.dark-tile-content .skeleton-box,
.chart-container-dark .skeleton-box {
  background: linear-gradient(90deg, 
    rgba(255, 255, 255, 0.02), 
    rgba(255, 255, 255, 0.08), 
    rgba(255, 255, 255, 0.02)
  );
  background-size: 200% 100%;
}

/* Light theme skeleton */
.light-stream-container .skeleton-box,
.light-tile-content .skeleton-box,
.chart-container-light .skeleton-box {
  background: linear-gradient(90deg, 
    rgba(0, 0, 0, 0.02), 
    rgba(0, 0, 0, 0.08), 
    rgba(0, 0, 0, 0.02)
  );
  background-size: 200% 100%;
}

@keyframes skeleton-wave {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Additional skeleton styling for better visibility */
.skeleton-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: inherit;
  border-radius: inherit;
}
</style>