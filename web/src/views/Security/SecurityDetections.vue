<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Detections — the rules the SOC runs.
     A detection IS an OpenObserve scheduled alert: same scheduler, same firing
     history, same incident rollup. What makes it a detection is the Sigma rule
     stored in its context_attributes (see utils/security/detection.ts). The
     list is the org's alerts, hydrated and identified by useSiemDetections;
     the drawer reads one rule end to end — what it looks for, the SQL it runs,
     and every recent evaluation from alert history. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import SecurityKeyValues, { type KeyValueRow } from "@/components/security/SecurityKeyValues.vue";
import SecurityNewDetectionDialog, {
  type NewDetectionPreset,
} from "@/components/security/SecurityNewDetectionDialog.vue";
import alertsService from "@/services/alerts";
import { useAlertHistoryWindow } from "@/composables/security/useAlertHistoryWindow";
import { STATUS_VARIANT, firingStatus, type FiringStatus } from "@/utils/security/firings";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useSiemDetections, type DetectionRow } from "@/composables/security/useSiemDetections";
import { whereOfDetectionSql } from "@/utils/security/detection";
import { isFiring, type HistoryRow } from "@/utils/security/history";
import { normalizeTactic, techniqueUrl } from "@/utils/security/mitre";
import {
  detectionState,
  firingsByName,
  toMicros,
  type DetectionState,
} from "@/utils/security/content";
import {
  SEVERITY_TONES,
  severityRailColor,
  severityTagValue,
  toneLabelKey,
  toneOfSigmaLevel,
  type SeverityTone,
} from "@/utils/security/severity";
import { b64EncodeUnicode, formatEventCount } from "@/utils/formatters";
import { displayOrder, positionOf, stepRow, type NavTable } from "@/utils/security/recordNav";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

const { t } = useI18n();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const { confirm } = useConfirmDialog();

// ── Rules ────────────────────────────────────────────────────────────────────
const {
  rows,
  siemRows,
  loading,
  hydrating,
  error,
  unchecked,
  load: loadRules,
  patch: patchRule,
  remove: removeRule,
} = useSiemDetections();
// Firings in the last day, from alert history: the alert's own
// `last_triggered_at` is its last evaluation, not its last firing. The shared
// window loader keeps the cap, dedupe and range narrowing identical to Overview.
const history24h = useAlertHistoryWindow();
const firings = computed(() => firingsByName(history24h.rows.value));
const firingsCapped = history24h.capped;
const firingsLoading = history24h.loading;
const firingsError = history24h.error;
const firingsNarrowedFrom = history24h.effectiveStartMs;

function loadFirings() {
  const end = Date.now();
  return history24h.load(orgId.value, end - 86_400_000, end);
}

async function refresh() {
  await Promise.all([loadRules(orgId.value), loadFirings()]);
}

// ── Filters ──────────────────────────────────────────────────────────────────
const search = ref("");
const scope = ref<"siem" | "all">("siem");
const severity = ref<string | null>(null);
type Facet = "fired" | DetectionState;
const facet = ref<Facet | null>(null);

interface Row {
  id: string;
  name: string;
  /** The Sigma rule's own title; the alert name is a sanitised copy of it. */
  title: string;
  tone: SeverityTone;
  stream: string;
  techniques: string[];
  enabled: boolean;
  state: DetectionState;
  fired: boolean;
  firings: number;
  lastFiredUs: number | null;
  lastRunUs: number | null;
  lastOutcome: string;
  schedule: string;
  isSiem: boolean;
  entry: DetectionRow;
}

function scheduleOf(alert: Record<string, any>): string {
  const tc = alert.trigger_condition;
  if (!tc?.frequency || !tc?.period) return "—";
  return t("siem.detections.scheduleValue", { every: tc.frequency, over: tc.period });
}

