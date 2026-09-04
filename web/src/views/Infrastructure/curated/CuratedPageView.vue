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
import type { I18nKey } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import DateTime from "@/components/DateTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import type { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { getConsumableRelativeTime } from "@/utils/date";
import type { WorkloadId } from "@/composables/useWorkloadDetection";
import { curatedPacks } from "./packs";
import { useCuratedPage } from "./useCuratedPage";
import type { HiddenGroupInfo, StaleGroupInfo } from "./resolve";

const props = defineProps<{ workload: WorkloadId }>();

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

// No fallback: an AWS route rendering the Kubernetes manifest is a lie, not a degradation.
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
  lastDataUs,
  stripAutoExpand,
  presentGroupIds,
  refresh,
} = page;

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const timezone = computed(() => store.state.timezone ?? "UTC");

const DEFAULT_WINDOW_US = 3 * 60 * 60 * 1_000_000;

/** The SELECTION, not its bounds: a relative window means "as of now", so it is materialized per refresh. */
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

// MICROSECOND epoch, undivided: usePanelDataLoader reads these back with
// `new Date(start_time.toISOString()).getTime()` and hands the result to
// executePromQL as µs, so a ms-epoch Date lands the x-axis in 1970.
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
  if (props.workload === "aws") return "infra.curated.partialTelemetryAws" as const;
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
watch(
  visibleTabs,
  (tabs) => {
    if (tabs.length === 0) {
      selectedTabId.value = null;
      return;
    }
    if (!tabs.some((tab) => tab.tabId === selectedTabId.value)) {
      selectedTabId.value = tabs[0].tabId;
    }
  },
  { immediate: true },
);

// ── Explainer strip ─────────────────────────────────────────────────────────

const stripExpanded = ref(false);
// SEEDS the expansion once (design pass-4 finding 8b: "first presentation only").
// Re-syncing on every change discarded a collapse the user had just performed.
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

