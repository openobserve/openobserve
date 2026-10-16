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
  <div class="flex h-full min-h-0 flex-col" data-test="rum-analytics-funnels">
    <SavedFunnelBar
      :events="events"
      :events-ready="pa.eventsStatus.value === 'ready'"
      :compile-sql="savedSql"
    >
      <template v-if="def.steps.length" #actions>
        <ODropdown v-if="recent.length" side="bottom" align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="sm"
              icon-left="history"
              icon-right="arrow-drop-down"
              data-test="rum-analytics-funnel-recent-btn"
              >{{ t("rum.analytics.funnel.recent") }}</OButton
            >
          </template>
          <ODropdownItem
            v-for="(r, i) in recent"
            :key="i"
            :data-test="`rum-analytics-funnel-recent-menu-${i}`"
            @select="funnelDraft.startNew(r)"
          >
            <KeySequence :keys="r.steps" :events="events" />
          </ODropdownItem>
        </ODropdown>
        <span
          v-if="recent.length"
          class="border-border-default mx-1 h-5 border-s"
          aria-hidden="true"
        />
        <span>
          <OButton
            variant="outline"
            size="sm"
            icon-left="shield-alert-outline"
            :disabled="!alertReady"
            data-test="rum-analytics-funnel-alert-btn"
            @click="openAlert"
            >{{ t("rum.analytics.funnel.alert") }}</OButton
          >
          <OTooltip :content="alertTip" />
        </span>
        <span>
          <OButton
            variant="outline"
            size="sm"
            icon-left="dashboard-customize"
            :disabled="!dashboardReady"
            data-test="rum-analytics-funnel-add-dashboard-btn"
            @click="dashboardOpen = true"
            >{{ t("rum.analytics.dashboard.add") }}</OButton
          >
          <OTooltip v-if="!dashboardReady" :content="dashboardTip" />
        </span>
      </template>
      <template v-if="def.steps.length" #menu>
        <ODropdownItem
          icon-left="delete-sweep"
          data-test="rum-analytics-funnel-clear-btn"
          @select="clear"
          >{{ t("rum.analytics.funnel.clearSteps") }}</ODropdownItem
        >
      </template>
    </SavedFunnelBar>
    <div class="px-page-edge flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
      <OBanner
        v-if="usersFallback"
        variant="info"
        dense
        :content="t('rum.analytics.funnel.usersFallback')"
        data-test="rum-analytics-funnel-users-fallback"
      />
      <OBanner
        v-if="pa.savedFunnelMissing.value"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.missing')"
        data-test="rum-analytics-funnel-saved-missing"
      />
      <OBanner
        v-if="needsNewer"
        variant="warning"
        dense
        :content="t('rum.analytics.funnel.needsNewer')"
        data-test="rum-analytics-funnel-needs-newer"
      />
      <OBanner
        v-if="stale"
        variant="info"
        dense
        :content="t('rum.analytics.saved.stale')"
        data-test="rum-analytics-funnel-saved-stale"
      />
      <OBanner
        v-if="linkProblem === 'forbidden'"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.noAccess')"
        data-test="rum-analytics-funnel-saved-link-forbidden"
      />
      <OBanner
        v-else-if="linkProblem === 'failed'"
        variant="warning"
        dense
        :content="t('rum.analytics.saved.linkFailed')"
        data-test="rum-analytics-funnel-saved-link-failed"
      >
        <template #actions>
          <OButton
            variant="ghost"
            size="sm"
            data-test="rum-analytics-funnel-saved-link-retry-btn"
            @click="resolveSavedLink(true)"
            >{{ t("common.retry") }}</OButton
          >
        </template>
      </OBanner>

      <OCard
        v-if="!def.steps.length"
        variant="outlined"
        class="rounded-surface p-4"
        data-test="rum-analytics-funnel-cold"
      >
        <OEmptyState
          preset="no-search-results"
          size="block"
          :title="t('rum.analytics.funnel.coldTitle')"
          :description="t('rum.analytics.funnel.coldDescription')"
        >
          <template #actions>
            <FunnelQuickStarts
              :entries="entries"
              :entries-loading="entriesLoading"
              :entries-failed="entriesFailed"
              :recent="recent"
              :events="events"
              @start="setSteps"
              @open="(r) => funnelDraft.startNew(r)"
              @retry="loadEntries"
            />
          </template>
        </OEmptyState>
      </OCard>

      <FunnelLayoutRail
        v-else
        :def="def"
        :result="result"
        :removed="removed"
        :suggestions="suggestions"
        :suggestions-state="suggestionsState"
        :state="funnelPanel"
        :sampled="1"
        :events="events"
        :events-status="eventsStatus"
        :deleted-names="namedEvents.deletedNames.value"
        :unit-label="unitLabel"
        :unit-noun="unitNoun"
        :hide-time="!!def.breakdown"
        :app="pa.state.app"
        :app-filters="appFilters.counts.value"
        :include-hidden="pa.state.includeExcluded"
        :settings="layoutSettings"
        :filter-fields="filterFields"
        :filter-field-types="pa.schemaTypes.value"
        :filter-values="filterValues"
        :failed="funnelFailed"
        @update:def="applyDef"
        @filter-values="loadFilterValues"
        @dropoff="openDropoff"
        @suggestions-retry="retrySuggestions"
        @include-hidden="appFilters.setIncludeHidden(router, true)"
        @hide-hidden="appFilters.setIncludeHidden(router, false)"
        @edit-app-filters="emit('open-exclusions')"
      >
        <template #header>
          <span
            class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 max-md:basis-full"
            data-test="rum-analytics-funnel-overall"
          >
            <span class="text-text-heading text-sm font-semibold">{{
              t("rum.analytics.funnel.overall")
            }}</span>
            <template v-if="result && funnelPanel.status === 'ok'">
              <span class="text-text-heading text-xl font-semibold tabular-nums">{{
                pct(overallRate)
              }}</span>
              <span class="text-text-secondary text-xs">{{
                t("rum.analytics.funnel.overallOf", {
                  last: formatCount(lastUnits, 1),
                  first: formatCount(firstUnits, 1),
                  unit: unitNoun,
                })
              }}</span>
              <span
                v-if="!def.breakdown && def.steps.length > 1 && lastUnits > 0"
                class="text-text-secondary text-xs"
                data-test="rum-analytics-funnel-overall-time"
                >{{
                  t("rum.analytics.funnel.overallTime", {
                    median: raw(formatDuration(result.steps[result.steps.length - 1].medianMs)),
                    p90: raw(formatDuration(result.steps[result.steps.length - 1].p90Ms)),
                  })
                }}</span
              >
              <WhyEnteredPopover
                v-if="!usersMode && def.steps.length > 1"
                :count="firstUnits"
                :app="pa.state.app"
                :step1="firstLabel"
                :state="whyState"
                :lines="why"
                :estimated="funnelPanel.sampled > 1"
                @open="onWhyOpen"
                @retry="loadWhy(true)"
              />
            </template>
          </span>
        </template>
        <template #actions>
          <OToggleGroup
            :model-value="def.unit"
            type="single"
            :label="t('rum.analytics.funnel.countBy')"
            label-position="left"
            data-test="rum-analytics-funnel-count-by"
            @update:model-value="onUnit"
          >
            <OToggleGroupItem
              value="sessions"
              size="xs"
              data-test="rum-analytics-funnel-count-by-sessions"
              >{{ t("rum.analytics.funnel.sessions") }}</OToggleGroupItem
            >
            <OToggleGroupItem
              value="users"
              size="xs"
              :disabled="!identitySql"
              :tooltip="usersTooltip"
              data-test="rum-analytics-funnel-count-by-users"
              >{{ pa.usersUnit.value.label }}</OToggleGroupItem
            >
          </OToggleGroup>
          <span class="border-border-default h-5 border-s max-md:hidden" aria-hidden="true" />
          <OSelect
            v-if="usersMode"
            :model-value="def.window"
            :options="windowOptions"
            size="xs"
            width="sm"
            data-test="rum-analytics-funnel-window-select"
            @update:model-value="(v) => update({ window: v as FunnelWindow })"
          />
          <OTag
            v-else
            :label="t('rum.analytics.funnel.windowSession')"
            variant="default-outline"
            size="sm"
            data-test="rum-analytics-funnel-window-fixed"
          />
          <span class="border-border-default h-5 border-s max-md:hidden" aria-hidden="true" />
          <label
            for="rum-analytics-funnel-breakdown"
            class="text-text-secondary text-xs font-semibold"
            >{{ t("rum.analytics.funnel.breakdownLabel") }}</label
          >
          <OSelect
            id="rum-analytics-funnel-breakdown"
            :model-value="def.breakdown ?? 'none'"
            :options="breakdownOptions"
            size="xs"
            width="xs"
            data-test="rum-analytics-funnel-breakdown-select"
            @update:model-value="
              (v) => update({ breakdown: v === 'none' ? null : (v as BreakdownDim) })
            "
          />
        </template>
        <template #notices>
          <span
            v-if="usersMode && result && result.step1Sessions !== null"
            class="text-text-secondary flex items-center gap-1 px-4 text-xs"
            data-test="rum-analytics-funnel-left-out"
            ><OIcon name="info-outline" size="sm" />{{
              t("rum.analytics.funnel.leftOut", {
                unit: unitNoun,
                field: raw(identitySql?.field ?? ""),
                left: addCommasToNumber(result.leftOut ?? 0),
                total: addCommasToNumber(result.step1Sessions),
              })
            }}</span
          >
          <OBanner
            v-if="!identitySql"
            variant="info"
            dense
            class="mx-4"
            :content="
              pa.identityGapText.value
                ? t('rum.analytics.funnel.identityHintReason', { reason: pa.identityGapText.value })
                : t('rum.analytics.funnel.identityHint')
            "
            data-test="rum-analytics-funnel-identity-hint"
          >
            <template #actions>
              <OButton
                variant="ghost"
                size="sm"
                data-test="rum-analytics-funnel-identity-hint-link"
                @click="openUnlock"
                >{{ t("rum.analytics.funnel.identityHintLink") }}</OButton
              >
            </template>
          </OBanner>
          <NamedEventsNotice
            :status="eventsStatus"
            class="mx-4"
            data-test="rum-analytics-funnel"
            @retry="pa.retryEvents()"
          />
          <OBanner
            v-if="usersMode && pa.sampleRatio.value > 1"
            variant="default"
            dense
            class="mx-4"
            :content="t('rum.analytics.funnel.usersExact')"
            data-test="rum-analytics-funnel-users-exact"
          />

          <AnalyticsPanelState
            v-if="funnelFailed"
            :state="funnelPanel"
            data-test="rum-analytics-funnel"
            @retry="compute(true)"
          />
          <template v-else>
            <OBanner
              v-if="partial"
              variant="warning"
              dense
              class="mx-4"
              :content="t('rum.analytics.partial')"
              data-test="rum-analytics-funnel-partial"
            />
            <OEmptyState
              v-if="step1Empty"
              preset="no-search-results"
              size="block"
              :title="t('rum.analytics.funnel.step1EmptyTitle', { unit: unitNoun })"
              :description="
                t('rum.analytics.funnel.step1EmptyDescription', { step: raw(firstLabel) })
              "
              data-test="rum-analytics-funnel-step1-empty"
            >
              <template #actions>
                <OButton
                  variant="outline"
                  size="md"
                  icon-left="schedule"
                  data-test="rum-analytics-funnel-widen-range-btn"
                  @click="widenRange"
                  >{{ t("rum.analytics.overview.widenRange") }}</OButton
                >
              </template>
            </OEmptyState>
          </template>
        </template>
        <template #footer>
          <span
            v-if="!funnelFailed && def.x?.length"
            class="text-text-secondary px-4 text-xs"
            data-test="rum-analytics-funnel-exclusions-caption"
            >{{ exclusionsCaption }}</span
          >
          <template v-if="def.breakdown && breakdown && funnelPanel.status === 'ok'">
            <span class="text-text-secondary px-4 text-xs">{{
              t("rum.analytics.funnel.breakdownTimeHidden")
            }}</span>
            <span
              v-if="def.breakdown === 'app'"
              class="text-text-secondary px-4 text-xs"
              data-test="rum-analytics-funnel-by-app-rules"
              >{{ t("rum.analytics.funnel.byAppRules", { app: raw(pa.state.app) }) }}</span
            >
            <FunnelBreakdown
              :rows="breakdown.rows"
              :total="breakdown.total"
              :steps="def.steps"
              :dim-label="dimLabel"
              :events="events"
              :deleted-names="namedEvents.deletedNames.value"
              :builtin-only="builtinOnlyApps"
            />
          </template>
        </template>
      </FunnelLayoutRail>
      <AddToDashboard
        v-if="dashboardOpen"
        v-model:open="dashboardOpen"
        :dashboard-panel-data="{ data: {} }"
        :panels="[dashboardPanel()]"
        :notice="t('rum.analytics.funnel.dashboardSnapshot')"
      />
      <DropoffDrawer
        v-if="dropoffCohort"
        :open="!!dropoffCohort"
        :cohort="dropoffCohort"
        :sampled="pa.sampleRatio.value"
        :expected-dropped="expectedDropped"
        :events="events"
        :deleted-names="namedEvents.deletedNames.value"
        @update:open="(v) => !v && closeDropoff()"
        @paths="openCohortPaths"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import OCard from "@/lib/core/Card/OCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import FunnelBreakdown from "@/components/rum/productAnalytics/FunnelBreakdown.vue";
