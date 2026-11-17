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
  <div class="bg-card-glass-bg flex h-full flex-col" data-test="traces-sql-awaiting-run">
    <div
      v-if="showCharts"
      class="flex shrink-0 flex-col gap-1 p-1 md:h-40 md:flex-row"
      data-test="traces-sql-awaiting-run-charts"
    >
      <div
        v-for="frame in frames"
        :key="frame.key"
        class="border-border-default bg-surface-base rounded-default flex h-40 min-w-0 flex-col overflow-hidden border md:h-auto md:flex-1"
        :data-test="`traces-sql-awaiting-run-frame-${frame.key}`"
      >
        <PanelBar class="w-full">
          <span class="truncate">{{ frame.title }}</span>
        </PanelBar>
      </div>
    </div>
    <OEmptyState
      class="min-h-0 flex-1"
      illustration="query"
      variant="neutral"
      size="hero"
      :title="t('traces.sqlMode.awaitingRun.spansTitle')"
      :description="t('traces.sqlMode.awaitingRun.description')"
      :action-label="t('emptyState.noQueryApplied.action')"
      action-icon="play-arrow"
      @action="emit('run')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import PanelBar from "@/components/common/PanelBar.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

/** SQL waiting for Run: the chart frames keep their place, with no data and no count, above a run prompt. */
defineProps<{
  showCharts: boolean;
}>();

const emit = defineEmits<{
  (e: "run"): void;
}>();

const { t } = useI18nTyped();

const frames = computed(() => [
  { key: "rate", title: t("traces.sqlMode.awaitingRun.rate") },
  { key: "errors", title: t("traces.sqlMode.awaitingRun.errors") },
  { key: "duration", title: t("traces.latencyHeatmap.title") },
]);
</script>
