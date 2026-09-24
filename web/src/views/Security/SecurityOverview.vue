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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
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
import { useSiemDetections, type DetectionRow } from "@/composables/security/useSiemDetections";
import { bucketMsFor, bucketize, isFiring, type HistoryRow } from "@/utils/security/history";
import { firingKey } from "@/utils/security/firings";
import { tacticCoverage } from "@/utils/security/mitre";
import {
  SEVERITY_TONES,
  TONE_TOKEN,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";
import {
  loadTaggedStreams,
  securityStreamNames,
  sourceHealth,
  type SourceHealth,
} from "@/utils/security/streams";
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
  loading: rulesLoading,
  hydrating,
  unchecked,
  load: loadDetections,
} = useSiemDetections();

// Paged, de-duplicated history for the window (shared with MITRE/Compliance).
const historyWindow = useAlertHistoryWindow();
const history = historyWindow.rows;
const historyTotal = historyWindow.total;
const historyLoading = historyWindow.loading;
const historyError = historyWindow.error;

const incidents = ref<Incident[]>([]);
const casesLoading = ref(false);
const casesUnsupported = ref(false);

const streams = ref<any[]>([]);
const streamsLoading = ref(false);

const lastRunAt = ref<number | null>(null);
/** Firings are only known once rules are identified; until then "nothing fired" would be a lie. */
const rulesPending = computed(() => rulesLoading.value || hydrating.value);
const loading = computed(
  () => historyLoading.value || casesLoading.value || streamsLoading.value || rulesPending.value,
);
const firingsLoading = computed(() => historyLoading.value || rulesPending.value);

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
      ["open", "acknowledged"].map((status) => incidentsService.list(orgId.value, status, 50, 0)),
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

async function fetchStreams() {
  streamsLoading.value = true;
  try {
    const res = await streamService.nameList(orgId.value, "logs", false);
    streams.value = res.data?.list ?? [];
  } catch {
    streams.value = [];
  } finally {
    streamsLoading.value = false;
  }
}

// A range change can overlap the auto-refresh; only the latest one may land.
let refreshSeq = 0;

async function refresh() {
  if (!orgId.value) return;
  const seq = ++refreshSeq;
  windowEndMs.value = Date.now();
  await Promise.all([
    historyWindow.load(orgId.value, windowStartMs.value, windowEndMs.value),
    fetchCases(seq),
    fetchStreams(),
  ]);
  if (seq === refreshSeq) lastRunAt.value = Date.now();
}

// Rules change rarely; they load once and are not part of the timed refresh.
onMounted(() => {
  void loadDetections(orgId.value);
  void refresh();
  startTimer();
});
watch(orgId, () => {
  void loadDetections(orgId.value);
  void refresh();
});

// ── Auto-refresh ─────────────────────────────────────────────────────────────
const autoRefresh = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;
function startTimer() {
  if (timer) clearInterval(timer);
  timer = autoRefresh.value ? setInterval(() => void refresh(), 60_000) : null;
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
  timeMs: number;
}

const firings = computed<Firing[]>(() =>
  history.value
    .filter(isFiring)
    .map((row) => ({ row, detection: byName.value.get(row.alert_name) }))
    .filter((entry): entry is { row: HistoryRow; detection: DetectionRow } => !!entry.detection)
    .map(({ row, detection }) => ({
      row,
      detection,
      tone: toneOfSigmaLevel(detection.meta.level),
      timeMs: Math.floor(row.timestamp / 1000),
    })),
);

const historyCapped = historyWindow.capped;
/** Oldest evaluation actually loaded, so a capped window can say where it stops. */
const historyFromMs = computed(() => {
  const last = history.value[history.value.length - 1];
  return last ? Math.floor(last.timestamp / 1000) : windowStartMs.value;
});

const toneCounts = computed(() => {
  const counts: Record<SeverityTone, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    unknown: 0,
  };
  for (const f of firings.value) counts[f.tone] += 1;
  return counts;
});

const chartSeries = computed(() =>
  [...SEVERITY_TONES].reverse().map((tone) => ({
    key: tone,
    label: t(toneLabelKey(tone)),
    token: TONE_TOKEN[tone],
  })),
);

