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
      <div class="flex w-52 flex-col gap-2">
        <OSkeleton shape="line" class="w-3/4" />
        <OSkeleton shape="line" class="w-1/2" />
      </div>
      <OSkeleton shape="block" class="h-8 w-64 max-md:hidden" />
      <OSkeleton shape="block" class="ms-auto h-8 w-24" />
    </div>

    <template v-else-if="failed || !view">
      <span class="text-text-body text-sm" data-test="alerts-anomalysummarystrip-error">
        {{ t("alerts.anomaly.stripLoadFailed") }}
      </span>
      <OButton
        variant="secondary"
        icon="refresh"
        data-test="alerts-anomalysummarystrip-retry"
        @click="emit('retry')"
      >
        {{ t("common.retry") }}
      </OButton>
    </template>

    <template v-else>
      <div
        class="flex max-w-96 min-w-52 shrink-0 flex-col gap-1 max-md:min-w-0 max-md:shrink"
        :data-test="`alerts-anomalysummarystrip-state-${view.state}`"
      >
        <div class="flex items-center gap-2 text-sm whitespace-nowrap">
          <OBadge
            :tone="chip.tone"
            :dot="view.state === 'ongoing'"
            data-test="alerts-anomalysummarystrip-chip"
          >
            {{ chip.label }}
          </OBadge>
          <span
            v-if="fact"
            class="text-text-heading font-semibold"
            data-test="alerts-anomalysummarystrip-fact"
          >
            {{ fact.text }}<OTooltip v-if="fact.utc" :content="fact.utc" />
          </span>
          <span
            v-if="secondary"
            class="text-text-secondary text-xs"
            data-test="alerts-anomalysummarystrip-secondary"
          >
            {{ secondary.text }}<OTooltip v-if="secondary.utc" :content="secondary.utc" />
          </span>
        </div>
        <OTruncatedText
          v-if="measureLine"
          class="text-text-secondary text-xs"
          data-test="alerts-anomalysummarystrip-measure"
          >{{ measureLine }}</OTruncatedText
        >
      </div>

      <div
        class="border-border-subtle flex min-w-0 flex-1 items-center self-stretch border-s ps-4 max-md:basis-full max-md:border-s-0 max-md:ps-0"
        data-test="alerts-anomalysummarystrip-middle"
      >
        <dl
          v-if="readings.length"
          class="flex items-center max-md:flex-wrap max-md:gap-y-2"
          data-test="alerts-anomalysummarystrip-readings"
        >
          <div
            v-for="(reading, index) in readings"
            :key="reading.key"
            class="flex flex-col gap-0.5"
            :class="index < readings.length - 1 ? 'border-border-subtle me-4 border-e pe-4' : ''"
            :data-test="`alerts-anomalysummarystrip-${reading.key}`"
          >
            <dt class="text-text-secondary text-2xs flex items-center gap-1.5 whitespace-nowrap">
              {{ reading.label }}
              <span
                v-if="reading.incomplete"
                class="text-status-warning-text"
                data-test="alerts-anomalysummarystrip-incomplete"
                >{{ t("alerts.anomaly.stripIncompleteShort") }}</span
              >
            </dt>
            <dd
              class="text-lg leading-6 font-semibold whitespace-nowrap tabular-nums"
              :class="reading.error ? 'text-status-error-text' : 'text-text-heading'"
              data-test="alerts-anomalysummarystrip-value"
            >
              {{ reading.value }}
            </dd>
          </div>
        </dl>
        <span
          v-else-if="message"
          class="text-text-heading text-sm"
          data-test="alerts-anomalysummarystrip-message"
        >
          {{ message.text }}<OTooltip v-if="message.utc" :content="message.utc" />
        </span>
        <span
          v-if="view.incomplete && !actualShown"
          class="text-status-warning-text ms-3.5 text-xs whitespace-nowrap"
          data-test="alerts-anomalysummarystrip-incomplete"
        >
          {{ t("alerts.anomaly.stripIncomplete") }}
        </span>
      </div>

      <div class="ms-auto flex shrink-0 items-center gap-2">
        <OButton
          v-if="response?.url"
          variant="primary"
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
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { ChipTone } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { AnomalyExploreResponse } from "@/types/anomalyExplore";
import {
  anomalyStripView,
  changeArrow,
  durationParts,
  formatAnomalyNumber,
  formatAnomalyTime,
  formatAnomalyTimeUtc,
  formatChangePercent,
  stripConfigOf,
} from "@/utils/alerts/anomalyExploreView";

