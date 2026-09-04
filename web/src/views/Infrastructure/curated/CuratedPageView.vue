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

<!--
  CuratedPageView — one renderer for every curated workload page (design §6).
  Three faces (checking / setup / charts), a capability-led explainer strip, the
  stale banner and badges, and scope pickers that dim where they do not apply.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import DateTime from "@/components/DateTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";
import type { WorkloadId } from "@/composables/useWorkloadDetection";
import { curatedPacks } from "./packs";
import { useCuratedPage } from "./useCuratedPage";
import type { HiddenGroupInfo, StaleGroupInfo } from "./resolve";

const props = defineProps<{ workload: WorkloadId }>();

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const manifest = computed(() => curatedPacks[props.workload] ?? curatedPacks.kubernetes!);

const page = useCuratedPage(manifest.value);
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
  refresh,
} = page;

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");
const timezone = computed(() => store.state.timezone ?? "UTC");

const DEFAULT_WINDOW_US = 3 * 60 * 60 * 1_000_000;
const range = ref({ from: Date.now() * 1000 - DEFAULT_WINDOW_US, to: Date.now() * 1000 });
const checkedAtUs = ref<number | null>(null);

const currentTimeObj = computed(() => ({
  __global: {
    start_time: new Date(range.value.from / 1000),
    end_time: new Date(range.value.to / 1000),
  },
}));

const runRefresh = async (force = false) => {
  await refresh({ orgId: orgId.value, start: range.value.from, end: range.value.to, force });
  checkedAtUs.value = Date.now() * 1000;
};

// ── Faces ───────────────────────────────────────────────────────────────────

/** The manifest's FIRST group's setup door drives the undetected face (§6.1). */
const setupDoor = computed(() => (page as any).setupDoor?.value ?? manifest.value.groups[0]?.setup);
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

const sectionTitleKey = (tabId: string) =>
  manifest.value.sections.find((section) => section.id === tabId)?.titleKey ??
  manifest.value.titleKey;

// ── Explainer strip ─────────────────────────────────────────────────────────

const stripExpanded = ref(false);
watch(stripAutoExpand, (expand) => (stripExpanded.value = expand), { immediate: true });

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

const expandedSetupSlug = ref<string | null>(null);
const onStripSetup = (group: HiddenGroupInfo["group"] | StaleGroupInfo["group"]) => {
  if (group.setup.kind === "route") {
    router.push({ name: group.setup.routeName });
    return;
  }
  expandedSetupSlug.value = expandedSetupSlug.value === group.setup.slug ? null : group.setup.slug;
};

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
  // Measured against whichever is later — the page's window end or the wall
  // clock — so a range that trails the data never reports a negative age.
  const reference = Math.max(range.value.to, Date.now() * 1000);
  const minutes = Math.max(1, Math.floor((reference - sinceUs) / 60_000_000));
  if (minutes < 60) return t("infra.curated.durationMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("infra.curated.durationHours", { count: hours });
  return t("infra.curated.durationDays", { count: Math.floor(hours / 24) });
}

// ── Warnings ────────────────────────────────────────────────────────────────

const probeWarnings = computed(() => warnings.value.filter((entry) => entry.kind === "probe"));
const statsWarning = computed(() => warnings.value.some((entry) => entry.kind === "stats"));
/** schema, semantic-groups and groups-missing are one event to a user (§8.4). */
const defaultFieldNamesWarning = computed(() =>
  warnings.value.some((entry) =>
    ["schema", "semantic-groups", "groups-missing"].includes(entry.kind),
  ),
);

// ── Scope pickers ───────────────────────────────────────────────────────────

interface PickerRuntime {
  values: string[] | null;
  omitted: boolean;
  selection: string;
}

const pickerRuntime = ref<Record<string, PickerRuntime>>({});

const variableList = computed(() => ((dashboard.value as any)?.variables?.list ?? []) as any[]);

const activeScopedBy = computed(
  () =>
    manifest.value.sections.find((section) => section.id === selectedTabId.value)?.scopedBy ?? [],
);

