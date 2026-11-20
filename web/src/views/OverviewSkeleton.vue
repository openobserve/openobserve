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

<!-- One placeholder per section, shaped like its rows, so each section swaps in on its own load without a shift. -->
<template>
  <section :data-test="`overview-skeleton-${section}`">
    <div class="mb-2 flex min-h-8 items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <OSkeleton shape="block" class="h-4 w-28" />
        <OSkeleton shape="block" class="h-4 w-6" />
      </div>
      <OSkeleton shape="block" class="h-3 w-14" />
    </div>

    <div v-if="section === 'incidents'" class="divide-border-subtle flex flex-col divide-y">
      <div v-for="i in 2" :key="i" class="flex min-h-10 items-center gap-3 py-1 ps-3">
        <OSkeleton shape="circle" class="w-4 shrink-0" />
        <OSkeleton shape="block" class="h-4 w-8 shrink-0" />
        <OSkeleton shape="block" class="h-4 max-w-[20em]" />
        <OSkeleton shape="block" class="h-3 w-12 shrink-0" />
      </div>
    </div>

    <div v-else-if="section === 'services'" class="flex items-stretch gap-2">
      <OSkeleton shape="block" class="w-6 shrink-0" />
      <div class="flex flex-1 flex-row gap-2 overflow-hidden">
        <div
          v-for="i in 4"
          :key="i"
          class="rounded-default border-border-default bg-surface-panel flex max-w-40 min-w-40 shrink-0 grow-0 basis-40 flex-col gap-2 border border-[0.0625em] px-3.5 py-3"
        >
          <OSkeleton shape="block" class="h-4 max-w-[7em]" />
          <OSkeleton shape="block" class="h-3 max-w-[4.5em]" />
        </div>
      </div>
    </div>

    <div v-else-if="section === 'anomalies'" class="divide-border-subtle flex flex-col divide-y">
      <div v-for="i in 2" :key="i" class="flex min-h-10 items-center gap-3 py-1 ps-3">
        <OSkeleton shape="circle" class="w-4 shrink-0" />
        <OSkeleton shape="block" class="h-4 max-w-[24em]" />
      </div>
    </div>

    <div v-else class="divide-border-subtle flex flex-col divide-y">
      <div v-for="i in 3" :key="i" class="flex min-h-9 items-center gap-3 py-1.5">
        <OSkeleton shape="block" class="h-4 w-12 shrink-0" />
        <OSkeleton shape="block" class="h-3 w-[7.5em] shrink-0" />
        <OSkeleton shape="block" class="h-3 flex-1" />
        <OSkeleton shape="block" class="h-3 w-8 shrink-0" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

defineProps<{
  /** Which OverviewTab section this placeholder stands in for. */
  section: "incidents" | "services" | "anomalies" | "recentEvents";
}>();
</script>
