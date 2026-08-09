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
  QueryDetailPage (FR-5 + FR-6) — one fingerprint, end to end.

  A full page rather than a drawer, matching the category convention
  (Datadog/Grafana/Sentry) and because this screen is a destination: it is
  linked from a span, from the queries table, and pasted into incident channels,
  all of which need a URL.

  It is built around the 2am test's two weakest and strongest minutes:

   • 8–12 min (our best stage) — "show me one real bad execution". The samples
     scatter and its trace pivot get prominence rather than a tab, because this
     is the one thing the category does not do uniformly.
   • 12–15 min (our worst) — "what do I tell the channel". The copy button
     composes the message; every number in it is already on this page.

  Unit trap, load-bearing in two places: rollup metrics are NANOseconds
  (`end_time - start_time` on a span, undivided), while the raw-span `duration`
  column is MICROseconds (`(end_time - start_time) / 1000`). Samples are read
  from `duration` and converted once, at the boundary, so everything downstream
  of `loadSamples` is uniformly ns.
-->
<template>
  <OPageLayout
    :title="t('dbm.detail.title')"
    :back="{ label: t('dbm.detail.backToQueries'), to: queriesRoute }"
    icon="storage"
    title-data-test="dbm-detail-title"
    scroll
  >
    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-detail-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="content-copy"
        class="shrink-0"
        data-test="dbm-detail-copy-summary"
        @click="copySummary"
      >
        {{ t("dbm.detail.copySummary") }}
        <OTooltip side="bottom" :content="t('dbm.detail.copySummaryHint')" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        class="shrink-0"
        data-test="dbm-detail-refresh"
        @click="load"
      >
        <OTooltip side="bottom" :content="t('dbm.common.reload')" />
      </OButton>
    </template>

    <div class="flex flex-col gap-4 pt-3">
      <!-- Identity: the statement, then the dimensions that locate it. -->
      <section class="flex flex-col gap-2" data-test="dbm-detail-identity">
        <div class="flex flex-wrap items-center gap-1.5">
          <OTag v-if="row?.db_system" type="dbSystem" :value="row.db_system" />
          <OTag v-for="chip in identityChips" :key="chip.key" :label="chip.label" size="xs" />
          <span v-if="firstSeenLabel" class="text-text-secondary text-xs">
            {{ firstSeenLabel }}
            <OTooltip side="bottom" :content="t('dbm.detail.firstSeenHint')" />
          </span>
          <div class="flex-1"></div>
          <!-- Beside the statement, not in the page actions: the question is
               about THIS query, and the button has to sit where the artifact is
               for that to be obvious. -->
          <DbmSuggestFixButton
            :label="t('dbm.ai.suggestFix')"
            :tooltip="t('dbm.ai.suggestFixHint')"
            data-test="dbm-detail-suggest-fix"
            @click="askAiForFix"
          />
        </div>

        <DbmQueryText
          :query="queryText"
          :db-system="row?.db_system ?? ''"
          data-test="dbm-detail-query-text"
        />
        <span v-if="row?.truncated" class="text-text-muted text-2xs">
          {{ t("dbm.queries.truncatedText") }}
        </span>
      </section>

      <!-- The headline numbers, before the charts: minute 0 of an incident is
           "how bad and how much of the database is it", and that is six
           figures, not a graph. -->
      <div
        class="border-border-default rounded-surface grid grid-cols-2 overflow-hidden border md:grid-cols-3 xl:grid-cols-6"
        data-test="dbm-detail-stats"
      >
        <div
          v-for="stat in headlineStats"
          :key="stat.id"
          class="border-border-subtle border-r border-b px-3 py-2 last:border-r-0"
          :data-test="`dbm-detail-stat-${stat.id}`"
        >
          <!-- The percentile the plain-English label stands for, alongside it in
               the quiet weight — the tile says what it means and what it is. -->
          <div class="flex items-baseline gap-1">
            <span class="text-text-label text-3xs font-semibold tracking-wide uppercase">
              {{ stat.label }}
            </span>
            <span v-if="stat.sub" class="text-text-muted text-3xs" data-test="dbm-detail-stat-sub">
              {{ stat.sub }}
            </span>
          </div>
          <div
            class="text-text-heading font-mono text-lg leading-tight font-semibold tabular-nums"
            :class="stat.tone"
          >
            {{ stat.value }}
          </div>
          <div class="text-text-secondary text-3xs">{{ stat.detail }}</div>
        </div>
      </div>

      <!-- Coverage, as the same quiet line the list pages carry. -->
      <DbmCoverageLine
        :freshness="freshness"
        :hits="row ? [row] : []"
        :top-n-subset="topNSubset"
        :coded-error-share="uncodedErrorShare === undefined ? undefined : 1 - uncodedErrorShare"
        :error-count="row?.errors"
        subject="query"
        data-test="dbm-detail-coverage"
      />

      <!-- Fidelity disclosure. Fires only when the series actually contains
           below-top-N windows, so it describes this chart rather than standing
           permanently and being skipped. -->
      <OBanner
        v-if="history?.hasBelowTopN"
        variant="info"
        icon="info"
        data-test="dbm-detail-below-top-n"
      >
        <div class="flex flex-col gap-1">
          <span class="font-medium">{{ t("dbm.detail.belowTopN.title") }}</span>
          <span class="text-xs">
            {{
              history.backfillCapped
                ? t("dbm.detail.belowTopN.capped", { windows: BACKFILL_MAX_WINDOWS })
                : t("dbm.detail.belowTopN.body")
            }}
          </span>
        </div>
      </OBanner>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section
          class="card-container border-border-default rounded-surface flex flex-col border p-3"
          data-test="dbm-detail-latency-chart"
        >
          <h3 class="text-text-heading mb-1 text-sm font-medium">
            {{ t("dbm.detail.latencyTitle") }}
          </h3>
          <OSkeleton v-if="loading" variant="button" class="h-55 w-full" />
          <div v-else-if="!hasSeries" class="text-text-muted flex h-55 items-center justify-center">
            {{ t("dbm.detail.noSeries") }}
          </div>
          <div v-else class="h-55 w-full">
            <PanelSchemaRenderer
              :panel-schema="latencyPanelSchema"
              :selected-time-obj="selectedTimeObj"
              :variables-data="{}"
              :injected-promql-data="latencyInjectedData"
              :allow-annotations-add="false"
              :allow-annotations-a-p-i="false"
              data-test="dbm-detail-latency-panel"
            />
          </div>
        </section>

        <section
          class="card-container border-border-default rounded-surface flex flex-col border p-3"
          data-test="dbm-detail-volume-chart"
        >
          <h3 class="text-text-heading mb-1 text-sm font-medium">
            {{ t("dbm.detail.volumeTitle") }}
          </h3>
          <OSkeleton v-if="loading" variant="button" class="h-55 w-full" />
          <div v-else-if="!hasSeries" class="text-text-muted flex h-55 items-center justify-center">
            {{ t("dbm.detail.noSeries") }}
          </div>
          <div v-else class="h-55 w-full">
            <PanelSchemaRenderer
              :panel-schema="volumePanelSchema"
              :selected-time-obj="selectedTimeObj"
              :variables-data="{}"
              :injected-promql-data="volumeInjectedData"
              :allow-annotations-add="false"
              :allow-annotations-a-p-i="false"
              data-test="dbm-detail-volume-panel"
            />
          </div>
        </section>
      </div>

      <!-- The two panels below read RAW traces, so they need to know which
           trace stream this fingerprint lives on — and the queries endpoint does
           not carry it. With several streams in the org there is no way to tell,
           and picking one silently would put another stream's callers under this
           query's headline numbers. So it says so, and asks. -->
      <OBanner
        v-if="streamAmbiguous"
        variant="warning"
        class="shrink-0"
        data-test="dbm-detail-stream-ambiguous"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("dbm.detail.ambiguousStream") }}</span>
          <OSelect
            :model-value="pickedStream"
            :options="streamOptions"
            width="sm"
            :placeholder="t('dbm.detail.pickStream')"
            data-test="dbm-detail-stream-picker"
            @update:model-value="onStreamPick"
          />
        </div>
      </OBanner>

      <!-- Calling endpoints: who is responsible for this query's load. The
           per-caller bars are the New Relic pattern — share is the question
           ("which caller do I go talk to"), and a bar answers it faster than
           a number. -->
      <section
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-endpoints"
      >
        <div class="flex items-center justify-between gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.endpointsTitle") }}
          </h3>
          <span class="text-text-secondary text-xs">{{ t("dbm.detail.endpointsHint") }}</span>
        </div>
        <OTable
          :data="endpoints"
          :columns="endpointColumns"
          row-key="rowKey"
          :loading="loading"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          table-id="dbm-query-endpoints"
          data-test="dbm-detail-endpoints-table"
        >
          <template #cell-caller="{ row: endpoint }">
            <div class="flex min-w-0 flex-col">
              <span class="text-text-heading truncate text-sm">{{ endpoint.serviceLabel }}</span>
              <span v-if="endpoint.endpoint" class="text-text-secondary truncate text-xs">
                {{ endpoint.endpoint }}
              </span>
            </div>
          </template>
          <template #cell-calls="{ row: endpoint }">
            <ODataBarCell
              :value="endpoint.calls"
              :max="endpointCallsMax"
              :display="`${formatCount(endpoint.calls)} · ${formatPercent(endpoint.share)}`"
            />
          </template>
          <template #cell-errors="{ row: endpoint }">
            <span
              class="tabular-nums"
              :class="endpoint.errors > 0 ? 'text-status-error-text' : 'text-text-muted'"
            >
              {{ formatCount(endpoint.errors) }}
            </span>
          </template>
          <template #cell-p95_ns="{ row: endpoint }">
            <span class="tabular-nums">{{ formatNs(endpoint.p95_ns) }}</span>
          </template>
          <template #cell-actions="{ row: endpoint }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="open-in-new"
              :data-test="`dbm-detail-endpoint-traces-${endpoint.rowKey}`"
              @click="openEndpointTraces(endpoint)"
            >
              <OTooltip side="left" :content="t('dbm.detail.viewTraces')" />
            </OButton>
          </template>
          <template #empty>
            <div v-if="!loading" class="text-text-muted p-6 text-center text-sm">
              {{ endpointsError ?? t("dbm.detail.noEndpoints") }}
            </div>
          </template>
        </OTable>
      </section>

      <!-- Slow samples. The scatter is Sentry's pattern: spread across BOTH
           time and duration so the distribution's shape is visible, not only
           its tail. Every point pivots to its trace. -->
      <section
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-samples"
      >
        <div class="flex items-center justify-between gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.samplesTitle") }}
          </h3>
          <span class="text-text-secondary text-xs">{{ t("dbm.detail.samplesHint") }}</span>
        </div>

        <div v-if="samples.length" class="h-50 w-full px-3">
          <ChartRenderer :data="{ options: samplesOption }" @click="onSampleClick" />
        </div>

        <OTable
          :data="samples"
          :columns="sampleColumns"
          row-key="rowKey"
          :loading="loading"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          table-id="dbm-query-samples"
          data-test="dbm-detail-samples-table"
          @row-click="openSampleTrace"
        >
          <template #cell-timestamp="{ row: sample }">
            <span class="tabular-nums">{{ formatClock(sample.timestamp) }}</span>
          </template>
          <template #cell-duration="{ row: sample }">
            <span class="tabular-nums">{{ formatNs(sample.durationNs) }}</span>
          </template>
          <template #cell-status="{ row: sample }">
            <OTag
              v-if="sample.isError"
              type="dataConfidence"
              value="gap"
              :label="t('dbm.detail.sampleError')"
            />
            <span v-else class="text-text-muted">{{ raw("—") }}</span>
          </template>
          <template #cell-actions="{ row: sample }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="open-in-new"
              :data-test="`dbm-detail-sample-trace-${sample.rowKey}`"
              @click.stop="openSampleTrace(sample)"
            >
              <OTooltip side="left" :content="t('dbm.detail.viewTrace')" />
            </OButton>
          </template>
          <template #empty>
            <div v-if="!loading" class="text-text-muted p-6 text-center text-sm">
              {{ samplesError ?? t("dbm.detail.noSamples") }}
            </div>
          </template>
        </OTable>
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmCoverageLine from "@/components/dbm/DbmCoverageLine.vue";
import DbmQueryText from "@/components/dbm/DbmQueryText.vue";
import DbmSuggestFixButton from "@/components/dbm/DbmSuggestFixButton.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type EndpointRow,
  type Freshness,
  type QueryStatsRow,
} from "@/services/db_monitoring";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import useStreams from "@/composables/useStreams";
import {
  contextRegistry,
  createDbmContextProvider,
  DBM_CONTEXT_KEY,
} from "@/composables/contextProviders";
import { chartColor } from "@/utils/chartTheme";
import { buildQueryFixPrompt } from "@/utils/dbm/aiPrompts";
import {
  formatCount,
  formatNs,
  formatPercent,
  formatSignedPercent,
  oneLine,
} from "@/utils/dbm/format";
import { buildHistorySeries, errorRateValues, qpsValues, seriesValues } from "@/utils/dbm/history";
import { buildSamplesOption, type DbmChartTheme } from "@/utils/dbm/historyChart";
import {
  buildHistoryRows,
  buildInjectedHistoryData,
  buildLatencyPanelSchema,
  buildVolumePanelSchema,
} from "@/utils/dbm/historyPanelSchema";
import { buildIncidentSummary } from "@/utils/dbm/incidentSummary";
import { deltaFor, isCriticalErrorRate } from "@/utils/dbm/insights";
import { escapeSingleQuotes } from "@/utils/zincutils";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);
const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

