<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!-- Readings of one clicked anomaly bucket; only a bucket of the current model links to its data. -->
<template>
  <OPopover
    :open="open"
    :anchor="anchor"
    side="top"
    align="center"
    :aria-label="t('alerts.anomaly.pointAriaLabel')"
    @update:open="emit('update:open', $event)"
  >
    <div
      v-if="row"
      class="flex w-64 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
      data-test="alerts-anomalypointpopover"
    >
      <span
        class="text-text-heading text-sm font-semibold"
        data-test="alerts-anomalypointpopover-range"
      >
        {{ rangeText }}
      </span>
      <dl class="flex flex-col gap-1 text-sm">
        <div v-if="actual !== null" class="flex justify-between gap-3">
          <dt class="text-text-secondary">{{ t("alerts.anomaly.stripActual") }}</dt>
          <dd class="text-text-heading font-semibold" data-test="alerts-anomalypointpopover-actual">
            {{ formatAnomalyNumber(actual) }}
          </dd>
        </div>
        <div v-if="expectedText" class="flex justify-between gap-3">
          <dt class="text-text-secondary">{{ t("alerts.anomaly.stripExpected") }}</dt>
          <dd class="text-text-heading" data-test="alerts-anomalypointpopover-expected">
            {{ expectedText }}
          </dd>
        </div>
      </dl>
      <span
        v-if="!current"
        class="text-text-secondary text-xs"
        data-test="alerts-anomalypointpopover-older-model"
      >
        {{ t("alerts.anomaly.pointOlderModel") }}
      </span>
      <OButton
        v-else
        variant="primary"
        size="sm"
        :loading="loading"
        data-test="alerts-anomalypointpopover-open"
        @click="emit('open-bucket')"
      >
        {{ buttonLabel }}
      </OButton>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { AnomalyBandRow } from "@/utils/alerts/anomalyBandChart";
import {
  formatAnomalyNumber,
  formatChangePercent,
  formatUtcHm,
} from "@/utils/alerts/anomalyExploreView";

const props = defineProps<{
  open: boolean;
  anchor: Element | null;
  row: AnomalyBandRow | null;
  bucketMs: number | null;
  current: boolean;
  loading: boolean;
  streamType?: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  "open-bucket": [];
}>();

const { t } = useI18nTyped();

const actual = computed(() => props.row?.value ?? props.row?.flagged ?? null);

const rangeText = computed<I18nText>(() => {
  const row = props.row;
  if (!row) return raw("");
  const start = formatUtcHm(row.tsMs * 1000);
  const end = formatUtcHm((row.tsMs + (props.bucketMs ?? 0)) * 1000);
  return t("alerts.anomaly.pointRange", { start, end });
});

const expectedText = computed(() => {
  const row = props.row;
  if (!row || row.lower === null || row.upper === null) return "";
  const range = `${formatAnomalyNumber(row.lower)}-${formatAnomalyNumber(row.upper)}`;
  const value = actual.value;
  if (value === null || row.expected === null || row.expected === 0) return range;
  const change = ((value - row.expected) / Math.abs(row.expected)) * 100;
  return `${range} (${formatChangePercent(change)})`;
});

const buttonLabel = computed(() => {
  if (props.streamType === "traces") return t("alerts.anomaly.pointOpenTraces");
  if (props.streamType === "metrics") return t("alerts.anomaly.pointOpenMetrics");
  return t("alerts.anomaly.pointOpenLogs");
});
</script>
