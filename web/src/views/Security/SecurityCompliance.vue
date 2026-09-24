<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Compliance — observable logging/detection coverage against framework controls
     (evidence, not certification); the per-control rules live in utils/security/compliance.ts. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem, StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import SecurityPanel from "@/components/security/SecurityPanel.vue";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { fetchHistoryWindow } from "@/composables/security/useAlertHistoryWindow";
import incidentsService from "@/services/incidents";
import config from "@/aws-exports";
import streamService from "@/services/stream";
import { bestMatch, isSecuritySource } from "@/utils/security/classify";
import { isEvalError } from "@/utils/security/history";
import {
  loadTaggedStreams,
  securityStreamNames,
  sourceHealth,
  type SourceHealth,
} from "@/utils/security/streams";
import {
  CONTROLS,
  FRAMEWORKS,
  capabilitiesOf,
  effectiveRetentionDays,
  unmappedNormalizedFields,
  evaluateControl,
  scoreControls,
  statusRailColor,
  type ComplianceSignals,
  type ControlResult,
  type ControlStatus,
  type DetectionSignal,
  type FrameworkId,
  type Requirement,
  type SourceSignal,
} from "@/utils/security/compliance";

const { t } = useI18n();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

// ── Signals ──────────────────────────────────────────────────────────────────
const streams = ref<any[]>([]);
const streamsLoading = ref(false);
const lastRunAt = ref<number | null>(null);
const {
  siemRows,
  loading: rulesLoading,
  hydrating,
  unchecked,
  load: loadDetections,
} = useSiemDetections();

// ── Detection runs: per detection, so the history cap cannot hide one ───────
interface Runs {
  evaluations: number;
  errors: number;
  complete: boolean;
}
const runs = ref<Map<string, Runs>>(new Map());
const runsLoading = ref(false);
/** A 1-minute rule writes 1440 rows a day, so three pages cover any schedule. */
const RUN_PAGES = 3;
const RUN_CONCURRENCY = 4;

async function loadRuns(seq: number) {
  runsLoading.value = true;
  const end = Date.now();
  const start = end - 24 * 3_600_000;
  const queue = siemRows.value
    .filter(({ alert }) => alert.enabled && alert.id)
    .map(({ alert }) => ({ id: String(alert.id), name: String(alert.name ?? "") }));
  const out = new Map<string, Runs>();
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const { rows, complete } = await fetchHistoryWindow(orgId.value, start, end, {
          alertId: item.id,
          maxPages: RUN_PAGES,
        });
        // A skipped run looked at nothing, so it is not an evaluation.
        out.set(item.name, {
          evaluations: rows.filter((r) => r.status !== "skipped").length,
          errors: rows.filter(isEvalError).length,
          complete,
        });
      } catch {
        // Unreadable history is not "did not run": leave it unread.
        out.set(item.name, { evaluations: 0, errors: 0, complete: false });
      }
    }
  };
  await Promise.all(Array.from({ length: RUN_CONCURRENCY }, worker));
  if (seq !== refreshSeq) return;
  runs.value = out;
  runsLoading.value = false;
}

// ── Cases: from the incidents stats API, never from a build flag ─────────────
const caseCount = ref<number | null>(null);
// The stats endpoint's total_incidents is a placeholder 0, so the list's total is used.
const casesAvailable = config.isEnterprise === "true" || config.isCloud === "true";
async function loadCaseCount() {
  if (!casesAvailable) {
    caseCount.value = null;
    return;
  }
  try {
    const res = await incidentsService.list(orgId.value, undefined, 1, 0);
    const n = Number(res.data?.total);
    caseCount.value = Number.isFinite(n) ? n : null;
  } catch {
    // 403/404: the deployment cannot say, which is "not assessable".
    caseCount.value = null;
  }
}

async function loadStreams() {
  streamsLoading.value = true;
  try {
    // One call carries schema (to identify each source), settings (retention) and stats.
    const res = await streamService.nameList(orgId.value, "logs", true);
    streams.value = res.data?.list ?? [];
  } catch {
    streams.value = [];
  } finally {
    streamsLoading.value = false;
  }
}

