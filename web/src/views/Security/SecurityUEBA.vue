<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- UEBA — each user measured against their own recent past.
     Two server-side profiles per security stream (user × source IP × hour of
     day): one for the chosen window, one for the baseline window just before
     it. Scoring is in utils/security/ueba.ts: a handful of explainable signals,
     each shown with the numbers that raised it. The page says plainly that
     these are heuristics over the chosen windows. -->
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
import OTable from "@/lib/core/Table/OTable.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import {
  runPool,
  runSql,
  useSecurityStreamPlans,
} from "@/composables/security/useSecurityStreamPlans";
import type { StreamPlan } from "@/utils/security/entities";
import { useTableRowNavigation } from "@/composables/security/useTableRowNavigation";
import { isExternalIp } from "@/utils/security/entities";
import {
  UEBA_THRESHOLDS,
  buildProfiles,
  hoursSql,
  ipsSql,
  scoreAll,
  type HourHit,
  type IpHit,
  type UebaSignal,
  type UebaSignalKind,
  type UserRisk,
} from "@/utils/security/ueba";
import {
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  type SeverityTone,
} from "@/utils/security/severity";
import { b64EncodeUnicode, formatEventCount } from "@/utils/formatters";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Windows ──────────────────────────────────────────────────────────────────
const HOUR_US = 3_600_000_000;
const WINDOWS = [
  { value: "1h", current: 1, baseline: 24, baselineLabel: "24h" },
  { value: "24h", current: 24, baseline: 24 * 7, baselineLabel: "7d" },
  { value: "7d", current: 24 * 7, baseline: 24 * 30, baselineLabel: "30d" },
] as const;
type WindowKey = (typeof WINDOWS)[number]["value"];

const win = ref<WindowKey>(
  WINDOWS.some((w) => w.value === route.query.period) ? (route.query.period as WindowKey) : "24h",
);
const windowDef = computed(() => WINDOWS.find((w) => w.value === win.value)!);
const search = ref(route.query.q ? String(route.query.q) : "");
const toneFilter = ref<SeverityTone | "all">("all");
const pendingUser = ref<string | null>(route.query.user ? String(route.query.user) : null);

const nowUs = ref(Date.now() * 1000);
const currentStart = computed(() => nowUs.value - windowDef.value.current * HOUR_US);
const baselineStart = computed(() => currentStart.value - windowDef.value.baseline * HOUR_US);

