<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <div class="text-xs" data-test="field-panel-duration-percentiles">
    <div v-if="isLoading" class="flex justify-center py-2">
      <OSpinner size="xs" />
    </div>
    <template v-else-if="hasPercentiles">
      <div
        v-for="p in percentileRows"
        :key="p.key"
        class="hover:bg-field-list-row-hover-bg flex h-6 items-center gap-2 ps-4 pe-2"
        :data-test="`field-panel-duration-${p.key}`"
      >
        <span class="text-text-secondary w-8 shrink-0">{{ p.label }}</span>
        <span class="text-field-list-label-text flex-1 font-mono">{{
          formatPercentile(percentiles[p.key])
        }}</span>
        <span class="flex gap-0.5">
          <OButton
            v-if="p.key !== 'max'"
            variant="ghost-primary"
            size="icon-chip"
            :aria-label="t('common.durationGte', { value: formatPercentile(percentiles[p.key]) })"
            :data-test="`field-panel-duration-gte-${p.key}`"
            @click.stop="emitFilter('>=', percentiles[p.key])"
          >
            {{ raw("≥") }}
          </OButton>
          <OButton
            variant="ghost-primary"
            size="icon-chip"
            :aria-label="t('common.durationLte', { value: formatPercentile(percentiles[p.key]) })"
            :data-test="`field-panel-duration-lte-${p.key}`"
            @click.stop="emitFilter('<=', percentiles[p.key])"
          >
            {{ raw("≤") }}
          </OButton>
        </span>
      </div>
    </template>
    <div v-else class="text-text-secondary py-1 ps-4">
      {{ errMsg || t("common.noValuesFound") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import useDurationPercentiles from "@/composables/useDurationPercentiles";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import type { ValuesRequest } from "./fieldPanel.types";

const props = defineProps<{
  request: ValuesRequest;
}>();

const emit = defineEmits<{
  "add-filter": [expression: string];
}>();

const { t } = useI18nTyped();

const PERCENTILE_LABELS = [
  { key: "p25", label: raw("P25") },
  { key: "p50", label: raw("P50") },
  { key: "p75", label: raw("P75") },
  { key: "p95", label: raw("P95") },
  { key: "p99", label: raw("P99") },
  { key: "max", label: t("traces.max") },
] as const;

const { percentiles, isLoading, errMsg, fetchPercentiles, cancelFetch } = useDurationPercentiles(t);

// A percentile the server left out has no bound to filter on, so it gets no row.
const percentileRows = computed(() =>
  PERCENTILE_LABELS.filter((p) => percentiles.value[p.key] !== null),
);
const hasPercentiles = computed(() => percentileRows.value.length > 0);

const formatPercentile = (value: number | null) => formatTimeWithSuffix(value ?? 0);

function load() {
  cancelFetch();
  fetchPercentiles({
    streamName: props.request.streamName,
    startTime: props.request.startTime,
    endTime: props.request.endTime,
    whereClause: props.request.whereClause,
  });
}

// Raw microseconds: a bound cut to the label or a whole number drops the slowest span.
function emitFilter(op: ">=" | "<=", value: number | null) {
  if (value === null) return;
  emit("add-filter", `duration${op}${value}`);
}

onMounted(load);

// Separate sources compare by value; the parent builds a fresh request object on every render.
watch(
  [
    () => props.request.streamName,
    () => props.request.whereClause,
    () => props.request.startTime,
    () => props.request.endTime,
  ],
  load,
);

onBeforeUnmount(cancelFetch);
</script>
