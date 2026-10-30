<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- SOC Overview — what needs a human now: SIEM firings (history joined to detections),
     open cases, and whether security sources are still reporting. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityPanel from "@/components/security/SecurityPanel.vue";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import incidentsService, { type Incident } from "@/services/incidents";
import streamService from "@/services/stream";
import { useAlertHistoryWindow } from "@/composables/security/useAlertHistoryWindow";
import {
  countsByAlert,
  useAlertHistorySummary,
} from "@/composables/security/useAlertHistorySummary";
import { useSiemDetections, type DetectionRow } from "@/composables/security/useSiemDetections";
import { withRecentActivity } from "@/composables/security/streamActivity";
import { bucketMsFor, bucketize, isFiring, type HistoryRow } from "@/utils/security/history";
import { isFiringOutcome } from "@/utils/alerts/runOutcome";
import { firingKey } from "@/utils/security/firings";
import { normalizeTactic, tacticCoverage, type AttackTactic } from "@/utils/security/mitre";
import {
  SEVERITY_TONES,
  TONE_TOKEN,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";
import { sourceHealth, type SourceHealth } from "@/utils/security/streams";
import { securitySourceNames } from "@/utils/security/sourceSelection";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import { formatEventCount } from "@/utils/formatters";
import config from "@/aws-exports";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Window ───────────────────────────────────────────────────────────────────
const RANGES = [
  { value: "1h", minutes: 60 },
  { value: "24h", minutes: 1440 },
  { value: "7d", minutes: 10080 },
  { value: "30d", minutes: 43200 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];

const range = ref<RangeKey>(
  RANGES.some((r) => r.value === route.query.period) ? (route.query.period as RangeKey) : "24h",
);
const windowMs = computed(() => RANGES.find((r) => r.value === range.value)!.minutes * 60_000);
const windowEndMs = ref(Date.now());
const windowStartMs = computed(() => windowEndMs.value - windowMs.value);

function onRangeChange(value: unknown) {
  if (!value || value === range.value) return;
  range.value = value as RangeKey;
  router.replace({ query: { ...route.query, period: range.value } });
  void refresh();
}

// ── Data ─────────────────────────────────────────────────────────────────────
const {
  siemRows,
  byName,
  byId,
  loading: rulesLoading,
  error: rulesError,
  load: loadDetections,
} = useSiemDetections();

/** Exact firing counts per bucket and detection, for tiles, chart and rankings. */
const summary = useAlertHistorySummary();
/** Newest firing rows only, for the triage queue's value and error columns. */
const historyWindow = useAlertHistoryWindow();
const history = historyWindow.rows;
const historyError = computed(() => summary.error.value || historyWindow.error.value);

const incidents = ref<Incident[]>([]);
const casesLoading = ref(false);
const casesUnsupported = ref(false);

const streams = ref<any[]>([]);
const streamsLoading = ref(false);

const lastRunAt = ref<number | null>(null);
let detectionsReady: Promise<void> = Promise.resolve();
/** History is scoped to SIEM alert ids, so it cannot start before the detections land. */
const awaitingRules = ref(true);
const summaryLoading = computed(() => awaitingRules.value || summary.loading.value);
/** Set once the first summary lands, so later refreshes keep the tiles instead of a skeleton. */
const summaryLanded = ref(false);
const triageLoading = computed(() => awaitingRules.value || historyWindow.loading.value);
const loading = computed(
  () =>
    summaryLoading.value ||
    triageLoading.value ||
    casesLoading.value ||
    streamsLoading.value ||
    rulesLoading.value,
);

const openCasesTotal = ref(0);

// Case management is an enterprise/cloud feature; OSS answers an empty 200,
// which would read as "no open cases" rather than "not available".
const casesAvailable = config.isEnterprise === "true" || config.isCloud === "true";

async function fetchCases(seq: number) {
  if (!casesAvailable) {
    casesUnsupported.value = true;
    return;
  }
  casesLoading.value = true;
  casesUnsupported.value = false;
  try {
    // Asked for by status so resolved cases never crowd the open ones out of
    // the page, and the count comes from the server's total, not the page.
    const [open, investigating] = await Promise.all(
      ["open", "acknowledged"].map((status) =>
        incidentsService.list(orgId.value, status, 50, 0, undefined, true),
      ),
    );
    if (seq !== refreshSeq) return;
    incidents.value = [...(open.data?.incidents ?? []), ...(investigating.data?.incidents ?? [])];
    openCasesTotal.value = Number(open.data?.total ?? 0) + Number(investigating.data?.total ?? 0);
  } catch (e: any) {
    if (seq !== refreshSeq) return;
    // A build without incident correlation answers 403/404; that is not an error.
    if ([403, 404].includes(e?.response?.status)) casesUnsupported.value = true;
    incidents.value = [];
    openCasesTotal.value = 0;
  } finally {
    if (seq === refreshSeq) casesLoading.value = false;
  }
}

let streamsSeq = 0;
async function fetchStreams() {
  const seq = ++streamsSeq;
  streamsLoading.value = true;
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    // A newer load owns the list; this one only writes while it is the latest.
    if (seq !== streamsSeq) return;
    const list = res.data?.list ?? [];
    streams.value = list;
    // The panel can render now; the freshness check below only patches it.
    streamsLoading.value = false;
    // Stats lag ingestion; a source that is receiving data must not read as silent.
    const names = securitySourceNames(
      orgId.value,
      list.map((s: any) => String(s.name)),
    );
    const fresh = await withRecentActivity(orgId.value, list, names);
    if (seq === streamsSeq) streams.value = fresh;
  } catch {
    if (seq === streamsSeq) streams.value = [];
  } finally {
    if (seq === streamsSeq) streamsLoading.value = false;
  }
}

async function fetchHistory(seq: number, startMs: number, endMs: number) {
  await detectionsReady;
  if (seq !== refreshSeq) return;
  const alertIds = siemRows.value.map((row) => String(row.alert.id ?? "")).filter(Boolean);
  awaitingRules.value = false;
  await Promise.all([
    summary
      .load(orgId.value, startMs, endMs, { alertIds, bucketMs: bucketMsFor(windowMs.value) })
      .then(() => {
        if (seq === refreshSeq) summaryLanded.value = true;
      }),
    historyWindow.load(orgId.value, startMs, endMs, {
      alertIds,
      outcomes: ["firing", "notify_failed"],
      maxPages: 1,
    }),
  ]);
}

// A range change can overlap the auto-refresh; only the latest one may land.
let refreshSeq = 0;
let refreshing = 0;

async function refresh() {
  if (!orgId.value) return;
  const seq = ++refreshSeq;
  refreshing += 1;
  windowEndMs.value = Date.now();
  try {
    await Promise.all([
      fetchHistory(seq, windowStartMs.value, windowEndMs.value),
      fetchCases(seq),
      fetchStreams(),
    ]);
    if (seq === refreshSeq) lastRunAt.value = Date.now();
  } finally {
    refreshing -= 1;
  }
}

const securitySources = useSecuritySources();

// Rules change rarely; they load on entry and org change, not on the timed refresh.
function reloadAll() {
  // Classifies new streams in the background so auto-selected sources appear without visiting Events.
  void securitySources.load(orgId.value);
  awaitingRules.value = true;
  summaryLanded.value = false;
  detectionsReady = loadDetections(orgId.value);
  void refresh();
}
onMounted(() => {
  reloadAll();
  startTimer();
});
watch(orgId, reloadAll);

// ── Auto-refresh ─────────────────────────────────────────────────────────────
const autoRefresh = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;
function onTick() {
  if (refreshing > 0 || document.visibilityState === "hidden") return;
  void refresh();
}
function startTimer() {
  if (timer) clearInterval(timer);
  timer = autoRefresh.value ? setInterval(onTick, 60_000) : null;
}
function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  startTimer();
}
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

