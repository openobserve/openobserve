<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Metrics Explorer: the raw samples of a clicked chart point's metric around its bucket. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, raw } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import ExplorerResultsPager from "./ExplorerResultsPager.vue";
import ExplorerToolbar from "./ExplorerToolbar.vue";
import ExplorerDetailNav from "./ExplorerDetailNav.vue";
import ExplorerResultRow from "./ExplorerResultRow.vue";
import ExplorerDetailSkeleton from "./ExplorerDetailSkeleton.vue";
import { buildMetricsUrl } from "@/utils/metrics/buildMetricsUrl";
import useStreams from "@/composables/useStreams";
import { useExplorerSqlSearch } from "@/composables/dashboard/useExplorerSqlSearch";
import { useExplorerCorrelation } from "@/composables/dashboard/useExplorerCorrelation";
import {
  leaveFieldOnEscape,
  useExplorerDetailKeys,
} from "@/composables/dashboard/useExplorerDetailKeys";
import { toast } from "@/lib/feedback/Toast/useToast";
import { type FieldFilter } from "@/utils/dashboard/chartPointExplore";
import { metricsSql, sampleLabels, labelsOnMetric } from "@/utils/dashboard/pointExplorers";
const JsonPreview = defineAsyncComponent(() => import("@/plugins/logs/JsonPreview.vue"));
// The sample detail paints a tab-and-chart skeleton at once while its chunk loads, and the
// chunks start loading with the list, so opening a sample rarely waits on them at all.
const loadDetailTable = () => import("@/plugins/logs/DetailTable.vue");
const DetailTable = defineAsyncComponent({
  loader: loadDetailTable,
  loadingComponent: ExplorerDetailSkeleton,
  delay: 0,
});

const props = defineProps<{
  /** The metric the samples are read from: the chart's own, or the first one correlation found. */
  stream: string;
  filters: FieldFilter[];
  /** The clicked bucket (µs). */
  startTime: number;
  endTime: number;
}>();

const emit = defineEmits<{ (e: "sendToAiChat", value: unknown, append?: boolean): void }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

// ── Time: the list covers the clicked slice, as in the logs and traces modes ──
const rangeStart = ref(props.startTime);
const rangeEnd = ref(props.endTime);
// ── Metric: fixed for the drawer; Open in Metrics is the way to look at another ──
const { getStream } = useStreams(t);
const metric = computed(() => props.stream);

// ── Labels: the metric's schema decides which clicked labels apply ───────────
const labels = ref<string[] | null>(null);
// A clicked label the metric lacks would match no sample, so the query leaves it out.
const appliedLabels = computed(() =>
  labels.value ? labelsOnMetric(props.filters, labels.value) : props.filters,
);

async function loadSchema() {
  labels.value = null;
  try {
    const stream = await getStream(metric.value, "metrics", true);
    labels.value = (stream?.schema ?? []).map((f: { name: string }) => f.name);
  } catch {
    labels.value = [];
  }
}

// ── Search: raw samples over _search_stream, like the Logs Explorer ──────────
const { streamSearch, countMatches } = useExplorerSqlSearch(() => "metrics");
const events = ref<any[]>([]);
const total = ref(0);
const page = ref(0);
const pageSize = ref(100);
const loading = ref(false);
const errorMsg = ref("");
const customSql = ref("");
const showSql = ref(false);
const expanded = ref(new Set<number>());
let queryRun = 0;

const searchRange = () => ({ start_time: rangeStart.value, end_time: rangeEnd.value });

async function runSql(sql: string, fromOffset: number, count: boolean) {
  loading.value = true;
  errorMsg.value = "";
  const run = count ? ++queryRun : queryRun;
  if (count) {
    total.value = 0;
    void countMatches(sql, searchRange()).then((matches) => {
      if (matches !== null && run === queryRun && !errorMsg.value) {
        total.value = Math.max(matches, events.value.length + page.value * pageSize.value);
      }
    });
  }
  try {
    const res = await streamSearch("events", {
      sql,
      ...searchRange(),
      from: fromOffset,
      size: pageSize.value,
    });
    if (!res) return;
    events.value = res.hits;
    expanded.value = new Set();
    total.value = Math.max(total.value, fromOffset + res.hits.length);
    loading.value = false;
  } catch (e: any) {
    errorMsg.value = `${e?.response?.data?.error ?? e?.message ?? "Search failed"}\n\n${sql}`;
    events.value = [];
    total.value = 0;
    loading.value = false;
  }
}

