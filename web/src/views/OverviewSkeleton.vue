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

<!--
  OverviewSkeleton — first-load placeholder for ONE OverviewTab section.

  Rendered per section (`section` prop) rather than as one block, because the
  four datasets resolve independently: a global placeholder disappears the moment
  the *first* dataset lands, leaving the still-loading sections blank until they
  pop in. Each section instead stands in for itself and is replaced only by its
  own data.

  Shapes mirror the real sections so the layout doesn't shift on swap:
    incidents     joined rows in one bordered container (icon, tag, title, time)
    services      horizontally scrolling fixed-width cards
    anomalies     free-standing rows, gap-separated
    recentEvents  joined compact rows (denser padding than incidents)

  Row counts are deliberately small: a placeholder should suggest shape, not
  imply a quantity we don't know yet.
-->
<template>
  <section class="mb-5" :data-test="`overview-skeleton-${section}`">
    <!-- Every real section carries a title + count chip + View all -->
    <div class="mb-2 flex items-center justify-between pl-1">
      <div class="flex items-center gap-2">
        <OSkeleton class="h-4 w-28" />
        <OSkeleton class="h-4 w-6" />
      </div>
      <OSkeleton class="h-3 w-14" />
    </div>

    <!-- INCIDENTS: joined rows inside one bordered container -->
    <div
      v-if="section === 'incidents'"
      class="border-border-default rounded-default flex flex-col overflow-hidden border border-[0.0625em]"
    >
      <div
        v-for="i in 2"
        :key="i"
        class="bg-surface-base border-b-border-default flex items-center gap-3 border-b-[0.0625em] px-3.5 py-2.5 last:border-b-0"
      >
        <OSkeleton type="circle" class="w-4 shrink-0" />
        <OSkeleton class="h-4 w-8 shrink-0" />
        <OSkeleton class="h-4 max-w-[20em]" />
        <OSkeleton class="h-3 w-12 shrink-0" />
      </div>
    </div>

    <!-- SERVICES: scroll chevron + fixed-width cards -->
    <div v-else-if="section === 'services'" class="flex items-stretch gap-2">
      <OSkeleton class="rounded-default w-6 shrink-0" />
      <div class="flex flex-1 flex-row gap-2 overflow-hidden">
        <div
          v-for="i in 4"
          :key="i"
          class="rounded-default border-border-default bg-surface-base flex max-w-40 min-w-40 shrink-0 grow-0 basis-40 flex-col gap-2 border border-[0.0625em] px-3.5 py-3"
        >
          <OSkeleton class="h-4 max-w-[7em]" />
          <OSkeleton class="h-3 max-w-[4.5em]" />
        </div>
      </div>
    </div>

    <!-- ANOMALIES: free-standing rows, gap-separated -->
    <div v-else-if="section === 'anomalies'" class="flex flex-col gap-1.5">
      <div
        v-for="i in 2"
        :key="i"
        class="rounded-default border-border-default bg-surface-base flex items-center gap-3 border border-[0.0625em] px-3.5 py-2.5"
      >
        <OSkeleton type="circle" class="w-4 shrink-0" />
        <OSkeleton class="h-4 max-w-[24em]" />
      </div>
    </div>

    <!-- RECENT EVENTS: joined compact rows -->
    <div
      v-else
      class="border-border-default rounded-default bg-surface-base flex flex-col gap-0 overflow-hidden border border-[0.0625em]"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="border-b-border-default flex items-center gap-3 border-b border-b-[0.0625em] px-3.5 py-2 last:border-b-0"
      >
        <OSkeleton class="h-4 w-12 shrink-0" />
        <OSkeleton class="h-3 w-[7.5em] shrink-0" />
        <OSkeleton class="h-3 flex-1" />
        <OSkeleton class="h-3 w-8 shrink-0" />
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
