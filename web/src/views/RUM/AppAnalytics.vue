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
  <OPageLayout
    :key="org"
    data-test="rum-analytics-page"
    :subtitle="t('rum.analytics.subtitle')"
    title-data-test="rum-analytics-title"
    icon="insights"
    bleed
  >
    <!-- Beta tag rides inside the title line, like Workflows (see BetaBadge.vue). -->
    <template #title>
      <span class="inline-flex items-center gap-2">
        {{ t("rum.analytics.title") }}
        <BetaBadge />
      </span>
    </template>
    <template #actions>
      <OSelect
        v-if="appOptions.length > 1"
        :model-value="state.app"
        :options="appOptions"
        size="sm"
        searchable
        class="w-48 max-md:w-36"
        data-test="rum-analytics-app-select"
        @update:model-value="onAppChange"
      />
      <OTag
        v-else-if="state.app"
        :label="raw(state.app)"
        variant="default-outline"
        size="md"
        data-test="rum-analytics-app-label"
      />
      <OSelect
        v-if="envOptions.length"
        :model-value="state.env"
        :options="envSelectOptions"
        :placeholder="t('rum.analytics.allEnvs')"
        multiple
        size="sm"
        class="w-36 max-md:hidden"
        data-test="rum-analytics-env-select"
        @update:model-value="onEnvChange"
      />
      <OSelect
        v-if="versionOptions.length"
        :model-value="state.version"
        :options="versionSelectOptions"
        :placeholder="t('rum.analytics.allVersions')"
        multiple
        size="sm"
        class="w-36 max-md:hidden"
        data-test="rum-analytics-version-select"
        @update:model-value="onVersionChange"
      />
      <DateTimePickerDashboard
        ref="dateTimePickerRef"
        :model-value="state.datetime"
        menu-align="end"
        data-test="rum-analytics-date-picker"
        @update:model-value="onDateChange"
      />
      <OButton
        icon-left="refresh"
        variant="outline"
        size="icon-toolbar"
        :aria-label="t('rum.analytics.refresh')"
        data-test="rum-analytics-refresh-btn"
        @click="refresh"
      >
        <OTooltip :content="t('rum.analytics.refresh')" />
      </OButton>
      <ShareButton
        data-test="rum-analytics-share-btn"
        :url="shareUrl"
        variant="outline"
        size="icon-toolbar"
      />
      <OButton
        v-if="showNewEvent"
        variant="primary"
        size="sm"
        :disabled="eventsFull"
        data-test="rum-analytics-named-events-new-btn"
        @click="openNewEvent"
        >{{ t("rum.analytics.events.newEvent")
        }}<OTooltip
          v-if="eventsFull"
          :content="t('rum.analytics.events.capReached', { max: MAX_EVENTS_PER_APP })"
      /></OButton>
      <OButton
        v-if="showNewFunnel"
        variant="primary"
        size="sm"
        data-test="rum-analytics-saved-funnels-new-btn"
        @click="funnelDraft.startNew()"
        >{{ t("rum.analytics.saved.newFunnel") }}</OButton
      >
    </template>

    <div v-if="noRumData" class="flex h-full min-h-0 flex-col" data-test="rum-analytics-no-data">
      <RumNoDataState />
    </div>
    <div v-else class="flex h-full min-h-0 flex-col">
      <div
        class="px-page-edge text-text-secondary border-border-default flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b py-1 text-xs"
        data-test="rum-analytics-trust-caption"
      >
        <span v-if="dataThrough" data-test="rum-analytics-data-through">{{
          t("rum.analytics.dataThrough", { time: dataThrough })
        }}</span>
        <span v-if="dataThrough" aria-hidden="true">{{ separator }}</span>
        <OTooltip :content="t('rum.analytics.sdkSampledTip', { field: raw('sessionSampleRate') })">
          <span
            tabindex="0"
            class="underline decoration-dotted underline-offset-2"
            data-test="rum-analytics-sdk-sampling"
            >{{ t("rum.analytics.sdkSampled") }}</span
          >
        </OTooltip>
        <template v-if="syntheticCount > 0">
          <span aria-hidden="true">{{ separator }}</span>
          <span data-test="rum-analytics-synthetic-excluded">{{
            t(
              "rum.analytics.syntheticExcluded",
              { count: addCommasToNumber(syntheticCount) },
              syntheticCount,
            )
          }}</span>
        </template>
        <OPopover
          v-if="identityNote"
          v-model:open="identityOpen"
          side="bottom"
          align="start"
          content-class="p-3 w-80"
        >
          <template #trigger>
            <OTag
              :label="
                state.includeAllIdentities
                  ? t('rum.analytics.identityIncluded')
                  : t(
                      'rum.analytics.identityExcluded',
                      { count: identityNote.count, pct: sharePct },
                      identityNote.count,
                    )
              "
              variant="warning-soft"
              size="sm"
              clickable
              data-test="rum-analytics-identity-note"
            />
          </template>
          <div class="flex flex-col gap-2 text-sm">
            <p class="text-text-body" data-test="rum-analytics-identity-help">
              {{ identityHelp }}
            </p>
            <OButton
              variant="outline"
              size="sm"
              data-test="rum-analytics-identity-include-btn"
              @click="toggleIncludeAll"
              >{{
                state.includeAllIdentities
                  ? t("rum.analytics.excludeAgain")
                  : t("rum.analytics.includeIt")
              }}</OButton
            >
          </div>
        </OPopover>
      </div>

      <OBanner
        v-if="invalidParams.length && !invalidDismissed"
        variant="warning"
        dense
        class="mx-page-edge mt-2"
        :content="t('rum.analytics.invalidLink')"
        data-test="rum-analytics-invalid-link"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="sm"
            data-test="rum-analytics-invalid-link-dismiss"
            @click="invalidDismissed = true"
            >{{ t("rum.analytics.dismiss") }}</OButton
          >
        </template>
      </OBanner>

      <OBanner
        v-if="deletedEventLink"
        variant="info"
        dense
        class="mx-page-edge mt-2"
        :content="t('rum.analytics.events.deletedNotice')"
        data-test="rum-analytics-deleted-event-link"
      />

      <div class="border-border-default pe-page-edge flex shrink-0 items-center gap-2 border-b">
        <OTabs
          :model-value="activeSubTab"
          align="left"
          dense
          class="min-w-0 flex-1"
          @update:model-value="onSubTabChange"
        >
          <OTab
            v-for="tab in subTabs"
            :key="tab.value"
            :name="tab.value"
            :label="tab.label"
            :data-test="`rum-analytics-subtab-${tab.value}`"
          />
        </OTabs>
        <SampledTag
          v-if="showSampledTag"
          :ratio="sampleRatio"
          :va-rows="summary?.vaRows ?? 0"
          :exact="state.exact"
          @update:exact="onExactChange"
        />
      </div>

      <OEmptyState
        v-if="scopeStatus === 'forbidden'"
        preset="no-access"
        data-test="rum-analytics-no-access"
      />
      <AnalyticsPanelState
        v-else-if="scopeStatus === 'error'"
        :state="scopePanel"
        data-test="rum-analytics-scope"
        class="px-page-edge py-4"
        @retry="refresh"
      />
      <div v-else class="min-h-0 flex-1 overflow-auto">
        <router-view v-slot="{ Component }">
          <keep-alive :include="SUBTAB_VIEWS">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </div>
    </div>
  </OPageLayout>