async function loadMetric() {
  selected.value = null;
  page.value = 0;
  await loadSchema();
  customSql.value = metricsSql(metric.value, appliedLabels.value);
  await runSql(customSql.value, 0, true);
}
function runQuery() {
  page.value = 0;
  void runSql(customSql.value || metricsSql(metric.value, appliedLabels.value), 0, true);
}
function goToPage(next: number) {
  page.value = next;
  void runSql(customSql.value, next * pageSize.value, false);
}
watch(pageSize, () => goToPage(0));

function onDateChange(range: { startTime: number; endTime: number }) {
  rangeStart.value = range.startTime;
  rangeEnd.value = range.endTime;
  runQuery();
}

function toggleExpand(i: number) {
  const next = new Set(expanded.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  expanded.value = next;
}

onMounted(async () => {
  // Warm the detail's chunk while the list loads; a failure here just leaves it lazy.
  void loadDetailTable().catch(() => undefined);
  await loadMetric();
});

// ── Detail: DetailTable's JSON / Table / correlated Logs and Traces tabs ─────
const selected = ref<Record<string, any> | null>(null);
const selectedIndex = computed(() => (selected.value ? events.value.indexOf(selected.value) : -1));
function openSample(ev: Record<string, any>) {
  selected.value = ev;
}
function closeSample() {
  selected.value = null;
}
function stepSample(by: number) {
  const next = events.value[selectedIndex.value + by];
  if (next) openSample(next);
}
useExplorerDetailKeys({
  isOpen: () => !!selected.value,
  prev: () => stepSample(-1),
  next: () => stepSample(1),
  back: closeSample,
});

const { correlationDashboardProps, correlationLoading, correlationError, openCorrelation } =
  useExplorerCorrelation({
    sourceType: "metrics",
    stream: () => metric.value,
    selected,
  });

// ── Hand-offs ────────────────────────────────────────────────────────────────
function metricsPageHref(filters: FieldFilter[]): string {
  const query = {
    org_identifier: orgId.value,
    metric: metric.value,
    labels: filters.map((f) => `${f.field}=${f.value ?? ""}`),
    from: String(rangeStart.value),
    to: String(rangeEnd.value),
  };
  const href = router.resolve({ name: "metrics", query }).href;
  return new URL(href, window.location.origin).toString();
}
// An edited SQL opens in the Metrics page's Visualize mode, which runs SQL as given; a table fits raw samples.
function openInMetrics() {
  const sql = customSql.value.trim();
  const edited = !!sql && sql !== metricsSql(metric.value, appliedLabels.value);
  const href = edited
    ? buildMetricsUrl({
        orgId: orgId.value,
        queryType: "sql",
        chartType: "table",
        queries: [{ stream: metric.value, query: sql }],
        time: { from: rangeStart.value, to: rangeEnd.value },
      }).toString()
    : metricsPageHref(appliedLabels.value);
  window.open(href, "_blank", "noopener,noreferrer");
}
function copyText(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ variant: "success", message: t("common.copiedToClipboard") }))
    .catch(() => {
      /* best-effort */
    });
}
// The drawer is not restored from the URL, so the link opens the series in the Metrics page.
function copySampleLink() {
  if (selected.value) copyText(metricsPageHref(sampleLabels(selected.value)));
}

