<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- The server counts each stream and kind with one GROUP BY; the same value in two streams is one entity. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import SecurityRiskGraph from "@/components/security/SecurityRiskGraph.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import SecurityNotices, { type SecurityNotice } from "@/components/security/SecurityNotices.vue";
import SecurityAccessLock from "@/components/security/SecurityAccessLock.vue";
import { forbiddenReason, isForbiddenError } from "@/composables/security/useSecurityAccess";
import { failedRequests, viewDenial } from "@/composables/useAccessStore";
import { useSecurityStreamPlans } from "@/composables/security/useSecurityStreamPlans";
import { useTableRowNavigation } from "@/composables/security/useTableRowNavigation";
import { ENTITY_KINDS, type EntityKind } from "@/utils/security/streamPlan";
import { histogramInterval, histogramKeyToMs } from "@/utils/security/eventQuery";
import { huntLinkQuery } from "@/utils/security/huntLink";
import securityInvestigate, {
  type EntitiesResponse,
  type EntityRow,
  type EntitySignal,
  type NodeCase,
  type RiskGraph,
  type ScoredEntity,
} from "@/services/securityInvestigate";
import { severityRailColor } from "@/utils/security/severity";
import { b64EncodeUnicode, formatCompactCount, formatEventCount } from "@/utils/formatters";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