function syncUrl() {
  const query: Record<string, string> = { org_identifier: orgId.value, period: win.value };
  if (search.value.trim()) query.q = search.value.trim();
  if (selected.value) query.user = selected.value.user;
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

// Row caps per stream, window and aggregate; hitting one (~2,000 users for hours)
// withholds the signals that need every row, and the page says so.
const HOURS_LIMIT = 50000;
const IPS_LIMIT = 20000;
const risks = ref<UserRisk[]>([]);
/** Signals withheld org-wide because a baseline aggregate came back incomplete. */
const withheld = ref<UebaSignalKind[]>([]);
/** The current window was cut short: counts are lower bounds. */
const currentPartial = ref(false);
/** Streams left out entirely — unreadable, or a query for them failed. */
const excludedStreams = ref<string[]>([]);
/** Streams with no data in the baseline window: their users cannot be "first seen". */
const noHistoryStreams = ref<string[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
let seq = 0;

type Pair = { stream: string; hours: HourHit[]; ips: IpHit[]; failureKnown: boolean };

async function refresh() {
  if (!orgId.value) return;
  const mine = ++seq;
  loading.value = true;
  nowUs.value = Date.now() * 1000;
  await loadPlans(orgId.value, baselineStart.value, nowUs.value);
  const windows = {
    now: [currentStart.value, nowUs.value] as const,
    base: [baselineStart.value, currentStart.value] as const,
  };
  const complete = { hours: true, ips: true, streamsWithHistory: new Set<string>() };
  let partialNow = false;
  const excluded = new Set<string>(unreadable.value);

  // Four queries per stream, run through the pool; a stream counts only if all four answered.
  type Job = { plan: StreamPlan; agg: "hours" | "ips"; win: "now" | "base"; sql: string };
  const jobs: Job[] = plans.value.flatMap((plan) => {
    const h = hoursSql(plan, HOURS_LIMIT);
    if (!h) return [];
    const i = ipsSql(plan, IPS_LIMIT);
    return (["now", "base"] as const).flatMap((win) => [
      { plan, agg: "hours" as const, win, sql: h },
      ...(i ? [{ plan, agg: "ips" as const, win, sql: i }] : []),
    ]);
  });
  const settled = await runPool(
    jobs.map((j) => () => runSql(orgId.value, j.sql, ...windows[j.win])),
  );
  if (mine !== seq) return;

  const byStream = new Map<string, { now: Pair; base: Pair }>();
  const failed = new Set<string>();
  settled.forEach((r, idx) => {
    const { plan, agg, win } = jobs[idx];
    if (r.status === "rejected") {
      failed.add(plan.stream);
      return;
    }
    const res = r.value;
    const cap = agg === "hours" ? HOURS_LIMIT : IPS_LIMIT;
    const cut = res.hits.length >= cap || res.partial || !!res.functionError;
    if (win === "base") {
      if (agg === "hours" && res.hits.length) complete.streamsWithHistory.add(plan.stream);
      // A baseline missing rows makes "never seen before" unknowable.
      if (cut) complete[agg] = false;
    } else if (cut) partialNow = true;
    const entry = byStream.get(plan.stream) ?? {
      now: { stream: plan.stream, hours: [], ips: [], failureKnown: !!plan.failure },
      base: { stream: plan.stream, hours: [], ips: [], failureKnown: !!plan.failure },
    };
    entry[win][agg] = res.hits as never;
    byStream.set(plan.stream, entry);
  });
  // Without its baseline a stream would make every user "first seen": drop it whole.
  for (const st of failed) {
    byStream.delete(st);
    excluded.add(st);
  }
  const ok = [...byStream.values()];
  risks.value = scoreAll(
    buildProfiles(ok.map((x) => x.now)),
    buildProfiles(ok.map((x) => x.base)),
    {
      currentStart: currentStart.value,
      currentEnd: nowUs.value,
      baselineStart: baselineStart.value,
    },
    complete,
  );
  withheld.value = [
    ...(complete.hours
      ? []
      : (["volume", "new_hours", "first_seen", "failure_jump"] as UebaSignalKind[])),
    ...(complete.ips ? [] : (["new_ip"] as UebaSignalKind[])),
  ];
  currentPartial.value = partialNow;
  noHistoryStreams.value = ok
    .map((x) => x.now.stream)
    .filter((st) => !complete.streamsWithHistory.has(st))
    .sort();
  excludedStreams.value = [...excluded].sort();
  loading.value = false;
  lastRunAt.value = Date.now();
  const want = pendingUser.value ?? selected.value?.user ?? null;
  pendingUser.value = null;
  if (!want) return;
  // Re-resolve after every reload so the drawer shows this run's numbers.
  const r = risks.value.find((x) => x.user === want);
  if (r) openUser(r);
  else closeDrawer();
}

onMounted(() => void refresh());
watch(orgId, () => void refresh());
watch(search, () => syncUrl());

function onWindow(value: unknown) {
  if (!value || value === win.value) return;
  win.value = value as WindowKey;
  closeDrawer();
  syncUrl();
  void refresh();
}

// ── Table ────────────────────────────────────────────────────────────────────
const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return risks.value.filter(
    (r) =>
      (toneFilter.value === "all" || r.tone === toneFilter.value) &&
      (!needle || r.user.toLowerCase().includes(needle)),
  );
});