function fmtTs(ts: unknown): string {
  if (!ts) return "—";
  const value = Number(ts);
  const ms = value > 1e13 ? value / 1000 : value;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden"
    data-test="metrics-explorer"
    @keydown="leaveFieldOnEscape"
  >
    <div v-show="!selected" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ExplorerToolbar
        :range-start="rangeStart"
        :range-end="rangeEnd"
        :query-label="t('panel.logExplorer.queryMode')"
        query-icon="code"
        :query-open="showSql"
        :open-label="t('panel.metricsExplorer.openInMetrics')"
        open-feature="metrics"
        :loading="loading"
        data-test-prefix="metrics-explorer"
        @date-change="onDateChange"
        @toggle-query="showSql = !showSql"
        @open="openInMetrics"
        @run="runQuery"
      >
        <div v-if="showSql" class="px-2 pb-2">
          <div class="border-border-default rounded-default overflow-hidden border">
            <QueryEditor
              :query="customSql"
              :languages="['sql']"
              editor-height="4rem"
              hide-nl-toggle
              data-test-prefix="metrics-explorer-editor"
              @update:query="customSql = $event"
              @run-query="runQuery"
            />
          </div>
        </div>
      </ExplorerToolbar>

      <div v-if="errorMsg" class="flex shrink-0 items-start gap-2 px-4 py-3">
        <OIcon name="error-outline" size="sm" class="text-error-500 mt-0.5 shrink-0" />
        <code
          class="text-error-500 font-mono text-xs break-all whitespace-pre-wrap"
          data-test="metrics-explorer-error"
          >{{ errorMsg }}</code
        >
      </div>

      <div
        v-else
        class="relative flex min-h-0 flex-1 flex-col"
        data-test="metrics-explorer-results"
      >
        <OInnerLoading :showing="loading" size="sm" :label="t('common.loading')" />
        <div
          v-if="!loading && !events.length"
          class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10"
          data-test="metrics-explorer-empty"
        >
          <OIcon name="manage-search" size="xl" class="text-text-secondary opacity-30" />
          <span class="text-text-secondary text-sm">{{ t("panel.logExplorer.noEvents") }}</span>
          <code
            class="text-text-secondary bg-surface-subtle rounded-default max-w-full overflow-x-auto px-3 py-2 text-center font-mono text-xs break-all whitespace-pre-wrap"
            >{{ customSql }}</code
          >
        </div>
        <div v-else class="min-h-0 flex-1 overflow-y-auto">
          <template v-for="(ev, i) in events" :key="i">
            <ExplorerResultRow
              :record="ev"
              :time="fmtTs(ev._timestamp)"
              :expanded="expanded.has(i)"
              :open-label="t('panel.metricsExplorer.openSample')"
              open-data-test="metrics-explorer-row-open"
              data-test="metrics-explorer-row"
              @toggle="toggleExpand(i)"
              @open="openSample(ev)"
            />
            <div
              v-if="expanded.has(i)"
              class="border-border-default bg-surface-panel border-b px-2 py-2"
              @click.stop
            >
              <JsonPreview
                :value="ev"
                mode="sidebar"
                :stream-name="metric"
                :show-copy-button="true"
                hide-view-related
                hide-search-term-actions
                hide-field-options
                @copy="
                  (v: unknown) => copyText(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
                "
              />
            </div>
          </template>
        </div>
        <ExplorerResultsPager
          v-model:page-size="pageSize"
          :page="page"
          :total="total"
          @go-to-page="goToPage"
        />
      </div>
    </div>

    <div v-if="selected" class="flex h-full min-h-0 flex-col" data-test="metrics-explorer-detail">
      <ExplorerDetailNav
        :title="raw(fmtTs(selected._timestamp))"
        :subtitle="raw(metric)"
        :index="selectedIndex"
        :count="events.length"
        :prev-label="t('panel.metricsExplorer.prevSample')"
        :next-label="t('panel.metricsExplorer.nextSample')"
        data-test-prefix="metrics-explorer"
        @back="closeSample"
        @prev="stepSample(-1)"
        @next="stepSample(1)"
        @copy-link="copySampleLink"
      />
      <DetailTable
        :model-value="selected"
        stream-type="metrics"
        :current-index="selectedIndex"
        :total-length="events.length"
        :correlation-props="correlationDashboardProps"
        :correlation-loading="correlationLoading"
        :correlation-error="correlationError ?? undefined"
        :hidden-tabs="['correlated-metrics']"
        initial-tab="json"
        embedded
        class="min-h-0 flex-1"
        @load-correlation="openCorrelation"
        @showPrevDetail="stepSample(-1)"
        @showNextDetail="stepSample(1)"
        @sendToAiChat="(v: unknown, a?: boolean) => emit('sendToAiChat', v, a)"
      />
    </div>
  </div>
</template>
