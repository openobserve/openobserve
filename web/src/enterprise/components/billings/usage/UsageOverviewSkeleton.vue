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
  The Overview page's own shape while the metering call is in flight, so the
  cards, the strip and the table land where the placeholders already are.
-->
<template>
  <div class="flex h-full min-h-0 flex-col gap-2.5" data-test="billings-usageoverview-skeleton">
    <div class="flex shrink-0 items-center justify-between gap-2">
      <OSkeleton type="text" class="h-4 w-64" />
      <OSkeleton type="text" class="h-4 w-24" />
    </div>

    <KpiCardRow :columns="4" class="shrink-0">
      <div
        v-for="card in KPI_COUNT"
        :key="card"
        class="bg-card-glass-bg rounded-default border-border-default flex flex-col gap-2 border px-3.5 py-2.5"
      >
        <OSkeleton type="text" class="h-3 w-24" />
        <OSkeleton type="text" class="h-6 w-20" />
        <OSkeleton type="text" class="h-3 w-28" />
      </div>
    </KpiCardRow>

    <section
      class="border-border-default rounded-surface @container/usage-breakdown flex min-h-0 flex-1 flex-col overflow-hidden border"
    >
      <div class="border-border-default border-b px-4 py-2.5">
        <OSkeleton class="h-7 w-full" />
      </div>

      <div
        class="grid min-h-0 flex-1 grid-cols-1 @min-[56.25rem]/usage-breakdown:grid-cols-[3fr_2fr]"
      >
        <div class="flex min-h-0 flex-col gap-2 p-4">
          <OSkeleton v-for="row in TABLE_ROWS" :key="row" type="text" class="h-5 w-full" />
        </div>
        <div
          class="border-border-default flex min-h-0 border-t p-4 @min-[56.25rem]/usage-breakdown:border-s @min-[56.25rem]/usage-breakdown:border-t-0"
        >
          <UsageChartSkeleton />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";

const KPI_COUNT = 4;

const TABLE_ROWS = 8;
</script>
