<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- MITRE ATT&CK — tactic columns × techniques carried by the Sigma catalog and the
     org's detections; green = enabled detection, hot = fired in window, dashed = not enabled. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import SecurityRecordDrawer, {
  type RecordFact,
  type RecordTab,
} from "@/components/security/SecurityRecordDrawer.vue";
import { useSiemDetections } from "@/composables/security/useSiemDetections";
import { useAlertHistoryWindow } from "@/composables/security/useAlertHistoryWindow";
import { sigmaCatalog } from "@/utils/security/sigma";
import { sigmaLogsourceLabel } from "@/utils/security/sourceTypes";
import { isFiring } from "@/utils/security/history";
import { techniqueUrl } from "@/utils/security/mitre";
import {
  buildAttackMatrix,
  heatLevel,
  parentTechnique,
  summarizeMatrix,
  type MatrixDetection,
  type MatrixFiring,
  type TechniqueCell as MatrixCell,
} from "@/utils/security/attackMatrix";
import type { SigmaRule } from "@/utils/security/sigma";
import { severityTagValue, toneLabelKey, toneOfSigmaLevel } from "@/utils/security/severity";
import { formatEventCount } from "@/utils/formatters";

type TechniqueCell = MatrixCell<SigmaRule>;

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
  RANGES.some((r) => r.value === route.query.period) ? (route.query.period as RangeKey) : "7d",
);
function onRangeChange(value: unknown) {
  if (!value || value === range.value) return;
  range.value = value as RangeKey;
  router.replace({ query: { ...route.query, period: range.value } });
  void loadHistory();
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
const history = useAlertHistoryWindow();
const lastRunAt = ref<number | null>(null);

async function loadHistory() {
  const end = Date.now();
  const minutes = RANGES.find((r) => r.value === range.value)!.minutes;
  await history.load(orgId.value, end - minutes * 60_000, end);
  lastRunAt.value = Date.now();
}
function refresh() {
  void loadDetections(orgId.value);
  void loadHistory();
}
onMounted(refresh);
watch(orgId, refresh);

const rulesPending = computed(() => rulesLoading.value || hydrating.value);
const loading = computed(() => rulesPending.value || history.loading.value);

const catalog = sigmaCatalog();

const detections = computed<MatrixDetection[]>(() =>
  siemRows.value.map(({ alert, meta }) => ({
    name: String(alert.name ?? ""),
    enabled: !!alert.enabled,
    sigmaId: meta.sigmaId,
    level: meta.level,
    techniques: meta.techniques,
    tactics: meta.tactics,
  })),
);

const firings = computed<MatrixFiring[]>(() =>
  history.rows.value.filter(isFiring).flatMap((row) => {
    const det = byName.value.get(row.alert_name);
    return det
      ? [
          {
            name: det.meta.title,
            timeMs: Math.floor(row.timestamp / 1000),
            techniques: det.meta.techniques,
          },
        ]
      : [];
  }),
);

const matrix = computed(() => buildAttackMatrix(catalog, detections.value, firings.value));
const summary = computed(() => summarizeMatrix(matrix.value));

// ── Filters ──────────────────────────────────────────────────────────────────
type View = "all" | "covered" | "gaps" | "firing";
const view = ref<View>("all");
const search = ref("");

function visible(cell: TechniqueCell): boolean {
  if (view.value === "covered" && cell.enabledCount === 0) return false;
  if (view.value === "gaps" && cell.enabledCount > 0) return false;
  if (view.value === "firing" && cell.firings === 0) return false;
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  return (
    cell.id.toLowerCase().includes(q) ||
    cell.catalogRules.some((r) => r.title.toLowerCase().includes(q)) ||
    cell.detections.some((d) => d.name.toLowerCase().includes(q))
  );
}

const columns = computed(() =>
  matrix.value.columns.map((col) => ({
    ...col,
    shown: col.cells.filter(visible),
    covered: col.cells.filter((c) => c.enabledCount > 0).length,
  })),
);
const unmapped = computed(() => matrix.value.unmapped.filter(visible));
const filtered = computed(() => view.value !== "all" || !!search.value.trim());

/** Reading order for next/previous: down each column, left to right. */
const order = computed(() => {
  const seen = new Set<string>();
  const out: TechniqueCell[] = [];
  for (const col of columns.value) {
    for (const cell of col.shown) {
      if (!seen.has(cell.id)) {
        seen.add(cell.id);
        out.push(cell);
      }
    }
  }
  for (const cell of unmapped.value) if (!seen.has(cell.id)) out.push(cell);
  return out;
});

// ── Summary strip ────────────────────────────────────────────────────────────
const stats = computed<StatItem[]>(() => [
  {
    key: "firing",
    label: t("siem.mitrePage.stat.firing"),
    value: summary.value.techniquesFiring,
    icon: "local-fire-department",
    tone: "error",
    dataTest: "security-mitre-stat-firing",
  },
  {
    key: "gaps",
    label: t("siem.mitrePage.stat.gaps"),
    value: summary.value.gaps,
    icon: "grid-on",
    tone: "warning",
    dataTest: "security-mitre-stat-gaps",
  },
  {
    key: "covered",
    label: t("siem.mitrePage.stat.techniques", { total: summary.value.techniquesTotal }),
    value: summary.value.techniquesCovered,
    max: summary.value.techniquesTotal || undefined,
    icon: "verified-user",
    tone: "success",
    dataTest: "security-mitre-stat-covered",
  },
  {
    key: "tactics",
    label: t("siem.mitrePage.stat.tactics", { total: summary.value.tacticsTotal }),
    value: summary.value.tacticsCovered,
    max: summary.value.tacticsTotal,
    icon: "target",
    tone: "primary",
    selectable: false,
    dataTest: "security-mitre-stat-tactics",
  },
]);
const selectedStat = computed(() => (view.value === "all" ? null : view.value));
function onStat(key: string) {
  view.value = view.value === key ? "all" : (key as View);
}

// ── Cells ────────────────────────────────────────────────────────────────────
const HEAT_CLASS = [
  "",
  "bg-badge-orange-soft-bg text-badge-orange-soft-text border-transparent",
  "bg-badge-error-soft-bg text-badge-error-soft-text border-transparent",
  "bg-badge-error-solid-bg text-badge-error-solid-text border-transparent",
];
function cellClass(cell: TechniqueCell): string {
  if (cell.firings > 0) return HEAT_CLASS[heatLevel(cell.firings)];
  if (cell.enabledCount > 0)
    return "bg-badge-success-soft-bg text-badge-success-soft-text border-transparent";
  return "bg-surface-base text-text-secondary border-border-default border-dashed";
}

// ── Drawer ───────────────────────────────────────────────────────────────────
const selectedId = ref<string | null>(null);
const selected = computed(() =>
  selectedId.value ? (matrix.value.cells.get(selectedId.value) ?? null) : null,
);
const selectedIndex = computed(() => {
  const i = order.value.findIndex((c) => c.id === selectedId.value);
  return i === -1 ? null : i;
});
const drawerTab = ref("detections");

function openCell(cell: TechniqueCell) {
  selectedId.value = cell.id;
}
function step(delta: number) {
  const i = selectedIndex.value;
  if (i === null) return;
  const next = order.value[i + delta];
  if (next) selectedId.value = next.id;
}

const installed = computed(() => new Set(detections.value.map((d) => d.sigmaId).filter(Boolean)));
const availableRules = computed(() =>
  (selected.value?.catalogRules ?? []).filter((r) => !r.id || !installed.value.has(r.id)),
);
const recentFirings = computed(() =>
  selected.value
    ? firings.value
        .filter((f) => f.techniques.some((x) => x.toUpperCase() === selected.value!.id))
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, 50)
    : [],
);