const columns = computed<OTableColumnDef<UserRisk>[]>(() => [
  {
    id: "user",
    header: t("siem.ueba.col.user"),
    accessorKey: "user",
    meta: { isName: true },
    size: 200,
  },
  { id: "score", header: t("siem.ueba.col.risk"), accessorKey: "score", sortable: true, size: 170 },
  {
    id: "signals",
    header: t("siem.ueba.col.signals"),
    accessorFn: (r: UserRisk) => r.signals.length,
    size: 340,
  },
  {
    id: "events",
    header: t("siem.ueba.col.events"),
    accessorFn: (r: UserRisk) => r.current.events,
    sortable: true,
    size: 170,
  },
  {
    id: "failures",
    header: t("siem.ueba.col.failures"),
    accessorFn: (r: UserRisk) => r.current.failures,
    sortable: true,
    size: 110,
    hideable: true,
    meta: { align: "right" },
  },
  {
    id: "ips",
    header: t("siem.ueba.col.ips"),
    accessorFn: (r: UserRisk) => r.current.ips.size,
    sortable: true,
    size: 110,
    hideable: true,
    meta: { align: "right" },
  },
]);

const SIGNAL_TAG: Record<UebaSignalKind, BadgeVariant> = {
  volume: "orange-soft",
  new_ip: "error-soft",
  failure_jump: "error-soft",
  new_hours: "amber-soft",
  first_seen: "blue-soft",
};
const SIGNAL_ICON: Record<UebaSignalKind, string> = {
  volume: "trending-up",
  new_ip: "language",
  failure_jump: "error-outline",
  new_hours: "schedule",
  first_seen: "person-add",
};

/** The reason text for a signal, built from the numbers that raised it. */
function reason(sig: UebaSignal): string {
  const e = sig.evidence;
  switch (sig.kind) {
    case "volume":
      return t("siem.ueba.reason.volume", {
        n: formatEventCount(Number(e.n)),
        expected: formatEventCount(Number(e.expected)),
        ratio: e.ratio,
        baseline: windowDef.value.baselineLabel,
      });
    case "new_ip":
      return t(
        Number(e.external) ? "siem.ueba.reason.newIpExternal" : "siem.ueba.reason.newIp",
        { ip: e.ip, n: e.n, count: e.count, baseline: windowDef.value.baselineLabel },
        Number(e.count),
      );
    case "failure_jump":
      return t("siem.ueba.reason.failureJump", { n: e.n, rate: e.rate, baseline: e.baseline });
    case "new_hours":
      return t("siem.ueba.reason.newHours", {
        n: e.n,
        hours: e.hours,
        baseline: windowDef.value.baselineLabel,
      });
    case "first_seen":
      return t("siem.ueba.reason.firstSeen", { n: e.n, baseline: windowDef.value.baselineLabel });
  }
}

const RISK_BAR: Record<SeverityTone, "danger" | "warning" | "default"> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "default",
  info: "default",
  unknown: "default",
};
const RISK_TEXT: Record<SeverityTone, string> = {
  critical: "text-icon-chip-error-text",
  high: "text-icon-chip-orange-text",
  medium: "text-icon-chip-warning-text",
  low: "text-badge-blue-soft-text",
  info: "text-text-secondary",
  unknown: "text-text-secondary",
};

// ── Summary strip ────────────────────────────────────────────────────────────
const stats = computed<StatItem[]>(() => {
  const count = (tone: SeverityTone) => risks.value.filter((r) => r.tone === tone).length;
  const n = risks.value.length || undefined;
  return [
    {
      key: "critical",
      label: t("siem.ueba.stat.critical"),
      value: count("critical"),
      icon: "emergency",
      tone: "error",
      max: n,
      dataTest: "security-ueba-stat-critical",
    },
    {
      key: "high",
      label: t("siem.ueba.stat.high"),
      value: count("high"),
      icon: "warning",
      tone: "orange",
      max: n,
      dataTest: "security-ueba-stat-high",
    },
    {
      key: "medium",
      label: t("siem.ueba.stat.medium"),
      value: count("medium"),
      icon: "report-problem",
      tone: "warning",
      max: n,
      dataTest: "security-ueba-stat-medium",
    },
    {
      key: "all",
      label: t("siem.ueba.stat.all"),
      value: risks.value.length,
      icon: "groups",
      tone: "neutral",
      dataTest: "security-ueba-stat-all",
    },
  ];
});
function onStat(key: string) {
  toneFilter.value = key === "all" || toneFilter.value === key ? "all" : (key as SeverityTone);
}