const chartBuckets = computed(() =>
  bucketize(
    firings.value.map((f) => ({
      timeMs: f.timeMs,
      key: f.tone as (typeof SEVERITY_TONES)[number],
    })),
    windowStartMs.value,
    windowEndMs.value,
    bucketMsFor(windowMs.value),
    SEVERITY_TONES,
  ),
);

const topDetections = computed(() => {
  const tally = new Map<
    string,
    { alertName: string; name: string; tone: SeverityTone; count: number }
  >();
  for (const f of firings.value) {
    const entry = tally.get(f.row.alert_name) ?? {
      alertName: f.row.alert_name,
      name: f.detection.meta.title,
      tone: f.tone,
      count: 0,
    };
    entry.count += 1;
    tally.set(f.row.alert_name, entry);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 8);
});
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
  const names = securityStreamNames(
    streams.value.map((s) => s.name),
    loadTaggedStreams(orgId.value),
  );
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
const coverage = computed(() =>
  tacticCoverage(
    siemRows.value.map((row) => ({ tactics: row.meta.tactics, enabled: !!row.alert.enabled })),
    firings.value.map((f) => ({ tactics: f.detection.meta.tactics })),
  ),
);
const coveredTactics = computed(() => coverage.value.filter((c) => c.rules > 0).length);

function tacticClass(entry: { rules: number; firings: number }) {
  if (entry.firings > 0)
    return "bg-badge-error-soft-bg text-badge-error-soft-text border-transparent";
  if (entry.rules > 0) return "bg-surface-subtle text-text-heading border-transparent";
  return "border-dashed border-border-default text-text-secondary";
}

// ── Summary strip ────────────────────────────────────────────────────────────
const enabledRules = computed(() => siemRows.value.filter((r) => r.alert.enabled).length);
const firingDetections = computed(() => new Set(firings.value.map((f) => f.row.alert_name)).size);

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

const noDetections = computed(
  () => !rulesLoading.value && !hydrating.value && siemRows.value.length === 0,
);

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
      <OBanner
        v-if="noDetections"
        variant="info"
        icon="shield"
        inline-actions
        data-test="security-overview-no-detections"
      >
        {{ t("siem.overview.noDetections") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="security-overview-browse-detections"
            @click="nav('/security/detections')"
          >
            {{ t("siem.overview.browseDetections") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-if="historyError"
        variant="error-soft"
        icon="error-outline"
        data-test="security-overview-history-error"
      >
        {{ historyError }}
      </OBanner>
      <OBanner
        v-if="historyWindow.effectiveStartMs.value"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-overview-history-narrowed"
      >
        {{
          t("siem.mitrePage.historyNarrowed", {
            from: new Date(historyWindow.effectiveStartMs.value).toLocaleString(),
          })
        }}
      </OBanner>
      <OBanner
        v-if="unchecked > 0"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-overview-unchecked"
      >
        {{ t("siem.overview.uncheckedRules", unchecked) }}
      </OBanner>
      <OBanner
        v-if="historyCapped"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-overview-history-capped"
      >
        {{
          t("siem.overview.historyCapped", {
            n: formatEventCount(history.length),
            total: formatEventCount(historyTotal),
            from: new Date(historyFromMs).toLocaleString(),
          })
        }}
      </OBanner>

      <OStatStrip
        :items="stats"
        :loading="lastRunAt === null || (rulesPending && !siemRows.length)"
        selectable
        :selected-key="null"
        data-test="security-overview-stats"
        @select="onStat"
      />

      <!-- Row 1: what fired, and the cases it rolled up into -->
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SecurityPanel
          :title="t('siem.overview.activity')"
          :hint="t('siem.overview.activityHint', firings.length)"
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
              v-if="firings.length || firingsLoading"
              :buckets="chartBuckets"
              :series="chartSeries"
              :loading="firingsLoading"
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
          :count="firings.length"
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
            :loading="firingsLoading && !firings.length"
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
            v-if="!topDetections.length && !firingsLoading"
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
