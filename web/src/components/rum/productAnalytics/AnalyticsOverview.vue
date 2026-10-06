<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="px-page-edge flex flex-col gap-3 py-3" data-test="rum-analytics-overview">
    <OEmptyState
      v-if="isEmpty"
      preset="no-search-results"
      :title="t('rum.analytics.overview.emptyTitle', { app: raw(pa.state.app) })"
      :description="t('rum.analytics.overview.emptyDescription')"
      data-test="rum-analytics-overview-empty"
    >
      <template #actions>
        <OButton
          variant="primary"
          size="sm"
          data-test="rum-analytics-overview-widen-range-btn"
          @click="widenRange"
          >{{ t("rum.analytics.overview.widenRange") }}</OButton
        >
      </template>
    </OEmptyState>
    <template v-else>
      <div data-test="rum-analytics-kpi-strip">
        <OStatStrip :items="kpis" :loading="!summary" />
      </div>
      <ActiveUsersStrip
        v-if="identitySql"
        :state="activePanel"
        :field="identitySql.field"
        :unit="pa.usersUnit.value"
        @retry="runner.retry('active-users')"
      />
      <TrendsPanel
        ref="trendsPanel"
        :scope="pa.scope.value"
        :identity="identitySql"
        :users-label="pa.usersUnit.value.label"
        :series="pa.trendSeries.value"
        :events="events"
        :events-status="pa.eventsStatus.value"
        :range="range"
        @update:series="(s) => (pa.trendSeries.value = s)"
        @retry-events="pa.retryEvents()"
      />

      <div class="flex flex-wrap items-center gap-3" data-test="rum-analytics-overview-chips">
        <OToggleGroup
          :model-value="chip"
          type="single"
          mobile-dropdown
          @update:model-value="onChip"
        >
          <OToggleGroupItem value="all" size="xs" data-test="rum-analytics-overview-chip-all">{{
            chipLabel(t("rum.analytics.chips.all"), counts.all)
          }}</OToggleGroupItem>
          <OToggleGroupItem
            value="rising"
            size="xs"
            icon-left="trending-up"
            data-test="rum-analytics-overview-chip-rising"
            >{{ chipLabel(t("rum.analytics.chips.rising"), counts.rising) }}</OToggleGroupItem
          >
          <OToggleGroupItem
            value="declining"
            size="xs"
            icon-left="trending-down"
            data-test="rum-analytics-overview-chip-declining"
            >{{ chipLabel(t("rum.analytics.chips.declining"), counts.declining) }}</OToggleGroupItem
          >
          <OToggleGroupItem
            v-if="prevHasData"
            value="not_used"
            size="xs"
            data-test="rum-analytics-overview-chip-not-used"
            >{{ chipLabel(t("rum.analytics.chips.notUsed"), counts.not_used) }}</OToggleGroupItem
          >
        </OToggleGroup>
        <span class="text-text-secondary ms-auto text-xs max-md:hidden">{{
          t("rum.analytics.chips.caption")
        }}</span>
      </div>

      <OCard
        variant="outlined"
        class="rounded-surface overflow-hidden"
        data-test="rum-analytics-overview-pages"
      >
        <div class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span class="text-text-heading text-sm font-semibold">{{
            t("rum.analytics.overview.pages")
          }}</span>
          <span class="text-text-secondary min-w-0 flex-1 truncate text-xs">{{
            t("rum.analytics.overview.pagesCaption")
          }}</span>
          <OToggleGroup
            :model-value="view"
            type="single"
            mobile-dropdown
            data-test="rum-analytics-overview-pages-view-toggle"
            @update:model-value="onView"
          >
            <OToggleGroupItem
              value="all"
              size="xs"
              data-test="rum-analytics-overview-pages-view-all"
              >{{ t("rum.analytics.overview.allPages") }}</OToggleGroupItem
            >
            <OToggleGroupItem
              value="entry"
              size="xs"
              data-test="rum-analytics-overview-pages-view-entry"
              >{{ t("rum.analytics.overview.entryPages") }}</OToggleGroupItem
            >
            <OToggleGroupItem
              value="exit"
              size="xs"
              data-test="rum-analytics-overview-pages-view-exit"
              >{{ t("rum.analytics.overview.exitPages") }}</OToggleGroupItem
            >
          </OToggleGroup>
        </div>
        <RankedKeysTable
          :rows="pageRows"
          kind="p"
          :view="view"
          :chip="chip"
          :show-users="!!identitySql"
          :users-label="pa.usersUnit.value.short"
          :users-tooltip="partialTooltip"
          :state="view === 'all' ? pagesPanel : entryPanel"
          :key-label="t('rum.analytics.columns.page')"
          :events-label="t('rum.analytics.columns.views')"
          :compare-label="compareLabel"
          :trend-full="trendFull"
          :trended="pa.trendSeries.value"
          data-test="rum-analytics-overview-pages-table"
          @build-funnel="buildFunnel"
          @paths="openPaths"
          @trend="toggleTrend"
          @retry="view === 'all' ? runner.retry('pages') : loadEntryExit(true)"
        />
      </OCard>

      <OCard
        variant="outlined"
        class="rounded-surface overflow-hidden"
        data-test="rum-analytics-overview-clicks"
      >
        <div class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span class="text-text-heading text-sm font-semibold">{{
            t("rum.analytics.overview.clicks")
          }}</span>
          <span class="text-text-secondary min-w-0 flex-1 truncate text-xs">{{
            t("rum.analytics.overview.clicksCaption")
          }}</span>
        </div>
        <OBanner
          v-if="showNameHint"
          variant="info"
          dense
          class="mx-4 mt-2"
          :content="
            t('rum.analytics.overview.clickNameHint', { attribute: raw('actionNameAttribute') })
          "
          data-test="rum-analytics-overview-clicks-name-hint"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="sm"
              data-test="rum-analytics-overview-clicks-name-hint-link"
              @click="openSetup"
              >{{
                t("rum.analytics.overview.clickNameHintLink", {
                  attribute: raw("actionNameAttribute"),
                })
              }}</OButton
            >
          </template>
        </OBanner>
        <OEmptyState
          v-if="clicksNotCaptured"
          preset="no-data"
          size="inline"
          :title="t('rum.analytics.overview.clicksNotCapturedTitle')"
          :description="t('rum.analytics.overview.clicksNotCaptured')"
          data-test="rum-analytics-overview-clicks-not-captured"
        >
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="rum-analytics-overview-clicks-setup-link"
              @click="openSetup"
              >{{ t("rum.analytics.overview.openSetup") }}</OButton
            >
          </template>
        </OEmptyState>
        <RankedKeysTable
          v-else
          :rows="clickRows"
          kind="c"
          view="all"
          :chip="chip"
          :show-users="!!identitySql"
          :users-label="pa.usersUnit.value.short"
          :show-pages="true"
          :pages-pending="clickPagesPanel.status === 'loading'"
          :state="clicksPanel"
          :key-label="t('rum.analytics.columns.clickTarget')"
          :events-label="t('rum.analytics.columns.clicks')"
          :users-tooltip="t('rum.analytics.columns.clickUsersTooltip')"
          :compare-label="compareLabel"
          :trend-full="trendFull"
          :trended="pa.trendSeries.value"
          data-test="rum-analytics-overview-clicks-table"
          @build-funnel="buildFunnel"
          @paths="openPaths"
          @trend="toggleTrend"
          @define-event="defineEvent"
          @retry="runner.retry('clicks')"
          @page-keys="loadClickPages"
        />
      </OCard>

      <FeaturesTable
        :rows="featureRows"
        :events="events"
        :chip="chip"
        :show-users="!!identitySql"
        :users-label="pa.usersUnit.value.short"
        :users-tooltip="partialTooltip"
        :state="featuresPanel"
        :permission="namedEvents.permission.value"
        :compare-label="compareLabel"
        :trend-full="trendFull"
        :trended="pa.trendSeries.value"
        @build-funnel="buildFunnel"
        @paths="openPaths"
        @trend="toggleTrend"
        @manage="createEvent()"
        @retry="loadFeatures(true)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OCard from "@/lib/core/Card/OCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import RankedKeysTable from "@/components/rum/productAnalytics/RankedKeysTable.vue";
