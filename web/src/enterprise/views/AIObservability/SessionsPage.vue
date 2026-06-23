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
    data-test="ai-sessions-page"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:overflow-hidden"
  >
    <AppPageHeader
      :title="t('aiObservability.nav.sessions')"
      icon="forum"
      class="tw:px-4 tw:border-b tw:border-border-default"
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
          data-test="ai-sessions-date-time"
          class="tw:h-[2rem]"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="isRefreshing"
          title="Refresh"
          data-test="ai-sessions-refresh-btn"
          @click="refresh"
        />
      </template>
    </AppPageHeader>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:px-4 tw:py-3">
      <SessionsList
        ref="sessionsRef"
        :stream-name="streamName"
        :start-time="timeRange.startTime"
        :end-time="timeRange.endTime"
        detail-route-name="aiSessionDetails"
        class="tw:h-full"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import DateTime from "@/components/DateTime.vue";
import SessionsList from "@/plugins/traces/SessionsList.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { getConsumableRelativeTime } from "@/utils/date";
import {
  useAiDateRange,
  resolveAiDateWindow,
} from "@/enterprise/composables/useAiDateRange";

defineOptions({ name: "AISessionsPage" });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const DEFAULT_RELATIVE = "15m";

// Shared with LLM Insights + Quality — see useAiDateRange.ts.
const { state: dateState } = useAiDateRange();

const timeRange = ref({ startTime: 0, endTime: 0 });
const streamName = ref("");
const dateTimeRef = ref<any>(null);
const sessionsRef = ref<any>(null);
const isRefreshing = ref(false);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  dateState.value = {
    ...dateState.value,
    valueType: "relative",
    relativeTimePeriod: period,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

// URL ↔ shared date sync. URL wins over shared state on mount so deep-links
// reproduce the exact saved view, but shared state is the cross-page memory
// when no URL hint is present.
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
  sessionsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

async function refresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      writeToUrl();
    }
    await nextTick();
    await sessionsRef.value?.refresh?.(
      timeRange.value.startTime,
      timeRange.value.endTime,
    );
  } finally {
    isRefreshing.value = false;
  }
}

onMounted(() => {
  // Precedence: URL > cross-page shared state > default relative.
  if (readFromUrl()) return;

  const window = resolveAiDateWindow(dateState.value);
  if (window) {
    timeRange.value = window;
    if (dateState.value.valueType === "relative") {
      applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
    }
  } else {
    applyRelative(DEFAULT_RELATIVE);
  }
  writeToUrl();
});
</script>
