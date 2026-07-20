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
    class="flex flex-nowrap h-[0.85rem] rounded-default overflow-hidden w-full bg-card-glass-border"
  >
    <div
      v-for="[service, svc] in serviceEntries"
      :key="service"
      data-test="trace-row-latency-segment"
      class="h-full min-w-0.5"
      :style="segmentStyle(service, svc as any)"
    >
      <OTooltip side="left" align="center">
        <template #content>
          <div
            class="font-semibold mb-[0.35rem] tracking-[0.03rem] opacity-100 text-xs"
          >
            {{ t('traces.traceLatencyCell.spansAcrossServices', { spans: item.spans, services: serviceEntries.length }) }}
          </div>
          <div
            v-for="[s, sv] in serviceEntries"
            :key="s"
            class="grid items-center gap-x-2 py-[0.1rem] grid-cols-[0.5rem_1fr_auto_auto]"
            :class="
              s === service ? 'font-bold' : 'font-normal opacity-75'
            "
          >
            <span
              class="inline-block w-2 h-2 rounded-full shrink-0"
              :style="serviceDotStyle(s)"
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

// TODO(design-tokens): the "unknown service" grey has no semantic token. It is the
// shared fallback for a service the colour allocator never assigned (also in
// TraceServiceCell + TraceDetailsSidebar, and asserted by their specs), so it is
// NOT --color-dag-node-default (same value, but that token means "LLM span type:
// default"). Needs e.g. --color-trace-service-unknown; then this const is the only
// site in this file to change.
const UNKNOWN_SERVICE_COLOR = "#9e9e9e";

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

function serviceColor(service: string): string {
  return serviceColors.value[service] || UNKNOWN_SERVICE_COLOR;
}

/** Legend dot — per-service colour, so it can only be a runtime binding. */
function serviceDotStyle(service: string): Record<string, string> {
  return { backgroundColor: serviceColor(service) };
}

/** Segment — runtime width (share of total duration) + per-service colour. */
function segmentStyle(service: string, svc: any): Record<string, string> {
  return {
    width: `${segmentPercent(svc)}%`,
    backgroundColor: serviceColor(service),
  };
}
</script>