import KeySequence from "@/components/rum/productAnalytics/KeySequence.vue";
import DropoffDrawer from "@/components/rum/productAnalytics/DropoffDrawer.vue";
import NamedEventsNotice from "@/components/rum/productAnalytics/NamedEventsNotice.vue";
import SavedFunnelBar from "@/components/rum/productAnalytics/SavedFunnelBar.vue";
import WhyEnteredPopover from "@/components/rum/productAnalytics/funnelParts/WhyEnteredPopover.vue";
import { fitsLink } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { FilterValuesState } from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { whyLines, type WhyLines } from "@/components/rum/productAnalytics/funnelParts/whyEntered";
import { toast } from "@/lib/feedback/Toast/useToast";
import FunnelQuickStarts from "@/components/rum/productAnalytics/FunnelQuickStarts.vue";
import useFunnelQuickStarts from "@/composables/rum/useFunnelQuickStarts";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import useFunnelDraft, {
  editedInSession,
  funnelStale,
  trackSessionEdits,
} from "@/composables/rum/useFunnelDraft";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAppFilterCounts from "@/composables/rum/useAppFilterCounts";
import FunnelLayoutRail from "@/components/rum/productAnalytics/funnelLayouts/rail/FunnelLayoutRail.vue";
import type { FunnelLayoutSetting } from "@/components/rum/productAnalytics/funnelLayouts/types";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import useAnalyticsSearch, { type PanelState } from "@/composables/rum/useAnalyticsSearch";
import useNamedEvents from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  FILTER_FIELDS,
  exclusionRemoved,
  foldBreakdown,
  formatCount,
  formatDuration,
  funnelParam,
  isFilterColumn,
  toFunnelResult,
  type FunnelResult,
  type NamedEvent,
  type SavedFunnel,
} from "@/utils/rum/productAnalyticsModel";
import {
  DIMENSIONS,
  filterValuesSql,
  funnelSql,
  nextStepsSql,
  storedFunnelScope,
  whyEnteredSql,
  type BreakdownDim,
  type BuildOpts,
  type FunnelCohort,
  type FunnelDef,
  type FunnelWindow,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";
import { buildFunnelPanel, stepLabel } from "@/utils/rum/productAnalyticsPanels";
import { requestAlertCreation } from "@/composables/alerts/useAlertCreation";
import { buildPrefillFromRumFunnel } from "@/utils/alerts/prefill/fromRumFunnel";

defineOptions({ name: "AnalyticsFunnels" });

const AddToDashboard = defineAsyncComponent(() => import("@/plugins/metrics/AddToDashboard.vue"));

const DEBOUNCE_MS = 300;

const emit = defineEmits<{ "open-exclusions": [] }>();
const { t } = useI18nTyped();
const router = useRouter();
const pa = useProductAnalytics();
const appFilters = useAppFilterCounts();
const funnelDraft = useFunnelDraft();
trackSessionEdits();
const runner = useAnalyticsSearch();
const { identitySql } = pa;

const funnelPanel = runner.panel<Record<string, unknown>>("funnel");
const valuesPanel = runner.panel<{ v: string; sessions: number }>("filter-values");
const whyPanel = runner.panel<Record<string, unknown>>("why");
const nextPanel = runner.panel<{ is_next: number; kind: string; k: string; units: number }>("next");
const namedEvents = useNamedEvents();
const savedFunnels = useSavedFunnels();
const events = computed<NamedEvent[]>(() => [...namedEvents.events.value]);
const usesEvents = computed(() => pa.funnel.value.steps.some((s) => s.kind === "e"));
// An event step compiles to no match until its app's events are ready, so it would read as a real zero.
const eventsStatus = computed(() => (usesEvents.value ? pa.eventsStatus.value : "ready"));
const { entries, entriesLoading, entriesFailed, recent, loadEntries, refreshRecent, pushRecent } =
  useFunnelQuickStarts(() => events.value);
const dropoffCohort = ref<FunnelCohort | null>(null);
const valuesField = ref<string | null>(null);
const whyOpen = ref(false);
const dashboardOpen = ref(false);
const linkProblem = pa.savedLinkProblem;
let timer: ReturnType<typeof setTimeout> | null = null;
let whyTimer: ReturnType<typeof setTimeout> | null = null;
let lastKey = "";
let active = true;
let activatedOnce = false;
// An absolute range keeps its scopeKey across a Refresh, so a tick missed while hidden is replayed on return.
let refreshMissed = false;

const def = computed(() => pa.funnel.value);
// Dashboards run unsampled and time-relative, so only the unbroken Sessions funnel is offered.
const dashboardReady = computed(
  () => def.value.steps.length > 1 && def.value.unit === "sessions" && !def.value.breakdown,
);
const usersMode = computed(() => def.value.unit === "users" && !!identitySql.value);
const usersFallback = computed(
  () => def.value.unit === "users" && pa.scopeStatus.value === "ok" && !identitySql.value,
);
const effectiveDef = computed<FunnelDef>(() =>
  usersMode.value ? def.value : { ...def.value, unit: "sessions", window: "session" },
);
const unitLabel = computed(() =>
  usersMode.value ? pa.usersUnit.value.short : t("rum.analytics.funnel.sessions"),
);
const unitNoun = computed(() =>
  usersMode.value ? pa.usersUnit.value.noun : t("rum.analytics.funnel.sessionNoun"),
);
const usersTooltip = computed<I18nText | undefined>(() => {
  // Before the scope resolves there is no reason to give yet.
  if (!identitySql.value) return pa.identityGapText.value ?? undefined;
  return pa.usersUnit.value.partial
    ? t("rum.analytics.identity.partialTooltip", {
        label: pa.usersUnit.value.label,
        field: raw(identitySql.value.field),
      })
    : undefined;
});

const windowOptions = computed(() => [
  { label: t("rum.analytics.funnel.windowSession"), value: "session" },
  { label: t("rum.analytics.funnel.window1h"), value: "1h" },
  { label: t("rum.analytics.funnel.window1d"), value: "1d" },
  { label: t("rum.analytics.funnel.window7d"), value: "7d" },
]);

const dimLabels = computed<Record<BreakdownDim, I18nText>>(() => ({
  browser: t("rum.analytics.funnel.dims.browser"),
  os: t("rum.analytics.funnel.dims.os"),
  device: t("rum.analytics.funnel.dims.device"),
  country: t("rum.analytics.funnel.dims.country"),
  version: t("rum.analytics.funnel.dims.version"),
  env: t("rum.analytics.funnel.dims.env"),
  app: t("rum.analytics.funnel.dims.app"),
}));

const breakdownOptions = computed(() => [
  { label: t("rum.analytics.funnel.breakdownNone"), value: "none" },
  ...(Object.keys(DIMENSIONS) as BreakdownDim[])
    .filter((d) => (d === "app" ? !!pa.scope.value.apps?.length : pa.schema.value[DIMENSIONS[d]]))
    .map((d) => ({ label: dimLabels.value[d], value: d })),
]);

const dimLabel = computed(() =>
  def.value.breakdown ? dimLabels.value[def.value.breakdown] : raw(""),
);

// Exclusions are applied to whatever the funnel's unit links together, so the caption names that span.
const exclusionsCaption = computed<I18nText>(() => {
  const w = effectiveDef.value.window;
  if (w === "1h") return t("rum.analytics.funnel.exclusionsAcross1h");
  if (w === "1d") return t("rum.analytics.funnel.exclusionsAcross1d");
  if (w === "7d") return t("rum.analytics.funnel.exclusionsAcross7d");
  return t("rum.analytics.funnel.exclusionsPerSession");
});

// An app with no settings row still gets the built-in bot rule, and only that.
const builtinOnlyApps = computed(() =>
  def.value.breakdown === "app"
    ? pa.scopeSettings.value.filter((s) => s.id === null).map((s) => s.app)
    : [],
);

// A NULL stored hash is a funnel saved before hashes existed, so it counts as changed.
// The notice asks for a Save, so a read-only viewer, who cannot save, is not shown it.
const stale = computed(
  () => funnelStale(pa.openedFunnel.value) && namedEvents.permission.value !== "read",
);

const needsNewer = computed(
  () => linkProblem.value === "unreadable" || pa.invalidParams.value.includes("funnel"),
);

const breakdown = computed(() =>
  def.value.breakdown && funnelPanel.value.status === "ok"
    ? foldBreakdown(funnelPanel.value.rows, def.value.steps.length)
    : null,
);

const result = computed<FunnelResult | null>(() => {
  if (funnelPanel.value.status !== "ok") return null;
  if (breakdown.value) {
    const hit: Record<string, number> = {};
    breakdown.value.total.forEach((c, i) => {
      hit[`c${i + 1}`] = c;
      hit[`seen${i + 1}`] = 1;
    });
    return toFunnelResult(hit, effectiveDef.value);
  }
  const row = funnelPanel.value.rows[0] as Record<string, number> | undefined;
  return row ? toFunnelResult(row, effectiveDef.value) : null;
});

// Rows from an earlier run index another exclusion list, so they count only for the funnel on screen.
const removed = computed<(number | null)[]>(() =>
  funnelPanel.value.status === "ok" && funnelPanel.value.key === funnelKey.value
    ? exclusionRemoved(funnelPanel.value.rows, def.value.x?.length ?? 0)
    : [],
);

const filterFields = computed(() => [
  ...FILTER_FIELDS.filter((f) => pa.schema.value[f]),
  ...Object.keys(pa.schema.value).filter(isFilterColumn).sort(),
]);

// Rows from another field or scope must never be offered as this field's values.
const filterValues = computed<FilterValuesState>(() => {
  const p = valuesPanel.value;
  const field = valuesField.value;
  if (!field || p.key !== `${pa.scopeKey.value}|${field}`)
    return { field, status: "idle", rows: [] };
  if (p.status === "ok")
    return {
      field,
      status: "ok",
      rows: p.rows.map((r) => ({ value: String(r.v), sessions: Number(r.sessions) || 0 })),
    };
  if (p.status === "loading") return { field, status: "loading", rows: [] };
  return {
    field,
    status: p.status === "error" || p.status === "forbidden" ? "error" : "idle",
    rows: [],
  };
});

const whyState = computed<"idle" | "loading" | "ok" | "error">(() => {
  const p = whyPanel.value;
  if (p.key !== funnelKey.value) return "idle";
  if (p.status === "ok" || p.status === "loading") return p.status;
  return p.status === "error" || p.status === "forbidden" ? "error" : "idle";
});

// The summary is the page's own, so only step 1 and Filter all steps need the popover's query.
const why = computed<WhyLines | null>(() => {
  const s = pa.summary.value;
  if (whyState.value !== "ok" || !s || !result.value) return null;
  const row = whyPanel.value.rows[0] ?? {};
  return whyLines({
    total: s.totalSessions,
    synthetic: pa.schema.value.session_type ? s.syntheticSessions : 0,
    builtinKept: s.builtinKeptSessions,
    kept: s.sessions,
    opened: Number(row.opened) || 0,
    inFilter: Number(row.kept) || 0,
    entered: firstUnits.value,
    removed: removed.value,
    atStep1: (def.value.x ?? []).map((x) => x.b === undefined && x.a === 1),
    hasFilters: !!def.value.f?.length,
  });
});

const layoutSettings = computed<FunnelLayoutSetting[]>(() => [
  { id: "unit", label: t("rum.analytics.funnel.countBy"), value: unitLabel.value },
  {
    id: "window",
    label: t("rum.analytics.funnel.railWindow"),
    value:
      windowOptions.value.find((o) => o.value === effectiveDef.value.window)?.label ??
      t("rum.analytics.funnel.windowSession"),
  },
  {
    id: "breakdown",
    label: t("rum.analytics.funnel.railBreakdown"),
    value: def.value.breakdown ? dimLabel.value : t("rum.analytics.funnel.noBreakdown"),
  },
]);

const firstUnits = computed(() => result.value?.steps[0]?.units ?? 0);
const lastUnits = computed(() => result.value?.steps[result.value.steps.length - 1]?.units ?? 0);
const overallRate = computed(() => (firstUnits.value > 0 ? lastUnits.value / firstUnits.value : 0));
// A deleted event never matches, so a funnel starting with one shows it tagged, not an empty step 1.
const firstStepDeleted = computed(() => {
  const s = def.value.steps[0];
  return (
    eventsStatus.value === "ready" && s?.kind === "e" && !events.value.some((e) => e.id === s.key)
  );
});
const step1Empty = computed(
  () =>
    funnelPanel.value.status === "ok" &&
    !!result.value &&
    firstUnits.value === 0 &&
    !firstStepDeleted.value,
);
const firstLabel = computed(() =>
  def.value.steps[0]
    ? stepLabel(def.value.steps[0], events.value, namedEvents.deletedNames.value)
    : "",
);

const suggestions = computed(() =>
  nextPanel.value.status === "ok" && nextPanel.value.key === funnelKey.value
    ? nextPanel.value.rows
        .filter((r) => r.is_next === 1 && (r.kind === "p" || r.kind === "c") && r.k)
        .map((r) => ({
          step: { kind: r.kind as "p" | "c", key: String(r.k) },
          units: Number(r.units),
        }))
    : [],
);
// Only surfaces the error once it belongs to the funnel on screen, same key guard as `suggestions`.
const idleSuggestionsState: PanelState<unknown> = {
  status: "idle",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
};
const suggestionsState = computed(() =>
  nextPanel.value.key === funnelKey.value ? nextPanel.value : idleSuggestionsState,
);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// Undercounted numbers would seed the alert threshold, so a partial result holds Alert me back.
const funnelFailed = computed(
  () => funnelPanel.value.status === "error" || funnelPanel.value.status === "forbidden",
);
const partial = computed(() => funnelPanel.value.status === "ok" && !!funnelPanel.value.partial);
const alertReady = computed(() => def.value.steps.length > 1 && !!result.value && !partial.value);
const alertTip = computed<I18nText>(() => {
  if (def.value.steps.length < 2) return t("rum.analytics.funnel.alertNeedsRun");
  if (partial.value) return t("rum.analytics.funnel.alertPartial");
  if (!result.value) {
    return funnelPanel.value.status === "error" || funnelPanel.value.status === "forbidden"
      ? t("rum.analytics.funnel.alertNoResult")
      : t("rum.analytics.funnel.alertWaiting");
  }
  return t("rum.analytics.funnel.alertMe");
});
const dashboardTip = computed<I18nText>(() => {
  if (dashboardReady.value) return t("rum.analytics.dashboard.add");
  return def.value.steps.length < 2
    ? t("rum.analytics.dashboard.needsTwoSteps")
    : t("rum.analytics.dashboard.funnelOnly");
});

// Stored and server-run SQL always keeps the app's rules; xall changes only what is displayed.
const snapshotScope = () => ({ ...pa.scope.value, xall: undefined });

// The alert starts at today's conversion, so it fires on any drop below what the user sees now.
const openAlert = () => {
  const dt = pa.state.datetime;
  requestAlertCreation(
    buildPrefillFromRumFunnel({
      scope: snapshotScope(),
      id: identitySql.value,
      def: { ...effectiveDef.value, breakdown: null },
      events: events.value,
      belowPct: Math.floor(overallRate.value * 1000) / 10,
      timeRange:
        dt.valueType === "relative"
          ? { type: "relative", relativeTimePeriod: dt.relativeTimePeriod ?? undefined }
          : { type: "absolute", startTime: dt.startTime, endTime: dt.endTime },
    }),
  );
};

const org = () => pa.toQuery().org_identifier as string;

// Once the live list says a step's event is gone, its last known name is worth a lookup.
watch(
  () => [def.value.steps, eventsStatus.value] as const,
  () => {
    if (eventsStatus.value !== "ready") return;
    const missing = def.value.steps
      .filter((s) => s.kind === "e" && !events.value.some((e) => e.id === s.key))
      .map((s) => s.key);
    if (missing.length) void namedEvents.resolveDeletedNames(org(), missing);
  },
  { immediate: true, deep: true },
);

// A saved funnel's name is the panel's default title; the panel stays a snapshot.
const dashboardPanel = () => {
  const panel = buildFunnelPanel(
    storedFunnelScope(pa.scope.value),
    def.value,
    events.value,
    t,
    namedEvents.deletedNames.value,
  );
  return pa.openedFunnel.value ? { ...panel, title: pa.openedFunnel.value.name } : panel;
};

// Stored SQL follows the definition, which remembers no page scope, so env, version, compared apps and new users stay out.
const savedSql = (d: FunnelDef): string | null =>
  !pa.rulesReady.value || (d.unit === "users" && !identitySql.value)
    ? null
    : funnelSql(storedFunnelScope(pa.scope.value), identitySql.value, d, {
        events: events.value,
        sample: 1,
      });

// An sf link wins over the funnel it carried; only a confirmed absence drops it, a failed read keeps it for Retry.
const resolveSavedLink = async (retry = false, quiet = false) => {
  const id = pa.pendingSavedId.value;
  const o = org();
  const app = pa.state.app;
  const same = () => pa.pendingSavedId.value === id && pa.state.app === app && org() === o;
  if (!id || (!retry && linkProblem.value)) return;
  let status = await savedFunnels.ensure(o, app, retry, quiet);
  // A load superseded by a forced reload settled nothing, so the newest reload in flight decides.
  while (status === "loading" && same()) status = await savedFunnels.ensure(o, app, false, quiet);
  let found: SavedFunnel | null | "failed" | "unreadable" =
    savedFunnels.funnels.value.find((f) => f.id === id) ?? null;
  if (!found && status === "ready") found = await savedFunnels.readOne(o, app, id);
  if (!same() || status === "loading") return;
  if (found === "unreadable") pa.setSavedLinkIssue(app, id, "unreadable");
  else if (found === "failed" || status === "failed") pa.setSavedLinkIssue(app, id, "failed");
  else if (found) pa.openSavedFunnel(found, editedInSession(found.id, pa.funnel.value));
  else if (status === "forbidden") pa.setSavedLinkIssue(app, id, "forbidden");
  else pa.markSavedFunnelMissing();
};

const eventSignature = (d: FunnelDef) =>
  JSON.stringify(
    d.steps
      .filter((s) => s.kind === "e")
      .map((s) => events.value.find((e) => e.id === s.key)?.rules ?? null),
  );

// What a run of the funnel on screen is keyed by, so suggestions from any other run never show.
const funnelKey = computed(() => {
  const d = effectiveDef.value;
  return `${pa.scopeKey.value}|${identitySql.value?.excluded.length ?? ""}|${JSON.stringify(funnelParam(d))}|${eventSignature(d)}`;
});

// The URL keeps the funnel, so any edit that would push it past a link's length is refused.
const applyDef = (d: FunnelDef) => {
  if (!fitsLink(d)) {
    toast({ variant: "error", message: t("rum.analytics.funnel.editTooLongForLink") });
    return;
  }
  pa.funnel.value = d;
};

const update = (patch: Partial<FunnelDef>) => applyDef({ ...def.value, ...patch });

const setSteps = (steps: StepRef[]) => {
  if (!steps.length) pa.detachSavedFunnel();
  update({ steps });
};

const clear = async () => {
  if (await funnelDraft.confirmDiscard()) setSteps([]);
};

const onUnit = (v: unknown) => {
  if (v !== "sessions" && v !== "users") return;
  update({ unit: v, window: "session" });
};

const hold = (status: "idle" | "loading") => {
  lastKey = "";
  runner.hold("funnel", status);
  runner.hold("next", "idle");
};

const compute = async (force = false) => {
  await pa.loadScope();
  if (pa.scopeStatus.value !== "ok" || !pa.state.app) return;
  if (pa.openedFunnel.value && pa.openedFunnel.value.app !== pa.state.app) pa.detachSavedFunnel();
  void savedFunnels.ensure(org(), pa.state.app);
  await resolveSavedLink();
  if (!active) return;
  if (eventsStatus.value === "loading") hold("loading");
  const gate = await pa.eventsGate(() => usesEvents.value);
  if (!active) return;
  refreshRecent();
  const d = effectiveDef.value;
  if (!d.steps.length) {
    hold("idle");
    void pa.syncUrl(router);
    void loadEntries();
    return;
  }
  if (gate !== "ready") {
    hold(gate === "loading" ? "loading" : "idle");
    void pa.syncUrl(router);
    return;
  }
  const key = funnelKey.value;
  if (!force && key === lastKey) return;
  lastKey = key;
  void pa.syncUrl(router);
  if (d.steps.length > 1) pushRecent(def.value);
  const cur = pa.resolveRange();
  const opts = { events: events.value, sample: pa.sampleRatio.value };
  const res = await runner.run(
    "funnel",
    {
      sql: funnelSql(pa.scope.value, identitySql.value, d, { ...opts, sample: 1 }),
      ...pa.newUsersRange(cur, d.unit === "users" && !!identitySql.value),
      limit: d.breakdown ? 1000 : 1,
      sampled: 1,
    },
    key,
  );
  if (res.status !== "ok" || key !== lastKey) return;
  runSuggestions(d, key, cur, opts);
};

const runSuggestions = (
  d: FunnelDef,
  key: string,
  cur: { startUs: number; endUs: number },
  opts: BuildOpts,
) => {
  const sampled = usersMode.value ? 1 : pa.sampleRatio.value;
  void runner.run(
    "next",
    {
      sql: nextStepsSql(
        pa.scope.value,
        identitySql.value,
        { ...d, breakdown: null },
        { ...opts, sample: sampled },
      ),
      ...pa.newUsersRange(cur, d.unit === "users" && !!identitySql.value),
      limit: 5,
      sampled,
    },
    key,
  );
};

// Cheaper than compute(true): the funnel counts haven't changed, only the suggestions query failed.
const retrySuggestions = () => {
  if (funnelPanel.value.status !== "ok") return;
  runSuggestions(effectiveDef.value, funnelKey.value, pa.resolveRange(), {
    events: events.value,
    sample: pa.sampleRatio.value,
  });
};

const loadFilterValues = (field: string) => {
  valuesField.value = field;
  if (!pa.schema.value[field]) return;
  const key = `${pa.scopeKey.value}|${field}`;
  const p = valuesPanel.value;
  if (p.key === key && (p.status === "ok" || p.status === "loading")) return;
  void runner.run(
    "filter-values",
    { sql: filterValuesSql(pa.scope.value, field), ...pa.resolveRange(), limit: 20, sampled: 1 },
    key,
  );
};

// Runs only while the popover is open, and never inside the funnel query, so the funnel keeps its row pruning.
const loadWhy = (force = false) => {
  const d = effectiveDef.value;
  if (!whyOpen.value || usersMode.value || d.steps.length < 2) return;
  const key = funnelKey.value;
  const p = whyPanel.value;
  if (!force && p.key === key && (p.status === "ok" || p.status === "loading")) return;
  void runner.run(
    "why",
    {
      sql: whyEnteredSql(pa.scope.value, d, { events: events.value, sample: 1 }),
      ...pa.resolveRange(),
      limit: 1,
      sampled: 1,
    },
    key,
  );
};

const onWhyOpen = (open: boolean) => {
  whyOpen.value = open;
  loadWhy();
};

const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (active) void compute();
  }, DEBOUNCE_MS);
};

