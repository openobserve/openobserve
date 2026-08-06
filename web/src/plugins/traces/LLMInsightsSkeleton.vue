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
  <div class="tile-content flex flex-col gap-2.5 pt-2.5">
    <!-- Toolbar: Stream/Agent toggle + picker. Only in the full-page skeleton
         when the real toolbar is hidden (initial !streamsLoaded). On a mid-session
         switch the real toolbar is already shown, so `hideToolbar` drops this to
         avoid a duplicate toggle/picker row. The kpiOnly variant never shows it. -->
    <div v-if="!kpiOnly && !hideToolbar" class="flex items-center justify-end gap-2 py-2">
      <OSkeleton type="text" class="h-8 w-29" />
      <OSkeleton type="text" class="h-9 w-56" />
    </div>

    <!-- Row 1: 5 KPI cards -->
    <div class="grid grid-cols-5 gap-2.5">
      <div
        v-for="n in 5"
        :key="n"
        class="rounded-default tile-content flex h-32.5 flex-col gap-2 border border-(--tile-border) bg-(--tile-bg) px-3.5 py-2.5 text-(--text-primary)"
      >
        <OSkeleton type="text" class="h-3 w-[60%]" />
        <OSkeleton type="text" class="h-5.5 w-[55%]" />
        <OSkeleton type="text" class="h-2.5 w-[40%]" />
        <div class="mt-auto flex h-8 items-end gap-[0.15rem]">
          <OSkeleton
            type="text"
            v-for="bar in 16"
            :key="bar"
            :style="{ height: `${30 + ((bar * 23) % 65)}%` }"
            class="w-full"
          />
        </div>
      </div>
    </div>

    <!-- Row 2 & 3: 2-column trend panel grid -->
    <div v-if="!kpiOnly" class="grid grid-cols-2 gap-2.5">
      <div
        v-for="n in 4"
        :key="n"
        class="rounded-default tile-content flex flex-col border border-(--tile-border) bg-(--tile-bg) text-(--text-primary)"
      >
        <div class="mb-1 flex flex-col gap-[0.4rem] p-1.5">
          <OSkeleton type="text" class="h-4 w-30" />
          <OSkeleton type="text" class="h-2.5 w-40" />
        </div>
        <div class="relative h-55 overflow-hidden">
          <svg class="block h-full w-full" viewBox="0 0 200 80" preserveAspectRatio="none">
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
      class="rounded-default tile-content flex flex-col gap-[0.4rem] border border-(--tile-border) bg-(--tile-bg) p-4 text-(--text-primary)"
    >
      <OSkeleton type="text" class="h-4 w-30" />
      <OSkeleton type="text" class="h-2.5 w-40" />
      <div class="mt-2 flex flex-col gap-2">
        <div
          v-for="row in 5"
          :key="row"
          class="panel-tile__row flex items-center gap-3 border-t border-(--tile-border) py-1 first:border-t-0"
        >
          <OSkeleton type="text" class="h-3.5 w-17.5" />
          <OSkeleton type="text" class="h-5 w-22.5" />
          <OSkeleton type="text" class="h-3.5 w-45" />
          <OSkeleton type="text" class="h-3.5 w-27.5" />
          <OSkeleton type="text" class="h-3.5 w-15" />
          <OSkeleton type="text" class="h-3.5 w-12.5" />
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