// ── Drawer ───────────────────────────────────────────────────────────────────
const selected = ref<UserRisk | null>(null);
const drawerTab = ref("signals");
// OTable is generic, so its instance type is taken structurally: only `table` is used.
const tableRef = ref<{ table?: unknown } | null>(null);
const nav = useTableRowNavigation<UserRisk>(tableRef, filtered, (r) => r.user);
const drawerIndex = nav.index;
const drawerTotal = ref(0);
function relocate() {
  nav.locate(selected.value);
  drawerTotal.value = nav.total();
}
watch(filtered, () => void nextTick(relocate));

function openUser(r: UserRisk) {
  selected.value = r;
  syncUrl();
  relocate();
}
function closeDrawer() {
  if (!selected.value) return;
  selected.value = null;
  syncUrl();
}
function step(delta: number) {
  const next = nav.neighbour(selected.value, delta);
  if (next) openUser(next);
}
// Built from the intended query, not window.location, which may not have
// caught up with router.replace yet.
const shareUrl = computed(() => {
  if (!selected.value || typeof window === "undefined") return "";
  const query = { org_identifier: orgId.value, period: win.value, user: selected.value.user };
  return new URL(
    router.resolve({ path: route.path, query }).href,
    window.location.origin,
  ).toString();
});

/** "5 hours" / "3 days" — how much history a baseline really covered. */
function fmtSpan(us: number): string {
  const hours = Math.max(0, Math.round(us / HOUR_US));
  return hours >= 48
    ? t("siem.ueba.spanDays", Math.round(hours / 24))
    : t("siem.ueba.spanHours", hours);
}

const rate = (events: number, failures: number) =>
  events ? Math.round((failures / events) * 100) : 0;

const facts = computed<RecordFact[]>(() => {
  const r = selected.value;
  if (!r) return [];
  return [
    { label: t("siem.ueba.col.risk"), value: t("siem.ueba.fact.scoreValue", { n: r.score }) },
    {
      label: t("siem.ueba.fact.events"),
      value: r.volumeJudged
        ? t("siem.ueba.fact.eventsValue", {
            n: formatEventCount(r.current.events),
            expected: formatEventCount(Math.round(r.expected)),
          })
        : formatEventCount(r.current.events),
    },
    {
      label: t("siem.ueba.fact.failureRate"),
      value: !r.current.failureEvents
        ? "—"
        : t("siem.ueba.fact.failureValue", {
            now: rate(r.current.failureEvents, r.current.failures),
            base: r.baseline?.failureEvents
              ? rate(r.baseline.failureEvents, r.baseline.failures)
              : "—",
          }),
    },
    {
      label: t("siem.ueba.fact.history"),
      value: r.baseline
        ? t("siem.ueba.fact.historyValue", {
            span: fmtSpan(r.baselineSpanUs),
            window: windowDef.value.baselineLabel,
          })
        : t("siem.ueba.fact.noHistory"),
    },
  ];
});

const ipRows = computed(() => {
  const r = selected.value;
  if (!r) return [];
  return [...r.current.ips.entries()]
    .map(([ip, c]) => ({
      ip,
      ...c,
      // "New" only where new-IP was actually judged for this user.
      isNew: !r.withheld.includes("new_ip") && !!r.baseline?.ips.size && !r.baseline.ips.has(ip),
      external: isExternalIp(ip),
    }))
    .sort((a, b) => b.events - a.events);
});