/** `HISTORY_BACKFILL_MAX_WINDOWS` in api.rs — printed in the capped disclosure. */
const BACKFILL_MAX_WINDOWS = 6;
/** Enough to show a distribution without turning the scatter into a smear. */
const SAMPLE_LIMIT = 100;
/**
 * Rows pulled when locating this fingerprint's row in the scope. The match is a
 * client-side find, so a fingerprint ranked below this is not found at all —
 * generous on purpose, and still one bounded response.
 */
const ROW_LOOKUP_LIMIT = 500;
/**
 * Rollup interval assumed until the real one is inferred from the gaps between
 * history points. Matches `ZO_DB_MONITORING_INTERVAL_SECS`' 900s default, so the
 * first paint of QPS and the band merge are right in the common case.
 */
const DEFAULT_INTERVAL_MICROS = 15 * 60 * 1_000_000;
/**
 * Phrasing cutoffs for a change figure. Under the deadband we say "about the
 * same" rather than print noise; at or above the multiple we switch from a
 * percentage to "N× more", which reads better once a number stops being a
 * percentage anyone can picture; past the round-off point the decimal is
 * spurious precision.
 */
const DELTA_PHRASING = { deadband: 0.05, timesFrom: 2, roundFrom: 10 } as const;

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { getStreams } = useStreams(t);