const visiblePickers = computed(() =>
  variableList.value.filter((variable) => {
    const runtime = pickerRuntime.value[variable.name];
    if (!runtime) return true;
    // Schema presence is not resolvability: an enabled empty dropdown reads as
    // a broken page, so a zero-values picker is removed rather than disabled.
    if (variable.omitWhenValuesEmpty && runtime.values?.length === 0) return false;
    return !runtime.omitted;
  }),
);

const isPickerApplicable = (name: string) => activeScopedBy.value.includes(name);

const cappedPickers = computed(() =>
  Object.fromEntries(
    variableList.value.map((variable) => {
      const runtime = pickerRuntime.value[variable.name];
      const cap = variable.query_data?.max_record_size ?? 0;
      return [variable.name, Boolean(runtime?.values && cap && runtime.values.length === cap)];
    }),
  ),
);

const parentOf = (name: string) =>
  manifest.value.scopePickers.find((picker) => picker.name === name)?.chainedOn?.[0]?.picker ?? "";

/** A single-cluster org loses its picker, so the name renders as static text. */
const singleClusterName = computed(() => {
  const runtime = pickerRuntime.value.cluster;
  if (!runtime?.omitted || runtime.values?.length !== 1) return null;
  return runtime.values[0];
});

const onValuesLoaded = (payload: { name: string; values: string[] }) => {
  const current = pickerRuntime.value[payload.name];
  pickerRuntime.value = {
    ...pickerRuntime.value,
    [payload.name]: {
      values: payload.values,
      omitted: current?.omitted ?? false,
      selection: current?.selection ?? "",
    },
  };
};

const onVariableOmitted = (payload: { name: string }) => {
  const current = pickerRuntime.value[payload.name];
  pickerRuntime.value = {
    ...pickerRuntime.value,
    [payload.name]: {
      values: current?.values ?? null,
      omitted: true,
      selection: current?.selection ?? "",
    },
  };
};

const onPickerChange = (name: string) => {
  const current = pickerRuntime.value[name];
  pickerRuntime.value = {
    ...pickerRuntime.value,
    [name]: {
      values: current?.values ?? null,
      omitted: current?.omitted ?? false,
      selection: current?.selection || raw("selected"),
    },
  };
};

// ── Tile no-data (§6.3 finding 2a) ──────────────────────────────────────────

const emptyTiles = ref<Record<string, boolean>>({});
const emptyTilePanelIds = computed(() =>
  Object.entries(emptyTiles.value)
    .filter(([, isEmpty]) => isEmpty)
    .map(([panelId]) => panelId),
);
const onPanelSeriesLoaded = (payload: { panelId: string; seriesCount: number }) => {
  const panel = visibleTabs.value
    .flatMap((tab) => tab.panels ?? [])
    .find((entry: any) => entry.id === payload.panelId);
  if (!panel?.config?.curated_no_data_eligible) return;
  emptyTiles.value = { ...emptyTiles.value, [payload.panelId]: payload.seriesCount === 0 };
};

// ── Footer ──────────────────────────────────────────────────────────────────

const checkedAtLabel = computed(() =>
  checkedAtUs.value == null ? "" : formatUs(checkedAtUs.value),
);

/** Navigation only — it creates, copies, imports and forks nothing (§6.5). */
const openDashboardsList = () => {
  router.push({
    name: "dashboards",
    query: {
      org_identifier: orgId.value,
      from: String(range.value.from),
      to: String(range.value.to),
    },
  });
};

// ── Range, focus and org-switch triggers ────────────────────────────────────

let rangeTimer: ReturnType<typeof setTimeout> | undefined;

const onDateChange = (date: { startTime: number; endTime: number; userChangedValue?: boolean }) => {
  // DateTime replays on mount with userChangedValue:false — "do not fetch".
  if (date.userChangedValue === false) return;
  range.value = { from: date.startTime, to: date.endTime };
  // The ONE debounce seam: refresh() itself is never delayed, so org switches,
  // @detected and Retry stay immediate while scrubbing cannot stack bursts.
  if (rangeTimer) clearTimeout(rangeTimer);
  rangeTimer = setTimeout(() => void runRefresh(false), 300);
};

