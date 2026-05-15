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
    class="tw:flex tw:flex-col tw:h-full"
    :class="
      store.state.theme === 'dark' ? 'dark-tile-content' : 'light-tile-content'
    "
  >
    <!-- Search bar skeleton -->
    <div class="search-bar-skeleton">
      <!-- Toolbar row -->
      <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-2">
        <div class="tw:flex tw:items-center tw:gap-2">
          <SkeletonBox width="7rem" height="2rem" rounded />
          <SkeletonBox width="5rem" height="2rem" rounded />
          <SkeletonBox width="5rem" height="2rem" rounded />
        </div>
        <div class="tw:flex tw:items-center tw:gap-2">
          <SkeletonBox width="10rem" height="2rem" rounded />
          <SkeletonBox width="6rem" height="2rem" rounded />
          <SkeletonBox width="5rem" height="2rem" rounded />
          <SkeletonBox width="2rem" height="2rem" rounded />
        </div>
      </div>
      <!-- Query editor row -->
      <div class="tw:px-4 tw:pb-2">
        <SkeletonBox width="100%" height="2.5rem" rounded />
      </div>
    </div>

    <!-- Content area -->
    <div class="tw:flex tw:flex-1 tw:overflow-hidden">
      <!-- Field list sidebar skeleton -->
      <div class="field-list-skeleton tw:px-3 tw:py-2">
        <div class="tw:mb-3">
          <SkeletonBox width="100%" height="1.5rem" rounded />
        </div>
        <div
          v-for="group in 4"
          :key="group"
          class="tw:mb-4"
        >
          <SkeletonBox width="80%" height="0.875rem" rounded />
          <div class="tw:mt-2 tw:space-y-1.5">
            <SkeletonBox
              v-for="field in 5"
              :key="field"
              width="90%"
              height="0.75rem"
              rounded
            />
          </div>
        </div>
      </div>

      <!-- Main results skeleton -->
      <div class="tw:flex-1 tw:flex tw:flex-col tw:px-4 tw:py-2">
        <!-- Histogram skeleton -->
        <div class="histogram-skeleton tw:mb-3">
          <div class="tw:flex tw:items-end tw:gap-[0.15rem] tw:h-[6rem]">
            <SkeletonBox
              v-for="bar in 30"
              :key="bar"
              width="3%"
              :height="`${30 + ((bar * 17) % 65)}%`"
              rounded
            />
          </div>
        </div>

        <!-- Pagination / controls skeleton -->
        <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
          <SkeletonBox width="8rem" height="1.5rem" rounded />
          <div class="tw:flex tw:items-center tw:gap-2">
            <SkeletonBox width="3rem" height="1.5rem" rounded />
            <SkeletonBox width="3rem" height="1.5rem" rounded />
          </div>
        </div>

        <!-- Table rows skeleton -->
        <div class="tw:flex tw:flex-col tw:gap-[0.125rem]">
          <!-- Header row -->
          <div class="tw:flex tw:items-center tw:gap-3 tw:mb-1">
            <SkeletonBox width="5rem" height="1rem" rounded />
            <SkeletonBox width="12rem" height="1rem" rounded />
            <SkeletonBox width="8rem" height="1rem" rounded />
            <SkeletonBox width="6rem" height="1rem" rounded />
          </div>
          <!-- Data rows -->
          <div
            v-for="row in 8"
            :key="row"
            class="tw:flex tw:items-center tw:gap-3 tw:py-[0.35rem]"
          >
            <SkeletonBox width="5rem" height="0.75rem" rounded />
            <SkeletonBox
              :width="`${8 + ((row * 7) % 20)}rem`"
              height="0.75rem"
              rounded
            />
            <SkeletonBox width="8rem" height="0.75rem" rounded />
            <SkeletonBox width="6rem" height="0.75rem" rounded />
          </div>
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
.search-bar-skeleton {
  background: var(--tile-bg);
  border-bottom: 1px solid var(--tile-border);
}

.field-list-skeleton {
  width: 15rem;
  min-width: 15rem;
  border-right: 1px solid var(--tile-border);
  background: var(--tile-bg);
  overflow: hidden;
}

.histogram-skeleton {
  background: var(--tile-bg);
  border: 1px solid var(--tile-border);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.dark-tile-content {
  --tile-bg: #2b2c2d;
  --tile-border: #444444;
}

.light-tile-content {
  --tile-bg: #ffffff;
  --tile-border: #e7eaee;
}
</style>
