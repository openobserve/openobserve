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
      <!-- Severity filter chips (multi-select; none selected = all) -->
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-table-header-border flex-wrap"
        data-test="pattern-list-severity-filter"
      >
        <OToggleGroup
          type="multiple"
          :model-value="activeSeverities"
          @update:model-value="onSeverityFilterChange"
        >
          <OToggleGroupItem
            v-for="sev in severityChips"
            :key="sev.key"
            :value="sev.key"
            size="xs"
            :data-test="`pattern-severity-chip-${sev.key}`"
          >
            <span :class="sev.colorClass">{{ sev.label }}</span>
            <span class="ml-1 tabular-nums opacity-70">{{ sev.countLabel }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <!-- Table Header -->
      <div
        class="flex items-center gap-3 border-b border-table-header-border bg-table-header-bg min-w-full"
      >
        <div class="w-28 flex-shrink-0 pl-3 pr-1 table-head text-left">
          <span class="font-medium text-table-header-text text-xs">{{ t("search.occurrenceColumnHeader") }}</span>
        </div>
        <div class="w-44 flex-shrink-0 table-head text-left">
          <span class="font-medium text-table-header-text text-xs">{{ t("logs.patternList.volumeHeader") }}</span>
        </div>
        <div class="w-20 flex-shrink-0 table-head text-left">
          <span class="font-medium text-table-header-text text-xs">{{ t("logs.patternList.statusHeader") }}</span>
        </div>
        <div class="w-32 flex-shrink-0 table-head text-left">
          <span class="font-medium text-table-header-text text-xs">{{ t("logs.patternList.serviceHeader") }}</span>
        </div>
        <div class="flex-1 min-w-0 table-head text-left">
          <span class="font-medium text-table-header-text text-xs">{{ t("search.patternColumnHeader") }}</span>
        </div>
      </div>

      <!-- Patterns List: plain render when wrap is on (variable row heights break virtual scroll) -->
      <template v-if="wrap">
        <PatternCard
          v-for="(pattern, index) in filteredPatterns"
          :key="pattern.pattern_id ?? index"
          :pattern="pattern"
          :index="index"
          :wrap="wrap"
          :max-frequency="maxFrequency"
          @click="openDetails(pattern, index)"
        />
      </template>

      <!-- Patterns List with Virtual Scroll (wrap off) -->
      <OVirtualScroll
        v-else
        :items="filteredPatterns"
        :overscan="5"
        :scroll-target="scrollTarget ?? null"
        :dynamic-row-height="true"
      >
        <template #default="{ item: pattern, index }">
          <PatternCard
            :pattern="pattern"
            :index="index"
            :wrap="wrap"
            :max-frequency="maxFrequency"
            @click="openDetails(pattern, index)"
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
        class="min-h-8 flex items-center border-b border-table-header-border bg-table-header-bg min-w-full"
      >
        <div class="flex-1 min-w-0 px-2">
          <span class="pattern-skel-pill inline-block h-3 w-16 rounded-default" aria-hidden="true" />
        </div>
        <div class="w-24 flex-shrink-0 px-2 flex justify-end">
          <span class="pattern-skel-pill inline-block h-3 w-14 rounded-default" aria-hidden="true" />
        </div>
      </div>

      <!-- Skeleton rows mimicking PatternCard layout -->
      <div
        v-for="(skeletonWidth, n) in SKELETON_WIDTHS"
        :key="n"
        class="pattern-skel-row flex items-center border-b border-table-row-divider relative opacity-0 h-8 bg-log-table-row-bg"
        :style="{ animationDelay: `${n * 40}ms` }"
      >
        <!-- Left accent bar -->
        <span class="absolute left-0 inset-y-0 w-1 pattern-skel-pill" aria-hidden="true" />
        <!-- Pattern column -->
        <div class="flex-1 min-w-0 px-2 pl-3">
          <span class="pattern-skel-pill inline-block h-3 rounded-default" :class="skeletonWidth" aria-hidden="true" />
        </div>
        <!-- Count column -->
        <div class="w-24 flex-shrink-0 px-2 flex flex-col items-end gap-1">
          <span class="pattern-skel-pill inline-block h-3 w-12 rounded-default" aria-hidden="true" />
          <span class="pattern-skel-pill inline-block h-2 w-10 rounded-default" aria-hidden="true" />
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

    <!-- Wildcard hover popover (outside the virtual scroller to avoid DOM recycling conflicts) -->
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
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import {
  patternSeverityKeyForPattern,
  severityTextClass,
  compactCount,
  type PatternSeverityKey,
} from "./patternUtils";
import { computed, ref, watch } from "vue";
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
  /** External scroll container passed to the virtual scroller's scroll-target. */
  scrollTarget?: HTMLElement | null;
  /** Selected stream's doc time range (µs) — from the logs Index. */
  streamDocTimeRange?: { min: number; max: number };
  /** Resolved current query window (µs) — from the logs Index. */
  queryWindowUs?: { start: number; end: number };
  /** Exact event count for the window, owned by SearchResult so the "N events"
   * chip and these severity chips are scaled by the same number. */
  windowTotal?: number | null;
}>();

