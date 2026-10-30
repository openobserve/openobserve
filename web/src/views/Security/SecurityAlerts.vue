<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Alerts — every time a detection fired.
     Rows are alert history (an immutable evaluation record) joined to the SIEM
     detection that produced them. Triage state lives on the case, not here:
     a firing is a fact about one evaluation, so this page reads it, explains
     it, and hands off to the evidence (Events) and the rule (Detections). -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import { useAlertHistoryWindow } from "@/composables/security/useAlertHistoryWindow";
import { useAlertHistorySummary } from "@/composables/security/useAlertHistorySummary";
import { isErrorOutcome, isFiringOutcome } from "@/utils/alerts/runOutcome";
import searchService from "@/services/search";
import { displayOrder, stepRow, type NavTable } from "@/utils/security/recordNav";
import { useSiemDetections, type DetectionRow } from "@/composables/security/useSiemDetections";
import { whereOfDetectionSql } from "@/utils/security/detection";
import { bucketMsFor, bucketize } from "@/utils/security/history";
import {
  summarizeError,
  STATUS_VARIANT,
  firingKey,
  firingStatus,
  toneOfHistoryLevel,
  valueVsThreshold,
  windowMinutes,
  type FiringRow,
  type FiringStatus,
} from "@/utils/security/firings";
import {
  SEVERITY_TONES,
  TONE_ICON,
  TONE_STAT,
  TONE_TOKEN,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";
import { normalizeTactic, techniqueUrl } from "@/utils/security/mitre";
import { parseSigmaRule } from "@/utils/security/sigma";
import { bestMatch } from "@/utils/security/classify";
import { normalizeEvents } from "@/utils/security/normalize";
import { b64EncodeUnicode, formatEventCount } from "@/utils/formatters";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── View state, mirrored in the URL so Overview links and shared links land here ─
const RANGES = [
  { value: "1h", minutes: 60 },
  { value: "6h", minutes: 360 },
  { value: "24h", minutes: 1440 },
  { value: "7d", minutes: 10080 },
  { value: "30d", minutes: 43200 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
type Facet = SeverityTone | "error" | "silenced";

const FACETS: Facet[] = ["critical", "high", "medium", "low", "error", "silenced"];
/** Tones each severity facet covers: low also carries info and unknown, so every firing lands in a tile. */
const FACET_TONES: Partial<Record<Facet, SeverityTone[]>> = {
  critical: ["critical"],
  high: ["high"],
  medium: ["medium"],
  low: ["low", "info", "unknown"],
};

const q = route.query as Record<string, string | undefined>;
const range = ref<RangeKey>(
  RANGES.some((r) => r.value === q.period) ? (q.period as RangeKey) : "24h",
);
// A fixed window (µs) from a link, e.g. a case's first..last alert. It does not
// slide on refresh; picking a range from the toggle replaces it.
const parsedFrom = Number(q.from);
const parsedTo = Number(q.to);
const customWindow = ref<{ startMs: number; endMs: number } | null>(
  Number.isFinite(parsedFrom) && Number.isFinite(parsedTo) && parsedTo > parsedFrom
    ? { startMs: Math.floor(parsedFrom / 1000), endMs: Math.ceil(parsedTo / 1000) }
    : null,
);
const siemOnly = ref(q.all !== "1");
const showEvaluations = ref(q.evals === "1");
const facet = ref<Facet | null>(FACETS.includes(q.facet as Facet) ? (q.facet as Facet) : null);
const search = ref(q.q ?? "");
const selectedKey = ref<string | null>(q.firing ?? null);

function syncUrl() {
  const query: Record<string, string> = { org_identifier: orgId.value };
  if (customWindow.value) {
    query.from = String(customWindow.value.startMs * 1000);
    query.to = String(customWindow.value.endMs * 1000);
  } else {
    query.period = range.value;
  }
  if (!siemOnly.value) query.all = "1";
  if (showEvaluations.value) query.evals = "1";
  if (facet.value) query.facet = facet.value;
  if (search.value.trim()) query.q = search.value.trim();
  if (selectedKey.value) query.firing = selectedKey.value;
  router.replace({ query });
}
watch([siemOnly, showEvaluations, facet, search, selectedKey], syncUrl);

const windowEndMs = ref(customWindow.value?.endMs ?? Date.now());
const windowMs = computed(() =>
  customWindow.value
    ? customWindow.value.endMs - customWindow.value.startMs
    : RANGES.find((r) => r.value === range.value)!.minutes * 60_000,
);
const windowStartMs = computed(() => windowEndMs.value - windowMs.value);

function onRange(value: unknown) {
  if (!value || (value === range.value && !customWindow.value)) return;
  range.value = value as RangeKey;
  customWindow.value = null;
  syncUrl();
  void fetchAll();
}

// ── Data ─────────────────────────────────────────────────────────────────────
const {
  byName,
  byId,
  siemRows,
  loading: rulesLoading,
  load: loadDetections,
  loadFull: loadFullDetection,
} = useSiemDetections();

// Paging, the newest-rows cap, row dedupe and the server's max_query_range
// narrowing are handled by the shared history window.
const historyWindow = useAlertHistoryWindow();
const summary = useAlertHistorySummary();
const history = computed(() => historyWindow.rows.value as FiringRow[]);
const historyTotal = computed(() => historyWindow.total.value);
const loading = computed(() => historyWindow.loading.value);
const error = computed(
  () => historyWindow.error.value || (siemOnly.value ? summary.error.value : ""),
);
const lastRunAt = ref<number | null>(null);
const summaryAt = ref<number | null>(null);

// Silenced runs are mostly "normal", so the Silenced facet needs every outcome.
const SIGNAL_OUTCOMES = ["firing", "notify_failed", "error"];
const outcomeFilter = computed(() =>
  showEvaluations.value || facet.value === "silenced" ? undefined : SIGNAL_OUTCOMES,
);
const siemIds = computed(() => siemRows.value.map((d) => String(d.alert.id ?? "")).filter(Boolean));

async function fetchRows() {
  if (!orgId.value) return;
  await historyWindow.load(orgId.value, windowStartMs.value, windowEndMs.value, {
    alertIds: siemOnly.value ? siemIds.value : undefined,
    outcomes: outcomeFilter.value,
  });
  if (!historyWindow.error.value) lastRunAt.value = Date.now();
}

async function fetchSummary() {
  if (!orgId.value || !siemOnly.value) return;
  await summary.load(orgId.value, windowStartMs.value, windowEndMs.value, {
    alertIds: siemIds.value,
    bucketMs: bucketMsFor(windowMs.value),
  });
  // Stamped on failure too, or the tiles would stay skeletons; a superseded load leaves it to the newer one.
  if (!summary.loading.value) summaryAt.value = Date.now();
}

const inFlight = ref(0);
async function fetchAll() {
  if (!orgId.value) return;
  inFlight.value += 1;
  try {
    windowEndMs.value = customWindow.value?.endMs ?? Date.now();
    const rules = loadDetections(orgId.value);
    // The SIEM-only fetches filter on detection ids, so they need the list first.
    if (siemOnly.value) await rules;
    await Promise.all([rules, fetchRows(), fetchSummary()]);
  } finally {
    inFlight.value -= 1;
  }
}
watch(siemOnly, () => void fetchAll());
watch(
  () => outcomeFilter.value?.join(",") ?? "",
  () => void fetchRows(),
);

const capped = computed(() => historyWindow.capped.value);
const cappedFromMs = computed(() => {
  const last = history.value[history.value.length - 1];
  return last ? Math.floor(last.timestamp / 1000) : windowStartMs.value;
});

// ── Rows ─────────────────────────────────────────────────────────────────────
interface Firing {
  id: string;
  row: FiringRow;
  detection: DetectionRow | null;
  name: string;
  tone: SeverityTone;
  status: FiringStatus;
  techniques: string[];
  timeMs: number;
}

const joined = computed<Firing[]>(() =>
  history.value.map((row) => {
    // An id, when the server sends one, is authoritative: a same-named ordinary alert must not match.
    const detection =
      (row.alert_id ? byId.value.get(row.alert_id) : byName.value.get(row.alert_name)) ?? null;
    return {
      id: firingKey(row),
      row,
      detection,
      name: detection?.meta.title ?? row.alert_name,
      tone: detection ? toneOfSigmaLevel(detection.meta.level) : toneOfHistoryLevel(row.level),
      status: firingStatus(row.status),
      techniques: detection?.meta.techniques ?? [],
      timeMs: Math.floor(row.timestamp / 1000),
    };
  }),
);

const isSignal = (f: Firing) =>
  f.status === "firing" || f.status === "notify_failed" || f.status === "error";

const siemScoped = computed(() => joined.value.filter((f) => !siemOnly.value || f.detection));
/**
 * Everything the facet tiles count over — the facet itself is not applied.
 * Silenced runs are usually "normal", so the Silenced facet brings them in
 * even while evaluations are hidden.
 */
const base = computed(() =>
  siemScoped.value.filter(
    (f) =>
      showEvaluations.value || isSignal(f) || (facet.value === "silenced" && f.row.is_silenced),
  ),
);
const firings = computed(() =>
  base.value.filter((f) => f.status === "firing" || f.status === "notify_failed"),
);

const emptyCounts = (): Record<Facet, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  unknown: 0,
  error: 0,
  silenced: 0,
});
const facetOfTone = (tone: SeverityTone) =>
  (Object.keys(FACET_TONES) as Facet[]).find((k) => FACET_TONES[k]!.includes(tone));

/** Exact firing and error totals for SIEM detections, mapped to a severity through the rule's Sigma level. */
const summaryCounts = computed(() => {
  const c = emptyCounts();
  for (const row of summary.rows.value) {
    const detection = byId.value.get(row.alertId);
    if (!detection) continue;
    if (isFiringOutcome(row.outcome)) {
      const facetKey = facetOfTone(toneOfSigmaLevel(detection.meta.level));
      if (facetKey) c[facetKey] += row.n;
    } else if (isErrorOutcome(row.outcome)) {
      c.error += row.n;
    }
  }
  return c;
});

const rowCounts = computed(() => {
  const c = emptyCounts();
  for (const f of firings.value) {
    const facetKey = facetOfTone(f.tone);
    if (facetKey) c[facetKey] += 1;
  }
  for (const f of base.value) if (f.status === "error") c.error += 1;
  return c;
});

const counts = computed(() => {
  if (siemOnly.value) {
    return {
      ...summaryCounts.value,
      silenced: summary.rows.value.reduce((sum, row) => sum + row.silenced, 0),
    };
  }
  const c = rowCounts.value;
  c.silenced = siemScoped.value.filter((f) => f.row.is_silenced).length;
  return c;
});
const statsLoading = computed(() => (siemOnly.value ? summaryAt.value : lastRunAt.value) === null);

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return base.value.filter((f) => {
    if (facet.value === "error" && f.status !== "error") return false;
    if (facet.value === "silenced" && !f.row.is_silenced) return false;
    const tones = facet.value ? FACET_TONES[facet.value] : undefined;
    if (
      tones &&
      !(tones.includes(f.tone) && (f.status === "firing" || f.status === "notify_failed"))
    ) {
      return false;
    }
    if (!needle) return true;
    return (
      f.name.toLowerCase().includes(needle) ||
      f.row.alert_name.toLowerCase().includes(needle) ||
      f.techniques.some((tech) => tech.toLowerCase().includes(needle))
    );
  });
});