const props = defineProps<{
  response: AnomalyExploreResponse | null;
  loading: boolean;
  failed: boolean;
  config: Record<string, any> | null;
  nowUs: number;
}>();

const emit = defineEmits<{
  retry: [];
  open: [url: string];
}>();

const { t } = useI18nTyped();

/** A text that may carry a time; `utc` is that time for the tooltip. */
interface TimedText {
  text: I18nText;
  utc: I18nText | null;
}

const view = computed(() =>
  props.response
    ? anomalyStripView(props.response, stripConfigOf(props.config), props.nowUs)
    : null,
);

const time = (us: number) => formatAnomalyTime(us, props.nowUs);
const utc = (us: number) => t("alerts.anomaly.stripTimeUtc", { time: formatAnomalyTimeUtc(us) });

const duration = (ms: number | null): I18nText | null => {
  const parts = ms === null ? null : durationParts(ms);
  if (!parts) return null;
  if (parts.h === 0) return t("alerts.anomaly.stripDurationM", { m: parts.m });
  return parts.m === 0
    ? t("alerts.anomaly.stripDurationH", { h: parts.h })
    : t("alerts.anomaly.stripDurationHm", parts);
};

const since = (us: number): TimedText => ({
  text: t("alerts.anomaly.stripSince", { time: time(us) }),
  utc: utc(us),
});

const chip = computed<{ label: I18nText; tone: ChipTone }>(() => {
  switch (view.value?.state) {
    case "ongoing":
      return { label: t("alerts.anomaly.stripOngoing"), tone: "err" };
    case "back_in_range":
      return { label: t("alerts.anomaly.stripBackInRange"), tone: "neutral" };
    case "no_new_data":
      return { label: t("alerts.anomaly.stripNoNewDataChip"), tone: "warn" };
    case "no_recent_runs":
      return { label: t("alerts.anomaly.stripNoRecentRuns"), tone: "warn" };
    case "learning":
      return { label: t("alerts.anomaly.stripLearningChip"), tone: "neutral" };
    case "paused":
      return { label: t("alerts.anomaly.stripPausedChip"), tone: "neutral" };
    default:
      return { label: t("alerts.anomaly.stripInRange"), tone: "neutral" };
  }
});

/** Line 1: the main fact after the chip, then one secondary fact. */
const facts = computed<{ fact: TimedText | null; secondary: TimedText | null }>(() => {
  const v = view.value;
  const none = { fact: null, secondary: null };
  if (!v) return none;
  switch (v.state) {
    case "ongoing": {
      if (v.startedUs === null) return none;
      if (v.startedBefore) {
        const text = t("alerts.anomaly.stripStartedBefore", { time: time(v.startedUs) });
        return { fact: { text, utc: utc(v.startedUs) }, secondary: null };
      }
      const lasting = duration(v.ongoingMs);
      if (!lasting) return { fact: since(v.startedUs), secondary: null };
      const text = t("alerts.anomaly.stripFor", { duration: lasting });
      return { fact: { text, utc: null }, secondary: since(v.startedUs) };
    }
    case "back_in_range": {
      if (v.sinceUs === null) return none;
      const lasted = duration(v.lastedMs);
      return {
        fact: since(v.sinceUs),
        secondary: lasted
          ? { text: t("alerts.anomaly.stripLasted", { duration: lasted }), utc: null }
          : null,
      };
    }
    case "no_new_data":
      return v.noNewDataSinceUs === null
        ? none
        : { fact: since(v.noNewDataSinceUs), secondary: null };
    case "no_recent_runs":
      if (v.lastRunUs === null) return none;
      return {
        fact: {
          text: t("alerts.anomaly.stripLastRun", { time: time(v.lastRunUs) }),
          utc: utc(v.lastRunUs),
        },
        secondary: null,
      };
    default:
      return none;
  }
});
const fact = computed(() => facts.value.fact);
const secondary = computed(() => facts.value.secondary);