let refreshSeq = 0;
async function refresh() {
  if (!orgId.value) return;
  const seq = ++refreshSeq;
  await Promise.all([loadStreams(), loadDetections(orgId.value), loadCaseCount()]);
  // Runs are read per detection, so the rule list has to be known first.
  await loadRuns(seq);
  if (seq === refreshSeq) lastRunAt.value = Date.now();
}
onMounted(refresh);
watch(orgId, refresh);

const loading = computed(
  () => streamsLoading.value || rulesLoading.value || hydrating.value || runsLoading.value,
);
const ready = computed(
  () => lastRunAt.value !== null && !rulesLoading.value && !hydrating.value && !runsLoading.value,
);

const sources = computed<SourceSignal[]>(() => {
  const all = streams.value.map((s) => String(s.name));
  const names = securityStreamNames(all, loadTaggedStreams(orgId.value));
  const byName = new Map(streams.value.map((s) => [String(s.name), s]));
  return names.map((name) => {
    const stream = byName.get(name);
    const fields = (stream?.schema ?? []).map((f: any) => String(f.name));
    const match = fields.length ? bestMatch(fields) : null;
    return {
      name,
      health: sourceHealth(stream?.stats),
      sourceId: match?.source.id ?? null,
      label: match?.source.label ?? null,
      security: isSecuritySource(match),
      retentionDays: effectiveRetentionDays(
        stream?.settings?.data_retention,
        store.state.zoConfig?.data_retention_days,
      ),
      unmappedFields: unmappedNormalizedFields(match?.source ?? null, fields),
    };
  });
});

const detections = computed<DetectionSignal[]>(() =>
  siemRows.value.map(({ alert, meta }) => {
    const name = String(alert.name ?? "");
    const r = runs.value.get(name);
    return {
      name,
      enabled: !!alert.enabled,
      tactics: meta.tactics,
      techniques: meta.techniques,
      evaluations: r?.evaluations ?? 0,
      errors: r?.errors ?? 0,
      // A disabled rule is not read, and nothing about it is unknown.
      runsComplete: alert.enabled ? (r?.complete ?? false) : true,
    };
  }),
);

const signals = computed<ComplianceSignals>(() => ({
  sources: sources.value,
  detections: detections.value,
  caseCount: caseCount.value,
}));

// ── Framework ────────────────────────────────────────────────────────────────
const framework = ref<FrameworkId>("pci");
const statusFilter = ref<ControlStatus | null>(null);

const results = computed<ControlResult[]>(() =>
  CONTROLS.filter((c) => c.framework === framework.value).map((c) =>
    evaluateControl(c, signals.value),
  ),
);
const score = computed(() => scoreControls(results.value));
const shownResults = computed(() =>
  statusFilter.value ? results.value.filter((r) => r.status === statusFilter.value) : results.value,
);

function scoreTone(value: number | null): StatTone {
  if (value === null) return "neutral";
  return value >= 80 ? "success" : value >= 50 ? "warning" : "error";
}

const stats = computed<StatItem[]>(() => [
  {
    key: "missing",
    label: t("siem.compliance.status.missing"),
    value: ready.value ? score.value.missing : "—",
    icon: "cancel",
    tone: "error",
    max: results.value.length,
    dataTest: "security-compliance-stat-missing",
  },
  {
    key: "partial",
    label: t("siem.compliance.status.partial"),
    value: ready.value ? score.value.partial : "—",
    icon: "warning-amber",
    tone: "warning",
    max: results.value.length,
    dataTest: "security-compliance-stat-partial",
  },
  {
    key: "met",
    label: t("siem.compliance.status.met"),
    value: ready.value ? score.value.met : "—",
    icon: "check-circle",
    tone: "success",
    max: results.value.length,
    dataTest: "security-compliance-stat-met",
  },
  {
    key: "unknown",
    label: t("siem.compliance.status.unknown"),
    value: ready.value ? score.value.unknown : "—",
    icon: "help-outline",
    tone: "neutral",
    dataTest: "security-compliance-stat-unknown",
  },
  {
    key: "score",
    label: t("siem.compliance.coverageScore"),
    value: ready.value && score.value.score !== null ? `${score.value.score}%` : "—",
    icon: "verified-user",
    tone: scoreTone(score.value.score),
    selectable: false,
    dataTest: "security-compliance-stat-score",
  },
]);
function onStat(key: string) {
  statusFilter.value = statusFilter.value === key ? null : (key as ControlStatus);
}
watch(framework, () => {
  statusFilter.value = null;
  selectedId.value = null;
});