// This page is a route root, so MainLayout's `@sendToAiChat` binding is on it
// directly — no re-emit chain needed.
const emit = defineEmits<{
  (e: "sendToAiChat", value: { query: string; autoSend: boolean }): void;
}>();

const { range, current, refresh, setRange, queryParams } = useDbmScope(route.query);

const fingerprint = computed(() => String(route.query.fingerprint ?? ""));

/**
 * Which traces stream to read the callers and samples from.
 *
 * The queries endpoint does NOT currently return `trace_stream_name` on its
 * rows, so the param the list page forwards is often empty. This used to fall
 * back to the conventional `"default"` stream, which is the one thing it must
 * not do: in a deployment with several trace streams that silently attributes
 * ANOTHER stream's callers and samples to this fingerprint's headline numbers,
 * and it does not error — it returns plausible rows. Wrong attribution in the
 * exact place a user decides what to fix.
 *
 * So the stream is RESOLVED rather than guessed. With exactly one trace stream
 * in the org there is no ambiguity and it is used; with several, the panels say
 * they cannot tell which stream this query belongs to and offer the choice,
 * rather than picking one and presenting the result as authoritative.
 */
const streamParam = computed(() => (route.query.stream as string) || "");
/** Trace streams in this org, for resolving an unspecified stream. */
const traceStreams = ref<string[]>([]);
const streamsLoaded = ref(false);
/** Chosen in the disclosure below the panels when the org has several. */
const pickedStream = ref<string>("");
const systemFilter = computed(() => (route.query.system as string) ?? undefined);
const instanceFilter = computed(() => (route.query.instance as string) ?? undefined);
const namespaceFilter = computed(() => (route.query.namespace as string) ?? undefined);