/** 24 cells per row; intensity is a share of that row's busiest hour. */
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const INTENSITY = ["opacity-10", "opacity-25", "opacity-50", "opacity-75", "opacity-100"];
function hourClass(map: Map<number, number> | undefined, h: number, isNow: boolean) {
  const n = map?.get(h) ?? 0;
  if (!n) return "bg-surface-subtle";
  const max = Math.max(...(map ? [...map.values()] : [1]));
  const level = INTENSITY[Math.min(4, Math.floor((n / max) * 4.999))];
  // Red only when "unusual hours" was actually judged for this user.
  const unusual =
    isNow &&
    !!selected.value?.hoursEligible &&
    !!selected.value.baseline &&
    !selected.value.baseline.hours.has(h);
  return `${unusual ? "bg-badge-error-solid-bg" : "bg-accent"} ${level}`;
}

const drawerTabs = computed<RecordTab[]>(() => [
  {
    name: "signals",
    label: t("siem.ueba.tab.signals"),
    icon: "insights",
    count: selected.value?.signals.length || null,
  },
  { name: "hours", label: t("siem.ueba.tab.hours"), icon: "schedule" },
  { name: "ips", label: t("siem.ueba.tab.ips"), icon: "lan", count: ipRows.value.length || null },
]);

function openEntity() {
  if (!selected.value) return;
  router.push({
    path: "/security/entities",
    query: {
      org_identifier: orgId.value,
      kind: "user",
      period: win.value,
      entity: selected.value.user,
    },
  });
}
function openIp(ip: string) {
  router.push({
    path: "/security/entities",
    query: { org_identifier: orgId.value, kind: "ip", period: win.value, entity: ip },
  });
}
function openEvents() {
  const r = selected.value;
  if (!r) return;
  const stream = [...r.current.streams][0];
  const column = plans.value.find((p) => p.stream === stream)?.columns.user;
  if (!stream || !column) return;
  router.push({
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream,
      period: win.value,
      filters: b64EncodeUnicode(JSON.stringify([{ field: column, op: "=", value: r.user }])) ?? "",
    },
  });
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    toneFilter.value = "all";
  }
}
const noUserSources = computed(
  () =>
    !plansLoading.value &&
    !loading.value &&
    !plansError.value &&
    !plans.value.some((p) => p.columns.user),
);
</script>

