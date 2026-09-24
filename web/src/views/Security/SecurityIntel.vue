<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Threat Intel — known-bad indicators (rows of `ioc_*`/`threat_intel*`
     enrichment tables) and where an exact, server-side sweep found them. -->
<script setup lang="ts">
import { displayOrder, stepRow, type NavTable } from "@/utils/security/recordNav";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import SecurityIntelAddDialog from "@/components/security/SecurityIntelAddDialog.vue";
import SecurityIntelImportDialog from "@/components/security/SecurityIntelImportDialog.vue";
import threatIntel, {
  INTEL_READ_LIMIT,
  RemoveRefused,
  type IntelTable,
} from "@/services/threat_intel";
import searchService from "@/services/search";
import { useIntelSweep, MAX_SWEEP_QUERIES } from "@/composables/security/useIntelSweep";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import {
  INDICATOR_TYPES,
  expiresSoon,
  isExpired,
  sightingsSql,
  type Indicator,
  type IndicatorMatch,
  type IndicatorType,
  type Sighting,
} from "@/utils/security/intel";
import { histogramInterval, histogramKeyToMs } from "@/utils/security/eventQuery";
import {
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
} from "@/utils/security/severity";
import { b64EncodeUnicode, formatEventCount } from "@/utils/formatters";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { confirm } = useConfirmDialog();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Window ───────────────────────────────────────────────────────────────────
const RANGES = [
  { value: "24h", minutes: 1440 },
  { value: "7d", minutes: 10080 },
  { value: "30d", minutes: 43200 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
const range = ref<RangeKey>(
  RANGES.some((r) => r.value === route.query.period) ? (route.query.period as RangeKey) : "7d",
);
// Pinned when a sweep starts, so the sweep, the counts and the drawer timeline
// all describe the same window — and a later sweep moves it forward.
const windowEndUs = ref(Date.now() * 1000);
const windowUs = computed(() => ({
  start: windowEndUs.value - RANGES.find((r) => r.value === range.value)!.minutes * 60_000_000,
  end: windowEndUs.value,
}));

// ── Indicators ───────────────────────────────────────────────────────────────
const tables = ref<IntelTable[]>([]);
const indicators = ref<Indicator[]>([]);
const loading = ref(false);
const loadError = ref("");
/** Tables whose read stopped short of their row count. */
const truncated = ref<string[]>([]);
/** Tables that could not be read at all. */
const unreadTables = ref<string[]>([]);
/** Tables with rows but no indicator column (e.g. a feed of another shape). */
const noIndicatorColumn = ref<string[]>([]);
/** Non-blank rows that are not a recognisable indicator, per table. */
const skippedRows = ref<{ table: string; n: number }[]>([]);
let loadSeq = 0;

/** Row identity that survives a reload: list, indicator, and which repeat of it. */
const uids = new WeakMap<Indicator, string>();
const uidOf = (i: Indicator) => uids.get(i) ?? "";

async function loadIndicators() {
  if (!orgId.value) return;
  const mySeq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const list = await threatIntel.listTables(orgId.value);
    const reads = await Promise.all(
      list.map((tb) => threatIntel.readTable(orgId.value, tb.name).catch(() => null)),
    );
    if (mySeq !== loadSeq) return;
    tables.value = list;
    const all: Indicator[] = [];
    const seen = new Map<string, number>();
    reads.forEach((read) => {
      read?.indicators.forEach((indicator) => {
        const base = `${indicator.table}|${indicatorKey(indicator)}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        uids.set(indicator, `${base}|${n}`);
        all.push(indicator);
      });
    });
    indicators.value = all;
    tableColumns.value = Object.fromEntries(
      list.map((tb, i) => [tb.name, reads[i]?.columns ?? []]),
    );
    // Keep an open drawer on the same indicator's fresh object (or close it if gone).
    if (selected.value) {
      const id = uidOf(selected.value);
      selected.value = all.find((x) => uidOf(x) === id) ?? null;
    }
    unreadTables.value = list.filter((_, i) => !reads[i]).map((tb) => tb.name);
    truncated.value = list
      .filter((_, i) => reads[i] && reads[i]!.rowCount > reads[i]!.raw.length)
      .map((tb) => tb.name);
    noIndicatorColumn.value = list
      .filter(
        (_, i) =>
          reads[i] && reads[i]!.raw.length > reads[i]!.blank && !reads[i]!.hasIndicatorColumn,
      )
      .map((tb) => tb.name);
    skippedRows.value = list
      .map((tb, i) => ({ table: tb.name, n: reads[i]?.hasIndicatorColumn ? reads[i]!.skipped : 0 }))
      .filter((x) => x.n > 0);
  } catch (e: any) {
    if (mySeq !== loadSeq) return;
    loadError.value = e?.response?.data?.message ?? e?.message ?? t("siem.intel.loadFailed");
  } finally {
    if (mySeq === loadSeq) loading.value = false;
  }
}

/** Stored columns of each list, so appends match the table's schema. */
const tableColumns = ref<Record<string, string[]>>({});

/** Indicator keys already in each list, so adds and imports skip them. */
const existingKeys = computed(() => {
  const map: Record<string, string[]> = {};
  for (const i of indicators.value) (map[i.table] ??= []).push(`${i.type}:${i.indicator}`);
  return map;
});

const now = ref(Date.now());
const liveIndicators = computed(() => indicators.value.filter((i) => !isExpired(i, now.value)));

// ── Sweep ────────────────────────────────────────────────────────────────────
const sweep = useIntelSweep();

async function runSweep() {
  now.value = Date.now();
  windowEndUs.value = now.value * 1000;
  // Expired indicators are kept on the list but not hunted for.
  await sweep.run(orgId.value, liveIndicators.value, windowUs.value);
}

async function refresh() {
  await loadIndicators();
  await runSweep();
}

onMounted(refresh);
watch(orgId, refresh);
function onRangeChange(value: unknown) {
  if (!value || value === range.value) return;
  range.value = value as RangeKey;
  syncUrl();
  void runSweep();
}

const indicatorKey = (i: Pick<Indicator, "type" | "indicator">) => `${i.type}:${i.indicator}`;
const matchByKey = computed(
  () => new Map(sweep.matches.value.map((m) => [indicatorKey(m.indicator), m])),
);

// ── Summary ──────────────────────────────────────────────────────────────────
const expiring = computed(
  () => indicators.value.filter((i) => isExpired(i, now.value) || expiresSoon(i, now.value)).length,
);
const totalHits = computed(() => sweep.matches.value.reduce((sum, m) => sum + m.hits, 0));

const stats = computed<StatItem[]>(() => [
  {
    key: "matched",
    label: t("siem.intel.stat.matched"),
    value: sweep.lastRunAt.value === null ? "—" : sweep.matches.value.length,
    icon: "radar",
    tone: "error",
    max: liveIndicators.value.length || undefined,
    dataTest: "security-intel-stat-matched",
  },
  {
    key: "hits",
    label: t("siem.intel.stat.hits"),
    value: sweep.lastRunAt.value === null ? "—" : formatEventCount(totalHits.value),
    icon: "local-fire-department",
    tone: "orange",
    dataTest: "security-intel-stat-hits",
  },
  {
    key: "indicators",
    label: t("siem.intel.stat.indicators"),
    value: formatEventCount(indicators.value.length),
    icon: "shield",
    tone: "primary",
    dataTest: "security-intel-stat-indicators",
  },
  {
    key: "expiring",
    label: t("siem.intel.stat.expiring"),
    value: expiring.value,
    icon: "schedule",
    tone: "warning",
    dataTest: "security-intel-stat-expiring",
  },
  {
    key: "lists",
    label: t("siem.intel.stat.lists"),
    value: tables.value.length,
    icon: "database",
    tone: "neutral",
    dataTest: "security-intel-stat-lists",
  },
]);

function onStat(key: string) {
  if (key === "matched" || key === "hits") tab.value = "matches";
  else tab.value = "indicators";
  if (key === "expiring") expiryFilter.value = true;
}

// ── Tabs + filters ───────────────────────────────────────────────────────────
const tab = ref<"matches" | "indicators" | "coverage">(
  ["indicators", "coverage"].includes(String(route.query.tab))
    ? (route.query.tab as "indicators" | "coverage")
    : "matches",
);
const search = ref("");
const typeFilter = ref<IndicatorType | "all">("all");
const expiryFilter = ref(false);
watch(tab, () => syncUrl());

const TYPE_ICON: Record<IndicatorType, IconName> = {
  ip: "lan",
  cidr: "lan",
  domain: "language",
  url: "link",
  hash: "tag",
  email: "mail",
};
const typeOptions = computed(() => [
  { label: t("siem.intel.allTypes"), value: "all" },
  ...INDICATOR_TYPES.map((type) => ({ label: t(`siem.intel.type.${type}`), value: type })),
]);

const matchesFor = (i: Indicator) => matchByKey.value.get(indicatorKey(i)) ?? null;
const textMatch = (i: Indicator) => {
  const q = search.value.trim().toLowerCase();
  return (
    !q ||
    i.indicator.includes(q) ||
    i.source.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q) ||
    i.table.includes(q)
  );
};

interface MatchRow {
  id: string;
  match: IndicatorMatch;
}
const matchRows = computed<MatchRow[]>(() =>
  sweep.matches.value
    .filter(
      (m) =>
        textMatch(m.indicator) &&
        (typeFilter.value === "all" || m.indicator.type === typeFilter.value),
    )
    .map((m) => ({ id: `m:${uidOf(m.indicator)}`, match: m })),
);

interface IndicatorRow {
  id: string;
  indicator: Indicator;
  hits: number;
  expired: boolean;
}
const indicatorRows = computed<IndicatorRow[]>(() =>
  indicators.value
    .filter(
      (i) =>
        textMatch(i) &&
        (typeFilter.value === "all" || i.type === typeFilter.value) &&
        (!expiryFilter.value || isExpired(i, now.value) || expiresSoon(i, now.value)),
    )
    .map((i) => ({
      id: uidOf(i),
      indicator: i,
      hits: matchesFor(i)?.hits ?? 0,
      expired: isExpired(i, now.value),
    })),
);

const filtered = computed(
  () => !!search.value.trim() || typeFilter.value !== "all" || expiryFilter.value,
);
function clearFilters() {
  search.value = "";
  typeFilter.value = "all";
  expiryFilter.value = false;
}
function onEmptyAction(id?: string) {
  if (id === "clear-filters") clearFilters();
}

const matchColumns = computed<OTableColumnDef<MatchRow>[]>(() => [
  {
    id: "indicator",
    header: t("siem.intel.col.indicator"),
    accessorFn: (r) => r.match.indicator.indicator,
    meta: { isName: true },
    size: 260,
  },
  {
    id: "type",
    header: t("siem.intel.col.type"),
    accessorFn: (r) => r.match.indicator.type,
    size: 110,
  },
  {
    id: "severity",
    header: t("siem.common.severity"),
    accessorFn: (r) => r.match.indicator.severity,
    size: 110,
  },
  {
    id: "hits",
    header: t("siem.intel.col.hits"),
    accessorFn: (r) => r.match.hits,
    size: 90,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "seenIn",
    header: t("siem.intel.col.seenIn"),
    accessorFn: (r) => r.match.sightings.length,
    size: 240,
  },
  {
    id: "last",
    header: t("siem.intel.col.lastSeen"),
    accessorFn: (r) => r.match.last,
    size: 120,
    sortable: true,
  },
  {
    id: "first",
    header: t("siem.intel.col.firstSeen"),
    accessorFn: (r) => r.match.first,
    size: 120,
    hideable: true,
  },
  {
    id: "source",
    header: t("siem.intel.col.source"),
    accessorFn: (r) => r.match.indicator.source,
    size: 160,
    hideable: true,
  },
]);

const indicatorColumns = computed<OTableColumnDef<IndicatorRow>[]>(() => [
  {
    id: "indicator",
    header: t("siem.intel.col.indicator"),
    accessorFn: (r) => r.indicator.indicator,
    meta: { isName: true },
    size: 260,
  },
  { id: "type", header: t("siem.intel.col.type"), accessorFn: (r) => r.indicator.type, size: 110 },
  {
    id: "severity",
    header: t("siem.common.severity"),
    accessorFn: (r) => r.indicator.severity,
    size: 110,
  },
  {
    id: "confidence",
    header: t("siem.intel.col.confidence"),
    accessorFn: (r) => r.indicator.confidence,
    size: 120,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "hits",
    header: t("siem.intel.col.hits"),
    accessorFn: (r) => r.hits,
    size: 90,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "source",
    header: t("siem.intel.col.source"),
    accessorFn: (r) => r.indicator.source,
    size: 160,
    hideable: true,
  },
  {
    id: "list",
    header: t("siem.intel.col.list"),
    accessorFn: (r) => r.indicator.table,
    size: 160,
    hideable: true,
  },
  {
    id: "added",
    header: t("siem.intel.col.added"),
    accessorFn: (r) => r.indicator.addedAt,
    size: 120,
    hideable: true,
  },
  {
    id: "expires",
    header: t("siem.intel.col.expires"),
    accessorFn: (r) => r.indicator.expiresAt,
    size: 130,
  },
]);

const toneOf = (i: Indicator) => toneOfSigmaLevel(i.severity);

// ── Coverage ─────────────────────────────────────────────────────────────────
/** Why "nothing was seen" may not mean "nothing is there". */
const sweepCaveats = computed(() => {
  const out: string[] = [];
  if (sweep.partial.value) out.push(t("siem.intel.caveat.capped"));
  if (sweep.failed.value) out.push(t("siem.intel.caveat.failed", sweep.failed.value));
  if (sweep.partialResults.value)
    out.push(t("siem.intel.caveat.partial", sweep.partialResults.value));
  const blind = sweep.coverage.value.filter((c) => c.indicators && !c.columns.length);
  if (blind.length) {
    out.push(
      t("siem.intel.caveat.unsearched", {
        types: blind.map((c) => t(`siem.intel.type.${c.type}`)).join(", "),
      }),
    );
  }
  if (cidrCount.value) out.push(t("siem.intel.caveat.cidr", cidrCount.value));
  return out;
});
const cidrCount = computed(() => liveIndicators.value.filter((i) => i.type === "cidr").length);
const blindTypes = computed(() =>
  sweep.coverage.value.filter((c) => c.indicators > 0 && (!c.columns.length || c.skipped.length)),
);

// ── Drawer ───────────────────────────────────────────────────────────────────
// The drawer steps through the table's rows in the order the analyst sees
// them — after its sort — and turns the page when it crosses a boundary.
/** The part of OTable's exposed TanStack instance the drawer needs. */
interface TableHandle {
  table?: NavTable<MatchRow | IndicatorRow>;
}
const matchTable = ref<TableHandle | null>(null);
const indicatorTable = ref<TableHandle | null>(null);
/** Bumped on sort so the step order is recomputed. */
const sortTick = ref(0);
const activeTable = () => (tab.value === "matches" ? matchTable.value : indicatorTable.value);
const rowIndicator = (row: MatchRow | IndicatorRow) =>
  "match" in row ? row.match.indicator : row.indicator;

const drawerList = computed<Indicator[]>(() => {
  void sortTick.value;
  const fallback =
    tab.value === "matches"
      ? matchRows.value.map((r) => r.match.indicator)
      : indicatorRows.value.map((r) => r.indicator);
  const sorted = displayOrder<MatchRow | IndicatorRow>(activeTable()?.table, []);
  return sorted.length === fallback.length ? sorted.map(rowIndicator) : fallback;
});
const selected = ref<Indicator | null>(null);
const drawerTab = ref("sightings");
const drawerIndex = computed(() => {
  if (!selected.value) return null;
  const i = drawerList.value.indexOf(selected.value);
  return i === -1 ? null : i;
});
const selectedRowId = computed(() => (selected.value ? uidOf(selected.value) : ""));
const selectedMatch = computed(() => (selected.value ? matchesFor(selected.value) : null));

function openIndicator(i: Indicator) {
  selected.value = i;
  drawerTab.value = matchesFor(i) ? "sightings" : "details";
  syncUrl();
}
function closeDrawer() {
  selected.value = null;
  syncUrl();
}
function step(delta: number) {
  const current = selected.value;
  if (!current) return;
  const rows: (MatchRow | IndicatorRow)[] =
    tab.value === "matches" ? matchRows.value : indicatorRows.value;
  const next = stepRow(activeTable()?.table, rows, (r) => rowIndicator(r) === current, delta);
  if (next) openIndicator(rowIndicator(next.row));
}

const drawerTabs = computed<RecordTab[]>(() => [
  {
    name: "sightings",
    label: t("siem.intel.drawer.sightings"),
    icon: "stacked-line-chart",
    count: selectedMatch.value?.sightings.length ?? null,
  },
  { name: "details", label: t("siem.intel.drawer.details"), icon: "format-list-bulleted" },
]);

function fmtUs(us: number | null | undefined) {
  if (!us) return "—";
  return new Date(us / 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDate(iso: string) {
  if (!iso) return t("siem.intel.never");
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : iso;
}
function fmtIso(iso: string) {
  if (!iso) return t("siem.intel.never");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : iso;
}

const drawerFacts = computed<RecordFact[]>(() => {
  const i = selected.value;
  if (!i) return [];
  const m = selectedMatch.value;
  return [
    { label: t("siem.intel.col.hits"), value: m ? formatEventCount(m.hits) : "0" },
    { label: t("siem.intel.col.lastSeen"), value: m ? fmtUs(m.last) : t("siem.intel.notSighted") },
    { label: t("siem.intel.col.confidence"), value: `${i.confidence}%` },
    { label: t("siem.intel.col.expires"), value: fmtDate(i.expiresAt) },
  ];
});

const detailRows = computed<KeyValueRow[]>(() => {
  const i = selected.value;
  if (!i) return [];
  const rows: KeyValueRow[] = [
    { key: "indicator", label: t("siem.intel.col.indicator"), value: i.indicator, mono: true },
    { key: "type", label: t("siem.intel.col.type"), value: t(`siem.intel.type.${i.type}`) },
    { key: "severity", label: t("siem.common.severity"), value: t(`siem.severity.${i.severity}`) },
    { key: "confidence", label: t("siem.intel.col.confidence"), value: `${i.confidence}%` },
    { key: "source", label: t("siem.intel.col.source"), value: i.source },
    { key: "description", label: t("siem.intel.col.description"), value: i.description },
    { key: "list", label: t("siem.intel.col.list"), value: i.table, mono: true },
    { key: "added", label: t("siem.intel.col.added"), value: fmtIso(i.addedAt) },
    { key: "expires", label: t("siem.intel.col.expires"), value: fmtIso(i.expiresAt) },
  ];
  return rows.filter((r) => r.value);
});

// Sightings over time, one series per stream·column, same interval as Events.
const SERIES_LIMIT = 6;
const timeline = ref<{ ts: number; counts: Record<string, number> }[]>([]);
const timelineLoading = ref(false);
let timelineSeq = 0;
const timelineSeries = computed(() =>
  (selectedMatch.value?.sightings ?? []).slice(0, SERIES_LIMIT).map((s, i) => ({
    key: `s${i}`,
    label: `${s.stream} · ${s.column}`,
    token: `--color-chart-series-${i + 1}` as `--${string}`,
  })),
);

async function loadTimeline() {
  const mySeq = ++timelineSeq;
  timeline.value = [];
  const m = selectedMatch.value;
  if (!m || m.indicator.type === "cidr") return;
  timelineLoading.value = true;
  const window = windowUs.value;
  const interval = histogramInterval((window.end - window.start) / 1000);
  const buckets = new Map<number, Record<string, number>>();
  await Promise.all(
    m.sightings.slice(0, SERIES_LIMIT).map(async (s, i) => {
      try {
        const res = await searchService.search(
          {
            org_identifier: orgId.value,
            query: {
              query: {
                sql: sightingsSql(
                  s.stream,
                  s.column,
                  m.indicator.type as Exclude<IndicatorType, "cidr">,
                  m.indicator.indicator,
                  interval.sql,
                ),
                start_time: window.start,
                end_time: window.end,
                from: 0,
                size: -1,
              },
            },
            page_type: "logs",
          },
          "ui",
        );
        for (const hit of res.data?.hits ?? []) {
          const ts = histogramKeyToMs(hit.zo_ts);
          if (ts === null) continue;
          const counts = buckets.get(ts) ?? {};
          counts[`s${i}`] = (counts[`s${i}`] ?? 0) + Number(hit.zo_n ?? 0);
          buckets.set(ts, counts);
        }
      } catch {
        /* a series that fails to load is simply absent from the chart */
      }
    }),
  );
  if (mySeq !== timelineSeq) return;
  timeline.value = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, counts]) => ({ ts, counts }));
  timelineLoading.value = false;
}
watch(
  () =>
    selected.value
      ? `${indicatorKey(selected.value)}|${selectedMatch.value?.hits ?? 0}|${range.value}`
      : "",
  () => void loadTimeline(),
);

/** Opens Events on the stream where the indicator was seen, filtered to it. */
function huntInEvents(s: Sighting) {
  router.push({
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream: s.stream,
      period: range.value,
      filters: b64EncodeUnicode(JSON.stringify([{ field: s.column, op: "=", value: s.raw }])) ?? "",
    },
  });
}

const selectedTable = computed(
  () => tables.value.find((tb) => tb.name === selected.value?.table) ?? null,
);

/**
 * Enrichment tables have no row delete, so the list is rewritten without the
 * indicator, every other row and column kept exactly as stored (see
 * threatIntel.removeIndicator). A feed-fed list would be overwritten on its
 * next fetch, so removal is refused there and the analyst is told to fix the
 * feed.
 */
async function removeIndicator() {
  const i = selected.value;
  if (!i || selectedTable.value?.feed) return;
  const ok = await confirm({
    title: t("siem.intel.remove.title"),
    message: t("siem.intel.remove.message", { indicator: i.indicator, table: i.table }),
    confirmLabel: t("siem.intel.remove.confirm"),
  });
  if (!ok) return;
  try {
    const { removed } = await threatIntel.removeIndicator(orgId.value, i);
    toast({
      variant: "success",
      message: t("siem.intel.remove.done", { indicator: i.indicator }, removed),
    });
    closeDrawer();
    await refresh();
  } catch (e: any) {
    const message =
      e instanceof RemoveRefused
        ? e.reason === "partial"
          ? t("siem.intel.remove.tooLarge", { table: i.table, n: formatEventCount(e.rowCount) })
          : t("siem.intel.remove.notFound", { indicator: i.indicator, table: i.table })
        : (e?.response?.data?.message ?? e?.message ?? t("siem.intel.remove.failed"));
    toast({ variant: "error", message });
  }
}

// ── URL ──────────────────────────────────────────────────────────────────────
function urlQuery(): Record<string, string> {
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    period: range.value,
    tab: tab.value,
  };
  if (selected.value) query.indicator = `${indicatorKey(selected.value)}@${selected.value.table}`;
  return query;
}
function syncUrl() {
  const query = urlQuery();
  router.replace({ query });
}
// A link pins the drawer's indicator and the window it was seen in.
// Built from the intended query, not route.fullPath (which lags router.replace).
const shareUrl = computed(() =>
  typeof window === "undefined"
    ? ""
    : `${window.location.origin}${router.resolve({ path: route.path, query: urlQuery() }).href}`,
);

// Reopen a linked indicator once the lists have loaded.
watch(indicators, (list) => {
  const wanted = String(route.query.indicator ?? "");
  if (!wanted || selected.value) return;
  const found = list.find((i) => `${indicatorKey(i)}@${i.table}` === wanted);
  if (found) openIndicator(found);
});

// ── Dialogs ──────────────────────────────────────────────────────────────────
const showAdd = ref(false);
const importMode = ref<"file" | "url" | null>(null);
async function onSaved() {
  await refresh();
}
</script>

<template>
  <OPageLayout
    :title="t('siem.intel.title')"
    :subtitle="t('siem.intel.subtitle')"
    icon="radar"
    bleed
    title-data-test="security-intel-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <OToggleGroup
          :model-value="range"
          data-test="security-intel-range"
          @update:model-value="onRangeChange"
        >
          <OToggleGroupItem v-for="r in RANGES" :key="r.value" :value="r.value" size="sm">
            {{ t(`siem.range.${r.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          variant="outline"
          size="sm"
          icon-left="radar"
          :loading="sweep.running.value"
          :disabled="!liveIndicators.length"
          data-test="security-intel-run-sweep"
          @click="runSweep"
        >
          {{ t("siem.intel.runSweep") }}
        </OButton>
        <ODropdown>
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              icon-left="upload"
              icon-right="expand-more"
              data-test="security-intel-import"
            >
              {{ t("siem.intel.import") }}
            </OButton>
          </template>
          <ODropdownItem
            icon-left="upload-file"
            data-test="security-intel-import-file-item"
            @select="importMode = 'file'"
          >
            {{ t("siem.intel.importFile") }}
          </ODropdownItem>
          <ODropdownItem
            icon-left="link"
            data-test="security-intel-import-url-item"
            @select="importMode = 'url'"
          >
            {{ t("siem.intel.importFeed") }}
          </ODropdownItem>
        </ODropdown>
        <OButton
          variant="primary"
          size="sm"
          icon-left="add"
          data-test="security-intel-add"
          @click="showAdd = true"
        >
          {{ t("siem.intel.add") }}
        </OButton>
      </div>
    </template>

    <!-- First run: nothing to hunt for yet -->
    <div
      v-if="!loading && !tables.length && !loadError"
      class="flex min-h-0 flex-1 items-center justify-center"
    >
      <OEmptyState
        size="hero"
        icon="radar"
        :title="t('siem.intel.empty.title')"
        :description="t('siem.intel.empty.description')"
        :action-label="t('siem.intel.add')"
        action-icon="add"
        :secondary-action-label="t('siem.intel.importCsv')"
        data-test="security-intel-empty"
        @action="showAdd = true"
        @secondary-action="importMode = 'file'"
      />
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <OContent class="border-border-default flex shrink-0 flex-col gap-2 border-b py-3">
        <OStatStrip
          :items="stats"
          :loading="loading && !indicators.length"
          selectable
          :selected-key="null"
          data-test="security-intel-stats"
          @select="onStat"
        />
        <OBanner
          v-if="loadError"
          variant="error-soft"
          icon="error-outline"
          dense
          data-test="security-intel-load-error"
        >
          {{ loadError }}
        </OBanner>
        <div
          v-if="sweep.running.value"
          class="flex items-center gap-3 text-xs"
          data-test="security-intel-sweep-progress"
        >
          <span class="text-text-secondary shrink-0">
            {{ t("siem.intel.sweeping", { done: sweep.done.value, total: sweep.planned.value }) }}
          </span>
          <OProgressBar
            :value="sweep.planned.value ? sweep.done.value / sweep.planned.value : 0"
            size="xs"
            class="flex-1"
          />
        </div>
        <OBanner
          v-if="sweep.partial.value"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-partial"
        >
          {{ t("siem.intel.partial", { n: MAX_SWEEP_QUERIES }) }}
        </OBanner>
        <OBanner
          v-if="sweep.partialResults.value"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-partial-results"
        >
          {{ t("siem.intel.caveat.partial", sweep.partialResults.value) }}
        </OBanner>
        <OBanner
          v-if="sweep.failed.value"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-failed"
        >
          {{ t("siem.intel.failedQueries", sweep.failed.value) }}
        </OBanner>
        <OBanner
          v-if="unreadTables.length"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-unread-tables"
        >
          {{
            t("siem.intel.unreadTables", { lists: unreadTables.join(", ") }, unreadTables.length)
          }}
        </OBanner>
        <OBanner
          v-if="noIndicatorColumn.length"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-no-indicator-column"
        >
          {{
            t(
              "siem.intel.noIndicatorColumn",
              { lists: noIndicatorColumn.join(", ") },
              noIndicatorColumn.length,
            )
          }}
        </OBanner>
        <OBanner
          v-if="skippedRows.length"
          variant="info"
          icon="info-outline"
          dense
          data-test="security-intel-skipped-rows"
        >
          {{
            t("siem.intel.skippedRows", {
              detail: skippedRows.map((x) => `${x.table} (${x.n})`).join(", "),
            })
          }}
        </OBanner>
        <OBanner
          v-if="sweep.unreadStreams.value.length"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-unread-streams"
        >
          {{
            t(
              "siem.intel.unreadStreams",
              { streams: sweep.unreadStreams.value.join(", ") },
              sweep.unreadStreams.value.length,
            )
          }}
        </OBanner>
        <OBanner
          v-if="truncated.length"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-intel-truncated"
        >
          {{
            t("siem.intel.truncated", {
              lists: truncated.join(", "),
              n: formatEventCount(INTEL_READ_LIMIT),
            })
          }}
        </OBanner>
      </OContent>

      <OTabs
        v-model="tab"
        class="border-border-default shrink-0 border-b"
        data-test="security-intel-tabs"
      >
        <OTab name="matches" data-test="security-intel-tab-matches">
          <span class="flex items-center gap-1.5">
            <OIcon name="radar" size="sm" />{{ t("siem.intel.tab.matches") }}
            <span
              v-if="sweep.matches.value.length"
              class="bg-badge-error-soft-bg text-badge-error-soft-text text-2xs rounded-full px-1.5 font-semibold tabular-nums"
              >{{ sweep.matches.value.length }}</span
            >
          </span>
        </OTab>
        <OTab name="indicators" data-test="security-intel-tab-indicators">
          <span class="flex items-center gap-1.5">
            <OIcon name="shield" size="sm" />{{ t("siem.intel.tab.indicators") }}
            <span
              class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
              >{{ indicators.length }}</span
            >
          </span>
        </OTab>
        <OTab name="coverage" data-test="security-intel-tab-coverage">
          <span class="flex items-center gap-1.5">
            <OIcon name="fact-check" size="sm" />{{ t("siem.intel.tab.coverage") }}
            <OIcon
              v-if="blindTypes.length || cidrCount"
              name="warning-amber"
              size="xs"
              class="text-status-warning-text"
            />
          </span>
        </OTab>
      </OTabs>

      <!-- ── Matches ─────────────────────────────────────────────────────── -->
      <OTable
        v-if="tab === 'matches'"
        ref="matchTable"
        :data="matchRows"
        :columns="matchColumns"
        row-key="id"
        :loading="(loading || sweep.running.value) && !sweep.matches.value.length"
        :error="loadError || null"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-intel-matches"
        :column-visibility="{ first: false, source: false }"
        :get-row-status-color="(r: MatchRow) => severityRailColor(toneOf(r.match.indicator))"
        :row-class="(r: MatchRow) => (r.id === selectedRowId ? '!bg-table-row-selected-bg' : '')"
        class="min-h-0 flex-1"
        data-test="security-intel-matches-table"
        @sort-change="sortTick++"
        @row-click="(r: MatchRow) => openIndicator(r.match.indicator)"
      >
        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <OSearchInput
              v-model="search"
              :placeholder="t('siem.intel.search')"
              class="max-w-80 flex-1"
              data-test="security-intel-search"
            />
            <div class="w-44 shrink-0">
              <OSelect
                v-model="typeFilter"
                :options="typeOptions"
                data-test="security-intel-type-filter"
              />
            </div>
            <span v-if="sweep.lastRunAt.value" class="text-text-secondary text-xs">
              {{
                t(
                  "siem.intel.sweptAcross",
                  { n: sweep.streams.value.length },
                  sweep.streams.value.length,
                )
              }}
            </span>
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading || sweep.running.value"
            data-test="security-intel-refresh"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.intel.refresh')" />
          </OButton>
        </template>
        <template #cell-indicator="{ row }">
          <span class="text-text-heading truncate font-mono text-xs font-semibold">{{
            row.match.indicator.indicator
          }}</span>
        </template>
        <template #cell-type="{ row }">
          <OTag variant="default-soft" :icon="TYPE_ICON[row.match.indicator.type]" size="xs">
            {{ t(`siem.intel.type.${row.match.indicator.type}`) }}
          </OTag>
        </template>
        <template #cell-severity="{ row }">
          <OTag
            type="severity"
            :value="severityTagValue(toneOf(row.match.indicator))"
            :label="t(toneLabelKey(toneOf(row.match.indicator)))"
            size="xs"
          />
        </template>
        <template #cell-hits="{ row }">
          <span class="text-text-heading font-semibold tabular-nums">{{
            formatEventCount(row.match.hits)
          }}</span>
        </template>
        <template #cell-seenIn="{ row }">
          <div class="flex min-w-0 items-center gap-1 overflow-hidden">
            <OTag
              v-for="s in row.match.sightings.slice(0, 2)"
              :key="`${s.stream}.${s.column}`"
              variant="primary-soft"
              shape="rounded"
              size="xs"
              class="font-mono"
              >{{ s.stream }}·{{ s.column }}</OTag
            >
            <span v-if="row.match.sightings.length > 2" class="text-text-secondary text-xs">
              +{{ row.match.sightings.length - 2 }}
            </span>
          </div>
        </template>
        <template #cell-last="{ row }">
          <OTimeCell :value="row.match.last" unit="us" />
        </template>
        <template #cell-first="{ row }">
          <OTimeCell :value="row.match.first" unit="us" />
        </template>
        <template #error="{ message }">
          <OEmptyState
            size="block"
            icon="error-outline"
            :title="t('siem.intel.loadFailed')"
            :description="message"
          />
        </template>
        <template #empty>
          <OEmptyState
            v-if="!loading && !sweep.running.value"
            size="block"
            icon="task-alt"
            :title="t('siem.intel.noMatches.title')"
            :description="
              [
                t('siem.intel.noMatches.description', {
                  n: formatEventCount(liveIndicators.length),
                  streams: sweep.streams.value.length,
                  range: t(`siem.range.${range}`),
                }),
                ...sweepCaveats,
              ].join(' ')
            "
            :filtered="filtered"
            @action="onEmptyAction"
          />
        </template>
      </OTable>

      <!-- ── Indicators ──────────────────────────────────────────────────── -->
      <OTable
        v-else-if="tab === 'indicators'"
        ref="indicatorTable"
        :data="indicatorRows"
        :columns="indicatorColumns"
        row-key="id"
        :loading="loading && !indicators.length"
        :error="loadError || null"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-intel-indicators"
        :column-visibility="{ added: false, list: false }"
        :get-row-status-color="
          (r: IndicatorRow) =>
            r.expired
              ? severityRailColor('unknown')
              : r.hits
                ? severityRailColor(toneOf(r.indicator))
                : undefined
        "
        :row-class="
          (r: IndicatorRow) =>
            r.id === selectedRowId
              ? '!bg-table-row-selected-bg'
              : r.expired
                ? '!bg-surface-panel'
                : ''
        "
        class="min-h-0 flex-1"
        data-test="security-intel-indicators-table"
        @sort-change="sortTick++"
        @row-click="(r: IndicatorRow) => openIndicator(r.indicator)"
      >
        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <OSearchInput
              v-model="search"
              :placeholder="t('siem.intel.search')"
              class="max-w-80 flex-1"
              data-test="security-intel-indicator-search"
            />
            <div class="w-44 shrink-0">
              <OSelect
                v-model="typeFilter"
                :options="typeOptions"
                data-test="security-intel-indicator-type-filter"
              />
            </div>
            <OButton
              :variant="expiryFilter ? 'outline-primary' : 'outline'"
              size="sm"
              icon-left="schedule"
              data-test="security-intel-expiring-filter"
              @click="expiryFilter = !expiryFilter"
            >
              {{ t("siem.intel.expiringOnly") }}
            </OButton>
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-intel-indicators-refresh"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.intel.refresh')" />
          </OButton>
        </template>
        <template #cell-indicator="{ row }">
          <span
            class="truncate font-mono text-xs font-semibold"
            :class="row.expired ? 'text-text-secondary line-through' : 'text-text-heading'"
            >{{ row.indicator.indicator }}</span
          >
        </template>
        <template #cell-type="{ row }">
          <OTag variant="default-soft" :icon="TYPE_ICON[row.indicator.type]" size="xs">
            {{ t(`siem.intel.type.${row.indicator.type}`) }}
          </OTag>
        </template>
        <template #cell-severity="{ row }">
          <OTag
            type="severity"
            :value="severityTagValue(toneOf(row.indicator))"
            :label="t(toneLabelKey(toneOf(row.indicator)))"
            size="xs"
          />
        </template>
        <template #cell-confidence="{ row }">
          <span class="tabular-nums">{{ row.indicator.confidence }}%</span>
        </template>
        <template #cell-hits="{ row }">
          <span v-if="row.hits" class="text-status-error-text font-semibold tabular-nums">{{
            formatEventCount(row.hits)
          }}</span>
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #cell-list="{ row }">
          <span class="text-text-secondary truncate font-mono text-xs">{{
            row.indicator.table
          }}</span>
        </template>
        <template #cell-added="{ row }">
          <OTimeCell :value="row.indicator.addedAt" unit="iso" />
        </template>
        <template #cell-expires="{ row }">
          <OTag v-if="row.expired" variant="warning-soft" size="xs">{{
            t("siem.intel.expired")
          }}</OTag>
          <OTimeCell
            v-else
            :value="row.indicator.expiresAt"
            unit="iso"
            mode="date"
            :empty-label="t('siem.intel.never')"
          />
        </template>
        <template #error="{ message }">
          <OEmptyState
            size="block"
            icon="error-outline"
            :title="t('siem.intel.loadFailed')"
            :description="message"
          />
        </template>
        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="shield"
            :title="t('siem.intel.noIndicators')"
            :filtered="filtered"
            @action="onEmptyAction"
          />
        </template>
      </OTable>

      <!-- ── Coverage: what a sweep could and could not see ──────────────── -->
      <div v-else class="min-h-0 flex-1 overflow-y-auto" data-test="security-intel-coverage">
        <OContent class="flex flex-col gap-3 py-4">
          <OBanner
            v-if="cidrCount"
            variant="info"
            icon="info-outline"
            dense
            data-test="security-intel-cidr-note"
          >
            {{ t("siem.intel.cidrNote", cidrCount) }}
          </OBanner>
          <p class="text-text-secondary text-xs">
            {{ t("siem.intel.coverageHint", { n: sweep.streams.value.length }) }}
          </p>
          <div
            v-for="c in sweep.coverage.value"
            :key="c.type"
            class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
            :data-test="`security-intel-coverage-${c.type}`"
          >
            <div class="flex items-center gap-2">
              <OIcon :name="TYPE_ICON[c.type]" size="sm" class="text-text-secondary" />
              <span class="text-text-heading text-sm font-semibold">{{
                t(`siem.intel.type.${c.type}`)
              }}</span>
              <span class="text-text-secondary text-xs">{{
                t("siem.intel.indicatorCount", c.indicators)
              }}</span>
              <div class="flex-1" />
              <OTag v-if="c.skipped.length" variant="warning-soft" size="xs">
                {{ t("siem.intel.columnsSkipped", c.skipped.length) }}
              </OTag>
              <OTag v-if="c.columns.length" variant="success-soft" size="xs">
                {{ t("siem.intel.columnsSearched", c.columns.length) }}
              </OTag>
              <OTag v-else-if="!c.skipped.length" variant="warning-soft" size="xs">{{
                t("siem.intel.blind")
              }}</OTag>
            </div>
            <div v-if="c.columns.length" class="flex flex-wrap gap-1">
              <OTag
                v-for="col in c.columns"
                :key="`${col.stream}.${col.column}`"
                variant="default-soft"
                shape="rounded"
                size="xs"
                class="font-mono"
                >{{ col.stream }}·{{ col.column }}</OTag
              >
            </div>
            <div v-if="c.skipped.length" class="flex flex-col gap-1">
              <span class="text-status-warning-text text-xs">{{
                t("siem.intel.skippedHint")
              }}</span>
              <div class="flex flex-wrap gap-1">
                <OTag
                  v-for="col in c.skipped"
                  :key="`${col.stream}.${col.column}`"
                  variant="warning-soft"
                  shape="rounded"
                  size="xs"
                  class="font-mono"
                  >{{ col.stream }}·{{ col.column }}</OTag
                >
              </div>
            </div>
            <p v-if="!c.columns.length && !c.skipped.length" class="text-text-secondary text-xs">
              {{ t("siem.intel.blindHint") }}
            </p>
          </div>
          <OEmptyState
            v-if="!sweep.coverage.value.length && !sweep.running.value"
            size="inline"
            icon="fact-check"
            :title="t('siem.intel.noCoverage')"
          />
        </OContent>
      </div>
    </div>

    <!-- ── Indicator drawer ──────────────────────────────────────────────── -->
    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="selected.indicator"
      :eyebrow="t('siem.intel.drawer.eyebrow', { type: t(`siem.intel.type.${selected.type}`) })"
      :subtitle="selected.description || selected.source"
      :icon="TYPE_ICON[selected.type]"
      :tone="toneOf(selected)"
      :facts="drawerFacts"
      :tabs="drawerTabs"
      :index="drawerIndex"
      :total="drawerList.length"
      :share-url="shareUrl"
      data-test="security-intel-drawer"
      @close="closeDrawer"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          type="severity"
          :value="severityTagValue(toneOf(selected))"
          :label="t(toneLabelKey(toneOf(selected)))"
          size="sm"
        />
        <OTag variant="default-soft" :icon="TYPE_ICON[selected.type]" size="sm">
          {{ t(`siem.intel.type.${selected.type}`) }}
        </OTag>
        <OTag v-if="selectedMatch" variant="error-soft" icon="radar" size="sm">
          {{
            t("siem.intel.sighted", { n: formatEventCount(selectedMatch.hits) }, selectedMatch.hits)
          }}
        </OTag>
        <OTag v-else variant="success-soft" icon="task-alt" size="sm">
          {{ t("siem.intel.notSightedIn", { range: t(`siem.range.${range}`) }) }}
        </OTag>
        <OTag v-if="isExpired(selected, now)" variant="warning-soft" icon="schedule" size="sm">
          {{ t("siem.intel.expired") }}
        </OTag>
        <OTag v-if="selected.source" variant="primary-soft" size="sm">{{ selected.source }}</OTag>
      </template>

      <template #tab-sightings>
        <template v-if="selectedMatch">
          <div class="border-border-default rounded-surface flex flex-col gap-2 border p-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-text-heading text-sm font-semibold">{{
                t("siem.intel.drawer.overTime")
              }}</span>
              <span class="text-text-secondary text-xs">{{ t(`siem.range.${range}`) }}</span>
            </div>
            <div class="h-40">
              <SecuritySeverityChart
                :buckets="timeline"
                :series="timelineSeries"
                :loading="timelineLoading"
                :min="Math.floor(windowUs.start / 1000)"
                :max="Math.ceil(windowUs.end / 1000)"
                data-test="security-intel-drawer-chart"
              />
            </div>
          </div>
          <div class="border-border-default rounded-surface overflow-hidden border">
            <div
              v-for="s in selectedMatch.sightings"
              :key="`${s.stream}.${s.column}`"
              class="border-border-subtle flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
              :data-test="`security-intel-sighting-${s.stream}-${s.column}`"
            >
              <OIcon name="database" size="sm" class="text-text-secondary shrink-0" />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-text-heading truncate font-mono text-xs font-semibold">{{
                  s.stream
                }}</span>
                <span class="text-text-secondary text-2xs truncate font-mono">{{ s.column }}</span>
              </div>
              <div class="flex shrink-0 flex-col items-end">
                <span class="text-text-heading text-sm font-semibold tabular-nums">{{
                  formatEventCount(s.count)
                }}</span>
                <span class="text-text-secondary text-2xs"
                  >{{ fmtUs(s.first) }} → {{ fmtUs(s.last) }}</span
                >
              </div>
              <OButton
                variant="ghost-primary"
                size="xs"
                icon-right="arrow-forward"
                :data-test="`security-intel-hunt-${s.stream}-${s.column}`"
                @click="huntInEvents(s)"
              >
                {{ t("siem.intel.drawer.hunt") }}
              </OButton>
            </div>
          </div>
        </template>
        <OEmptyState
          v-else
          size="block"
          icon="task-alt"
          :title="t('siem.intel.drawer.notSeenTitle')"
          :description="
            selected.type === 'cidr'
              ? t('siem.intel.drawer.cidrNotSwept')
              : t('siem.intel.drawer.notSeen', {
                  streams: sweep.streams.value.length,
                  range: t(`siem.range.${range}`),
                })
          "
        />
      </template>

      <template #tab-details>
        <SecurityKeyValues :rows="detailRows" data-test="security-intel-drawer-details" />
      </template>

      <template #footer>
        <OButton
          variant="outline-destructive"
          size="sm-action"
          icon-left="delete"
          :disabled="!!selectedTable?.feed"
          data-test="security-intel-drawer-remove"
          @click="removeIndicator"
        >
          {{ t("siem.intel.remove.action") }}
          <OTooltip v-if="selectedTable?.feed" :content="t('siem.intel.remove.feedHint')" />
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="manage-search"
          :disabled="!selectedMatch"
          data-test="security-intel-drawer-hunt"
          @click="selectedMatch && huntInEvents(selectedMatch.sightings[0])"
        >
          {{ t("siem.intel.drawer.huntTop") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>

    <SecurityIntelAddDialog
      v-model:open="showAdd"
      :tables="tables"
      :existing-keys="existingKeys"
      :table-columns="tableColumns"
      @saved="onSaved"
    />
    <SecurityIntelImportDialog
      v-if="importMode"
      :open="!!importMode"
      :mode="importMode"
      :tables="tables"
      :existing-keys="existingKeys"
      :table-columns="tableColumns"
      @update:open="(v: boolean) => !v && (importMode = null)"
      @saved="onSaved"
    />
  </OPageLayout>
</template>