const RANGES = [
  { value: "1h", minutes: 60 },
  { value: "24h", minutes: 1440 },
  { value: "7d", minutes: 10080 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
type SignalFilter = EntitySignal | "all";

const q = route.query;
const kind = ref<EntityKind>(
  ENTITY_KINDS.includes(q.kind as EntityKind) ? (q.kind as EntityKind) : "user",
);
const range = ref<RangeKey>(
  RANGES.some((r) => r.value === q.period) ? (q.period as RangeKey) : "24h",
);
const search = ref(q.q ? String(q.q) : "");
const signalFilter = ref<SignalFilter>("all");
const pendingEntity = ref<string | null>(q.entity ? String(q.entity) : null);

const windowEndUs = ref(Date.now() * 1000);
const windowUs = computed(() => RANGES.find((r) => r.value === range.value)!.minutes * 60_000_000);

const view = ref<"table" | "graph">("table");
const VIEWS = [
  { value: "table" as const, icon: "list" },
  { value: "graph" as const, icon: "share" },
];
const windowStartUs = computed(() => windowEndUs.value - windowUs.value);

function syncUrl() {
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    kind: kind.value,
    period: range.value,
  };
  if (search.value.trim()) query.q = search.value.trim();
  if (selected.value) query.entity = selected.value.value;
  router.replace({ query });
}

const {
  plans,
  names: streamNames,
  unreadable,
  loading: plansLoading,
  error: plansError,
  failure: plansFailure,
  load: loadPlans,
} = useSecurityStreamPlans();

/** Rows the server reads per stream and kind; past this the page says it is showing the top. */
const ENTITY_LIMIT = 500;
type StreamStatus = "loading" | "done" | "failed";

const result = shallowRef<EntitiesResponse | null>(null);
/** The entity request itself failed; per-stream failures are in the result. */
const runError = ref("");
const runFailure = shallowRef<unknown>(null);
/** A refusal from the plan stage or the entity read; the server's 403 names the streams it could not read. */
const refusal = computed(
  () => [plansFailure.value, runFailure.value].find((e) => isForbiddenError(e)) ?? null,
);
const accessDenials = computed(() =>
  refusal.value ? [viewDenial("streams", "list", failedRequests(refusal.value))] : [],
);
const lastRunAt = ref<number | null>(null);
/** Some run has answered, so the table has something to show. */
const answered = ref(false);
/** A refresh is between its start and its answer, plan stage included. */
const running = ref(false);
const loading = computed(() => running.value || plansLoading.value);
let seq = 0;
let controller: AbortController | null = null;
/** Large streams the user chose to read over the whole window; reset with the range. */
const fullWindow = new Set<string>();

const rowsByKind = computed<Record<EntityKind, ScoredEntity[]>>(() => ({
  user: result.value?.user.rows ?? [],
  ip: result.value?.ip.rows ?? [],
  host: result.value?.host.rows ?? [],
}));
const cappedKinds = computed(() => new Set(ENTITY_KINDS.filter((k) => result.value?.[k].capped)));
const failedStreams = computed(() =>
  [
    ...new Set([
      ...unreadable.value,
      ...(result.value?.streams.filter((s) => s.failed).map((s) => s.stream) ?? []),
    ]),
  ].sort(),
);
/** Streams whose answer the engine marked partial or whose functions errored. */
const partialStreams = computed(() =>
  (result.value?.streams.filter((s) => s.partial).map((s) => s.stream) ?? []).sort(),
);
const streamStatus = computed<Record<string, StreamStatus>>(() => {
  const status: Record<string, StreamStatus> = {};
  for (const s of result.value?.streams ?? []) status[s.stream] = s.failed ? "failed" : "done";
  if (running.value) for (const plan of plans.value) status[plan.stream] = "loading";
  for (const name of unreadable.value) status[name] = "failed";
  return status;
});
const limitedStreams = computed(() =>
  (result.value?.streams ?? [])
    .filter((s) => s.limitedRows != null)
    .map((s) => ({ stream: s.stream, rows: s.limitedRows! }))
    .sort((a, b) => a.stream.localeCompare(b.stream)),
);

function entitiesRequest() {
  return {
    startTime: windowStartUs.value,
    endTime: windowEndUs.value,
    plans: plans.value,
    fullWindow: [...fullWindow],
  };
}

/** Reads every planned stream's entities; the server merges and scores them. */
async function runEntities(mine: number, signal: AbortSignal) {
  try {
    const res = await securityInvestigate.entities(orgId.value, entitiesRequest(), signal);
    if (mine !== seq) return;
    result.value = res.data;
    runError.value = "";
    runFailure.value = null;
    answered.value = true;
  } catch (e: any) {
    if (mine !== seq || signal.aborted) return;
    runFailure.value = e;
    runError.value = e?.response?.data?.message ?? e?.message ?? "";
  }
}

async function refresh() {
  if (!orgId.value) return;
  const mine = ++seq;
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  windowEndUs.value = Date.now() * 1000;
  answered.value = false;
  running.value = true;
  runFailure.value = null;
  await loadPlans(orgId.value, windowStartUs.value, windowEndUs.value, { signal: ctrl.signal });
  if (mine !== seq) return;
  if (plans.value.length) await runEntities(mine, ctrl.signal);
  else result.value = null;
  if (mine !== seq) return;
  running.value = false;
  lastRunAt.value = Date.now();
  if (pendingEntity.value) restorePending();
  else reopenSelected();
  if (view.value === "graph") void loadGraph();
}

// ── Risk graph: real co-occurrence and SIEM cases only ──────────────────────
const riskGraph = shallowRef<RiskGraph>({ nodes: [], edges: [], total: 0 });
const graphLoading = ref(false);
const graphFailed = ref<string[]>([]);
let graphSeq = 0;

async function loadGraph() {
  if (!orgId.value || plansLoading.value) return;
  const mine = ++graphSeq;
  graphLoading.value = true;
  try {
    const res = await securityInvestigate.graph(orgId.value, entitiesRequest(), controller?.signal);
    if (mine !== graphSeq) return;
    riskGraph.value = res.data;
    graphFailed.value = res.data.failedStreams;
  } catch {
    if (mine !== graphSeq) return;
    graphFailed.value = plans.value.map((p) => p.stream).sort();
  } finally {
    if (mine === graphSeq) graphLoading.value = false;
  }
}

watch(view, (v) => {
  if (v === "graph" && !graphLoading.value) void loadGraph();
});

const notices = computed<SecurityNotice[]>(() => {
  const out: SecurityNotice[] = [];
  const partial = [
    cappedKinds.value.has(kind.value) ? t("siem.entities.capped", { n: ENTITY_LIMIT }) : "",
    failedStreams.value.length
      ? t("siem.entities.failedStreams", { streams: failedStreams.value.join(", ") })
      : "",
    partialStreams.value.length
      ? t("siem.entities.partialStreams", { streams: partialStreams.value.join(", ") })
      : "",
  ].filter(Boolean);
  if (view.value === "graph" && graphFailed.value.length) {
    partial.push(t("siem.entities.failedStreams", { streams: graphFailed.value.join(", ") }));
  }
  if (partial.length) {
    out.push({
      key: "partial",
      tone: "warning",
      text: partial.join(" "),
      dataTest: "security-entities-partial",
    });
  }
  const limited = limitedStreams.value;
  if (limited.length) {
    const vars = { window: t(`siem.range.${range.value}`), slice: t("siem.range.1h") };
    out.push({
      key: "limited",
      tone: "info",
      text:
        limited.length === 1
          ? t("siem.entities.limited", {
              ...vars,
              stream: limited[0].stream,
              rows: formatCompactCount(Math.round(limited[0].rows)),
            })
          : t("siem.entities.limitedMany", {
              ...vars,
              n: limited.length,
              streams: limited
                .map((l) => `${l.stream} (~${formatCompactCount(Math.round(l.rows))})`)
                .join(", "),
            }),
      actionLabel: t("siem.entities.runFull"),
      onAction: () => limited.forEach((l) => void runFullWindow(l.stream)),
      dataTest: "security-entities-limited",
    });
  }
  return out;
});

/** Re-reads one large stream over the whole window instead of its last hour. */
async function runFullWindow(stream: string) {
  if (!controller || plansLoading.value || running.value) return;
  fullWindow.add(stream);
  const mine = ++seq;
  running.value = true;
  await runEntities(mine, controller.signal);
  if (mine !== seq) return;
  running.value = false;
  lastRunAt.value = Date.now();
  reopenSelected();
}

/** After a reload the open drawer must show the new window's numbers, or close. */
function reopenSelected() {
  if (!selected.value) return;
  const row = allRows.value.find((r) => r.value === selected.value!.value);
  if (row) openEntity(row);
  else closeDrawer();
}

onMounted(() => void refresh());
onBeforeUnmount(() => {
  seq += 1;
  graphSeq += 1;
  detailSeq += 1;
  controller?.abort();
  detailController?.abort();
});
watch(orgId, () => {
  fullWindow.clear();
  void refresh();
});

function onRange(value: unknown) {
  if (!value || value === range.value) return;
  range.value = value as RangeKey;
  analytics.track("security_time_range_changed", { view: "entities", range: range.value });
  fullWindow.clear();
  syncUrl();
  void refresh();
}
function onKind(value: string | number) {
  kind.value = value as EntityKind;
  analytics.track("security_tab_switched", { view: "entities", tab: kind.value });
  signalFilter.value = "all";
  closeDrawer();
  syncUrl();
}
watch(search, () => syncUrl());

type Row = ScoredEntity;

/** Peer count that counts as unusually spread out for this kind, relative to its peers. */
const spreadAt = computed(() => result.value?.[kind.value].spreadAt ?? 5);

/** Failure share over the events that could have reported one. */
const failureRate = (r: EntityRow) => (r.failureEvents ? r.failures / r.failureEvents : 0);

// A stream still loading may hold the events that keep a rate or spread under its threshold.
const allRows = computed<Row[]>(() =>
  rowsByKind.value[kind.value].map((r) =>
    loading.value ? { ...r, signals: [], tone: "info" as const } : r,
  ),
);

const filteredRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return allRows.value.filter(
    (r) =>
      (signalFilter.value === "all" || r.signals.includes(signalFilter.value)) &&
      (!needle || [r.value, ...r.aliases].some((v) => v.toLowerCase().includes(needle))),
  );
});

