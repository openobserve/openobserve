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
    class="pt-[0.625rem] flex flex-col gap-[0.625rem] tile-content"
  >
    <!-- Toolbar: Stream/Agent toggle + picker. Only in the full-page skeleton
         when the real toolbar is hidden (initial !streamsLoaded). On a mid-session
         switch the real toolbar is already shown, so `hideToolbar` drops this to
         avoid a duplicate toggle/picker row. The kpiOnly variant never shows it. -->
    <div
      v-if="!kpiOnly && !hideToolbar"
      class="flex items-center justify-end gap-[0.5rem] py-[0.5rem]"
    >
      <SkeletonBox width="116px" height="32px" rounded-sm />
      <SkeletonBox width="14rem" height="36px" rounded-sm />
    </div>

    <!-- Row 1: 5 KPI cards -->
    <div class="grid grid-cols-5 gap-[0.625rem]">
      <div
        v-for="n in 5"
        :key="n"
        class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-lg py-[0.625rem] px-[0.875rem] flex flex-col gap-2 h-32.5 tile-content"
      >
        <SkeletonBox width="60%" height="12px" rounded-sm />
        <SkeletonBox width="55%" height="22px" rounded-sm />
        <SkeletonBox width="40%" height="10px" rounded-sm />
        <div class="flex items-end gap-[0.15rem] h-8 mt-auto">
          <SkeletonBox
            v-for="bar in 16"
            :key="bar"
            width="100%"
            :height="`${30 + ((bar * 23) % 65)}%`"
            rounded-sm
          />
        </div>
      </div>
    </div>

    <!-- Row 2 & 3: 2-column trend panel grid -->
    <div v-if="!kpiOnly" class="grid grid-cols-2 gap-[0.625rem]">
      <div
        v-for="n in 4"
        :key="n"
        class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-lg p-4 flex flex-col gap-[0.4rem] tile-content"
      >
        <SkeletonBox width="120px" height="16px" rounded-sm />
        <SkeletonBox width="160px" height="10px" rounded-sm />
        <div class="relative h-55 mt-2 overflow-hidden">
          <svg
            class="w-full h-full block"
            viewBox="0 0 200 80"
            preserveAspectRatio="none"
          >
            <path
              class="panel-tile__area-fill [animation:llm-line-pulse_1.6s_ease-in-out_infinite] fill-[color-mix(in_srgb,var(--color-text-primary)_8%,transparent)]"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18 L200,80 L0,80 Z"
            />
            <path
              class="panel-tile__line-stroke [animation:llm-line-pulse_1.6s_ease-in-out_infinite] stroke-[color-mix(in_srgb,var(--color-text-primary)_18%,transparent)]"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18"
              fill="none"
              stroke-width="2"
            />
          </svg>
        </div>
      </div>
    </div>

    <!-- Row 4: w-full recent errors table -->
    <div
      v-if="!kpiOnly"
      class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-lg p-4 flex flex-col gap-[0.4rem] tile-content"
    >
      <SkeletonBox width="120px" height="16px" rounded-sm />
      <SkeletonBox width="160px" height="10px" rounded-sm />
      <div class="flex flex-col gap-2 mt-2">
        <div
          v-for="row in 5"
          :key="row"
          class="panel-tile__row flex items-center gap-3 py-1 border-t first:border-t-0 border-(--tile-border)"
        >
          <SkeletonBox width="70px" height="14px" rounded-sm />
          <SkeletonBox width="90px" height="20px" rounded-sm />
          <SkeletonBox width="180px" height="14px" rounded-sm />
          <SkeletonBox width="110px" height="14px" rounded-sm />
          <SkeletonBox width="60px" height="14px" rounded-sm />
          <SkeletonBox width="50px" height="14px" rounded-sm />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";

// kpiOnly: render just the KPI tiles row. Used when the trend/table panels
// render live underneath (firing their own queries) while only the KPI strip
// is still loading — so the panels aren't blocked behind the KPI fetch.
defineProps<{ kpiOnly?: boolean; hideToolbar?: boolean }>();

const store = useStore();
</script>

<style>
/* keep(keyframes): shimmer/pulse keyframes below, plus the shared --tile-*
   token contract this rule publishes for sibling skeletons (HomeViewSkeleton
   reads --tile-bg from the global .tile-content class) and the SkeletonBox
   child-component gradient overrides — none of which can be scoped. Tile tokens
   map to the centralized --color-* system, which is theme-paired automatically. */
.tile-content {
  --tile-bg: var(--color-surface-base);
  --tile-border: var(--color-border-default);
  --text-primary: var(--color-text-heading);
}

/* Skeleton overrides — same pattern as HomeViewSkeleton. Redefines the
   SkeletonBox child component's gradient for proper per-theme contrast. */
.skeleton-box {
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-white) 15%, transparent),
    transparent
  );
  background-size: 200% 100%;
  animation: llm-skel-wave 1.5s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.dark .tile-content .skeleton-box {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-white) 4%, transparent),
    color-mix(in srgb, var(--color-white) 12%, transparent),
    color-mix(in srgb, var(--color-white) 4%, transparent)
  );
  background-size: 200% 100%;
}

:root:not(.dark) .tile-content .skeleton-box {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-black) 4%, transparent),
    color-mix(in srgb, var(--color-black) 10%, transparent),
    color-mix(in srgb, var(--color-black) 4%, transparent)
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