<template>
  <OPageLayout
    :title="t('siem.ueba.title')"
    :subtitle="t('siem.ueba.subtitle')"
    icon="insights"
    bleed
    title-data-test="security-ueba-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <OToggleGroup
          :model-value="win"
          data-test="security-ueba-window"
          @update:model-value="onWindow"
        >
          <OToggleGroupItem
            v-for="w in WINDOWS"
            :key="w.value"
            :value="w.value"
            size="sm"
            :tooltip="
              t('siem.ueba.windowHint', {
                current: t(`siem.range.${w.value}`),
                baseline: w.baselineLabel,
              })
            "
          >
            {{ t(`siem.range.${w.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          data-test="security-ueba-refresh"
          @click="refresh"
        />
      </div>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OBanner
        variant="info"
        icon="insights"
        dense
        class="mx-page-edge mt-2"
        data-test="security-ueba-method"
      >
        {{
          t("siem.ueba.method", {
            current: t(`siem.range.${win}`),
            baseline: windowDef.baselineLabel,
          })
        }}
      </OBanner>
      <OBanner
        v-if="
          withheld.length || currentPartial || excludedStreams.length || noHistoryStreams.length
        "
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-ueba-partial"
      >
        <template v-if="withheld.length">{{
          t("siem.ueba.withheld", {
            signals: withheld.map((k) => t(`siem.ueba.signal.${k}`)).join(", "),
          })
        }}</template>
        <template v-if="currentPartial"> {{ t("siem.ueba.currentPartial") }}</template>
        <template v-if="excludedStreams.length">
          {{ t("siem.ueba.excluded", { streams: excludedStreams.join(", ") }) }}
        </template>
        <template v-if="noHistoryStreams.length">
          {{
            t("siem.ueba.noHistory", {
              streams: noHistoryStreams.join(", "),
              baseline: windowDef.baselineLabel,
            })
          }}
        </template>
      </OBanner>

      <OEmptyState
        v-if="noUserSources"
        size="hero"
        icon="person"
        :title="t('siem.ueba.noSources')"
        :description="t('siem.ueba.noSourcesHint')"
      />
      <OTable
        v-else
        ref="tableRef"
        :data="filtered"
        :columns="columns"
        row-key="user"
        :loading="loading && !lastRunAt"
        :error="plansError || null"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-ueba"
        :get-row-status-color="(r: UserRisk) => severityRailColor(r.tone)"
        :row-class="(r: UserRisk) => (selected?.user === r.user ? '!bg-table-row-selected-bg' : '')"
        class="min-h-0 flex-1"
        data-test="security-ueba-table"
        @row-click="openUser"
        @sort-change="() => nextTick(relocate)"
      >
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip
              :items="stats"
              :loading="loading && !lastRunAt"
              selectable
              :selected-key="toneFilter === 'all' ? null : toneFilter"
              data-test="security-ueba-stats"
              @select="onStat"
            />
          </div>
        </template>
        <template #toolbar>
          <OSearchInput
            v-model="search"
            :placeholder="t('siem.ueba.search')"
            class="max-w-md flex-1"
            data-test="security-ueba-search"
          />
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-ueba-refresh-table"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.entities.refresh')" />
          </OButton>
        </template>

        <template #cell-user="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <OIcon name="person" size="sm" class="text-text-secondary shrink-0" />
            <span class="text-text-heading truncate font-medium">{{ row.user }}</span>
          </div>
        </template>
        <template #cell-score="{ row }">
          <div class="flex w-full items-center gap-2">
            <span
              class="w-8 text-right text-sm font-semibold tabular-nums"
              :class="RISK_TEXT[row.tone as SeverityTone]"
              >{{ row.score }}</span
            >
            <OProgressBar
              :value="row.score / 100"
              :variant="RISK_BAR[row.tone as SeverityTone]"
              size="xs"
              class="flex-1"
            />
          </div>
        </template>
        <template #cell-signals="{ row }">
          <div class="flex flex-wrap gap-1">
            <OTag
              v-for="sig in row.signals"
              :key="sig.kind"
              :variant="SIGNAL_TAG[sig.kind as UebaSignalKind]"
              :icon="SIGNAL_ICON[sig.kind as UebaSignalKind]"
              size="xs"
              >{{ t(`siem.ueba.signal.${sig.kind}`) }}<OTooltip :content="reason(sig)"
            /></OTag>
            <span v-if="!row.signals.length" class="text-text-secondary">—</span>
          </div>
        </template>
        <template #cell-events="{ row }">
          <span class="tabular-nums">{{ formatEventCount(row.current.events) }}</span>
          <span v-if="row.baseline && row.volumeJudged" class="text-text-secondary ml-1 text-xs">
            {{ t("siem.ueba.expected", { n: formatEventCount(Math.round(row.expected)) }) }}
          </span>
          <OTag v-else-if="!row.baseline" variant="blue-soft" size="xs" class="ml-1">{{
            t("siem.ueba.new")
          }}</OTag>
        </template>
        <template #cell-failures="{ row }">
          <span class="tabular-nums">{{
            row.current.failureEvents ? formatEventCount(row.current.failures) : "—"
          }}</span>
        </template>
        <template #cell-ips="{ row }">
          <span class="tabular-nums">{{ row.current.ips.size || "—" }}</span>
        </template>

        <template #error="{ message }">
          <OEmptyState
            size="block"
            icon="error-outline"
            :title="t('siem.ueba.loadError')"
            :description="message"
            :action-label="t('siem.entities.refresh')"
            @action="refresh"
          />
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="task-alt"
            :title="t('siem.ueba.empty')"
            :description="t('siem.ueba.emptyHint')"
            :filtered="!!search.trim() || toneFilter !== 'all'"
            @action="onEmptyAction"
          />
        </template>
      </OTable>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="selected.user"
      :eyebrow="t('siem.ueba.eyebrow')"
      :subtitle="
        t('siem.ueba.windowHint', {
          current: t(`siem.range.${win}`),
          baseline: windowDef.baselineLabel,
        })
      "
      icon="person"
      :tone="selected.tone"
      :facts="facts"
      :tabs="drawerTabs"
      :index="drawerIndex"
      :total="drawerTotal"
      :share-url="shareUrl"
      data-test="security-ueba-drawer"
      @close="closeDrawer"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          type="severity"
          :value="severityTagValue(selected.tone)"
          :label="
            t('siem.ueba.riskChip', { tone: t(toneLabelKey(selected.tone)), score: selected.score })
          "
          size="sm"
        />
        <OTag
          v-for="s in [...selected.current.streams]"
          :key="s"
          variant="default-soft"
          size="sm"
          class="font-mono"
          >{{ s }}</OTag
        >
      </template>

      <template #tab-signals>
        <OBanner
          v-if="!selected.volumeJudged && selected.baseline"
          variant="default"
          icon="info-outline"
          dense
          data-test="security-ueba-drawer-volume-not-judged"
        >
          {{ t("siem.ueba.volumeNotJudged") }}
        </OBanner>
        <div
          v-for="sig in selected.signals"
          :key="sig.kind"
          class="border-border-default rounded-surface flex items-start gap-3 border p-3"
          :data-test="`security-ueba-drawer-signal-${sig.kind}`"
        >
          <OTag :variant="SIGNAL_TAG[sig.kind]" :icon="SIGNAL_ICON[sig.kind]" size="sm">{{
            t(`siem.ueba.signal.${sig.kind}`)
          }}</OTag>
          <p class="text-text-heading min-w-0 flex-1 text-sm leading-relaxed">{{ reason(sig) }}</p>
          <span class="text-text-secondary text-xs font-semibold tabular-nums"
            >+{{ sig.weight }}</span
          >
        </div>
        <OBanner
          v-if="selected.withheld.length"
          variant="warning"
          icon="warning-amber"
          dense
          data-test="security-ueba-drawer-withheld"
        >
          {{
            t("siem.ueba.notEvaluated", {
              signals: selected.withheld.map((k) => t(`siem.ueba.signal.${k}`)).join(", "),
            })
          }}
        </OBanner>
        <OEmptyState
          v-if="!selected.signals.length"
          size="inline"
          icon="task-alt"
          :title="t('siem.ueba.noSignals')"
          :description="t('siem.ueba.noSignalsHint')"
        />
        <p class="text-text-secondary text-xs leading-relaxed">
          {{
            t("siem.ueba.scoring", {
              min: UEBA_THRESHOLDS.volumeMinEvents,
              ratio: UEBA_THRESHOLDS.volumeRatio,
              share: Math.round(UEBA_THRESHOLDS.hoursMinSpanShare * 100),
              baseline: windowDef.baselineLabel,
            })
          }}
        </p>
      </template>

      <template #tab-hours>
        <OBanner
          v-if="!selected.hoursEligible"
          variant="default"
          icon="info-outline"
          dense
          data-test="security-ueba-drawer-hours-not-judged"
        >
          {{
            t("siem.ueba.hoursNotJudged", {
              min: UEBA_THRESHOLDS.hoursMinBaseline,
              share: Math.round(UEBA_THRESHOLDS.hoursMinSpanShare * 100),
              baseline: windowDef.baselineLabel,
            })
          }}
        </OBanner>
        <div
          class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
          data-test="security-ueba-drawer-hours"
        >
          <div class="flex items-center justify-between">
            <span class="text-text-heading text-sm font-semibold">{{
              t("siem.ueba.hoursTitle")
            }}</span>
            <span class="text-text-secondary text-xs">{{ t("siem.ueba.hoursUtc") }}</span>
          </div>
          <div
            v-for="row in [
              {
                key: 'baseline',
                label: t('siem.ueba.baselineRow', { w: windowDef.baselineLabel }),
                map: selected.baseline?.hours,
                now: false,
              },
              {
                key: 'now',
                label: t('siem.ueba.nowRow', { w: t(`siem.range.${win}`) }),
                map: selected.current.hours,
                now: true,
              },
            ]"
            :key="row.key"
            class="flex items-center gap-2"
          >
            <span class="text-text-secondary w-28 shrink-0 text-xs">{{ row.label }}</span>
            <div class="grid flex-1 grid-cols-24 gap-0.5">
              <span
                v-for="h in HOURS"
                :key="h"
                class="rounded-default h-6"
                :class="hourClass(row.map, h, row.now)"
                ><OTooltip
                  :content="
                    t('siem.ueba.hourCell', {
                      h: String(h).padStart(2, '0'),
                      n: row.map?.get(h) ?? 0,
                    })
                  "
              /></span>
            </div>
          </div>
          <div class="text-text-secondary text-3xs grid grid-cols-24 gap-0.5 pl-30">
            <span v-for="h in HOURS" :key="h" class="text-center">{{
              h % 6 === 0 ? String(h).padStart(2, "0") : ""
            }}</span>
          </div>
          <div class="text-text-secondary text-2xs flex items-center gap-3">
            <span class="flex items-center gap-1.5"
              ><span class="bg-accent rounded-default size-3" />{{
                t("siem.ueba.legendUsual")
              }}</span
            >
            <span class="flex items-center gap-1.5"
              ><span class="bg-badge-error-solid-bg rounded-default size-3" />{{
                t("siem.ueba.legendNew")
              }}</span
            >
          </div>
        </div>
      </template>

      <template #tab-ips>
        <div class="border-border-default rounded-surface overflow-hidden border">
          <div
            v-for="ip in ipRows"
            :key="ip.ip"
            class="group border-border-subtle hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-3 border-b px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
            role="button"
            tabindex="0"
            :data-test="`security-ueba-drawer-ip-${ip.ip}`"
            @click="openIp(ip.ip)"
            @keydown.enter="openIp(ip.ip)"
            @keydown.space.prevent="openIp(ip.ip)"
          >
            <OIcon name="lan" size="sm" class="text-text-secondary" />
            <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-sm">{{
              ip.ip
            }}</span>
            <OTag v-if="ip.isNew" variant="error-soft" size="xs">{{ t("siem.ueba.newIp") }}</OTag>
            <OTag v-if="ip.external" variant="blue-soft" size="xs">{{
              t("siem.entities.signal.external")
            }}</OTag>
            <OTag v-if="ip.failures" variant="default-soft" size="xs">{{
              t("siem.entities.failedCount", ip.failures)
            }}</OTag>
            <span class="text-text-secondary w-14 text-right text-xs tabular-nums">{{
              formatEventCount(ip.events)
            }}</span>
            <OIcon
              name="chevron-right"
              size="sm"
              class="text-text-secondary opacity-0 group-hover:opacity-100"
            />
          </div>
          <OEmptyState
            v-if="!ipRows.length"
            size="inline"
            icon="lan"
            :title="t('siem.ueba.noIps')"
          />
        </div>
      </template>

      <template #footer>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="groups"
          data-test="security-ueba-drawer-entity"
          @click="openEntity"
        >
          {{ t("siem.ueba.openEntity") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="manage-search"
          data-test="security-ueba-drawer-events"
          @click="openEvents"
        >
          {{ t("siem.entities.huntInEvents") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