const drawerTone = computed(() => {
  const cell = selected.value;
  if (!cell) return "neutral" as const;
  if (cell.firings > 0)
    return heatLevel(cell.firings) >= 2 ? ("critical" as const) : ("high" as const);
  return cell.enabledCount > 0 ? ("success" as const) : ("neutral" as const);
});

const drawerFacts = computed<RecordFact[]>(() => {
  const cell = selected.value;
  if (!cell) return [];
  return [
    { label: t("siem.mitrePage.fact.state"), value: t(`siem.mitrePage.state.${cell.state}`) },
    { label: t("siem.mitrePage.fact.enabled"), value: cell.enabledCount },
    { label: t("siem.mitrePage.fact.catalog"), value: cell.catalogRules.length },
    {
      label: t("siem.mitrePage.fact.firings", { range: t(`siem.range.${range.value}`) }),
      value: formatEventCount(cell.firings),
    },
  ];
});

const drawerTabs = computed<RecordTab[]>(() => [
  {
    name: "detections",
    label: t("siem.mitrePage.tab.detections"),
    icon: "shield-alert-outline",
    count: (selected.value?.detections.length ?? 0) + availableRules.value.length,
  },
  {
    name: "firings",
    label: t("siem.mitrePage.tab.firings"),
    icon: "local-fire-department",
    count: selected.value?.firings ?? 0,
  },
  { name: "reference", label: t("siem.mitrePage.tab.reference"), icon: "menu-book" },
]);