// ── Firings ──────────────────────────────────────────────────────────────────
interface Firing {
  row: HistoryRow;
  detection: DetectionRow;
  tone: SeverityTone;
}

/** Newest firing rows, for the triage queue only; every count comes from the summary. */
const firings = computed<Firing[]>(() =>
  history.value
    .filter(isFiring)
    .map((row) => ({
      row,
      detection: row.alert_id ? byId.value.get(row.alert_id) : byName.value.get(row.alert_name),
    }))
    .filter((entry): entry is { row: HistoryRow; detection: DetectionRow } => !!entry.detection)
    .map(({ row, detection }) => ({
      row,
      detection,
      tone: toneOfSigmaLevel(detection.meta.level),
    })),
);

const firingCounts = computed(() =>
  summary.rows.value.flatMap((row) => {
    const detection = isFiringOutcome(row.outcome) ? byId.value.get(row.alertId) : undefined;
    return detection ? [{ ...row, detection, tone: toneOfSigmaLevel(detection.meta.level) }] : [];
  }),
);
const totalFirings = computed(() => firingCounts.value.reduce((sum, f) => sum + f.n, 0));

const toneCounts = computed(() => {
  const counts: Record<SeverityTone, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    unknown: 0,
  };
  for (const f of firingCounts.value) counts[f.tone] += f.n;
  return counts;
});

