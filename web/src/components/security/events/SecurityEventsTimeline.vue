<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import {
  TONE_SEVERITY_IDS,
  type HistogramResult,
  type SeverityValue,
} from "@/utils/security/eventQuery";
import {
  SEVERITY_TONES,
  TONE_ICON,
  TONE_STAT,
  TONE_TOKEN,
  toneLabelKey,
  type SeverityTone,
} from "@/utils/security/severity";

const props = defineProps<{
  histogram: HistogramResult | null;
  loading: boolean;
  /** Whether the stream has a severity the server can read; without one the chart is plain volume. */
  hasSeverity: boolean;
  /** Window, µs. */
  start: number;
  end: number;
}>();
const severity = defineModel<SeverityValue[]>("severity", { required: true });
const emit = defineEmits<{ zoom: [range: { start: number; end: number }] }>();
const { t } = useI18nTyped();

/** Tones drawn: the five, plus Unknown when events carry no readable severity. */
const shownTones = computed<SeverityTone[]>(() =>
  props.histogram?.totals.unknown ? [...SEVERITY_TONES, "unknown"] : [...SEVERITY_TONES],
);

const chartSeries = computed(() =>
  props.hasSeverity
    ? [...shownTones.value].reverse().map((tone) => ({
        key: tone,
        label: t(toneLabelKey(tone)),
        token: TONE_TOKEN[tone],
      }))
    : [{ key: "info", label: t("siem.events.events"), token: "--color-accent" as const }],
);

const valuesForTone = (tone: SeverityTone): SeverityValue[] => TONE_SEVERITY_IDS[tone];

const stats = computed<StatItem[]>(() => {
  const h = props.histogram;
  // No "All" tile: re-clicking a picked tile drops it, and Clear empties the facet.
  return shownTones.value.map((tone) => ({
    key: tone,
    label: t(toneLabelKey(tone)),
    value: h ? h.totals[tone] : "—",
    icon: TONE_ICON[tone],
    tone: TONE_STAT[tone],
    max: h?.total || undefined,
    dataTest: `security-events-severity-${tone}`,
  }));
});

// A tile reads as picked while every severity value it covers is in the filter.
const selectedTones = computed<SeverityTone[]>(() => {
  const current = new Set(severity.value.map(String));
  return shownTones.value.filter((tone) =>
    valuesForTone(tone).every((v) => current.has(String(v))),
  );
});
const highlightTone = computed(() =>
  selectedTones.value.length === 1 ? selectedTones.value[0] : null,
);

function onTones(keys: string[]) {
  severity.value = (keys as SeverityTone[]).flatMap((tone) => valuesForTone(tone));
}
</script>

<template>
  <div
    class="px-page-edge border-border-default flex shrink-0 flex-col gap-2 border-b py-2"
    data-test="security-events-timeline"
  >
    <OStatStrip
      v-if="hasSeverity"
      compact-values
      data-test="security-events-severity-strip"
      :items="stats"
      :loading="loading && !histogram"
      selectable
      :row="false"
      multiple
      :selected-keys="selectedTones"
      @update:selected-keys="onTones"
    />
    <div class="h-28">
      <SecuritySeverityChart
        :buckets="histogram?.buckets ?? []"
        :series="chartSeries"
        :loading="loading"
        :highlight="highlightTone"
        :min="Math.floor(start / 1000)"
        :max="Math.ceil(end / 1000)"
        zoomable
        data-test="security-events-chart"
        @zoom="emit('zoom', $event)"
      />
    </div>
  </div>
</template>