const KIND_ICON: Record<EntityKind, IconName> = { user: "person", ip: "lan", host: "computer" };
const PEER_LABEL: Record<EntityKind, string> = { user: "ips", ip: "users", host: "users" };

const columns = computed<OTableColumnDef<Row>[]>(() => [
  {
    id: "value",
    header: t(`siem.entities.kind.${kind.value}`),
    accessorKey: "value",
    meta: { isName: true },
    size: 240,
  },
  { id: "signals", header: t("siem.entities.col.signals"), accessorKey: "signals", size: 220 },
  {
    id: "events",
    header: t("siem.entities.col.events"),
    accessorKey: "events",
    size: 100,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "failures",
    header: t("siem.entities.col.failures"),
    accessorFn: (r: Row) => failureRate(r),
    size: 170,
    sortable: true,
  },
  {
    id: "peers",
    header: t(`siem.entities.col.peers.${PEER_LABEL[kind.value]}`),
    accessorKey: "peers",
    size: 190,
    sortable: true,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "streams",
    header: t("siem.entities.col.streams"),
    accessorFn: (r: Row) => r.streams.length,
    size: 160,
    hideable: true,
  },
  {
    id: "firstSeen",
    header: t("siem.entities.col.firstSeen"),
    accessorKey: "firstSeen",
    size: 120,
    sortable: true,
    hideable: true,
  },
  {
    id: "lastSeen",
    header: t("siem.entities.col.lastSeen"),
    accessorKey: "lastSeen",
    size: 120,
    sortable: true,
  },
]);

const counts = computed(() => {
  const c: Record<EntitySignal, number> = {
    failures: 0,
    fail_then_success: 0,
    open_case: 0,
    spread: 0,
    external: 0,
  };
  for (const r of allRows.value) for (const s of r.signals) c[s] += 1;
  return c;
});
const stats = computed<StatItem[]>(() => {
  const items: StatItem[] = [
    {
      key: "failures",
      label: t("siem.entities.signal.failures"),
      value: counts.value.failures,
      icon: "error-outline",
      tone: "orange",
      max: allRows.value.length || undefined,
      dataTest: "security-entities-stat-failures",
    },
    {
      key: "spread",
      label: t(`siem.entities.signal.spread.${kind.value}`),
      value: counts.value.spread,
      icon: "hub",
      tone: "warning",
      max: allRows.value.length || undefined,
      dataTest: "security-entities-stat-spread",
    },
  ];
  if (kind.value === "ip") {
    items.push({
      key: "external",
      label: t("siem.entities.signal.external"),
      value: counts.value.external,
      icon: "language",
      tone: "blue",
      max: allRows.value.length || undefined,
      dataTest: "security-entities-stat-external",
    });
  }
  items.push({
    key: "all",
    label: t(`siem.entities.all.${kind.value}`),
    value: allRows.value.length,
    icon: KIND_ICON[kind.value],
    tone: "neutral",
    dataTest: "security-entities-stat-all",
  });
  return items;
});
function onStat(key: string) {
  signalFilter.value = key === "all" || signalFilter.value === key ? "all" : (key as EntitySignal);
}