</template>

<script lang="ts">
// Module scope outlives the shell, so a reopened page knows whose scope the composable still holds.
let enteredOrg = "";
</script>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import SampledTag from "@/components/rum/productAnalytics/SampledTag.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import RumNoDataState from "@/components/rum/RumNoDataState.vue";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import useFunnelDraft from "@/composables/rum/useFunnelDraft";
import useRum from "@/composables/rum/useRum";
import useProductAnalytics, { querySignature } from "@/composables/rum/useProductAnalytics";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import { raw, useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  EXACT_ROW_LIMIT,
  MAX_EVENTS_PER_APP,
  type AnalyticsDateTime,
} from "@/utils/rum/productAnalyticsModel";
import {
  PA_ROUTES,
  SUBTAB_ROUTES,
  subTabOfRoute,
  type AnalyticsSubTab,
} from "@/utils/rum/productAnalyticsRoutes";

defineOptions({ name: "AppAnalytics" });

const SUBTAB_VIEWS = [
  "AnalyticsOverview",
  "AnalyticsFunnels",
  "AnalyticsPaths",
  "AnalyticsRetention",
  "NamedEventsListPage",
  "SavedFunnelsPage",
];
const SAMPLED_SUBTABS: AnalyticsSubTab[] = ["funnels", "paths", "retention"];

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();
const { shareUrl } = useRum();
const pa = useProductAnalytics();
const namedEvents = useNamedEvents();
const savedFunnels = useSavedFunnels();
const funnelDraft = useFunnelDraft();
const {
  state,
  apps,
  envOptions,
  versionOptions,
  summary,
  sampleRatio,
  identityNote,
  invalidParams,
  scopeStatus,
  scopeError,
  lastSubTab,
  deletedEventLink,
} = pa;

