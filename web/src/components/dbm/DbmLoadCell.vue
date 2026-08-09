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
  DbmLoadCell — total time, its share of the scope, and its shape over time,
  in ONE cell.

  Three facts about the same quantity belong together: how much database time
  this row cost, how much of the whole that is, and whether it is rising. Split
  across three columns the reader has to re-associate them per row; combined,
  the comparison is pre-made. (The pattern is PMM's query-load cell.)

  Two rules it enforces:
    • Percent and absolute ALWAYS travel together. "45.2%" without "1.23s" is
      unanchored, and "1.23s" without the share hides whether that is the whole
      database or a rounding error.
    • The share bar and the sparkline are scaled by a caller-supplied maximum,
      so every row is drawn on ONE scale and row-to-row comparison is valid.
-->
<template>
  <div class="flex w-full min-w-0 items-center justify-end gap-1.5" :data-test="dataTest">
    <!-- The trend leads, because the SHAPE is what the eye catches while
         scanning a column; the numbers are read second, once a row has been
         picked out. -->
    <OSparkline
      v-if="series && series.length > 1"
      class="w-14 shrink-0"
      :points="series"
      :tone="sparklineTone"
      :aria-label="t('dbm.queries.trendLabel')"
      :data-test="dataTest"
    />

    <div class="flex min-w-0 flex-col items-end gap-0.5">
      <!-- Absolute + percent on one line, absolute leading: "2m 28s" is the
           quantity, "31%" is what makes it comparable. Neither is legible
           without the other — a share with no duration is unanchored, and a
           duration with no share hides whether it is the whole database or a
           rounding error. -->
      <span class="flex items-baseline gap-1 leading-tight">
        <span class="text-text-heading text-compact font-mono font-medium tabular-nums">
          {{ formatNs(totalTimeNs) }}
        </span>
        <span class="text-text-label text-3xs font-mono tabular-nums">
          {{ formatPercent(share, 0) }}
        </span>
      </span>
      <OProgressBar :value="share" :variant="barVariant" size="xs" class="w-18" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { SparklinePoint, SparklineTone } from "@/lib/data/Sparkline/OSparkline.types";
import { useI18nTyped } from "@/types/i18n";
import { formatNs, formatPercent } from "@/utils/dbm/format";

const props = withDefaults(
  defineProps<{
    /** This row's total database time, nanoseconds. */
    totalTimeNs?: number;
    /** Share of the scope's total time, `0`–`1`. */
    share: number;
    /** Trend points, oldest → newest. `null` entries render as gaps. */
    series?: readonly (SparklinePoint | number | null)[];
    /** Set when the row is one an insight flagged, to tint the trend. */
    flagged?: boolean;
    /** Set when every call is failing — the strongest tone this cell carries. */
    critical?: boolean;
    dataTest?: string;
  }>(),
  { share: 0, flagged: false, critical: false },
);

const { t } = useI18nTyped();

/** A single query owning this much of a database's time is worth noticing. */
const DOMINANT_SHARE = 0.25;

/**
 * Colour is information here, in one direction only: the bar warms when this
 * row owns enough of the database that it is the thing to look at, and goes red
 * when the row is failing outright. A row that is merely large stays neutral.
 */
const barVariant = computed(() => {
  if (props.critical) return "danger";
  return props.share >= DOMINANT_SHARE ? "warning" : "default";
});

const sparklineTone = computed<SparklineTone>(() => {
  if (props.critical) return "danger";
  return props.flagged ? "warning" : "default";
});
</script>
