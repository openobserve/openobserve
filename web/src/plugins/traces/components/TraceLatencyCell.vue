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
    class="flex flex-nowrap h-[0.85rem] rounded overflow-hidden w-full bg-[var(--o2-border-color)]"
  >
    <div
      v-for="[service, svc] in serviceEntries"
      :key="service"
      data-test="trace-row-latency-segment"
      class="h-full min-w-[0.125rem]"
      :style="segmentStyle(service, svc as any)"
    >
      <OTooltip side="left" align="center">
        <template #content>
          <div
            class="font-semibold mb-[0.35rem] tracking-[0.03rem] opacity-100 text-[0.75rem]"
          >
            {{ t('traces.traceLatencyCell.spansAcrossServices', { spans: item.spans, services: serviceEntries.length }) }}
          </div>
          <div
            v-for="[s, sv] in serviceEntries"
            :key="s"
            class="grid items-center gap-x-[0.5rem] py-[0.1rem]"
            :class="
              s === service ? 'font-bold' : 'font-normal opacity-75'
            "
            style="grid-template-columns: 0.5rem 1fr auto auto"
          >
            <span
              class="inline-block w-[0.5rem] h-[0.5rem] rounded-full shrink-0"
              :style="{ backgroundColor: serviceColors[s] || '#9e9e9e' }"
            />
            <span class="truncate">{{ s }}</span>
            <span class="text-right">{{
              formatTimeWithSuffix((sv as any).duration)
            }}</span>
            <span class="text-right"
              >{{ segmentPercent(sv as any).toFixed(1) }}%</span
            >
          </div>
        </template>
      </OTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useTraces from "@/composables/useTraces";
import { formatTimeWithSuffix } from "@/utils/zincutils";

const props = defineProps<{
  item: Record<string, any>;
}>();

const { t } = useI18n();
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