const separator = raw("·");
let active = false;
let activatedOnce = false;
const invalidDismissed = ref(false);
const identityOpen = ref(false);
const dateTimePickerRef = ref<any>(null);

const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

const subTabs = computed(() => [
  { value: "overview", label: t("rum.analytics.subtabs.overview") },
  { value: "funnels", label: t("rum.analytics.subtabs.funnels") },
  { value: "paths", label: t("rum.analytics.subtabs.paths") },
  { value: "retention", label: t("rum.analytics.subtabs.retention") },
  { value: "events", label: t("rum.analytics.subtabs.events") },
]);

const routeSubTab = (): AnalyticsSubTab | null => subTabOfRoute(route.name);

const activeSubTab = computed<AnalyticsSubTab>(() => routeSubTab() ?? lastSubTab.value);

const appOptions = computed(() => {
  const listed = apps.value.map((a) => a.app);
  if (state.app && !listed.includes(state.app)) listed.unshift(state.app);
  return listed.map((a) => ({ label: raw(a), value: a }));
});
const envSelectOptions = computed(() =>
  envOptions.value.map((o) => ({ label: raw(o.value), value: o.value })),
);
const versionSelectOptions = computed(() =>
  versionOptions.value.map((o) => ({ label: raw(o.value), value: o.value })),
);

const dataThrough = computed(() => {
  const us = summary.value?.dataThroughUs;
  if (!us) return "";
  return formatInTimeZone(new Date(us / 1000), store.state.timezone || "UTC", "yyyy-MM-dd HH:mm");
});

const syntheticCount = computed(() =>
  pa.schema.value.session_type ? (summary.value?.syntheticSessions ?? 0) : 0,
);

const sharePct = computed(() => Math.round((identityNote.value?.share ?? 0) * 100));
const identityHelp = computed(() => {
  const note = identityNote.value;
  if (!note) return "";
  if (state.includeAllIdentities) {
    return t("rum.analytics.identityIncludedHelp", { field: raw(note.field), pct: sharePct.value });
  }
  return note.fallback
    ? t("rum.analytics.identityExcludedFallbackHelp", {
        field: raw(note.field),
        fallback: raw(note.fallback),
        pct: sharePct.value,
      })
    : t("rum.analytics.identityExcludedHelp", { pct: sharePct.value });
});

// A read-only or forbidden list cannot create, so its CTA is hidden rather than disabled.
const showNewEvent = computed(
  () =>
    activeSubTab.value === "events" &&
    !!state.app &&
    namedEvents.status(org.value, state.app) === "ready" &&
    namedEvents.permission.value === "write",
);
const eventsFull = computed(() => namedEvents.events.value.length >= MAX_EVENTS_PER_APP);

// New funnel only starts an unsaved draft, so read-only roles keep it; the builder has its own Save.
const showNewFunnel = computed(
  () =>
    route.name === PA_ROUTES.funnels &&
    !!state.app &&
    savedFunnels.status(org.value, state.app) !== "forbidden",
);

const showSampledTag = computed(() => {
  if (!SAMPLED_SUBTABS.includes(activeSubTab.value)) return false;
  return sampleRatio.value > 1 || (state.exact && (summary.value?.vaRows ?? 0) > EXACT_ROW_LIMIT);
});

// Only a probe that answered can say nothing was ever ingested; a failed one keeps its Retry.
const noRumData = computed(
  () => scopeStatus.value === "ok" && !state.app && Object.keys(pa.schema.value).length === 0,
);

const scopePanel = computed<PanelState<unknown>>(() => ({
  status: scopeStatus.value,
  rows: [],
  error: { message: scopeError.value ?? "" },
  partial: null,
  key: null,
  sampled: 1,
}));

const syncUrl = (name?: string) => pa.syncUrl(router, name);