const row = ref<QueryStatsRow | null>(null);
const previousRow = ref<QueryStatsRow | null>(null);
const freshness = ref<Freshness | null>(null);
const topNSubset = ref(false);
const scopeTotalNs = ref(0);
const otherShare = ref<number | undefined>(undefined);
const history = ref<ReturnType<typeof buildHistorySeries> | null>(null);
const intervalMicros = ref(DEFAULT_INTERVAL_MICROS);
const endpoints = ref<EndpointCallerRow[]>([]);
const endpointsError = ref<string | null>(null);
const samples = ref<SampleRow[]>([]);
const samplesError = ref<string | null>(null);
const loading = ref(false);

const org = computed(() => store.state.selectedOrganization?.identifier as string);

interface EndpointCallerRow extends EndpointRow {
  rowKey: string;
  serviceLabel: I18nText;
  /** Share of this fingerprint's calls, `0`–`1`. */
  share: number;
}

interface SampleRow {
  rowKey: string;
  /** Span start, microseconds. */
  timestamp: number;
  /** Converted from the raw `duration` column (µs) at the boundary. */
  durationNs: number;
  traceId: string;
  isError: boolean;
  statusCode: string;
}

const queriesRoute = computed(() => ({
  name: "dbmQueries",
  query: {
    org_identifier: route.query.org_identifier,
    ...queryParams.value,
    system: systemFilter.value,
    instance: instanceFilter.value,
  },
}));

const queryText = computed(() => oneLine(row.value?.query_norm) || fingerprint.value);

const identityChips = computed(() => {
  const chips: { key: string; label: I18nText }[] = [];
  const current = row.value;
  if (!current) return chips;
  if (current.db_instance) chips.push({ key: "instance", label: raw(current.db_instance) });
  if (current.db_namespace) chips.push({ key: "namespace", label: raw(current.db_namespace) });
  if (current.env) chips.push({ key: "env", label: raw(current.env) });
  if (current.operation) chips.push({ key: "operation", label: raw(current.operation) });
  // The internal query id is deliberately NOT shown. It is an implementation
  // detail with no meaning to a DBA, it looks like something they should
  // recognise, and it is already in the URL for anyone who needs it.
  return chips;
});

/**
 * "First seen in top queries" — never "first executed".
 *
 * The series starts at the first window this fingerprint ranked INTO the
 * top-N, which is not when the query first ran. A long-lived query pushed over
 * the cut by a traffic shift would otherwise be labelled new, and mislabeling
 * it is the fastest way this page loses a DBA's trust.
 */
const firstSeenLabel = computed(() => {
  const first = history.value?.points.find((point) => point.plottable);
  if (!first) return null;
  return t("dbm.detail.firstSeen", { time: formatClock(first.timestamp) });
});

const hasSeries = computed(() => (history.value?.points.length ?? 0) > 0);

const formatClock = (micros: number): string =>
  new Date(Math.floor(micros / 1000)).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * The two history charts render through `PanelSchemaRenderer` — the shared
 * dashboard engine — rather than a hand-built ECharts option, so they inherit
 * the app's units, axes, legend, tooltip, timezone and theming. The series are
 * computed here from the classified history rather than by a query, so they
 * reach the renderer through its pre-fetched-results injection path. See
 * `utils/dbm/historyPanelSchema.ts` for why that path is the right one.
 */
const latencyPanelSchema = computed(() =>
  buildLatencyPanelSchema({
    p50: t("dbm.detail.columns.p50"),
    p95: t("dbm.queries.columns.p95"),
    p99: t("dbm.queries.columns.p99"),
    time: t("dbm.detail.columns.time"),
  }),
);

const volumePanelSchema = computed(() =>
  buildVolumePanelSchema({
    qps: t("dbm.detail.qps"),
    errorRate: t("dbm.detail.errorRate"),
    time: t("dbm.detail.columns.time"),
  }),
);

/**
 * The window the renderer pins the time axis to. MICROSECONDS straight into
 * `new Date()` — the dashboard pipeline's convention. Dividing by 1000 yields a
 * correct-looking Date whose getTime() is in ms, which the converter then
 * misreads and the chart renders empty.
 */
const selectedTimeObj = computed(() => ({
  start_time: new Date(current.value.startTime),
  end_time: new Date(current.value.endTime),
}));

const latencyInjectedData = computed(() => {
  const series = history.value;
  if (!series) return undefined;
  return buildInjectedHistoryData(
    buildHistoryRows(series.points, {
      p50: seriesValues(series.points, "p50_ns"),
      p95: seriesValues(series.points, "p95_ns"),
      p99: seriesValues(series.points, "p99_ns"),
    }),
    current.value,
  );
});

const volumeInjectedData = computed(() => {
  const series = history.value;
  if (!series) return undefined;
  return buildInjectedHistoryData(
    buildHistoryRows(series.points, {
      qps: qpsValues(series.points, intervalMicros.value),
      // Emitted as a PERCENTAGE number rather than the 0–1 ratio, so the rate
      // shares a legible scale with the call bars on the panel's single value
      // axis instead of flattening into the baseline.
      error_rate: errorRateValues(series.points).map((rate) => (rate === null ? null : rate * 100)),
    }),
    current.value,
  );
});

