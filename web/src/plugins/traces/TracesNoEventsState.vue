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

    1. Window misses the stream's data entirely (doc_time_max outside window)
       → "Jump to latest data" card (last 15 min around doc_time_max)

    2. Window overlaps stream data but query returned nothing (filters too tight)
       → "Adjust your filters" message + expand-range + remove-filter cards

    3. No stream stats available (fallback)
       → generic "Expand time range" card
-->
<template>
  <OEmptyState illustration="trace" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noEvents.title") }}</template>

    <template #description>
      <span v-if="windowHasStreamData && hasFilters" v-html="t('traces.noEvents.descWithFilters')" />
      <span v-else-if="windowHasStreamData && !hasFilters" v-html="t('traces.noEvents.descDataAtBoundary')" />
      <span v-else-if="jumpTarget">{{ t("traces.noEvents.descOutOfRange") }}</span>
      <span v-else>{{ t("traces.noEvents.descNoFilters", { range: currentPeriodLabel }) }}</span>
    </template>

    <template #actions>
      <!-- Window is outside the stream's data range: offer a precise jump -->
      <EmptyStateActionCard
        v-if="jumpTarget"
        icon="schedule"
        :label="t('traces.noEvents.jumpToData')"
        :sublabel="jumpTargetSublabel"
        data-test="traces-no-events-jump-to-data-card"
        @click="emit('jump-to-stream-data', jumpTarget.from, jumpTarget.to)"
      />
      <!-- No active filters: the only useful suggestion is to widen the range.
           When a filter IS applied we intentionally show no action cards — the
           user is guided to relax the query themselves (and can Ask AI). -->
      <EmptyStateActionCard
        v-else-if="!hasFilters"
        icon="schedule"
        :label="t('traces.noEvents.expandRange')"
        :sublabel="expandRangeSublabel"
        data-test="traces-no-events-expand-range-card"
        @click="onWidenRange"
      />
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <OButton
          v-if="aiEnabled && windowHasStreamData && !jumpTarget"
          variant="ghost"
          size="sm"
          class="ai-hover-btn"
          data-test="traces-no-events-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon-left>
            <img :src="aiIconSrc" class="tw:w-4 tw:h-4 tw:shrink-0" alt="" />
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
  "widen-range": [period: string];
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
  if (windowHasStreamData.value) return null;
  const r = streamDocTimeRange.value;
  if (!r) return null;
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
  return `Last data: ${formatted} (${zone})`;
});

// --- time-range helpers (via shared composable) -----------------------------

const {
  suggestedPeriod,
  currentPeriodLabel,
  expandRangeSublabel,
} = useWidenRange(
  () => searchObj.data?.datetime?.type ?? "",
  () => searchObj.data?.datetime?.relativeTimePeriod ?? "",
  {
    absoluteRangeLabel: t("traces.noEvents.selectedRange"),
    absoluteExpandDesc: t("traces.noEvents.expandRangeDescAbsolute"),
  },
);

// --- actions ----------------------------------------------------------------

const onWidenRange = () => emit("widen-range", suggestedPeriod.value);
</script>
