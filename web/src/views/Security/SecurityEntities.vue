<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Entities — every user, source IP and host the security streams mention.
     Each stream is planned first (which column is the user, which the IP, how
     a failure is spelled), then counted with one GROUP BY per stream and kind;
     the same value in two streams is one entity. The drawer answers "what has
     this thing been doing": activity over time, who and what it touched, and
     a jump into the raw events. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecuritySeverityChart from "@/components/security/SecuritySeverityChart.vue";
import {
  runPool,
  runSql,
  useSecurityStreamPlans,
} from "@/composables/security/useSecurityStreamPlans";
import { useTableRowNavigation } from "@/composables/security/useTableRowNavigation";
import {
  ENTITY_KINDS,
  SIGNAL_THRESHOLDS,
  entityAggSql,
  entitySignals,
  entityTimelineSql,
  failureRate,
  mergeEntities,
  relatedSql,
  type AggHit,
  type EntityKind,
  type EntityRow,
  type EntitySignal,
  type StreamPlan,
} from "@/utils/security/entities";
import { histogramInterval, histogramKeyToMs } from "@/utils/security/eventQuery";
import { severityRailColor, type SeverityTone } from "@/utils/security/severity";
import { b64EncodeUnicode, formatEventCount } from "@/utils/formatters";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── View state (URL-synced) ──────────────────────────────────────────────────
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

// ── Data ─────────────────────────────────────────────────────────────────────
const {
  plans,
  unreadable,
  loading: plansLoading,
  error: plansError,
  load: loadPlans,
} = useSecurityStreamPlans();