import ActiveUsersStrip from "@/components/rum/productAnalytics/ActiveUsersStrip.vue";
import TrendsPanel from "@/components/rum/productAnalytics/TrendsPanel.vue";
import FeaturesTable from "@/components/rum/productAnalytics/FeaturesTable.vue";
import useNamedEvents, {
  namedEventHandoffState,
  type NamedEventHandoff,
} from "@/composables/rum/useNamedEvents";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useFunnelDraft, { emptyFunnel } from "@/composables/rum/useFunnelDraft";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import useAnalyticsSearch, { type PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  applyClickPages,
  chipCounts,
  clickNameHint,
  identityGapMessage,
  matchesChip,
  sortForChip,
  toFeatureRows,
  toRankedRows,
  type ChipFilter,
  type RankedRow,
  type RankedView,
} from "@/utils/rum/productAnalyticsModel";
import {
  activeUsersSql,
  clickPagesSql,
  clicksSql,
  featuresSql,
  pagesSql,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "AnalyticsOverview" });

const MAX_TREND_SERIES = 5;
const FEATURE_CHUNK = 5;
const MAU_US = 30 * 86400000000;
const CLICK_PAGE_KEYS = 50;

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const pa = useProductAnalytics();
const funnelDraft = useFunnelDraft();
const trendsPanel = ref<InstanceType<typeof TrendsPanel> | null>(null);
const runner = useAnalyticsSearch();
const namedEvents = useNamedEvents();
const { summary, identitySql } = pa;
const events = computed(() => [...namedEvents.events.value]);