const FACET_TILES: { key: Facet; icon: StatItem["icon"]; tone: StatItem["tone"] }[] = [
  { key: "critical", icon: TONE_ICON.critical, tone: TONE_STAT.critical },
  { key: "high", icon: TONE_ICON.high, tone: TONE_STAT.high },
  { key: "medium", icon: TONE_ICON.medium, tone: TONE_STAT.medium },
  { key: "low", icon: TONE_ICON.low, tone: TONE_STAT.low },
  { key: "error", icon: "error-outline", tone: "warning" },
  { key: "silenced", icon: "volume-off", tone: "neutral" },
];
const stats = computed<StatItem[]>(() =>
  FACET_TILES.map((tile) => ({
    key: tile.key,
    label:
      tile.key === "error" || tile.key === "silenced" || tile.key === "low"
        ? t(`siem.alerts.stat.${tile.key}`)
        : t("siem.alerts.stat.firings", { severity: t(toneLabelKey(tile.key as SeverityTone)) }),
    value: counts.value[tile.key],
    icon: tile.icon,
    tone: tile.tone,
    dataTest: `security-alerts-stat-${tile.key}`,
  })),
);
function onFacet(key: string) {
  facet.value = facet.value === key ? null : (key as Facet);
}

const chartSeries = computed(() =>
  [...SEVERITY_TONES].reverse().map((tone) => ({
    key: tone,
    label: t(toneLabelKey(tone)),
    token: TONE_TOKEN[tone],
  })),
);
type ChartTone = (typeof SEVERITY_TONES)[number];
const chartBuckets = computed(() => {
  if (!siemOnly.value) {
    return bucketize(
      firings.value
        .filter((f) => f.tone !== "unknown")
        .map((f) => ({ timeMs: f.timeMs, key: f.tone as ChartTone })),
      windowStartMs.value,
      windowEndMs.value,
      bucketMsFor(windowMs.value),
      SEVERITY_TONES,
    );
  }
  // The server may widen the bucket for long windows, so its width wins.
  const width = summary.bucketMs.value || bucketMsFor(windowMs.value);
  const buckets = bucketize<ChartTone>(
    [],
    windowStartMs.value,
    windowEndMs.value,
    width,
    SEVERITY_TONES,
  );
  const first = buckets[0]?.ts ?? 0;
  for (const row of summary.rows.value) {
    const detection = byId.value.get(row.alertId);
    if (!detection || !isFiringOutcome(row.outcome)) continue;
    const tone = toneOfSigmaLevel(detection.meta.level);
    const bucket = buckets[Math.floor((row.bucketMs - first) / width)];
    if (bucket && tone !== "unknown") bucket.counts[tone] += row.n;
  }
  return buckets;
});
const chartLoading = computed(
  () => rulesLoading.value || (siemOnly.value ? summary.loading.value : loading.value),
);