// ─── Samples scatter ─────────────────────────────────────────────────────────

/**
 * The samples scatter stays a hand-built ECharts option (the sanctioned
 * escape hatch) for ONE reason: `PanelSchemaRenderer` does not re-emit chart
 * clicks. It binds ChartRenderer's `@click` to its own drilldown handler and
 * its `emits` list carries no `click`, so a point click is consumed internally.
 * This scatter exists to pivot to the clicked execution's trace — that pivot is
 * the panel's whole purpose, and routing it through a dashboard drilldown would
 * mean configuring a URL template instead of calling `openSampleTrace`.
 * Convert this the moment PanelSchemaRenderer forwards `click`.
 */

/**
 * Read the registered `--color-*` tokens so the scatter follows the theme.
 * ECharts renders to a canvas with no CSS cascade, so a class cannot reach it —
 * the token has to be resolved to a value and handed over. `chartColor` is the
 * sanctioned seam for that (it owns the light-theme fallbacks used before the
 * token stylesheet is live), so no colour is spelled out here. Depends on the
 * theme state so the colours re-resolve on a light/dark flip.
 */
const chartTheme = computed<Pick<DbmChartTheme, "calls" | "errors" | "axisLabel" | "splitLine">>(
  () => {
    void store.state.theme;
    return {
      calls: chartColor("--color-chart-series-1"),
      errors: chartColor("--color-severity-error-color"),
      axisLabel: chartColor("--color-text-secondary"),
      splitLine: chartColor("--color-border-default"),
    };
  },
);

const samplesOption = computed(() =>
  buildSamplesOption(samples.value, chartTheme.value, formatNs, formatClock, {
    ok: t("dbm.detail.sampleOk"),
    error: t("dbm.detail.sampleError"),
  }),
);

// ─── Headline stats ──────────────────────────────────────────────────────────

/**
 * The six numbers that answer minute 0. Each carries a second line saying what
 * it is worth: whether it changed, whether it is exact, whether "none" means
 * no failures or no visibility. A big number with no qualifier is the thing
 * that gets quoted in an incident channel and then walked back.
 */
const headlineStats = computed(() => {
  const current = row.value;
  const share = scopeTotalNs.value > 0 ? (current?.total_time_ns ?? 0) / scopeTotalNs.value : 0;
  const calls = current?.calls ?? 0;
  const errors = current?.errors ?? 0;
  const callsChange = deltaFor(current?.calls, previousRow.value?.calls);
  const latencyChange = deltaFor(current?.p95_ns, previousRow.value?.p95_ns);

  const changeWords = (delta: ReturnType<typeof deltaFor>): I18nText => {
    if (delta.state !== "changed" || delta.ratio === undefined) return t("dbm.delta.new");
    if (Math.abs(delta.ratio) < DELTA_PHRASING.deadband) return t("dbm.delta.noChange");
    const factor = 1 + delta.ratio;
    if (factor >= DELTA_PHRASING.timesFrom)
      return t("dbm.delta.timesMore", {
        ratio: factor >= DELTA_PHRASING.roundFrom ? Math.round(factor) : factor.toFixed(1),
      });
    return raw(formatSignedPercent(delta.ratio));
  };

  return [
    {
      id: "load",
      label: t("dbm.detail.stats.load"),
      sub: undefined,
      value: raw(formatNs(current?.total_time_ns)),
      detail: t("dbm.detail.stats.loadShare", { percent: formatPercent(share, 0) }),
      tone: "",
    },
    {
      id: "calls",
      label: t("dbm.detail.stats.calls"),
      sub: undefined,
      value: raw(formatCount(calls)),
      detail: t("dbm.detail.stats.callsDelta", { change: changeWords(callsChange) }),
      tone: "",
    },
    {
      id: "p50",
      label: t("dbm.detail.stats.p50"),
      sub: raw("p50"),
      value: raw(formatNs(current?.p50_ns)),
      // Per-query percentiles are combined across windows rather than
      // recomputed, so they are close but not exact — and the stat says so
      // instead of leaving the reader to assume precision it does not have.
      detail: t("dbm.detail.stats.approx"),
      tone: "",
    },
    {
      id: "p95",
      label: t("dbm.detail.stats.p95"),
      sub: raw("p95"),
      value: raw(formatNs(current?.p95_ns)),
      detail: changeWords(latencyChange),
      tone: "",
    },
    {
      id: "max",
      label: t("dbm.detail.stats.max"),
      sub: raw("max"),
      value: raw(formatNs(current?.max_ns)),
      // A maximum is a real observed call, never a fused estimate.
      detail: t("dbm.detail.stats.exact"),
      tone: "",
    },
    {
      id: "errors",
      label: t("dbm.detail.stats.errors"),
      sub: undefined,
      value:
        errors <= 0
          ? t("dbm.queries.errorsNone")
          : calls > 0 && errors >= calls
            ? t("dbm.queries.errorsAll")
            : raw(formatCount(errors)),
      detail: errors <= 0 ? t("dbm.detail.stats.noErrors") : t("dbm.detail.stats.exact"),
      // Red only past a real failure RATE. Any error at all used to redden the
      // tile, so one failure in a million read as loudly as a total outage.
      tone: isCriticalErrorRate(errors, calls) ? "text-status-error-text" : "text-text-label",
    },
  ];
});

// ─── Coverage inputs ─────────────────────────────────────────────────────────