/** The server's failure-signal bar, for the chip's explanation. */
const FAILURE_SIGNAL = { ratePct: 20, minFailures: 5 };

const SIGNAL_TAG: Record<EntitySignal, BadgeVariant> = {
  failures: "error-soft",
  fail_then_success: "error-soft",
  open_case: "orange-soft",
  spread: "amber-soft",
  external: "blue-soft",
};
function signalHint(sig: EntitySignal): I18nText {
  if (sig === "failures")
    return t("siem.entities.signalHint.failures", {
      rate: FAILURE_SIGNAL.ratePct,
      n: FAILURE_SIGNAL.minFailures,
    });
  if (sig === "fail_then_success")
    return t("siem.entities.signalHint.fail_then_success", { n: FAILURE_SIGNAL.minFailures });
  if (sig === "open_case") return t("siem.entities.signalHint.open_case");
  if (sig === "spread")
    return t(`siem.entities.signalHint.spread.${kind.value}`, { n: spreadAt.value });
  return t("siem.entities.signalHint.external");
}

const pct = (r: EntityRow) => Math.round(failureRate(r) * 100);

const selected = ref<Row | null>(null);
const drawerTab = ref("activity");
// OTable is generic, so its instance type is taken structurally: only `table` is used.
const tableRef = ref<{ table?: unknown } | null>(null);
const nav = useTableRowNavigation<Row>(tableRef, filteredRows, (r) => r.value);
const drawerIndex = nav.index;
const drawerTotal = ref(0);
function relocate() {
  nav.locate(selected.value);
  drawerTotal.value = nav.total();
}
watch(filteredRows, () => void nextTick(relocate));

function openEntity(row: Row) {
  if (!selected.value) analytics.track("security_detail_opened", { view: "entities" });
  selected.value = row;
  syncUrl();
  relocate();
  void loadDetail(row);
}
function closeDrawer() {
  if (!selected.value) return;
  selected.value = null;
  syncUrl();
}
function step(delta: number) {
  const next = nav.neighbour(selected.value, delta);
  if (next) openEntity(next);
}
function onGraphNodeSelect(nodeKind: EntityKind, value: string) {
  pivotTo(nodeKind, value);
}
/** Opens the entity named in the URL once rows are in. */
function restorePending() {
  if (!pendingEntity.value) return;
  const row = allRows.value.find((r) => r.value === pendingEntity.value);
  pendingEntity.value = null;
  if (row) openEntity(row);
  else syncUrl();
}

/** Jumps to a related value as its own entity (kind switches with it). */
function pivotTo(otherKind: EntityKind, value: string) {
  kind.value = otherKind;
  signalFilter.value = "all";
  const row = allRows.value.find((r) => r.value === value);
  if (row) openEntity(row);
  else {
    selected.value = null;
    search.value = value;
    syncUrl();
  }
}

// Built from the intended query: window.location may lag router.replace.
const shareUrl = computed(() => {
  if (!selected.value || typeof window === "undefined") return "";
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    kind: kind.value,
    period: range.value,
    entity: selected.value.value,
  };
  return new URL(
    router.resolve({ path: route.path, query }).href,
    window.location.origin,
  ).toString();
});

const timeline = ref<{ ts: number; counts: Record<string, number> }[]>([]);
const related = ref<Record<EntityKind, { value: string; n: number; fail: number }[]>>({
  user: [],
  ip: [],
  host: [],
});
const cases = ref<NodeCase[]>([]);
const detailLoading = ref(false);
/** Streams whose drawer queries failed; shown in the drawer, not swallowed. */
const detailFailed = ref<string[]>([]);
let detailSeq = 0;
let detailController: AbortController | null = null;

async function loadDetail(row: Row) {
  const mine = ++detailSeq;
  detailController?.abort();
  const { signal } = (detailController = new AbortController());
  detailLoading.value = true;
  timeline.value = [];
  related.value = { user: [], ip: [], host: [] };
  cases.value = [];
  const start = windowStartUs.value;
  const end = windowEndUs.value;
  try {
    const res = await securityInvestigate.detail(
      orgId.value,
      {
        startTime: start,
        endTime: end,
        plans: plans.value.filter((p) => row.streams.includes(p.stream)),
        fullWindow: [...fullWindow],
        kind: kind.value,
        values: row.aliases.length ? row.aliases : [row.value],
        interval: histogramInterval((end - start) / 1000).sql,
      },
      signal,
    );
    if (mine !== detailSeq) return;
    const buckets = new Map<number, { ok: number; failed: number }>();
    for (const b of res.data.timeline) {
      const ts = histogramKeyToMs(b.key);
      if (ts === null) continue;
      const cur = buckets.get(ts) ?? { ok: 0, failed: 0 };
      buckets.set(ts, { ok: cur.ok + b.ok, failed: cur.failed + b.failed });
    }
    timeline.value = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, c]) => ({ ts, counts: { ok: c.ok, failed: c.failed } }));
    related.value = {
      user: res.data.related.user ?? [],
      ip: res.data.related.ip ?? [],
      host: res.data.related.host ?? [],
    };
    detailFailed.value = res.data.failedStreams;
    cases.value = res.data.cases ?? [];
  } catch {
    if (mine !== detailSeq || signal.aborted) return;
    detailFailed.value = [...row.streams].sort();
  } finally {
    if (mine === detailSeq) detailLoading.value = false;
  }
}

