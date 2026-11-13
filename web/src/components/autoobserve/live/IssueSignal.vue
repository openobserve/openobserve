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
  <figure
    class="m-0 flex min-w-0 flex-col gap-1"
    :data-status="status"
    :data-test="`autoobserve-issue-signal-${size}`"
  >
    <figcaption
      v-if="size === 'card'"
      class="flex flex-wrap items-baseline gap-x-2 text-xs"
      data-test="autoobserve-issue-signal-title"
    >
      <span class="text-text-heading font-medium">{{
        t("autoobserve.issueLive.spark.title", { stream: raw(stream?.name ?? "") })
      }}</span>
      <span v-if="series && drawable" class="text-text-secondary ms-auto tabular-nums">{{
        status === "ready"
          ? t("autoobserve.issueLive.spark.yAxis", { peak: peakText })
          : t("autoobserve.issueLive.spark.empty")
      }}</span>
    </figcaption>
    <AoSparkline
      :series="points"
      :markers="markers"
      :expected="drawn?.expected"
      :band="drawn?.band"
      :highlights="drawn?.outside"
      :loading="status === 'loading'"
      :error="errorText"
      :height="size === 'card' ? 72 : 36"
      :label="label"
      :tone="active ? 'danger' : 'neutral'"
      :retryable="status === 'failed'"
      @retry="retry"
    />
    <div
      v-if="size === 'card'"
      class="text-text-secondary flex justify-between text-xs tabular-nums"
      :class="{ invisible: !drawable }"
      data-test="autoobserve-issue-signal-xaxis"
    >
      <span>{{ axis.start }}</span>
      <span>{{ axis.end }}</span>
    </div>
    <!-- The legend and note keep their lines while loading, so nothing below moves when the chart lands. -->
    <ul
      v-if="size === 'card'"
      class="flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1"
      :aria-label="t('autoobserve.issueLive.spark.legend')"
      data-test="autoobserve-issue-signal-legend"
    >
      <li
        v-for="m in drawable ? markers : []"
        :key="m.kind"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
      >
        <span class="size-2 rounded-full" :class="LEGEND_DOT[m.kind] ?? 'bg-border-strong'" />
        {{ m.label }}
      </li>
      <li
        v-for="key in drawable ? usualKeys : []"
        :key="key.kind"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
        :data-test="`autoobserve-issue-signal-key-${key.kind}`"
      >
        <span :class="key.swatch" />
        {{ key.label }}
      </li>
      <li
        v-if="drawable && usualNote"
        class="flex items-center gap-1 text-xs"
        :class="usualNote.tone === 'error' ? 'text-status-error-text' : 'text-text-secondary'"
        :role="usualNote.tone === 'error' ? 'alert' : undefined"
        data-test="autoobserve-issue-signal-usual"
      >
        {{ usualNote.text }}
        <OButton
          v-if="usualNote.tone === 'error' && baselineState.kind === 'failed'"
          variant="ghost-primary"
          size="xs"
          data-test="autoobserve-issue-signal-usual-retry"
          @click.stop="volume.retry()"
          >{{ t("autoobserve.issueLive.spark.retry") }}</OButton
        >
      </li>
    </ul>
    <p
      v-if="size === 'card'"
      class="text-text-secondary min-h-4 text-xs"
      data-test="autoobserve-issue-signal-no-before"
    >
      {{
        drawable && series && stream && issueNoRowsBefore(series)
          ? t("autoobserve.issueLive.spark.noBefore", { stream: raw(stream.name) })
          : ""
      }}
    </p>
    <!-- The caption keeps its line while loading, so the row never grows when the chart lands. -->
    <span
      v-else
      class="text-text-secondary min-h-4 truncate text-xs tabular-nums"
      data-test="autoobserve-issue-signal-caption"
      >{{ drawable && series ? caption : "" }}</span
    >
  </figure>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useNow } from "@/composables/useNow";