const chartSeries = computed(() =>
  [...SEVERITY_TONES].reverse().map((tone) => ({
    key: tone,
    label: t(toneLabelKey(tone)),
    token: TONE_TOKEN[tone],
  })),
);

const chartBucketMs = computed(() => summary.bucketMs.value || bucketMsFor(windowMs.value));
const chartBuckets = computed(() => {
  const bucketMs = chartBucketMs.value;
  const buckets = bucketize([], windowStartMs.value, windowEndMs.value, bucketMs, SEVERITY_TONES);
  const first = buckets[0]?.ts ?? 0;
  for (const f of firingCounts.value) {
    const bucket = buckets[Math.floor((f.bucketMs - first) / bucketMs)];
    const tone = f.tone as (typeof SEVERITY_TONES)[number];
    if (bucket && tone in bucket.counts) bucket.counts[tone] += f.n;
  }
  return buckets;
});

const firedDetections = computed(() =>
  [...countsByAlert(summary.rows.value)].flatMap(([alertId, counts]) => {
    const detection = byId.value.get(alertId);
    if (!detection || !counts.firings) return [];
    return [
      {
        alertName: String(detection.alert.name ?? ""),
        name: detection.meta.title,
        tone: toneOfSigmaLevel(detection.meta.level),
        count: counts.firings,
        tactics: detection.meta.tactics,
      },
    ];
  }),
);
const topDetections = computed(() =>
  [...firedDetections.value].sort((a, b) => b.count - a.count).slice(0, 8),
);
const topMax = computed(() => topDetections.value[0]?.count ?? 0);

// ── Triage queue ─────────────────────────────────────────────────────────────
const TRIAGE_ROWS = 50;
const triageRows = computed(() =>
  firings.value.slice(0, TRIAGE_ROWS).map((f, index) => ({
    id: `${f.row.alert_name}-${f.row.timestamp}-${index}`,
    firing: firingKey(f.row),
    tone: f.tone,
    name: f.detection.meta.title,
    techniques: f.detection.meta.techniques,
    value: f.row.actual_value,
    timestamp: f.row.timestamp,
    error: f.row.error,
  })),
);
type TriageRow = (typeof triageRows.value)[number];

const triageColumns = computed<OTableColumnDef<TriageRow>[]>(() => [
  { id: "severity", header: t("siem.common.severity"), accessorKey: "tone", size: 110 },
  {
    id: "name",
    header: t("siem.overview.detection"),
    accessorKey: "name",
    meta: { isName: true },
  },
  { id: "techniques", header: t("siem.common.mitre"), accessorKey: "techniques", size: 170 },
  {
    id: "value",
    header: t("siem.overview.matches"),
    accessorKey: "value",
    size: 90,
    meta: { align: "right" },
  },
  { id: "timestamp", header: t("siem.overview.fired"), accessorKey: "timestamp", size: 110 },
]);

