<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="llm-insights-skeleton tw:flex tw:flex-col tw:gap-[0.625rem]"
    :class="
      store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
    "
  >
    <!-- Row 1: 5 KPI cards -->
    <div class="tw:grid tw:grid-cols-5 tw:gap-[0.625rem]">
      <div
        v-for="n in 5"
        :key="n"
        class="kpi-tile"
        :class="
          store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
        "
      >
        <SkeletonBox width="60%" height="12px" rounded />
        <SkeletonBox width="55%" height="22px" rounded />
        <SkeletonBox width="40%" height="10px" rounded />
        <div class="kpi-tile__spark">
          <SkeletonBox
            v-for="bar in 16"
            :key="bar"
            width="100%"
            :height="`${30 + ((bar * 23) % 65)}%`"
            rounded
          />
        </div>
      </div>
    </div>

    <!-- Row 2 & 3: 2-column trend panel grid -->
    <div class="tw:grid tw:grid-cols-2 tw:gap-[0.625rem]">
      <div
        v-for="n in 4"
        :key="n"
        class="panel-tile"
        :class="
          store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
        "
      >
        <SkeletonBox width="120px" height="16px" rounded />
        <SkeletonBox width="160px" height="10px" rounded />
        <div class="panel-tile__line">
          <svg
            class="panel-tile__line-svg"
            viewBox="0 0 200 80"
            preserveAspectRatio="none"
          >
            <path
              class="panel-tile__area-fill"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18 L200,80 L0,80 Z"
            />
            <path
              class="panel-tile__line-stroke"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18"
              fill="none"
              stroke-width="2"
            />
          </svg>
        </div>
      </div>
    </div>

    <!-- Row 4: full-width recent errors table -->
    <div
      class="panel-tile"
      :class="
        store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
      "
    >
      <SkeletonBox width="120px" height="16px" rounded />
      <SkeletonBox width="160px" height="10px" rounded />
      <div class="panel-tile__rows">
        <div v-for="row in 5" :key="row" class="panel-tile__row">
          <SkeletonBox width="70px" height="14px" rounded />
          <SkeletonBox width="90px" height="20px" rounded />
          <SkeletonBox width="180px" height="14px" rounded />
          <SkeletonBox width="110px" height="14px" rounded />
          <SkeletonBox width="60px" height="14px" rounded />
          <SkeletonBox width="50px" height="14px" rounded />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

const store = useStore();
</script>

<style scoped lang="scss">
.llm-insights-skeleton {
  padding-top: 0.625rem;
}

.kpi-tile,
.panel-tile {
  background: var(--tile-bg);
  border: 1px solid var(--tile-border);
  color: var(--text-primary);
  border-radius: 0.5rem;
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

.kpi-tile {
  padding: 0.625rem 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 130px;

  &__spark {
    display: flex;
    align-items: flex-end;
    gap: 0.15rem;
    height: 32px;
    margin-top: auto;
  }
}

.panel-tile {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;

  &__chart {
    display: flex;
    align-items: flex-end;
    gap: 0.4rem;
    height: 220px;
    margin-top: 0.5rem;
  }

  &__line {
    position: relative;
    height: 220px;
    margin-top: 0.5rem;
    overflow: hidden;
  }

  &__line-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  &__rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0;
    border-top: 1px solid var(--tile-border);

    &:first-child {
      border-top: none;
    }
  }
}

/* Skeleton overrides — same pattern as HomeViewSkeleton.
   The SkeletonBox component's default gradient is theme-agnostic; redefining
   here under .dark-tile-content / .light-tile-content gives proper contrast.
   :deep() pierces SkeletonBox's scoped style so the override applies. */
:deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.15),
    transparent
  );
  background-size: 200% 100%;
  animation: llm-skel-wave 1.5s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.dark-tile-content :deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0.04)
  );
  background-size: 200% 100%;
}

.light-tile-content :deep(.skeleton-box) {
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04),
    rgba(0, 0, 0, 0.1),
    rgba(0, 0, 0, 0.04)
  );
  background-size: 200% 100%;
}

@keyframes llm-skel-wave {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.panel-tile__area-fill {
  fill: rgba(0, 0, 0, 0.08);
  animation: llm-line-pulse 1.6s ease-in-out infinite;
}
.panel-tile__line-stroke {
  stroke: rgba(0, 0, 0, 0.18);
  animation: llm-line-pulse 1.6s ease-in-out infinite;
}

.dark-tile-content .panel-tile__area-fill {
  fill: rgba(255, 255, 255, 0.08);
}
.dark-tile-content .panel-tile__line-stroke {
  stroke: rgba(255, 255, 255, 0.22);
}

@keyframes llm-line-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
