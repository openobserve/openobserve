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
  <div class="flex flex-col h-full">
    <!-- Patterns Table — hidden during loading so skeleton always shows on re-run -->
    <div v-if="!loading && patterns?.length > 0" class="flex flex-col">
      <!-- Table Header -->
      <div
        class="flex items-center border-b border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <!-- Pattern Column Header -->
        <div
          class="flex-1 min-w-0 px-2 relative table-head text-ellipsis text-left"
        >
          <span
            class="font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-500'"
          >
            {{ t("search.patternColumnHeader") }}
          </span>
        </div>

        <!-- Count & Percentage Column Header -->
        <div
          class="w-24 flex-shrink-0 px-2 relative table-head text-ellipsis text-right"
        >
          <span
            class="font-bold"
            :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-500'"
          >
            {{ t("search.occurrenceColumnHeader") }}
          </span>
        </div>

        <!-- Actions Column - No Header -->
        <div
          class="w-24 flex-shrink-0 px-2 relative table-head"
        ></div>
      </div>

      <!-- Patterns List: plain render when wrap is on (variable row heights break virtual scroll) -->
      <template v-if="wrap">
        <PatternCard
          v-for="(pattern, index) in patterns"
          :key="pattern.pattern_id ?? index"
          :pattern="pattern"
          :index="index"
          :wrap="wrap"
          @click="$emit('open-details', pattern, index)"
          @include="$emit('add-to-search', pattern, 'include')"
          @exclude="$emit('add-to-search', pattern, 'exclude')"
          @create-alert="$emit('create-alert', pattern)"
        />
      </template>

      <!-- Patterns List with Virtual Scroll (wrap off) -->
      <OVirtualScroll
        v-else
        :items="patterns"
        :overscan="5"
        :scroll-target="scrollTarget ?? null"
        :dynamic-row-height="true"
      >
        <template #default="{ item: pattern, index }">
          <PatternCard
            :pattern="pattern"
            :index="index"
            :wrap="wrap"
            @click="$emit('open-details', pattern, index)"
            @include="$emit('add-to-search', pattern, 'include')"
            @exclude="$emit('add-to-search', pattern, 'exclude')"
            @create-alert="$emit('create-alert', pattern)"
          />
        </template>
      </OVirtualScroll>
    </div>

    <!-- Loading State — Skeleton Rows (same shimmer style as logs table) -->
    <div
      v-else-if="loading"
      class="flex flex-col"
      data-test="pattern-list-loading-skeleton"
      aria-busy="true"
      aria-live="polite"
      :aria-label="t('logs.patternList.extractingPatterns')"
    >
      <!-- Header skeleton -->
      <div
        class="min-h-8 flex items-center border-b border-[var(--o2-border-color)]"
        style="background: var(--o2-table-header-bg); min-width: 100%"
      >
        <div class="flex-1 min-w-0 px-2">
          <span class="pattern-skel-pill inline-block h-3 w-16 rounded-sm" aria-hidden="true" />
        </div>
        <div class="w-24 flex-shrink-0 px-2 flex justify-end">
          <span class="pattern-skel-pill inline-block h-3 w-14 rounded-sm" aria-hidden="true" />
        </div>
        <div class="w-20 flex-shrink-0 px-2" />
      </div>

      <!-- Skeleton rows mimicking PatternCard layout -->
      <div
        v-for="(skeletonWidth, n) in SKELETON_WIDTHS"
        :key="n"
        class="pattern-skel-row flex items-center border-b border-[var(--color-table-row-divider)] relative opacity-0 h-8 bg-[var(--o2-log-table-row-bg,transparent)]"
        :style="{ animationDelay: `${n * 40}ms` }"
      >
        <!-- Left accent bar -->
        <span class="absolute left-0 inset-y-0 w-1 pattern-skel-pill" aria-hidden="true" />
        <!-- Pattern column -->
        <div class="flex-1 min-w-0 px-2 pl-3">
          <span class="pattern-skel-pill inline-block h-3 rounded-sm" :class="skeletonWidth" aria-hidden="true" />
        </div>
        <!-- Count column -->
        <div class="w-24 flex-shrink-0 px-2 flex flex-col items-end gap-1">
          <span class="pattern-skel-pill inline-block h-3 w-12 rounded-sm" aria-hidden="true" />
          <span class="pattern-skel-pill inline-block h-2 w-10 rounded-sm" aria-hidden="true" />
        </div>
        <!-- Actions column — 3 icon-sized circles -->
        <div class="w-20 flex-shrink-0 px-2 flex items-center justify-center gap-1">
          <span
            v-for="i in 3"
            :key="i"
            class="pattern-skel-pill inline-block w-7 h-7 rounded-full shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="flex-1 flex items-center justify-center">
      <OEmptyState
        size="hero"
        preset="no-patterns"
        data-test="log-patterns-empty-state"
      >
        <!-- When the selected time range has no logs but the stream has data
             elsewhere, offer a precise jump to the latest data — same as the
             logs search empty state. -->
        <template v-if="jumpTarget" #actions>
          <EmptyStateActionCard
            icon="schedule"
            :label="t('logs.noEvents.jumpToData')"
            :sublabel="jumpTargetSublabel"
            data-test="log-patterns-jump-to-data-card"
            @click="emit('jump-to-stream-data', jumpTarget.from, jumpTarget.to)"
          />
        </template>
        <template v-if="totalLogsAnalyzed" #extra>
          <span class="text-sm text-text-secondary">
            {{ t("emptyState.noPatterns.logsAnalyzed", { count: totalLogsAnalyzed }) }}
          </span>
        </template>
      </OEmptyState>
    </div>

    <!-- Bottom spacer so the last row isn't flush with the container edge -->
    <div v-if="!loading && patterns?.length > 0" class="h-4" />

    <!-- Wildcard hover popover (outside q-virtual-scroll to avoid DOM recycling conflicts) -->
    <WildcardValuePopover
      :visible="!!hoveredToken"
      :token="hoveredToken?.token ?? ''"
      :displayValues="hoveredToken?.displayValues ?? []"
      :anchorEl="hoveredToken?.anchorEl ?? null"
      @popoverEnter="onPopoverEnter"
      @popoverLeave="onPopoverLeave"
      @filter-value="(value, action) => $emit('filter-value', value, action)"
    />
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import PatternCard from "./PatternCard.vue";
import WildcardValuePopover from "./WildcardValuePopover.vue";
import useWildcardHover from "./useWildcardHover";
import OVirtualScroll from "@/lib/core/VirtualScroll/OVirtualScroll.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { computed } from "vue";
import { DateTime } from "luxon";

