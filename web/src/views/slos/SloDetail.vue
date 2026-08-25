<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  SLO status page (alerts_2.md §6b.10).

  The frozen banner is the most important element here. When coverage is below
  the floor the SLO's alerts neither fire nor resolve, and a user looking at a
  green-looking page needs to know that what they are seeing is stale rather
  than healthy. Every derived stat renders an em dash in that state.

  The per-group table excludes the rollup row: it is the EXACT overall (S-9),
  not a group, and listing it alongside the groups would double-count in any
  reading that sums the rows.
-->
<template>
  <OPageLayout
    :title="notFound ? t('slos.notFound') : raw(slo?.name || sloId)"
    icon="track-changes"
    :subtitle="notFound ? raw('') : subtitle"
    :back="{ to: backTarget, label: t('slos.title') }"
    title-data-test="slos-slodetail-title"
    bleed
  >
    <template #title-trail>
      <div class="flex items-center gap-2">
        <OTag
          v-if="slo"
          :variant="healthVariant"
          :icon="healthIcon(health)"
          size="sm"
          :label="t(`slos.health.${health}`)"
          data-test="slos-slodetail-health"
        />
        <OTag
          v-for="tag in slo?.tags || []"
          :key="tag"
          variant="default-soft"
          size="xs"
          :label="raw(tag)"
        />
      </div>
    </template>

    <template #actions>
      <!-- An alert SLI's numbers are only as good as its source, so the source
           is one click away from the page that reports them. -->
      <OButton
        v-if="sourceAlertId"
        variant="outline"
        size="sm-action"
        icon-left="shield"
        data-test="slos-slodetail-source-alert"
        @click="goToSourceAlert"
      >
        {{ t("slos.alertSli.sourceLink") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="notifications"
        data-test="slos-slodetail-new-alert"
        @click="goToNewAlert"
      >
        {{ t("slos.newAlert") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="edit"
        data-test="slos-slodetail-edit"
        @click="goToEdit"
      >
        {{ t("common.edit") }}
      </OButton>
    </template>

    <!-- The page is `bleed` so the groups table can run flush to the window
         edge, which means everything that is NOT that table has to supply its
         own inset. OContent is that inset — it puts the banner and the tiles
         on the same page-edge grid line as the title above and the config
         list below, instead of hard against the window. `y` because the strip
         sits directly under the header and needs the breathing room. -->
    <OContent y v-if="!notFound">
      <!-- Not a subtle indicator: a frozen SLO's alerts neither fire nor
           resolve, and mistaking that for healthy is the failure mode. -->
      <OBanner
        v-if="frozenBanner"
        variant="warning"
        :icon="frozenBanner.icon"
        class="mb-3"
        data-test="slos-slodetail-frozen-banner"
      >
        <span class="font-bold">{{ frozenBanner.title }}</span>
        {{ frozenBanner.body }}
      </OBanner>

      <OStatStrip v-if="slo" :items="stats" data-test="slos-slodetail-stats" />
    </OContent>

    <!-- No `mt-*`: OContent's bottom inset above already separates the strip
         from the tabs, and no horizontal padding either — a tab strip's first
         label self-aligns to the page-edge grid. -->
    <OTabs v-if="!notFound" v-model="tab" class="shrink-0" data-test="slos-slodetail-tabs">
      <OTab
        name="trend"
        :label="t('slos.tab.trend')"
        icon="show-chart"
        data-test="slos-slodetail-tab-trend"
      />
      <OTab
        name="groups"
        :label="t('slos.tab.groups')"
        icon="layers"
        v-if="isGrouped"
        data-test="slos-slodetail-tab-groups"
      />
      <OTab
        name="alerts"
        :label="t('slos.alerts.title')"
        icon="shield"
        data-test="slos-slodetail-tab-alerts"
      />
      <OTab
        name="config"
        :label="t('slos.tab.configuration')"
        icon="settings"
        data-test="slos-slodetail-tab-config"
      />
    </OTabs>

    <!-- The page body is a FIXED flex column (OPageLayout's default: no
         `scroll`, so nothing scrolls unless something inside says it does), and
         the panels below it are taller than a short viewport — two 15rem charts
         on Trend, a JSON block on Configuration. Without a scroller here they
         were simply clipped: on a 1280×620 screen the burn-rate panel ended
         ~245px below the fold with no way to reach it.

         The header, stat strip and tab bar stay PINNED (`shrink-0`) and only
         the panel scrolls — scrolling the whole body instead would push the
         SLI and budget numbers off-screen, and those are the readings the
         charts below are being compared against. -->
    <div v-if="!notFound" class="min-h-0 flex-1">
      <OTabPanels v-model="tab" grow scroll="y" class="h-full min-h-0">
        <OTabPanel name="alerts">
          <OContent y>
            <SloAlertsPanel
              ref="alertsPanel"
              v-if="slo"
              :slo="slo"
              :edit-alert-id="editAlertId"
              @close-editor="clearEditLink"
              @edit-target-missing="clearEditLink"
            />
          </OContent>
        </OTabPanel>

        <OTabPanel name="trend">
          <OContent y>
            <!-- The ribbon before the burndown: for an alert SLI the first
                 question is whether the source was running at all, and the
                 grey bands are the only place that answer is visible. -->
            <SloAlertPreview
              v-if="slo && sourceAlertId"
              class="mb-4"
              data-test="slos-slodetail-alert-ribbon"
              :alert-id="sourceAlertId"
              :window-secs="slo.window_secs"
              :slice-interval-secs="slo.slice_interval_secs"
            />
            <SloBurndownChart
              v-if="slo"
              :slo-id="slo.id"
              :generation="slo.definition_generation"
              :target="slo.target"
              :window-secs="slo.window_secs"
              :slice-interval-secs="slo.slice_interval_secs"
              :sli-type="slo.sli_type"
              data-test="slos-slodetail-burndown"
            />
          </OContent>
        </OTabPanel>

        <!-- Deliberately NOT `stretch`/`fill-height`: this OTable is `h-auto`,
             so it sizes to its 25 rows and rides the one scroller above rather
             than opening a second, nested one. Every tab then scrolls the same
             way, which is the point of putting the scroller on the panels. -->
        <OTabPanel v-if="isGrouped" name="groups">
          <!-- `bleed-x` keeps the table flush to the window edge (above); `y`
               supplies only the vertical inset, so the gap under the tab strip
               is the same on every tab. -->
          <OContent bleed-x y>
            <OTable
              :data="groups"
              :columns="groupColumns"
              row-key="group_key"
              :loading="groupsLoading"
              :frame="false"
              :page-size="25"
              :show-global-filter="false"
              table-id="slo-groups"
              data-test="slos-slodetail-groups-table"
            >
              <template #cell-group_key="{ row }">
                <span class="text-compact font-mono">{{ row.group_key }}</span>
              </template>
              <template #cell-sli="{ row }">
                <span v-if="!row.no_data" class="tabular-nums">{{ formatSli(row.sli) }}</span>
                <span v-else class="text-text-secondary">{{ ABSENT }}</span>
              </template>
              <template #cell-budget="{ row }">
                <span
                  v-if="!row.no_data"
                  class="tabular-nums"
                  :class="
                    (row.error_budget_remaining ?? 0) <= 0 ? 'text-negative font-semibold' : ''
                  "
                >
                  {{ formatBudget(row.error_budget_remaining) }}
                </span>
                <span v-else class="text-text-secondary">{{ ABSENT }}</span>
              </template>
              <template #cell-burn="{ row }">
                <span v-if="!row.no_data" class="tabular-nums">{{
                  formatBurn(row.burn_rate)
                }}</span>
                <span v-else class="text-text-secondary">{{ ABSENT }}</span>
              </template>
              <template #cell-coverage="{ row }">
                <span class="tabular-nums" :class="row.no_data ? 'text-warning font-semibold' : ''">
                  {{ formatCoverage(row.coverage) }}
                </span>
              </template>
              <template #empty>
                <OEmptyState
                  icon="layers"
                  :title="t('slos.groups.emptyTitle')"
                  :description="t('slos.groups.emptyDescription')"
                />
              </template>
            </OTable>
          </OContent>
        </OTabPanel>

        <OTabPanel name="config">
          <OContent y>
            <SloConfigSummary v-if="slo" :slo="slo" />
          </OContent>
        </OTabPanel>
      </OTabPanels>
    </div>

    <OContent v-if="notFound" class="py-6">
      <OEmptyState
        size="hero"
        :title="t('slos.notFound')"
        :description="t('slos.notFoundDescription')"
        data-test="slos-slodetail-not-found"
      />
    </OContent>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import SloAlertPreview from "@/components/slos/SloAlertPreview.vue";
import SloAlertsPanel from "@/components/slos/SloAlertsPanel.vue";
import SloBurndownChart from "@/components/slos/SloBurndownChart.vue";
import SloConfigSummary from "@/components/slos/SloConfigSummary.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { Slo, SloStatus } from "@/ts/interfaces/slo";
import sloService from "@/services/slos";
import {
  ABSENT,
  formatBudget,
  formatBurn,
  formatCoverage,
  formatSli,
  formatSlice,
  formatTarget,
  formatTimeToExhaust,
  formatWindow,
  healthIcon,
  sliTypeLabel,
  sloHealth,
} from "@/composables/useSloFormat";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const slo = ref<Slo | null>(null);
const status = ref<SloStatus | null>(null);
const groups = ref<SloStatus[]>([]);
const groupsLoading = ref(false);
const notFound = ref(false);
// Trend first: "how did the budget get here" is the question the page is
// usually opened to answer. The configuration is a reference lookup and keeps
// its tab, it is just no longer what greets you.
const tab = ref("trend");

/** The alert an incoming deep link wants opened (Phase 3). The alerts list's
 *  edit button diverts here rather than into the generic editor, which cannot
 *  represent an SLO alert. */
/** The Alerts panel, driven by the header's "New alert" button. */
const alertsPanel = ref<any>(null);

const editAlertId = computed(() => {
  const v = route.query.edit_alert;
  return typeof v === "string" && v ? v : null;
});

/** Dropped with `replace`, never `push`: a history entry here means the back
 *  button walks straight back into the editor the user just closed. */
const clearEditLink = () => {
  if (!editAlertId.value) return;
  const query = { ...route.query };
  delete query.edit_alert;
  router.replace({ query });
};

const sloId = computed(() => String(route.params.slo_id || ""));
const org = computed(() => store.state.selectedOrganization?.identifier);
const health = computed(() => sloHealth(status.value));
const isGrouped = computed(() => !!slo.value?.group_by && slo.value.group_by.length > 0);

/// Reads as "below the 80% floor" when the server exposes the value, and
/// "below the configured floor" when it does not — the sentence has to work
/// either way, which the literal "the configured floor" broke by producing
/// "below the the configured floor floor".
const coverageFloorLabel = computed(() => {
  const floor = store.state.zoConfig?.slo_min_coverage;
  return floor ? `${Math.round(Number(floor) * 100)}%` : "configured";
});

/** The alert an `alert` SLI reads, or null for the other SLI types. */
const sourceAlertId = computed(() => {
  if (slo.value?.sli_type !== "alert") return null;
  const id = slo.value?.config?.alert_id;
  return typeof id === "string" && id ? id : null;
});

function goToSourceAlert() {
  if (!sourceAlertId.value) return;
  router.push({
    name: "alertDetail",
    params: { alert_id: sourceAlertId.value },
    query: { org_identifier: org.value },
  });
}

/** The watermark, as a wall-clock time in the viewer's zone.
 *
 *  It reads up to ~K recompute slices later than the source's last real
 *  evaluation (§2) — close enough for a banner, and the only timestamp the
 *  status row carries. */
const watermarkLabel = computed(() => {
  const at = status.value?.watermark_end;
  if (!at) return ABSENT;
  return format(toZonedTime(at * 1000, store.state.timezone), "yyyy-MM-dd HH:mm");
});

/** How much of the window is actually measurable yet, when that is the reason
 *  it is not full. The server sends `measuring_since` only while it is later
 *  than the window's start, so its presence IS the condition. */
const measuringSince = computed(() => {
  const since = status.value?.measuring_since;
  const windowSecs = slo.value?.window_secs;
  if (!since || !windowSecs) return null;
  const DAY = 86400;
  const measured = Math.max(0, Math.floor(Date.now() / 1000 - since) / DAY);
  return {
    since: format(toZonedTime(since * 1000, store.state.timezone), "yyyy-MM-dd HH:mm"),
    measured: Math.floor(measured),
    window: Math.round(windowSecs / DAY),
  };
});

const FROZEN_ICON = "ac_unit";

/** Which freeze the SLO is in, and therefore what the banner may claim.
 *
 *  §2 has two doors and only one of them is about a percentage. A source that
 *  stops evaluating stalls the WATERMARK while measured coverage of the pinned
 *  window stays high, so "41% of this window was unmeasured" would be simply
 *  false there; that sentence is only true after the source resumes and the
 *  accumulated hole slides into the window. Staleness is checked first, which
 *  is the same precedence `coverage::observe` applies. */
const frozenBanner = computed(() => {
  const s = status.value;
  if (!s) return null;
  // Only claimed when there IS a "since": an SLO that has never measured also
  // reads as stale, and telling someone their brand-new source "stopped
  // evaluating" would be plainly false.
  if (s.stale_watermark && s.watermark_end && sourceAlertId.value) {
    return {
      icon: FROZEN_ICON,
      title: t("slos.frozen.alertStaleTitle"),
      body: t("slos.frozen.alertStaleBody", { since: watermarkLabel.value }),
    };
  }
  // Checked BEFORE the frozen test, unlike the two coverage messages: a
  // partial window is at its most misleading when it is NOT frozen. Twenty-
  // eight of thirty days is 93% coverage, comfortably over the floor, so the
  // page publishes an SLI under a "rolling 30 days" heading that it measured
  // over 28 — the exact reading this banner exists to replace.
  if (measuringSince.value) {
    return {
      // Not the snowflake: a window that is still filling is not frozen, and
      // this banner now shows while the SLO is publishing figures.
      icon: "hourglass_empty",
      title: t("slos.frozen.measuringSinceTitle", { since: measuringSince.value.since }),
      body: t("slos.frozen.measuringSinceBody", measuringSince.value),
    };
  }
  if (!s.no_data) return null;
  const coverage = { coverage: formatCoverage(s.coverage), floor: coverageFloorLabel.value };
  return {
    icon: FROZEN_ICON,
    title: t("slos.frozen.title"),
    body: sourceAlertId.value
      ? t("slos.frozen.alertGapsBody", coverage)
      : t("slos.frozen.body", coverage),
  };
});

const backTarget = computed(() => ({
  name: "sloList",
  query: { org_identifier: org.value },
}));

const subtitle = computed(() => {
  if (!slo.value) return raw("");
  const parts = [
    sliTypeLabel(slo.value.sli_type, t),
    t("slos.overRolling", { window: formatWindow(slo.value.window_secs) }),
    formatSlice(slo.value.slice_interval_secs),
  ];
  return raw(parts.join(" · "));
});

const healthVariant = computed(() => {
  switch (health.value) {
    case "budget_blown":
      return "error-soft";
    case "at_risk":
      return "warning-soft";
    case "meeting":
      return "success-soft";
    default:
      return "default-soft";
  }
});

const stats = computed<StatItem[]>(() => {
  const s = status.value;
  const frozen = !s || s.no_data;
  return [
    {
      key: "sli",
      dataTest: "slos-slodetail-stat-sli",
      label: t("slos.stat.status", { window: formatWindow(slo.value?.window_secs ?? 0) }),
      value: frozen ? ABSENT : formatSli(s!.sli),
      tone: frozen ? "neutral" : health.value === "meeting" ? "success" : "error",
    },
    {
      key: "target",
      dataTest: "slos-slodetail-stat-target",
      label: t("slos.stat.target"),
      value: slo.value ? formatTarget(slo.value.target) : ABSENT,
      tone: "primary",
    },
    {
      key: "budget",
      dataTest: "slos-slodetail-stat-budget",
      label: t("slos.stat.budgetRemaining"),
      value: frozen ? ABSENT : formatBudget(s!.error_budget_remaining),
      tone: frozen ? "neutral" : (s!.error_budget_remaining ?? 0) <= 0 ? "error" : "success",
    },
    {
      key: "burn",
      dataTest: "slos-slodetail-stat-burn",
      label: t("slos.stat.burnRate"),
      value: frozen ? ABSENT : formatBurn(s!.burn_rate),
      tone: frozen ? "neutral" : (s!.burn_rate ?? 0) > 1 ? "error" : "success",
    },
    {
      key: "exhaust",
      dataTest: "slos-slodetail-stat-exhaust",
      label: t("slos.stat.timeToExhaust"),
      value: frozen ? ABSENT : formatTimeToExhaust(s!.time_to_exhaust_secs),
      tone: "neutral",
    },
    {
      key: "coverage",
      dataTest: "slos-slodetail-stat-coverage",
      label: t("slos.stat.coverage"),
      value: formatCoverage(s?.coverage),
      tone: frozen ? "warning" : "neutral",
    },
  ];
});

const groupColumns = computed<OTableColumnDef<SloStatus>[]>(() => [
  {
    id: "group_key",
    header: t("slos.column.group"),
    accessor: (r: any) => r.group_key,
    sortable: true,
    size: 280,
  },
  {
    id: "sli",
    header: t("slos.column.sli"),
    accessor: (r: any) => r.sli ?? -1,
    sortable: true,
    size: 130,
  },
  {
    id: "budget",
    header: t("slos.column.budgetRemaining"),
    accessor: (r: any) => r.error_budget_remaining ?? null,
    sortable: true,
    size: 160,
  },
  {
    id: "burn",
    header: t("slos.column.burnRate"),
    accessor: (r: any) => r.burn_rate ?? -1,
    sortable: true,
    size: 120,
  },
  {
    id: "coverage",
    header: t("slos.column.coverage"),
    accessor: (r: any) => r.coverage,
    sortable: true,
    size: 120,
  },
]);

async function load() {
  if (!org.value || !sloId.value) return;
  try {
    const res = await sloService.get(org.value, sloId.value);
    const body = res.data ?? {};
    status.value = body.status ?? null;
    // The API flattens the SLO alongside `status`; strip it back out so the
    // config tab renders the definition and nothing else.
    const { status: _ignored, ...rest } = body;
    slo.value = rest as Slo;

    // Fetch the groups, but do NOT switch to their tab: every SLO opens on
    // Trend. This used to select "groups" here, which meant a grouped SLO could
    // never land on the trend charts — and the per-group breakdown answers
    // "which one broke", a question you only ask after the burndown has shown
    // you that something did.
    if (rest.group_by?.length) {
      await loadGroups();
    }
  } catch (e) {
    slo.value = null;
    notFound.value = true;
  }
}

async function loadGroups() {
  groupsLoading.value = true;
  try {
    const res = await sloService.groups(org.value, sloId.value);
    groups.value = res.data?.list ?? [];
  } finally {
    groupsLoading.value = false;
  }
}

function goToEdit() {
  router.push({
    name: "editSlo",
    params: { slo_id: sloId.value },
    query: { org_identifier: org.value },
  });
}

async function goToNewAlert() {
  // Opens the form HERE. This used to push to `alertList?slo_id=…`, a param
  // nothing ever consumed — and now that the generic form has no SLO mode,
  // that route offers no way to create an SLO alert at all.
  tab.value = "alerts";
  await nextTick();
  alertsPanel.value?.startCreate();
}

// A deep link lands on the Alerts tab; without this it would open on Trend
// with the editor mounted in a panel nobody is looking at.
if (editAlertId.value) tab.value = "alerts";

onMounted(load);
</script>
