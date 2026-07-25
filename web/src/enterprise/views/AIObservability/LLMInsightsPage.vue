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
  <AiPageShell
    data-test="ai-llm-insights"
    :title="t('aiObservability.nav.llmInsights')"
    :subtitle="t('aiObservability.subtitle.llmInsights')"
    icon="dashboard"
    :date-state="dateState"
    :last-run-at="dashboardLastRunAt"
    :is-loading="isLoading"
    @date-change="onDateChange"
    @refresh="refresh"
  >
    <LLMInsightsDashboard
      ref="dashboardRef"
      :stream-name="streamName"
      :start-time="timeRange.startTime"
      :end-time="timeRange.endTime"
      class="min-h-0 flex-1"
    />
  </AiPageShell>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import LLMInsightsDashboard from "@/plugins/traces/LLMInsightsDashboard.vue";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useChildRefresh } from "@/enterprise/composables/useChildRefresh";

defineOptions({ name: "AILLMInsightsPage" });

const { t } = useI18n();

// Shared across LLM Insights, LLM Sessions, and Quality — picking a window
// on any of the three lands on the other two (singleton ref + localStorage
// persistence). See useAiDateRange.ts for the contract. LLM Insights syncs its
// date to the URL (urlSync:true) so deep-/share-links reproduce the exact view.
const {
  dateState,
  timeRange,
  applyRelative,
  onDateChange: onDateStateChange,
  writeToUrl,
  mountResolve,
  DEFAULT_RELATIVE,
} = useAiDateController();

const streamName = ref("");
const dashboardRef = ref<any>(null);

// Whole-page "last refresh" indicator (logs-style). The dashboard stamps
// `lastRunAt` when its KPI fetch settles and exposes its own `loading`; the
// composable ORs in a page-level `isRefreshing` so the button spins from the
// moment of click (covering the relative-window re-anchor before the dashboard
// load starts).
const {
  lastRunAt: dashboardLastRunAt,
  isLoading,
  refresh,
} = useChildRefresh(dashboardRef, {
  // Manual refresh: re-anchor a relative window to "now" so the data is
  // genuinely fresh (the absolute case keeps its explicit start/end), and mirror
  // the shifted bounds into the URL (keeping the `period` form) so a share-link
  // captured right after refresh points at the same data the user just saw.
  onBeforeRefresh: () => {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      writeToUrl();
    }
  },
  // Hand the dashboard the explicit re-anchored window after nextTick (its prior
  // refresh call), rather than relying on the bare no-arg default.
  invokeRefresh: async () => {
    await nextTick();
    await dashboardRef.value?.refresh?.(
      timeRange.value.startTime,
      timeRange.value.endTime,
    );
  },
});

async function onDateChange(value: any) {
  // Date state + URL sync is owned by useAiDateController; the page then re-fetches
  // the dashboard with the resolved window.
  onDateStateChange(value);
  await nextTick();
  dashboardRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

onMounted(() => {
  // Precedence: URL > shared state (cross-page persisted) > default relative.
  // The shared state is already loaded from localStorage by the composable.
  mountResolve();
});
</script>