const widenRange = () => {
  pa.setScope({
    datetime: { valueType: "relative", relativeTimePeriod: "30d", startTime: 0, endTime: 0 },
  });
  void pa.syncUrl(router);
};

const openUnlock = () => {
  pa.lastSubTab.value = "retention";
  void pa.pushSubTab(router, PA_ROUTES.retention);
};

const openDropoff = (stepIndex: number) => {
  dropoffCohort.value = {
    funnel: { ...effectiveDef.value, breakdown: null },
    stepIndex,
    side: "dropped",
  };
};

const closeDropoff = () => {
  dropoffCohort.value = null;
};

const expectedDropped = computed(() => {
  const k = dropoffCohort.value?.stepIndex;
  const steps = result.value?.steps;
  if (!k || !steps || !steps[k]) return null;
  return steps[k - 1].units - steps[k].units;
});

const openCohortPaths = (cohort: FunnelCohort) => {
  dropoffCohort.value = null;
  // Captured now: the open funnel can change later while Paths keeps this cohort.
  const opened = pa.openedFunnel.value;
  pa.paths.value = {
    ...pa.paths.value,
    anchor: null,
    cohort: opened ? { ...cohort, name: opened.name, funnelId: opened.id } : cohort,
  };
  pa.lastSubTab.value = "paths";
  void pa.pushSubTab(router, PA_ROUTES.paths);
};