const pagesPanel = runner.panel<Record<string, unknown>>("pages");
const clicksPanel = runner.panel<Record<string, unknown>>("clicks");
const clickPagesPanel = runner.panel<{ k: string; pg: string; sessions: number }>("click-pages");
const activePanel = runner.panel<{ dau: number; wau: number; mau: number }>("active-users");
const entryPanel = ref<PanelState<unknown>>({
  status: "idle",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
});

const featureHits = ref<Record<string, number>>({});
const featuresPanel = ref<PanelState<unknown>>({
  status: "idle",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
});
let lastFeaturesKey = "";
let entrySeq = 0;
// Click pages read so far this run, kept on screen while the next table page's lookup runs.
const clickPages = ref<{ k: string; pg: string; sessions: number }[]>([]);
const chip = ref<ChipFilter>("all");
const view = ref<RankedView>("all");
let lastRunKey = "";
let lastClickPageKeys = "";
let active = true;
let activatedOnce = false;

const range = computed(() => pa.range.value ?? { startUs: 0, endUs: 0 });
const prevHasData = computed(() => (summary.value?.prevSessions ?? 0) > 0);
const totals = computed(() => ({
  cur: summary.value?.sessions ?? 0,
  prev: summary.value?.prevSessions ?? 0,
}));
const identityField = computed(() => identitySql.value?.field ?? null);
const trendFull = computed(() => pa.trendSeries.value.length >= MAX_TREND_SERIES);
const compareLabel = computed(() => t("rum.analytics.columns.vsPrevious"));

const allPageRows = computed(() => {
  const hits =
    view.value === "all"
      ? pagesPanel.value.rows
      : (entryPanel.value.rows as Record<string, unknown>[]);
  return toRankedRows(
    hits,
    "p",
    view.value,
    identityField.value,
    totals.value.cur,
    totals.value.prev,
    prevHasData.value,
  );
});

const allClickRows = computed(() =>
  applyClickPages(
    toRankedRows(
      clicksPanel.value.rows,
      "c",
      "all",
      identityField.value,
      totals.value.cur,
      totals.value.prev,
      prevHasData.value,
    ),
    clickPages.value,
  ),
);

const filterRows = (rows: RankedRow[]) =>
  sortForChip(
    rows.filter((r) => matchesChip(r, chip.value, prevHasData.value)),
    chip.value,
  );

const pageRows = computed(() => filterRows(allPageRows.value));
const clickRows = computed(() => filterRows(allClickRows.value));
const counts = computed(() =>
  chipCounts([allPageRows.value, allClickRows.value], prevHasData.value),
);

