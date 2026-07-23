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
  TracesNoEventsState — context-aware empty state for the traces search result area.

  Three distinct states based on stream stats vs. current window:

    1. The selected range has no data but the stream does — either the window
       misses the data entirely, or (with no filter) it overlaps the stream's
       min/max envelope yet lands in a gap with no records
       → "Jump to latest data" card (last 15 min around doc_time_max)

    2. Window overlaps stream data but a filter excluded everything
       → "relax your filters" message (no action card; Ask AI available)

    3. No stream stats available (fallback)
       → generic message (no action card; Ask AI available)
-->
<template>
  <OEmptyState illustration="trace" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noEvents.title") }}</template>

    <template #description>
      <!-- Filter applied within an overlapping window: relax the query. -->
      <span
        v-if="windowHasStreamData && hasFilters"
        v-html="t('traces.noEvents.descWithFilters')"
      />
      <!-- We know where the stream's last data is: offer to jump to it. -->
      <span v-else-if="jumpTarget">{{ t("traces.noEvents.descOutOfRange") }}</span>
      <!-- No stream stats: generic fallback. -->
      <span v-else>{{ t("traces.noEvents.descNoFilters", { range: currentPeriodLabel }) }}</span>
    </template>

    <template #actions>
      <!-- The selected range has no data but the stream does (out of range, or a
           no-filter window in a gap): offer a precise jump to the latest data. -->
      <EmptyStateActionCard
        v-if="jumpTarget"
        icon="schedule"
        :label="t('traces.noEvents.jumpToData')"
        :sublabel="jumpTargetSublabel"
        data-test="traces-no-events-jump-to-data-card"
        @click="emit('jump-to-stream-data', jumpTarget.from, jumpTarget.to)"
      />
      <!-- Filter excluded everything within an overlapping window: no action
           card — the user is guided to relax the query themselves (and Ask AI). -->
    </template>

    <template #extra>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <OButton
          v-if="aiEnabled && windowHasStreamData && !jumpTarget"
          variant="ghost"
          size="sm"
          class="ai-hover-btn"
          data-test="traces-no-events-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon-left>
            <img :src="aiIconSrc" class="h-4 w-4 shrink-0" alt="" />
          </template>
          {{ t("traces.noEvents.askAi") }}
        </OButton>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { DateTime } from "luxon";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useTraces from "@/composables/useTraces";
import useWidenRange from "@/composables/useWidenRange";
import { useAiIcon } from "@/composables/useAiIcon";
import { getConsumableRelativeTime } from "@/utils/date";

const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
const END_NUDGE_US = 1_000_000;

const props = defineProps<{
  /** Whether the AI copilot is enabled — gates the "Ask AI" button. */
  aiEnabled?: boolean;
  /**
   * Authoritative stream doc time range (µs), provided by the parent (traces
   * Index) from the same getStream() the query uses. When present it takes
   * precedence over the streamResults-derived fallback below.
   */
  streamDocTimeRange?: { min: number; max: number };
  /** Resolved query window (µs), provided by the parent. */
  queryWindowUs?: { start: number; end: number };
}>();

const { t } = useI18n();
const store = useStore();
const { aiIconSrc } = useAiIcon();
const emit = defineEmits<{
  "jump-to-stream-data": [fromUs: number, toUs: number];
  "ask-ai": [];
}>();

// `aiEnabled` is consumed via props in the template; alias avoids an unused warning.
const aiEnabled = computed(() => !!props.aiEnabled);

const { searchObj } = useTraces();

// --- filter detection -------------------------------------------------------

const hasFilters = computed(() => {
  const q = (searchObj.data?.editorValue || "").trim();
  return q.length > 0;
});

// --- stream doc time range (from stream stats) --------------------------------

const streamDocTimeRange = computed(() => {
  // Parent-provided range (authoritative) wins; fall back to deriving it from
  // streamResults when used standalone (e.g. in unit tests).
  if (props.streamDocTimeRange) return props.streamDocTimeRange;
  const selected = searchObj.data?.stream?.selectedStream?.value;
  if (!selected) return undefined;
  const list: any[] = searchObj.data?.streamResults?.list ?? [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of list) {
    if (s.name !== selected) continue;
    const st = s.stats;
    if (!st) continue;
    if (st.doc_time_min > 0 && st.doc_time_min < min) min = st.doc_time_min;
    if (st.doc_time_max > 0 && st.doc_time_max > max) max = st.doc_time_max;
  }
  if (!isFinite(min) || !isFinite(max)) return undefined;
  return { min, max };
});

// --- query window (resolved microsecond bounds) ------------------------------

const queryWindowUs = computed(() => {
  if (props.queryWindowUs) return props.queryWindowUs;
  const dt = searchObj.data?.datetime;
  if (!dt) return undefined;
  if (dt.type === "absolute" && dt.startTime && dt.endTime) {
    return { start: Number(dt.startTime), end: Number(dt.endTime) };
  }
  if (dt.type === "relative" && dt.relativeTimePeriod) {
    const r = getConsumableRelativeTime(dt.relativeTimePeriod);
    if (r) return { start: r.startTime, end: r.endTime };
  }
  return undefined;
});

// --- stream data vs. window overlap -----------------------------------------

const windowHasStreamData = computed(() => {
  const r = streamDocTimeRange.value;
  const w = queryWindowUs.value;
  if (!r || !w) return true;
  const TOLERANCE_US = 30_000_000;
  return w.start <= r.max + TOLERANCE_US && w.end >= r.min - TOLERANCE_US;
});

const jumpTarget = computed(() => {
  const r = streamDocTimeRange.value;
  if (!r) return null;
  // When the window overlaps the stream's range but a filter is applied, the
  // filter — not the range — is excluding records, so jumping won't help; the
  // user should relax the query instead.
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
  const tz = store.state.timezone || "UTC";
  const zone =
    tz.toLowerCase() === "local" || tz.toLowerCase() === "browser"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : tz;
  const lastDataUs = streamDocTimeRange.value!.max;
  const formatted = DateTime.fromMillis(lastDataUs / 1000)
    .setZone(zone)
    .toFormat("MMM d, yyyy HH:mm:ss");
  return t("traces.tracesNoEventsState.lastData", { formatted, zone });
});

// --- time-range helpers (via shared composable) -----------------------------

// `currentPeriodLabel` feeds the "descNoFilters" message; the widen-range
// action card was removed because widening never surfaces more data here.
const { currentPeriodLabel } = useWidenRange(
  () => searchObj.data?.datetime?.type ?? "",
  () => searchObj.data?.datetime?.relativeTimePeriod ?? "",
  {
    absoluteRangeLabel: t("traces.noEvents.selectedRange"),
    absoluteExpandDesc: t("traces.noEvents.expandRangeDescAbsolute"),
  },
);
</script>
