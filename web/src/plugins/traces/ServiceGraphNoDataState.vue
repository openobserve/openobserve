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
  ServiceGraphNoDataState — empty state for the service graph panel.
  Shows the service-graph illustration + a "widen time range" action card.
  Emits `widen-range` with the suggested period string so the parent can
  update the global datetime and re-fetch.
-->
<template>
  <OEmptyState preset="no-service-graph" size="block" :hide-action="true">
    <template #actions>
      <EmptyStateActionCard
        icon="schedule"
        :label="t('traces.noEvents.expandRange')"
        :sublabel="expandRangeSublabel"
        data-test="service-graph-empty-expand-range-card"
        class="tw:w-full"
        @click="onWidenRange"
      />
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import useTraces from "@/composables/useTraces";

const { t } = useI18n();
const emit = defineEmits<{ "widen-range": [period: string] }>();
const { searchObj } = useTraces();

function periodToLabel(period: string): string {
  if (!period) return "";
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  const units: Record<string, [string, string]> = {
    s: ["Second", "Seconds"],
    m: ["Minute", "Minutes"],
    h: ["Hour", "Hours"],
    d: ["Day", "Days"],
    w: ["Week", "Weeks"],
    M: ["Month", "Months"],
  };
  const [sg, pl] = units[unit] ?? ["unit", "units"];
  return `Past ${value} ${value === 1 ? sg : pl}`;
}

function nextWiderPeriod(period: string): string {
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  const toMins: Record<string, number> = {
    s: 1 / 60,
    m: 1,
    h: 60,
    d: 1440,
    w: 10080,
    M: 43200,
  };
  const mins = value * (toMins[unit] ?? 1);
  if (mins <= 60) return "1d";
  if (mins <= 1440) return "7d";
  return "30d";
}

const relPeriod = computed(
  () => searchObj.data?.datetime?.relativeTimePeriod || "",
);
const isRelative = computed(
  () => searchObj.data?.datetime?.type === "relative" && !!relPeriod.value,
);
const suggestedPeriod = computed(() =>
  isRelative.value ? nextWiderPeriod(relPeriod.value) : "7d",
);

const expandRangeSublabel = computed(() => {
  if (!isRelative.value) return t("traces.noEvents.expandRangeDescAbsolute");
  const current = periodToLabel(relPeriod.value);
  const next = periodToLabel(suggestedPeriod.value);
  return `${current} → ${next}`;
});

const onWidenRange = () => emit("widen-range", suggestedPeriod.value);
</script>