const featureRows = computed(() => {
  const rows = toFeatureRows(
    featureHits.value,
    events.value,
    totals.value.cur,
    totals.value.prev,
    prevHasData.value,
  );
  return chip.value === "all" ? rows : filterRows(rows);
});

const clickPageList = (key: string) =>
  clickPages.value
    .filter((r) => r.k === key && r.pg)
    .sort((a, b) => Number(b.sessions) - Number(a.sessions))
    .map((r) => String(r.pg));

const isEmpty = computed(() => {
  if (pa.scopeStatus.value !== "ok") return false;
  if (!pa.state.app || (summary.value && summary.value.sessions === 0)) return true;
  return (
    pagesPanel.value.status === "ok" &&
    clicksPanel.value.status === "ok" &&
    !pagesPanel.value.rows.length &&
    !clicksPanel.value.rows.length
  );
});

const clicksNotCaptured = computed(
  () =>
    clicksPanel.value.status === "ok" &&
    !clicksPanel.value.rows.length &&
    pagesPanel.value.rows.length > 0,
);

const showNameHint = computed(() =>
  clickNameHint(allClickRows.value.map((r) => ({ key: r.key, clicks: r.events ?? 0 }))),
);

const partialTooltip = computed(() =>
  pa.usersUnit.value.partial ? pa.usersUnit.value.label : undefined,
);

const kpis = computed<StatItem[]>(() => {
  const s = summary.value;
  const id = pa.identity.value;
  const unit = pa.usersUnit.value;
  const sessions = s?.sessions ?? 0;
  const prev = s?.prevSessions ?? 0;
  const change = prev > 0 ? (sessions - prev) / prev : null;
  return [
    {
      key: "sessions",
      label: t("rum.analytics.kpi.sessions"),
      value: addCommasToNumber(sessions),
      tone: "blue",
      icon: "group",
      dataTest: "rum-analytics-kpi-sessions",
      trend:
        change === null
          ? undefined
          : {
              direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
              label: raw(`${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`),
            },
    },
    {
      key: "users",
      label:
        unit.partial || id?.field === "usr_anonymous_id"
          ? unit.label
          : t("rum.analytics.kpi.users"),
      value: id?.field ? addCommasToNumber(id.users) : "—",
      sub: id?.field
        ? raw(id.field)
        : (identityGapMessage(id, true) ?? t("rum.analytics.kpi.noIdentity")),
      subIcon: unit.partial ? "info-outline" : undefined,
      subTooltip:
        unit.partial && id?.field
          ? t("rum.analytics.identity.countedBy", { field: raw(id.field) })
          : undefined,
      tone: "teal",
      icon: "person",
      dataTest: "rum-analytics-kpi-users",
    },
    {
      key: "pages",
      label: t("rum.analytics.kpi.pagesPerSession"),
      value: sessions > 0 ? ((s?.views ?? 0) / sessions).toFixed(1) : "0.0",
      tone: "purple",
      icon: "article",
      dataTest: "rum-analytics-kpi-pages-per-session",
    },
    {
      key: "coverage",
      label: t("rum.analytics.kpi.coverage"),
      value: `${((id?.field ? id.coverage : 0) * 100).toFixed(1)}%`,
      tone: "neutral",
      icon: "how-to-reg",
      dataTest: "rum-analytics-kpi-identity-coverage",
    },
  ];
});

const windows = () => {
  const r = pa.resolveRange();
  return { cur: r, prev: { startUs: r.startUs - (r.endUs - r.startUs), endUs: r.endUs } };
};

// Only the latest call may land, and a run superseded elsewhere leaves the view idle for the next run to reload.
const loadEntryExit = async (force = false) => {
  const seq = ++entrySeq;
  entryPanel.value = { ...entryPanel.value, status: "loading", error: null };
  try {
    const rows = await pa.entryExit(force);
    if (seq === entrySeq) entryPanel.value = { ...entryPanel.value, status: "ok", rows };
  } catch (e) {
    if (seq !== entrySeq) return;
    const state = (e as { state?: PanelState<unknown> }).state;
    if (state?.status === "loading" || state?.status === "aborted") {
      entryPanel.value = { ...entryPanel.value, status: "idle", rows: [] };
      return;
    }
    entryPanel.value = state
      ? { ...state }
      : { ...entryPanel.value, status: "error", error: { message: String((e as Error).message) } };
  }
};