const collapsedCapabilities = computed(() => {
  const sentences = hiddenGroups.value.map((hidden) => t(hidden.group.capabilityKey));
  if (sentences.length === 0) return "";
  if (sentences.length <= 2) return sentences.join(" ");
  return t("infra.curated.hiddenSummaryMore", {
    first: sentences[0],
    count: sentences.length - 1,
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
  staleGroups.value.map((stale) => ({
    id: stale.group.id,
    capability: t(stale.group.capabilityKey),
    duration: humanDuration(stale.lastSeenUs),
    date: formatUs(stale.lastSeenUs),
  })),
);

const lastDataDuration = computed(() =>
  lastDataUs.value == null ? "" : humanDuration(lastDataUs.value),
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

/**
 * Panels query COMMITTED variable state (RenderDashboardCharts
 * getCommittedVariablesForPanel), and a selection only reaches it through
 * commitAll — which every other embedder triggers from its own Refresh
 * (ViewDashboard :1254, AppPerformance :326, TracesAnalysisDashboard :782).
 * A curated page has no such button for pickers: PanelContainer's per-panel
 * "refresh to apply variables" control is `v-if="!viewOnly"` (:204) and this
 * page is viewOnly, so an uncommitted selection would be unappliable. Commit
 * on the selection itself instead — the picker IS the apply gesture here.
 */
type VariablesManager = ReturnType<typeof useVariablesManager>;
const variablesManager = ref<VariablesManager | null>(null);
let stopCommitWatch: (() => void) | undefined;

const onVariablesManagerReady = (manager: VariablesManager) => {
  variablesManager.value = manager;
  stopCommitWatch?.();
  // Values ONLY: options and loading flags churn on every fetch, and committing
  // on those would re-run panels for a picker the user never touched.
  stopCommitWatch = watch(
    () => manager.variablesData.global.map((variable) => variable.value),
    () => manager.commitAll(),
    { deep: true },
  );
};

onBeforeUnmount(() => stopCommitWatch?.());

/** A single-cluster org loses its picker, so the name renders as static text. */
const singleClusterName = computed(() => {
  const cluster = variableList.value.find((variable) => variable.name === "cluster");
  if (!cluster?.omitWhenValuesEmpty) return null;
  const values = cluster.options as { value: string }[] | undefined;
  if (!Array.isArray(values) || values.length !== 1) return null;
  return values[0]?.value ?? null;
});

// The "no data" state and the phase-tile subtitle both render ON the tile (§6.3), so PanelContainer owns them.

// ── Footer ──────────────────────────────────────────────────────────────────

const checkedAtLabel = computed(() =>
  checkedAtUs.value == null ? "" : formatUs(checkedAtUs.value),
);

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
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          data-test="curated-refresh"
          @click="runRefresh(true)"
        >
          {{ t("infra.curated.refresh") }}
        </OButton>
      </div>
    </template>

    <div
      v-if="!hasPack"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="curated-pack-unavailable"
    >
      <OText tag="h2" class="text-base font-semibold">{{
        t("infra.curated.packUnavailable")
      }}</OText>
      <OText variant="meta">{{ t("infra.curated.packUnavailableHint") }}</OText>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="curated-pack-unavailable-build"
        @click="openDashboardsList"
      >
        {{ t("infra.curated.buildOwnDashboard") }}
      </OButton>
    </div>

    <!-- `unknown` + loadError is the lists-failed state, never an endless spinner. -->
    <div
      v-else-if="face === 'unknown' && loadError"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="curated-error"
    >
      <OText variant="meta">{{ t("infra.curated.pageError") }}</OText>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="curated-retry"
        @click="runRefresh(true)"
      >
        {{ t("infra.curated.retry") }}
      </OButton>
    </div>

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

    <div
      v-else-if="face === 'undetected'"
      class="mx-auto flex max-w-3xl flex-col gap-3 py-6"
      data-test="curated-setup-state"
    >
      <OText tag="h2" class="text-xl font-semibold">{{ t("infra.workload.setupHeadline") }}</OText>
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

    <!-- The streams exist and merely stopped reporting. Rendering the SETUP face
         here would tell an org to install a collector it already has, so this
         face names the outage instead and offers no setup CTA. -->
    <div
      v-else-if="face === 'dormant'"
      class="mx-auto flex max-w-3xl flex-col gap-3 py-6"
      data-test="curated-dormant-state"
    >
      <OText tag="h2" class="text-xl font-semibold">{{
        t("infra.curated.dormantHeadline", { workload: t(manifest.titleKey) })
      }}</OText>
      <OText variant="meta">{{ t("infra.curated.dormantBody") }}</OText>
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
                t('infra.curated.staleBanner', {
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

            <OText
              v-if="staleDurations.length === 0 && lastDataUs != null"
              variant="meta"
              data-test="curated-last-data"
              >{{ t("infra.curated.lastData", { duration: lastDataDuration }) }}</OText
            >

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
                    <!-- A group that is PRESENT (its siblings render) has its
                         collector installed already; only the field is missing,
                         so "Set up" would send the user to re-install what works. -->
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

            <!-- Last in the region, so it sits directly above the grid it
                 qualifies rather than being pushed off by banners. -->
            <OText v-if="sectionNoteKey" variant="meta" data-test="curated-section-note">{{
              t(sectionNoteKey)
            }}</OText>
          </div>
        </template>
      </RenderDashboardCharts>

      <div class="flex items-center justify-between gap-2 pt-2" data-test="curated-footer">
        <div class="flex items-center gap-2">
          <OText variant="meta">{{
            t("infra.curated.footer", { time: raw(checkedAtLabel) })
          }}</OText>
          <OTooltip
            :content="t('infra.curated.footerVersionTooltip', { version: manifest.contentVersion })"
          >
            <OIcon
              name="info"
              size="sm"
              data-test="curated-footer-version"
              :aria-label="
                t('infra.curated.footerVersionTooltip', { version: manifest.contentVersion })
              "
            />
          </OTooltip>
        </div>
        <OButton
          variant="ghost"
          size="sm-action"
          data-test="curated-build-own"
          @click="openDashboardsList"
        >
          {{ t("infra.curated.buildOwnDashboard") }}
        </OButton>
      </div>
    </div>
  </OPageLayout>
</template>