watch(
  () => [
    pa.funnel.value,
    pa.scopeKey.value,
    identitySql.value?.excluded.length,
    namedEvents.events.value,
    pa.eventsStatus.value,
  ],
  schedule,
  {
    deep: true,
  },
);

// Typing an "Only when" value changes the key per keystroke, so the open popover reruns once typing settles.
watch(funnelKey, () => {
  if (whyTimer) clearTimeout(whyTimer);
  whyTimer = setTimeout(() => {
    whyTimer = null;
    if (active) loadWhy();
  }, DEBOUNCE_MS);
});

// Opening, saving or detaching a saved funnel need not change the steps, so the link is synced here.
watch(
  () => [pa.openedFunnel.value?.id, pa.savedFunnelMissing.value],
  () => {
    if (active) void pa.syncUrl(router);
  },
);

watch(
  () => pa.refreshTick.value,
  () => {
    if (active) void compute(true);
    else refreshMissed = true;
  },
);

onMounted(() => {
  void compute();
});

onActivated(() => {
  active = true;
  if (!activatedOnce) {
    activatedOnce = true;
    return;
  }
  // Coming back to a link that could not be read reads it again; its failure was already toasted.
  if (linkProblem.value === "failed") void resolveSavedLink(true, true);
  // A run cut short by leaving never loaded its suggestions, and its key still matches, so it reruns whole.
  const cutShort = funnelPanel.value.status === "aborted" || nextPanel.value.status === "aborted";
  void compute(cutShort || refreshMissed);
  refreshMissed = false;
});

onDeactivated(() => {
  active = false;
  // Add to dashboard leaves for the dashboard it filled, so it must not greet the user on Back.
  dashboardOpen.value = false;
  runner.abortAll();
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  if (whyTimer) clearTimeout(whyTimer);
  runner.abortAll();
});

defineExpose({ compute, openDropoff });
</script>