// ── Cases ────────────────────────────────────────────────────────────────────
const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
const openCases = computed(() =>
  [...incidents.value].sort(
    (a, b) =>
      (PRIORITY_RANK[a.severity] ?? 9) - (PRIORITY_RANK[b.severity] ?? 9) ||
      b.last_alert_at - a.last_alert_at,
  ),
);

// ── Sources ──────────────────────────────────────────────────────────────────
interface SourceRow {
  name: string;
  health: SourceHealth;
  docs: number;
  lastUs: number | null;
}
const HEALTH_RANK: Record<SourceHealth, number> = { quiet: 0, never: 1, live: 2 };
const sources = computed<SourceRow[]>(() => {
  // Reads the reactive source set, so streams classified in the background appear as they land.
  const known = new Set(securitySources.sourceNames.value);
  const names = streams.value.map((s) => s.name).filter((name) => known.has(name));
  const byStream = new Map(streams.value.map((s) => [s.name, s]));
  return names
    .map((name) => {
      const stats = byStream.get(name)?.stats;
      return {
        name,
        health: sourceHealth(stats),
        docs: Number(stats?.doc_num ?? 0),
        lastUs: stats?.doc_time_max ? Number(stats.doc_time_max) : null,
      };
    })
    .sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || b.docs - a.docs);
});
const quietSources = computed(() => sources.value.filter((s) => s.health === "quiet").length);
const liveSources = computed(() => sources.value.filter((s) => s.health === "live").length);

const HEALTH_DOT: Record<SourceHealth, string> = {
  live: "bg-status-positive",
  quiet: "bg-badge-amber-solid-bg",
  never: "bg-border-default",
};

// ── MITRE coverage ───────────────────────────────────────────────────────────
const coverage = computed(() => {
  const fired = new Map<AttackTactic, number>();
  for (const d of firedDetections.value) {
    const tactics = new Set(d.tactics.map(normalizeTactic));
    for (const tactic of tactics) if (tactic) fired.set(tactic, (fired.get(tactic) ?? 0) + d.count);
  }
  return tacticCoverage(
    siemRows.value.map((row) => ({ tactics: row.meta.tactics, enabled: !!row.alert.enabled })),
    [],
  ).map((entry) => ({ ...entry, firings: fired.get(entry.tactic) ?? 0 }));
});
const coveredTactics = computed(() => coverage.value.filter((c) => c.rules > 0).length);

function tacticClass(entry: { rules: number; firings: number }) {
  if (entry.firings > 0)
    return "bg-badge-error-soft-bg text-badge-error-soft-text border-transparent";
  if (entry.rules > 0) return "bg-surface-subtle text-text-heading border-transparent";
  return "border-dashed border-border-default text-text-secondary";
}

// ── Summary strip ────────────────────────────────────────────────────────────
const enabledRules = computed(() => siemRows.value.filter((r) => r.alert.enabled).length);
const firingDetections = computed(() => firedDetections.value.length);

const stats = computed<StatItem[]>(() => [
  {
    key: "critical",
    label: t("siem.overview.stat.critical"),
    value: toneCounts.value.critical,
    icon: "emergency",
    tone: "error",
    dataTest: "security-overview-stat-critical",
  },
  {
    key: "high",
    label: t("siem.overview.stat.high"),
    value: toneCounts.value.high,
    icon: "warning",
    tone: "orange",
    dataTest: "security-overview-stat-high",
  },
  {
    key: "cases",
    label: t("siem.overview.stat.openCases"),
    value: casesUnsupported.value ? "—" : openCasesTotal.value,
    icon: "assignment",
    tone: "warning",
    dataTest: "security-overview-stat-cases",
  },
  {
    key: "firing",
    label: t("siem.overview.stat.firingDetections"),
    value: firingDetections.value,
    icon: "notifications-active",
    tone: "primary",
    dataTest: "security-overview-stat-firing",
  },
  {
    key: "quiet",
    label: t("siem.overview.stat.quietSources"),
    value: quietSources.value,
    icon: "sync-problem",
    tone: "warning",
    dataTest: "security-overview-stat-quiet",
  },
  {
    key: "rules",
    label: t("siem.overview.stat.activeRules"),
    value: siemRows.value.length ? `${enabledRules.value} / ${siemRows.value.length}` : 0,
    icon: "verified-user",
    tone: "success",
    dataTest: "security-overview-stat-rules",
  },
]);