/**
 * Share of errors with no driver status code, computed from the samples we
 * actually read. It is a sample-based estimate, and the drawer copy says so.
 */
const uncodedErrorShare = computed(() => {
  const errored = samples.value.filter((sample) => sample.isError);
  if (!errored.length) return undefined;
  const uncoded = errored.filter((sample) => !sample.statusCode || sample.statusCode === "unknown");
  return uncoded.length / errored.length;
});

// ─── Endpoint table ──────────────────────────────────────────────────────────

const endpointCallsMax = computed(() =>
  endpoints.value.reduce((max, endpoint) => Math.max(max, endpoint.calls), 0),
);

const endpointColumns = computed<OTableColumnDef<EndpointCallerRow>[]>(() => [
  {
    id: "caller",
    header: t("dbm.detail.columns.caller"),
    size: 320,
    sortable: false,
    meta: { isName: true },
  },
  {
    id: "calls",
    header: t("dbm.detail.columns.callShare"),
    accessorKey: "calls",
    size: 220,
    sortable: true,
  },
  {
    id: "errors",
    header: t("dbm.queries.columns.errors"),
    accessorKey: "errors",
    size: 100,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "p95_ns",
    header: t("dbm.queries.columns.p95"),
    accessorKey: "p95_ns",
    size: 110,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p95"),
      headerTooltip: t("dbm.queries.columnHints.p95"),
    },
  },
  { id: "actions", header: raw(""), size: 60, isAction: true },
]);

const sampleColumns = computed<OTableColumnDef<SampleRow>[]>(() => [
  {
    id: "timestamp",
    header: t("dbm.detail.columns.time"),
    accessorKey: "timestamp",
    size: 140,
    sortable: true,
  },
  {
    id: "duration",
    header: t("dbm.detail.columns.duration"),
    accessorKey: "durationNs",
    size: 140,
    sortable: true,
    meta: { align: "right" },
  },
  { id: "status", header: t("dbm.detail.columns.status"), size: 120, sortable: false },
  { id: "actions", header: raw(""), size: 60, isAction: true },
]);

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * The trace stream this fingerprint lives on, in descending order of authority:
 * the URL, the row itself, the user's explicit pick, and finally the org's only
 * trace stream — which is unambiguous precisely because there is no other one it
 * could be. Never a hardcoded name.
 */
const traceStream = computed(
  () =>
    streamParam.value ||
    row.value?.trace_stream_name ||
    pickedStream.value ||
    (traceStreams.value.length === 1 ? traceStreams.value[0] : ""),
);

/**
 * True when the org has several trace streams and nothing has told us which one
 * carries this fingerprint. The panels below disclose it and offer the choice
 * instead of rendering another stream's rows under this query's headline.
 */
const streamAmbiguous = computed(
  () => streamsLoaded.value && !traceStream.value && traceStreams.value.length > 1,
);

const loadTraceStreams = async () => {
  try {
    const response = (await getStreams("traces", false, false)) as { list?: { name: string }[] };
    traceStreams.value = (response?.list ?? []).map((stream) => stream.name).filter(Boolean);
  } catch {
    traceStreams.value = [];
  } finally {
    streamsLoaded.value = true;
  }
};

/**
 * A stream name safe to interpolate as a table name.
 *
 * The allowlist is the authority — a name the org actually has cannot be an
 * injection. The shape check is the fallback for when the stream list could not
 * be fetched: OpenObserve stream names are identifiers, so anything carrying a
 * quote, a space or a semicolon is not one and is refused.
 */
const isSafeStreamName = (name: string): boolean => {
  if (!name) return false;
  if (traceStreams.value.includes(name)) return true;
  return /^[A-Za-z0-9_-]+$/.test(name);
};

const streamOptions = computed<SelectOption[]>(() =>
  traceStreams.value.map((name) => ({ label: raw(name), value: name })),
);

/** Picking a stream re-reads the panels that depend on it; history follows too. */
const onStreamPick = (value: SelectModelValue) => {
  pickedStream.value = typeof value === "string" ? value : "";
  void Promise.all([loadHistory(), loadEndpoints(), loadSamples()]);
};

const load = async () => {
  if (!org.value || !fingerprint.value) return;
  loading.value = true;
  refresh();

  try {
    // History needs the stream resolved from the row, and endpoints/samples
    // need it too — so both the row and the stream list are settled before the
    // panels run. The stream list is what lets an unspecified stream resolve to
    // the org's only one instead of being guessed.
    await Promise.all([loadRow(), loadTraceStreams()]);
    await Promise.all([loadHistory(), loadEndpoints(), loadSamples()]);
  } finally {
    loading.value = false;
  }
};

/**
 * The fingerprint's row, plus the same row in the previous window for the
 * deltas the incident summary quotes. `search` is the fingerprint itself, which
 * the endpoint matches against the normalized text — so the result is filtered
 * client-side to the exact fingerprint rather than trusting a text match.
 */
