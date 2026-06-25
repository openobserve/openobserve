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
    data-test="synthetic-monitor-results-page"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:overflow-hidden"
  >
    <AppPageHeader
      :title="monitorName"
      icon="radar"
      :back="{ label: t('synthetics.results.monitors'), to: { name: 'synthetic' } }"
      class="tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <date-time
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="timeState.valueType"
          :default-absolute-time="{
            startTime: timeState.startTime ?? 0,
            endTime: timeState.endTime ?? 0,
          }"
          :default-relative-time="timeState.relativeTimePeriod ?? ''"
          data-test="synthetic-monitor-results-date-time"
          class="tw:h-[2rem]"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="edit"
          title="Edit Monitor"
          data-test="synthetic-monitor-results-edit-btn"
          @click="editMonitor"
        >
          {{ t("synthetics.results.editMonitor") }}
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isRefreshing"
          title="Refresh"
          data-test="synthetic-monitor-results-refresh-btn"
          @click="refresh"
        />
      </template>
    </AppPageHeader>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:px-4 tw:py-3">
      <MonitorResultsDashboard
        ref="dashboardRef"
        :monitor-id="monitorId"
        :start-time="timeRange.startTime"
        :end-time="timeRange.endTime"
        class="tw:h-full"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import MonitorResultsDashboard from "@/views/synthetics/MonitorResultsDashboard.vue";
import { getConsumableRelativeTime } from "@/utils/date";

defineOptions({ name: "SyntheticMonitorResults" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const DEFAULT_RELATIVE = "15m";

const monitorId = computed(() => String(route.params.id ?? ""));
const monitorName = computed(
  () => String(route.query.name ?? "") || t("synthetics.results.title"),
);

// Local date state + URL sync (mirrors the Logs convention used by LLM
// Insights, minus the cross-page shared singleton).
type DateValueType = "relative" | "absolute";
const timeState = ref<{
  valueType: DateValueType;
  startTime: number | null;
  endTime: number | null;
  relativeTimePeriod: string | null;
}>({
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: DEFAULT_RELATIVE,
});

const timeRange = ref({ startTime: 0, endTime: 0 });
const dateTimeRef = ref<any>(null);
const dashboardRef = ref<any>(null);
const isRefreshing = ref(false);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  timeState.value = {
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

// URL ↔ date sync. relative → ?period=15m, absolute → ?from=<micros>&to=<micros>.
function readFromUrl(): boolean {
  const fromRaw = route.query.from;
  const toRaw = route.query.to;
  const periodRaw = route.query.period;

  if (typeof fromRaw === "string" && typeof toRaw === "string") {
    const startTime = Number(fromRaw);
    const endTime = Number(toRaw);
    if (
      Number.isFinite(startTime) &&
      Number.isFinite(endTime) &&
      endTime > startTime
    ) {
      timeState.value = {
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
  const next: Record<string, any> = { ...route.query };
  if (timeState.value.valueType === "relative") {
    next.period = timeState.value.relativeTimePeriod ?? DEFAULT_RELATIVE;
    delete next.from;
    delete next.to;
  } else {
    next.from = String(timeState.value.startTime ?? 0);
    next.to = String(timeState.value.endTime ?? 0);
    delete next.period;
  }
  router.replace({ query: next }).catch(() => {});
}

async function onDateChange(value: any) {
  if (value?.valueType === "relative" && value.relativeTimePeriod) {
    applyRelative(value.relativeTimePeriod);
  } else {
    timeState.value = {
      valueType: "absolute",
      startTime: value.startTime,
      endTime: value.endTime,
      relativeTimePeriod: null,
    };
    timeRange.value = { startTime: value.startTime, endTime: value.endTime };
  }
  writeToUrl();
  await nextTick();
  dashboardRef.value?.refresh?.(
    timeRange.value.startTime,
    timeRange.value.endTime,
  );
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    // Re-anchor a relative window to "now" so the data is genuinely fresh.
    if (timeState.value.valueType === "relative") {
      applyRelative(timeState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
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

function editMonitor() {
  router.push({ name: "synthetic", query: { edit: monitorId.value } });
}

onMounted(() => {
  if (!readFromUrl()) {
    applyRelative(DEFAULT_RELATIVE);
  }
  writeToUrl();
  nextTick(() => {
    dashboardRef.value?.refresh?.(
      timeRange.value.startTime,
      timeRange.value.endTime,
    );
  });
});
</script>