/** Counterparts the server returns per kind. */
const RELATED_LIMIT = 10;
const relatedKinds = computed(() => ENTITY_KINDS.filter((x) => x !== kind.value));
const relatedCount = computed(() =>
  relatedKinds.value.reduce((sum, x) => sum + related.value[x].length, 0),
);

const drawerTabs = computed<RecordTab[]>(() => [
  { name: "activity", label: t("siem.entities.tab.activity"), icon: "stacked-line-chart" },
  {
    name: "related",
    label: t("siem.entities.tab.related"),
    icon: "hub",
    count: relatedCount.value || null,
  },
  {
    name: "sources",
    label: t("siem.entities.tab.sources"),
    icon: "database",
    count: selected.value?.streams.length ?? null,
  },
  {
    name: "cases",
    label: t("siem.entities.tab.cases"),
    icon: "assignment",
    count: cases.value.length || null,
  },
]);

function fmtAbsolute(us: number): string {
  if (!us) return "—";
  return new Date(us / 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const facts = computed<RecordFact[]>(() => {
  const r = selected.value;
  if (!r) return [];
  return [
    { label: t("siem.entities.col.events"), value: formatEventCount(r.events) },
    {
      label: t("siem.entities.col.failures"),
      value: r.failureKnown ? `${formatEventCount(r.failures)} · ${pct(r)}%` : "—",
    },
    { label: t("siem.entities.col.firstSeen"), value: fmtAbsolute(r.firstSeen) },
    { label: t("siem.entities.col.lastSeen"), value: fmtAbsolute(r.lastSeen) },
  ];
});

const chartSeries = computed(() => [
  { key: "ok", label: t("siem.entities.chart.ok"), token: "--color-badge-blue-solid-bg" as const },
  {
    key: "failed",
    label: t("siem.entities.chart.failed"),
    token: "--color-badge-error-solid-bg" as const,
  },
]);

/** Every included source at once, matching each alias of this entity. */
function huntLink() {
  if (!selected.value) return null;
  return {
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      period: range.value,
      ...huntLinkQuery({
        kind: kind.value,
        value: selected.value.value,
        aliases: selected.value.aliases,
      }),
    },
  };
}

/** Events for this entity in one stream, filtered to it, over this page's window. */
function eventsLink(stream: string) {
  const plan = plans.value.find((p) => p.stream === stream);
  const column = plan?.columns[kind.value];
  if (!selected.value || !column) return null;
  // One filter value cannot match several spellings; the cross-source hunt can.
  if (selected.value.aliases.length > 1) return huntLink();
  return {
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream,
      period: range.value,
      filters:
        b64EncodeUnicode(
          JSON.stringify([
            { field: column, op: "=", value: selected.value.aliases[0] ?? selected.value.value },
          ]),
        ) ?? "",
    },
  };
}
function openEvents(stream: string) {
  const link = eventsLink(stream);
  if (link) router.push(link);
}
function huntInEvents() {
  const link = huntLink();
  if (link) router.push(link);
}
function openCase(id: string) {
  router.push({ path: "/security/cases", query: { org_identifier: orgId.value, case: id } });
}

/** Case priority tone: P1 and P2 are urgent, P3 elevated, anything else quiet. */
const CASE_TAG: Record<string, BadgeVariant> = {
  P1: "error-soft",
  P2: "error-soft",
  P3: "orange-soft",
  P4: "default-soft",
};

/** Raw spellings that differ from the canonical value, so the stored value stays visible. */
const otherAliases = (r: EntityRow) => r.aliases.filter((a) => a !== r.value);

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    signalFilter.value = "all";
  }
}

const STATUS_TAG: Record<StreamStatus, { variant: BadgeVariant; icon: string }> = {
  loading: { variant: "default-soft", icon: "hourglass-empty" },
  done: { variant: "success-soft", icon: "check-circle" },
  failed: { variant: "error-soft", icon: "error-outline" },
};
const statusOf = (stream: string): StreamStatus => streamStatus.value[stream] ?? "loading";
const tableLoading = computed(() => loading.value && !lastRunAt.value && !answered.value);

const noSources = computed(
  () => !plansLoading.value && !loading.value && !plansError.value && plans.value.length === 0,
);
</script>

