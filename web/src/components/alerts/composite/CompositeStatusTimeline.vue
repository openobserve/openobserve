<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";

import alertsService from "@/services/alerts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { CompositeTimelineLane, CompositeTimelineResponse } from "@/ts/interfaces/alert";
import { raw, useI18nTyped } from "@/types/i18n";
import { letterFor } from "./expression";

const props = defineProps<{ alertId: string }>();

const { t } = useI18nTyped();
const store = useStore();

const SEGMENTS = 48;
const WINDOWS = [
  { value: "1h", micros: 3_600_000_000 },
  { value: "4h", micros: 14_400_000_000 },
  { value: "1d", micros: 86_400_000_000 },
];

const timeRange = ref("4h");
const data = ref<CompositeTimelineResponse | null>(null);
const loading = ref(false);

const orgId = computed(() => store.state.selectedOrganization?.identifier);
const lanes = computed<CompositeTimelineLane[]>(() => {
  if (!data.value) return [];
  return [...data.value.children, data.value.result];
});
const isResult = (lane: CompositeTimelineLane): boolean =>
  lane.alert_id === data.value?.result.alert_id;

const LEVEL_BG: Record<string, string> = {
  critical: "bg-error-500",
  warning: "bg-warning-500",
  ok: "bg-success-500",
  nodata: "bg-surface-subtle",
};

const fetch = async (): Promise<void> => {
  if (!orgId.value || !props.alertId) return;
  loading.value = true;
  const micros = WINDOWS.find((w) => w.value === timeRange.value)?.micros ?? WINDOWS[1].micros;
  const to = Date.now() * 1000;
  const from = to - micros;
  try {
    const response = await alertsService.getCompositeTimeline(orgId.value, props.alertId, from, to);
    data.value = response.data;
  } catch {
    data.value = null;
  } finally {
    loading.value = false;
  }
};

const levelAt = (lane: CompositeTimelineLane, t: number): string => {
  const transitions = lane.transitions ?? [];
  let level =
    transitions.length > 0
      ? (transitions[0].from_level ?? lane.current_level ?? "nodata")
      : (lane.current_level ?? "nodata");
  for (const transition of transitions) {
    if (transition.at <= t) {
      level = transition.to_level ?? level;
    } else {
      break;
    }
  }
  return level;
};

const segments = (lane: CompositeTimelineLane) => {
  if (!data.value) return [];
  const { from, to } = data.value;
  const span = to - from;
  const result: { level: string; bg: string }[] = [];
  for (let i = 0; i < SEGMENTS; i += 1) {
    const level = levelAt(lane, from + (span * i) / SEGMENTS);
    result.push({ level, bg: LEVEL_BG[level] ?? LEVEL_BG.nodata });
  }
  return result;
};

const labelFor = (lane: CompositeTimelineLane): ReturnType<typeof raw> =>
  isResult(lane) ? t("alerts.composite.result") : raw(lane.name ?? lane.alert_id);

watch([timeRange, orgId], fetch);
onMounted(fetch);
</script>

<template>
  <div class="flex flex-col gap-2" data-test="alerts-composite-timeline">
    <div class="flex items-center justify-between gap-3">
      <span class="text-text-secondary text-xs">{{ t("alerts.composite.timelineHint") }}</span>
      <OToggleGroup
        :model-value="timeRange"
        data-test="alerts-composite-timeline-window"
        @update:model-value="timeRange = $event as string"
      >
        <OToggleGroupItem
          v-for="w in WINDOWS"
          :key="w.value"
          :value="w.value"
          size="sm"
          :data-test="`alerts-composite-timeline-window-${w.value}`"
        >
          {{ raw(w.value) }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <div v-if="loading" class="text-text-secondary flex items-center gap-2 py-6 text-sm">
      <OIcon name="refresh" size="sm" class="animate-spin" />
      {{ t("alerts.composite.timelineLoading") }}
    </div>

    <div
      v-else-if="lanes.length"
      class="grid grid-cols-[13.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5"
    >
      <template v-for="(lane, index) in lanes" :key="lane.alert_id">
        <div class="flex min-w-0 items-center gap-2">
          <span
            v-if="!isResult(lane)"
            class="bg-theme-accent-soft text-theme-accent rounded-default flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold"
          >
            {{ raw(letterFor(lane.slot ?? index)) }}
          </span>
          <span
            :class="isResult(lane) ? 'font-semibold' : ''"
            class="text-text-heading min-w-0 truncate text-sm"
            :title="String(labelFor(lane))"
          >
            {{ labelFor(lane) }}
          </span>
          <OTag
            v-if="lane.accessible && lane.current_level"
            type="alertLevel"
            :value="lane.current_level"
            size="xs"
            :data-test="`alerts-composite-timeline-level-${lane.alert_id}`"
          />
        </div>
        <div class="rounded-default flex h-3 gap-0.5 overflow-hidden">
          <span
            v-for="(segment, i) in segments(lane)"
            :key="i"
            :class="segment.bg"
            class="h-full flex-1"
          />
        </div>
      </template>
    </div>

    <div
      v-else
      class="text-text-secondary py-6 text-center text-sm"
      data-test="alerts-composite-timeline-empty"
    >
      {{ t("alerts.composite.timelineEmpty") }}
    </div>

    <div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span class="flex items-center gap-1.5">
        <span class="bg-error-500 h-2 w-2 rounded-full" />{{ t("alerts.composite.firing") }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="bg-warning-500 h-2 w-2 rounded-full" />{{
          t("alerts.composite.legendWarning")
        }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="bg-success-500 h-2 w-2 rounded-full" />{{ t("alerts.composite.normal") }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="bg-surface-subtle h-2 w-2 rounded-full" />{{
          t("alerts.composite.legendNoData")
        }}
      </span>
    </div>
  </div>
</template>