// ── Table ────────────────────────────────────────────────────────────────────
const SEVERITY_RANK: Record<SeverityTone, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  unknown: 0,
};
const columns = computed<OTableColumnDef<Firing>[]>(() => [
  {
    id: "severity",
    header: t("siem.common.severity"),
    // Ranked, so a sort reads critical → info rather than alphabetically.
    accessorFn: (f) => SEVERITY_RANK[f.tone],
    size: 110,
    sortable: true,
  },
  {
    id: "name",
    header: t("siem.alerts.column.detection"),
    accessorKey: "name",
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "techniques",
    header: t("siem.common.mitre"),
    accessorKey: "techniques",
    size: 170,
    hideable: true,
  },
  {
    id: "status",
    header: t("siem.alerts.column.status"),
    accessorKey: "status",
    size: 130,
    sortable: true,
  },
  {
    id: "value",
    header: t("siem.alerts.column.value"),
    accessorFn: (f) => valueVsThreshold(f.row),
    size: 130,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "window",
    header: t("siem.alerts.column.window"),
    accessorFn: (f) => windowMinutes(f.row),
    size: 100,
    hideable: true,
  },
  {
    id: "timestamp",
    // With every evaluation shown most rows did not fire, so the column is a time.
    header: showEvaluations.value
      ? t("siem.alerts.column.evaluated")
      : t("siem.alerts.column.fired"),
    accessorFn: (f) => f.row.timestamp,
    sortable: true,
    size: 120,
  },
]);