// ── Presentation ─────────────────────────────────────────────────────────────
const STATUS_VARIANT: Record<ControlStatus, BadgeVariant> = {
  met: "success-soft",
  partial: "warning-soft",
  missing: "error-soft",
  unknown: "default-soft",
};
const STATUS_ICON: Record<ControlStatus, IconName> = {
  met: "check-circle",
  partial: "warning-amber",
  missing: "cancel",
  unknown: "help-outline",
};
const STATUS_TEXT: Record<ControlStatus, string> = {
  met: "text-status-positive",
  partial: "text-status-warning-text",
  missing: "text-status-error-text",
  unknown: "text-text-secondary",
};

function requirementParams(req: Requirement): Record<string, string | number> {
  switch (req.kind) {
    case "capability":
      return { capability: t(`siem.compliance.capabilityPhrase.${req.capability}`) };
    case "capabilityBreadth":
    case "detectionBreadth":
      return { n: req.min };
    case "retention":
      return { days: req.minDays };
    case "detectionTactics":
      return { tactics: req.tactics.map((x) => t(`siem.mitre.tactics.${x}`)).join(", ") };
    case "detectionTechniques":
      return { techniques: req.techniques.join(", ") };
    default:
      return {};
  }
}

const SOURCE_KINDS = new Set(["anySource", "capability", "capabilityBreadth", "normalized"]);
const DETECTION_KINDS = new Set([
  "detectionTactics",
  "detectionTechniques",
  "detectionBreadth",
  "reviewRunning",
]);

function evidenceSummary(result: ControlResult): string {
  const srcs = new Set<string>();
  const dets = new Set<string>();
  for (const r of result.requirements) {
    for (const name of r.evidence)
      (SOURCE_KINDS.has(r.requirement.kind) || r.requirement.kind === "retention"
        ? srcs
        : dets
      ).add(name);
  }
  const parts: string[] = [];
  if (srcs.size) parts.push(t("siem.compliance.sourcesCount", srcs.size));
  if (dets.size) parts.push(t("siem.compliance.detectionsCount", dets.size));
  return parts.join(" · ") || "—";
}

type Row = { id: string; ref: string; status: ControlStatus; result: ControlResult };
const rows = computed<Row[]>(() =>
  shownResults.value.map((r) => ({
    id: r.control.id,
    ref: r.control.ref,
    status: r.status,
    result: r,
  })),
);

const columns = computed<OTableColumnDef<Row>[]>(() => [
  { id: "status", header: t("siem.compliance.col.status"), accessorKey: "status", size: 130 },
  { id: "ref", header: t("siem.compliance.col.ref"), accessorKey: "ref", size: 110 },
  {
    id: "title",
    header: t("siem.compliance.col.control"),
    accessorFn: (r: Row) => t(`siem.compliance.controls.${r.id}.title`),
    meta: { isName: true },
  },
  {
    id: "evidence",
    header: t("siem.compliance.col.evidence"),
    accessorFn: (r: Row) => evidenceSummary(r.result),
    size: 220,
  },
  {
    id: "requirements",
    header: t("siem.compliance.col.requirements"),
    accessorFn: (r: Row) => r.result.requirements.filter((x) => x.status === "met").length,
    size: 130,
    meta: { align: "right" },
  },
]);

// ── Drawer ───────────────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null);
const selectedIndex = computed(() => {
  const i = rows.value.findIndex((r) => r.id === selectedId.value);
  return i === -1 ? null : i;
});
const selected = computed(
  () => results.value.find((r) => r.control.id === selectedId.value) ?? null,
);
const drawerTab = ref("evidence");

function step(delta: number) {
  const i = selectedIndex.value;
  if (i === null) return;
  const next = rows.value[i + delta];
  if (next) selectedId.value = next.id;
}