const STAT_ROUTES: Record<string, string> = {
  critical: "/security/alerts",
  high: "/security/alerts",
  cases: "/security/cases",
  firing: "/security/alerts",
  rules: "/security/detections",
};

/** Alerts over this page's window, so the numbers on both pages agree. */
function openAlerts(extra: Record<string, string> = {}) {
  nav("/security/alerts", { period: range.value, ...extra });
}

function onStat(key: string) {
  if (key === "critical" || key === "high") return openAlerts({ facet: key });
  if (key === "firing") return openAlerts();
  if (key === "quiet") {
    const quiet = sources.value.find((s) => s.health === "quiet");
    openSource(quiet?.name);
    return;
  }
  nav(STAT_ROUTES[key]);
}

/** Opens a source on Events over this page's window, not Events' 15m default. */
function openSource(name?: string) {
  nav("/security/events", { ...(name ? { stream: name } : {}), period: range.value });
}

// Only claimed once the list has actually loaded; a failed load is reported, not read as empty.
const noDetections = computed(
  () =>
    !awaitingRules.value && !rulesLoading.value && !rulesError.value && siemRows.value.length === 0,
);

const notices = computed<SecurityNotice[]>(() => {
  const out: SecurityNotice[] = [];
  if (noDetections.value) {
    out.push({
      key: "no-detections",
      tone: "info",
      text: t("siem.overview.noDetections"),
      actionLabel: t("siem.overview.browseDetections"),
      onAction: () => nav("/security/detections"),
      dataTest: "security-overview-no-detections",
    });
  }
  if (rulesError.value) {
    out.push({
      key: "rules-error",
      tone: "error",
      text: t("siem.overview.rulesError", { reason: rulesError.value }),
      dataTest: "security-overview-rules-error",
    });
  }
  if (historyError.value) {
    out.push({
      key: "history-error",
      tone: "error",
      text: t("siem.overview.historyError", { reason: historyError.value }),
      dataTest: "security-overview-history-error",
    });
  }
  if (historyWindow.effectiveStartMs.value) {
    out.push({
      key: "history-narrowed",
      tone: "warning",
      text: t("siem.mitrePage.historyNarrowed", {
        from: new Date(historyWindow.effectiveStartMs.value).toLocaleString(),
      }),
      dataTest: "security-overview-history-narrowed",
    });
  }
  if (summary.partial.value) {
    out.push({
      key: "summary-partial",
      tone: "warning",
      text: t("siem.overview.summaryPartial"),
      dataTest: "security-overview-summary-partial",
    });
  }
  return out;
});

// ── Navigation ───────────────────────────────────────────────────────────────
function nav(path: string, query: Record<string, string> = {}) {
  router.push({ path, query: { org_identifier: orgId.value, ...query } });
}
</script>

