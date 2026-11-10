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
  <div class="flex flex-col gap-[1.125rem] pb-[1.125rem]" data-test="eval-job-workload">
    <div v-if="stopped" class="px-5">
      <OBanner
        variant="warning"
        icon="warning-amber"
        inline-actions
        dense
        data-test="eval-job-workload-scores-stopped"
      >
        {{ stoppedText }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="eval-job-workload-fix-provider"
            @click="fixProvider"
          >
            {{ t("evalWorkload.stopped.fixProvider") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            data-test="eval-job-workload-view-failures"
            @click="$emit('view-failures')"
          >
            {{ t("evalWorkload.stopped.viewFailures") }}
          </OButton>
        </template>
      </OBanner>
    </div>

    <section class="grid grid-cols-2 gap-2.5 px-5 max-[68.75rem]:grid-cols-1">
      <div
        v-for="chart in charts"
        :key="chart.id"
        class="rounded-default bg-surface-base border-border-default flex flex-col gap-1 border px-3.5 pt-2.5 pb-2"
        :data-test="`eval-job-workload-${chart.id}`"
      >
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-compact text-text-heading font-semibold">{{ chart.title }}</span>
          <span class="text-2xs text-text-secondary">{{ chart.note }}</span>
          <span
            v-if="chart.id === 'spend' && budgetLifted"
            class="text-2xs text-text-secondary"
            data-test="eval-job-workload-spend-lifted"
          >
            {{ t("evalSpend.list.liftedUntil") }}
          </span>
          <router-link
            v-if="
              chart.id === 'spend' &&
              spendToday &&
              typeof spendToday !== 'string' &&
              spendToday.unpricedCalls
            "
            :to="pricingRoute"
            class="text-2xs text-accent font-semibold no-underline hover:underline"
            data-test="eval-job-workload-spend-pricing"
          >
            {{ t("evalSpend.cost.setPrice") }}
          </router-link>
        </div>
        <div class="h-44 min-h-0">
          <ChartRenderer :data="{ options: chart.options }" />
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-2 px-5" data-test="eval-job-workload-alerts">
      <h4
        class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-[1.5] font-semibold"
      >
        {{ t("evalWorkload.alerts.title") }}
      </h4>
      <div
        v-for="alert in jobAlerts"
        :key="alert.kind"
        class="rounded-default border-border-default flex items-center justify-between gap-3 border px-3.5 py-2.5"
      >
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-compact text-text-heading font-semibold">{{ alert.title }}</span>
          <span class="text-2xs text-text-secondary">{{ alert.when }}</span>
        </div>
        <CreateAlertAction
          variant="button"
          button-variant="outline"
          source="ai"
          :build="alert.build"
          :data-test="`eval-job-workload-alert-${alert.kind}`"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import { chartColor } from "@/utils/chartTheme";
import { CHART_THRESHOLD_COLOR } from "@/utils/dashboard/colorPalette";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import { AI_AGENTS_PACK } from "@/utils/alerts/aiAgentsPack";
import { buildAiPrefill, type AiJobAlertKind } from "@/utils/alerts/prefill/fromAi";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import { pricingGapsRoute } from "@/plugins/traces/llmDataTrust.utils";
import type { EvalJob } from "@/services/online-evals.service";
import StreamService from "@/services/stream";
import { targetScopeOf, valueOf } from "../../utils/evalEntity";
import { errorKindLabel, relativeTime } from "../../utils/evalFormat";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { escapeHtml } from "@/utils/html";
import { normalizeJobFilterCondition } from "../../utils/jobFilter";
import {
  evaluatorFields,
  formatUsd,
  isBudgetLifted,
  loadSpendToday,
  type JobSpend,
} from "../../utils/evalSpend";
import type { SpendError } from "@/utils/alerts/aiBudgets";
import {
  bucketMs,
  errorSeries,
  judgeOutcomeSql,
  judgeSpendSql,
  spendPoints,
  lastScoreSql,
  matchedSinceSql,
  scoreSeriesSql,
  scoresStopped,
  stoppedSinceUs,
  workloadBucket,
  type ErrorSeries,
  type Point,
} from "../../utils/jobWorkload";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  row: EvalJob;
  dateWindow: { startUs: number; endUs: number };
  orgId: string;
  /** Bumped by the drawer's Refresh. */
  refreshToken: number;
}>();

defineEmits<{ (e: "view-failures"): void }>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { executeQueryOnce } = useLLMStreamQuery();

const ERROR_RATE_ALERT_PCT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
// Times read in the app's time zone, as the other AI panels show them.
const timezone = computed(() => store.state.timezone || "UTC");
const zoned = (ms: number, format: string) => timestampToTimezoneDate(ms, timezone.value, format);
/** One series' entry in an axis tooltip, as ECharts passes it. */
type TooltipPoint = { marker: string; seriesName?: string; value?: Point };

const lag = ref<Point[]>([]);
const throughput = ref<Point[]>([]);
const errors = ref<ErrorSeries>({ byKind: {}, totals: [] });
const spend = ref<Point[]>([]);
// Null until read; why it could not be read, when it could not. Never $0 unless read.
const spendToday = ref<JobSpend | SpendError | null>(null);
const pricingRoute = computed(() => pricingGapsRoute("_evaluator", props.orgId));
const stopped = ref<{ sinceUs: number; matched: number } | null>(null);

const jobId = computed(() => String(props.row.id));
const bucket = computed(() => workloadBucket(props.dateWindow.startUs, props.dateWindow.endUs));
const scope = computed(() => targetScopeOf(props.row));
const rate = computed(() => {
  const mode = valueOf<string>(props.row, "samplingMode", "sampling_mode");
  return mode === "rate" ? Number(valueOf(props.row, "samplingValue", "sampling_value")) || 0 : 1;
});

// Degrade to empty: a job that never failed or was never priced lacks the queried column.
const query = (sql: string, startUs: number, endUs: number, type: "traces" | "logs" = "traces") =>
  executeQueryOnce(sql, startUs, endUs, type).catch(() => null);

async function loadSeries() {
  const { startUs, endUs } = props.dateWindow;
  const id = jobId.value;
  const interval = bucket.value.interval;
  const [scores, outcomes, cost] = await Promise.all([
    query(scoreSeriesSql(id, interval), startUs, endUs, "logs"),
    query(judgeOutcomeSql(id, interval), startUs, endUs).then(
      (rows) => rows ?? query(judgeOutcomeSql(id, interval, false), startUs, endUs),
    ),
    query(judgeSpendSql(id, interval), startUs, endUs).then(
      (rows) => rows ?? query(judgeSpendSql(id, interval, false), startUs, endUs),
    ),
  ]);
  lag.value = (scores ?? []).map((r: any) => [
    bucketMs(r.bucket),
    r.lag_p95_us == null ? null : Number(r.lag_p95_us) / 60_000_000,
  ]);
  throughput.value = (scores ?? []).map((r: any) => [bucketMs(r.bucket), Number(r.scores) || 0]);
  errors.value = errorSeries(outcomes ?? []);
  spend.value = spendPoints(cost ?? []);
}

async function loadToday() {
  const byJob = await loadSpendToday([jobId.value], {
    fields: () => evaluatorFields(props.orgId),
    query: (sql, startUs, endUs) => executeQueryOnce(sql, startUs, endUs),
  });
  spendToday.value = typeof byJob === "string" ? byJob : byJob[jobId.value];
}

// "Scores stopped" is about now, regardless of the chart window.
async function loadStopped() {
  stopped.value = null;
  if (props.row.status !== "active" || !rate.value) return;
  const nowUs = Date.now() * 1000;
  const dayAgoUs = nowUs - DAY_MS * 1000;
  // A job that never scored may find no score stream at all; that reads as no score.
  const last = await query(lastScoreSql(jobId.value), dayAgoUs, nowUs, "logs");
  const sinceUs = stoppedSinceUs({
    lastScoreUs: Number(last?.[0]?.last_us) || 0,
    updatedUs: Number(valueOf(props.row, "updatedAt", "updated_at") || 0) * 1000,
    nowUs,
  });
  // Targets newer than the completion window cannot have been scored yet.
  const config =
    scope.value === "session"
      ? valueOf<any>(props.row, "sessionConfig", "session_config")
      : valueOf<any>(props.row, "traceConfig", "trace_config");
  const idleSecs = scope.value === "span" ? 0 : Number(config?.idleWindowSecs) || 0;
  const settleUs = (idleSecs + 300) * 1_000_000;
  if (nowUs - settleUs <= sinceUs) return;
  const where = buildConditionsString(
    normalizeJobFilterCondition(valueOf(props.row, "filterCondition", "filter_condition")),
    { sqlMode: true, addWherePrefix: false, formatValues: true },
  );
  // A session is counted by the stream's own session column.
  const fields =
    scope.value === "session"
      ? await StreamService.schema(props.orgId, props.row.stream, "traces").then(
          (res) => (res.data?.schema ?? []).map((f: { name?: string }) => f.name ?? ""),
          () => [],
        )
      : [];
  const sql = matchedSinceSql(props.row.stream, where, scope.value, fields);
  if (!sql) return;
  const matched = await query(sql, sinceUs, nowUs - settleUs);
  const count = Number(matched?.[0]?.cnt) || 0;
  if (scoresStopped({ sinceUs, nowUs, matched: count, rate: rate.value })) {
    stopped.value = { sinceUs, matched: count };
  }
}

watch(
  () => [props.dateWindow, props.refreshToken, jobId.value],
  () => void Promise.all([loadSeries(), loadToday()]),
  { immediate: true },
);
watch(
  () => [props.refreshToken, jobId.value, props.row.status],
  () => void loadStopped(),
  { immediate: true },
);

const stoppedText = computed(() => {
  const s = stopped.value;
  if (!s) return "";
  const parts = [
    t("evalWorkload.stopped.text", {
      time: zoned(s.sinceUs / 1000, "HH:mm"),
      ago: relativeTime(s.sinceUs / 1000, t),
      n: s.matched.toLocaleString(),
      scope: t(`evalSpend.cost.scopes.${scope.value}`),
    }),
  ];
  const error = props.row.health?.lastError;
  if (error && error.at > s.sinceUs) {
    parts.push(t("evalWorkload.stopped.lastError", { kind: errorKindLabel(error.kind, t) }));
  }
  return parts.join(" ");
});

function fixProvider() {
  router.push({ name: "llmProviders", query: { org_identifier: props.orgId } }).catch(() => {});
}

function lineOptions(opts: {
  series: { name: string; data: Point[]; color: string; type?: "line" | "bar" }[];
  format: (value: number) => string;
  max?: number;
  markAt?: { value: number; label: string };
}) {
  // Read the theme so token colors re-resolve when it flips.
  void store.state.theme;
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  const multiDay = props.dateWindow.endUs - props.dateWindow.startUs > 2 * DAY_MS * 1000;
  const series: any[] = opts.series.map((s) => ({
    name: s.name,
    type: s.type ?? "line",
    data: s.data,
    color: s.color,
    showSymbol: s.data.length === 1,
    connectNulls: false,
    barMaxWidth: 12,
    lineStyle: { width: 2 },
  }));
  if (opts.markAt && series[0]) {
    series[0].markLine = {
      silent: true,
      symbol: "none",
      label: {
        formatter: opts.markAt.label,
        color: CHART_THRESHOLD_COLOR,
        fontSize: 10,
        position: "insideEndTop",
      },
      lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed", width: 1.2 },
      data: [{ yAxis: opts.markAt.value }],
    };
  }
  return {
    grid: {
      left: 8,
      right: 16,
      top: opts.series.length > 1 ? 24 : 8,
      bottom: 4,
      containLabel: true,
    },
    legend:
      opts.series.length > 1
        ? {
            right: 0,
            top: 0,
            itemWidth: 12,
            itemHeight: 8,
            textStyle: { color: text, fontSize: 11 },
          }
        : { show: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      textStyle: { fontSize: 12 },
      formatter: (params: TooltipPoint | TooltipPoint[]) => {
        const points = Array.isArray(params) ? params : [params];
        if (!points.length) return "";
        const lines = points.map((p) => {
          const v = p.value?.[1];
          const value = v == null ? "—" : opts.format(v);
          return `${p.marker}${escapeHtml(String(p.seriesName ?? ""))} <b>${escapeHtml(value)}</b>`;
        });
        const at = Number(points[0].value?.[0]) || 0;
        return [escapeHtml(zoned(at, "yyyy-MM-dd HH:mm")), ...lines].join("<br/>");
      },
    },
    xAxis: {
      type: "time",
      min: props.dateWindow.startUs / 1000,
      max: props.dateWindow.endUs / 1000,
      axisLabel: {
        color: text,
        fontSize: 10,
        hideOverlap: true,
        formatter: (ms: number) => zoned(ms, multiDay ? "LLL d" : "HH:mm"),
      },
      axisLine: { lineStyle: { color: grid } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      ...(opts.max != null ? { max: opts.max } : {}),
      axisLabel: { color: text, fontSize: 10, formatter: opts.format },
      splitLine: { lineStyle: { color: grid } },
    },
    series,
  };
}

const sum = (points: Point[]) => points.reduce((total, [, v]) => total + (v ?? 0), 0);

// "Resume until 00:00 UTC" lifted the budget, as the job list marks it.
const budgetLifted = computed(() => isBudgetLifted(props.row, Date.now()));

// Unpriced judge calls leave today's spend unknown, and the budget blind to them.
function spendNote(per: string, budget: number | undefined) {
  const today = spendToday.value;
  if (!today) return t("evalWorkload.spend.notePending", { per });
  if (today === "forbidden") return t("evalWorkload.spend.noteNoAccess", { per });
  if (today === "failed") return t("evalWorkload.spend.noteUnknown", { per });
  if (today.unpricedCalls) {
    return t(
      "evalWorkload.spend.noteUnpriced",
      { per, today: formatUsd(today.usd), n: today.unpricedCalls },
      today.unpricedCalls,
    );
  }
  return budget != null
    ? t("evalWorkload.spend.noteBudget", {
        per,
        today: formatUsd(today.usd),
        budget: formatUsd(budget),
      })
    : t("evalWorkload.spend.note", { per, today: formatUsd(today.usd) });
}

const charts = computed(() => {
  const minutes = bucket.value.minutes;
  const per =
    minutes < 60
      ? t("common.minShort", { count: minutes })
      : t("common.hrShort", { count: minutes / 60 });
  const budget = props.row.budget?.dailyUsd;
  const colors = [3, 8, 6, 5, 7].map((n) => chartColor(`--color-chart-series-${n}`));
  return [
    {
      id: "lag",
      title: t("evalWorkload.lag.title"),
      note: t("evalWorkload.lag.note"),
      options: lineOptions({
        series: [{ name: "p95", data: lag.value, color: chartColor("--color-chart-series-1") }],
        format: (v) => t("evalWorkload.lag.minutes", { n: Number(v.toFixed(1)) }),
      }),
    },
    {
      id: "throughput",
      title: t("evalWorkload.throughput.title"),
      note: t("evalWorkload.throughput.note", {
        per,
        n: sum(throughput.value).toLocaleString(),
      }),
      options: lineOptions({
        series: [
          {
            name: t("evalWorkload.throughput.title"),
            data: throughput.value,
            color: chartColor("--color-chart-series-2"),
            type: "bar",
          },
        ],
        format: (v) => Math.round(v).toLocaleString(),
      }),
    },
    {
      id: "errors",
      title: t("evalWorkload.errors.title"),
      note: errors.value.totals.length
        ? errors.value.totals.map((e) => `${errorKindLabel(e.kind, t)} ${e.calls}`).join(" · ")
        : t("evalWorkload.errors.none"),
      options: lineOptions({
        series: Object.entries(errors.value.byKind).map(([kind, data], i) => ({
          name: errorKindLabel(kind, t),
          data,
          color: colors[i % colors.length],
        })),
        format: (v) => `${Math.round(v)}%`,
        max: 100,
        markAt: {
          value: ERROR_RATE_ALERT_PCT,
          label: t("evalWorkload.errors.alertAt", { pct: ERROR_RATE_ALERT_PCT }),
        },
      }),
    },
    {
      id: "spend",
      title: t("evalWorkload.spend.title"),
      note: spendNote(per, budget),
      options: lineOptions({
        series: [
          {
            name: t("evalWorkload.spend.title"),
            data: spend.value,
            color: chartColor("--color-chart-series-5"),
            type: "bar",
          },
        ],
        format: formatUsd,
      }),
    },
  ];
});

const jobAlerts = computed(() =>
  (["eval_scores_stopped", "eval_judge_error_rate"] as AiJobAlertKind[]).map((kind) => {
    const rule = AI_AGENTS_PACK.find((r) => r.id === kind)!;
    return {
      kind,
      title: t(rule.titleKey),
      when: t(rule.whenKey),
      build: () =>
        buildAiPrefill({
          kind,
          stream: props.row.stream,
          jobId: jobId.value,
          jobName: props.row.name,
        }),
    };
  }),
);
</script>
