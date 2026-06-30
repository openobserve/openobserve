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
  measured from the SessionTraceRow except the cache %, which is a placeholder
  until per-request cache metrics exist (see redesign doc §3/§7, D1).
-->
<template>
  <!-- Child mode (app convention): OTooltip attaches to its trigger sibling
       (the slotted chip). Wrapper is `display:contents` so it adds no box. -->
  <span class="tw:contents">
    <slot />
    <OTooltip side="top" :delay="120" max-width="260px" content-class="tw:p-0!">
      <template #content>
        <div
          class="tw:w-[252px] tw:py-[11px] tw:px-3 tw:text-xs tw:text-[var(--o2-text-primary)]"
          :data-test="`turn-preview-${index + 1}`"
        >
          <!-- Header: Turn N · time · status -->
          <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
            <span class="tw:text-[12.5px] tw:font-bold">
              {{ t('traces.sessionDetail.turnLabel') }} {{ index + 1 }}
            </span>
            <span class="tw:text-[10px] tw:text-[var(--o2-text-muted)]">{{ timeLabel }}</span>
            <OBadge
              size="sm"
              class="tw:ml-auto"
              :variant="turn.status === 'error' ? 'error-soft' : 'success-soft'"
            >
              {{ turn.status === 'error' ? t('traces.sessionDetail.statusError') : t('traces.sessionDetail.statusOk') }}
            </OBadge>
          </div>

          <!-- User message preview -->
          <div class="tw:mb-[9px] tw:leading-[1.5]">
            <span
              class="tw:block tw:text-[9.5px] tw:font-bold tw:uppercase tw:tracking-[0.05em] tw:text-[var(--o2-text-muted)] tw:mb-0.5"
            >
              {{ t('traces.sessionDetail.roles.user') }}
            </span>
            <span class="tw:line-clamp-2">{{ userText }}</span>
          </div>

          <!-- Stats grid: Cost · Latency · Tokens · Cache -->
          <div
            class="tw:grid tw:grid-cols-2 tw:gap-x-3 tw:gap-y-[7px] tw:border-t tw:border-[var(--o2-border-color)] tw:pt-[9px]"
          >
            <div class="tw:flex tw:items-center tw:justify-between tw:text-[11px]">
              <span class="tw:text-[var(--o2-text-muted)]">{{ t('traces.sessionDetail.stats.cost') }}</span>
              <span class="tw:font-[650]">{{ costLabel }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:justify-between tw:text-[11px]">
              <span class="tw:text-[var(--o2-text-muted)]">{{ t('traces.sessionDetail.kpi.duration') }}</span>
              <span class="tw:font-[650]">{{ latencyLabel }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:justify-between tw:text-[11px]">
              <span class="tw:text-[var(--o2-text-muted)]">{{ t('traces.sessionDetail.kpi.tokens') }}</span>
              <span class="tw:font-[650]">{{ tokensLabel }}</span>
            </div>
            <div class="tw:flex tw:items-center tw:justify-between tw:text-[11px]">
              <span class="tw:text-[var(--o2-text-muted)]">{{ t('traces.sessionDetail.stats.cache') }}</span>
              <span class="tw:font-[650]">{{ cachePct }}%</span>
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

const props = defineProps<{
  /** The turn whose metrics the card shows. */
  turn: SessionTraceRow;
  /** Zero-based turn index — display number is `index + 1`. */
  index: number;
  /** Cache-hit percentage (placeholder until cache metrics exist). */
  cachePct: number;
}>();

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