const scoped = computed<Row[]>(() =>
  (scope.value === "siem" ? siemRows.value : rows.value).map((entry) => {
    const alert = entry.alert;
    const name = String(alert.name ?? "");
    const fired = firings.value.get(name);
    return {
      id: String(alert.id ?? alert.name),
      name,
      title: entry.meta.title || name,
      tone: entry.meta.isSiem ? toneOfSigmaLevel(entry.meta.level) : "unknown",
      stream: String(alert.stream_name ?? ""),
      techniques: entry.meta.techniques,
      enabled: !!alert.enabled,
      state: detectionState(alert),
      fired: !!fired,
      firings: fired?.count ?? 0,
      lastFiredUs: fired?.lastUs ?? null,
      lastRunUs: toMicros(alert.last_outcome_at ?? alert.last_triggered_at),
      lastOutcome: String(alert.last_outcome ?? ""),
      schedule: scheduleOf(alert),
      isSiem: entry.meta.isSiem,
      entry,
    };
  }),
);

const counts = computed(() => ({
  fired: scoped.value.filter((r) => r.fired).length,
  erroring: scoped.value.filter((r) => r.state === "erroring").length,
  enabled: scoped.value.filter((r) => r.state === "enabled").length,
  disabled: scoped.value.filter((r) => r.state === "disabled").length,
}));

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return scoped.value.filter((r) => {
    if (facet.value === "fired" && !r.fired) return false;
    if (facet.value && facet.value !== "fired" && r.state !== facet.value) return false;
    if (severity.value && r.tone !== severity.value) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      r.title.toLowerCase().includes(needle) ||
      r.stream.toLowerCase().includes(needle) ||
      r.techniques.some((tech) => tech.toLowerCase().includes(needle))
    );
  });
});

const filtersActive = computed(() => !!search.value || !!severity.value || !!facet.value);
function clearFilters() {
  search.value = "";
  severity.value = null;
  facet.value = null;
}

const stats = computed<StatItem[]>(() => [
  {
    key: "fired",
    label: t("siem.detections.stat.fired"),
    value:
      firingsError.value || (firingsLoading.value && !firings.value.size)
        ? "—"
        : counts.value.fired,
    icon: "local-fire-department",
    tone: "orange",
    max: scoped.value.length || undefined,
    dataTest: "security-detections-stat-fired",
  },
  {
    key: "erroring",
    label: t("siem.detections.stat.erroring"),
    value: counts.value.erroring,
    icon: "error-outline",
    tone: "error",
    max: scoped.value.length || undefined,
    dataTest: "security-detections-stat-erroring",
  },
  {
    key: "enabled",
    label: t("siem.detections.stat.enabled"),
    value: counts.value.enabled,
    icon: "verified-user",
    tone: "success",
    max: scoped.value.length || undefined,
    dataTest: "security-detections-stat-enabled",
  },
  {
    key: "disabled",
    label: t("siem.detections.stat.disabled"),
    value: counts.value.disabled,
    icon: "pause-circle-filled",
    tone: "neutral",
    max: scoped.value.length || undefined,
    dataTest: "security-detections-stat-disabled",
  },
  {
    key: "all",
    label: t("siem.detections.stat.all"),
    value: scoped.value.length,
    icon: "shield-alert-outline",
    tone: "primary",
    dataTest: "security-detections-stat-all",
  },
]);

function onStat(key: string) {
  facet.value = key === "all" || facet.value === key ? null : (key as Facet);
}

const severityOptions = computed(() =>
  SEVERITY_TONES.map((tone) => ({ label: t(toneLabelKey(tone)), value: tone })),
);

// ── Table ────────────────────────────────────────────────────────────────────
const columns = computed<OTableColumnDef<Row>[]>(() => [
  { id: "severity", header: t("siem.common.severity"), accessorKey: "tone", size: 110 },
  {
    id: "title",
    header: t("siem.detections.column.name"),
    accessorKey: "title",
    meta: { isName: true },
    sortable: true,
  },
  {
    id: "stream",
    header: t("siem.detections.column.stream"),
    accessorKey: "stream",
    size: 170,
    hideable: true,
    sortable: true,
  },
  {
    id: "techniques",
    header: t("siem.common.mitre"),
    accessorKey: "techniques",
    size: 180,
    hideable: true,
  },
  {
    id: "schedule",
    header: t("siem.detections.column.schedule"),
    accessorKey: "schedule",
    size: 150,
    hideable: true,
  },
  {
    id: "firings",
    header: t("siem.detections.column.fired24h"),
    accessorKey: "firings",
    size: 150,
    sortable: true,
  },
  {
    id: "lastRun",
    header: t("siem.detections.column.lastRun"),
    accessorKey: "lastRunUs",
    size: 150,
    hideable: true,
    sortable: true,
  },
  { id: "enabled", header: t("siem.detections.column.enabled"), accessorKey: "enabled", size: 90 },
]);
const columnVisibility = { schedule: false };

