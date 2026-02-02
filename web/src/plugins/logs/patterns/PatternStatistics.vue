<!-- Copyright 2023 OpenObserve Inc.

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
    class="tw:py-2 tw:px-4 tw:shrink-0 tw:bg-[var(--o2-bg-gray)] tw:text-sm"
    data-test="pattern-statistics"
    :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
  >
    {{ summaryText }}
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

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

  return `Showing 1 to 50 out of ${totalEvents} events & ${patternsFound} patterns found in ${logsAnalyzed} events in ${totalTimeMs} ms.`;
});
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";
</style>
