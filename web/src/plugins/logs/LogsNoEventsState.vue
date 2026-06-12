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
  Detects whether the current query has active filter conditions and adapts
  its copy and action cards accordingly:

    • No filters → "No events in this time range" + Expand time range card
    • Has filters → "Nothing matched this query" + Expand + Remove filter cards

  Emits action IDs to the parent rather than mutating state directly.
  The "Ask AI" ghost button is only shown when aiEnabled is true.
-->
<template>
  <OEmptyState illustration="logs" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noEvents.title") }}</template>

    <template #description>
      <span v-if="hasFilters" v-html="filteredDescription" />
      <span v-else>{{ plainDescription }}</span>
    </template>

    <template #actions>
      <EmptyStateActionCard
        icon="schedule"
        :label="t('logs.noEvents.expandRange')"
        :sublabel="expandRangeSublabel"
        data-test="logs-no-events-expand-range-card"
        @click="emit('widen-range', suggestedPeriod)"
      />
      <EmptyStateActionCard
        v-if="hasFilters"
        icon="filter-list"
        :label="t('logs.noEvents.removeFilter')"
        :sublabel="removeFilterSublabel"
        data-test="logs-no-events-remove-filter-card"
        @click="emit('remove-filter')"
      />
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
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
          v-if="aiEnabled"
          variant="ghost"
          size="sm"
          class="ai-hover-btn"
          data-test="logs-no-events-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon-left>
            <img :src="aiIconSrc" class="tw:w-4 tw:h-4 tw:shrink-0" alt="" />
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

const props = defineProps<{
  /** True when SQL mode is active; affects how filter presence is detected. */
  sqlMode: boolean;
  /** In non-SQL mode: the WHERE-clause expression string. */
  query: string;
  /** In SQL mode: the full SQL text from the editor. */
  editorValue: string;
  /** The current relative time period code, e.g. "15m", "1h", "7d". */
  relativeTimePeriod: string;
  /** "relative" or "absolute" */
  dateType: string;
  /** Show the "Ask AI" button only when AI is enabled (enterprise + zoConfig.ai_enabled). */
  aiEnabled: boolean;
}>();

const emit = defineEmits<{
  "widen-range": [period: string];
  "remove-filter": [];
  "open-history": [];
  "ask-ai": [];
}>();

const { t } = useI18n();
const { aiIconSrc } = useAiIcon();

// --- filter detection -------------------------------------------------------

const hasFilters = computed<boolean>(() => {
  if (props.sqlMode) {
    return /\bWHERE\b/i.test(props.editorValue || "");
  }
  return (props.query || "").trim().length > 0;
});

/** Number of AND/OR-separated conditions in non-SQL mode. 0 in SQL mode. */
const conditionCount = computed<number>(() => {
  if (props.sqlMode) return 0;
  const q = (props.query || "").trim();
  if (!q) return 0;
  const matches = q.match(/\b(AND|OR)\b/gi);
  return (matches?.length ?? 0) + 1;
});

// --- time-range helpers -----------------------------------------------------

function periodToLabel(period: string): string {
  if (!period || period === "absolute") return "";
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  const units: Record<string, [string, string]> = {
    s: ["Second", "Seconds"],
    m: ["Minute", "Minutes"],
    h: ["Hour", "Hours"],
    d: ["Day", "Days"],
    w: ["Week", "Weeks"],
    M: ["Month", "Months"],
  };
  const [sg, pl] = units[unit] ?? ["unit", "units"];
  return `Past ${value} ${value === 1 ? sg : pl}`;
}

function nextWiderPeriod(period: string): string {
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  const toMins: Record<string, number> = {
    s: 1 / 60,
    m: 1,
    h: 60,
    d: 1440,
    w: 10080,
    M: 43200,
  };
  const mins = value * (toMins[unit] ?? 1);
  if (mins <= 60) return "1d";
  if (mins <= 1440) return "7d";
  return "30d";
}

const isRelative = computed(() => props.dateType === "relative" && !!props.relativeTimePeriod);
const currentPeriodLabel = computed(() =>
  isRelative.value ? periodToLabel(props.relativeTimePeriod) : t("logs.noEvents.selectedRange"),
);
const suggestedPeriod = computed(() =>
  isRelative.value ? nextWiderPeriod(props.relativeTimePeriod) : "7d",
);
const suggestedPeriodLabel = computed(() => periodToLabel(suggestedPeriod.value));

// --- copy -------------------------------------------------------------------

const plainDescription = computed(() =>
  t("logs.noEvents.descNoFilters", { range: currentPeriodLabel.value }),
);

// Uses v-html — content is fully i18n-controlled, no user input.
const filteredDescription = computed(() =>
  t("logs.noEvents.descWithFilters"),
);

// --- action card sublabels --------------------------------------------------

const expandRangeSublabel = computed(() => {
  if (!isRelative.value) return t("logs.noEvents.expandRangeDescAbsolute");
  return `${currentPeriodLabel.value} → ${suggestedPeriodLabel.value}`;
});

const removeFilterSublabel = computed(() => {
  if (props.sqlMode) return t("logs.noEvents.removeFilterDescSql");
  const n = conditionCount.value;
  const noun = n === 1 ? "condition" : "conditions";
  return `You have ${n} active ${noun} on this query`;
});
</script>