const rowRail = (f: Firing) => severityRailColor(f.tone);
const rowClass = (f: Firing) => (f.id === selectedKey.value ? "!bg-table-row-selected-bg" : "");

const filtersActive = computed(() => !!facet.value || !!search.value.trim());
function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    facet.value = null;
    search.value = "";
  }
}

// ── Drawer ───────────────────────────────────────────────────────────────────
// The open record is pinned: a refresh can slide it out of the window or past
// the newest-rows cap, and the drawer must not vanish mid-read.
const pinned = ref<Firing | null>(null);
const selected = computed<Firing | null>(() => {
  // In SIEM-only mode a link or pinned drawer must not surface an ordinary alert.
  const inScope = (f: Firing | null) => !!f && (!siemOnly.value || !!f.detection);
  const live = siemScoped.value.find((f) => f.id === selectedKey.value) ?? null;
  if (live) return live;
  const kept = pinned.value && pinned.value.id === selectedKey.value ? pinned.value : null;
  return inScope(kept) ? kept : null;
});
watch(selected, (f) => {
  if (f) pinned.value = f;
});
watch(
  () => selected.value?.detection?.alert.id,
  (id) => {
    if (id) void loadFullDetection(orgId.value, String(id));
  },
);
/** A linked record that is not in the loaded window — said, not silently ignored. */
const selectedMissing = computed(
  () => !!selectedKey.value && !selected.value && !loading.value && lastRunAt.value !== null,
);
const notices = computed<SecurityNotice[]>(() => {
  const out: SecurityNotice[] = [];
  if (error.value) {
    out.push({ key: "error", tone: "error", text: error.value, dataTest: "security-alerts-error" });
  }
  const narrowedFrom = historyWindow.effectiveStartMs.value;
  if (narrowedFrom) {
    out.push({
      key: "narrowed",
      tone: "warning",
      text: t("siem.mitrePage.historyNarrowed", { from: new Date(narrowedFrom).toLocaleString() }),
      dataTest: "security-alerts-narrowed",
    });
  }
  if (capped.value) {
    out.push({
      key: "capped",
      tone: "warning",
      text: t(siemOnly.value ? "siem.alerts.cappedRows" : "siem.alerts.capped", {
        n: formatEventCount(history.value.length),
        total: formatEventCount(historyTotal.value),
        from: new Date(cappedFromMs.value).toLocaleString(),
      }),
      dataTest: "security-alerts-capped",
    });
  }
  if (siemOnly.value && summary.partial.value) {
    out.push({
      key: "summary-partial",
      tone: "warning",
      text: t("siem.alerts.summaryPartial"),
      dataTest: "security-alerts-summary-partial",
    });
  }
  const custom = customWindow.value;
  if (custom) {
    out.push({
      key: "custom-window",
      tone: "info",
      text: t("siem.alerts.customWindow", {
        from: new Date(custom.startMs).toLocaleString(),
        to: new Date(custom.endMs).toLocaleString(),
      }),
      actionLabel: t("siem.alerts.backToRange", { range: t(`siem.alerts.range.${range.value}`) }),
      onAction: () => onRange(range.value),
      dataTest: "security-alerts-custom-window",
    });
  }
  if (selectedMissing.value) {
    out.push({
      key: "missing",
      tone: "warning",
      text: t("siem.alerts.missing"),
      actionLabel: t("siem.alerts.dismiss"),
      onAction: close,
      dataTest: "security-alerts-missing",
    });
  }
  return out;
});
const isFiringStatus = computed(
  () => selected.value?.status === "firing" || selected.value?.status === "notify_failed",
);
// Prev/next follows the table as the analyst sees it: its sort, across pages.
// Only the TanStack instance OTable exposes is read here.
const tableRef = ref<{ table?: NavTable<Firing> } | null>(null);
const sortTick = ref(0);
function sortedRows(): Firing[] {
  void sortTick.value;
  return displayOrder(tableRef.value?.table, filtered.value);
}
const selectedIndex = computed(() => {
  const i = sortedRows().findIndex((f) => f.id === selectedKey.value);
  return i === -1 ? null : i;
});
const sortedTotal = computed(() => sortedRows().length);
const tab = ref("overview");