/** Rows per stream and kind; past this the page says it is showing the top. */
const ENTITY_LIMIT = 500;
const rowsByKind = ref<Record<EntityKind, EntityRow[]>>({ user: [], ip: [], host: [] });
const cappedKinds = ref<Set<EntityKind>>(new Set());
const failedStreams = ref<string[]>([]);
/** Streams whose answer the engine marked partial or whose functions errored. */
const partialStreams = ref<string[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
let seq = 0;

async function refresh() {
  if (!orgId.value) return;
  const mine = ++seq;
  loading.value = true;
  windowEndUs.value = Date.now() * 1000;
  const start = windowStartUs.value;
  const end = windowEndUs.value;
  await loadPlans(orgId.value, start, end);
  const failed = new Set<string>();
  const partial = new Set<string>();
  const capped = new Set<EntityKind>();
  const jobs = ENTITY_KINDS.flatMap((k) =>
    plans.value.flatMap((plan) => {
      const sql = entityAggSql(plan, k, ENTITY_LIMIT);
      return sql ? [{ k, plan, sql }] : [];
    }),
  );
  const settled = await runPool(jobs.map((j) => () => runSql(orgId.value, j.sql, start, end)));
  if (mine !== seq) return;
  const perKind: Record<EntityKind, { plan: StreamPlan; hits: AggHit[] }[]> = {
    user: [],
    ip: [],
    host: [],
  };
  settled.forEach((r, i) => {
    const { k, plan } = jobs[i];
    if (r.status === "rejected") {
      failed.add(plan.stream);
      return;
    }
    if (r.value.partial || r.value.functionError) partial.add(plan.stream);
    const hits = r.value.hits as unknown as AggHit[];
    if (hits.length >= ENTITY_LIMIT) capped.add(k);
    perKind[k].push({ plan, hits });
  });
  rowsByKind.value = {
    user: mergeEntities(perKind.user),
    ip: mergeEntities(perKind.ip),
    host: mergeEntities(perKind.host),
  };
  cappedKinds.value = capped;
  failedStreams.value = [...new Set([...failed, ...unreadable.value])].sort();
  partialStreams.value = [...partial].sort();
  loading.value = false;
  lastRunAt.value = Date.now();
  if (pendingEntity.value) restorePending();
  else reopenSelected();
}

/** After a reload the open drawer must show the new window's numbers, or close. */
function reopenSelected() {
  if (!selected.value) return;
  const row = allRows.value.find((r) => r.value === selected.value!.value);
  if (row) openEntity(row);
  else closeDrawer();
}

onMounted(() => void refresh());
watch(orgId, () => void refresh());

function onRange(value: unknown) {
  if (!value || value === range.value) return;
  range.value = value as RangeKey;
  syncUrl();
  void refresh();
}
function onKind(value: string | number) {
  kind.value = value as EntityKind;
  signalFilter.value = "all";
  closeDrawer();
  syncUrl();
}
watch(search, () => syncUrl());

// ── Table ────────────────────────────────────────────────────────────────────
interface Row extends EntityRow {
  signals: EntitySignal[];
  tone: SeverityTone;
}

function toneFor(signals: EntitySignal[]): SeverityTone {
  if (signals.includes("failures")) return "high";
  if (signals.includes("spread")) return "medium";
  if (signals.includes("external")) return "low";
  return "info";
}

const allRows = computed<Row[]>(() =>
  rowsByKind.value[kind.value].map((r) => {
    const signals = entitySignals(kind.value, r);
    return { ...r, signals, tone: toneFor(signals) };
  }),
);

const filteredRows = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return allRows.value.filter(
    (r) =>
      (signalFilter.value === "all" || r.signals.includes(signalFilter.value)) &&
      (!needle || r.value.toLowerCase().includes(needle)),
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

// ── Summary strip (over every entity of this kind, not the page) ─────────────
const counts = computed(() => {
  const c = { failures: 0, spread: 0, external: 0 };
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

const SIGNAL_TAG: Record<EntitySignal, BadgeVariant> = {
  failures: "error-soft",
  spread: "amber-soft",
  external: "blue-soft",
};
function signalHint(sig: EntitySignal): string {
  if (sig === "failures")
    return t("siem.entities.signalHint.failures", {
      rate: Math.round(SIGNAL_THRESHOLDS.failureRate * 100),
      n: SIGNAL_THRESHOLDS.minFailures,
    });
  if (sig === "spread")
    return t(`siem.entities.signalHint.spread.${kind.value}`, { n: SIGNAL_THRESHOLDS.spread });
  return t("siem.entities.signalHint.external");
}

const pct = (r: EntityRow) => Math.round(failureRate(r) * 100);

// ── Drawer ───────────────────────────────────────────────────────────────────
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

// Built from the intended query, not window.location: router.replace has not
// necessarily landed by the time this is read.
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

// Detail: timeline + related, fetched per open entity.
const timeline = ref<{ ts: number; counts: Record<string, number> }[]>([]);
const related = ref<Record<EntityKind, { value: string; n: number; fail: number }[]>>({
  user: [],
  ip: [],
  host: [],
});
const detailLoading = ref(false);
/** Streams whose drawer queries failed; shown in the drawer, not swallowed. */
const detailFailed = ref<string[]>([]);
let detailSeq = 0;
const RELATED_LIMIT = 10;

async function loadDetail(row: Row) {
  const mine = ++detailSeq;
  detailLoading.value = true;
  timeline.value = [];
  related.value = { user: [], ip: [], host: [] };
  const k = kind.value;
  const start = windowStartUs.value;
  const end = windowEndUs.value;
  const interval = histogramInterval((end - start) / 1000);
  const inStreams = plans.value.filter((p) => row.streams.includes(p.stream));

  const buckets = new Map<number, { ok: number; failed: number }>();
  const rel: Record<EntityKind, Map<string, { n: number; fail: number }>> = {
    user: new Map(),
    ip: new Map(),
    host: new Map(),
  };
  const jobs: { stream: string; run: () => Promise<void> }[] = [];
  for (const plan of inStreams) {
    const tl = entityTimelineSql(plan, k, row.value, interval.sql);
    if (tl) {
      jobs.push({
        stream: plan.stream,
        run: async () => {
          const { hits } = await runSql(orgId.value, tl, start, end);
          for (const h of hits) {
            const ts = histogramKeyToMs(h.zo_ts);
            if (ts === null) continue;
            const n = Number(h.zo_n ?? 0);
            const f = Number(h.zo_fail ?? 0);
            const b = buckets.get(ts) ?? { ok: 0, failed: 0 };
            b.ok += n - f;
            b.failed += f;
            buckets.set(ts, b);
          }
        },
      });
    }
    for (const other of ENTITY_KINDS.filter((x) => x !== k)) {
      const sql = relatedSql(plan, k, row.value, other, RELATED_LIMIT);
      if (!sql) continue;
      jobs.push({
        stream: plan.stream,
        run: async () => {
          const { hits } = await runSql(orgId.value, sql, start, end);
          for (const h of hits) {
            const v = String(h.zo_value ?? "");
            if (!v) continue;
            const cur = rel[other].get(v) ?? { n: 0, fail: 0 };
            rel[other].set(v, {
              n: cur.n + Number(h.zo_n ?? 0),
              fail: cur.fail + Number(h.zo_fail ?? 0),
            });
          }
        },
      });
    }
  }
  const settled = await runPool(jobs.map((j) => j.run));
  const failed = new Set<string>();
  settled.forEach((r, i) => r.status === "rejected" && failed.add(jobs[i].stream));
  if (mine !== detailSeq) return;
  detailFailed.value = [...failed].sort();
  timeline.value = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, c]) => ({ ts, counts: { ok: c.ok, failed: c.failed } }));
  related.value = Object.fromEntries(
    ENTITY_KINDS.map((x) => [
      x,
      [...rel[x].entries()]
        .map(([value, c]) => ({ value, ...c }))
        .sort((a, b) => b.n - a.n)
        .slice(0, RELATED_LIMIT),
    ]),
  ) as typeof related.value;
  detailLoading.value = false;
}

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

/** Events for this entity in one stream, filtered to it, over this page's window. */
function eventsLink(stream: string) {
  const plan = plans.value.find((p) => p.stream === stream);
  const column = plan?.columns[kind.value];
  if (!selected.value || !column) return null;
  return {
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream,
      period: range.value,
      filters:
        b64EncodeUnicode(
          JSON.stringify([{ field: column, op: "=", value: selected.value.value }]),
        ) ?? "",
    },
  };
}
function openEvents(stream: string) {
  const link = eventsLink(stream);
  if (link) router.push(link);
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    signalFilter.value = "all";
  }
}

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
      <OBanner
        v-if="cappedKinds.has(kind) || failedStreams.length || partialStreams.length"
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-entities-partial"
      >
        <template v-if="cappedKinds.has(kind)">{{
          t("siem.entities.capped", { n: ENTITY_LIMIT })
        }}</template>
        <template v-if="failedStreams.length">
          {{ t("siem.entities.failedStreams", { streams: failedStreams.join(", ") }) }}
        </template>
        <template v-if="partialStreams.length">
          {{ t("siem.entities.partialStreams", { streams: partialStreams.join(", ") }) }}
        </template>
      </OBanner>

      <OEmptyState
        v-if="noSources"
        size="hero"
        icon="database"
        :title="t('siem.entities.noSources')"
        :description="t('siem.entities.noSourcesHint')"
      />
      <OTable
        v-else
        ref="tableRef"
        :key="kind"
        :data="filteredRows"
        :columns="columns"
        row-key="value"
        :loading="loading && !lastRunAt"
        :error="plansError || null"
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
              :items="stats"
              :loading="loading && !lastRunAt"
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
            :description="message"
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
          @click="openEvents(selected.streams[0])"
        >
          {{ t("siem.entities.huntInEvents") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
