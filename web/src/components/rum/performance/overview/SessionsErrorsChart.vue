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
  <div>
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-text-heading text-base font-bold">
        {{ t("rum.overviewPage.chartTitle") }}
        <span
          class="text-text-secondary text-sm font-normal"
          data-test="rum-overview-chart-interval"
        >
          {{ t(INTERVAL_KEYS[interval] ?? "rum.overviewPage.chartIntervalOther") }}
        </span>
      </h2>
      <p v-if="marker" class="text-text-secondary text-sm" data-test="rum-overview-chart-release">
        {{
          t("rum.overviewPage.releaseMarker", { version: raw(marker.version), time: markerTime })
        }}
      </p>
    </div>

    <div class="mt-3 h-72" data-test="rum-overview-chart-plot">
      <OSkeleton v-if="chartLoading" class="h-full w-full" />
      <PanelSchemaRenderer
        v-show="!chartLoading"
        :key="rendererKey"
        class="h-full w-full"
        :panelSchema="panelSchema"
        :selectedTimeObj="selectedTimeObj"
        :variablesData="{}"
        :forceLoad="true"
        :searchResponse="searchResponse"
        searchType="RUM"
        :allowAnnotationsAPI="false"
        @loading-state-change="chartLoading = $event"
      />
    </div>

    <div class="mt-2">
      <OButton
        variant="ghost"
        size="sm"
        :aria-expanded="showTable"
        data-test="rum-overview-chart-table-toggle"
        @click="showTable = !showTable"
      >
        {{
          showTable ? t("rum.overviewPage.chartTableHide") : t("rum.overviewPage.chartTableToggle")
        }}
      </OButton>
    </div>
    <div v-if="showTable" role="region" :aria-label="t('rum.overviewPage.chartTableCaption')">
      <OTable
        :data="tableRows"
        :columns="columns"
        :default-columns="false"
        row-key="ts"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :frame="false"
        data-test="rum-overview-chart-table"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { formatCount, formatInZone } from "@/utils/rum/performanceOverview";
import { buildOverviewChartPanel } from "@/utils/rum/performanceOverviewPanel";

interface Point {
  ts: number;
  sessions: number;
  errors: number;
}

const props = defineProps<{
  sql: string;
  interval: string;
  range: { startUs: number; endUs: number };
  points: Point[];
  hits: Record<string, unknown>[];
  marker: { version: string; ts: number } | null;
}>();
const { t } = useI18nTyped();
const store = useStore();
const timezone = computed<string>(() => store.state.timezone);

const INTERVAL_KEYS: Record<string, I18nKey> = {
  "5 minute": "rum.overviewPage.chartPerFiveMinutes",
  "30 minute": "rum.overviewPage.chartPerThirtyMinutes",
  "1 hour": "rum.overviewPage.chartPerHour",
  "6 hour": "rum.overviewPage.chartPerSixHours",
  "1 day": "rum.overviewPage.chartPerDay",
};

const showTable = ref(false);
const chartLoading = ref(true);

const timeLabel = (ts: number): I18nText => raw(formatInZone(ts / 1000, timezone.value));
const markerTime = computed(() => (props.marker ? timeLabel(props.marker.ts) : raw("")));

const panelSchema = computed(() =>
  buildOverviewChartPanel(
    props.sql,
    {
      title: t("rum.overviewPage.chartTitle"),
      time: t("rum.overviewPage.chartTime"),
      sessions: t("rum.overviewPage.legendSessions"),
      errors: t("rum.overviewPage.legendErrors"),
    },
    props.marker ? { version: props.marker.version, ms: props.marker.ts / 1000 } : null,
    timezone.value,
  ),
);

// usePanelDataLoader reads getTime() off these Dates as microseconds.
const selectedTimeObj = computed(() => ({
  start_time: new Date(props.range.startUs),
  end_time: new Date(props.range.endUs),
}));

// Prefetched rows make the renderer skip its own query.
const searchResponse = computed(() => ({ hits: props.hits }));

// The renderer does not watch prefetched rows, so they key the remount; the marker only restyles.
const rendererKey = computed(() =>
  JSON.stringify([props.range, props.sql, timezone.value, props.hits]),
);
watch(rendererKey, () => {
  chartLoading.value = true;
});

interface TableRow {
  ts: number;
  time: I18nText;
  sessions: I18nText;
  errors: I18nText;
}

const tableRows = computed<TableRow[]>(() =>
  props.points.map((p) => ({
    ts: p.ts,
    time: timeLabel(p.ts),
    sessions: raw(formatCount(p.sessions)),
    errors: raw(formatCount(p.errors)),
  })),
);

const columns = computed<OTableColumnDef<TableRow>[]>(() => [
  { id: "time", header: t("rum.overviewPage.chartTime"), accessorKey: "time", size: 200 },
  {
    id: "sessions",
    header: t("rum.overviewPage.legendSessions"),
    accessorKey: "sessions",
    size: 120,
    meta: { align: "right" },
  },
  {
    id: "errors",
    header: t("rum.overviewPage.legendErrors"),
    accessorKey: "errors",
    size: 120,
    meta: { align: "right" },
  },
]);
</script>
