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
          :default-type="datetime.type"
          :default-absolute-time="{
            startTime: datetime.startTime,
            endTime: datetime.endTime,
          }"
          :default-relative-time="datetime.relativeTimePeriod"
          data-test="ai-sessions-date-time"
          class="tw:h-[2rem]"
          @on:date-change="onDateChange"
        />
      </template>
    </AppPageHeader>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <SessionsList
        ref="sessionsRef"
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
import DateTime from "@/components/DateTime.vue";
import SessionsList from "@/plugins/traces/SessionsList.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { getConsumableRelativeTime } from "@/utils/date";

defineOptions({ name: "AISessionsPage" });

const { t } = useI18n();

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
const sessionsRef = ref<any>(null);

function applyRelative(period: string) {
  const range = getConsumableRelativeTime(period);
  if (!range) return;
  timeRange.value = { startTime: range.startTime, endTime: range.endTime };
  datetime.startTime = range.startTime;
  datetime.endTime = range.endTime;
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
  await nextTick();
  sessionsRef.value?.refresh?.(timeRange.value.startTime, timeRange.value.endTime);
}

onMounted(() => {
  applyRelative(DEFAULT_RELATIVE);
});
</script>
