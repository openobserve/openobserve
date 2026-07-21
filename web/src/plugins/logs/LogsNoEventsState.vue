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
  LogsNoEventsState — context-aware empty state for the logs search page.

  Three distinct states based on stream stats vs. current window:

    1. The selected range has no data but the stream does — either the window
       misses the data entirely, or (with no filter) it overlaps the stream's
       min/max envelope yet lands in a gap with no records
       → "Jump to latest data" card (last 15 min around doc_time_max)

    2. Window overlaps stream data but a filter excluded everything
       → "relax your filters" message (no action card; Ask AI / history below)

    3. No stream stats available (fallback)
       → generic message (no action card; Ask AI / history below)

  Emits action IDs to the parent rather than mutating state directly.
  The "Ask AI" ghost button is only shown when aiEnabled is true.
-->
<template>
  <OEmptyState illustration="logs" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noEvents.title") }}</template>

    <template #description>
      <!-- Filter applied within an overlapping window: relax the query. -->
      <span v-if="windowHasStreamData && hasFilters" v-html="t('logs.noEvents.descWithFilters')" />
      <!-- We know where the stream's last data is: offer to jump to it. -->
      <span v-else-if="jumpTarget">{{ t("logs.noEvents.descOutOfRange") }}</span>
      <!-- No stream stats: generic fallback. -->
      <span v-else>{{ t("logs.noEvents.descNoFilters", { range: currentPeriodLabel }) }}</span>
    </template>

    <template #actions>
      <!-- The selected range has no data but the stream does (out of range, or a
           no-filter window in a gap): offer a precise jump to the latest data. -->
      <EmptyStateActionCard
        v-if="jumpTarget"
        icon="schedule"
        :label="t('logs.noEvents.jumpToData')"
        :sublabel="jumpTargetSublabel"
        data-test="logs-no-events-jump-to-data-card"
        @click="emit('jump-to-stream-data', jumpTarget!.from, jumpTarget!.to)"
      />
      <!-- Filter excluded everything within an overlapping window: no action
           card — the user relaxes the query themselves (Ask AI / history below). -->
    </template>

    <template #extra>
      <div class="flex items-center justify-center gap-2 flex-wrap">
        <OButton
          variant="ghost"
          size="sm"
          icon-left="history"
          data-test="logs-no-events-open-history-btn"
          @click="emit('open-history')"
        >
          {{ t("logs.noEvents.openHistory") }}
        </OButton>
        <OButton
          v-if="aiEnabled && windowHasStreamData && !jumpTarget"
          variant="ghost"
          size="sm"
          class="ai-hover-btn"
          data-test="logs-no-events-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon-left>
            <img :src="aiIconSrc" class="w-4 h-4 shrink-0" alt="" />
          </template>
          {{ t("logs.noEvents.askAi") }}
        </OButton>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useAiIcon } from "@/composables/useAiIcon";
import { DateTime } from "luxon";
import { periodToLabel } from "@/composables/useWidenRange";

const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
// Backend uses exclusive end boundary, so nudge end by 1s to include the record at doc_time_max.
const END_NUDGE_US = 1_000_000;

const props = defineProps<{
  sqlMode: boolean;
  query: string;
  editorValue: string;
  relativeTimePeriod: string;
  dateType: string;
  aiEnabled: boolean;
  /** doc_time_min/max from stream stats, in microseconds. */
  streamDocTimeRange?: { min: number; max: number };
  /** Resolved microsecond bounds of the active query window. */
  queryWindowUs?: { start: number; end: number };
  /** User-selected timezone string, e.g. "America/New_York" or "UTC". */
  timezone?: string;
}>();

const emit = defineEmits<{
  "jump-to-stream-data": [fromUs: number, toUs: number];
  "open-history": [];
  "ask-ai": [];
}>();

const { t } = useI18n();
const { aiIconSrc } = useAiIcon();

// --- filter detection -------------------------------------------------------

const hasFilters = computed<boolean>(() => {
  if (props.sqlMode) return /\bWHERE\b/i.test(props.editorValue || "");
  return (props.query || "").trim().length > 0;
});

// --- stream data vs. window overlap -----------------------------------------

/**
 * True when the current query window overlaps the stream's known data range.
 * If stream stats are unavailable we assume overlap (conservative fallback).
 */
const windowHasStreamData = computed<boolean>(() => {
  const r = props.streamDocTimeRange;
  const w = props.queryWindowUs;
  if (!r || !w) return true;
  // Allow 1-second tolerance: setAbsoluteTime round-trips through date strings
  // and loses sub-second precision, so w.end may be fractionally less than r.max.
  const TOLERANCE_US = 30_000_000;
  return w.start <= r.max + TOLERANCE_US && w.end >= r.min - TOLERANCE_US;
});

/**
 * A 15-minute window ending at doc_time_max so the user lands on the most
 * recent data. Offered whenever we know where the stream's last data is and the
 * failure isn't caused by a filter.
 */
const jumpTarget = computed<{ from: number; to: number } | null>(() => {
  const r = props.streamDocTimeRange;
  if (!r) return null;
  // A filter — not the range — is excluding records within an overlapping
  // window, so jumping won't help; the user should relax the query instead.
  if (windowHasStreamData.value && hasFilters.value) return null;
  // Otherwise point at the stream's most recent data. This covers both a window
  // entirely outside the data range AND a no-filter window that overlaps the
  // [min,max] envelope but lands in a gap with no records — since there are no
  // filters and zero results, doc_time_max is guaranteed to sit outside the
  // window, so a 15-minute jump there always surfaces data.
  return { from: r.max - FIFTEEN_MINS_US, to: r.max + END_NUDGE_US };
});

const jumpTargetSublabel = computed(() => {
  if (!jumpTarget.value) return "";
  const tz = props.timezone || "UTC";
  const zone = tz.toLowerCase() === "local" || tz.toLowerCase() === "browser"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : tz;
  // Show doc_time_max (before nudge) as the "last data" label
  const lastDataUs = props.streamDocTimeRange!.max;
  const formatted = DateTime
    .fromMillis(lastDataUs / 1000)
    .setZone(zone)
    .toFormat("MMM d, yyyy HH:mm:ss");
  return t("logs.logsNoEventsState.lastData", { formatted, zone });
});

// --- time-range helpers ------------------------------------------------------

// `currentPeriodLabel` feeds the "descNoFilters" message. The widen-range
// action card was removed because widening never surfaces more data here.
const isRelative = computed(() => props.dateType === "relative" && !!props.relativeTimePeriod);
const currentPeriodLabel = computed(() =>
  isRelative.value ? periodToLabel(props.relativeTimePeriod) : t("logs.noEvents.selectedRange"),
);

</script>