function open(f: Firing) {
  selectedKey.value = f.id;
}
function close() {
  selectedKey.value = null;
  pinned.value = null;
}
function step(delta: number) {
  const next = stepRow(
    tableRef.value?.table,
    filtered.value,
    (f) => f.id === selectedKey.value,
    delta,
  );
  if (next) selectedKey.value = next.row.id;
}

// Resolved from the route (reactive), not window.location, which lags router.replace.
/**
 * A fixed window around the record, not the sliding `period`, so the link
 * still opens this firing tomorrow. History is filtered on the evaluation
 * time, so the window must contain `timestamp`, not just the evaluated span.
 */
const shareUrl = computed(() => {
  const f = selected.value;
  if (!f || typeof window === "undefined") return "";
  const SLACK_US = 5 * 60_000_000;
  const from = Math.min(f.row.start_time || f.row.timestamp, f.row.timestamp) - SLACK_US;
  const to = f.row.timestamp + SLACK_US;
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    from: String(from),
    to: String(to),
    firing: f.id,
  };
  if (!f.detection) query.all = "1";
  if (!isSignal(f)) query.evals = "1";
  return new URL(
    router.resolve({ path: route.path, query }).href,
    window.location.origin,
  ).toString();
});

const sigma = computed(() => {
  const yaml = selected.value?.detection?.meta.sigmaYaml;
  if (!yaml) return null;
  const parsed = parseSigmaRule(yaml);
  return parsed.ok ? parsed.rule : null;
});

const whereSql = computed(() =>
  whereOfDetectionSql(selected.value?.detection?.alert.query_condition?.sql),
);
const detectionStream = computed(() => selected.value?.detection?.alert.stream_name ?? "");
const evidenceSql = computed(() =>
  whereSql.value && detectionStream.value
    ? `SELECT * FROM "${detectionStream.value.replace(/"/g, '""')}" WHERE ${whereSql.value} ORDER BY _timestamp DESC`
    : "",
);

const facts = computed<RecordFact[]>(() => {
  const f = selected.value;
  if (!f) return [];
  const mins = windowMinutes(f.row);
  return [
    {
      label: isFiringStatus.value
        ? t("siem.alerts.fact.firedAt")
        : t("siem.alerts.fact.evaluatedAt"),
      value: new Date(f.timeMs).toLocaleString(),
    },
    { label: t("siem.alerts.fact.value"), value: valueVsThreshold(f.row) || "—", mono: true },
    { label: t("siem.alerts.fact.window"), value: mins ? t("siem.alerts.minutes", mins) : "—" },
    {
      label: t("siem.alerts.fact.evaluation"),
      value:
        f.row.evaluation_took_in_secs == null
          ? "—"
          : t("siem.alerts.seconds", { n: f.row.evaluation_took_in_secs.toFixed(2) }),
    },
  ];
});

const tabs = computed<RecordTab[]>(() => [
  { name: "overview", label: t("siem.alerts.tab.overview"), icon: "dashboard" },
  {
    name: "evidence",
    label: t("siem.alerts.tab.evidence"),
    icon: "manage-search",
    count: evidenceCount.value,
  },
  { name: "detection", label: t("siem.alerts.tab.detection"), icon: "rule" },
  { name: "raw", label: t("siem.alerts.tab.raw"), icon: "data-object" },
]);

const rowFields = computed<KeyValueRow[]>(() => {
  const f = selected.value;
  if (!f) return [];
  const rows: KeyValueRow[] = [
    {
      key: "status",
      label: t("siem.alerts.column.status"),
      value: t(`siem.alerts.status.${f.status}`),
    },
    { key: "evaluated", label: t("siem.alerts.fact.windowRange"), value: windowText(f.row) },
  ];
  if (f.row.group_label)
    rows.push({
      key: "group",
      label: t("siem.alerts.fact.group"),
      value: f.row.group_label,
      mono: true,
    });
  if (f.row.is_silenced)
    rows.push({
      key: "silenced",
      label: t("siem.alerts.stat.silenced"),
      value: t("siem.alerts.yes"),
    });
  // The error itself is the banner above; the full text is on the Raw tab.
  return rows;
});

function windowText(row: FiringRow): string {
  if (!row.start_time || !row.end_time) return "—";
  const fmt = (us: number) => new Date(us / 1000).toLocaleString();
  return `${fmt(row.start_time)} → ${fmt(row.end_time)}`;
}

const detectionFields = computed<KeyValueRow[]>(() => {
  const d = selected.value?.detection;
  if (!d) return [];
  const a = d.alert;
  const rows: KeyValueRow[] = [
    { key: "name", label: t("siem.alerts.rule.name"), value: String(a.name ?? "") },
    {
      key: "enabled",
      label: t("siem.alerts.rule.state"),
      value: a.enabled ? t("siem.alerts.rule.enabled") : t("siem.alerts.rule.disabled"),
    },
    {
      key: "stream",
      label: t("siem.alerts.rule.stream"),
      value: String(a.stream_name ?? "—"),
      mono: true,
    },
    {
      key: "level",
      label: t("siem.common.severity"),
      value: t(toneLabelKey(toneOfSigmaLevel(d.meta.level))),
    },
  ];
  const freq = a.trigger_condition?.frequency;
  if (freq)
    rows.push({
      key: "frequency",
      label: t("siem.alerts.rule.frequency"),
      value: t("siem.alerts.minutes", Number(freq)),
    });
  if (d.meta.logsource)
    rows.push({
      key: "logsource",
      label: t("siem.alerts.rule.logsource"),
      value: d.meta.logsource,
      mono: true,
    });
  if (d.meta.sigmaId)
    rows.push({
      key: "sigma",
      label: t("siem.alerts.rule.sigmaId"),
      value: d.meta.sigmaId,
      mono: true,
    });
  return rows;
});