const reload = async (force = false) => {
  await pa.loadScope(force);
  await syncUrl();
};

const onAppChange = (value: unknown) => {
  if (typeof value !== "string" || value === state.app) return;
  pa.setScope({ app: value, env: [], version: [] }, true);
  void reload();
};

const onEnvChange = (value: unknown) => {
  pa.setScope({ env: Array.isArray(value) ? value.map(String) : [] });
  void reload();
};

const onVersionChange = (value: unknown) => {
  pa.setScope({ version: Array.isArray(value) ? value.map(String) : [] });
  void reload();
};

// The picker re-emits the range it was given when it mounts, which must not re-resolve a relative range.
const sameRange = (a: AnalyticsDateTime, b: AnalyticsDateTime) =>
  a.valueType === b.valueType &&
  (a.valueType === "relative"
    ? a.relativeTimePeriod === b.relativeTimePeriod
    : a.startTime === b.startTime && a.endTime === b.endTime);

// The picker reads this shape into an already-mounted DateTime (see DateTimePickerDashboard.setSavedDate).
const toPickerSavedDate = (dt: AnalyticsDateTime) =>
  dt.valueType === "absolute"
    ? { type: "absolute", startTime: dt.startTime, endTime: dt.endTime }
    : { type: "relative", relativeTimePeriod: dt.relativeTimePeriod };

const onDateChange = (value: AnalyticsDateTime) => {
  if (sameRange(value, state.datetime)) return;
  pa.setScope({ datetime: { ...value } });
  void reload();
};

const toggleIncludeAll = () => {
  identityOpen.value = false;
  pa.setScope({ includeAllIdentities: !state.includeAllIdentities });
  void reload();
};

const onExactChange = (value: boolean) => {
  pa.setScope({ exact: value });
  void reload();
};

const refresh = () => {
  void pa.refresh().then(() => syncUrl());
};

const openNewEvent = () => {
  void router.push({ name: PA_ROUTES.eventNew, query: pa.toQuery() });
};

const onSubTabChange = (tab: string | number) => {
  const next = tab as AnalyticsSubTab;
  if (!SUBTAB_ROUTES[next]) return;
  lastSubTab.value = next;
  void pa.pushSubTab(router, SUBTAB_ROUTES[next]);
};

// Rail links carry only org_identifier and Back remounts on the URL last written; both resume this org's scope.
const resumesScope = () =>
  enteredOrg === org.value &&
  !!state.app &&
  (Object.keys(route.query).every((k) => k === "org_identifier") ||
    querySignature(route.query) === pa.syncedSignature.value);

const enter = async () => {
  if (!resumesScope()) {
    pa.initFromRoute(route.query, { keepFunnel: route.name === PA_ROUTES.funnels });
    // The picker reads its range only on mount, so a reload or a shared link (both land here
    // after it has already mounted with the default range) must move the mounted picker too.
    dateTimePickerRef.value?.setSavedDate?.(toPickerSavedDate(state.datetime));
  }
  enteredOrg = org.value;
  invalidDismissed.value = false;
  const tab = routeSubTab();
  if (tab) lastSubTab.value = tab;
  // The bare shell has no body, so it lands on the sub-tab first and that tab shows the wait.
  if (!tab) await syncUrl(SUBTAB_ROUTES[lastSubTab.value]);
  await pa.loadScope();
  if (state.app) await pa.eventsGate(() => true);
  if (tab || pa.syncedSignature.value !== querySignature(pa.toQuery(String(route.name)))) {
    await syncUrl();
  }
};

watch(
  () => route.name,
  () => {
    const tab = routeSubTab();
    if (tab) lastSubTab.value = tab;
  },
);

// The bare shell route has no child view, so it always resumes into a sub-tab; own replaces are skipped.
const needsEnter = () =>
  route.name === PA_ROUTES.shell ||
  (!!routeSubTab() && querySignature(route.query) !== pa.syncedSignature.value);

// A deactivated shell still watches the route, and its reactivation hook already enters once.
watch([() => route.name, () => route.query], () => {
  if (active && needsEnter()) void enter();
});

onMounted(() => {
  active = true;
  void enter();
});

onActivated(() => {
  active = true;
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  if (needsEnter()) void enter();
});

onDeactivated(() => {
  active = false;
});

defineExpose({ onAppChange, onEnvChange, onVersionChange, onDateChange });
</script>
