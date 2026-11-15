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

<!-- The shell's placeholder while a page waits on org settings, drawn on the page's own bands (L2, K4). -->
<template>
  <div
    data-test="main-content-pending"
    :data-shape="shape.kind"
    aria-busy="true"
    class="flex h-full flex-1 overflow-hidden"
    :class="shown ? '' : 'invisible'"
  >
    <div
      v-if="shape.rail === 'section'"
      class="bg-surface-panel border-border-default flex w-57.5 shrink-0 flex-col border-e max-md:hidden"
      data-test="main-content-pending-rail"
    >
      <div class="ps-page-edge border-border-default flex h-14 shrink-0 items-center border-b">
        <OSkeleton :delay="0" class="h-4 w-20" />
      </div>
      <div class="flex flex-col gap-1 px-2 pt-3">
        <div v-for="n in RAIL_ITEMS" :key="n" class="flex h-8 items-center ps-2">
          <OSkeleton :delay="0" class="w-32" />
        </div>
      </div>
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <div
        class="px-page-edge border-border-default flex h-14 shrink-0 flex-col justify-center border-b"
        data-test="main-content-pending-header"
      >
        <div class="flex h-4 items-center">
          <OSkeleton :delay="0" class="w-24" />
        </div>
        <div class="flex h-6 items-center">
          <OSkeleton :delay="0" class="h-4 w-48" />
        </div>
      </div>
      <div
        v-if="shape.tabs"
        class="px-page-edge border-border-default flex h-10 shrink-0 items-center gap-6 border-b"
        data-test="main-content-pending-tabs"
      >
        <OSkeleton v-for="n in 3" :key="n" :delay="0" class="w-16" />
      </div>
      <div class="flex min-h-0 flex-1">
        <div
          v-if="shape.rail === 'folder'"
          class="border-border-default flex w-57.5 shrink-0 flex-col gap-1 border-e px-2 pt-3 max-md:hidden"
        >
          <div v-for="n in RAIL_ITEMS" :key="n" class="flex h-8 items-center ps-2">
            <OSkeleton :delay="0" class="w-28" />
          </div>
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <div
            v-if="shape.kind === 'dashboard'"
            class="p-page-edge grid grid-cols-3 gap-3 max-md:grid-cols-1"
            data-test="main-content-pending-grid"
          >
            <OSkeleton v-for="n in 6" :key="n" :delay="0" shape="block" class="h-40" />
          </div>
          <div
            v-else-if="shape.kind === 'form'"
            class="ps-page-edge pe-page-edge flex max-w-3xl flex-col gap-4 py-4"
            data-test="main-content-pending-form"
          >
            <div v-for="n in 5" :key="n" class="flex flex-col gap-1.5">
              <OSkeleton :delay="0" class="w-28" />
              <OSkeleton :delay="0" shape="block" class="h-control-md" />
            </div>
          </div>
          <template v-else>
            <div v-if="shape.kind === 'detail'" class="p-page-edge shrink-0">
              <OSkeleton :delay="0" preset="statStrip" />
            </div>
            <div
              class="px-page-edge border-table-row-divider flex shrink-0 items-center gap-2 border-b py-2"
              data-test="main-content-pending-toolbar"
            >
              <OSkeleton :delay="0" shape="block" class="h-control-md w-70 max-md:w-40" />
              <OSkeleton :delay="0" shape="block" class="h-control-md w-28" />
              <OSkeleton :delay="0" shape="block" class="ms-auto size-8" />
            </div>
            <div
              class="px-page-edge border-table-row-divider flex h-8 shrink-0 items-center gap-4 border-b"
              data-test="main-content-pending-thead"
            >
              <OSkeleton :delay="0" class="w-24" />
              <OSkeleton :delay="0" class="w-16" />
              <OSkeleton :delay="0" class="ms-auto w-12" />
            </div>
            <OSkeleton :delay="0" preset="tableRows" :rows="TABLE_ROWS" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { routePendingShape } from "./routePendingShape";

const RAIL_ITEMS = 8;
const TABLE_ROWS = 20;

const route = useRoute();
const shape = computed(() => routePendingShape(route));
// One delay for the whole frame, so its dividers never show before its bars.
const shown = useDelayedFlag(() => true);
</script>