import OButton from "@/lib/core/Button/OButton.vue";
import AoSparkline from "./AoSparkline.vue";
import { issueBaselineNote, toIssueBaseline } from "./issueBaseline";
import {
  issueNoRowsBefore,
  issueSparkCaption,
  issueSparkLabel,
  issueSparkMarkers,
  issueSparkPoints,
  type IssueStreamInfo,
} from "./issueModel";
import { issueWindow } from "./issueSeries";
import { formatWhen } from "./liveCopy";
import { useLiveZone } from "./liveModel";
import { useAoVolumeSeries } from "./useAoVolumeSeries";
import { useIssueSeries } from "./useIssueSeries";

const props = withDefaults(
  defineProps<{
    stream: IssueStreamInfo | null;
    active: boolean;
    // Every view of one incident anchors on its lead's detection, so they share one query per stream.
    anchorUs?: number | null;
    // When the incident ended; undefined falls back to the stream's own return once it is resolved.
    endUs?: number | null;
    size?: "row" | "card";
  }>(),
  { size: "row", anchorUs: null, endUs: undefined },
);

const { t } = useI18nTyped();
const now = useNow();
const zone = useLiveZone();

const LEGEND_DOT: Record<string, string> = {
  detected: "bg-status-error-text",
  live: "bg-status-error-text",
  recovered: "bg-status-positive",
};

const window = computed(() => {
  const s = props.stream;
  if (!s) return null;
  const endUs = props.endUs !== undefined ? props.endUs : props.active ? null : s.recoveredUs;
  return issueWindow(props.anchorUs ?? s.firstSeenUs, now.value, endUs, props.active);
});
const { status, series, retry } = useIssueSeries(() => props.stream, window);
const volume = useAoVolumeSeries(() => (props.stream ? [props.stream] : []), window);

const baselineState = computed(() => volume.stateOf(props.stream));
const drawn = computed(() => {
  const state = baselineState.value;
  return "series" in state && window.value ? toIssueBaseline(state.series, window.value) : null;
});

// A stopped stream has no rows, so it draws its measured zeros from detection, not an empty box.
const drawable = computed(() => status.value === "ready" || status.value === "empty");

const points = computed(() =>
  drawable.value && series.value ? issueSparkPoints(series.value) : [],
);

const markers = computed(() =>
  drawable.value && series.value
    ? issueSparkMarkers(t, zone.value, series.value, props.stream, props.active)
    : [],
);

const usualKeys = computed(() => {
  const d = drawn.value;
  if (!d) return [];
  return [
    d.expected.length && {
      kind: "expected",
      swatch: "border-text-secondary w-3 border-t border-dashed",
      label: t("autoobserve.issueLive.usual.line"),
    },
    d.band.length && {
      kind: "band",
      swatch: "bg-text-secondary/20 dark:bg-text-secondary/45 h-2 w-3 rounded-xs",
      label: t("autoobserve.issueLive.usual.band"),
    },
    d.outside.length && {
      kind: "outside",
      swatch: "bg-status-error-text/15 dark:bg-status-error-text/40 h-2 w-3 rounded-xs",
      label: t("autoobserve.issueLive.usual.outside"),
    },
  ].filter((k) => !!k);
});

const usualNote = computed(() =>
  props.stream ? issueBaselineNote(t, baselineState.value, props.stream.name) : null,
);

const errorText = computed(() => {
  if (status.value === "denied")
    return String(
      t("autoobserve.issueLive.spark.denied", { stream: raw(props.stream?.name ?? "") }),
    );
  return status.value === "failed";
});

const label = computed(() =>
  series.value && props.stream
    ? String(issueSparkLabel(t, zone.value.locale, props.stream, series.value))
    : undefined,
);

const caption = computed(() => {
  if (!series.value) return "";
  if (status.value === "empty") return t("autoobserve.issueLive.spark.empty");
  return issueSparkCaption(t, zone.value.locale, series.value);
});

const peakText = computed(() =>
  raw(new Intl.NumberFormat(zone.value.locale).format(series.value?.peak ?? 0)),
);

const axis = computed(() => {
  const s = series.value;
  if (!s) return { start: "", end: "" };
  const endMs = s.startMs + s.points.length * s.stepMs;
  // The start is dated against today and the end against the start, so a window past midnight never reads as one day.
  const fmt = (ms: number, ref: number) =>
    formatWhen(ms, zone.value.locale, zone.value.timeZone, ref);
  return { start: fmt(s.startMs, now.value), end: fmt(endMs, s.startMs) };
});
</script>
