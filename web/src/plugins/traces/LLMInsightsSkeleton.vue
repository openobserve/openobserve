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
    class="pt-2.5 flex flex-col gap-2.5 tile-content"
  >
    <!-- Toolbar: Stream/Agent toggle + picker. Only in the full-page skeleton
         when the real toolbar is hidden (initial !streamsLoaded). On a mid-session
         switch the real toolbar is already shown, so `hideToolbar` drops this to
         avoid a duplicate toggle/picker row. The kpiOnly variant never shows it. -->
    <div
      v-if="!kpiOnly && !hideToolbar"
      class="flex items-center justify-end gap-2 py-2"
    >
      <OSkeleton type="text" class="w-29 h-8" />
      <OSkeleton type="text" class="w-56 h-9" />
    </div>

    <!-- Row 1: 5 KPI cards -->
    <div class="grid grid-cols-5 gap-2.5">
      <div
        v-for="n in 5"
        :key="n"
        class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-default py-2.5 px-3.5 flex flex-col gap-2 h-32.5 tile-content"
      >
        <OSkeleton type="text" class="w-[60%] h-3" />
        <OSkeleton type="text" class="w-[55%] h-5.5" />
        <OSkeleton type="text" class="w-[40%] h-2.5" />
        <div class="flex items-end gap-[0.15rem] h-8 mt-auto">
          <OSkeleton type="text" v-for="bar in 16" :key="bar" :style="{ height: `${30 + ((bar * 23) % 65)}%` }" class="w-full" />
        </div>
      </div>
    </div>

    <!-- Row 2 & 3: 2-column trend panel grid -->
    <div v-if="!kpiOnly" class="grid grid-cols-2 gap-2.5">
      <div
        v-for="n in 4"
        :key="n"
        class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-default flex flex-col tile-content"
      >
        <div class="flex flex-col gap-[0.4rem] mb-1 p-1.5">
          <OSkeleton type="text" class="w-30 h-4" />
          <OSkeleton type="text" class="w-40 h-2.5" />
        </div>
        <div class="relative h-55 overflow-hidden">
          <svg
            class="w-full h-full block"
            viewBox="0 0 200 80"
            preserveAspectRatio="none"
          >
            <path
              class="panel-tile__area-fill fill-[color-mix(in_srgb,var(--color-text-heading)_8%,transparent)]"
              d="M0,55 C20,42 35,52 55,46 C72,41 85,30 105,28 C125,26 140,42 160,38 C175,35 190,22 200,18 L200,80 L0,80 Z"
            />
            <path
              class="panel-tile__line-stroke stroke-[color-mix(in_srgb,var(--color-text-heading)_18%,transparent)]"
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
      class="bg-(--tile-bg) border border-(--tile-border) text-(--text-primary) rounded-default p-4 flex flex-col gap-[0.4rem] tile-content"
    >
      <OSkeleton type="text" class="w-30 h-4" />
      <OSkeleton type="text" class="w-40 h-2.5" />
      <div class="flex flex-col gap-2 mt-2">
        <div
          v-for="row in 5"
          :key="row"
          class="panel-tile__row flex items-center gap-3 py-1 border-t first:border-t-0 border-(--tile-border)"
        >
          <OSkeleton type="text" class="w-17.5 h-3.5" />
          <OSkeleton type="text" class="w-22.5 h-5" />
          <OSkeleton type="text" class="w-45 h-3.5" />
          <OSkeleton type="text" class="w-27.5 h-3.5" />
          <OSkeleton type="text" class="w-15 h-3.5" />
          <OSkeleton type="text" class="w-12.5 h-3.5" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

// kpiOnly: render just the KPI tiles row. Used when the trend/table panels
// render live underneath (firing their own queries) while only the KPI strip
// is still loading — so the panels aren't blocked behind the KPI fetch.
defineProps<{ kpiOnly?: boolean; hideToolbar?: boolean }>();
</script>

<style scoped>
/* keep(keyframes): The `line-pulse` keyframe and its `animation:` must both live in this scoped
   block: the scoped compiler renames a keyframe and its `animation:` together
   only within the same block, and never rewrites class strings in the template.
   `.tile-content` publishes the --tile-* contract for this component's tiles. */
.tile-content {
  --tile-bg: var(--color-surface-base);
  --tile-border: var(--color-border-default);
  --text-primary: var(--color-text-heading);
}

/* Breathing sparkline placeholder — the area fill and the line stroke pulse in
   step; the fill/stroke colours stay as utilities on the <path>s. */
.panel-tile__area-fill,
.panel-tile__line-stroke {
  animation: line-pulse 1.6s ease-in-out infinite;
}

@keyframes line-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