const loadRow = async () => {
  const params = {
    system: systemFilter.value,
    instance: instanceFilter.value,
    namespace: namespaceFilter.value,
    stream: streamParam.value || undefined,
    stmtClass: "all",
    limit: ROW_LOOKUP_LIMIT,
  };

  const [currentResponse, previousResponse] = await Promise.all([
    dbMonitoringService.getQueries(org.value, {
      ...params,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    }),
    dbMonitoringService.getQueries(org.value, {
      ...params,
      startTime: current.value.startTime - (current.value.endTime - current.value.startTime),
      endTime: current.value.startTime,
    }),
  ]);

  const hits = currentResponse.data.hits ?? [];
  const others = currentResponse.data.other ?? [];
  row.value = hits.find((hit) => hit.fingerprint === fingerprint.value) ?? null;
  previousRow.value =
    (previousResponse.data.hits ?? []).find((hit) => hit.fingerprint === fingerprint.value) ?? null;
  freshness.value = currentResponse.data.freshness;
  topNSubset.value = currentResponse.data.top_n_subset;

  const sum = (rows: QueryStatsRow[]) =>
    rows.reduce((acc, entry) => acc + (entry.total_time_ns ?? 0), 0);
  scopeTotalNs.value = sum(hits) + sum(others);
  otherShare.value =
    scopeTotalNs.value > 0 && !currentResponse.data.top_n_subset
      ? sum(others) / scopeTotalNs.value
      : undefined;
};

const loadHistory = async () => {
  try {
    const response = await dbMonitoringService.getQueryHistory(org.value, {
      fingerprint: fingerprint.value,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      stream: traceStream.value || undefined,
      system: systemFilter.value,
      instance: instanceFilter.value,
      namespace: namespaceFilter.value,
    });

    const series = response.data.series ?? [];
    // The rollup interval is not in the payload; infer it from the gap between
    // consecutive windows so band merging and QPS use the real window length
    // rather than a hardcoded guess that breaks on a non-default config.
    const gaps = series
      .slice(1)
      .map((point, index) => point.timestamp - series[index].timestamp)
      .filter((gap) => gap > 0);
    if (gaps.length) intervalMicros.value = Math.min(...gaps);

    history.value = buildHistorySeries(series, {
      intervalMicros: intervalMicros.value,
      backfillCapped: response.data.backfill_capped,
    });
  } catch {
    history.value = null;
  }
};

const loadEndpoints = async () => {
  endpointsError.value = null;
  if (!traceStream.value) {
    // The endpoint 400s without a stream, so the reason is stated rather than
    // showing an empty table that looks like "no callers" — or, worse, rows
    // read from whichever stream happened to be named `default`.
    endpointsError.value = streamAmbiguous.value
      ? t("dbm.detail.ambiguousStream")
      : t("dbm.detail.noStream");
    endpoints.value = [];
    return;
  }

  try {
    const response = await dbMonitoringService.getQueryEndpoints(org.value, {
      fingerprint: fingerprint.value,
      stream: traceStream.value,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });
    const hits = response.data.hits ?? [];
    const totalCalls = hits.reduce((acc, hit) => acc + (hit.calls ?? 0), 0);

    endpoints.value = hits.map((hit, index) => ({
      ...hit,
      rowKey: `${hit.service_name ?? "null"}-${hit.endpoint ?? "null"}-${index}`,
      // A null caller is a real result: the DB span's trace root fell outside
      // the window or is missing, so the call is genuinely unattributed.
      serviceLabel: hit.service_name ? raw(hit.service_name) : t("dbm.detail.unattributed"),
      share: totalCalls > 0 ? (hit.calls ?? 0) / totalCalls : 0,
    }));
  } catch (err: unknown) {
    endpointsError.value = errorMessage(err);
    endpoints.value = [];
  }
};

/**
 * Slowest executions, straight from the raw trace stream.
 *
 * `duration` is MICROseconds here while every rollup metric on this page is
 * NANOseconds, so it is converted once, on the way in. Getting this wrong makes
 * samples read 1000x faster than the p95 they sit under.
 */
const loadSamples = async () => {
  samplesError.value = null;
  if (!traceStream.value) {
    samplesError.value = streamAmbiguous.value
      ? t("dbm.detail.ambiguousStream")
      : t("dbm.detail.noStream");
    samples.value = [];
    return;
  }

  // The stream is a TABLE name, so it cannot be escaped as a literal the way
  // the fingerprint below is — and it arrives from `route.query`, which anyone
  // can write. It is checked against the org's real trace streams first, and
  // falls back to a strict identifier shape for the case where the list could
  // not be fetched. Anything else is refused rather than interpolated.
  const stream = traceStream.value;
  if (!isSafeStreamName(stream)) {
    samplesError.value = t("dbm.detail.invalidStream");
    samples.value = [];
    return;
  }

  const sql =
    `SELECT _timestamp, trace_id, duration, span_status, o2_db_status_code ` +
    `FROM "${stream}" ` +
    `WHERE o2_db_fingerprint = '${escapeSingleQuotes(fingerprint.value)}' ` +
    `ORDER BY duration DESC`;

  try {
    const response = await searchService.search({
      org_identifier: org.value,
      query: {
        query: {
          sql,
          start_time: current.value.startTime,
          end_time: current.value.endTime,
          from: 0,
          size: SAMPLE_LIMIT,
        },
      },
      page_type: "traces",
    });

    samples.value = (response.data?.hits ?? []).map(
      (hit: Record<string, unknown>, index: number) => ({
        rowKey: `${String(hit.trace_id ?? index)}-${index}`,
        timestamp: Number(hit._timestamp ?? 0),
        durationNs: Number(hit.duration ?? 0) * 1000,
        traceId: String(hit.trace_id ?? ""),
        isError: String(hit.span_status ?? "") === "ERROR",
        statusCode: String(hit.o2_db_status_code ?? ""),
      }),
    );
  } catch (err: unknown) {
    samplesError.value = errorMessage(err);
    samples.value = [];
  }
};

const errorMessage = (err: unknown): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  t("dbm.common.loadFailed");

// ─── Pivots ──────────────────────────────────────────────────────────────────

