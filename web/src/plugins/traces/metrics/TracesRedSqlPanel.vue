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
    class="border-border-default bg-surface-base rounded-default flex h-full min-h-0 min-w-0 flex-col overflow-hidden border"
    :data-test="`traces-red-sql-panel-${name}`"
  >
    <PanelBar class="w-full">
      <span class="flex min-w-0 items-center">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate">{{ panelSchema.title }}</span>
          <span
            v-if="panelSchema.config?.title_meta"
            class="text-2xs text-text-secondary shrink-0 font-normal whitespace-nowrap"
            >{{ panelSchema.config.title_meta }}</span
          >
        </span>
        <TracesRedCaptionInfo v-if="caption?.length" :panel="name" :lines="caption" />
      </span>
    </PanelBar>
    <div class="relative min-h-0 flex-1">
      <div
        v-if="status === 'loading'"
        class="flex h-full items-center justify-center"
        :data-test="`traces-red-sql-panel-${name}-loading`"
      >
        <OSpinner size="sm" />
      </div>
      <div
        v-else-if="status === 'error'"
        class="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-sm"
        :data-test="`traces-red-sql-panel-${name}-error`"
      >
        <span class="text-status-error-text">{{ t("traces.redCharts.loadFailed") }}</span>
        <span v-if="error" class="text-text-secondary line-clamp-2 text-xs">{{ error }}</span>
        <OButton
          variant="outline"
          size="sm"
          :data-test="`traces-red-sql-panel-${name}-retry`"
          @click="emit('retry')"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
      <PanelSchemaRenderer
        v-else-if="status === 'ready' && hits.length"
        :key="runKey"
        class="h-full w-full"
        :panelSchema="panelSchema"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        :forceLoad="true"
        :searchResponse="{ hits }"
        searchType="dashboards"
        :allowAnnotationsAPI="false"
        @updated:data-zoom="emit('data-zoom', $event)"
      />
      <OEmptyState
        v-else-if="status === 'ready'"
        size="inline"
        icon="bar-chart"
        :title="t('traces.redCharts.noData')"
        :backdrop="false"
        class="h-full"
        :data-test="`traces-red-sql-panel-${name}-no-data`"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import PanelBar from "@/components/common/PanelBar.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import TracesRedCaptionInfo from "./TracesRedCaptionInfo.vue";

defineProps<{
  name: "rate" | "errors";
  panelSchema: Record<string, any>;
  status: "loading" | "ready" | "error";
  error?: string;
  /** Rows already fetched, so the renderer draws them instead of running its own query. */
  hits: Record<string, unknown>[];
  selectedTimeObj: { start_time: Date; end_time: Date };
  /** Changes on every run, because the renderer does not watch prefetched rows. */
  runKey: number;
  /** Which spans the SQL-mode charts cover; empty hides the info icon. */
  caption?: string[];
}>();

const emit = defineEmits<{
  (e: "retry"): void;
  (e: "data-zoom", event: { start: number; end: number; data: unknown }): void;
}>();

const { t } = useI18nTyped();
</script>
