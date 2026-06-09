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
  <div
    data-test="ai-llm-insights-page"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:overflow-hidden"
  >
    <AppPageHeader
      :title="t('aiObservability.nav.llmInsights')"
      icon="dashboard"
      class="tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <date-time
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="datetime.type"
          :default-absolute-time="{
            startTime: datetime.startTime,
            endTime: datetime.endTime,
          }"
          :default-relative-time="datetime.relativeTimePeriod"
          data-test="ai-llm-insights-date-time"
          class="tw:h-[2rem]"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="outline"
          size="sm-toolbar"
          :loading="isRefreshing"
          data-test="ai-llm-insights-refresh-btn"
          @click="refresh"
        >
          Refresh
        </OButton>
      </template>
    </AppPageHeader>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:px-4 tw:py-3">
      <LLMInsightsDashboard
        ref="dashboardRef"
        :stream-name="streamName"
        :start-time="timeRange.startTime"
        :end-time="timeRange.endTime"
        class="tw:h-full"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import LLMInsightsDashboard from "@/plugins/traces/LLMInsightsDashboard.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { getConsumableRelativeTime } from "@/utils/date";

defineOptions({ name: "AILLMInsightsPage" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const DEFAULT_RELATIVE = "15m";

const datetime = reactive<{
  type: "relative" | "absolute";
  startTime: number;
  endTime: number;
  relativeTimePeriod: string;
}>({
  type: "relative",
  startTime: 0,
  endTime: 0,
  relativeTimePeriod: DEFAULT_RELATIVE,
});

const timeRange = ref({ startTime: 0, endTime: 0 });
const streamName = ref("");
const dateTimeRef = ref<any>(null);
const dashboardRef = ref<any>(null);
const isRefreshing = ref(false);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  datetime.startTime = range.startTime;
  datetime.endTime = range.endTime;
}

// URL ↔ datetime sync. Mirrors the Logs convention:
//   - relative: ?period=15m
//   - absolute: ?from=<micros>&to=<micros>
// On mount, an existing absolute window wins over the default relative
// period so deep-link / share-link URLs reproduce the same view.
function readFromUrl(): boolean {
  const fromRaw = route.query.from;
  const toRaw = route.query.to;
  const periodRaw = route.query.period;

  if (typeof fromRaw === "string" && typeof toRaw === "string") {
    const startTime = Number(fromRaw);
    const endTime = Number(toRaw);
    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
      datetime.type = "absolute";
      datetime.startTime = startTime;
      datetime.endTime = endTime;
      datetime.relativeTimePeriod = "";
      timeRange.value = { startTime, endTime };
      return true;
    }
  }

  if (typeof periodRaw === "string" && periodRaw) {
    datetime.type = "relative";
    datetime.relativeTimePeriod = periodRaw;
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
  if (datetime.type === "relative") {
    next.period = datetime.relativeTimePeriod;
    delete next.from;
    delete next.to;
  } else {
    next.from = String(datetime.startTime);
    next.to = String(datetime.endTime);
    delete next.period;
  }
  router.replace({ query: next }).catch(() => {});
}

async function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    datetime.type = "relative";
    datetime.relativeTimePeriod = value.relativeTimePeriod;
    applyRelative(value.relativeTimePeriod);
  } else {
    datetime.type = "absolute";
    datetime.startTime = value.startTime;
    datetime.endTime = value.endTime;
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
    if (datetime.type === "relative") {
      applyRelative(datetime.relativeTimePeriod);
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
  // Seed from URL if present; fall back to the default relative window
  // (and write that default back so the URL always carries the state).
  if (!readFromUrl()) {
    applyRelative(DEFAULT_RELATIVE);
    writeToUrl();
  }
});
</script>