const DRAWER_TONE: Record<ControlStatus, "success" | "medium" | "critical" | "neutral"> = {
  met: "success",
  partial: "medium",
  missing: "critical",
  unknown: "neutral",
};

const gaps = computed(() => (selected.value?.requirements ?? []).filter((r) => r.status !== "met"));

const drawerFacts = computed<RecordFact[]>(() => {
  const r = selected.value;
  if (!r) return [];
  const met = r.requirements.filter((x) => x.status === "met").length;
  return [
    { label: t("siem.compliance.col.status"), value: t(`siem.compliance.status.${r.status}`) },
    {
      label: t("siem.compliance.col.requirements"),
      value: t("siem.compliance.metOf", { met, total: r.requirements.length }),
    },
    { label: t("siem.compliance.col.ref"), value: r.control.ref, mono: true },
    { label: t("siem.compliance.col.evidence"), value: evidenceSummary(r) },
  ];
});

const drawerTabs = computed<RecordTab[]>(() => [
  {
    name: "evidence",
    label: t("siem.compliance.tab.evidence"),
    icon: "fact-check",
    count: selected.value?.requirements.length ?? 0,
  },
  {
    name: "gaps",
    label: t("siem.compliance.tab.gaps"),
    icon: "report-problem",
    count: gaps.value.length,
  },
  { name: "about", label: t("siem.compliance.tab.about"), icon: "info-outline" },
]);

const sourceByName = computed(() => new Map(sources.value.map((s) => [s.name, s])));
const HEALTH_DOT: Record<SourceHealth, string> = {
  live: "bg-status-positive",
  quiet: "bg-badge-amber-solid-bg",
  never: "bg-border-default",
};

const needsSources = computed(() => gaps.value.some((g) => SOURCE_KINDS.has(g.requirement.kind)));
const needsDetections = computed(() =>
  gaps.value.some((g) => DETECTION_KINDS.has(g.requirement.kind)),
);
const needsRetention = computed(() => gaps.value.some((g) => g.requirement.kind === "retention"));

function go(path: string) {
  router.push({ path, query: { org_identifier: orgId.value } });
}
</script>