<template>
  <OPageLayout
    :title="t('siem.overview.title')"
    :subtitle="t('siem.overview.subtitle')"
    icon="security"
    scroll
    pad-y
    title-data-test="security-overview-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <OToggleGroup
          :model-value="range"
          data-test="security-overview-range"
          @update:model-value="onRangeChange"
        >
          <OToggleGroupItem
            v-for="r in RANGES"
            :key="r.value"
            :value="r.value"
            size="sm"
            :data-test="`security-overview-range-${r.value}`"
          >
            {{ t(`siem.range.${r.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          variant="ghost"
          size="icon-sm"
          :icon-left="autoRefresh ? 'sync' : 'sync-disabled'"
          :active="autoRefresh"
          data-test="security-overview-auto-refresh"
          @click="toggleAutoRefresh"
        >
          <OTooltip
            :content="
              autoRefresh ? t('siem.overview.autoRefreshOn') : t('siem.overview.autoRefreshOff')
            "
          />
        </OButton>
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          data-test="security-overview-refresh"
          @click="refresh"
        />
      </div>
    </template>

    <div class="flex flex-col gap-4 pb-4">
      <SecurityNotices :notices="notices" data-test="security-overview-notices" />

      <OStatStrip
        compact
        :items="stats"
        :loading="!summaryLanded"
        selectable
        :selected-key="null"
        data-test="security-overview-stats"
        @select="onStat"
      />

      <!-- Row 1: what fired, and the cases it rolled up into -->
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SecurityPanel
          :title="t('siem.overview.activity')"
          :hint="t('siem.overview.activityHint', totalFirings)"
          icon="stacked-line-chart"
          class="h-80 xl:col-span-2"
          data-test="security-overview-activity"
        >
          <template #actions>
            <OTag
              v-for="tone in SEVERITY_TONES"
              :key="tone"
              type="severity"
              :value="tone"
              :label="t(toneLabelKey(tone))"
              :count="toneCounts[tone]"
              hide-zero-count
              size="xs"
            />
          </template>
          <div class="min-h-0 flex-1 px-2 pb-2">
            <SecuritySeverityChart
              v-if="totalFirings || summaryLoading"
              :buckets="chartBuckets"
              :series="chartSeries"
              :loading="summaryLoading"
              :min="windowStartMs"
              :max="windowEndMs"
              data-test="security-overview-activity-chart"
            />
            <OEmptyState
              v-else
              size="inline"
              icon="task-alt"
              :title="t('siem.overview.quiet')"
              :description="t('siem.overview.quietHint')"
            />
          </div>
        </SecurityPanel>

        <SecurityPanel
          :title="t('siem.overview.openCases')"
          :count="casesUnsupported ? null : openCasesTotal"
          icon="assignment"
          tone="warning"
          class="h-80"
          data-test="security-overview-cases"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="sm"
              icon-right="arrow-forward"
              data-test="security-overview-cases-view-all"
              @click="nav('/security/cases')"
            >
              {{ t("siem.common.viewAll") }}
            </OButton>
          </template>
          <div v-if="casesLoading && !incidents.length" class="flex flex-col gap-2 p-4">
            <OSkeleton v-for="n in 4" :key="n" type="text" class="h-8" />
          </div>
          <OEmptyState
            v-else-if="casesUnsupported"
            size="inline"
            icon="info-outline"
            :title="t('siem.overview.casesUnsupported')"
          />
          <OEmptyState
            v-else-if="!openCases.length"
            size="inline"
            icon="task-alt"
            :title="t('siem.overview.noOpenCases')"
          />
          <ul v-else class="min-h-0 flex-1 overflow-y-auto">
            <li
              v-for="c in openCases"
              :key="c.id"
              class="border-border-subtle hover:bg-surface-subtle px-page-edge flex cursor-pointer items-center gap-3 border-b py-2 last:border-b-0"
              role="button"
              tabindex="0"
              :data-test="`security-overview-case-${c.id}`"
              @click="nav('/security/cases')"
              @keydown.enter="nav('/security/cases')"
              @keydown.space.prevent="nav('/security/cases')"
            >
              <OTag type="severity" :value="c.severity.toLowerCase()" size="xs" />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-text-heading truncate text-sm font-medium">
                  {{ c.title || t("siem.overview.untitledCase") }}
                </span>
                <span class="text-text-secondary text-xs">
                  {{ t("siem.overview.caseAlerts", c.alert_count) }} ·
                  {{ t(`siem.caseStatus.${c.status}`) }}
                </span>
              </div>
              <OTimeCell :value="c.last_alert_at" unit="us" class="text-xs" />
            </li>
          </ul>
        </SecurityPanel>
      </div>

      <!-- Row 2: triage queue and the rules doing the firing -->
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SecurityPanel
          :title="t('siem.overview.triage')"
          :hint="t('siem.overview.triageHint')"
          :count="totalFirings"
          icon="inbox"
          tone="error"
          class="h-96 xl:col-span-2"
          data-test="security-overview-triage"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="sm"
              icon-right="arrow-forward"
              data-test="security-overview-full-queue"
              @click="openAlerts()"
            >
              {{ t("siem.overview.fullQueue") }}
            </OButton>
          </template>
          <OTable
            :data="triageRows"
            :columns="triageColumns"
            row-key="id"
            :loading="triageLoading && !firings.length"
            pagination="none"
            sorting="none"
            :show-global-filter="false"
            :get-row-status-color="(row: TriageRow) => severityRailColor(row.tone)"
            class="min-h-0 flex-1"
            data-test="security-overview-triage-table"
            @row-click="(row: TriageRow) => openAlerts({ firing: row.firing })"
          >
            <template #cell-severity="{ row }">
              <OTag
                type="severity"
                :value="severityTagValue(row.tone)"
                :label="t(toneLabelKey(row.tone))"
                size="xs"
              />
            </template>
            <template #cell-name="{ row }">
              <div class="flex min-w-0 items-center gap-1.5">
                <span class="text-text-heading truncate font-medium">{{ row.name }}</span>
                <OIcon
                  v-if="row.error"
                  name="error-outline"
                  size="xs"
                  class="text-status-error-text shrink-0"
                >
                  <OTooltip :content="row.error" />
                </OIcon>
              </div>
            </template>
            <template #cell-techniques="{ row }">
              <div class="flex min-w-0 gap-1 overflow-hidden">
                <OTag
                  v-for="tech in row.techniques.slice(0, 2)"
                  :key="tech"
                  variant="purple-soft"
                  shape="rounded"
                  size="xs"
                  >{{ tech }}</OTag
                >
                <span v-if="row.techniques.length > 2" class="text-text-secondary text-xs">
                  +{{ row.techniques.length - 2 }}
                </span>
                <span v-if="!row.techniques.length" class="text-text-secondary">—</span>
              </div>
            </template>
            <template #cell-value="{ row }">
              <span class="tabular-nums">{{
                row.value == null ? "—" : formatEventCount(Number(row.value))
              }}</span>
            </template>
            <template #cell-timestamp="{ row }">
              <OTimeCell :value="row.timestamp" unit="us" />
            </template>
            <template #empty>
              <OEmptyState
                size="inline"
                icon="task-alt"
                :title="t('siem.overview.queueClear')"
                :description="t('siem.overview.quietHint')"
              />
            </template>
          </OTable>
        </SecurityPanel>

        <SecurityPanel
          :title="t('siem.overview.topDetections')"
          :hint="t('siem.overview.topDetectionsHint')"
          icon="local-fire-department"
          tone="orange"
          class="h-96"
          data-test="security-overview-top-detections"
        >
          <OEmptyState
            v-if="!topDetections.length && !summaryLoading"
            size="inline"
            icon="task-alt"
            :title="t('siem.overview.quiet')"
          />
          <ul v-else class="px-page-edge flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
            <li
              v-for="d in topDetections"
              :key="d.alertName"
              class="flex cursor-pointer flex-col gap-1"
              role="button"
              tabindex="0"
              :data-test="`security-overview-top-detection-${d.alertName}`"
              @click="openAlerts({ q: d.alertName })"
              @keydown.enter="openAlerts({ q: d.alertName })"
              @keydown.space.prevent="openAlerts({ q: d.alertName })"
            >
              <div class="flex items-center gap-2">
                <OTag
                  type="severity"
                  :value="severityTagValue(d.tone)"
                  :label="t(toneLabelKey(d.tone))"
                  size="xs"
                />
                <span class="text-text-heading min-w-0 flex-1 truncate text-sm">{{ d.name }}</span>
                <span class="text-text-heading text-sm font-semibold tabular-nums">{{
                  formatEventCount(d.count)
                }}</span>
              </div>
              <OProgressBar
                :value="topMax ? d.count / topMax : 0"
                :variant="
                  d.tone === 'critical' ? 'danger' : d.tone === 'high' ? 'warning' : 'default'
                "
                size="xs"
              />
            </li>
          </ul>
        </SecurityPanel>
      </div>

      <!-- Row 3: where coverage is, and whether the sources feeding it are alive -->
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SecurityPanel
          :title="t('siem.overview.mitre')"
          :hint="t('siem.overview.mitreHint', { covered: coveredTactics, total: coverage.length })"
          icon="grid-on"
          class="xl:col-span-2"
          data-test="security-overview-mitre"
        >
          <div class="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
            <div
              v-for="entry in coverage"
              :key="entry.tactic"
              class="rounded-default flex min-h-18 flex-col justify-between gap-1 border p-2"
              :class="tacticClass(entry)"
              :data-test="`security-overview-tactic-${entry.tactic}`"
            >
              <span class="text-2xs leading-tight font-semibold">{{
                t(`siem.mitre.tactics.${entry.tactic}`)
              }}</span>
              <span class="text-2xs flex items-center justify-between gap-1 opacity-80">
                <span>{{ t("siem.overview.rulesCount", entry.rules) }}</span>
                <span v-if="entry.firings" class="font-semibold tabular-nums">
                  {{ t("siem.overview.firingsCount", entry.firings) }}
                </span>
              </span>
            </div>
          </div>
          <div
            class="text-2xs text-text-secondary px-page-edge flex flex-wrap items-center gap-4 pb-3"
          >
            <span class="flex items-center gap-1.5">
              <span class="bg-badge-error-soft-bg rounded-default size-3" />
              {{ t("siem.overview.legendFiring") }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="bg-surface-subtle rounded-default size-3" />
              {{ t("siem.overview.legendCovered") }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="border-border-default rounded-default size-3 border border-dashed" />
              {{ t("siem.overview.legendGap") }}
            </span>
          </div>
        </SecurityPanel>

        <SecurityPanel
          :title="t('siem.overview.sources')"
          :hint="t('siem.overview.sourcesHint', { live: liveSources, total: sources.length })"
          icon="database"
          :tone="quietSources ? 'warning' : 'primary'"
          class="h-96 xl:h-auto xl:max-h-96"
          data-test="security-overview-sources"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="sm"
              icon-right="arrow-forward"
              data-test="security-overview-explore-events"
              @click="nav('/security/events')"
            >
              {{ t("siem.overview.explore") }}
            </OButton>
          </template>
          <div v-if="streamsLoading && !streams.length" class="flex flex-col gap-2 p-4">
            <OSkeleton v-for="n in 4" :key="n" type="text" class="h-6" />
          </div>
          <OEmptyState
            v-else-if="!sources.length"
            size="inline"
            icon="cloud-upload"
            :title="t('siem.overview.noSources')"
            :description="t('siem.overview.noSourcesHint')"
          />
          <ul v-else class="min-h-0 flex-1 overflow-y-auto">
            <li
              v-for="s in sources"
              :key="s.name"
              class="border-border-subtle hover:bg-surface-subtle px-page-edge flex cursor-pointer items-center gap-2.5 border-b py-2 last:border-b-0"
              role="button"
              tabindex="0"
              :data-test="`security-overview-source-${s.name}`"
              @click="openSource(s.name)"
              @keydown.enter="openSource(s.name)"
              @keydown.space.prevent="openSource(s.name)"
            >
              <span class="size-2 shrink-0 rounded-full" :class="HEALTH_DOT[s.health]">
                <OTooltip :content="t(`siem.health.${s.health}`)" />
              </span>
              <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-xs">{{
                s.name
              }}</span>
              <span class="text-text-secondary text-xs tabular-nums">{{
                formatEventCount(s.docs)
              }}</span>
              <OTimeCell
                :value="s.lastUs"
                unit="us"
                :empty-label="t('siem.health.never')"
                class="w-20 shrink-0 text-right text-xs"
              />
            </li>
          </ul>
        </SecurityPanel>
      </div>
    </div>
  </OPageLayout>
</template>
