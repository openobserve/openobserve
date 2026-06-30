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
  SessionRibbon — one bar per turn, toggled between Cost / Latency / Tokens.
  Custom CSS bars (no charting lib) because the data is already in memory
  (traces[]) and each bar needs the rich TurnPreviewCard hover — Panel chrome + bar colours match the
-->
<template>
  <div
    class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:pt-[1rem] tw:px-[1rem] tw:pb-[0.625rem] tw:flex tw:flex-col"
    data-test="session-ribbon"
  >
    <!-- Header: title + subtitle (left) · metric toggle (right) -->
    <div class="tw:flex tw:items-baseline tw:justify-between tw:gap-[0.5rem] tw:mb-[0.75rem]">
      <div>
        <div class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
          {{ t('traces.sessionDetail.ribbon.title') }}
        </div>
        <div class="tw:text-[0.7rem] tw:leading-normal tw:text-[var(--o2-text-secondary)] tw:mt-[0.1rem]">
          {{ t('traces.sessionDetail.ribbon.subtitle') }}
        </div>
      </div>
      <OToggleGroup v-model="metric" class="tw:flex-shrink-0">
        <OToggleGroupItem value="cost" size="sm">
          {{ t('traces.sessionDetail.kpi.cost') }}
        </OToggleGroupItem>
        <OToggleGroupItem value="latency" size="sm">
          {{ t('traces.sessionDetail.kpi.duration') }}
        </OToggleGroupItem>
        <OToggleGroupItem value="tokens" size="sm">
          {{ t('traces.sessionDetail.kpi.tokens') }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <!-- Plot fills the remaining panel height so the chart uses the space rather
         than leaving a gap below it. The chart region (y-axis + bars) grows; the
         x-axis row sits beneath it, offset by the y-axis width so the turn
         numbers stay aligned under their bars. -->
    <div class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
      <!-- chart region: y-axis labels + bars, sharing the grown height -->
      <div class="tw:flex tw:gap-[0.5rem] tw:flex-1 tw:min-h-0">
        <div
          class="tw:flex tw:flex-col tw:justify-between tw:items-end tw:h-full tw:w-[2.75rem] tw:flex-shrink-0 tw:text-[0.6rem] tw:text-[var(--o2-text-muted)] tw:tabular-nums"
        >
          <span>{{ maxLabel }}</span>
          <span>{{ midLabel }}</span>
          <span>0</span>
        </div>

        <div
          class="tw:relative tw:flex-1 tw:min-w-0 tw:min-h-0 tw:flex tw:items-end tw:gap-[3px] tw:border-l tw:border-b tw:border-[var(--o2-border-color)]"
        >
          <!-- gridlines (top + mid) to echo the dashboard chart grid -->
          <div class="tw:absolute tw:inset-x-0 tw:top-0 tw:border-t tw:border-[var(--o2-border-color)] tw:opacity-60" />
          <div class="tw:absolute tw:inset-x-0 tw:top-1/2 tw:border-t tw:border-[var(--o2-border-color)] tw:opacity-40" />

          <TurnPreviewCard
            v-for="bar in bars"
            :key="bar.index"
            :turn="bar.turn"
            :index="bar.index"
            :cache-pct="cachePct"
            :delay="40"
          >
            <div
              class="tw:relative tw:flex-1 tw:min-w-0 tw:rounded-t-[2px] tw:cursor-pointer tw:transition-[height] tw:duration-300 tw:ease-out hover:tw:brightness-110"
              :style="{ height: bar.pct + '%', background: bar.color }"
              @click="emit('jump', bar.index + 1)"
            />
          </TurnPreviewCard>
        </div>
      </div>

      <!-- x-axis + title, offset by the y-axis column width so the numbers stay
           aligned under their bars. Every bar keeps a spacer span, but once there
           are many turns we only print a label on round milestones (see
           labeledTurns) to avoid the numbers cramming together. -->
      <div class="tw:flex tw:gap-[0.5rem] tw:flex-shrink-0">
        <div class="tw:w-[2.75rem] tw:flex-shrink-0" />
        <div class="tw:flex-1 tw:min-w-0">
          <div class="tw:flex tw:gap-[3px] tw:mt-[0.25rem]">
            <span
              v-for="bar in bars"
              :key="bar.index"
              class="tw:flex-1 tw:min-w-0 tw:text-center tw:text-[0.6rem] tw:text-[var(--o2-text-muted)] tw:tabular-nums"
            >
              {{ labeledTurns.has(bar.index + 1) ? bar.index + 1 : "" }}
            </span>
          </div>

          <!-- x-axis title — matches the dashboard axis name (nameLocation
               "middle" + nameTextStyle bold/14px). -->
          <div
            class="tw:text-center tw:text-[14px] tw:font-bold tw:text-[var(--o2-text-primary)] tw:mt-[0.25rem]"
          >
            {{ t('traces.sessionDetail.turnLabel') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import TurnPreviewCard from "./TurnPreviewCard.vue";
import type { SessionTraceRow } from "./composables/useSessions";
import {
  splitCost,
  splitDuration,
  splitNumberWithUnit,
} from "./llmInsightsDashboard.utils";

const props = defineProps<{
  traces: SessionTraceRow[];
  /** Cache-hit % forwarded to the hover card (placeholder until real data). */
  cachePct: number;
}>();

// Emitted when a bar is clicked — the parent scrolls/expands that turn (S5).
const emit = defineEmits<{ (e: "jump", turn: number): void }>();

const { t } = useI18n();

type Metric = "cost" | "latency" | "tokens";
const metric = ref<Metric>("cost");

// Bar colours match the LLM Insights dashboard chart palette (hex, as the panel
// defs use). Error turns are always red regardless of the selected metric.
const COLORS: Record<Metric | "error", string> = {
  cost: "#3b82f6",
  latency: "#f97316",
  tokens: "#a855f7",
  error: "#ef4444",
};

function metricValue(row: SessionTraceRow): number {
  if (metric.value === "cost") return row.cost;
  if (metric.value === "latency") return row.durationNanos;
  return row.tokens;
}

function formatMetric(v: number): string {
  if (metric.value === "cost") {
    const c = splitCost(v);
    return `${c.value}${c.unit}`;
  }
  if (metric.value === "latency") {
    if (!v) return "0";
    const d = splitDuration(v / 1000);
    return `${d.value}${d.unit}`;
  }
  const tk = splitNumberWithUnit(v);
  return `${tk.value}${tk.unit}`;
}

const maxValue = computed(() => {
  const vals = props.traces.map(metricValue);
  return vals.length ? Math.max(...vals) : 0;
});

const maxLabel = computed(() => formatMetric(maxValue.value));
const midLabel = computed(() => formatMetric(maxValue.value / 2));

const bars = computed(() =>
  props.traces.map((turn, index) => {
    const v = metricValue(turn);
    const pct = maxValue.value > 0 ? Math.max(2, (v / maxValue.value) * 100) : 2;
    return {
      turn,
      index,
      pct,
      color: turn.status === "error" ? COLORS.error : COLORS[metric.value],
    };
  }),
);

// X-axis labels get crowded once there are many turns (59 bars → 59 numbers
// jammed together). At or below this count we label every turn; above it we
// thin to a handful of round milestones.
const ALL_LABELS_MAX = 10;

// Round the raw step (total / ~target labels) up to a "nice" number — 1, 2, 5
// or 10 × a power of ten — so labels land on readable milestones (…10, 20, 30
// or …25, 50, 75) instead of arbitrary turns.
function niceStep(total: number, targetCount: number): number {
  const raw = total / targetCount;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(1, nice * pow);
}

// The set of 1-based turn numbers that should print an x-axis label: every turn
// when there are few, otherwise turn 1 plus each round step (e.g. 1, 10, 20, 30…
// for 59 turns). Bars without a label still render an empty spacer span.
const labeledTurns = computed<Set<number>>(() => {
  const total = bars.value.length;
  const set = new Set<number>();
  if (total <= ALL_LABELS_MAX) {
    for (let n = 1; n <= total; n++) set.add(n);
    return set;
  }
  const step = niceStep(total, 8);
  set.add(1);
  for (let n = step; n <= total; n += step) set.add(n);
  return set;
});
</script>