const loadClickPages = async (keys: string[]) => {
  const list = keys.slice(0, CLICK_PAGE_KEYS);
  const joined = list.join("\u0000");
  if (!list.length || joined === lastClickPageKeys) return;
  lastClickPageKeys = joined;
  const runKey = lastRunKey;
  const { cur } = windows();
  const res = await runner.run<{ k: string; pg: string; sessions: number }>(
    "click-pages",
    { sql: clickPagesSql(pa.scope.value, cur.startUs, list), ...cur, limit: 2000, sampled: 1 },
    `${runKey}|${joined}`,
  );
  if (runKey !== lastRunKey) return;
  if (res.status !== "ok") {
    // A failed lookup is asked again the next time the table reports its page.
    if (lastClickPageKeys === joined && res.status !== "loading") lastClickPageKeys = "";
    return;
  }
  const fresh = new Set(list);
  clickPages.value = [...clickPages.value.filter((r) => !fresh.has(r.k)), ...res.rows];
};

const run = async (force = false) => {
  await pa.loadScope();
  if (!active || pa.scopeStatus.value !== "ok" || !pa.state.app) return;
  const id = identitySql.value;
  const key = `${pa.scopeKey.value}|${id ? `${id.field}:${id.excluded.length}` : ""}`;
  // Events can change while Overview is kept alive but away, so an unchanged scope still settles Features.
  if (!force && key === lastRunKey) return loadFeatures();
  lastRunKey = key;
  lastClickPageKeys = "";
  clickPages.value = [];
  if (!summary.value?.sessions) return;
  const { cur, prev } = windows();
  const scope = pa.scope.value;
  const jobs: Promise<unknown>[] = [
    runner.run(
      "pages",
      { sql: pagesSql(scope, cur.startUs, id), ...prev, limit: 500, sampled: 1 },
      key,
    ),
    runner.run(
      "clicks",
      { sql: clicksSql(scope, cur.startUs, id), ...prev, limit: 500, sampled: 1 },
      key,
    ),
  ];
  if (view.value !== "all") jobs.push(loadEntryExit(force));
  if (id) {
    jobs.push(
      runner.run(
        "active-users",
        {
          sql: activeUsersSql(scope, id, cur.endUs),
          startUs: cur.endUs - MAU_US,
          endUs: cur.endUs,
          limit: 1,
          sampled: 1,
        },
        key,
      ),
    );
  }
  await Promise.all(jobs);
  // Features is the heaviest search, so it never starts for a tab the user has already left.
  if (!active || key !== lastRunKey) return;
  await loadFeatures(force);
};

const chipLabel = (label: I18nText, count: number) =>
  t("rum.analytics.chips.withCount", { label, count });

const onChip = (v: unknown) => {
  if (v) chip.value = v as ChipFilter;
};

const onView = (v: unknown) => {
  if (!v) return;
  view.value = v as RankedView;
  if (view.value !== "all" && entryPanel.value.status !== "ok") void loadEntryExit();
};

const widenRange = () => pa.widenRange(router);