<template>
  <OPageLayout
    :title="t('siem.entities.title')"
    :subtitle="t('siem.entities.subtitle')"
    icon="groups"
    bleed
    title-data-test="security-entities-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <OToggleGroup
          :model-value="range"
          data-test="security-entities-range"
          @update:model-value="onRange"
        >
          <OToggleGroupItem v-for="r in RANGES" :key="r.value" :value="r.value" size="sm">
            {{ t(`siem.range.${r.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OToggleGroup
          :model-value="view"
          data-test="security-entities-view"
          @update:model-value="view = $event as 'table' | 'graph'"
        >
          <OToggleGroupItem v-for="v in VIEWS" :key="v.value" :value="v.value" size="sm">
            <OIcon :name="v.icon" size="sm" />
            {{ t(`siem.entities.view.${v.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          data-test="security-entities-refresh"
          @click="refresh"
        />
      </div>
    </template>

    <template #subnav>
      <OTabs :model-value="kind" data-test="security-entities-kind" @update:model-value="onKind">
        <OTab
          v-for="k in ENTITY_KINDS"
          :key="k"
          :name="k"
          :data-test="`security-entities-kind-${k}`"
        >
          <span class="flex items-center gap-1.5">
            <OIcon :name="KIND_ICON[k]" size="sm" />
            {{ t(`siem.entities.kinds.${k}`) }}
            <span
              class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
              >{{ rowsByKind[k].length }}{{ cappedKinds.has(k) ? "+" : "" }}</span
            >
          </span>
        </OTab>
      </OTabs>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <SecurityNotices
        :notices="notices"
        class="mx-page-edge mt-2"
        data-test="security-entities-notices"
      />

      <div
        v-if="loading && streamNames.length"
        class="mx-page-edge mt-2 flex flex-wrap items-center gap-1"
        data-test="security-entities-sources"
      >
        <span class="text-text-secondary text-xs">{{ t("siem.entities.sourcesLoading") }}</span>
        <OTag
          v-for="name in streamNames"
          :key="name"
          :variant="STATUS_TAG[statusOf(name)].variant"
          :icon="STATUS_TAG[statusOf(name)].icon"
          size="xs"
          class="font-mono"
          :data-test="`security-entities-source-${name}`"
          >{{ name }}<OTooltip :content="t(`siem.entities.sourceStatus.${statusOf(name)}`)"
        /></OTag>
      </div>

      <SecurityAccessLock
        v-if="accessDenials.length"
        :denials="accessDenials"
        :reason="raw(forbiddenReason(refusal))"
        size="hero"
        data-test="security-entities-access-lock"
      />
      <OEmptyState
        v-else-if="noSources"
        size="hero"
        icon="database"
        :title="t('siem.entities.noSources')"
        :description="t('siem.entities.noSourcesHint')"
      />
      <SecurityRiskGraph
        v-else-if="view === 'graph'"
        :graph="riskGraph"
        :loading="graphLoading || loading"
        data-test="security-entities-risk-graph"
        @node-select="onGraphNodeSelect"
      />
      <OTable
        v-else
        ref="tableRef"
        :key="kind"
        :data="filteredRows"
        :columns="columns"
        row-key="value"
        :loading="tableLoading"
        :error="plansError || runError || null"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :persist-columns="true"
        :table-id="`security-entities-${kind}`"
        :get-row-status-color="(r: Row) => severityRailColor(r.tone)"
        :row-class="(r: Row) => (selected?.value === r.value ? '!bg-table-row-selected-bg' : '')"
        class="min-h-0 flex-1"
        data-test="security-entities-table"
        @row-click="openEntity"
        @sort-change="() => nextTick(relocate)"
      >
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip
              compact-values
              :items="stats"
              :loading="tableLoading"
              selectable
              :selected-key="signalFilter === 'all' ? null : signalFilter"
              data-test="security-entities-stats"
              @select="onStat"
            />
          </div>
        </template>

        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <OSearchInput
              v-model="search"
              :placeholder="t(`siem.entities.search.${kind}`)"
              class="max-w-md flex-1"
              data-test="security-entities-search"
            />
            <span class="text-text-secondary text-xs">{{ t("siem.entities.windowNote") }}</span>
          </div>
        </template>

        <template #cell-value="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <OIcon :name="KIND_ICON[kind]" size="sm" class="text-text-secondary shrink-0" />
            <span
              class="text-text-heading truncate font-medium"
              :class="{ 'font-mono': kind !== 'user' }"
              >{{ row.value }}</span
            >
            <OTag
              v-if="otherAliases(row).length"
              variant="default-soft"
              size="xs"
              class="shrink-0"
              :data-test="`security-entities-aliases-${row.value}`"
              >{{ t("siem.entities.aliasCount", otherAliases(row).length)
              }}<OTooltip :content="raw(row.aliases.join(', '))"
            /></OTag>
          </div>
        </template>
        <template #cell-signals="{ row }">
          <div class="flex flex-wrap gap-1">
            <OTag
              v-for="sig in row.signals"
              :key="sig"
              :variant="SIGNAL_TAG[sig as EntitySignal]"
              size="xs"
              >{{
                t(
                  sig === "spread"
                    ? `siem.entities.signal.spread.${kind}`
                    : `siem.entities.signal.${sig}`,
                )
              }}<OTooltip :content="signalHint(sig as EntitySignal)"
            /></OTag>
            <span v-if="!row.signals.length" class="text-text-secondary">—</span>
          </div>
        </template>
        <template #cell-events="{ row }">
          <span class="tabular-nums">{{ formatEventCount(row.events) }}</span>
        </template>
        <template #cell-failures="{ row }">
          <div v-if="row.failureKnown" class="flex w-full items-center gap-2">
            <OProgressBar
              :value="failureRate(row)"
              :variant="row.signals.includes('failures') ? 'danger' : 'default'"
              size="xs"
              class="flex-1"
            />
            <span class="text-text-secondary w-16 text-right text-xs tabular-nums"
              >{{ formatEventCount(row.failures) }} · {{ pct(row) }}%</span
            >
          </div>
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #cell-peers="{ row }">
          <span class="tabular-nums">{{ row.peers || "—" }}</span>
        </template>
        <template #cell-streams="{ row }">
          <div class="flex min-w-0 gap-1 overflow-hidden">
            <OTag
              v-for="s in row.streams.slice(0, 2)"
              :key="s"
              variant="default-soft"
              size="xs"
              class="font-mono"
              >{{ s }}</OTag
            >
            <span v-if="row.streams.length > 2" class="text-text-secondary text-xs"
              >+{{ row.streams.length - 2 }}</span
            >
          </div>
        </template>
        <template #cell-firstSeen="{ row }">
          <OTimeCell :value="row.firstSeen" unit="us" />
        </template>
        <template #cell-lastSeen="{ row }">
          <OTimeCell :value="row.lastSeen" unit="us" />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-entities-refresh-table"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.entities.refresh')" />
          </OButton>
        </template>

        <template #error="{ message }">
          <OEmptyState
            size="block"
            icon="error-outline"
            :title="t('siem.entities.loadError')"
            :description="raw(message)"
            :action-label="t('siem.entities.refresh')"
            @action="refresh"
          />
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="search-off"
            :title="t('siem.entities.empty')"
            :description="t('siem.entities.emptyHint')"
            :filtered="!!search.trim() || signalFilter !== 'all'"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="selected.value"
      :eyebrow="t(`siem.entities.kind.${kind}`)"
      :subtitle="t('siem.entities.drawerSubtitle', { window: t(`siem.range.${range}`) })"
      :icon="KIND_ICON[kind]"
      :tone="selected.tone"
      :facts="facts"
      :tabs="drawerTabs"
      :index="drawerIndex"
      :total="drawerTotal"
      :share-url="shareUrl"
      data-test="security-entity-drawer"
      @close="closeDrawer"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag v-for="sig in selected.signals" :key="sig" :variant="SIGNAL_TAG[sig]" size="sm"
          >{{
            t(
              sig === "spread"
                ? `siem.entities.signal.spread.${kind}`
                : `siem.entities.signal.${sig}`,
            )
          }}<OTooltip :content="signalHint(sig)"
        /></OTag>
        <OTag
          v-for="alias in otherAliases(selected)"
          :key="alias"
          variant="default-soft"
          size="sm"
          class="font-mono"
          :data-test="`security-entity-drawer-alias-${alias}`"
          >{{ alias }}<OTooltip :content="t('siem.entities.aliasHint')"
        /></OTag>
        <OTag v-if="selected.peers" variant="default-soft" size="sm">
          {{ t(`siem.entities.peersChip.${PEER_LABEL[kind]}`, selected.peers) }}
        </OTag>
        <OTag v-if="!selected.signals.length" variant="success-soft" icon="check-circle" size="sm">
          {{ t("siem.entities.noSignals") }}
        </OTag>
      </template>

      <template v-if="detailFailed.length" #summary>
        <OBanner
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-entity-drawer-failed"
        >
          {{ t("siem.entities.detailFailed", { streams: detailFailed.join(", ") }) }}
        </OBanner>
      </template>

      <template #tab-activity>
        <div class="border-border-default rounded-surface flex flex-col gap-2 border p-3">
          <div class="flex items-center justify-between">
            <span class="text-text-heading text-sm font-semibold">{{
              t("siem.entities.activity")
            }}</span>
            <div class="flex items-center gap-1.5">
              <OTag variant="blue-soft" size="xs" dot>{{ t("siem.entities.chart.ok") }}</OTag>
              <OTag variant="error-soft" size="xs" dot>{{ t("siem.entities.chart.failed") }}</OTag>
            </div>
          </div>
          <div class="h-56">
            <SecuritySeverityChart
              :buckets="timeline"
              :series="chartSeries"
              :loading="detailLoading"
              :min="Math.floor(windowStartUs / 1000)"
              :max="Math.ceil(windowEndUs / 1000)"
              data-test="security-entity-drawer-chart"
            />
          </div>
        </div>
      </template>

      <template #tab-related>
        <div v-if="detailLoading" class="flex justify-center py-8"><OSpinner size="sm" /></div>
        <template v-else>
          <div
            v-for="other in relatedKinds"
            :key="other"
            class="flex flex-col gap-2"
            :data-test="`security-entity-drawer-related-${other}`"
          >
            <div class="flex items-center gap-1.5">
              <OIcon :name="KIND_ICON[other]" size="sm" class="text-text-secondary" />
              <span class="text-text-heading text-sm font-semibold">{{
                t(`siem.entities.kinds.${other}`)
              }}</span>
              <span class="text-text-secondary text-xs">{{
                t("siem.entities.topN", { n: RELATED_LIMIT })
              }}</span>
            </div>
            <div
              v-if="related[other].length"
              class="border-border-default rounded-surface overflow-hidden border"
            >
              <div
                v-for="item in related[other]"
                :key="item.value"
                class="group border-border-subtle hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-3 border-b px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
                role="button"
                tabindex="0"
                :data-test="`security-entity-drawer-related-${other}-${item.value}`"
                @click="pivotTo(other, item.value)"
                @keydown.enter="pivotTo(other, item.value)"
                @keydown.space.prevent="pivotTo(other, item.value)"
              >
                <span
                  class="text-text-heading min-w-0 flex-1 truncate text-sm"
                  :class="{ 'font-mono': other !== 'user' }"
                  >{{ item.value }}</span
                >
                <OTag v-if="item.fail" variant="error-soft" size="xs">{{
                  t("siem.entities.failedCount", item.fail)
                }}</OTag>
                <span class="text-text-secondary w-16 text-right text-xs tabular-nums">{{
                  formatEventCount(item.n)
                }}</span>
                <OIcon
                  name="chevron-right"
                  size="sm"
                  class="text-text-secondary opacity-0 group-hover:opacity-100"
                />
              </div>
            </div>
            <span v-else class="text-text-secondary text-xs">{{
              t("siem.entities.noRelated")
            }}</span>
          </div>
        </template>
      </template>

      <template #tab-cases>
        <div v-if="detailLoading" class="flex justify-center py-8"><OSpinner size="sm" /></div>
        <div
          v-else-if="cases.length"
          class="border-border-default rounded-surface overflow-hidden border"
          data-test="security-entity-drawer-cases"
        >
          <div
            v-for="c in cases"
            :key="c.id"
            class="group border-border-subtle hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-3 border-b px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
            role="link"
            tabindex="0"
            :data-test="`security-entity-drawer-case-${c.id}`"
            @click="openCase(c.id)"
            @keydown.enter="openCase(c.id)"
            @keydown.space.prevent="openCase(c.id)"
          >
            <OTag :variant="CASE_TAG[c.severity] ?? 'default-soft'" size="xs">{{
              raw(c.severity || "P3")
            }}</OTag>
            <OTruncatedText class="text-text-heading flex-1 text-sm">{{ c.title }}</OTruncatedText>
            <OTag :variant="c.open ? 'orange-soft' : 'default-soft'" size="xs">{{
              c.open ? t("siem.entities.caseOpen") : t("siem.entities.caseResolved")
            }}</OTag>
            <OIcon
              name="chevron-right"
              size="sm"
              class="text-text-secondary opacity-0 group-hover:opacity-100 max-md:opacity-100"
            />
          </div>
        </div>
        <span
          v-else
          class="text-text-secondary text-xs"
          data-test="security-entity-drawer-no-cases"
          >{{ t("siem.entities.noCases") }}</span
        >
      </template>

      <template #tab-sources>
        <div class="border-border-default rounded-surface overflow-hidden border">
          <div
            v-for="s in selected.streams"
            :key="s"
            class="border-border-subtle flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
            :data-test="`security-entity-drawer-source-${s}`"
          >
            <OIcon name="database" size="sm" class="text-text-secondary" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-text-heading truncate font-mono text-sm">{{ s }}</span>
              <span class="text-text-secondary text-2xs font-mono">
                {{ plans.find((p) => p.stream === s)?.columns[kind] }}
                <template v-if="plans.find((p) => p.stream === s)?.sourceLabel">
                  · {{ plans.find((p) => p.stream === s)?.sourceLabel }}</template
                >
              </span>
            </div>
            <OButton
              variant="ghost-primary"
              size="sm"
              icon-right="open-in-new"
              :data-test="`security-entity-drawer-events-${s}`"
              @click="openEvents(s)"
            >
              {{ t("siem.entities.openEvents") }}
            </OButton>
          </div>
        </div>
      </template>

      <template #footer>
        <OButton
          v-if="selected.streams.length"
          variant="primary"
          size="sm-action"
          icon-left="manage-search"
          data-test="security-entity-drawer-open-events"
          @click="huntInEvents"
        >
          {{ t("siem.entities.huntInEvents") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