const onWindowFocus = () => {
  // Returning from a provider console must re-check without a reload — but only
  // while the setup face shows, so a healthy page never storms on focus.
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
    pickerRuntime.value = {};
    emptyTiles.value = {};
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

    <!-- `unknown` + loadError is the lists-failed state, never an endless spinner. -->
    <div
      v-if="face === 'unknown' && loadError"
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

    <div v-else-if="dashboard" class="flex min-h-0 flex-1 flex-col">
      <div
        v-if="visiblePickers.length || singleClusterName"
        class="flex flex-wrap items-end gap-3 pb-2"
      >
        <div
          v-for="variable in visiblePickers"
          :key="variable.name"
          class="flex flex-col gap-1"
          :data-test="`curated-picker-${variable.name}`"
          :data-disabled="String(!isPickerApplicable(variable.name))"
          :data-value="pickerRuntime[variable.name]?.selection ?? ''"
          :data-tooltip-key="
            isPickerApplicable(variable.name) ? undefined : 'infra.curated.pickerNotApplicable'
          "
          :title="
            isPickerApplicable(variable.name)
              ? undefined
              : t('infra.curated.pickerNotApplicable', {
                  picker: variable.label,
                  section: t(sectionTitleKey(selectedTabId ?? '')),
                })
          "
          @change="onPickerChange(variable.name)"
        >
          <OText variant="meta">{{ raw(variable.label) }}</OText>
          <OText
            v-if="cappedPickers[variable.name]"
            variant="meta"
            :data-test="`curated-values-capped-${variable.name}`"
            >{{
              t("infra.curated.valuesCapped", {
                count: variable.query_data?.max_record_size ?? 0,
                parent: parentOf(variable.name) || variable.label,
              })
            }}</OText
          >
        </div>
        <OText v-if="singleClusterName" variant="meta" data-test="curated-single-cluster">{{
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
        @variable-values-loaded="onValuesLoaded"
        @variable-omitted="onVariableOmitted"
        @panel-series-loaded="onPanelSeriesLoaded"
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
              :key="warning.message"
              variant="info"
              dense
              data-test="curated-warning-probe"
              :content="t('infra.curated.warnBanner.probe', { label: raw(warning.message) })"
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

            <div
              v-if="hasStrip"
              class="border-border-default rounded-surface border p-3"
              data-test="curated-strip"
            >
              <button
                type="button"
                class="text-text-body flex w-full items-center justify-between gap-2 text-start text-sm"
                data-test="curated-strip-summary"
                @click="stripExpanded = !stripExpanded"
              >
                <span>{{ raw(collapsedCapabilities) }}</span>
              </button>

              <div
                v-if="stripExpanded"
                class="flex flex-col gap-3 pt-3"
                data-test="curated-strip-expanded"
              >
                <div
                  v-for="hidden in hiddenGroups"
                  :key="hidden.group.id"
                  class="flex flex-col gap-1"
                  :data-test="`curated-strip-group-${hidden.group.id}`"
                >
                  <div class="flex items-center justify-between gap-2">
                    <OText>{{ t(hidden.group.capabilityKey) }}</OText>
                    <OButton
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
            </div>

            <OText
              v-for="panelId in emptyTilePanelIds"
              :key="panelId"
              variant="meta"
              :data-test="`curated-tile-no-data-${panelId}`"
              >{{ t("infra.curated.tileNoData") }}</OText
            >
          </div>
        </template>
      </RenderDashboardCharts>

      <div class="flex items-center justify-between gap-2 pt-2" data-test="curated-footer">
        <div class="flex items-center gap-2">
          <OText variant="meta">{{
            t("infra.curated.footer", { time: raw(checkedAtLabel) })
          }}</OText>
          <OText
            variant="meta"
            data-test="curated-footer-version"
            :title="t('infra.curated.footerVersionTooltip', { version: manifest.contentVersion })"
            >{{ raw("i") }}</OText
          >
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