/** The traces route hydrates from `stream`/`filter`/`from`/`to` query params. */
const openTraces = (filter: string) => {
  router
    .push({
      name: "traces",
      query: {
        org_identifier: route.query.org_identifier,
        stream: traceStream.value,
        filter,
        from: String(current.value.startTime),
        to: String(current.value.endTime),
      },
    })
    .catch(() => {});
};

const openSampleTrace = (sample: SampleRow) => {
  if (!sample.traceId) return;
  openTraces(`trace_id = '${escapeSingleQuotes(sample.traceId)}'`);
};

const openEndpointTraces = (endpoint: EndpointCallerRow) => {
  const clauses = [`o2_db_fingerprint = '${escapeSingleQuotes(fingerprint.value)}'`];
  if (endpoint.service_name) {
    clauses.push(`service_name = '${escapeSingleQuotes(endpoint.service_name)}'`);
  }
  openTraces(clauses.join(" AND "));
};

/** ECharts hands back the datum; map it to the sample that produced it. */
const onSampleClick = (params: unknown) => {
  const value = (params as { value?: [number, number] })?.value;
  if (!value) return;
  const sample = samples.value.find(
    (entry) => entry.timestamp === value[0] && entry.durationNs === value[1],
  );
  if (sample) openSampleTrace(sample);
};

// ─── Incident summary ────────────────────────────────────────────────────────

const copySummary = async () => {
  const current = row.value;
  if (!current) return;

  const summary = buildIncidentSummary({
    row: current,
    window: { startTime: windowStart(), endTime: windowEnd() },
    totalTimeDelta: deltaFor(current.total_time_ns, previousRow.value?.total_time_ns),
    p95Delta: deltaFor(current.p95_ns, previousRow.value?.p95_ns),
    callsDelta: deltaFor(current.calls, previousRow.value?.calls),
    share: scopeTotalNs.value > 0 ? (current.total_time_ns ?? 0) / scopeTotalNs.value : undefined,
    endpoints: endpoints.value,
    errorClasses: errorClasses.value,
    freshness: freshness.value,
    topNSubset: topNSubset.value,
    otherShare: otherShare.value,
    permalink: permalink(),
  });

  try {
    await navigator.clipboard.writeText(summary);
    toast({ variant: "success", message: t("dbm.detail.summaryCopied") });
  } catch {
    toast({ variant: "error", message: t("dbm.detail.summaryCopyFailed") });
  }
};

const windowStart = () => current.value.startTime;
const windowEnd = () => current.value.endTime;

/** Status-code counts from the samples, matching the rollup's `unknown` bucket. */
const errorClasses = computed(() => {
  const counts = new Map<string, number>();
  for (const sample of samples.value) {
    if (!sample.isError) continue;
    const code = sample.statusCode || "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status_code, errors]) => ({ status_code, errors }))
    .sort((a, b) => b.errors - a.errors);
});

/** A link with the window frozen, so the numbers still mean something later. */
const permalink = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const url = new URL(window.location.href);
  // The window travels as period OR from/to, never both — the app-wide
  // convention, so the link opens the same range everywhere else too.
  for (const [key, value] of Object.entries(queryParams.value)) {
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.toString();
};

/** Mirror the window into the URL — this page used not to, so a reload lost it. */
const syncUrl = () => {
  router.replace({ query: { ...route.query, ...queryParams.value } }).catch(() => {});
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  syncUrl();
  load();
};

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * "Why is this slow and what do I do" — composed from what is already on screen,
 * so the assistant answers about THIS query rather than asking the user to
 * describe it. Sent with `autoSend` so the click is the whole interaction.
 */
const askAiForFix = () => {
  const current = row.value;
  emit("sendToAiChat", {
    query: buildQueryFixPrompt({
      queryNorm: current?.query_norm || queryText.value,
      dbSystem: current?.db_system,
      dbInstance: current?.db_instance,
      p50Ns: current?.p50_ns,
      p95Ns: current?.p95_ns,
      p99Ns: current?.p99_ns,
      maxNs: current?.max_ns,
      totalTimeNs: current?.total_time_ns,
      calls: current?.calls,
      errors: current?.errors,
      callsPerTrace: callsPerTrace.value,
      endpoints: endpoints.value.map((endpoint) => ({
        service: endpoint.service_name,
        endpoint: endpoint.endpoint,
        calls: endpoint.calls,
      })),
    }),
    autoSend: true,
  });
};

/**
 * How many times this statement runs per request. The endpoint rollup does not
 * carry it, so it is derived from calls ÷ traces — the same ratio the list page
 * shows, and the number that separates "slow query" from "query run 40 times".
 */
const callsPerTrace = computed<number | null>(() => {
  const calls = row.value?.calls;
  const traces = row.value?.traces;
  if (!calls || !traces) return null;
  return calls / traces;
});

const dbmContext = createDbmContextProvider(
  () => ({
    currentPage: "query_detail" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: systemFilter.value ?? row.value?.db_system,
      instance: instanceFilter.value ?? row.value?.db_instance,
      namespace: namespaceFilter.value,
    },
    focus: { fingerprint: fingerprint.value, query: row.value?.query_norm },
  }),
  store,
);

onMounted(() => {
  contextRegistry.register(DBM_CONTEXT_KEY, dbmContext);
  contextRegistry.setActive(DBM_CONTEXT_KEY);
  load();
});

onBeforeUnmount(() => {
  contextRegistry.unregister(DBM_CONTEXT_KEY);
  contextRegistry.setActive("");
});
</script>
