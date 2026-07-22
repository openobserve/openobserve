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

<!--
  LLMSchemaPanel — renders one LLM Insights trend panel through the shared
  dashboards `PanelSchemaRenderer`. Drop-in alternative to `LLMTrendPanel`
  for panel types that map cleanly to a dashboard chart (see
  `llmPanelSchema.ts → TYPE_MAP`). Inherits dashboard timezone, tooltips,
  axes, legends, units and lazy-loading for free.

  The card chrome (title/subtitle + border) matches LLMTrendPanel so the two
  renderers look identical side by side during the incremental migration.
-->
<template>
  <div class="bg-card-glass-bg rounded-default flex flex-col border border-border-default">
    <div class="flex items-baseline justify-between mb-1 p-page-edge">
      <div>
        <div class="text-sm font-semibold text-text-heading">
          {{ displayTitle }}
        </div>
        <div v-if="displaySubtitle" class="text-2xs leading-normal mt-[0.1rem]">
          {{ displaySubtitle }}
        </div>
      </div>
    </div>

    <!-- h-55 matches LLMTrendPanel's chart height (13.75rem) so the converted
         panel lines up with the legacy ones in the same grid row. The renderer
         needs an explicit full size to fill the box — without it the echarts
         canvas collapses to a sliver. -->
    <div class="llm-schema-panel__body w-full h-55 relative">
      <PanelSchemaRenderer
        v-if="chartData"
        class="llm-schema-panel__renderer h-full w-full"
        :panelSchema="chartData"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        :dashboardId="dashboardId"
        :folderId="folderId"
        searchType="dashboards"
        :allowAnnotationsAPI="false"
        :width="6"
        :height="6"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import { type LLMPanelDef, renderPanelSql, panelI18nKey } from "./config/llmInsightsPanels";
import { buildLLMPanelSchema } from "./llmPanelSchema";

interface Props {
  panel: LLMPanelDef;
  streamName: string;
  // epoch microseconds (same units LLMTrendPanel receives)
  startTime: number;
  endTime: number;
  // Bare agent predicate (no leading AND); "" = All Agents.
  agentFilter?: string;
  // Panel-cache identity, forwarded to PanelSchemaRenderer. The dashboards
  // engine restores a panel's result from its IndexedDB cache on mount (keyed
  // `folderId:dashboardId:panelId`) and skips the query when it hits — but the
  // cache is a no-op unless all three ids are non-empty. We feed a synthetic,
  // scoped pair (panelId comes from the schema's `llm-<id>`) so LLM Insights
  // reuses that same mechanism. See LLMInsightsDashboard for how they're built.
  dashboardId?: string;
  folderId?: string;
}

const props = defineProps<Props>();

const { t } = useI18n();

// Title/subtitle come from the en.json `aiObservability.panels.<id>` copy.
const displayTitle = computed(() => t(`${panelI18nKey(props.panel.id)}.title`));
const displaySubtitle = computed(() => t(`${panelI18nKey(props.panel.id)}.subtitle`));

// Fully-rendered SQL: stream substituted, agent predicate spliced. We swap the
// templated `histogram(_timestamp, '{{interval}}')` for the auto-bucketing
// `histogram(_timestamp)` so the dashboard engine re-buckets to the selected
// time range itself — the explicit interval that the legacy LLMTrendPanel needs
// (for its client-side zero-fill grid) is redundant and over-constraining here
// (Decision D8). No `pickInterval` needed.
const sql = computed(() => {
  const autoBucketSql = props.panel.query.sql.replace(
    /histogram\((_timestamp),\s*'\{\{interval\}\}'\)/g,
    "histogram($1)",
  );
  let rendered = renderPanelSql(autoBucketSql, {
    stream: props.streamName,
    startTime: props.startTime,
    endTime: props.endTime,
    interval: "",
    agentFilter: props.agentFilter,
  });

  // Bar panels declare a top-N cap (the legacy renderer sliced client-side).
  // The query is ordered DESC, so a trailing LIMIT yields the top N. Only add
  // it when the template doesn't already carry one.
  if (props.panel.limit && !/\blimit\b/i.test(rendered)) {
    rendered = `${rendered} LIMIT ${props.panel.limit}`;
  }
  return rendered;
});

const chartData = computed(() =>
  props.streamName
    ? buildLLMPanelSchema({
        panel: props.panel,
        sql: sql.value,
        stream: props.streamName,
      })
    : null,
);

// The dashboard pipeline carries timestamps as `new Date(microseconds)` — the
// µs value is passed straight into `new Date()` (a nominally far-future Date)
// so that `.getTime()` round-trips the *microsecond* count the search backend
// expects. Do NOT divide by 1000: that yields a correct-looking Date whose
// getTime() is in ms, which the backend then misreads as µs (→ a 1970 window
// → empty results). Matches how PreviewAlert / dashboards build selectedTimeObj.
const selectedTimeObj = computed(() => ({
  start_time: new Date(props.startTime),
  end_time: new Date(props.endTime),
}));
</script>
