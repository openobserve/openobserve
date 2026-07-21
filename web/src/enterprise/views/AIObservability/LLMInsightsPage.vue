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
  <OPageLayout
    data-test="ai-llm-insights-page"
    :title="t('aiObservability.nav.llmInsights')"
    :subtitle="t('aiObservability.subtitle.llmInsights')"
    icon="dashboard"
    bleed
    :scroll="false"
  >
      <template #actions>
        <date-time
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="dateState.valueType"
          :default-absolute-time="{
            startTime: dateState.startTime ?? 0,
            endTime: dateState.endTime ?? 0,
          }"
          :default-relative-time="dateState.relativeTimePeriod ?? ''"
          data-test="ai-llm-insights-date-time"
          class="h-8"
          @on:date-change="onDateChange"
        />
        <!-- Whole-page last-refresh + refresh control (logs-style): relative
             time + freshness dot, ticking on its own. -->
        <div
          class="inline-flex items-center border border-border-default rounded-default px-1 h-8 overflow-hidden"
        >
          <ORefreshButton
            :last-run-at="dashboardLastRunAt"
            :loading="isLoading"
            :disabled="isLoading"
            data-test="ai-llm-insights-refresh-btn"
            @click="refresh"
          />
        </div>
      </template>

    <LLMInsightsDashboard
      ref="dashboardRef"
      :stream-name="streamName"
      :start-time="timeRange.startTime"
      :end-time="timeRange.endTime"
      class="flex-1 min-h-0"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import LLMInsightsDashboard from "@/plugins/traces/LLMInsightsDashboard.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import {
  useAiDateRange,
  resolveAiDateWindow,
} from "@/enterprise/composables/useAiDateRange";

defineOptions({ name: "AILLMInsightsPage" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const DEFAULT_RELATIVE = "15m";

// Shared across LLM Insights, LLM Sessions, and Quality — picking a window
// on any of the three lands on the other two (singleton ref + localStorage
// persistence). See useAiDateRange.ts for the contract.
const { state: dateState } = useAiDateRange();

const timeRange = ref({ startTime: 0, endTime: 0 });
const streamName = ref("");
const dateTimeRef = ref<any>(null);
const dashboardRef = ref<any>(null);
const isRefreshing = ref(false);

// Whole-page "last refresh" indicator (logs-style). The dashboard stamps
// `lastRunAt` when its KPI fetch settles and exposes its own `loading`; we OR in
// the page-level `isRefreshing` so the button spins from the moment of click
// (covering the relative-window re-anchor before the dashboard load starts).
const dashboardLastRunAt = computed<number | null>(
  () => dashboardRef.value?.lastRunAt ?? null,
);
const isLoading = computed(
  () => isRefreshing.value || dashboardRef.value?.loading || false,
);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  // Persist the re-anchored absolute bounds on the shared state too so a
  // later page-mount that prefers absolute over relative still gets the
  // correct window.
  dateState.value = {
    ...dateState.value,
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

// URL ↔ shared date sync. Mirrors the Logs convention:
//   - relative: ?period=15m
//   - absolute: ?from=<micros>&to=<micros>
// On mount, an existing URL window wins over the cross-page shared state
// so deep-link / share-link URLs reproduce the exact saved view.
function readFromUrl(): boolean {
  const fromRaw = route.query.from;
  const toRaw = route.query.to;
  const periodRaw = route.query.period;

  if (typeof fromRaw === "string" && typeof toRaw === "string") {
    const startTime = Number(fromRaw);
    const endTime = Number(toRaw);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
      dateState.value = {
        valueType: "absolute",
        startTime,
        endTime,
        relativeTimePeriod: null,
      };
      timeRange.value = { startTime, endTime };
      return true;
    }
  }

  if (typeof periodRaw === "string" && periodRaw) {
    applyRelative(periodRaw);
    return true;
  }

  return false;
}

function writeToUrl() {
  // Preserve any other query params the rest of the app set (org_identifier,
  // future filters, …). Use replace() so the date picker doesn't pollute
  // browser history with one entry per range change.
  const next: Record<string, any> = { ...route.query };
  if (dateState.value.valueType === "relative") {
    next.period = dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE;
    delete next.from;
    delete next.to;
  } else {
    next.from = String(dateState.value.startTime ?? 0);
    next.to = String(dateState.value.endTime ?? 0);
    delete next.period;
  }
  router.replace({ query: next }).catch(() => {});
}

async function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    dateState.value = {
      valueType: "absolute",
      startTime: value.startTime,
      endTime: value.endTime,
      relativeTimePeriod: null,
    };
    timeRange.value = { startTime: value.startTime, endTime: value.endTime };
  }
  writeToUrl();
  await nextTick();
  dashboardRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

// Manual refresh: re-anchor a relative window to "now" so the data is
// genuinely fresh (the absolute case keeps its explicit start/end). Then
// call the dashboard's exposed refresh() and surface a loading state on
// the button for the duration.
async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      // Re-anchored window means the absolute start/end shifted; mirror
      // that in the URL so a share-link captured right after refresh is
      // pointing at the same data the user just saw (we still keep the
      // `period` form so the deep-link continues to refresh-as-relative).
      writeToUrl();
    }
    await nextTick();
    await dashboardRef.value?.refresh?.(
      timeRange.value.startTime,
      timeRange.value.endTime,
    );
  } finally {
    isRefreshing.value = false;
  }
}

onMounted(() => {
  // Precedence: URL > shared state (cross-page persisted) > default relative.
  // The shared state is already loaded from localStorage by the composable.
  if (readFromUrl()) return;

  const window = resolveAiDateWindow(dateState.value);
  if (window) {
    timeRange.value = window;
    // If the existing shared state is relative, re-anchor `startTime/endTime`
    // on it too so other consumers reading the absolute fields get a window
    // anchored to *this* page-mount instead of stale microsecond bounds.
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
    }
  } else {
    applyRelative(DEFAULT_RELATIVE);
  }
  writeToUrl();
});
</script>