const SKELETON_WIDTHS = [
  "w-3/4",
  "w-2/3",
  "w-11/12",
  "w-1/2",
  "w-5/6",
  "w-7/12",
  "w-4/5",
  "w-2/3",
  "w-3/4",
  "w-9/12",
  "w-1/2",
  "w-5/6",
  "w-7/12",
  "w-11/12",
  "w-3/5",
  "w-4/5",
  "w-2/3",
  "w-3/4",
  "w-1/2",
  "w-5/6",
];

const props = defineProps<{
  patterns: any[];
  loading: boolean;
  totalLogsAnalyzed?: number;
  wrap?: boolean;
  /** External scroll container passed to q-virtual-scroll's scroll-target. */
  scrollTarget?: HTMLElement | null;
  /** Selected stream's doc time range (µs) — from the logs Index. */
  streamDocTimeRange?: { min: number; max: number };
  /** Resolved current query window (µs) — from the logs Index. */
  queryWindowUs?: { start: number; end: number };
}>();

const emit = defineEmits<{
  (e: "open-details", pattern: any, index: number): void;
  (e: "add-to-search", pattern: any, action: "include" | "exclude"): void;
  (e: "create-alert", pattern: any): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
  (e: "jump-to-stream-data", fromUs: number, toUs: number): void;
}>();

const store = useStore();
const { t } = useI18n();

const {
  hoveredToken,
  onPopoverEnter,
  onPopoverLeave,
} = useWildcardHover();

// --- "jump to latest data" (parity with the logs search empty state) --------
const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
const END_NUDGE_US = 1_000_000; // backend end boundary is exclusive
const TOLERANCE_US = 30_000_000;

// Offered only when the current window sits OUTSIDE the stream's data envelope
// (i.e. there are no logs to extract patterns from here, but the stream has data
// elsewhere). When the window overlaps data the panel is simply sparse — jumping
// wouldn't help — so the card stays hidden.
const jumpTarget = computed<{ from: number; to: number } | null>(() => {
  const r = props.streamDocTimeRange;
  const w = props.queryWindowUs;
  if (!r) return null;
  const windowOverlapsData =
    !w || (w.start <= r.max + TOLERANCE_US && w.end >= r.min - TOLERANCE_US);
  if (windowOverlapsData) return null;
  return { from: r.max - FIFTEEN_MINS_US, to: r.max + END_NUDGE_US };
});

const jumpTargetSublabel = computed(() => {
  const r = props.streamDocTimeRange;
  if (!jumpTarget.value || !r) return "";
  const tz = store.state.timezone || "UTC";
  const zone =
    tz.toLowerCase() === "local" || tz.toLowerCase() === "browser"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : tz;
  const formatted = DateTime.fromMillis(r.max / 1000)
    .setZone(zone)
    .toFormat("MMM d, yyyy HH:mm:ss");
  return t("logs.patternList.lastData", { formatted, zone });
});
</script>

<style>
/* ── Pattern list loading skeleton ────────────────────────────────────────
   Matches the shimmer style used by the logs table (TenstackTable.vue)
   but at the slightly lighter grey-100 / grey-600 palette for visual parity. */

.pattern-skel-row {
  animation: pattern-skel-row-in 320ms ease-out forwards;
}

.pattern-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-grey-100) 0%,
    rgba(255, 255, 255, 0.65) 50%,
    var(--color-grey-100) 100%
  );
  background-size: 200% 100%;
  animation: pattern-skel-shimmer 1.5s ease-in-out infinite;
}

.body--dark .pattern-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-grey-600) 0%,
    rgba(255, 255, 255, 0.03) 50%,
    var(--color-grey-600) 100%
  );
}

@keyframes pattern-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes pattern-skel-row-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .pattern-skel-row  { opacity: 1; animation: none; }
  .pattern-skel-pill { animation: none; }
}
</style>