const openSetup = () => {
  void router.push({
    name: "frontendMonitoring",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

const buildFunnel = (step: StepRef) => {
  void funnelDraft.startNew({ ...emptyFunnel(), steps: [step] });
};

const openPaths = (step: StepRef) => {
  pa.paths.value = { ...pa.paths.value, anchor: step, cohort: null };
  pa.lastSubTab.value = "paths";
  void pa.pushSubTab(router, PA_ROUTES.paths);
};

const toggleTrend = async (step: StepRef) => {
  const current = pa.trendSeries.value;
  const same = (s: StepRef) => s.kind === step.kind && s.key === step.key;
  if (current.some(same)) {
    pa.trendSeries.value = current.filter((s) => !same(s));
    return;
  }
  if (current.length >= MAX_TREND_SERIES) return;
  pa.trendSeries.value = [...current, step];
  await nextTick();
  trendsPanel.value?.reveal(step);
};

const createEvent = (draft: NamedEventHandoff["draft"] = null, pageHints: string[] = []) => {
  void router.push({
    name: PA_ROUTES.eventNew,
    query: pa.toQuery(),
    state: namedEventHandoffState({ draft, pageHints, from: "overview" }),
  });
};

const defineEvent = (row: RankedRow) => {
  const pages = clickPageList(row.key);
  createEvent(
    {
      name: row.key,
      rules: [{ t: "action", targets: [row.key], onPage: row.topPage ?? pages[0] ?? "" }],
    },
    pages,
  );
};

// Named events run last and five per search: each one templates every view in range.
const loadFeatures = async (force = false) => {
  const list = events.value;
  if (!list.length || pa.scopeStatus.value !== "ok") {
    featureHits.value = {};
    featuresPanel.value = { ...featuresPanel.value, status: "ok", rows: [] };
    return;
  }
  const id = identitySql.value;
  const key = `${lastRunKey}|${JSON.stringify(list.map((e) => [e.id, e.rules]))}`;
  if (!force && key === lastFeaturesKey) return;
  lastFeaturesKey = key;
  const { cur, prev } = windows();
  featuresPanel.value = { ...featuresPanel.value, status: "loading", error: null };
  const chunks: (typeof list)[] = [];
  for (let i = 0; i < list.length; i += FEATURE_CHUNK)
    chunks.push(list.slice(i, i + FEATURE_CHUNK));
  const results = await Promise.all(
    chunks.map((chunk, c) =>
      runner.run<Record<string, number>>(
        `features-${c}`,
        { sql: featuresSql(pa.scope.value, cur.startUs, id, chunk), ...prev, limit: 1, sampled: 1 },
        key,
      ),
    ),
  );
  if (key !== lastFeaturesKey) return;
  // An aborted chunk is no answer: forget the key so the next visit runs Features again.
  if (results.some((r) => r.status === "aborted" || r.status === "loading")) {
    lastFeaturesKey = "";
    featuresPanel.value = { ...featuresPanel.value, status: "idle" };
    return;
  }
  const failed = results.find((r) => r.status !== "ok");
  if (failed) {
    featuresPanel.value = { ...failed };
    return;
  }
  const merged: Record<string, number> = {};
  results.forEach((r, c) => {
    const hit = r.rows[0] ?? {};
    for (const [k, v] of Object.entries(hit)) {
      const m = /^e(\d+)_(.*)$/.exec(k);
      if (m) merged[`e${Number(m[1]) + c * FEATURE_CHUNK}_${m[2]}`] = Number(v);
    }
  });
  featureHits.value = merged;
  featuresPanel.value = {
    ...featuresPanel.value,
    status: "ok",
    rows: [],
    partial: results.find((r) => r.partial)?.partial ?? null,
  };
};

watch(
  () => [pa.scopeKey.value, identitySql.value?.field, identitySql.value?.excluded.length],
  () => {
    if (active) void run();
  },
);

watch(
  () => namedEvents.events.value,
  () => {
    if (active && lastRunKey) void loadFeatures();
  },
);

// Series are session-only, so a deleted event is dropped rather than tagged; only a ready list proves it is gone.
watch(
  () => [pa.eventsStatus.value, namedEvents.events.value] as const,
  ([status, list]) => {
    if (status !== "ready") return;
    const known = new Set(list.map((e) => e.id));
    const kept = pa.trendSeries.value.filter((s) => s.kind !== "e" || known.has(s.key));
    if (kept.length !== pa.trendSeries.value.length) pa.trendSeries.value = kept;
  },
  { immediate: true },
);

watch(
  () => pa.refreshTick.value,
  () => {
    if (active) void run(true);
  },
);

onMounted(() => {
  void run();
});

onActivated(() => {
  active = true;
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  void runner.rerunAborted();
  if (view.value !== "all" && entryPanel.value.status === "idle") void loadEntryExit();
  void run();
});

onDeactivated(() => {
  active = false;
  runner.abortAll();
});

onBeforeUnmount(() => runner.abortAll());
</script>
