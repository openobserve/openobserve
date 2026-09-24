<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Content — what ships with the SIEM, set against what this org has.
     Two catalogs: the Sigma rule pack, and the log source types the SIEM can
     identify and normalise. Each is read against the org itself: a rule is
     "installed" when a SIEM detection runs it, and "applies to your data" when
     one of your streams is identified as a source the rule was written for.
     That last pair is the useful one — a rule that applies but is not
     installed is coverage you already paid for in ingestion and are not using. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import streamService from "@/services/stream";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { blockedReason, caveat, sigmaCatalog, type SigmaRule } from "@/utils/security/sigma";
import { SOURCE_TYPES, sigmaLogsourceLabel, type SourceType } from "@/utils/security/sourceTypes";
import { ocsfClass } from "@/utils/security/ocsf";
import { displayOrder, positionOf, stepRow, type NavTable } from "@/utils/security/recordNav";
import { normalizeTactic, techniqueUrl } from "@/utils/security/mitre";
import {
  groupByLogsource,
  installedBySigmaId,
  logsourceKey,
  rulesForSource,
  streamsBySource,
  streamsForRule,
  DETECTED_RAIL,
  checksByRule,
  type StreamCheck,
  type StreamSchema,
} from "@/utils/security/content";
import {
  SEVERITY_TONES,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";

const { t, te } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

type ContentTab = "rules" | "sources";
const tab = ref<ContentTab>(route.query.tab === "sources" ? "sources" : "rules");
watch(tab, (value) => router.replace({ query: { ...route.query, tab: value } }));

// ── Data ─────────────────────────────────────────────────────────────────────
const {
  siemRows,
  loading: rulesLoading,
  hydrating,
  unchecked,
  load: loadDetections,
} = useSiemDetections();
const streams = ref<StreamSchema[]>([]);
const streamsLoading = ref(false);
const streamsError = ref("");

async function loadStreams() {
  streamsLoading.value = true;
  streamsError.value = "";
  try {
    // One request carries every stream's schema, which is all identification needs.
    const res = await streamService.nameList(orgId.value, "logs", true);
    streams.value = (res.data?.list ?? []).map((s: any) => ({
      name: String(s.name),
      fields: (s.schema ?? []).map((f: any) => String(f.name)),
    }));
  } catch (e: any) {
    streams.value = [];
    streamsError.value = e?.response?.data?.message ?? e?.message ?? t("siem.content.streamsError");
  } finally {
    streamsLoading.value = false;
  }
}

function refresh() {
  void loadDetections(orgId.value);
  void loadStreams();
}
onMounted(refresh);
watch(orgId, refresh);

const catalog = computed(() => sigmaCatalog());
const installed = computed(() => installedBySigmaId(siemRows.value));
const bySource = computed(() => streamsBySource(streams.value));
const fieldsByStream = computed(() => new Map(streams.value.map((s) => [s.name, s.fields])));
/** Installed state is only trustworthy once every detection has been identified. */
const installPending = computed(() => rulesLoading.value || hydrating.value);
/**
 * "Not installed" can only be claimed when every alert was checked: past the
 * hydration limit a rule may be running as an alert nobody identified. An
 * installed rule is still known to be installed.
 */
const notInstalledKnown = computed(() => !installPending.value && unchecked.value === 0);

// ── Rules ────────────────────────────────────────────────────────────────────
interface RuleRow {
  id: string;
  title: string;
  tone: SeverityTone;
  logsource: string;
  techniques: string[];
  status: string;
  streams: string[];
  /** Matching streams the rule actually compiles on. */
  runnable: string[];
  checks: StreamCheck[];
  installed: boolean;
  rule: SigmaRule;
}

const checks = computed(() => checksByRule(bySource.value, fieldsByStream.value));

const ruleRows = computed<RuleRow[]>(() =>
  catalog.value.map((rule) => {
    const ruleChecks = checks.value.get(rule) ?? [];
    return {
      id: rule.id ?? rule.title,
      title: rule.title,
      tone: toneOfSigmaLevel(rule.level),
      logsource: logsourceKey(rule),
      techniques: rule.techniques,
      status: rule.status ?? "",
      streams: streamsForRule(rule, bySource.value),
      runnable: ruleChecks.filter((c) => c.compiled.runnable).map((c) => c.stream),
      checks: ruleChecks,
      installed: installed.value.has(rule.id ?? ""),
      rule,
    };
  }),
);

/** Applies to your data and would run there, but no detection runs it yet. */
const isReady = (r: RuleRow) => r.runnable.length > 0 && !r.installed && notInstalledKnown.value;

type RuleFacet = "ready" | "installed" | "applies";
const ruleFacet = ref<RuleFacet | null>(null);
const ruleSearch = ref("");
const ruleLevel = ref<string | null>(null);
const logsourceFilter = ref<string | null>(null);

const ruleCounts = computed(() => ({
  ready: ruleRows.value.filter(isReady).length,
  installed: ruleRows.value.filter((r) => r.installed).length,
  applies: ruleRows.value.filter((r) => r.streams.length).length,
}));

const filteredRules = computed(() => {
  const needle = ruleSearch.value.trim().toLowerCase();
  return ruleRows.value.filter((r) => {
    if (ruleFacet.value === "ready" && !isReady(r)) return false;
    if (ruleFacet.value === "installed" && !r.installed) return false;
    if (ruleFacet.value === "applies" && !r.streams.length) return false;
    if (ruleLevel.value && r.tone !== ruleLevel.value) return false;
    if (logsourceFilter.value && r.logsource !== logsourceFilter.value) return false;
    if (!needle) return true;
    return (
      r.title.toLowerCase().includes(needle) ||
      r.logsource.toLowerCase().includes(needle) ||
      r.techniques.some((tech) => tech.toLowerCase().includes(needle))
    );
  });
});

const ruleFiltersActive = computed(
  () => !!ruleSearch.value || !!ruleLevel.value || !!ruleFacet.value || !!logsourceFilter.value,
);
function clearRuleFilters() {
  ruleSearch.value = "";
  ruleLevel.value = null;
  ruleFacet.value = null;
  logsourceFilter.value = null;
}

const ruleStats = computed<StatItem[]>(() => [
  {
    key: "ready",
    label: t("siem.content.stat.ready"),
    value: streamsLoading.value || !notInstalledKnown.value ? "—" : ruleCounts.value.ready,
    icon: "lightbulb",
    tone: "warning",
    max: ruleRows.value.length,
    dataTest: "security-content-stat-ready",
  },
  {
    key: "installed",
    label: t("siem.content.stat.installed"),
    value: installPending.value ? "—" : ruleCounts.value.installed,
    icon: "verified-user",
    tone: "success",
    max: ruleRows.value.length,
    dataTest: "security-content-stat-installed",
  },
  {
    key: "applies",
    label: t("siem.content.stat.applies"),
    value: streamsLoading.value ? "—" : ruleCounts.value.applies,
    icon: "database",
    tone: "primary",
    max: ruleRows.value.length,
    dataTest: "security-content-stat-applies",
  },
  {
    key: "all",
    label: t("siem.content.stat.allRules"),
    value: ruleRows.value.length,
    icon: "menu-book",
    tone: "neutral",
    dataTest: "security-content-stat-all",
  },
]);

function onRuleStat(key: string) {
  ruleFacet.value = key === "all" || ruleFacet.value === key ? null : (key as RuleFacet);
}

const logsourceGroups = computed(() => groupByLogsource(catalog.value));
const levelOptions = computed(() =>
  SEVERITY_TONES.map((tone) => ({ label: t(toneLabelKey(tone)), value: tone })),
);

const ruleColumns = computed<OTableColumnDef<RuleRow>[]>(() => [
  { id: "severity", header: t("siem.common.severity"), accessorKey: "tone", size: 110 },
  {
    id: "title",
    header: t("siem.content.column.rule"),
    accessorKey: "title",
    size: 340,
    minSize: 220,
    meta: { isName: true },
    sortable: true,
  },
  {
    id: "logsource",
    header: t("siem.content.column.logsource"),
    accessorKey: "logsource",
    size: 200,
    hideable: true,
    sortable: true,
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
    header: t("siem.content.column.status"),
    accessorKey: "status",
    size: 110,
    hideable: true,
  },
  { id: "streams", header: t("siem.content.column.yourData"), accessorKey: "streams", size: 150 },
  {
    id: "installed",
    header: t("siem.content.column.installed"),
    accessorKey: "installed",
    size: 130,
  },
]);

// ── Sources ──────────────────────────────────────────────────────────────────
interface SourceRow {
  id: string;
  label: string;
  vendor: string;
  ocsf: string;
  logsource: string;
  rules: number;
  streams: string[];
  telemetryOnly: boolean;
  source: SourceType;
}

const sourceRows = computed<SourceRow[]>(() =>
  SOURCE_TYPES.map((source) => ({
    id: source.id,
    label: source.label,
    vendor: source.vendor,
    ocsf: ocsfClass(source.ocsfClass)?.name ?? String(source.ocsfClass || "—"),
    logsource: sigmaLogsourceLabel(source.sigma) || "—",
    rules: rulesForSource(source, catalog.value).length,
    streams: bySource.value.get(source.id) ?? [],
    telemetryOnly: !!source.telemetryOnly,
    source,
  })),
);

const sourceFacet = ref<"detected" | null>(null);
const sourceSearch = ref("");
const filteredSources = computed(() => {
  const needle = sourceSearch.value.trim().toLowerCase();
  return sourceRows.value.filter((r) => {
    if (sourceFacet.value === "detected" && !r.streams.length) return false;
    if (!needle) return true;
    return (
      r.label.toLowerCase().includes(needle) ||
      r.vendor.toLowerCase().includes(needle) ||
      r.logsource.toLowerCase().includes(needle)
    );
  });
});

const sourceStats = computed<StatItem[]>(() => [
  {
    key: "detected",
    label: t("siem.content.stat.detected"),
    value: streamsLoading.value ? "—" : sourceRows.value.filter((r) => r.streams.length).length,
    icon: "database",
    tone: "success",
    max: sourceRows.value.length,
    dataTest: "security-content-stat-detected",
  },
  {
    key: "all",
    label: t("siem.content.stat.supported"),
    value: sourceRows.value.length,
    icon: "category",
    tone: "neutral",
    dataTest: "security-content-stat-supported",
  },
]);

const sourceColumns = computed<OTableColumnDef<SourceRow>[]>(() => [
  {
    id: "label",
    header: t("siem.content.column.source"),
    accessorKey: "label",
    meta: { isName: true },
    sortable: true,
  },
  {
    id: "vendor",
    header: t("siem.content.column.vendor"),
    accessorKey: "vendor",
    size: 180,
    hideable: true,
    sortable: true,
  },
  {
    id: "ocsf",
    header: t("siem.content.column.ocsf"),
    accessorKey: "ocsf",
    size: 190,
    hideable: true,
  },
  {
    id: "logsource",
    header: t("siem.content.column.logsource"),
    accessorKey: "logsource",
    size: 230,
    hideable: true,
  },
  {
    id: "rules",
    header: t("siem.content.column.rules"),
    accessorKey: "rules",
    size: 90,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "streams",
    header: t("siem.content.column.yourStreams"),
    accessorKey: "streams",
    size: 200,
  },
]);

// ── Drawers ──────────────────────────────────────────────────────────────────
const openRuleId = ref<string | null>(route.query.rule ? String(route.query.rule) : null);
const openSourceId = ref<string | null>(route.query.source ? String(route.query.source) : null);
const ruleTab = ref("overview");
const sourceTab = ref("streams");

const openRule = computed(() => ruleRows.value.find((r) => r.id === openRuleId.value) ?? null);
const openSource = computed(
  () => sourceRows.value.find((r) => r.id === openSourceId.value) ?? null,
);
// Prev/next walk the list the drawer was opened from, in the order it is
// displayed: the rules table (sorted, paged), the sources table, or — for a rule
// opened from a source drawer — that source's rule list.
const rulesTable = ref<{ table: NavTable<RuleRow> } | null>(null);
const sourcesTable = ref<{ table: NavTable<SourceRow> } | null>(null);
/** Set when a rule was opened from a source drawer; its rules are the list. */
const ruleContextSource = ref<string | null>(null);
const ruleIndex = ref<number | null>(null);
const sourceIndex = ref<number | null>(null);

const contextRuleIds = computed(() => {
  const source = SOURCE_TYPES.find((s) => s.id === ruleContextSource.value);
  return source ? rulesForSource(source, catalog.value).map((r) => r.id ?? r.title) : null;
});
const ruleTotal = computed(() => contextRuleIds.value?.length ?? filteredRules.value.length);

function syncIndexes() {
  const ids = contextRuleIds.value;
  ruleIndex.value = ids
    ? positionOf(ids, (id) => id === openRuleId.value)
    : positionOf(
        displayOrder(rulesTable.value?.table, filteredRules.value),
        (r) => r.id === openRuleId.value,
      );
  sourceIndex.value = positionOf(
    displayOrder(sourcesTable.value?.table, filteredSources.value),
    (r) => r.id === openSourceId.value,
  );
}
watch([filteredRules, filteredSources, openRuleId, openSourceId, contextRuleIds], () =>
  nextTick(syncIndexes),
);

function showRule(id: string | null, fromSource: string | null = null) {
  ruleContextSource.value = id ? fromSource : null;
  openSourceId.value = null;
  openRuleId.value = id;
  const { rule: _r, source: _s, ...rest } = route.query;
  router.replace({ query: id ? { ...rest, rule: id } : rest });
}
function showSource(id: string | null) {
  openRuleId.value = null;
  openSourceId.value = id;
  const { rule: _r, source: _s, ...rest } = route.query;
  router.replace({ query: id ? { ...rest, source: id } : rest });
}
function stepRule(delta: number) {
  const ids = contextRuleIds.value;
  if (ids) {
    const next = stepRow(null, ids, (id) => id === openRuleId.value, delta);
    if (next) showRule(next.row, ruleContextSource.value);
    return;
  }
  const next = stepRow(
    rulesTable.value?.table,
    filteredRules.value,
    (r) => r.id === openRuleId.value,
    delta,
  );
  if (next) showRule(next.row.id);
}
function stepSource(delta: number) {
  const next = stepRow(
    sourcesTable.value?.table,
    filteredSources.value,
    (r) => r.id === openSourceId.value,
    delta,
  );
  if (next) showSource(next.row.id);
}

function shareFor(key: "rule" | "source", id: string | undefined) {
  if (!id || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("tab", key === "rule" ? "rules" : "sources");
  url.searchParams.set(key, id);
  return url.toString();
}

// Rule drawer: how the rule compiles against each of your matching streams.
const ruleStreamChecks = computed<StreamCheck[]>(() => openRule.value?.checks ?? []);

const ruleTabs = computed<RecordTab[]>(() => [
  { name: "overview", label: t("siem.content.tab.overview"), icon: "dashboard" },
  {
    name: "streams",
    label: t("siem.content.tab.yourData"),
    icon: "database",
    count: ruleStreamChecks.value.length || null,
  },
  { name: "yaml", label: t("siem.content.tab.yaml"), icon: "code" },
]);

const ruleFacts = computed<RecordFact[]>(() => {
  const row = openRule.value;
  const rule = row?.rule;
  if (!row || !rule) return [];
  const detections = installed.value.get(rule.id ?? "")?.length ?? 0;
  return [
    { label: t("siem.common.severity"), value: t(toneLabelKey(toneOfSigmaLevel(rule.level))) },
    {
      label: t("siem.content.column.status"),
      value: rule.status ? t(`siem.content.status.${rule.status}`) : "",
    },
    {
      label: t("siem.content.column.yourData"),
      value: row.streams.length
        ? t("siem.content.streamCount", row.streams.length)
        : t("siem.content.noMatchingData"),
    },
    {
      label: t("siem.content.column.installed"),
      value: installPending.value
        ? "—"
        : detections
          ? t("siem.content.detectionCount", detections)
          : notInstalledKnown.value
            ? t("siem.content.notInstalled")
            : "—",
    },
    { label: t("siem.content.field.author"), value: rule.author },
    { label: t("siem.content.field.modified"), value: rule.modified ?? rule.date },
  ];
});

const ruleTactics = computed(() =>
  (openRule.value?.rule.tactics ?? [])
    .map((x) => normalizeTactic(x))
    .filter((x): x is NonNullable<typeof x> => !!x),
);

/** The detection already running this rule, when there is exactly one to open. */
const installedDetection = computed(() => {
  const id = openRule.value?.rule.id;
  return id ? (installed.value.get(id)?.[0] ?? null) : null;
});

function install(ruleId: string, stream?: string, sourceId?: string) {
  router.push({
    path: "/security/detections",
    query: {
      org_identifier: orgId.value,
      sigma_id: ruleId,
      ...(stream ? { stream } : {}),
      ...(sourceId ? { source: sourceId } : {}),
    },
  });
}

/** One-click install targets the stream only when there is a single runnable one. */
function installDefault(row: RuleRow) {
  const runnable = row.checks.filter((c) => c.compiled.runnable);
  const only = runnable.length === 1 ? runnable[0] : null;
  install(row.id, only?.stream, only?.source.id);
}

function viewDetection() {
  const id = installedDetection.value?.alert.id;
  if (!id) return;
  router.push({
    path: "/security/detections",
    query: { org_identifier: orgId.value, detection: String(id) },
  });
}

// Source drawer
const sourceRulesList = computed(() =>
  openSource.value ? rulesForSource(openSource.value.source, catalog.value) : [],
);
const sourceTabs = computed<RecordTab[]>(() => [
  {
    name: "streams",
    label: t("siem.content.tab.yourStreams"),
    icon: "database",
    count: openSource.value?.streams.length || null,
  },
  {
    name: "rules",
    label: t("siem.content.tab.rules"),
    icon: "rule",
    count: sourceRulesList.value.length || null,
  },
  { name: "mapping", label: t("siem.content.tab.mapping"), icon: "account-tree" },
]);
const sourceFacts = computed<RecordFact[]>(() => {
  const row = openSource.value;
  if (!row) return [];
  return [
    { label: t("siem.content.column.vendor"), value: row.vendor },
    { label: t("siem.content.column.ocsf"), value: row.ocsf },
    { label: t("siem.content.column.logsource"), value: row.logsource, mono: true },
    { label: t("siem.content.column.rules"), value: row.rules },
  ];
});
const mappingRows = computed<KeyValueRow[]>(() => {
  const source = openSource.value?.source;
  if (!source) return [];
  const rows: KeyValueRow[] = [
    {
      key: "required",
      label: t("siem.content.field.required"),
      value: source.required.join(", "),
      mono: true,
    },
  ];
  if (source.signals?.length) {
    rows.push({
      key: "signals",
      label: t("siem.content.field.signals"),
      value: source.signals.join(", "),
      mono: true,
    });
  }
  for (const [column, paths] of Object.entries(source.map)) {
    if (!paths?.length) continue;
    rows.push({
      key: `map.${column}`,
      label: te(`siem.column.${column}`)
        ? t(`siem.column.${column}`)
        : t(`siem.content.mapColumn.${column}`, column),
      value: (paths as string[]).join(" · "),
      mono: true,
    });
  }
  return rows;
});

function openInEvents(stream: string) {
  router.push({
    path: "/security/events",
    query: { org_identifier: orgId.value, stream, period: "24h" },
  });
}

const STATUS_VARIANT: Record<string, "success-soft" | "blue-soft" | "amber-soft" | "default-soft"> =
  {
    stable: "success-soft",
    test: "blue-soft",
    experimental: "amber-soft",
  };
</script>

<template>
  <OPageLayout
    :title="t('siem.content.title')"
    :subtitle="t('siem.content.subtitle')"
    icon="menu-book"
    bleed
    :resizable="false"
    :sidebar-width="tab === 'rules' ? 256 : undefined"
    title-data-test="security-content-title"
  >
    <template #actions>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="streamsLoading || rulesLoading"
        data-test="security-content-refresh"
        @click="refresh"
      >
        <OTooltip :content="t('siem.content.refresh')" />
      </OButton>
    </template>

    <template #subnav>
      <OTabs v-model="tab" data-test="security-content-tabs">
        <OTab name="rules" data-test="security-content-tab-rules">
          <span class="flex items-center gap-1.5">
            <OIcon name="rule" size="sm" />{{ t("siem.content.tab.rules") }}
            <span
              class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
              >{{ catalog.length }}</span
            >
          </span>
        </OTab>
        <OTab name="sources" data-test="security-content-tab-sources">
          <span class="flex items-center gap-1.5">
            <OIcon name="database" size="sm" />{{ t("siem.content.tab.sources") }}
            <span
              class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
              >{{ SOURCE_TYPES.length }}</span
            >
          </span>
        </OTab>
      </OTabs>
    </template>

    <template v-if="tab === 'rules'" #sidebar>
      <nav
        class="flex min-h-0 flex-1 flex-col overflow-y-auto py-2"
        data-test="security-content-logsources"
      >
        <span
          class="px-page-edge text-text-secondary text-2xs pb-1 font-semibold tracking-wide uppercase"
        >
          {{ t("siem.content.logsources") }}
        </span>
        <ul class="flex flex-col">
          <li
            role="button"
            tabindex="0"
            class="px-page-edge hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
            :class="
              !logsourceFilter
                ? 'bg-surface-subtle text-text-heading font-semibold'
                : 'text-text-heading'
            "
            data-test="security-content-logsource-all"
            @click="logsourceFilter = null"
            @keydown.enter="logsourceFilter = null"
            @keydown.space.prevent="logsourceFilter = null"
          >
            <span class="min-w-0 flex-1 truncate">{{ t("siem.content.allLogsources") }}</span>
            <span class="text-text-secondary text-2xs tabular-nums">{{ catalog.length }}</span>
          </li>
          <li
            v-for="group in logsourceGroups"
            :key="group.key"
            role="button"
            tabindex="0"
            class="px-page-edge hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset"
            :class="logsourceFilter === group.key ? 'bg-surface-subtle font-semibold' : ''"
            :data-test="`security-content-logsource-${group.key}`"
            @click="logsourceFilter = logsourceFilter === group.key ? null : group.key"
            @keydown.enter="logsourceFilter = logsourceFilter === group.key ? null : group.key"
            @keydown.space.prevent="
              logsourceFilter = logsourceFilter === group.key ? null : group.key
            "
          >
            <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-xs"
              >{{ group.label }}<OTooltip :content="group.label"
            /></span>
            <span class="text-text-secondary text-2xs tabular-nums">{{ group.count }}</span>
          </li>
        </ul>
      </nav>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OBanner
        v-if="unchecked > 0"
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-content-unchecked"
      >
        {{ t("siem.content.unchecked", unchecked) }}
      </OBanner>
      <OBanner
        v-if="streamsError"
        variant="error-soft"
        icon="error-outline"
        dense
        class="mx-page-edge mt-2"
        data-test="security-content-streams-error"
      >
        {{ streamsError }}
      </OBanner>

      <!-- ── Rules ──────────────────────────────────────────────────────── -->
      <OTable
        v-if="tab === 'rules'"
        :data="filteredRules"
        :columns="ruleColumns"
        row-key="id"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-content-rules"
        :enable-column-resize="true"
        :get-row-status-color="(row: RuleRow) => severityRailColor(row.tone)"
        class="min-h-0 flex-1"
        ref="rulesTable"
        data-test="security-content-rules-table"
        @sort-change="() => nextTick(syncIndexes)"
        @row-click="(row: RuleRow) => showRule(row.id)"
      >
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip
              :items="ruleStats"
              selectable
              :selected-key="ruleFacet"
              data-test="security-content-rule-stats"
              @select="onRuleStat"
            />
          </div>
        </template>
        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <div class="w-40 shrink-0">
              <OSelect
                :model-value="ruleLevel"
                :options="levelOptions"
                :placeholder="t('siem.content.anyLevel')"
                clearable
                data-test="security-content-level"
                @update:model-value="(v: unknown) => (ruleLevel = v ? String(v) : null)"
              />
            </div>
            <OSearchInput
              v-model="ruleSearch"
              class="flex-1"
              :placeholder="t('siem.content.searchRules')"
              data-test="security-content-search-rules"
            />
          </div>
        </template>
        <template #cell-severity="{ row }">
          <OTag
            type="severity"
            :value="severityTagValue(row.tone)"
            :label="t(toneLabelKey(row.tone))"
            size="xs"
          />
        </template>
        <template #cell-title="{ row }">
          <span class="text-text-heading truncate font-medium">{{ row.title }}</span>
        </template>
        <template #cell-logsource="{ row }">
          <span class="text-text-secondary truncate font-mono text-xs">{{ row.logsource }}</span>
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
            <span v-if="row.techniques.length > 2" class="text-text-secondary text-xs"
              >+{{ row.techniques.length - 2 }}</span
            >
            <span v-if="!row.techniques.length" class="text-text-secondary">—</span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <OTag
            v-if="row.status"
            :variant="STATUS_VARIANT[row.status] ?? 'default-soft'"
            size="xs"
            >{{ t(`siem.content.status.${row.status}`, row.status) }}</OTag
          >
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #cell-streams="{ row }">
          <span v-if="streamsLoading" class="text-text-secondary">—</span>
          <OTag v-else-if="row.streams.length" variant="primary-soft" icon="database" size="xs">{{
            t("siem.content.streamCount", row.streams.length)
          }}</OTag>
          <span v-else class="text-text-secondary text-xs">{{
            t("siem.content.noMatchingData")
          }}</span>
        </template>
        <template #cell-installed="{ row }">
          <span v-if="installPending" class="text-text-secondary">—</span>
          <OTag v-else-if="row.installed" variant="success-soft" icon="check-circle" size="xs">{{
            t("siem.content.installed")
          }}</OTag>
          <span v-else-if="!notInstalledKnown" class="text-text-secondary">—</span>
          <OTag v-else-if="row.runnable.length" variant="warning-soft" icon="lightbulb" size="xs">{{
            t("siem.content.readyToInstall")
          }}</OTag>
          <OTag v-else-if="row.streams.length" variant="default-soft" icon="block" size="xs">{{
            t("siem.content.cannotRun")
          }}</OTag>
          <span v-else class="text-text-secondary">—</span>
        </template>
        <template #empty>
          <OEmptyState
            size="block"
            icon="search-off"
            :title="t('siem.content.noRules')"
            :filtered="ruleFiltersActive"
            @action="(id?: string) => id === 'clear-filters' && clearRuleFilters()"
          />
        </template>
      </OTable>

      <!-- ── Sources ────────────────────────────────────────────────────── -->
      <OTable
        v-else
        :data="filteredSources"
        :columns="sourceColumns"
        row-key="id"
        :loading="streamsLoading && !streams.length"
        :page-size="50"
        :page-size-options="[50, 100]"
        :show-global-filter="false"
        :persist-columns="true"
        table-id="security-content-sources"
        :get-row-status-color="(row: SourceRow) => (row.streams.length ? DETECTED_RAIL : undefined)"
        class="min-h-0 flex-1"
        ref="sourcesTable"
        data-test="security-content-sources-table"
        @sort-change="() => nextTick(syncIndexes)"
        @row-click="(row: SourceRow) => showSource(row.id)"
      >
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip
              :items="sourceStats"
              selectable
              :selected-key="sourceFacet"
              data-test="security-content-source-stats"
              @select="
                (key: string) =>
                  (sourceFacet = key === 'all' || sourceFacet === key ? null : 'detected')
              "
            />
          </div>
        </template>
        <template #toolbar>
          <OSearchInput
            v-model="sourceSearch"
            class="w-full"
            :placeholder="t('siem.content.searchSources')"
            data-test="security-content-search-sources"
          />
        </template>
        <template #cell-label="{ row }">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="text-text-heading truncate font-medium">{{ row.label }}</span>
            <OTag v-if="row.telemetryOnly" variant="default-soft" size="xs">{{
              t("siem.content.telemetryOnly")
            }}</OTag>
          </div>
        </template>
        <template #cell-logsource="{ row }">
          <span class="text-text-secondary truncate font-mono text-xs">{{ row.logsource }}</span>
        </template>
        <template #cell-rules="{ row }">
          <span
            class="tabular-nums"
            :class="row.rules ? 'text-text-heading' : 'text-text-secondary'"
            >{{ row.rules }}</span
          >
        </template>
        <template #cell-streams="{ row }">
          <div v-if="row.streams.length" class="flex min-w-0 gap-1 overflow-hidden">
            <OTag
              v-for="s in row.streams.slice(0, 2)"
              :key="s"
              variant="success-soft"
              icon="database"
              size="xs"
              class="font-mono"
              >{{ s }}</OTag
            >
            <span v-if="row.streams.length > 2" class="text-text-secondary text-xs"
              >+{{ row.streams.length - 2 }}</span
            >
          </div>
          <span v-else class="text-text-secondary text-xs">{{
            t("siem.content.notDetected")
          }}</span>
        </template>
        <template #empty>
          <OEmptyState
            size="block"
            icon="search-off"
            :title="t('siem.content.noSources')"
            :filtered="!!sourceSearch || !!sourceFacet"
            @action="
              (id?: string) => {
                if (id === 'clear-filters') {
                  sourceSearch = '';
                  sourceFacet = null;
                }
              }
            "
          />
        </template>
      </OTable>
    </div>

    <!-- ── Rule drawer ────────────────────────────────────────────────────── -->
    <SecurityRecordDrawer
      v-if="openRule"
      :open="!!openRule"
      v-model:tab="ruleTab"
      :title="openRule.title"
      :eyebrow="t('siem.content.ruleEyebrow')"
      :subtitle="openRule.logsource"
      icon="rule"
      :tone="openRule.tone"
      :facts="ruleFacts"
      :tabs="ruleTabs"
      :index="ruleIndex"
      :total="ruleTotal"
      :share-url="shareFor('rule', openRule.id)"
      data-test="security-content-rule-drawer"
      @close="showRule(null)"
      @prev="stepRule(-1)"
      @next="stepRule(1)"
    >
      <template #chips>
        <OTag
          type="severity"
          :value="severityTagValue(openRule.tone)"
          :label="t(toneLabelKey(openRule.tone))"
          size="sm"
        />
        <OTag
          v-if="openRule.status"
          :variant="STATUS_VARIANT[openRule.status] ?? 'default-soft'"
          size="sm"
          >{{ t(`siem.content.status.${openRule.status}`, openRule.status) }}</OTag
        >
        <OTag v-if="openRule.installed" variant="success-soft" icon="check-circle" size="sm">{{
          t("siem.content.installed")
        }}</OTag>
        <OTag v-if="openRule.streams.length" variant="primary-soft" icon="database" size="sm">{{
          t("siem.content.streamCount", openRule.streams.length)
        }}</OTag>
      </template>

      <template #tab-overview>
        <p v-if="openRule.rule.description" class="text-text-heading text-sm leading-relaxed">
          {{ openRule.rule.description }}
        </p>
        <div v-if="openRule.techniques.length || ruleTactics.length" class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.common.mitre")
          }}</span>
          <div class="flex flex-wrap gap-1.5">
            <OTag v-for="tac in ruleTactics" :key="tac" variant="primary-soft" size="sm">{{
              t(`siem.mitre.tactics.${tac}`)
            }}</OTag>
          </div>
          <div class="flex flex-wrap gap-1">
            <OButton
              v-for="tech in openRule.techniques"
              :key="tech"
              as="a"
              :href="techniqueUrl(tech)"
              target="_blank"
              rel="noopener"
              variant="ghost-primary"
              size="xs"
              icon-right="open-in-new"
              :data-test="`security-content-rule-technique-${tech}`"
              >{{ tech }}</OButton
            >
          </div>
        </div>
        <div v-if="openRule.rule.falsepositives?.length" class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.content.falsePositives")
          }}</span>
          <ul class="bg-surface-subtle rounded-surface flex flex-col gap-1 px-4 py-3">
            <li
              v-for="fp in openRule.rule.falsepositives"
              :key="fp"
              class="text-text-heading flex items-start gap-2 text-sm"
            >
              <OIcon name="info-outline" size="xs" class="text-text-secondary mt-0.5 shrink-0" />{{
                fp
              }}
            </li>
          </ul>
        </div>
        <div v-if="openRule.rule.references?.length" class="flex flex-col gap-1">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.content.references")
          }}</span>
          <OButton
            v-for="(ref_, i) in openRule.rule.references"
            :key="ref_"
            as="a"
            :href="ref_"
            target="_blank"
            rel="noopener"
            variant="ghost-primary"
            size="xs"
            icon-right="open-in-new"
            class="justify-start truncate"
            :data-test="`security-content-rule-reference-${i}`"
            >{{ ref_ }}</OButton
          >
        </div>
      </template>

      <template #tab-streams>
        <OEmptyState
          v-if="!ruleStreamChecks.length"
          size="inline"
          icon="database"
          :title="t('siem.content.noStreamsForRule')"
          :description="t('siem.content.noStreamsForRuleHint', { logsource: openRule.logsource })"
        />
        <div
          v-for="check in ruleStreamChecks"
          :key="check.stream"
          class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
          :data-test="`security-content-rule-stream-${check.stream}`"
        >
          <div class="flex items-center gap-2">
            <OIcon name="database" size="sm" class="text-text-secondary" />
            <span class="text-text-heading font-mono text-sm font-semibold">{{
              check.stream
            }}</span>
            <OTag variant="default-soft" size="xs">{{ check.source.label }}</OTag>
            <div class="flex-1" />
            <OTag
              :variant="check.compiled?.runnable ? 'success-soft' : 'warning-soft'"
              :icon="check.compiled?.runnable ? 'check-circle' : 'warning-amber'"
              size="xs"
              >{{
                check.compiled?.runnable
                  ? t("siem.content.runnable")
                  : t("siem.content.notRunnable")
              }}</OTag
            >
          </div>
          <span
            v-if="check.compiled && !check.compiled.runnable"
            class="text-text-secondary text-xs"
            >{{ blockedReason(check.compiled) }}</span
          >
          <span
            v-else-if="check.compiled && caveat(check.compiled)"
            class="text-text-secondary text-xs"
            >{{ caveat(check.compiled) }}</span
          >
          <div class="flex justify-end gap-2">
            <OButton
              variant="ghost"
              size="xs"
              icon-left="manage-search"
              :data-test="`security-content-rule-stream-events-${check.stream}`"
              @click="openInEvents(check.stream)"
              >{{ t("siem.content.openInEvents") }}</OButton
            >
            <OButton
              v-if="check.compiled?.runnable"
              variant="outline"
              size="xs"
              icon-left="add"
              :data-test="`security-content-rule-stream-install-${check.stream}`"
              @click="install(openRule.id, check.stream, check.source.id)"
              >{{ t("siem.content.installHere") }}</OButton
            >
          </div>
        </div>
      </template>

      <template #tab-yaml>
        <OCodeBlock :code="openRule.rule.yaml" lang="yaml" data-test="security-content-rule-yaml" />
      </template>

      <template #footer>
        <OButton
          v-if="installedDetection"
          variant="outline"
          size="sm-action"
          icon-left="shield-alert-outline"
          data-test="security-content-rule-view-detection"
          @click="viewDetection"
        >
          {{ t("siem.content.viewDetection") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="add"
          data-test="security-content-rule-install"
          @click="installDefault(openRule)"
        >
          {{ openRule.installed ? t("siem.content.installAgain") : t("siem.content.install") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>

    <!-- ── Source drawer ──────────────────────────────────────────────────── -->
    <SecurityRecordDrawer
      v-if="openSource"
      :open="!!openSource"
      v-model:tab="sourceTab"
      :title="openSource.label"
      :eyebrow="t('siem.content.sourceEyebrow')"
      :subtitle="openSource.vendor"
      icon="database"
      :tone="openSource.streams.length ? 'success' : 'neutral'"
      :facts="sourceFacts"
      :tabs="sourceTabs"
      :index="sourceIndex"
      :total="filteredSources.length"
      :share-url="shareFor('source', openSource.id)"
      data-test="security-content-source-drawer"
      @close="showSource(null)"
      @prev="stepSource(-1)"
      @next="stepSource(1)"
    >
      <template #chips>
        <OTag
          :variant="openSource.streams.length ? 'success-soft' : 'default-soft'"
          :icon="openSource.streams.length ? 'check-circle' : 'help'"
          size="sm"
          >{{
            openSource.streams.length
              ? t("siem.content.detectedInData")
              : t("siem.content.notDetected")
          }}</OTag
        >
        <OTag v-if="openSource.telemetryOnly" variant="default-soft" size="sm">{{
          t("siem.content.telemetryOnly")
        }}</OTag>
      </template>

      <template #tab-streams>
        <OEmptyState
          v-if="!openSource.streams.length"
          size="inline"
          icon="cloud-upload"
          :title="t('siem.content.noStreamsForSource')"
          :description="
            t('siem.content.noStreamsForSourceHint', {
              fields: openSource.source.required.join(', '),
            })
          "
        />
        <div
          v-for="s in openSource.streams"
          :key="s"
          class="border-border-default rounded-surface flex items-center gap-3 border p-3"
          :data-test="`security-content-source-stream-${s}`"
        >
          <OIcon name="database" size="sm" class="text-status-positive" />
          <span class="text-text-heading min-w-0 flex-1 truncate font-mono text-sm font-semibold">{{
            s
          }}</span>
          <OButton
            variant="outline"
            size="xs"
            icon-left="manage-search"
            :data-test="`security-content-source-stream-events-${s}`"
            @click="openInEvents(s)"
            >{{ t("siem.content.openInEvents") }}</OButton
          >
        </div>
      </template>

      <template #tab-rules>
        <OEmptyState
          v-if="!sourceRulesList.length"
          size="inline"
          icon="rule"
          :title="t('siem.content.noRulesForSource')"
        />
        <ul v-else class="border-border-default rounded-surface overflow-hidden border">
          <li
            v-for="rule in sourceRulesList"
            :key="rule.id"
            role="button"
            tabindex="0"
            class="border-border-subtle hover:bg-surface-subtle focus-visible:ring-accent flex cursor-pointer items-center gap-2 border-b px-3 py-2 outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
            :data-test="`security-content-source-rule-${rule.id}`"
            @click="showRule(rule.id ?? rule.title, openSource.id)"
            @keydown.enter="showRule(rule.id ?? rule.title, openSource.id)"
            @keydown.space.prevent="showRule(rule.id ?? rule.title, openSource.id)"
          >
            <OTag
              type="severity"
              :value="severityTagValue(toneOfSigmaLevel(rule.level))"
              :label="t(toneLabelKey(toneOfSigmaLevel(rule.level)))"
              size="xs"
            />
            <span class="text-text-heading min-w-0 flex-1 truncate text-sm">{{ rule.title }}</span>
            <OTag
              v-if="installed.has(rule.id ?? '')"
              variant="success-soft"
              icon="check-circle"
              size="xs"
              >{{ t("siem.content.installed") }}</OTag
            >
            <OIcon name="chevron-right" size="sm" class="text-text-secondary" />
          </li>
        </ul>
      </template>

      <template #tab-mapping>
        <p class="text-text-secondary text-xs leading-relaxed">
          {{ t("siem.content.mappingHint") }}
        </p>
        <SecurityKeyValues :rows="mappingRows" data-test="security-content-source-mapping" />
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
