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
  TurnPreviewCard — local presentational wrapper (NOT a lib/design-system
  component). Reused wherever a turn is referenced (KPI sub-line chips, the
  session ribbon bars, the right-rail hotspots) to show the same rich hover
  card. Built entirely from existing primitives: OTooltip (rich #content,
  child mode) + OBadge. The default slot is the trigger; the card renders in
  the tooltip popover.

  Styling is Tailwind-only (no scoped classes) per the redesign rules. Data is
  measured from the SessionTraceRow; cache % is passed from the session rollup.
-->
<template>
  <!-- Child mode (app convention): OTooltip attaches to its trigger sibling
       (the slotted chip). Wrapper is `display:contents` so it adds no box. -->
  <span class="contents">
    <slot />
    <OTooltip :side="side" :delay="delay" max-width="260px" content-class="p-0!">
      <template #content>
        <div
          class="w-63 py-2.75 px-3 text-xs text-text-body"
          :data-test="`turn-preview-${index + 1}`"
        >
          <!-- Header: Turn N · time · status -->
          <div class="flex items-center gap-2 mb-2">
            <span class="text-compact font-bold">
              {{ t('traces.sessionDetail.turnLabel') }} {{ index + 1 }}
            </span>
            <span class="text-3xs text-text-muted">{{ timeLabel }}</span>
            <OBadge
              size="sm"
              class="ml-auto"
              :variant="turn.status === 'error' ? 'error-soft' : 'success-soft'"
            >
              {{ turn.status === 'error' ? t('traces.sessionDetail.statusError') : t('traces.sessionDetail.statusOk') }}
            </OBadge>
          </div>

          <!-- User message preview -->
          <div class="mb-2.25 leading-[1.5]">
            <span
              class="block text-3xs font-bold uppercase tracking-[0.05em] text-text-muted mb-0.5"
            >
              {{ t('traces.sessionDetail.roles.user') }}
            </span>
            <span class="line-clamp-2">{{ userText }}</span>
          </div>

          <!-- Stats grid: Cost · Latency · Tokens · Cache -->
          <div
            class="grid grid-cols-2 gap-x-3 gap-y-[7px] border-t border-card-glass-border pt-2.25"
          >
            <div class="flex items-center justify-between text-2xs">
              <span class="text-text-muted">{{ t('traces.sessionDetail.stats.cost') }}</span>
              <span class="font-[650]">{{ costLabel }}</span>
            </div>
            <div class="flex items-center justify-between text-2xs">
              <span class="text-text-muted">{{ t('traces.sessionDetail.kpi.duration') }}</span>
              <span class="font-[650]">{{ latencyLabel }}</span>
            </div>
            <div class="flex items-center justify-between text-2xs">
              <span class="text-text-muted">{{ t('traces.sessionDetail.kpi.tokens') }}</span>
              <span class="font-[650]">{{ tokensLabel }}</span>
            </div>
            <div class="flex items-center justify-between text-2xs">
              <span class="text-text-muted">{{ t('traces.sessionDetail.stats.cache') }}</span>
              <span class="font-[650]">{{ cachePct }}%</span>
            </div>
          </div>
        </div>
      </template>
    </OTooltip>
  </span>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatDate } from "@/utils/date";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { SessionTraceRow } from "./composables/useSessions";
import {
  splitNumberWithUnit,
  splitDuration,
} from "./llmInsightsDashboard.utils";

const props = withDefaults(
  defineProps<{
    /** The turn whose metrics the card shows. */
    turn: SessionTraceRow;
    /** Zero-based turn index — display number is `index + 1`. */
    index: number;
    /** Session-level cache reuse percentage. */
    cachePct: number;
    /** Which side the preview opens on. Default "top" (KPI chips); the rail rows
     *  pass "right" so the card doesn't cover the rows above it. */
    side?: "top" | "right" | "bottom" | "left";
    /** Hover delay (ms) before the preview opens. Default 120 (chips/rail); the
     *  ribbon passes a smaller value so scrubbing across bars feels snappier. */
    delay?: number;
  }>(),
  { side: "top", delay: 120 },
);

const { t } = useI18n();

// start_time is nanoseconds; ms = nanos / 1_000_000 (matches SessionsList).
const timeLabel = computed(() =>
  props.turn.startTimeMicros
    ? formatDate(Math.floor(props.turn.startTimeMicros / 1_000_000), "HH:mm:ss")
    : "—",
);

const userText = computed(
  () => props.turn.turnUserMessage || t("traces.sessionDetail.noUserMessage"),
);

const costLabel = computed(() => `$${props.turn.cost.toFixed(4)}`);

const latencyLabel = computed(() => {
  if (!props.turn.durationNanos) return "—";
  const d = splitDuration(props.turn.durationNanos / 1000);
  return `${d.value}${d.unit}`;
});

const tokensLabel = computed(() => {
  const tk = splitNumberWithUnit(props.turn.tokens);
  return `${tk.value}${tk.unit}`;
});
</script>