const emit = defineEmits<{
  // The visible (severity-filtered) list is passed so the details drawer's
  // Next/Prev and "X of Y" navigate the same collection the index came from.
  (e: "open-details", pattern: any, index: number, visiblePatterns: any[]): void;
  (e: "filter-value", value: string, action: "include" | "exclude"): void;
  (e: "jump-to-stream-data", fromUs: number, toUs: number): void;
}>();

const store = useStore();
const { t } = useI18n();

// Severity chips scale the sample's share up to the window's real total, which
// SearchResult owns — one count query feeds both that chip row and its
// "N events" chip, so the two can never disagree.
//
// Deliberately not the sum of per-pattern volumes: those come from match_all()
// on a template's constant text, which matches a superset of that pattern's own
// logs and can be identical for two different templates, so summing them
// double-counts. Shares stay on the sample, which IS a clean partition.

/** Scale a sample-derived share to the whole window when the total is known. */
const scaleToWindow = (sampleCount: number): number | null => {
  const analyzed = props.totalLogsAnalyzed ?? 0;
  const total = props.windowTotal ?? null;
  if (!total || analyzed <= 0) return null;
  return Math.round((sampleCount / analyzed) * total);
};

const openDetails = (pattern: any, index: number) => {
  emit(
    "open-details",
    pattern,
    index,
    filteredPatterns.value,
  );
};

const {
  hoveredToken,
  onPopoverEnter,
  onPopoverLeave,
} = useWildcardHover();

// --- Severity filter (multi-select; empty = show all) -----------------------
const SEVERITY_ORDER: PatternSeverityKey[] = [
  "error",
  "warning",
  "info",
  "debug",
  "uncategorized",
];
const SEVERITY_LABEL_KEY: Record<PatternSeverityKey, string> = {
  error: "logs.patternList.severityError",
  warning: "logs.patternList.severityWarning",
  info: "logs.patternList.severityInfo",
  debug: "logs.patternList.severityDebug",
  uncategorized: "logs.patternList.severityUncategorized",
};

const activeSeverities = ref<string[]>([]);

const onSeverityFilterChange = (value: unknown) => {
  activeSeverities.value = Array.isArray(value) ? (value as string[]) : [];
};

// Chip counts come from the extraction sample, which is a clean partition
// (every analyzed log belongs to exactly one pattern). They're then scaled to
// the window's true total so the chips read in real magnitudes.
const severityCounts = computed<Record<PatternSeverityKey, number>>(() => {
  const counts: Record<PatternSeverityKey, number> = {
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
    uncategorized: 0,
  };
  for (const p of props.patterns ?? []) {
    counts[patternSeverityKeyForPattern(p)] += p?.frequency ?? 0;
  }
  return counts;
});

// Only surface chips for severities actually present, in fixed severity order.
const severityChips = computed(() =>
  SEVERITY_ORDER.filter((key) => severityCounts.value[key] > 0).map((key) => {
    const scaled = scaleToWindow(severityCounts.value[key]);
    return {
      key,
      label: t(SEVERITY_LABEL_KEY[key]),
      countLabel:
        scaled !== null
          ? `~${compactCount(scaled)}`
          : severityCounts.value[key].toLocaleString(),
      colorClass: severityTextClass(key),
    };
  }),
);

// Drop any active severity that no longer exists in the current result set
// (e.g. after a re-run returns patterns of different severities). Without this
// the chip disappears while the filter stays applied, stranding the user on an
// empty list with no chip to clear. Since every surviving chip has count>0
// (≥1 pattern), pruning also guarantees filteredPatterns is never empty here.
watch(severityChips, (chips) => {
  const available = new Set(chips.map((c) => c.key));
  const pruned = activeSeverities.value.filter((k) => available.has(k));
  if (pruned.length !== activeSeverities.value.length) {
    activeSeverities.value = pruned;
  }
});

const filteredPatterns = computed(() => {
  const all = props.patterns ?? [];
  if (!activeSeverities.value.length) return all;
  const active = new Set(activeSeverities.value);
  return all.filter((p) => active.has(patternSeverityKeyForPattern(p)));
});

// Share bars scale against sample frequencies — the same clean partition the
// percentages use, so bars and percentages stay consistent with each other.
const maxFrequency = computed(() =>
  filteredPatterns.value.reduce((max, p) => Math.max(max, p?.frequency ?? 0), 0),
);

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

<style scoped>
/* keep(keyframes): skeleton-loader shimmer + row-in @keyframes and the
   prefers-reduced-motion opt-out cannot be expressed as Tailwind utilities. */
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
    color-mix(in srgb, var(--color-white) 65%, transparent) 50%,
    var(--color-grey-100) 100%
  );
  background-size: 200% 100%;
  animation: pattern-skel-shimmer 1.5s ease-in-out infinite;
}

.dark .pattern-skel-pill {
  background: linear-gradient(
    90deg,
    var(--color-grey-600) 0%,
    color-mix(in srgb, var(--color-white) 3%, transparent) 50%,
    var(--color-grey-600) 100%
  );
}

@keyframes pattern-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes pattern-skel-row-in {
  from { opacity: 0; transform: translateY(0.125rem); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .pattern-skel-row  { opacity: 1; animation: none; }
  .pattern-skel-pill { animation: none; }
}
</style>
