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
  <div class="flex flex-col gap-4" data-test="fleet-collector-metrics">
    <OToggleGroup
      :model-value="window"
      type="single"
      class="self-start"
      :aria-label="t('fleet.collectorMetrics.window')"
      data-test="fleet-collector-metrics-window"
      @update:model-value="onWindow"
    >
      <OToggleGroupItem
        v-for="option in windowOptions"
        :key="option.value"
        :value="option.value"
        size="sm"
        :data-test="`fleet-collector-metrics-window-${option.value}`"
        >{{ option.label }}</OToggleGroupItem
      >
    </OToggleGroup>

    <OEmptyState
      v-if="metrics.forbidden.value"
      preset="no-access"
      data-test="fleet-collector-metrics-forbidden"
    />
    <OEmptyState
      v-else-if="metrics.error.value && !values"
      preset="load-error"
      data-test="fleet-collector-metrics-error"
      @action="retry"
    />
    <OEmptyState
      v-else-if="values && !reporting"
      size="inline"
      icon="bar-chart"
      :title="t('fleet.collectorMetrics.emptyTitle')"
      :description="t('fleet.collectorMetrics.emptyDescription', { name: raw(collectorName) })"
      data-test="fleet-collector-metrics-empty"
    />
    <template v-else>
      <KpiCardRow :columns="3" data-test="fleet-collector-metrics-tiles">
        <KpiCard
          v-for="tile in tiles"
          :key="tile.key"
          :label="tile.label"
          :icon="tile.icon"
          :data-test="`fleet-collector-metrics-tile-${tile.key}`"
        >
          <template #value>
            <span
              v-if="values"
              class="text-text-heading text-xl leading-tight font-semibold tabular-nums"
              :data-test="`fleet-collector-metrics-value-${tile.key}`"
              >{{ tile.text }}</span
            >
            <OSkeleton v-else class="h-6 w-16" />
          </template>
        </KpiCard>
      </KpiCardRow>

      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div
          v-for="chart in charts"
          :key="chart.key"
          class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col gap-2 border p-3"
          :class="{ 'col-span-2 max-md:col-span-1': chart.wide }"
          :data-test="`fleet-collector-metrics-chart-${chart.key}`"
        >
          <OText variant="panel-title">{{ chart.title }}</OText>
          <div
            class="grid min-w-0 gap-2"
            :class="chart.schemas.length > 1 ? 'grid-cols-2 max-md:grid-cols-1' : 'grid-cols-1'"
          >
            <div v-for="schema in chart.schemas" :key="schema.id" class="h-56 min-w-0">
              <PanelSchemaRenderer
                v-if="values"
                :key="`${schema.id}::${window}::${epoch}`"
                class="h-full w-full"
                :panel-schema="schema"
                :selected-time-obj="timeObj"
                :variables-data="{}"
                search-type="ui"
                :allow-alert-creation="false"
                :allow-annotations-add="false"
                :allow-annotations-a-p-i="false"
              />
              <OSkeleton v-else class="h-full w-full" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import KpiCard from "@/components/common/KpiCard.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import type { FleetFlowWindow } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { durationFormatter, formatSizeFromMB } from "@/utils/formatters";
import { collectorCharts, WINDOW_SECONDS, type CollectorMetricTile } from "./collectorMetrics";
import { formatCount } from "./fleetFormat";
import { useFleetCollectorMetrics } from "./useFleetApi";

// Keeps the dashboard engine out of the drawer's bundle until this tab opens.
const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

const props = defineProps<{ collectorId: string; collectorName: string }>();

const DASH = raw("—");
const THROUGHPUT: CollectorMetricTile[] = ["received", "sent", "failed"];

const { t } = useI18nTyped();

const window = ref<FleetFlowWindow>("1h");
const epoch = ref(0);

const windowOptions = computed(() => [
  { value: "5m" as const, label: t("fleet.collectorMetrics.window5m") },
  { value: "1h" as const, label: t("fleet.collectorMetrics.window1h") },
  { value: "24h" as const, label: t("fleet.collectorMetrics.window24h") },
]);

const metrics = useFleetCollectorMetrics(
  () => props.collectorId,
  () => window.value,
);
const values = metrics.values;

const reporting = computed(
  () => !!values.value && Object.values(values.value).some((v) => v !== null),
);

const timeObj = ref(rangeFor(window.value));
watch([window, () => props.collectorId], () => {
  timeObj.value = rangeFor(window.value);
});

const charts = computed(() => collectorCharts(t, props.collectorId, window.value));

const tiles = computed(() => {
  const v = values.value;
  const defs: { key: CollectorMetricTile; label: I18nText; icon: IconName }[] = [
    { key: "cpu", label: t("fleet.collectorMetrics.cpu"), icon: "speed" },
    { key: "memory", label: t("fleet.collectorMetrics.memory"), icon: "memory" },
    { key: "uptime", label: t("fleet.collectorMetrics.uptime"), icon: "schedule" },
    { key: "received", label: t("fleet.collectorMetrics.received"), icon: "call-received" },
    { key: "sent", label: t("fleet.collectorMetrics.sent"), icon: "call-made" },
    { key: "failed", label: t("fleet.collectorMetrics.failed"), icon: "error-outline" },
  ];
  return defs.map((d) => ({ ...d, text: v ? tileText(d.key, v[d.key]) : DASH }));
});

// A counter with no stream yet has never counted anything, so a reporting collector reads it as zero.
function tileText(key: CollectorMetricTile, value: number | null): I18nText {
  if (THROUGHPUT.includes(key)) {
    return t("fleet.collectorMetrics.perSecond", { value: raw(formatCount(value ?? 0)) });
  }
  if (value === null) return DASH;
  if (key === "cpu") return raw(`${value.toFixed(1)}%`);
  if (key === "memory") return raw(formatSizeFromMB(value / 1024 / 1024));
  return raw(durationFormatter(Math.floor(value)));
}

// Microseconds in a Date, which is what the dashboard pipeline reads back through getTime().
function rangeFor(w: FleetFlowWindow) {
  const endUs = Date.now() * 1000;
  return {
    start_time: new Date(endUs - WINDOW_SECONDS[w] * 1_000_000),
    end_time: new Date(endUs),
  };
}

function onWindow(value: unknown) {
  if (value) window.value = value as FleetFlowWindow;
}

function retry() {
  timeObj.value = rangeFor(window.value);
  epoch.value += 1;
  metrics.refetch();
}
</script>