// The open record wins over state tints, so the row beside the drawer is findable.
const rowClass = (row: Row) =>
  row.id === selectedId.value
    ? "!bg-table-row-selected-bg"
    : row.state === "erroring"
      ? "!bg-status-error-bg"
      : row.state === "disabled"
        ? "!bg-surface-panel"
        : "";

// ── Toggle / delete ──────────────────────────────────────────────────────────
const toggling = ref<string | null>(null);

/**
 * Asks the server first and only then updates the row: an optimistic flip on
 * the control that decides whether a detection runs could leave a UI that says
 * "enabled" over a rule that is off.
 */
async function toggleRule(row: Row) {
  const alert = row.entry.alert;
  if (!alert.id) {
    toast({ variant: "error", message: t("siem.detections.noId", { name: alert.name }) });
    return;
  }
  const next = !alert.enabled;
  toggling.value = row.id;
  try {
    // `folder` is required by the API when RBAC is on (EnableAlertQuery).
    await alertsService.toggle_state_by_alert_id(orgId.value, alert.id, next, alert.folder_id);
    patchRule(alert.id, { enabled: next });
    toast({
      variant: "success",
      message: next
        ? t("siem.detections.enabledToast", { name: alert.name })
        : t("siem.detections.disabledToast", { name: alert.name }),
    });
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.detections.toggleFailed"),
    });
  } finally {
    toggling.value = null;
  }
}

async function deleteRule(row: Row) {
  const alert = row.entry.alert;
  if (!alert.id) return;
  const ok = await confirm({
    title: t("siem.detections.deleteTitle"),
    message: t("siem.detections.deleteMessage", { name: alert.name }),
    confirmLabel: t("siem.detections.delete"),
  });
  if (!ok) return;
  try {
    await alertsService.delete_by_alert_id(orgId.value, alert.id, alert.folder_id);
    removeRule(alert.id);
    closeDrawer();
    toast({ variant: "success", message: t("siem.detections.deleted", { name: alert.name }) });
  } catch (e: any) {
    toast({
      variant: "error",
      message: e?.response?.data?.message ?? t("siem.detections.deleteFailed"),
    });
  }
}

// ── Drawer ───────────────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null);
const drawerTab = ref("overview");
const selected = computed(() => scoped.value.find((r) => r.id === selectedId.value) ?? null);
// Position in the table's own (sorted) order; refreshed on open, step, sort
// and data changes, since the table's sort state is not Vue-reactive here.
const tableRef = ref<{ table: NavTable<Row> } | null>(null);
const selectedIndex = ref<number | null>(null);
function syncIndex() {
  const rows = displayOrder(tableRef.value?.table, filtered.value);
  selectedIndex.value = positionOf(rows, (r) => r.id === selectedId.value);
}
watch([filtered, selectedId], () => void nextTick(syncIndex));

function openDrawer(row: Row) {
  selectedId.value = row.id;
  router.replace({ query: { ...route.query, detection: row.id } });
}
function closeDrawer() {
  selectedId.value = null;
  const { detection: _drop, ...rest } = route.query;
  router.replace({ query: rest });
}
function step(delta: number) {
  const next = stepRow(
    tableRef.value?.table,
    filtered.value,
    (r) => r.id === selectedId.value,
    delta,
  );
  if (next) openDrawer(next.row);
}

