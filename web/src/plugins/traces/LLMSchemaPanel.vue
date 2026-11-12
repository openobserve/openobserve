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
  <LLMPanelCard :title="displayTitle" :subtitle="displaySubtitle || undefined">
    <template v-if="panel.alert" #actions>
      <CreateAlertAction
        variant="icon"
        source="ai"
        :build="buildAlert"
        :data-test="`llm-panel-create-alert-${panel.id}`"
      />
    </template>
    <!-- h-55 matches LLMTrendPanel's chart height (13.75rem) so the converted
         panel lines up with the legacy ones in the same grid row. The renderer
         needs an explicit full size to fill the box — without it the echarts
         canvas collapses to a sliver. -->
    <div class="llm-schema-panel__body relative h-55 w-full">
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
        :allowDrilldown="false"
        :class="panel.drill ? 'cursor-pointer' : ''"
        @chart-click="onChartClick"
        :width="6"
        :height="6"
      />
    </div>
  </LLMPanelCard>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import LLMPanelCard from "./LLMPanelCard.vue";
import { type LLMPanelDef, renderPanelSql } from "./config/llmInsightsPanels";
import { buildLLMPanelSchema } from "./llmPanelSchema";
import { getUTCTimestampFromZonedTimestamp } from "@/utils/dashboard/dateTimeUtils";
import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import { buildAiPrefill } from "@/utils/alerts/prefill/fromAi";
import type { LLMPanelDrill } from "./llmInsightsDrill";
import { streamHasParentSpan } from "./llmStreamColumns";

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
  /** The agent in scope, for "Create alert" (none = every agent on the stream). */
  alertAgent?: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: "drill", drill: LLMPanelDrill): void }>();

const buildAlert = () =>
  buildAiPrefill({ kind: props.panel.alert!, stream: props.streamName, agent: props.alertAgent });
const store = useStore();

// Usage trends fall back to top-level agents, so they wait to learn whether the stream stores span parents.
const needsParents = computed(() => props.panel.query.sql.includes("{{agentParents}}"));
const hasParentSpan = ref<boolean | null>(null);
watch(
  () => [props.streamName, needsParents.value] as const,
  async ([stream, needs]) => {
    hasParentSpan.value = null;
    if (!needs || !stream) return;
    const resolved = await streamHasParentSpan(store.state.selectedOrganization.identifier, stream);
    if (props.streamName === stream) hasParentSpan.value = resolved;
  },
  { immediate: true },
);

// Chart times are shifted into the viewer's timezone.
function onChartClick(params: any) {
  if (!props.panel.drill || !params) return;
  if (props.panel.type === "horizontal-bar") {
    emit("drill", { panel: props.panel, series: String(params.name ?? ""), atMicros: null });
    return;
  }
  const x = Array.isArray(params.value) ? params.value[0] : params.name;
  const ms = typeof x === "number" ? x : Date.parse(String(x));
  emit("drill", {
    panel: props.panel,
    series: params.seriesName ?? null,
    atMicros: Number.isFinite(ms)
      ? getUTCTimestampFromZonedTimestamp(ms, store.state.timezone || "UTC")
      : null,
  });
}

const { t } = useI18nTyped();

// Panel defs are a plain config module with no i18n context, so they carry keys.
const displayTitle = computed(() => t(props.panel.titleKey));
const displaySubtitle = computed(() => (props.panel.subtitleKey ? t(props.panel.subtitleKey) : ""));

// Fully-rendered SQL: stream substituted, agent predicate spliced. We swap the
// templated `histogram(_timestamp, '{{interval}}')` for the auto-bucketing
// `histogram(_timestamp)` so the dashboard engine re-buckets to the selected
// time range itself — the explicit interval that the legacy LLMTrendPanel needs
// (for its client-side zero-fill grid) is redundant and over-constraining here
// (Decision D8). No `pickInterval` needed.
const sql = computed(() => {
  const autoBucketSql = props.panel.query.sql.replace(
    /histogram\((_timestamp|first_ts),\s*'\{\{interval\}\}'\)/g,
    "histogram($1)",
  );
  let rendered = renderPanelSql(autoBucketSql, {
    stream: props.streamName,
    startTime: props.startTime,
    endTime: props.endTime,
    interval: "",
    agentFilter: props.agentFilter,
    unattributedLabel: t("llmAttribution.unattributed"),
    hasParentSpan: !!hasParentSpan.value,
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
  props.streamName && (!needsParents.value || hasParentSpan.value !== null)
    ? buildLLMPanelSchema({
        panel: props.panel,
        sql: sql.value,
        stream: props.streamName,
        t,
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
