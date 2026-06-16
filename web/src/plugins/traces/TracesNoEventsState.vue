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
  Reads search state directly from useTraces() and adapts its copy and action cards:

    • No filters → "No traces in this time range" + Expand time range card
    • Has filters → "Nothing matched this query" + Expand + Remove filter cards
-->
<template>
  <OEmptyState illustration="trace" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noEvents.title") }}</template>

    <template #description>
      <span v-if="hasFilters" v-html="filteredDescription" />
      <span v-else>{{ plainDescription }}</span>
    </template>

    <template #actions>
      <EmptyStateActionCard
        icon="schedule"
        :label="t('traces.noEvents.expandRange')"
        :sublabel="expandRangeSublabel"
        data-test="traces-no-events-expand-range-card"
        @click="onWidenRange"
      />
      <EmptyStateActionCard
        v-if="hasFilters"
        icon="filter-list"
        :label="t('traces.noEvents.removeFilter')"
        :sublabel="removeFilterSublabel"
        data-test="traces-no-events-remove-filter-card"
        @click="onRemoveFilter"
      />
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import useTraces from "@/composables/useTraces";
import useWidenRange from "@/composables/useWidenRange";

const { t } = useI18n();
const emit = defineEmits<{
  "widen-range": [period: string];
  "remove-filter": [];
}>();

const { searchObj } = useTraces();

// --- filter detection -------------------------------------------------------

const hasFilters = computed<boolean>(() => {
  const q = (searchObj.data?.editorValue || "").trim();
  if (!q) return false;
  // In traces the editorValue is a WHERE-style expression — non-empty means active filters.
  return true;
});

const conditionCount = computed<number>(() => {
  const q = (searchObj.data?.editorValue || "").trim();
  if (!q) return 0;
  const matches = q.match(/\b(AND|OR)\b/gi);
  return (matches?.length ?? 0) + 1;
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

// --- copy -------------------------------------------------------------------

const plainDescription = computed(() =>
  t("traces.noEvents.descNoFilters", { range: currentPeriodLabel.value }),
);

// Uses v-html — fully i18n-controlled, no user input.
const filteredDescription = computed(() => t("traces.noEvents.descWithFilters"));

// --- action card sublabels --------------------------------------------------

const removeFilterSublabel = computed(() => {
  const n = conditionCount.value;
  const noun = n === 1 ? "condition" : "conditions";
  return `You have ${n} active ${noun} on this query`;
});

// --- actions ----------------------------------------------------------------

const onWidenRange = () => emit("widen-range", suggestedPeriod.value);

const onRemoveFilter = () => emit("remove-filter");
</script>
