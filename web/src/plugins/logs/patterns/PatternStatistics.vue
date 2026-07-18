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
    class="py-2 px-4 shrink-0 bg-[var(--o2-bg-gray)] text-sm"
    data-test="pattern-statistics"
    :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-400'"
  >
    {{ summaryText }}
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  statistics: any;
  totalEvents?: number;
  histogramTime?: number;
}>();

const store = useStore();

const summaryText = computed(() => {
  const patternsFound = props.statistics?.total_patterns_found || 0;
  const logsAnalyzed = (props.statistics?.total_logs_analyzed || 0).toLocaleString();
  const totalEvents = props.totalEvents ? props.totalEvents.toLocaleString() : logsAnalyzed;

  // Combine histogram time + pattern extraction time
  const histogramMs = props.histogramTime || 0;
  const patternMs = props.statistics?.extraction_time_ms || 0;
  const totalTimeMs = histogramMs + patternMs;

  return t("logs.patternStatistics.summary", {
    totalEvents,
    patternsFound,
    logsAnalyzed,
    totalTimeMs,
  });
});
</script>