function enableRule(ruleId: string | undefined) {
  router.push({
    path: "/security/detections",
    query: { org_identifier: orgId.value, ...(ruleId ? { sigma_id: ruleId } : {}) },
  });
}
function openDetections() {
  router.push({ path: "/security/detections", query: { org_identifier: orgId.value } });
}
</script>

<template>
  <OPageLayout
    :title="t('siem.mitrePage.title')"
    :subtitle="t('siem.mitrePage.subtitle')"
    icon="grid-on"
    scroll
    pad-y
    title-data-test="security-mitre-title"
  >
    <template #actions>
      <div class="flex items-center gap-2">
        <OToggleGroup
          :model-value="range"
          data-test="security-mitre-range"
          @update:model-value="onRangeChange"
        >
          <OToggleGroupItem
            v-for="r in RANGES"
            :key="r.value"
            :value="r.value"
            size="sm"
            :data-test="`security-mitre-range-${r.value}`"
          >
            {{ t(`siem.range.${r.value}`) }}
          </OToggleGroupItem>
        </OToggleGroup>
        <ORefreshButton
          :last-run-at="lastRunAt"
          :loading="loading"
          data-test="security-mitre-refresh"
          @click="refresh"
        />
      </div>
    </template>

    <div class="flex flex-col gap-4 pb-4">
      <OBanner
        v-if="unchecked > 0"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-mitre-unchecked"
      >
        {{ t("siem.overview.uncheckedRules", unchecked) }}
      </OBanner>
      <OBanner
        v-if="history.capped.value"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-mitre-history-capped"
      >
        {{
          t("siem.mitrePage.historyCapped", {
            n: formatEventCount(history.rows.value.length),
            total: formatEventCount(history.total.value),
          })
        }}
      </OBanner>

      <OBanner
        v-if="history.effectiveStartMs.value"
        variant="warning"
        icon="warning-amber"
        dense
        data-test="security-mitre-history-narrowed"
      >
        {{
          t("siem.mitrePage.historyNarrowed", {
            from: new Date(history.effectiveStartMs.value).toLocaleString(),
          })
        }}
      </OBanner>

      <OStatStrip
        :items="stats"
        :loading="
          (rulesPending && !siemRows.length) || (history.loading.value && lastRunAt === null)
        "
        selectable
        :selected-key="selectedStat"
        data-test="security-mitre-stats"
        @select="onStat"
      />

      <div class="flex flex-wrap items-center gap-3">
        <OToggleGroup
          :model-value="view"
          data-test="security-mitre-view"
          @update:model-value="(v: unknown) => (view = (v as View) || 'all')"
        >
          <OToggleGroupItem value="all" size="sm" data-test="security-mitre-view-all">{{
            t("siem.mitrePage.view.all")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="covered" size="sm" data-test="security-mitre-view-covered">{{
            t("siem.mitrePage.view.covered")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="gaps" size="sm" data-test="security-mitre-view-gaps">{{
            t("siem.mitrePage.view.gaps")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="firing" size="sm" data-test="security-mitre-view-firing">{{
            t("siem.mitrePage.view.firing")
          }}</OToggleGroupItem>
        </OToggleGroup>
        <div class="w-72">
          <OSearchInput
            v-model="search"
            :placeholder="t('siem.mitrePage.search')"
            size="sm"
            data-test="security-mitre-search"
          />
        </div>
        <div class="flex-1" />
        <div class="text-2xs text-text-secondary flex flex-wrap items-center gap-3">
          <span class="flex items-center gap-1.5">
            <span class="flex items-center gap-0.5">
              <span class="bg-badge-orange-soft-bg rounded-default size-3" />
              <span class="bg-badge-error-soft-bg rounded-default size-3" />
              <span class="bg-badge-error-solid-bg rounded-default size-3" />
            </span>
            {{ t("siem.mitrePage.legend.firing") }}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="bg-badge-success-soft-bg rounded-default size-3" />
            {{ t("siem.mitrePage.legend.covered") }}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="border-border-default rounded-default size-3 border border-dashed" />
            {{ t("siem.mitrePage.legend.available") }}
          </span>
        </div>
      </div>

      <!-- The matrix: one column per tactic, scrolls sideways on narrow screens -->
      <div
        class="bg-card-glass-bg border-border-default rounded-surface overflow-x-auto border"
        data-test="security-mitre-matrix"
      >
        <div class="grid grid-cols-[repeat(14,minmax(6.5rem,1fr))] gap-px">
          <div
            v-for="col in columns"
            :key="col.tactic"
            class="flex min-w-0 flex-col"
            :data-test="`security-mitre-column-${col.tactic}`"
          >
            <div
              class="border-border-default bg-surface-panel sticky top-0 flex min-h-14 flex-col justify-between border-b px-2 py-2"
            >
              <div class="text-text-heading text-xs leading-tight font-semibold">
                {{ t(`siem.mitre.tactics.${col.tactic}`) }}
              </div>
              <div class="text-2xs text-text-secondary tabular-nums">
                {{
                  t("siem.mitrePage.columnCount", { covered: col.covered, total: col.cells.length })
                }}
              </div>
            </div>
            <div class="flex flex-col gap-1.5 p-1.5">
              <template v-if="rulesPending && !siemRows.length">
                <OSkeleton v-for="n in 3" :key="n" class="h-12" />
              </template>
              <template v-else>
                <div
                  v-for="cell in col.shown"
                  :key="cell.id"
                  role="button"
                  tabindex="0"
                  class="rounded-default hover:border-accent focus-visible:border-accent flex cursor-pointer flex-col gap-0.5 border px-2 py-1.5 transition-colors"
                  :class="[cellClass(cell), { '!border-accent': selectedId === cell.id }]"
                  :data-test="`security-mitre-cell-${cell.id}`"
                  @click="openCell(cell)"
                  @keydown.enter="openCell(cell)"
                  @keydown.space.prevent="openCell(cell)"
                >
                  <div class="flex items-center justify-between gap-1">
                    <span class="font-mono text-xs font-semibold">{{ cell.id }}</span>
                    <span v-if="cell.firings" class="text-2xs font-semibold tabular-nums">
                      {{ formatEventCount(cell.firings) }}
                    </span>
                  </div>
                  <span class="text-2xs truncate opacity-80">
                    {{
                      cell.enabledCount
                        ? t("siem.mitrePage.cellEnabled", cell.enabledCount)
                        : t("siem.mitrePage.cellAvailable", cell.catalogRules.length)
                    }}
                  </span>
                  <OTooltip :content="cell.catalogRules.map((r) => r.title).join(' · ')" />
                </div>
              </template>
              <span
                v-if="!col.shown.length && !(rulesPending && !siemRows.length)"
                class="text-2xs text-text-secondary px-1 py-2 text-center"
                >—</span
              >
            </div>
          </div>
        </div>
      </div>

      <OEmptyState
        v-if="filtered && !order.length && !rulesPending"
        size="block"
        icon="search-off"
        :title="t('siem.mitrePage.noMatch')"
        filtered
        data-test="security-mitre-empty"
        @action="
          () => {
            view = 'all';
            search = '';
          }
        "
      />

      <div v-if="unmapped.length" class="flex flex-col gap-2" data-test="security-mitre-unmapped">
        <span class="text-text-secondary text-xs font-semibold">{{
          t("siem.mitrePage.unmapped")
        }}</span>
        <div class="flex flex-wrap gap-1.5">
          <OTag
            v-for="cell in unmapped"
            :key="cell.id"
            clickable
            variant="default-soft"
            shape="rounded"
            size="sm"
            :data-test="`security-mitre-unmapped-${cell.id}`"
            @click="openCell(cell)"
            >{{ cell.id }}</OTag
          >
        </div>
      </div>

      <p class="text-2xs text-text-secondary">
        {{ t("siem.mitrePage.footnote", { n: catalog.length }) }}
      </p>
    </div>

    <SecurityRecordDrawer
      v-if="selected"
      :open="!!selected"
      v-model:tab="drawerTab"
      :title="selected.id"
      :eyebrow="t('siem.mitrePage.drawerEyebrow')"
      :subtitle="selected.tactics.map((x) => t(`siem.mitre.tactics.${x}`)).join(' · ')"
      icon="grid-on"
      :tone="drawerTone"
      :facts="drawerFacts"
      :tabs="drawerTabs"
      :index="selectedIndex"
      :total="order.length"
      data-test="security-mitre-drawer"
      @close="selectedId = null"
      @prev="step(-1)"
      @next="step(1)"
    >
      <template #chips>
        <OTag
          :variant="
            selected.state === 'firing'
              ? 'error-soft'
              : selected.state === 'covered'
                ? 'success-soft'
                : 'default-soft'
          "
          size="sm"
          >{{ t(`siem.mitrePage.state.${selected.state}`) }}</OTag
        >
        <OTag v-for="tactic in selected.tactics" :key="tactic" variant="primary-soft" size="sm">{{
          t(`siem.mitre.tactics.${tactic}`)
        }}</OTag>
        <OTag
          v-if="parentTechnique(selected.id) !== selected.id"
          variant="default-soft"
          size="sm"
          class="font-mono"
          >{{ t("siem.mitrePage.subOf", { id: parentTechnique(selected.id) }) }}</OTag
        >
      </template>

      <template #tab-detections>
        <div class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.mitrePage.yourDetections")
          }}</span>
          <div
            v-for="det in selected.detections"
            :key="det.name"
            class="border-border-default rounded-surface flex items-center gap-2 border p-3"
            :data-test="`security-mitre-detection-${det.name}`"
          >
            <OTag
              type="severity"
              :value="severityTagValue(toneOfSigmaLevel(det.level))"
              :label="t(toneLabelKey(toneOfSigmaLevel(det.level)))"
              size="xs"
            />
            <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">{{
              det.name
            }}</span>
            <OTag :variant="det.enabled ? 'success-soft' : 'default-soft'" size="xs">
              {{ det.enabled ? t("siem.mitrePage.enabled") : t("siem.mitrePage.disabled") }}
            </OTag>
          </div>
          <OEmptyState
            v-if="!selected.detections.length"
            size="inline"
            icon="shield-alert-outline"
            :title="t('siem.mitrePage.noDetections')"
          />
        </div>

        <div v-if="availableRules.length" class="flex flex-col gap-2">
          <span class="text-text-secondary text-xs font-semibold tracking-wide uppercase">{{
            t("siem.mitrePage.inCatalog")
          }}</span>
          <div
            v-for="rule in availableRules"
            :key="rule.id ?? rule.title"
            class="border-border-default rounded-surface flex items-start gap-3 border border-dashed p-3"
            :data-test="`security-mitre-catalog-${rule.id}`"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex items-center gap-2">
                <OTag
                  type="severity"
                  :value="severityTagValue(toneOfSigmaLevel(rule.level))"
                  :label="t(toneLabelKey(toneOfSigmaLevel(rule.level)))"
                  size="xs"
                />
                <span class="text-text-heading min-w-0 truncate text-sm font-medium">{{
                  rule.title
                }}</span>
              </div>
              <span class="text-text-secondary font-mono text-xs">{{
                sigmaLogsourceLabel(rule.logsource)
              }}</span>
              <p v-if="rule.description" class="text-text-secondary line-clamp-2 text-xs">
                {{ rule.description }}
              </p>
            </div>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              :data-test="`security-mitre-enable-${rule.id}`"
              @click="enableRule(rule.id)"
            >
              {{ t("siem.mitrePage.enable") }}
            </OButton>
          </div>
        </div>
      </template>

      <template #tab-firings>
        <OEmptyState
          v-if="!recentFirings.length"
          size="inline"
          icon="task-alt"
          :title="t('siem.mitrePage.noFirings', { range: t(`siem.range.${range}`) })"
        />
        <div v-else class="border-border-default rounded-surface overflow-hidden border">
          <div
            v-for="(f, i) in recentFirings"
            :key="`${f.name}-${f.timeMs}-${i}`"
            class="border-border-subtle flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <OIcon name="local-fire-department" size="xs" class="text-status-error-text shrink-0" />
            <span class="text-text-heading min-w-0 flex-1 truncate text-sm">{{ f.name }}</span>
            <OTimeCell :value="f.timeMs" unit="ms" class="text-xs" />
          </div>
        </div>
      </template>

      <template #tab-reference>
        <div class="bg-surface-subtle rounded-surface flex flex-col gap-2 p-3">
          <span class="text-text-heading text-sm font-semibold">{{ selected.id }}</span>
          <p class="text-text-secondary text-xs leading-relaxed">
            {{ t("siem.mitrePage.referenceHint") }}
          </p>
          <div class="flex flex-wrap gap-2">
            <OButton
              as="a"
              :href="techniqueUrl(selected.id)"
              target="_blank"
              rel="noopener"
              variant="outline"
              size="sm"
              icon-right="open-in-new"
              data-test="security-mitre-reference-link"
              >{{ t("siem.mitrePage.openTechnique", { id: selected.id }) }}</OButton
            >
            <OButton
              v-if="parentTechnique(selected.id) !== selected.id"
              as="a"
              :href="techniqueUrl(parentTechnique(selected.id))"
              target="_blank"
              rel="noopener"
              variant="ghost"
              size="sm"
              icon-right="open-in-new"
              data-test="security-mitre-reference-parent"
              >{{
                t("siem.mitrePage.openTechnique", { id: parentTechnique(selected.id) })
              }}</OButton
            >
          </div>
        </div>
      </template>

      <template #footer>
        <OButton
          as="a"
          :href="techniqueUrl(selected.id)"
          target="_blank"
          rel="noopener"
          variant="outline"
          size="sm-action"
          icon-right="open-in-new"
          data-test="security-mitre-drawer-attack"
          >{{ t("siem.mitrePage.viewOnAttack") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm-action"
          data-test="security-mitre-drawer-detections"
          @click="openDetections"
          >{{ t("siem.mitrePage.manageDetections") }}</OButton
        >
      </template>
    </SecurityRecordDrawer>
  </OPageLayout>
</template>