const tactics = computed(() =>
  (selected.value?.detection?.meta.tactics ?? [])
    .map((x) => normalizeTactic(x))
    .filter((x): x is NonNullable<typeof x> => !!x),
);

// ── Evidence: the events this firing matched, over its own window ────────────
const evidence = ref<ReturnType<typeof normalizeEvents>>([]);
const evidenceCount = ref<number | null>(null);
const evidenceLoading = ref(false);
const evidenceError = ref("");
let evidenceSeq = 0;

async function loadEvidence() {
  // Bumped before any early return, so a response for the previous firing can
  // never land in this one.
  const mine = ++evidenceSeq;
  const f = selected.value;
  evidence.value = [];
  evidenceCount.value = null;
  evidenceError.value = "";
  evidenceLoading.value = false;
  if (!f || !evidenceSql.value || !f.row.start_time || !f.row.end_time) return;
  evidenceLoading.value = true;
  const run = (sql: string, size: number) =>
    searchService.search(
      {
        org_identifier: orgId.value,
        query: {
          query: { sql, start_time: f.row.start_time, end_time: f.row.end_time, from: 0, size },
        },
        page_type: "logs",
      },
      "ui",
    );
  try {
    // A separate COUNT: the rows query's `total` is capped at its own page size.
    const [rows, count] = await Promise.all([
      run(evidenceSql.value, 10),
      run(
        `SELECT COUNT(*) AS zo_n FROM "${detectionStream.value.replace(/"/g, '""')}" WHERE ${whereSql.value}`,
        1,
      ),
    ]);
    if (mine !== evidenceSeq) return;
    const hits: Record<string, unknown>[] = rows.data?.hits ?? [];
    const source = hits.length ? bestMatch(Object.keys(hits[0]), { sample: hits[0] }) : null;
    evidence.value = normalizeEvents(hits, source?.source ?? null);
    evidenceCount.value = Number(count.data?.hits?.[0]?.zo_n ?? hits.length);
  } catch (e: any) {
    if (mine !== evidenceSeq) return;
    evidenceError.value =
      e?.response?.data?.message ??
      e?.response?.data?.error ??
      e?.message ??
      t("siem.alerts.evidenceError");
  } finally {
    if (mine === evidenceSeq) evidenceLoading.value = false;
  }
}
// The SQL only exists once rules are identified, so a deep link opened before
// that must load when it arrives.
watch(
  () => [selected.value?.id, evidenceSql.value] as const,
  () => void loadEvidence(),
  { immediate: true },
);

function evidenceSummary(ev: (typeof evidence.value)[number]): string {
  return [ev.actor, ev.srcIp, ev.activity || ev.operation, ev.message].filter(Boolean).join(" · ");
}

/** Opens the Events page on this detection's matches over the firing window. */
function investigate() {
  const f = selected.value;
  if (!f || !evidenceSql.value) return;
  router.push({
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream: detectionStream.value,
      sql_mode: "true",
      query: b64EncodeUnicode(evidenceSql.value) ?? "",
      from: String(f.row.start_time),
      to: String(f.row.end_time),
    },
  });
}

