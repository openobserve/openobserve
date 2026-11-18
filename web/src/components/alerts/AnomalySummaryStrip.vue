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

<!-- The detector's current state, from the explore endpoint only, so it never follows the chart's range. -->
<template>
  <div
    class="rounded-default border-border-default bg-surface-base flex h-18 items-center gap-4 border px-4 max-md:h-auto max-md:min-h-18 max-md:flex-wrap max-md:gap-2 max-md:py-2"
    data-test="alerts-anomalysummarystrip"
  >
    <div
      v-if="loading"
      class="flex w-full items-center gap-4"
      data-test="alerts-anomalysummarystrip-loading"
    >
      <div class="flex w-48 flex-col gap-2">
        <OSkeleton type="text" class="w-3/4" />
        <OSkeleton type="text" class="w-1/2" />
      </div>
      <OSkeleton type="rect" class="h-8 w-60 max-md:hidden" />
      <OSkeleton type="rect" class="ms-auto h-8 w-24" />
    </div>

    <template v-else-if="failed || !view">
      <span class="text-text-body text-sm" data-test="alerts-anomalysummarystrip-error">
        {{ t("alerts.anomaly.stripLoadFailed") }}
      </span>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        data-test="alerts-anomalysummarystrip-retry"
        @click="emit('retry')"
      >
        {{ t("common.retry") }}
      </OButton>
    </template>

    <template v-else>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span
          class="text-sm font-semibold"
          :class="view.state === 'ongoing' ? 'text-status-error-text' : 'text-text-heading'"
          :data-test="`alerts-anomalysummarystrip-state-${view.state}`"
        >
          {{ title }}
        </span>
        <span
          v-if="view.noNewDataSinceUs !== null && view.state === 'ongoing'"
          class="text-text-secondary text-xs"
          data-test="alerts-anomalysummarystrip-nonewdata"
        >
          {{ t("alerts.anomaly.stripNoNewData", { time: formatUtcHm(view.noNewDataSinceUs) }) }}
        </span>
      </div>

      <span
        v-if="absenceText"
        class="text-text-body text-sm"
        data-test="alerts-anomalysummarystrip-absence"
      >
        {{ absenceText }}
      </span>
      <dl
        v-else-if="readings.length"
        class="flex items-center gap-4 max-md:flex-wrap"
        data-test="alerts-anomalysummarystrip-readings"
      >
        <div
          v-for="reading in readings"
          :key="reading.key"
          class="flex flex-col"
          :data-test="`alerts-anomalysummarystrip-${reading.key}`"
        >
          <dt class="text-text-secondary text-xs">{{ reading.label }}</dt>
          <dd class="text-text-heading text-sm font-semibold">{{ reading.value }}</dd>
        </div>
      </dl>

      <span
        v-if="view.incomplete"
        class="text-status-warning-text text-xs"
        data-test="alerts-anomalysummarystrip-incomplete"
      >
        {{ t("alerts.anomaly.stripIncomplete") }}
      </span>

      <div class="ms-auto flex shrink-0 items-center gap-2">
        <OButton
          v-if="askAi"
          variant="ai-gradient"
          size="sm-action"
          icon-left="bolt"
          data-test="alerts-anomalysummarystrip-ask-ai"
          @click="emit('ask-ai')"
        >
          {{ t("alerts.anomaly.stripAskAi") }}
        </OButton>
        <OButton
          v-if="response?.url"
          variant="primary"
          size="sm-action"
          data-test="alerts-anomalysummarystrip-open"
          @click="emit('open', response.url)"
        >
          {{ raw(response.label) || t("alerts.anomaly.stripOpenData") }}
        </OButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { AnomalyExploreResponse } from "@/types/anomalyExplore";
import {
  anomalyStripView,
  durationParts,
  formatAnomalyNumber,
  formatChangePercent,
  formatUtcHm,
  stripConfigOf,
} from "@/utils/alerts/anomalyExploreView";

