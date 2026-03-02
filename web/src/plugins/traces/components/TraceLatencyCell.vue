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
    data-test="trace-row-latency-bar"
    class="row no-wrap tw:h-[0.85rem] tw:rounded tw:overflow-hidden tw:w-full tw:bg-[var(--o2-border-color)]"
  >
    <div
      v-for="[service, svc] in serviceEntries"
      :key="service"
      data-test="trace-row-latency-segment"
      class="tw:h-full tw:min-w-[0.125rem]"
      :style="segmentStyle(service, svc as any)"
    >
      <QTooltip
        class="tw:text-[var(--o2-text-4)]! tw:text-[0.8rem]! tw:p-[0.5rem]!"
        anchor="center left"
        self="center end"
      >
        <div
          class="tw:text-[var(--o2-text-1)]! tw:font-semibold tw:mb-[0.35rem] tw:tracking-[0.03rem] tw:opacity-100 tw:text-[0.75rem]"
        >
          {{ item.spans ?? 0 }} spans across
          {{ serviceEntries.length }} services
        </div>
        <div
          v-for="[s, sv] in serviceEntries"
          :key="s"
          class="tw:grid tw:items-center tw:gap-x-[0.5rem] tw:py-[0.1rem]"
          :class="
            s === service ? 'tw:font-bold' : 'tw:font-normal tw:opacity-75'
          "
          style="grid-template-columns: 0.5rem 1fr auto auto"
        >
          <span
            class="tw:inline-block tw:w-[0.5rem] tw:h-[0.5rem] tw:rounded-full tw:shrink-0"
            :style="{ backgroundColor: serviceColors[s] || '#9e9e9e' }"
          />
          <span class="tw:truncate">{{ s }}</span>
          <span class="tw:text-right">{{
            formatTimeWithSuffix((sv as any).duration)
          }}</span>
          <span class="tw:text-right"
            >{{ segmentPercent(sv as any).toFixed(1) }}%</span
          >
        </div>
      </QTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { QTooltip } from "quasar";
import useTraces from "@/composables/useTraces";
import { formatTimeWithSuffix } from "@/utils/zincutils";

const props = defineProps<{
  item: Record<string, any>;
}>();

const { searchObj } = useTraces();
const serviceColors = computed(() => searchObj.meta.serviceColors ?? {});

const totalDuration = computed(() => {
  const svcs = props.item.services ?? {};
  return (
    Object.values(svcs).reduce<number>(
      (acc, svc) => acc + ((svc as any).duration ?? 0),
      0,
    ) || 1
  );
});

const serviceEntries = computed(() =>
  Object.entries(props.item.services ?? {}).sort(
    ([, a], [, b]) => ((b as any).duration ?? 0) - ((a as any).duration ?? 0),
  ),
);

function segmentPercent(svc: any): number {
  return ((svc.duration ?? 0) / totalDuration.value) * 100;
}

function segmentStyle(service: string, svc: any): Record<string, string> {
  return {
    width: `${segmentPercent(svc)}%`,
    backgroundColor: serviceColors.value[service] || "#9e9e9e",
  };
}
</script>