<template>
  <OPageLayout
    :title="t('siem.compliance.title')"
    :subtitle="t('siem.compliance.subtitle')"
    icon="verified-user"
    scroll
    pad-y
    title-data-test="security-compliance-title"
  >
    <template #actions>
      <ORefreshButton
        :last-run-at="lastRunAt"
        :loading="loading"
        data-test="security-compliance-refresh"
        @click="refresh"
      />
    </template>

    <template #subnav>
      <OTabs v-model="framework" data-test="security-compliance-frameworks">
        <OTab
          v-for="f in FRAMEWORKS"
          :key="f"
          :name="f"
          :label="t(`siem.compliance.framework.${f}.short`)"
          :data-test="`security-compliance-framework-${f}`"
        />
      </OTabs>
    </template>

    <div class="flex flex-col gap-4 pb-4">
      <OBanner variant="info" icon="info-outline" dense data-test="security-compliance-disclaimer">
        {{ t("siem.compliance.disclaimer") }}
      </OBanner>
      <OBanner
        v-if="unchecked > 0"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-compliance-unchecked"
      >
        {{ t("siem.compliance.uncheckedRules", unchecked) }}
      </OBanner>

      <div class="flex flex-col gap-1">
        <h2 class="text-text-heading text-lg font-semibold">
          {{ t(`siem.compliance.framework.${framework}.name`) }}
        </h2>
        <p class="text-text-secondary text-xs">
          {{ t(`siem.compliance.framework.${framework}.scope`) }}
        </p>
      </div>

      <OStatStrip
        :items="stats"
        :loading="!ready"
        selectable
        :selected-key="statusFilter"
        data-test="security-compliance-stats"
        @select="onStat"
      />

      <div class="bg-card-glass-bg border-border-default rounded-surface overflow-hidden border">
        <OTable
          :data="ready ? rows : []"
          :columns="columns"
          row-key="id"
          :loading="!ready"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :fill-height="false"
          :get-row-status-color="(row: Row) => statusRailColor(row.status)"
          :row-class="(row: Row) => (row.id === selectedId ? '!bg-table-row-selected-bg' : '')"
          data-test="security-compliance-table"
          @row-click="(row: Row) => (selectedId = row.id)"
        >
          <template #cell-status="{ row }">
            <OTag :variant="STATUS_VARIANT[row.status]" :icon="STATUS_ICON[row.status]" size="xs">{{
              t(`siem.compliance.status.${row.status}`)
            }}</OTag>
          </template>
          <template #cell-ref="{ row }">
            <span class="text-text-secondary font-mono text-xs">{{ row.ref }}</span>
          </template>
          <template #cell-requirements="{ row }">
            <span class="text-xs tabular-nums">{{
              t("siem.compliance.metOf", {
                met: row.result.requirements.filter((x) => x.status === "met").length,
                total: row.result.requirements.length,
              })
            }}</span>
          </template>
          <template #empty>
            <OEmptyState
              size="inline"
              icon="filter-alt"
              :title="t('siem.compliance.noControls')"
              filtered
              @action="statusFilter = null"
            />
          </template>
        </OTable>
      </div>

      <!-- What was assessed: every security source, how it was identified -->
      <SecurityPanel
        :title="t('siem.compliance.sourcesAssessed')"
        :hint="t('siem.compliance.sourcesAssessedHint')"
        :count="sources.length"
        icon="database"
        data-test="security-compliance-sources"
      >
        <div v-if="streamsLoading && !streams.length" class="flex flex-col gap-2 p-4">
          <OSkeleton v-for="n in 3" :key="n" type="text" class="h-6" />
        </div>
        <OEmptyState
          v-else-if="!sources.length"
          size="inline"
          icon="cloud-upload"
          :title="t('siem.overview.noSources')"
          :description="t('siem.overview.noSourcesHint')"
        />
        <ul v-else>
          <li
            v-for="s in sources"
            :key="s.name"
            class="border-border-subtle px-page-edge flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
            :data-test="`security-compliance-source-${s.name}`"
          >
            <span class="size-2 shrink-0 rounded-full" :class="HEALTH_DOT[s.health]">
              <OTooltip :content="t(`siem.health.${s.health}`)" />
            </span>
            <span class="text-text-heading min-w-0 font-mono text-xs">{{ s.name }}</span>
            <OTag :variant="s.security ? 'primary-soft' : 'default-soft'" size="xs">
              {{ s.security && s.label ? s.label : t("siem.compliance.unidentified") }}
            </OTag>
            <OTag
              v-for="cap in capabilitiesOf(s)"
              :key="cap"
              variant="default-soft"
              shape="rounded"
              size="xs"
              >{{ t(`siem.compliance.capability.${cap}`) }}</OTag
            >
            <OTag
              v-if="s.security && s.unmappedFields.length"
              variant="warning-soft"
              shape="rounded"
              size="xs"
              icon="warning-amber"
              :data-test="`security-compliance-source-unmapped-${s.name}`"
              >{{
                t("siem.compliance.unmapped", {
                  fields: s.unmappedFields.map((f) => t(`siem.compliance.field.${f}`)).join(", "),
                })
              }}</OTag
            >
            <div class="flex-1" />
            <span class="text-text-secondary text-xs tabular-nums">
              {{
                s.retentionDays === null
                  ? t("siem.compliance.retentionUnknown")
                  : s.retentionDays === Infinity
                    ? t("siem.compliance.retentionForever")
                    : t("siem.compliance.retentionDays", s.retentionDays)
              }}
            </span>
          </li>
        </ul>
      </SecurityPanel>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="t(`siem.compliance.controls.${selected.control.id}.title`)"
      :eyebrow="t(`siem.compliance.framework.${selected.control.framework}.name`)"
      :subtitle="selected.control.ref"
      icon="verified-user"
      :tone="DRAWER_TONE[selected.status]"
      :facts="drawerFacts"
      :tabs="drawerTabs"
      :index="selectedIndex"
      :total="rows.length"
      data-test="security-compliance-drawer"
      @close="selectedId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          :variant="STATUS_VARIANT[selected.status]"
          :icon="STATUS_ICON[selected.status]"
          size="sm"
          >{{ t(`siem.compliance.status.${selected.status}`) }}</OTag
        >
        <OTag variant="default-soft" size="sm" class="font-mono">{{ selected.control.ref }}</OTag>
      </template>

      <template #summary>
        <p class="text-text-secondary text-sm leading-relaxed">
          {{ t(`siem.compliance.controls.${selected.control.id}.desc`) }}
        </p>
      </template>

      <template #tab-evidence>
        <div
          v-for="(req, i) in selected.requirements"
          :key="i"
          class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
          :data-test="`security-compliance-requirement-${i}`"
        >
          <div class="flex items-start gap-2">
            <OIcon
              :name="STATUS_ICON[req.status]"
              size="sm"
              class="mt-0.5 shrink-0"
              :class="STATUS_TEXT[req.status]"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-text-heading text-sm font-semibold">{{
                t(`siem.compliance.req.${req.requirement.kind}`, requirementParams(req.requirement))
              }}</span>
              <span class="text-text-secondary text-xs">{{
                t(
                  `siem.compliance.reason.${req.requirement.kind}.${req.status}`,
                  requirementParams(req.requirement),
                )
              }}</span>
            </div>
          </div>
          <div
            v-if="req.evidence.length || req.shortfall.length"
            class="flex flex-wrap gap-1.5 pl-6"
          >
            <OTag
              v-for="name in req.evidence"
              :key="`e-${name}`"
              variant="success-soft"
              shape="rounded"
              size="xs"
              icon="check"
              >{{
                sourceByName.get(name)?.label && sourceByName.get(name)?.security
                  ? `${name} · ${sourceByName.get(name)?.label}`
                  : name
              }}</OTag
            >
            <OTag
              v-for="name in req.shortfall"
              :key="`s-${name}`"
              variant="warning-soft"
              shape="rounded"
              size="xs"
              icon="warning-amber"
              >{{ name }}</OTag
            >
          </div>
        </div>
      </template>

      <template #tab-gaps>
        <OEmptyState
          v-if="!gaps.length"
          size="inline"
          icon="task-alt"
          :title="t('siem.compliance.noGaps')"
        />
        <template v-else>
          <div
            v-for="(req, i) in gaps"
            :key="i"
            class="bg-surface-subtle rounded-surface flex flex-col gap-1 p-3"
          >
            <span class="text-text-heading text-sm font-semibold">{{
              t(`siem.compliance.req.${req.requirement.kind}`, requirementParams(req.requirement))
            }}</span>
            <span class="text-text-secondary text-xs">{{
              t(`siem.compliance.fix.${req.requirement.kind}`, requirementParams(req.requirement))
            }}</span>
          </div>
        </template>
      </template>

      <template #tab-about>
        <div class="bg-surface-subtle rounded-surface flex flex-col gap-2 p-3">
          <span class="text-text-heading text-sm font-semibold">{{
            t("siem.compliance.howMeasured")
          }}</span>
          <p class="text-text-secondary text-xs leading-relaxed">
            {{ t("siem.compliance.howMeasuredBody") }}
          </p>
          <p class="text-text-secondary text-xs leading-relaxed">
            {{ t("siem.compliance.disclaimer") }}
          </p>
        </div>
      </template>

      <template #footer>
        <OButton
          v-if="needsRetention"
          variant="outline"
          size="sm-action"
          data-test="security-compliance-drawer-streams"
          @click="go('/streams')"
          >{{ t("siem.compliance.action.retention") }}</OButton
        >
        <OButton
          v-if="needsSources"
          variant="outline"
          size="sm-action"
          data-test="security-compliance-drawer-sources"
          @click="go('/security/events')"
          >{{ t("siem.compliance.action.sources") }}</OButton
        >
        <OButton
          :variant="needsDetections ? 'primary' : 'outline'"
          size="sm-action"
          data-test="security-compliance-drawer-detections"
          @click="go('/security/detections')"
          >{{ t("siem.compliance.action.detections") }}</OButton
        >
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
