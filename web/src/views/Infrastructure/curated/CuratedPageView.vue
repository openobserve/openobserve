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

<!-- One renderer for every curated workload page: three faces, the explainer strip, badges and scope pickers (design §6). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import type { I18nKey, I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import DateTime from "@/components/DateTime.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import type { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { getConsumableRelativeTime } from "@/utils/date";
import type { WorkloadId } from "@/composables/useWorkloadDetection";
import { curatedPacks } from "./packs";
import { FLEET_DRILLDOWN_EVENT, FLEET_DRILLDOWN_TAB } from "./packs/kubernetes.page";
import { useCuratedPage } from "./useCuratedPage";
import type { HiddenGroupInfo, StaleGroupInfo } from "./resolve";

const props = defineProps<{ workload: WorkloadId }>();

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

// No fallback: a packless route rendering another workload's manifest is a lie, not a degradation.
const pack = curatedPacks[props.workload];
const hasPack = computed(() => pack != null);
const manifest = computed(() => pack ?? curatedPacks.kubernetes!);

const page = useCuratedPage(manifest.value, {
  drilldownRange: () =>
    selectedWindow.value.kind === "relative"
      ? { period: selectedWindow.value.period }
      : { from: selectedWindow.value.from, to: selectedWindow.value.to },
});
const {
  face,
  l0State,
  loadError,
  dashboard,
  hiddenGroups,
  partialGroups,
  staleGroups,
  warnings,
  stripAutoExpand,
  presentGroupIds,
  refresh,
} = page;

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const timezone = computed(() => store.state.timezone ?? "UTC");

const DEFAULT_WINDOW_US = 3 * 60 * 60 * 1_000_000;

// The SELECTION, not its bounds: a relative window means "as of now", so it is materialized per refresh.
type CuratedWindow =
  | { kind: "relative"; period: string; widthUs: number }
  | { kind: "absolute"; from: number; to: number };

const selectedWindow = ref<CuratedWindow>({
  kind: "relative",
  period: manifest.value.defaultRelativePeriod,
  widthUs: periodWidthUs(manifest.value.defaultRelativePeriod),
});

const range = ref(materialize(selectedWindow.value));
const checkedAtUs = ref<number | null>(null);

// RelativeTime reads a ms epoch; handing it the µs value dates the refresh to the year 57000.
const checkedAtMs = computed(() =>
  checkedAtUs.value === null ? null : Math.floor(checkedAtUs.value / 1000),
);

// MICROSECOND epoch, undivided: usePanelDataLoader hands these to executePromQL as µs, so ms lands the x-axis in 1970.
const currentTimeObj = computed(() => ({
  __global: {
    start_time: new Date(range.value.from),
    end_time: new Date(range.value.to),
  },
}));

/** A period string the picker cannot parse still has to yield a window, so the arithmetic falls back to its width. */
function periodWidthUs(period: string): number {
  const consumable = getConsumableRelativeTime(period);
  return consumable ? consumable.endTime - consumable.startTime : DEFAULT_WINDOW_US;
}

function materialize(window: CuratedWindow): { from: number; to: number } {
  if (window.kind === "absolute") return { from: window.from, to: window.to };
  const consumable = getConsumableRelativeTime(window.period);
  if (consumable) return { from: consumable.startTime, to: consumable.endTime };
  const now = Date.now() * 1000;
  return { from: now - window.widthUs, to: now };
}

const runRefresh = async (force = false) => {
  // An unregistered workload resolves nothing, so it must also fetch nothing.
  if (!hasPack.value) return;
  // Re-anchored per refresh: a relative window frozen at page load empties every range-plotted panel as the clock advances.
  range.value = materialize(selectedWindow.value);
  await refresh({ orgId: orgId.value, start: range.value.from, end: range.value.to, force });
  checkedAtUs.value = Date.now() * 1000;
};

// ── Faces ───────────────────────────────────────────────────────────────────

/** The manifest's FIRST group's setup door drives the undetected face (§6.1). */
const setupDoor = computed(() => manifest.value.groups[0]?.setup);
const showPartialTelemetry = computed(
  () => face.value === "undetected" && l0State.value === "detected",
);
const partialTelemetryKey = computed(() => {
  if (props.workload === "hosts") return "infra.curated.partialTelemetryHosts" as const;
  return "infra.curated.partialTelemetryKubernetes" as const;
});

const openSetupRoute = () => {
  const door = setupDoor.value;
  if (door?.kind === "route") router.push({ name: door.routeName });
};

// ── Charts ──────────────────────────────────────────────────────────────────

const visibleTabs = computed(() => ((dashboard.value as any)?.tabs ?? []) as any[]);
const showTabs = computed(() => visibleTabs.value.length > 1);

const selectedTabId = ref<string | null>(null);
provide("selectedTabId", selectedTabId);

/** True while WE are writing ?tab=, so the URL→tab watcher below ignores our own echo. */
const isInternalUrlUpdate = ref(false);

/** The tab the URL asks for, or null when it names nothing currently rendered. */
const requestedTabId = (tabs: any[]) => {
  const requested = route.query.tab;
  return tabs.some((tab) => tab.tabId === requested) ? (requested as string) : null;
};

watch(
  visibleTabs,
  (tabs) => {
    if (tabs.length === 0) {
      selectedTabId.value = null;
      return;
    }
    if (!tabs.some((tab) => tab.tabId === selectedTabId.value)) {
      // A cross-tab drilldown lands with ?tab=, which must outrank the tabs[0] default.
      selectedTabId.value = requestedTabId(tabs) ?? tabs[0].tabId;
    }
  },
  { immediate: true },
);

// Written back with `replace` (seeded default included) so the URL is shareable and Back leaves the page, not each tab.
watch(
  selectedTabId,
  (tabId) => {
    // Pre-resolution null would write ?tab=undefined and then have to take it back.
    if (tabId === null) return;
    // The drilldown's own push already carries this tab; re-writing it would duplicate the navigation.
    if (route.query.tab === tabId) return;
    isInternalUrlUpdate.value = true;
    void router
      .replace({ query: { ...route.query, tab: tabId } })
      .finally(() => (isInternalUrlUpdate.value = false));
  },
  // The seeding watcher resolves the default before this one exists, so without immediate it never sees it.
  { immediate: true },
);

// ── Explainer strip ─────────────────────────────────────────────────────────

const stripExpanded = ref(false);
// Seeds the expansion once: re-syncing on every change discarded a collapse the user had just performed.
let stripSeeded = false;
watch(
  stripAutoExpand,
  (expand) => {
    if (stripSeeded) return;
    stripSeeded = true;
    stripExpanded.value = expand;
  },
  { immediate: true },
);

const hasStrip = computed(
  () =>
    hiddenGroups.value.length > 0 || partialGroups.value.length > 0 || staleGroups.value.length > 0,
);

const collapsedCapabilities = computed<I18nText>(() => {
  const sentences = hiddenGroups.value.map((hidden) => t(hidden.group.capabilityKey));
  // With nothing hidden the strip only carries stale or partial groups, which have no capability sentence to show.
  const labels = [...staleGroups.value, ...partialGroups.value].map((entry) =>
    t(entry.group.labelKey),
  );
  const items = sentences.length > 0 ? sentences : [...new Set(labels)];
  const separator = sentences.length > 0 ? " " : ", ";
  if (items.length === 0) return raw("");
  // Already-translated sentences: joining them widens to plain string, it does not untranslate them.
  if (items.length <= 2) return raw(items.join(separator));
  return t("infra.curated.hiddenSummaryMore", {
    first: items[0],
    count: items.length - 1,
  });
});

const absentStreams = (hidden: HiddenGroupInfo) =>
  hidden.missingStreams.filter((entry) => entry.state === "absent");
const staleStreams = (hidden: HiddenGroupInfo) =>
  hidden.missingStreams.filter((entry) => entry.state === "stale");

const formatUs = (value: number | null | undefined) =>
  value == null ? "" : timestampToTimezoneDate(Math.floor(value / 1000), timezone.value);

/** Dormant face: every group whose streams exist but stopped reporting. */
const dormantGroups = computed(() =>
  hiddenGroups.value
    .map((hidden) => ({ hidden, stale: staleStreams(hidden) }))
    .filter((entry) => entry.stale.length > 0)
    .map(({ hidden, stale }) => ({
      group: hidden.group,
      streams: stale.map((entry) => entry.name).join(", "),
      date: formatUs(Math.max(...stale.map((entry) => entry.lastSeenUs ?? 0))),
    })),
);

const expandedSetupSlug = ref<string | null>(null);
const onStripSetup = (group: HiddenGroupInfo["group"] | StaleGroupInfo["group"]) => {
  if (group.setup.kind === "route") {
    router.push({ name: group.setup.routeName });
    return;
  }
  expandedSetupSlug.value = expandedSetupSlug.value === group.setup.slug ? null : group.setup.slug;
};

/** A caveat about the active section's panels as a SET (§6.3) — never per tile. */
const sectionNoteKey = computed(
  () =>
    visibleTabs.value.find((tab) => tab.tabId === selectedTabId.value)?.curatedNoteKey as
      I18nKey | undefined,
);

// ── Stale banner + positive freshness ───────────────────────────────────────

const staleDurations = computed(() =>
  staleGroups.value.map((stale) => {
    // A listed stream whose stats never flushed serializes doc_time_max: 0, which formats as the Unix epoch.
    const noDataYet = stale.noDataYet === true || !stale.lastSeenUs;
    return {
      id: stale.group.id,
      key: noDataYet ? "infra.curated.staleNoDataBanner" : "infra.curated.staleBanner",
      // The label, not the capability sentence: "... are unavailable stopped 3 hours ago" does not parse.
      capability: t(stale.group.labelKey),
      duration: noDataYet ? "" : humanDuration(stale.lastSeenUs),
      date: noDataYet ? "" : formatUs(stale.lastSeenUs),
    };
  }),
);

function humanDuration(sinceUs: number): string {
  // Measured against the later of window-end and wall clock, so a trailing range never reports a negative age.
  const reference = Math.max(range.value.to, Date.now() * 1000);
  const minutes = Math.max(1, Math.floor((reference - sinceUs) / 60_000_000));
  if (minutes < 60) return t("infra.curated.durationMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("infra.curated.durationHours", { count: hours });
  return t("infra.curated.durationDays", { count: Math.floor(hours / 24) });
}

// ── Warnings ────────────────────────────────────────────────────────────────

// The composable can only name the group by ID; this banner is user-facing copy.
const probeWarnings = computed(() =>
  warnings.value
    .filter((entry) => entry.kind === "probe")
    .map((entry) => {
      const group = manifest.value.groups.find((candidate) => candidate.id === entry.message);
      return { key: entry.message, label: group ? t(group.labelKey) : raw(entry.message) };
    }),
);
const statsWarning = computed(() => warnings.value.some((entry) => entry.kind === "stats"));
/** schema, semantic-groups and groups-missing are one event to a user (§8.4). */
const defaultFieldNamesWarning = computed(() =>
  warnings.value.some((entry) =>
    ["schema", "semantic-groups", "groups-missing"].includes(entry.kind),
  ),
);

// ── Scope pickers ───────────────────────────────────────────────────────────

const variableList = computed(() => ((dashboard.value as any)?.variables?.list ?? []) as any[]);

// Panels read COMMITTED variables and this viewOnly page has no apply button, so the picker selection itself commits.
type VariablesManager = ReturnType<typeof useVariablesManager>;
const variablesManager = ref<VariablesManager | null>(null);
let stopCommitWatch: (() => void) | undefined;

// Rebuilding every `var-` key from getUrlParams (which omits empties) drops cleared pickers, suffixed shapes included.
const syncPickerUrl = (manager: VariablesManager) => {
  const params = manager.getUrlParams({ useLive: false });
  const query: Record<string, any> = { ...route.query };
  for (const key of Object.keys(query)) {
    if (key.startsWith("var-")) delete query[key];
  }
  Object.assign(query, params);
  const unchanged =
    Object.keys(query).length === Object.keys(route.query).length &&
    Object.keys(query).every((key) => String(query[key]) === String(route.query[key]));
  if (unchanged) return;
  // A scope correction is not a navigable step, so it must not stack a history entry.
  isInternalUrlUpdate.value = true;
  void router.replace({ query }).finally(() => (isInternalUrlUpdate.value = false));
};

const onVariablesManagerReady = (manager: VariablesManager) => {
  variablesManager.value = manager;
  stopCommitWatch?.();
  // Values ONLY: options and loading flags churn per fetch and would re-run panels for an untouched picker.
  stopCommitWatch = watch(
    () => manager.variablesData.global.map((variable) => variable.value),
    () => {
      manager.commitAll();
      syncPickerUrl(manager);
    },
    { deep: true },
  );
};

onBeforeUnmount(() => stopCommitWatch?.());

// ── Fleet-quadrant drilldown ────────────────────────────────────────────────

// The sandboxed chart JS cannot reach the router, so it emits a DOM event; `location.assign` reloaded the whole SPA.
const onClusterDrilldown = (event: Event) => {
  const cluster = (event as CustomEvent<{ cluster?: string }>).detail?.cluster;
  if (!cluster) return;
  const query: Record<string, any> = { ...route.query };
  // Stale scope from the tab being left: a cluster-scoped drilldown must not inherit the previous one.
  for (const key of Object.keys(query)) {
    if (key === "var-cluster" || key.startsWith("var-cluster.")) delete query[key];
  }
  query["var-cluster"] = cluster;
  query.tab = FLEET_DRILLDOWN_TAB;
  void router.push({ query });
};

onMounted(() => document.addEventListener(FLEET_DRILLDOWN_EVENT, onClusterDrilldown));
onBeforeUnmount(() => document.removeEventListener(FLEET_DRILLDOWN_EVENT, onClusterDrilldown));

// Re-applies the drilldown's two params on re-entry and Back/Forward; keyed on them alone so other params don't snap the tab.
watch(
  () => [route.query.tab, route.query["var-cluster"]] as const,
  () => {
    // Our own ?tab= echo carries no var-cluster; re-entering would reset a hand-picked cluster on every tab click.
    if (isInternalUrlUpdate.value) return;
    const query = route.query;
    const tabs = visibleTabs.value;
    if (tabs.length > 0) {
      // Falls back exactly as the seeding watcher does, so a Back to a tab-less URL lands on the default rather than sticking.
      selectedTabId.value = requestedTabId(tabs) ?? tabs[0].tabId;
    }
    const manager = variablesManager.value;
    if (!manager) return;
    // loadFromUrl only APPLIES the keys it finds, so a Back that drops var-cluster would strand the drilled-in value.
    const cluster = manager.getVariable("cluster", "global");
    if (cluster && query["var-cluster"] === undefined) {
      manager.updateVariableValue(
        "cluster",
        "global",
        undefined,
        undefined,
        cluster.multiSelect ? [] : (cluster.options?.[0]?.value ?? null),
      );
    }
    manager.loadFromUrl({ query });
    manager.commitAll();
  },
);

/** A single-cluster org loses its picker, so the name renders as static text. */
const singleClusterName = computed(() => {
  const cluster = variableList.value.find((variable) => variable.name === "cluster");
  if (!cluster?.omitWhenValuesEmpty) return null;
  const values = cluster.options as { value: string }[] | undefined;
  if (!Array.isArray(values) || values.length !== 1) return null;
  return values[0]?.value ?? null;
});

// The "no data" state and the phase-tile subtitle both render ON the tile (§6.3), so PanelContainer owns them.

/** Navigation only — it creates, copies, imports and forks nothing (§6.5). */
const openDashboardsList = () => {
  const window = selectedWindow.value;
  // A relative window travels as its PERIOD, so the destination re-anchors it rather than inheriting our materialized bounds.
  const query =
    window.kind === "relative"
      ? { org_identifier: orgId.value, period: window.period }
      : { org_identifier: orgId.value, from: String(window.from), to: String(window.to) };
  router.push({ name: "dashboards", query });
};

// ── Range, focus and org-switch triggers ────────────────────────────────────

let rangeTimer: ReturnType<typeof setTimeout> | undefined;

const onDateChange = (date: {
  startTime: number;
  endTime: number;
  relativeTimePeriod?: string | null;
  valueType?: string;
  userChangedValue?: boolean;
}) => {
  const isRelative = date.valueType !== "absolute" && !!date.relativeTimePeriod;
  selectedWindow.value = isRelative
    ? {
        kind: "relative",
        period: date.relativeTimePeriod!,
        widthUs: Math.max(0, date.endTime - date.startTime),
      }
    : { kind: "absolute", from: date.startTime, to: date.endTime };
  range.value = materialize(selectedWindow.value);
  // DateTime replays on mount with userChangedValue:false — "do not fetch"; the selection above is still recorded.
  if (date.userChangedValue === false) return;
  // The ONE debounce seam: refresh() itself is never delayed, so org switches and Retry stay immediate.
  if (rangeTimer) clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => void runRefresh(false), 300);
};

const onWindowFocus = () => {
  // Only while the setup face shows, so a healthy page never storms on focus.
  if (face.value === "undetected") void runRefresh(true);
};

onMounted(() => {
  void runRefresh(false);
  window.addEventListener("focus", onWindowFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener("focus", onWindowFocus);
  if (rangeTimer) clearTimeout(rangeTimer);
});

watch(
  () => store.state.selectedOrganization?.identifier,
  (next, prev) => {
    if (!next || next === prev) return;
    // The previous org's picker selections must not survive into the next one.
    const query = { ...route.query };
    for (const key of Object.keys(query)) {
      if (key.startsWith("var-")) delete query[key];
    }
    void router.replace({ query });
    void runRefresh(true);
  },
);
</script>

<template>
  <OPageLayout :title="t(manifest.titleKey)" :icon="manifest.icon">
    <template #actions>
      <div class="flex items-center gap-2">
        <DateTime
          auto-apply
          menu-align="end"
          :default-type="'relative'"
          :default-relative-time="manifest.defaultRelativePeriod"
          data-test-name="curated-date-time"
          @on:date-change="onDateChange"
        />
        <!-- The SAME indicator the dashboard panel bar carries — one staleness vocabulary app-wide. -->
        <span
          v-if="checkedAtMs !== null"
          class="text-text-secondary flex items-center gap-1 max-md:hidden"
          data-test="curated-last-refreshed"
        >
          <OIcon name="schedule" size="xs" />
          <OText variant="meta" as="span">
            <RelativeTime
              :timestamp="checkedAtMs"
              :full-time-prefix="t('dashboard.panelErrorButtons.lastRefreshedAt')"
            />
          </OText>
          <OTooltip side="bottom" align="end">
            <template #content>
              {{ t("dashboard.panelErrorButtons.lastRefreshed")
              }}<RelativeTime :timestamp="checkedAtMs" />
            </template>
          </OTooltip>
        </span>
        <!-- Icon-only on phones so the actions share the title row; sr-only keeps the button named. -->
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          class="max-md:min-w-0 max-md:ps-2 max-md:pe-2"
          data-test="curated-refresh"
          @click="runRefresh(true)"
        >
          <span class="max-md:sr-only">{{ t("infra.curated.refresh") }}</span>
        </OButton>
      </div>
    </template>

    <OEmptyState
      v-if="!hasPack"
      size="hero"
      illustration="board"
      class="min-h-0 flex-1"
      data-test="curated-pack-unavailable"
      :title="t('infra.curated.packUnavailable')"
      :description="t('infra.curated.packUnavailableHint')"
      :action-label="t('infra.curated.buildOwnDashboard')"
      @action="openDashboardsList"
    />

    <!-- `unknown` + loadError is the lists-failed state, never an endless spinner. -->
    <OEmptyState
      v-else-if="face === 'unknown' && loadError"
      preset="load-error"
      size="hero"
      class="min-h-0 flex-1"
      data-test="curated-error"
      :description="t('infra.curated.pageError')"
      @action="runRefresh(true)"
    />

    <div
      v-else-if="face === 'unknown'"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="curated-spinner"
    >
      <OSpinner size="lg" />
      <OText variant="meta" data-test="curated-checking">{{
        t("infra.curated.checking", { workload: t(manifest.titleKey) })
      }}</OText>
    </div>

    <div v-else-if="face === 'undetected'" class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 py-6"
        data-test="curated-setup-state"
      >
        <OText tag="h2" class="text-xl font-semibold">{{
          t("infra.workload.setupHeadline")
        }}</OText>
        <OText v-if="showPartialTelemetry" variant="meta" data-test="curated-partial-telemetry">{{
          t(partialTelemetryKey)
        }}</OText>
        <DataSourceSetupCard
          v-if="setupDoor?.kind === 'card'"
          :slug="setupDoor.slug"
          @detected="runRefresh(true)"
        />
        <div v-else-if="setupDoor?.kind === 'route'">
          <OButton
            variant="primary"
            size="sm-action"
            icon-left="cloud"
            data-test="curated-setup-route-cta"
            @click="openSetupRoute"
          >
            {{ t("infra.workload.awsSetupCta") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Streams exist but stopped reporting, so this names the outage and offers no setup CTA. -->
    <div
      v-else-if="face === 'dormant'"
      class="flex min-h-0 flex-1 flex-col justify-center-safe overflow-y-auto"
      data-test="curated-dormant-state"
    >
      <OEmptyState
        illustration="hourglass"
        :title="t('infra.curated.dormantHeadline', { workload: t(manifest.titleKey) })"
        :description="t('infra.curated.dormantBody')"
      >
        <template #extra>
          <div class="flex w-full max-w-xl flex-col gap-2 text-start">
            <OBanner
              v-for="hidden in dormantGroups"
              :key="hidden.group.id"
              variant="warning"
              dense
              data-test="curated-dormant-stream"
              :content="
                t('infra.curated.streamsStale', {
                  list: hidden.streams,
                  date: hidden.date,
                })
              "
            />
          </div>
        </template>
      </OEmptyState>
    </div>

    <div v-else-if="dashboard" class="flex min-h-0 flex-1 flex-col">
      <div v-if="singleClusterName" class="flex flex-wrap items-end gap-3 pb-2">
        <OText variant="meta" data-test="curated-single-cluster">{{
          raw(singleClusterName)
        }}</OText>
      </div>

      <RenderDashboardCharts
        :dashboardData="dashboard"
        :currentTimeObj="currentTimeObj"
        :viewOnly="true"
        searchType="dashboards"
        :showTabs="showTabs"
        :frame="false"
        @variablesData="page.rememberPickerOptions"
        @variablesManagerReady="onVariablesManagerReady"
      >
        <template #before_panels>
          <div class="flex flex-col gap-2 pb-2">
            <OBanner
              v-for="stale in staleDurations"
              :key="stale.id"
              variant="warning"
              dense
              data-test="curated-stale-banner"
              :content="
                t(stale.key as never, {
                  capability: stale.capability,
                  duration: stale.duration,
                  date: stale.date,
                })
              "
            />

            <OBanner
              v-for="warning in probeWarnings"
              :key="warning.key"
              variant="info"
              dense
              data-test="curated-warning-probe"
              :content="t('infra.curated.warnBanner.probe', { label: warning.label })"
            />
            <OBanner
              v-if="defaultFieldNamesWarning"
              variant="info"
              dense
              data-test="curated-warning-defaultFieldNames"
              :content="t('infra.curated.warnBanner.defaultFieldNames')"
            />
            <OBanner
              v-if="statsWarning"
              variant="info"
              dense
              data-test="curated-warning-stats"
              :content="t('infra.curated.warnBanner.stats')"
            />

            <OCollapsible
              v-if="hasStrip"
              v-model="stripExpanded"
              class="border-border-default rounded-surface border p-3"
              data-test="curated-strip"
              :label="collapsedCapabilities"
            >
              <div class="flex flex-col gap-3 pt-3" data-test="curated-strip-expanded">
                <div
                  v-for="hidden in hiddenGroups"
                  :key="hidden.group.id"
                  class="flex flex-col gap-1"
                  :data-test="`curated-strip-group-${hidden.group.id}`"
                >
                  <div class="flex items-center justify-between gap-2">
                    <OText>{{ t(hidden.group.capabilityKey) }}</OText>
                    <!-- A PRESENT group's collector already works; only a field is missing, so no "Set up". -->
                    <OButton
                      v-if="!presentGroupIds.includes(hidden.group.id)"
                      variant="outline"
                      size="sm-action"
                      data-test="curated-strip-setup"
                      @click="onStripSetup(hidden.group)"
                    >
                      {{ t("infra.curated.setUp") }}
                    </OButton>
                  </div>
                  <OText variant="meta" data-test="curated-strip-hint">{{
                    t(hidden.group.setupHintKey)
                  }}</OText>
                  <OText
                    v-if="absentStreams(hidden).length"
                    variant="meta"
                    data-test="curated-strip-streams-missing"
                    >{{
                      t("infra.curated.streamsMissing", {
                        count: absentStreams(hidden).length,
                        list: raw(
                          absentStreams(hidden)
                            .map((s) => s.name)
                            .join(", "),
                        ),
                      })
                    }}</OText
                  >
                  <OText
                    v-if="staleStreams(hidden).length"
                    variant="meta"
                    data-test="curated-strip-streams-stale"
                    >{{
                      t("infra.curated.streamsStale", {
                        list: raw(
                          staleStreams(hidden)
                            .map((s) => s.name)
                            .join(", "),
                        ),
                        date: formatUs(staleStreams(hidden)[0].lastSeenUs),
                      })
                    }}</OText
                  >
                  <OText
                    v-for="concept in hidden.unresolvedConcepts ?? []"
                    :key="concept.groupId"
                    variant="meta"
                    >{{
                      t("infra.curated.fieldUnresolved", {
                        display: raw(concept.display),
                        stream: raw(hidden.group.anchorStream ?? ""),
                      })
                    }}</OText
                  >
                  <OText v-if="hidden.missingFields?.length" variant="meta">{{
                    t("infra.curated.probeFieldsMissing", {
                      stream: raw(hidden.probeStream ?? ""),
                      list: raw(hidden.missingFields.join(", ")),
                    })
                  }}</OText>
                  <OText variant="meta">{{
                    t(
                      "infra.curated.hiddenPanelCount",
                      { count: hidden.panelCount },
                      hidden.panelCount,
                    )
                  }}</OText>
                  <DataSourceSetupCard
                    v-if="
                      hidden.group.setup.kind === 'card' &&
                      expandedSetupSlug === hidden.group.setup.slug
                    "
                    :slug="hidden.group.setup.slug"
                    @detected="runRefresh(true)"
                  />
                </div>

                <div
                  v-for="partial in partialGroups"
                  :key="`partial-${partial.group.id}`"
                  class="flex flex-col gap-1"
                >
                  <OText variant="meta">{{
                    t("infra.curated.streamsMissing", {
                      count: partial.missingStreams.length,
                      list: raw(partial.missingStreams.map((s) => s.name).join(", ")),
                    })
                  }}</OText>
                </div>

                <div
                  v-for="stale in staleGroups"
                  :key="`stale-${stale.group.id}`"
                  class="flex flex-col gap-1"
                >
                  <OText variant="meta" data-test="curated-strip-hint">{{
                    t(stale.group.setupHintKey)
                  }}</OText>
                </div>

                <OText
                  variant="meta"
                  data-test="curated-strip-hedge"
                  data-copy-key="infra.curated.hiddenFootnote"
                  >{{ t("infra.curated.hiddenFootnote") }}</OText
                >
              </div>
            </OCollapsible>

            <!-- Last, so the note sits directly above the grid it qualifies. -->
            <OText v-if="sectionNoteKey" variant="meta" data-test="curated-section-note">{{
              t(sectionNoteKey)
            }}</OText>
          </div>
        </template>
      </RenderDashboardCharts>
    </div>
  </OPageLayout>
</template>