function openDetection() {
  const id = selected.value?.detection?.alert.id;
  router.push({
    path: "/security/detections",
    query: { org_identifier: orgId.value, ...(id ? { detection: String(id) } : {}) },
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
function refresh() {
  void fetchAll();
}
function autoRefresh() {
  if (inFlight.value > 0 || document.visibilityState === "hidden") return;
  refresh();
}
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void fetchAll();
  timer = setInterval(autoRefresh, 60_000);
  syncUrl();
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <OPageLayout
    :title="t('siem.alerts.title')"
    :subtitle="t('siem.alerts.subtitle')"
    icon="notifications-active"
    bleed
    title-data-test="security-alerts-title"
  >
    <template #actions>
      <OToggleGroup
        :model-value="customWindow ? null : range"
        data-test="security-alerts-range"
        @update:model-value="onRange"
      >
        <OToggleGroupItem
          v-for="r in RANGES"
          :key="r.value"
          :value="r.value"
          size="sm"
          :data-test="`security-alerts-range-${r.value}`"
        >
          {{ t(`siem.alerts.range.${r.value}`) }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <SecurityNotices
        :notices="notices"
        class="mx-page-edge mt-3 shrink-0"
        data-test="security-alerts-notices"
      />

      <!-- Firings by severity (facets) and when they happened -->
      <div class="border-border-default px-page-edge flex shrink-0 flex-col gap-2 border-b py-3">
        <OStatStrip
          compact
          :items="stats"
          :loading="statsLoading"
          selectable
          :selected-key="facet"
          data-test="security-alerts-stats"
          @select="onFacet"
        />
        <div class="h-28">
          <SecuritySeverityChart
            :buckets="chartBuckets"
            :series="chartSeries"
            :loading="chartLoading"
            :min="windowStartMs"
            :max="windowEndMs"
            :highlight="facet && facet !== 'error' && facet !== 'silenced' ? facet : null"
            data-test="security-alerts-chart"
          />
        </div>
      </div>

      <OTable
        ref="tableRef"
        :data="filtered"
        :columns="columns"
        row-key="id"
        :loading="(loading || rulesLoading) && !history.length"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-alerts"
        :column-visibility="{ window: false }"
        :row-class="rowClass"
        :get-row-status-color="rowRail"
        class="min-h-0 flex-1"
        data-test="security-alerts-table"
        @row-click="open"
        @sort-change="sortTick++"
      >
        <template #toolbar>
          <div class="flex w-full flex-wrap items-center gap-3">
            <div class="w-72">
              <OSearchInput
                v-model="search"
                :placeholder="t('siem.alerts.search')"
                size="sm"
                data-test="security-alerts-search"
              />
            </div>
            <OSwitch
              v-model="siemOnly"
              :label="t('siem.alerts.siemOnly')"
              size="sm"
              data-test="security-alerts-siem-only"
            />
            <OSwitch
              v-model="showEvaluations"
              :label="t('siem.alerts.showEvaluations')"
              size="sm"
              data-test="security-alerts-evaluations"
            />
            <div class="flex-1" />
            <span class="text-text-secondary text-xs" data-test="security-alerts-count">
              {{
                t("siem.alerts.count", { n: formatEventCount(filtered.length) }, filtered.length)
              }}
            </span>
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="inFlight > 0"
            data-test="security-alerts-refresh"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.alerts.refresh')" />
          </OButton>
        </template>

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
              v-if="row.row.is_silenced"
              name="volume-off"
              size="xs"
              class="text-text-secondary shrink-0"
            >
              <OTooltip :content="t('siem.alerts.stat.silenced')" />
            </OIcon>
            <OTag v-if="!row.detection" variant="default-soft" size="xs">{{
              t("siem.alerts.notSiem")
            }}</OTag>
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
        <template #cell-status="{ row }">
          <OTag :variant="STATUS_VARIANT[row.status]" size="xs">{{
            t(`siem.alerts.status.${row.status}`)
          }}</OTag>
        </template>
        <template #cell-value="{ row }">
          <span class="font-mono text-xs tabular-nums">{{ valueVsThreshold(row.row) || "—" }}</span>
        </template>
        <template #cell-window="{ row }">
          <span class="text-text-secondary text-xs">{{
            windowMinutes(row.row) ? t("siem.alerts.minutes", windowMinutes(row.row)!) : "—"
          }}</span>
        </template>
        <template #cell-timestamp="{ row }">
          <OTimeCell :value="row.row.timestamp" unit="us" />
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="task-alt"
            :title="
              siemOnly && !siemRows.length && !rulesLoading
                ? t('siem.alerts.noDetections')
                : t('siem.alerts.empty')
            "
            :description="
              siemOnly && !siemRows.length && !rulesLoading
                ? t('siem.alerts.noDetectionsHint')
                : t('siem.alerts.emptyHint')
            "
            :filtered="filtersActive"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="tab"
      :title="selected.name"
      :eyebrow="isFiringStatus ? t('siem.alerts.eyebrow') : t('siem.alerts.eyebrowEvaluation')"
      :subtitle="detectionStream || undefined"
      icon="notifications-active"
      :tone="selected.tone"
      :facts="facts"
      :tabs="tabs"
      :index="selectedIndex"
      :total="sortedTotal"
      :share-url="shareUrl"
      data-test="security-alerts-drawer"
      @close="close"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          type="severity"
          :value="severityTagValue(selected.tone)"
          :label="t(toneLabelKey(selected.tone))"
          size="sm"
        />
        <OTag :variant="STATUS_VARIANT[selected.status]" size="sm">{{
          t(`siem.alerts.status.${selected.status}`)
        }}</OTag>
        <OTag
          v-for="tech in selected.techniques"
          :key="tech"
          variant="purple-soft"
          shape="rounded"
          size="sm"
          >{{ tech }}</OTag
        >
        <OTag v-if="selected.row.is_silenced" variant="default-soft" icon="volume-off" size="sm">
          {{ t("siem.alerts.stat.silenced") }}
        </OTag>
      </template>

      <template #tab-overview>
        <OBanner v-if="selected.row.error" variant="error-soft" icon="error-outline" dense>
          {{ summarizeError(selected.row.error) }}
        </OBanner>
        <section v-if="sigma?.description" class="flex flex-col gap-1.5">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ t("siem.alerts.whatItDetects") }}
          </h3>
          <p class="text-text-heading text-sm leading-relaxed">{{ sigma.description }}</p>
        </section>
        <section class="flex flex-col gap-1.5">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ isFiringStatus ? t("siem.alerts.whyItFired") : t("siem.alerts.evaluation") }}
          </h3>
          <SecurityKeyValues :rows="rowFields" data-test="security-alerts-drawer-why" />
        </section>
        <section v-if="selected.techniques.length" class="flex flex-col gap-1.5">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ t("siem.drawer.attack") }}
          </h3>
          <div class="flex flex-wrap items-center gap-2">
            <OButton
              v-for="tech in selected.techniques"
              :key="tech"
              as="a"
              :href="techniqueUrl(tech)"
              target="_blank"
              rel="noopener"
              variant="ghost-primary"
              size="xs"
              icon-right="open-in-new"
              :data-test="`security-alerts-drawer-technique-${tech}`"
              >{{ tech }}</OButton
            >
            <span v-if="tactics.length" class="text-text-secondary text-xs">
              {{ tactics.map((x) => t(`siem.mitre.tactics.${x}`)).join(" · ") }}
            </span>
          </div>
        </section>
        <section v-if="sigma?.falsepositives?.length" class="flex flex-col gap-1.5">
          <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
            {{ t("siem.alerts.falsePositives") }}
          </h3>
          <ul class="text-text-heading flex list-disc flex-col gap-1 pl-5 text-sm">
            <li v-for="fp in sigma.falsepositives" :key="fp">{{ fp }}</li>
          </ul>
        </section>
      </template>

      <template #tab-evidence>
        <OEmptyState
          v-if="!evidenceSql"
          size="inline"
          icon="info-outline"
          :title="t('siem.alerts.noEvidence')"
          :description="t('siem.alerts.noEvidenceHint')"
        />
        <template v-else>
          <div class="flex items-center gap-2">
            <span class="text-text-heading text-sm font-semibold">
              <template v-if="evidenceCount !== null">{{
                t(
                  "siem.alerts.evidenceCount",
                  { n: formatEventCount(evidenceCount) },
                  evidenceCount,
                )
              }}</template>
            </span>
            <OSpinner v-if="evidenceLoading" size="xs" />
            <div class="flex-1" />
            <OButton
              variant="outline"
              size="sm"
              icon-left="manage-search"
              data-test="security-alerts-drawer-investigate-inline"
              @click="investigate"
            >
              {{ t("siem.alerts.investigate") }}
            </OButton>
          </div>
          <OBanner v-if="evidenceError" variant="error-soft" icon="error-outline" dense>
            {{ evidenceError }}
          </OBanner>
          <div
            v-if="evidence.length"
            class="border-border-default rounded-surface overflow-hidden border"
            data-test="security-alerts-drawer-evidence"
          >
            <div
              v-for="(ev, i) in evidence"
              :key="i"
              class="border-border-subtle flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <OTag variant="primary-soft" size="xs" class="shrink-0">{{
                ev.className || t("siem.drawer.eyebrow")
              }}</OTag>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-text-heading truncate text-xs">{{
                  evidenceSummary(ev) || "—"
                }}</span>
                <span class="text-text-secondary text-2xs font-mono">{{
                  ev.time ? new Date(ev.time).toLocaleString() : "—"
                }}</span>
              </div>
            </div>
          </div>
          <span v-else-if="!evidenceLoading && !evidenceError" class="text-text-secondary text-xs">
            {{ isFiringStatus ? t("siem.alerts.evidenceAgedOut") : t("siem.alerts.evidenceNone") }}
          </span>
          <section class="flex flex-col gap-1.5">
            <h3 class="text-text-secondary text-xs font-semibold tracking-wide uppercase">
              {{ t("siem.alerts.query") }}
            </h3>
            <OCodeBlock :code="evidenceSql" lang="sql" data-test="security-alerts-drawer-sql" />
          </section>
        </template>
      </template>

      <template #tab-detection>
        <OEmptyState
          v-if="!selected.detection"
          size="inline"
          icon="info-outline"
          :title="t('siem.alerts.notSiemTitle')"
          :description="t('siem.alerts.notSiemHint')"
        />
        <SecurityKeyValues v-else :rows="detectionFields" data-test="security-alerts-drawer-rule" />
        <OCodeBlock
          v-if="selected.detection?.meta.sigmaYaml"
          :code="selected.detection.meta.sigmaYaml"
          lang="yaml"
          data-test="security-alerts-drawer-sigma"
        />
      </template>

      <template #tab-raw>
        <OCodeBlock
          :code="JSON.stringify(selected.row, null, 2)"
          lang="json"
          data-test="security-alerts-drawer-json"
        />
      </template>

      <template #footer>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="rule"
          :disabled="!selected.detection"
          data-test="security-alerts-drawer-open-detection"
          @click="openDetection"
        >
          {{ t("siem.alerts.openDetection") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="manage-search"
          :disabled="!evidenceSql"
          data-test="security-alerts-drawer-investigate"
          @click="investigate"
        >
          {{ t("siem.alerts.investigate") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