const shareUrl = computed(() => {
  if (!selected.value || typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("org_identifier", orgId.value);
  url.searchParams.set("detection", selected.value.id);
  return url.toString();
});

// `?detection=<alert id>` (share links, Alerts, Cases) opens that rule's drawer
// once the list has loaded. A rule only counts as non-SIEM after hydration has
// finished; before that its metadata may simply not have arrived yet.
function openFromDetectionParam() {
  const wanted = route.query.detection ? String(route.query.detection) : null;
  if (!wanted || selectedId.value === wanted) return;
  const row = rows.value.find((r) => String(r.alert.id) === wanted);
  if (!row) return;
  if (!row.meta.isSiem) {
    if (loading.value || hydrating.value) return;
    scope.value = "all";
  }
  selectedId.value = wanted;
}
watch(
  () => [rows.value, hydrating.value, loading.value, route.query.detection] as const,
  openFromDetectionParam,
);

// Keep drawer and URL in step: the param leaving (back navigation) closes the
// drawer, and a record that leaves the list (scope switch, deletion) closes it
// and drops the param.
watch(
  () => route.query.detection,
  (param) => {
    if (!param && selectedId.value) selectedId.value = null;
  },
);
watch(selected, (row) => {
  if (!row && selectedId.value && !loading.value) closeDrawer();
});

// History: every evaluation of this rule over the last 7 days.
const HISTORY_DAYS = 7;
const HISTORY_SIZE = 200;
const history = ref<HistoryRow[]>([]);
const historyTotal = ref(0);
const historyLoading = ref(false);
const historyError = ref("");
let historySeq = 0;

async function loadHistory(alertId: string) {
  const seq = ++historySeq;
  history.value = [];
  historyError.value = "";
  historyLoading.value = true;
  const end = Date.now() * 1000;
  try {
    const res = await alertsService.getHistory(orgId.value, {
      alert_id: alertId,
      start_time: String(end - HISTORY_DAYS * 86_400_000_000),
      end_time: String(end),
      from: "0",
      size: String(HISTORY_SIZE),
      sort_by: "timestamp",
      sort_order: "desc",
    });
    if (seq !== historySeq) return;
    history.value = res.data?.hits ?? [];
    historyTotal.value = Number(res.data?.total ?? history.value.length);
  } catch (e: any) {
    if (seq !== historySeq) return;
    historyError.value =
      e?.response?.data?.message ?? e?.message ?? t("siem.detections.historyError");
  } finally {
    if (seq === historySeq) historyLoading.value = false;
  }
}

watch(
  () => selected.value?.entry.alert.id,
  (id) => {
    if (id) void loadHistory(String(id));
  },
);

const historyFirings = computed(() => history.value.filter(isFiring).length);

const drawerTabs = computed<RecordTab[]>(() => [
  { name: "overview", label: t("siem.detections.tab.overview"), icon: "dashboard" },
  {
    name: "history",
    label: t("siem.detections.tab.history"),
    icon: "history",
    count: historyFirings.value || null,
  },
  { name: "sigma", label: t("siem.detections.tab.sigma"), icon: "rule" },
  { name: "sql", label: t("siem.detections.tab.sql"), icon: "code" },
]);

const drawerFacts = computed<RecordFact[]>(() => {
  const row = selected.value;
  if (!row) return [];
  // Compact ("35m ago") so a fact fits its tile; the History tab has exact times.
  const when = (us: number | null) => {
    if (!us) return "";
    const mins = Math.max(0, Math.round((Date.now() - us / 1000) / 60_000));
    if (mins < 1) return t("siem.detections.ago.now");
    if (mins < 60) return t("siem.detections.ago.minutes", { n: mins });
    if (mins < 1440) return t("siem.detections.ago.hours", { n: Math.round(mins / 60) });
    return t("siem.detections.ago.days", { n: Math.round(mins / 1440) });
  };
  return [
    { label: t("siem.detections.column.stream"), value: row.stream, mono: true },
    { label: t("siem.detections.column.schedule"), value: row.schedule },
    {
      label: t("siem.detections.column.fired24h"),
      value: row.firings
        ? t(
            "siem.detections.firedTimes",
            { n: row.firings, when: when(row.lastFiredUs) },
            row.firings,
          )
        : t("siem.detections.notFired"),
    },
    {
      label: t("siem.detections.column.lastRun"),
      value: row.lastRunUs
        ? `${t(`siem.detections.outcome.${outcomeKey(row.lastOutcome)}`)} · ${when(row.lastRunUs)}`
        : t("siem.detections.neverRun"),
    },
  ];
});

const detailRows = computed<KeyValueRow[]>(() => {
  const row = selected.value;
  if (!row) return [];
  const alert = row.entry.alert;
  const meta = row.entry.meta;
  const list: KeyValueRow[] = [
    {
      key: "logsource",
      label: t("siem.detections.field.logsource"),
      value: meta.logsource,
      mono: true,
    },
    {
      key: "source_type",
      label: t("siem.detections.field.sourceType"),
      value: meta.sourceType,
      mono: true,
    },
    { key: "sigma_id", label: t("siem.detections.field.sigmaId"), value: meta.sigmaId, mono: true },
    {
      key: "destinations",
      label: t("siem.detections.field.destinations"),
      value: (alert.destinations ?? []).join(", "),
    },
    {
      key: "silence",
      label: t("siem.detections.field.silence"),
      value:
        alert.trigger_condition?.silence != null
          ? t("siem.detections.minutes", alert.trigger_condition.silence)
          : "",
    },
    { key: "owner", label: t("siem.detections.field.owner"), value: String(alert.owner ?? "") },
    {
      key: "last_error",
      label: t("siem.detections.field.lastError"),
      value: String(alert.last_error ?? ""),
    },
  ];
  return list.filter((r) => r.value);
});

const tactics = computed(() =>
  (selected.value?.entry.meta.tactics ?? [])
    .map((x) => normalizeTactic(x))
    .filter((x): x is NonNullable<typeof x> => !!x),
);

/**
 * The rule's predicate, for SIEM detections only: their SQL is always
 * `SELECT … FROM … WHERE <predicate>` (detectionSql). An arbitrary alert's
 * SQL can carry GROUP BY / ORDER BY / LIMIT after WHERE, which would not survive
 * being spliced into another query.
 */
function matchPredicate(row: Row): string {
  return row.isSiem ? whereOfDetectionSql(row.entry.alert.query_condition?.sql) : "";
}

/** Opens Events showing everything this rule matches, over its own look-back window. */
function viewMatches(row: Row) {
  const alert = row.entry.alert;
  const where = matchPredicate(row);
  if (!where || !alert.stream_name) return;
  const period = Math.max(1, Number(alert.trigger_condition?.period) || 15);
  const stream = String(alert.stream_name).replace(/"/g, '""');
  router.push({
    path: "/security/events",
    query: {
      org_identifier: orgId.value,
      stream: alert.stream_name,
      sql_mode: "true",
      query:
        b64EncodeUnicode(`SELECT * FROM "${stream}" WHERE ${where} ORDER BY _timestamp DESC`) ?? "",
      period: `${period}m`,
    },
  });
}

/** The server's run outcome, including skipped and unrecognised runs. */
const outcomeKey = (status: string): FiringStatus => firingStatus(status);
const outcomeVariant = (status: string): BadgeVariant => STATUS_VARIANT[firingStatus(status)];

/** Every alert name in the org — the create dialog refuses to reuse one. */
const existingNames = computed(() => rows.value.map((r) => String(r.alert.name ?? "")));

// ── New detection ────────────────────────────────────────────────────────────
const showNew = ref(false);
const preset = ref<NewDetectionPreset | null>(null);

function openNew(p: NewDetectionPreset | null = null) {
  preset.value = p;
  showNew.value = true;
}

async function onCreated() {
  await refresh();
}

/** Arriving from Events or Content with a rule already chosen. */
function openFromQuery() {
  const { sigma_id: sigmaId, stream, source } = route.query;
  if (!sigmaId) return;
  openNew({
    sigmaId: String(sigmaId),
    stream: stream ? String(stream) : undefined,
    source: source ? String(source) : undefined,
  });
  // Consumed so a reload does not reopen the dialog.
  const { sigma_id: _a, stream: _b, source: _c, ...rest } = route.query;
  void router.replace({ query: rest });
}

onMounted(() => {
  void refresh();
  openFromQuery();
});
watch(orgId, () => void refresh());
</script>

<template>
  <OPageLayout
    :title="t('siem.detections.title')"
    :subtitle="t('siem.detections.subtitle')"
    icon="shield-alert-outline"
    bleed
    title-data-test="security-detections-title"
  >
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="security-detections-new"
        @click="openNew()"
      >
        {{ t("siem.detections.new") }}
      </OButton>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <OBanner
        v-if="unchecked > 0"
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-detections-unchecked"
      >
        {{ t("siem.detections.unchecked", unchecked) }}
      </OBanner>

      <OBanner
        v-if="firingsError"
        variant="error-soft"
        icon="error-outline"
        dense
        class="mx-page-edge mt-2"
        data-test="security-detections-firings-error"
      >
        {{ t("siem.detections.firingsErrorBanner", { reason: firingsError }) }}
      </OBanner>
      <OBanner
        v-if="firingsCapped"
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-detections-firings-capped"
      >
        {{
          t("siem.detections.firingsCapped", {
            n: formatEventCount(history24h.rows.value.length),
            total: formatEventCount(history24h.total.value),
          })
        }}
      </OBanner>
      <OBanner
        v-if="firingsNarrowedFrom"
        variant="warning"
        icon="warning-amber"
        dense
        class="mx-page-edge mt-2"
        data-test="security-detections-firings-narrowed"
      >
        {{
          t("siem.detections.firingsNarrowed", {
            from: new Date(firingsNarrowedFrom).toLocaleString(),
          })
        }}
      </OBanner>

      <OTable
        ref="tableRef"
        :data="filtered"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :error="error || null"
        :page-size="50"
        :page-size-options="[50, 100, 250]"
        :show-global-filter="false"
        :column-visibility="columnVisibility"
        :persist-columns="true"
        table-id="security-detections"
        :enable-column-resize="true"
        :row-class="rowClass"
        :get-row-status-color="(row: Row) => severityRailColor(row.tone)"
        class="min-h-0 flex-1"
        data-test="security-detections-table"
        @row-click="openDrawer"
        @sort-change="() => nextTick(syncIndex)"
      >
        <template #subheader>
          <div class="px-page-edge border-table-row-divider border-b py-1.5">
            <OStatStrip
              :items="stats"
              :loading="loading && !rows.length"
              selectable
              :selected-key="facet"
              data-test="security-detections-stats"
              @select="onStat"
            />
          </div>
        </template>

        <template #toolbar>
          <div class="flex w-full items-center gap-2">
            <OToggleGroup
              :model-value="scope"
              data-test="security-detections-scope"
              @update:model-value="(v: unknown) => (scope = v === 'all' ? 'all' : 'siem')"
            >
              <OToggleGroupItem value="siem" size="sm" data-test="security-detections-scope-siem">{{
                t("siem.detections.scopeSiem")
              }}</OToggleGroupItem>
              <OToggleGroupItem value="all" size="sm" data-test="security-detections-scope-all">{{
                t("siem.detections.scopeAll")
              }}</OToggleGroupItem>
            </OToggleGroup>
            <div class="w-40 shrink-0">
              <OSelect
                :model-value="severity"
                :options="severityOptions"
                :placeholder="t('siem.detections.anySeverity')"
                clearable
                data-test="security-detections-severity"
                @update:model-value="(v: unknown) => (severity = v ? String(v) : null)"
              />
            </div>
            <OSearchInput
              v-model="search"
              class="flex-1"
              :placeholder="t('siem.detections.search')"
              data-test="security-detections-search"
            />
            <span
              v-if="hydrating"
              class="text-text-secondary flex shrink-0 items-center gap-1.5 text-xs"
            >
              <OSpinner size="xs" />{{ t("siem.detections.identifying") }}
            </span>
          </div>
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="security-detections-refresh"
            @click="refresh"
          >
            <OTooltip side="bottom" :content="t('siem.detections.refresh')" />
          </OButton>
        </template>

        <template #cell-severity="{ row }">
          <OTag
            v-if="row.isSiem"
            type="severity"
            :value="severityTagValue(row.tone)"
            :label="t(toneLabelKey(row.tone))"
            size="xs"
          />
          <OTag v-else variant="default-soft" size="xs">{{ t("siem.detections.notSiem") }}</OTag>
        </template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="text-text-heading truncate font-medium"
              >{{ row.title }}<OTooltip :content="row.name"
            /></span>
            <OIcon
              v-if="row.state === 'erroring'"
              name="error-outline"
              size="xs"
              class="text-status-error-text shrink-0"
            >
              <OTooltip
                :content="row.entry.alert.last_error || t('siem.detections.stat.erroring')"
              />
            </OIcon>
          </div>
        </template>
        <template #cell-stream="{ row }">
          <span class="truncate font-mono text-xs">{{ row.stream || "—" }}</span>
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
        <template #cell-firings="{ row }">
          <div v-if="row.firings" class="flex min-w-0 items-center gap-2">
            <OTag
              variant="orange-soft"
              icon="local-fire-department"
              size="xs"
              class="tabular-nums"
              >{{ formatEventCount(row.firings) }}</OTag
            >
            <OTimeCell :value="row.lastFiredUs" unit="us" class="text-xs" />
          </div>
          <span v-else class="text-text-secondary">{{ firingsLoading ? "…" : "—" }}</span>
        </template>
        <template #cell-lastRun="{ row }">
          <div v-if="row.lastRunUs" class="flex min-w-0 items-center gap-2">
            <OTag :variant="outcomeVariant(row.lastOutcome)" size="xs">{{
              t(`siem.detections.outcome.${outcomeKey(row.lastOutcome)}`)
            }}</OTag>
            <OTimeCell :value="row.lastRunUs" unit="us" class="text-xs" />
          </div>
          <span v-else class="text-text-secondary">{{ t("siem.detections.neverRun") }}</span>
        </template>
        <template #cell-enabled="{ row }">
          <div @click.stop>
            <OSwitch
              :model-value="row.enabled"
              :disabled="toggling === row.id"
              :data-test="`security-detections-toggle-${row.id}`"
              @update:model-value="toggleRule(row)"
            />
          </div>
        </template>

        <template #empty>
          <OEmptyState
            v-if="!loading"
            size="block"
            icon="shield-alert-outline"
            :title="hydrating ? t('siem.detections.identifying') : t('siem.detections.emptyTitle')"
            :description="t('siem.detections.emptyHint')"
            :action-label="filtersActive ? undefined : t('siem.detections.createFirst')"
            action-icon="add"
            :filtered="filtersActive"
            @action="(id?: string) => (id === 'clear-filters' ? clearFilters() : openNew())"
          />
        </template>
      </OTable>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="selected.title"
      :eyebrow="t('siem.detections.eyebrow')"
      :subtitle="selected.title !== selected.name ? selected.name : undefined"
      icon="shield-alert-outline"
      :tone="selected.isSiem ? selected.tone : 'neutral'"
      :facts="drawerFacts"
      :tabs="drawerTabs"
      :index="selectedIndex"
      :total="filtered.length"
      :share-url="shareUrl"
      data-test="security-detection-drawer"
      @close="closeDrawer"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          v-if="selected.isSiem"
          type="severity"
          :value="severityTagValue(selected.tone)"
          :label="t(toneLabelKey(selected.tone))"
          size="sm"
        />
        <OTag
          :variant="
            selected.state === 'enabled'
              ? 'success-soft'
              : selected.state === 'erroring'
                ? 'error-soft'
                : 'default-soft'
          "
          :icon="
            selected.state === 'enabled'
              ? 'check-circle'
              : selected.state === 'erroring'
                ? 'error-outline'
                : 'pause-circle-filled'
          "
          size="sm"
          >{{ t(`siem.detections.state.${selected.state}`) }}</OTag
        >
        <OTag v-if="selected.fired" variant="orange-soft" icon="local-fire-department" size="sm">
          {{ t("siem.detections.firedCount", selected.firings) }}
        </OTag>
        <OTag
          v-if="selected.entry.meta.logsource"
          variant="default-soft"
          size="sm"
          class="font-mono"
        >
          {{ selected.entry.meta.logsource }}
        </OTag>
      </template>

      <template #tab-overview>
        <p
          v-if="selected.entry.alert.description"
          class="text-text-heading text-sm leading-relaxed"
          data-test="security-detection-drawer-description"
        >
          {{ selected.entry.alert.description }}
        </p>
        <OBanner
          v-if="selected.state === 'erroring'"
          variant="error-soft"
          icon="error-outline"
          data-test="security-detection-drawer-error"
        >
          {{ selected.entry.alert.last_error || t("siem.detections.erroringHint") }}
        </OBanner>

        <div v-if="selected.techniques.length || tactics.length" class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.common.mitre")
          }}</span>
          <div class="flex flex-wrap gap-1.5">
            <OTag v-for="tac in tactics" :key="tac" variant="primary-soft" size="sm">{{
              t(`siem.mitre.tactics.${tac}`)
            }}</OTag>
          </div>
          <div class="flex flex-wrap gap-1">
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
              :data-test="`security-detection-drawer-technique-${tech}`"
              >{{ tech }}</OButton
            >
          </div>
        </div>

        <SecurityKeyValues
          v-if="detailRows.length"
          :rows="detailRows"
          data-test="security-detection-drawer-details"
        />
      </template>

      <template #tab-history>
        <div v-if="historyLoading" class="flex items-center justify-center gap-2 py-10">
          <OSpinner size="sm" />
          <span class="text-text-secondary text-sm">{{ t("siem.detections.historyLoading") }}</span>
        </div>
        <OEmptyState
          v-else-if="historyError"
          size="inline"
          icon="error-outline"
          :title="t('siem.detections.historyError')"
          :description="historyError"
        />
        <OEmptyState
          v-else-if="!history.length"
          size="inline"
          icon="history"
          :title="t('siem.detections.historyEmpty')"
          :description="t('siem.detections.historyEmptyHint', { days: HISTORY_DAYS })"
        />
        <template v-else>
          <p class="text-text-secondary text-xs">
            {{
              t(
                "siem.detections.historySummary",
                {
                  firings: historyFirings,
                  runs: formatEventCount(history.length),
                  days: HISTORY_DAYS,
                },
                historyFirings,
              )
            }}
            <template v-if="historyTotal > history.length">
              {{ t("siem.detections.historyCapped", { total: formatEventCount(historyTotal) }) }}
            </template>
          </p>
          <ul
            class="border-border-default rounded-surface overflow-hidden border"
            data-test="security-detection-drawer-history"
          >
            <li
              v-for="(h, i) in history"
              :key="`${h.timestamp}-${i}`"
              class="border-border-subtle flex items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <OTag :variant="outcomeVariant(h.status)" size="xs" class="shrink-0">
                {{ t(`siem.detections.outcome.${outcomeKey(h.status)}`) }}
              </OTag>
              <OTimeCell :value="h.timestamp" unit="us" mode="absolute" class="shrink-0" />
              <span class="text-text-secondary min-w-0 flex-1 truncate">
                <template v-if="h.error">{{ h.error }}</template>
                <template v-else-if="h.actual_value != null">
                  {{
                    t("siem.detections.matched", { n: formatEventCount(Number(h.actual_value)) })
                  }}
                </template>
              </span>
              <span
                v-if="h.evaluation_took_in_secs != null"
                class="text-text-secondary shrink-0 tabular-nums"
              >
                {{ t("siem.detections.took", { s: Number(h.evaluation_took_in_secs).toFixed(2) }) }}
              </span>
            </li>
          </ul>
        </template>
      </template>

      <template #tab-sigma>
        <OCodeBlock
          v-if="selected.entry.meta.sigmaYaml"
          :code="selected.entry.meta.sigmaYaml"
          lang="yaml"
          data-test="security-detection-drawer-sigma"
        />
        <OEmptyState
          v-else
          size="inline"
          icon="info-outline"
          :title="t('siem.detections.noSigma')"
          :description="t('siem.detections.noSigmaHint')"
        />
      </template>

      <template #tab-sql>
        <OCodeBlock
          :code="selected.entry.alert.query_condition?.sql || t('siem.detections.noSql')"
          lang="sql"
          data-test="security-detection-drawer-sql"
        />
      </template>

      <template #footer>
        <OButton
          variant="outline-destructive"
          size="sm-action"
          icon-left="delete"
          data-test="security-detection-drawer-delete"
          @click="deleteRule(selected)"
        >
          {{ t("siem.detections.delete") }}
        </OButton>
        <div class="flex-1" />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="manage-search"
          :disabled="!matchPredicate(selected)"
          data-test="security-detection-drawer-view-matches"
          @click="viewMatches(selected)"
        >
          {{ t("siem.detections.viewMatches") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :icon-left="selected.enabled ? 'pause' : 'play-arrow'"
          :loading="toggling === selected.id"
          data-test="security-detection-drawer-toggle"
          @click="toggleRule(selected)"
        >
          {{ selected.enabled ? t("siem.detections.disable") : t("siem.detections.enable") }}
        </OButton>
      </template>
    </SecurityRecordDrawer>

    <SecurityNewDetectionDialog
      v-model:open="showNew"
      :org-id="orgId"
      :preset="preset"
      :existing-names="existingNames"
      @created="onCreated"
    />
  </OPageLayout>
</template>