const props = defineProps<{
  response: AnomalyExploreResponse | null;
  loading: boolean;
  failed: boolean;
  config: Record<string, any> | null;
  nowUs: number;
  askAi?: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  open: [url: string];
  "ask-ai": [];
}>();

const { t } = useI18nTyped();

const view = computed(() =>
  props.response
    ? anomalyStripView(props.response, stripConfigOf(props.config), props.nowUs)
    : null,
);

const duration = (ms: number | null): I18nText | null => {
  const parts = ms === null ? null : durationParts(ms);
  if (!parts) return null;
  return parts.h > 0
    ? t("alerts.anomaly.stripDurationHm", parts)
    : t("alerts.anomaly.stripDurationM", { m: parts.m });
};

const title = computed<I18nText>(() => {
  const v = view.value;
  if (!v) return raw("");
  switch (v.state) {
    case "ongoing":
      if (v.startedUs === null) return t("alerts.anomaly.stripOngoing");
      return v.startedBefore
        ? t("alerts.anomaly.stripOngoingBefore", { time: formatUtcHm(v.startedUs) })
        : t("alerts.anomaly.stripOngoingSince", { time: formatUtcHm(v.startedUs) });
    case "back_in_range": {
      if (v.sinceUs === null) return t("alerts.anomaly.stripBackInRange");
      const lasted = duration(v.lastedMs);
      const time = formatUtcHm(v.sinceUs);
      return lasted
        ? t("alerts.anomaly.stripBackInRangeLasted", { time, duration: lasted })
        : t("alerts.anomaly.stripBackInRangeSince", { time });
    }
    case "paused":
      return t("alerts.anomaly.stripPaused");
    case "no_recent_runs":
      return v.lastRunUs === null
        ? t("alerts.anomaly.stripNoRecentRuns")
        : t("alerts.anomaly.stripNoRecentRunsAt", { time: formatUtcHm(v.lastRunUs) });
    case "no_new_data":
      return t("alerts.anomaly.stripNoNewData", { time: formatUtcHm(v.noNewDataSinceUs ?? 0) });
    case "learning":
      return t("alerts.anomaly.stripLearning");
    default:
      return t("alerts.anomaly.stripNoAnomalies");
  }
});

const absenceText = computed<I18nText | null>(() => {
  const s = view.value?.summary;
  if (!s || s.kind !== "absence" || view.value?.state !== "ongoing") return null;
  // since_us is when this absence began; the episode can start earlier with high values.
  const since = s.since_us ?? s.started_us ?? view.value.startedUs;
  const stream = raw(props.response?.stream ?? "");
  return since === null
    ? t("alerts.anomaly.stripAbsence", { stream })
    : t("alerts.anomaly.stripAbsenceSince", { stream, time: formatUtcHm(since) });
});

const readings = computed(() => {
  const v = view.value;
  const s = v?.summary;
  if (!v || !s || s.kind === "absence") return [];
  const out: Array<{ key: string; label: I18nText; value: string }> = [];
  if (s.actual !== null) {
    out.push({
      key: "actual",
      label:
        v.state === "back_in_range"
          ? t("alerts.anomaly.stripPeak")
          : t("alerts.anomaly.stripActual"),
      value: formatAnomalyNumber(s.actual),
    });
  }
  if (v.state === "back_in_range") return out;
  if (s.kind === "value" && s.expected_lower !== null && s.expected_upper !== null) {
    out.push({
      key: "expected",
      label: t("alerts.anomaly.stripExpected"),
      value: `${formatAnomalyNumber(s.expected_lower)}-${formatAnomalyNumber(s.expected_upper)}`,
    });
  } else if (s.expected !== null) {
    out.push({
      key: "expected",
      label: t("alerts.anomaly.stripExpected"),
      value: formatAnomalyNumber(s.expected),
    });
  }
  if (s.change_percent !== null) {
    out.push({
      key: "change",
      label: t("alerts.anomaly.stripChange"),
      value: formatChangePercent(s.change_percent),
    });
  }
  return out;
});
</script>
