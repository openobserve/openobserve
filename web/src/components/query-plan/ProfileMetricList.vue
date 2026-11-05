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
    class="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-x-2.5 gap-y-1 text-xs"
    :data-test="dataTest"
  >
    <template v-for="row in rows" :key="row.name">
      <span class="text-text-body font-mono wrap-anywhere">{{ row.name }}</span>
      <span class="text-text-body text-end whitespace-nowrap tabular-nums">
        {{ row.value }}
        <span v-if="row.total" class="text-text-secondary">/ {{ row.total }}</span>
      </span>
      <OProgressBar v-if="row.ratio !== null" size="xs" variant="neutral" :value="row.ratio" />
      <span v-else />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { formatMetricValue, type ProfileMetric } from "@/utils/queryProfile";

const props = defineProps<{
  metrics: ProfileMetric[];
  /** "share" bars each value against the largest; "fraction" bars value against its own total. */
  bar: "share" | "fraction" | "none";
  dataTest?: string;
}>();

const rows = computed(() => {
  const max = Math.max(0, ...props.metrics.map((m) => m.value)) || 1;
  return props.metrics.map((m) => {
    const hasTotal = m.total !== undefined && m.total > 0;
    let ratio: number | null = null;
    if (props.bar === "share") ratio = m.value / max;
    else if (props.bar === "fraction" && hasTotal) ratio = m.value / (m.total as number);
    return {
      name: m.name,
      value: formatMetricValue(m, m.value),
      total: hasTotal ? formatMetricValue(m, m.total as number) : "",
      ratio,
    };
  });
});
</script>