const isAbsence = computed(
  () => view.value?.state === "ongoing" && view.value.summary?.kind === "absence",
);

const measureLine = computed<I18nText | null>(() => {
  const res = props.response;
  if (!res) return null;
  if (!res.measure) return res.stream ? raw(res.stream) : null;
  if (!res.stream) return raw(res.measure);
  return t("alerts.anomaly.stripMeasure", { measure: raw(res.measure), stream: raw(res.stream) });
});

/** The one sentence of a state with no readings. */
const message = computed<TimedText | null>(() => {
  const v = view.value;
  if (!v) return null;
  switch (v.state) {
    case "ongoing": {
      if (!isAbsence.value) return null;
      // since_us is when this absence began; the episode can start earlier with high values.
      const at = v.summary?.since_us ?? v.summary?.started_us ?? v.startedUs;
      return at === null
        ? { text: t("alerts.anomaly.stripAbsence"), utc: null }
        : { text: t("alerts.anomaly.stripAbsenceSince", { time: time(at) }), utc: utc(at) };
    }
    case "back_in_range": {
      if (v.summary?.kind !== "absence" || v.sinceUs === null) return null;
      const text = t("alerts.anomaly.stripAbsenceReturned", { time: time(v.sinceUs) });
      return { text, utc: utc(v.sinceUs) };
    }
    case "no_new_data":
      return { text: t("alerts.anomaly.stripNoNewDataText"), utc: null };
    case "no_recent_runs":
      return { text: t("alerts.anomaly.stripNoRecentRunsText"), utc: null };
    case "learning":
      return { text: t("alerts.anomaly.stripLearning"), utc: null };
    case "paused":
      return { text: t("alerts.anomaly.stripPaused"), utc: null };
    case "none":
      return { text: t("alerts.anomaly.stripNoAnomalies"), utc: null };
    default:
      return null;
  }
});

interface Reading {
  key: "actual" | "expected" | "change";
  label: I18nText;
  value: string;
  error: boolean;
  incomplete: boolean;
}

const readings = computed<Reading[]>(() => {
  const v = view.value;
  const s = v?.summary;
  if (!v || !s || s.kind === "absence") return [];
  const ongoing = v.state === "ongoing";
  const out: Reading[] = [];
  if (s.actual !== null) {
    out.push({
      key: "actual",
      label: ongoing ? t("alerts.anomaly.stripActual") : t("alerts.anomaly.stripWorst"),
      value: formatAnomalyNumber(s.actual),
      error: ongoing,
      incomplete: ongoing && v.incomplete,
    });
  }
  const expected = (value: string): Reading => ({
    key: "expected",
    label: t("alerts.anomaly.stripExpected"),
    value,
    error: false,
    incomplete: false,
  });
  if (s.kind === "value" && s.expected_lower !== null && s.expected_upper !== null) {
    out.push(
      expected(
        `${formatAnomalyNumber(s.expected_lower)} – ${formatAnomalyNumber(s.expected_upper)}`,
      ),
    );
  } else if (s.expected !== null) {
    out.push(expected(formatAnomalyNumber(s.expected)));
  }
  if (s.change_percent !== null) {
    out.push({
      key: "change",
      label: t("alerts.anomaly.stripChange"),
      value: `${changeArrow(s.change_percent)} ${formatChangePercent(s.change_percent)}`.trim(),
      error: ongoing,
      incomplete: false,
    });
  }
  return out;
});

const actualShown = computed(() => readings.value.some((r) => r.incomplete));
</script>
