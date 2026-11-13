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

<!-- Org routing: every team's rules as one list, and the signals no rule claims. -->
<template>
  <OPageLayout
    bleed
    data-test="oncall-routing-page"
    :title="t('oncall.routingTitle')"
    icon="alt-route"
  >
    <template #title-trail>
      <BetaBadge class="shrink-0" />
      <OTooltip side="bottom" :content="t('oncall.routingPrecedence')">
        <OIcon
          name="info-outline"
          size="sm"
          tabindex="0"
          :label="t('oncall.routingPrecedence')"
          class="text-text-secondary cursor-help"
          data-test="oncall-routing-precedence-info"
        />
      </OTooltip>
    </template>
    <template #actions>
      <OButton
        v-if="ready && !isMobile"
        variant="outline"
        size="sm"
        icon-left="manage-search"
        :active="tester.open.value"
        data-test="oncall-routing-test-signal"
        @click="tester.openTester()"
      >
        {{ t("oncall.routingTestRouting") }}
      </OButton>
      <OButton
        v-if="ready && tab === 'rules' && canConfigure"
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="oncall-routing-add-rule"
        @click="openAdd"
      >
        {{ t("oncall.newRule") }}
      </OButton>
      <OButton
        v-if="ready && tab === 'signals' && canConfigure && claimableCount"
        variant="primary"
        size="sm"
        icon-left="alt-route"
        :loading="claimingAll"
        data-test="oncall-routing-claim-all"
        @click="openClaimAll"
      >
        {{ t("oncall.unroutedClaimAll", { count: claimableCount }) }}
      </OButton>
    </template>
    <template #actions-overflow>
      <OButton
        v-if="ready && isMobile"
        variant="outline"
        size="sm"
        icon-left="manage-search"
        :active="tester.open.value"
        data-test="oncall-routing-test-signal"
        @click="tester.openTester()"
      >
        {{ t("oncall.routingTestRouting") }}
      </OButton>
    </template>

    <!-- 404 (feature off) and 403 "Not Supported" (OSS) are deployment facts, not failures. -->
    <OEmptyState
      v-if="unavailable"
      size="hero"
      icon="cloud-off"
      :title="t('oncall.notAvailableTitle')"
      :description="t('oncall.notAvailableDescription')"
      data-test="oncall-routing-unavailable"
    />

    <LicenseDeniedState
      v-else-if="licenseDenied"
      :features="licenseDenied"
      data-test="oncall-routing-license-denied"
    />

    <OEmptyState
      v-else-if="loadError"
      size="hero"
      preset="load-error"
      :title="t('oncall.routingLoadFailed')"
      :description="loadError ? raw(loadError) : undefined"
      data-test="oncall-routing-error"
      @action="refreshPage"
    />

    <OEmptyState
      v-else-if="loaded && !teams.length"
      size="hero"
      preset="no-oncall-teams"
      data-test="oncall-routing-empty"
      @action="goToTeams"
    />

    <div v-else class="flex min-h-0 flex-1 flex-col" data-test="oncall-routing-content">
      <OnCallOwnershipRules
        v-if="tab === 'rules'"
        :rules="rules"
        :teams="teams"
        :aliases="aliases"
        :services="services"
        :default-team-id="routingConfig?.default_team_id ?? null"
        :loading="loadingRules"
        :search="search"
        :editable="canConfigure"
        testable
        @add="openAdd"
        @edit="openEdit"
        @remove="(rule: OwnershipRuleStats) => (ruleToDelete = rule)"
        @test="(rule: OwnershipRuleStats) => tester.openTester(rule.dimensions)"
        @change-default="defaultTeamCard?.openDialog()"
        @clear-search="clearSearch"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-2 max-md:contents">
            <OToggleGroup
              :model-value="tab"
              type="single"
              mobile-dropdown
              data-test="oncall-routing-tabs"
              @update:model-value="setTab"
            >
              <OToggleGroupItem value="rules" size="sm" data-test="oncall-routing-tab-rules">
                {{ t("oncall.ownershipRules") }}
                <OTag variant="default-soft" size="sm">{{ rules.length }}</OTag>
              </OToggleGroupItem>
              <OToggleGroupItem value="signals" size="sm" data-test="oncall-routing-tab-signals">
                {{ t("oncall.routingTabNeedsRule") }}
                <OTag
                  :variant="openSignalCount ? 'error-soft' : 'default-soft'"
                  size="sm"
                  data-test="oncall-routing-tab-signals-count"
                >
                  {{ openSignalCount }}
                </OTag>
              </OToggleGroupItem>
            </OToggleGroup>
            <OSearchInput
              v-model="search"
              class="min-w-48 flex-1 max-md:min-w-24"
              clearable
              :placeholder="t('oncall.routingSearchRules')"
              data-test="oncall-routing-search"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastFetchedAt"
            :loading="refreshing"
            data-test="oncall-routing-refresh"
            @click="refreshPage"
          />
        </template>
      </OnCallOwnershipRules>

      <OnCallUnroutedQueue
        v-else
        :signals="signals"
        :teams="teams"
        :loading="loadingSignals"
        :show-header="false"
        :search="search"
        :error="signalsError ? t('oncall.unroutedLoadFailed') : ''"
        @claim="openClaim"
        @dismiss="dismissSignal"
        @retry="retrySignals"
        @clear-search="clearSearch"
      >
        <template #toolbar>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-2 max-md:contents">
            <OToggleGroup
              :model-value="tab"
              type="single"
              mobile-dropdown
              data-test="oncall-routing-tabs"
              @update:model-value="setTab"
            >
              <OToggleGroupItem value="rules" size="sm" data-test="oncall-routing-tab-rules">
                {{ t("oncall.ownershipRules") }}
                <OTag variant="default-soft" size="sm">{{ rules.length }}</OTag>
              </OToggleGroupItem>
              <OToggleGroupItem value="signals" size="sm" data-test="oncall-routing-tab-signals">
                {{ t("oncall.routingTabNeedsRule") }}
                <OTag
                  :variant="openSignalCount ? 'error-soft' : 'default-soft'"
                  size="sm"
                  data-test="oncall-routing-tab-signals-count"
                >
                  {{ openSignalCount }}
                </OTag>
              </OToggleGroupItem>
            </OToggleGroup>
            <div class="bg-border-default h-4 w-px shrink-0 max-md:hidden" />

            <!-- Server-side: `landing` splits the two emergencies; `include_dismissed` swaps the worklist for the record. -->
            <OToggleGroup
              :model-value="signalFilters.landing || 'both'"
              mobile-dropdown
              data-test="oncall-unrouted-filter"
              @update:model-value="setSignalLanding"
            >
              <OToggleGroupItem
                value="both"
                size="sm"
                icon-left="format-list-bulleted"
                data-test="oncall-unrouted-filter-both"
              >
                {{ t("oncall.unroutedFilterBoth") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="nobody"
                size="sm"
                icon-left="notifications-paused"
                data-test="oncall-unrouted-filter-nobody"
              >
                {{ t("oncall.unroutedPagedNobody") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="default_team"
                size="sm"
                icon-left="group-work"
                data-test="oncall-unrouted-filter-default"
              >
                {{ t("oncall.unroutedFilterDefault") }}
              </OToggleGroupItem>
            </OToggleGroup>

            <OCheckbox
              :model-value="signalFilters.include_dismissed"
              :label="t('oncall.unroutedShowDismissed')"
              data-test="oncall-unrouted-show-dismissed"
              @update:model-value="setSignalIncludeDismissed"
            />

            <OSearchInput
              v-model="search"
              class="min-w-48 flex-1 max-md:min-w-24"
              clearable
              :placeholder="t('oncall.routingSearchSignals')"
              data-test="oncall-routing-search"
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastFetchedAt"
            :loading="refreshing"
            data-test="oncall-routing-refresh"
            @click="refreshPage"
          />
        </template>
      </OnCallUnroutedQueue>
    </div>

    <OnCallDefaultTeamCard
      v-if="ready"
      ref="defaultTeamCard"
      :key="cardKey"
      :teams="teams"
      dialog
      :show-trigger="false"
    />

    <ODrawer
      :open="tester.open.value"
      size="lg"
      :title="t('oncall.routingTestRouting')"
      data-test="oncall-routing-tester-drawer"
      @update:open="(v: boolean) => (tester.open.value = v)"
    >
      <OnCallRoutingSimulator
        :preview="tester.preview.value"
        :teams="teams"
        :aliases="aliases"
        :catalogue="catalogue"
        :services="services"
        :signals="openSignals"
        :rules="rules"
        :seed="tester.seed.value"
        :loading="tester.testing.value"
        :sending="tester.sending.value"
        :test-result="tester.testResult.value"
        :can-configure="canConfigure"
        @run="tester.run"
        @send-test="tester.sendTest"
      />
    </ODrawer>

    <OnCallRuleEditor
      :open="dialogOpen"
      :rule="editingRule"
      :initial-dimensions="claimingDimensions"
      :team-id="claimTeamId"
      :teams="teams"
      :aliases="aliases"
      :catalogue="catalogue"
      :services="services"
      :signals="openSignals"
      :rules="rules"
      :conflict="conflict"
      :saving="saving"
      @update:open="(v: boolean) => (dialogOpen = v)"
      @save="saveRule"
      @preview="previewConflict"
    />

    <ODialog
      :open="claimAllOpen"
      size="sm"
      :title="t('oncall.unroutedClaimAllTitlePlain', { count: claimableCount }, claimableCount)"
      :primary-button-label="t('oncall.unroutedClaimAll', { count: claimableCount })"
      :secondary-button-label="t('oncall.cancel')"
      :primary-button-disabled="!claimAllTeam"
      :primary-button-loading="claimingAll"
      data-test="oncall-routing-claim-all-dialog"
      @update:open="(v: boolean) => (claimAllOpen = v)"
      @click:primary="claimAll"
      @click:secondary="claimAllOpen = false"
    >
      <div class="flex flex-col gap-5">
        <OSelect
          :model-value="claimAllTeam || null"
          :label="t('oncall.ruleEditorWake')"
          :options="teamOptions"
          :placeholder="t('oncall.ruleEditorWakePlaceholder')"
          size="sm"
          searchable
          data-test="oncall-routing-claim-all-team"
          @update:model-value="(v: unknown) => (claimAllTeam = v === null ? '' : String(v))"
        />
        <OText v-if="claimAllTeam" variant="body" data-test="oncall-routing-claim-all-outcome">
          {{ t("oncall.unroutedClaimAllOutcome", { team: raw(teamNameOf(claimAllTeam)) }) }}
        </OText>
      </div>
    </ODialog>

    <ConfirmDialog
      :model-value="!!ruleToDelete"
      :title="t('oncall.removeRuleTitle')"
      message-keypath="oncall.removeRuleMessageNamed"
      :message-name="ruleToDelete ? readable(ruleToDelete.dimensions) : ''"
      ok-variant="destructive"
      :ok-label="t('oncall.removeRule')"
      focus-cancel
      @update:ok="deleteRule"
      @update:cancel="ruleToDelete = null"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallDefaultTeamCard from "@/components/oncall/OnCallDefaultTeamCard.vue";
import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import OnCallUnroutedQueue from "@/components/oncall/OnCallUnroutedQueue.vue";
import type { UnroutedFilters } from "@/components/oncall/OnCallUnroutedQueue.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import { useOnCallRoutingTester } from "@/composables/useOnCallRoutingTester";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import type { DimensionAnalyticsSummary, FieldAlias } from "@/services/service_streams";
import {
  dimensionAnalyticsQuery,
  semanticGroupsQuery,
  servicesListQuery,
} from "@/services/service_streams.queries";
import oncallService from "@/services/oncall";
import { oncallKeys } from "@/services/oncall.querykeys";
import {
  createOwnershipRuleMutation,
  deleteOwnershipRuleMutation,
  dismissUnroutedSignalMutation,
  oncallTeamsQuery,
  ownershipStatsQuery,
  unroutedSignalsQuery,
  updateOwnershipRuleMutation,
} from "@/services/oncall.queries";
import type {
  DimensionCatalogue,
  DiscoveredService,
  OnCallTeam,
  OwnershipRuleStats,
  OwnershipStats,
  RoutingPreview,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { displayFieldsOf } from "@/types/serviceRef";
import {
  claimableDimensions,
  isOnCallUnavailable,
  ownershipPath,
  readableConditions,
} from "@/utils/oncall";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { useLicenseLock } from "@/composables/useFeatureLock";

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const store = useStore();
const router = useRouter();
const route = useRoute();
const { config: routingConfig, load: loadRoutingConfig } = useOnCallRoutingConfig();
const defaultTeamCard = ref<InstanceType<typeof OnCallDefaultTeamCard> | null>(null);
const { locked: correlationLocked } = useLicenseLock("correlation");

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teams = ref<OnCallTeam[]>([]);
const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string; fields?: string[] }[]>([]);
/// Who holds the path the rule editor drafts; separate from the tester's preview, which answers the reader's question.
const conflict = ref<RoutingPreview | null>(null);

const loaded = ref(false);
const loadError = ref("");
const licenseDenied = ref<string[] | null>(null);
const unavailable = ref(false);
const signalsError = ref(false);
// True from mount, not false: the content div renders before `fetchAll`'s
// first await resolves, and a false start here would show the table's empty
// state for a frame before the skeleton loader ever appears.
const loadingRules = ref(true);
const loadingSignals = ref(true);
const saving = ref(false);

/// Which list is on screen. `signals` is the queue of paths nothing claims.
const tab = ref<"rules" | "signals">(route.query.tab === "signals" ? "signals" : "rules");

const dialogOpen = ref(false);
const editingRule = ref<OwnershipRuleStats | null>(null);
const claimingSignal = ref<UnroutedSignal | null>(null);

/// The conditions a claim opens with: the failing path, identity only. The
/// editor owns the draft from there.
const claimingDimensions = computed(() =>
  claimingSignal.value ? claimableDimensions(claimingSignal.value.dimensions) : null,
);

/// The team a defaulted signal already reaches, so claiming it for them is one click; a deleted team is no default.
const claimTeamId = computed(() => {
  const id = claimingSignal.value?.defaulted_team_id ?? "";
  return teams.value.some((team) => team.id === id) ? id : "";
});

/// A dismissed row is the record, not the worklist.
const openSignals = computed(() => signals.value.filter((signal) => !signal.dismissed_at));

/// What this org emits, and the services it has seen — the editor offers both
/// instead of the whole field vocabulary and a text box.
const catalogue = ref<DimensionCatalogue>({ present: [], values: {} });
const services = ref<DiscoveredService[]>([]);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);

/// The header actions only make sense once the page has something to act on —
/// not over the unavailable, error or no-teams states.
const ready = computed(() => loaded.value && !loadError.value && !!teams.value.length);

/// Dismissed rows are the historical record, not the worklist, so the tab
/// counts what is still outstanding.
const openSignalCount = computed(
  () => signals.value.filter((signal) => !signal.dismissed_at).length,
);

function setTab(value: unknown) {
  if (value !== "rules" && value !== "signals") return;
  // One search box serves both tables; a rules query means nothing against the queue.
  if (value !== tab.value) search.value = "";
  tab.value = value;
}

const search = ref("");

const clearSearch = () => (search.value = "");

function failed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  toast({
    variant: "error",
    message: message
      ? t("oncall.toastFailedReason", { action: fallback, reason: raw(message) })
      : fallback,
  });
}

function readable(dimensions: Record<string, string>): string {
  return readableConditions(dimensions, aliases.value, {
    and: String(t("oncall.ruleEditorAnd")),
    startsWith: (field) => String(t("oncall.ruleChipStartsWith", { field: raw(field) })),
  });
}

function errorText(err: unknown): string {
  return (
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (err instanceof Error ? err.message : "")
  );
}

const ruleCreate = useMutation(() => createOwnershipRuleMutation(orgId.value));
const ruleUpdate = useMutation(() => updateOwnershipRuleMutation(orgId.value));
const ruleDelete = useMutation(() => deleteOwnershipRuleMutation(orgId.value));
const signalDismiss = useMutation(() => dismissUnroutedSignalMutation(orgId.value));
const { canConfigure } = useOnCallPermissions();
const tester = useOnCallRoutingTester({ orgId, signals: openSignals, onError: failed });

/// Cache-first; a force expires the entry before the fetch, so it costs one request, not two.
async function read<T>(
  options: { queryKey: readonly unknown[]; [k: string]: any },
  force: boolean,
): Promise<T> {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  return queryClient.fetchQuery(options as any) as Promise<T>;
}

/// Teams and rules are the backbone — without them the screen cannot say what
/// routes where, so their failure is the page's failure, with a retry (B8).
/// The vocabulary and the queue degrade section-by-section instead.
async function fetchAll(force = false) {
  loadError.value = "";
  licenseDenied.value = null;
  try {
    teams.value = await read<OnCallTeam[]>(oncallTeamsQuery(orgId.value), force);
  } catch (err) {
    // The probe answered "not here" — that is a deployment fact, not a failure.
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      return;
    }
    licenseDenied.value = licenseDeniedFeatures(err);
    if (!licenseDenied.value) loadError.value = errorText(err);
    loaded.value = true;
    return;
  }
  loaded.value = true;
  // `fetchCatalogue` and `fetchServices` were written, and nothing called them.
  // The rule editor on this page therefore had an empty catalogue and an empty
  // service list for its whole life — no values to pick, no services to claim,
  // and no way to tell that from a deployment that had genuinely discovered
  // nothing. The team page called them; this one never did.
  await Promise.all([
    fetchRules(force),
    fetchSignals(force),
    fetchAliases(force),
    loadRoutingConfig(orgId.value),
    // The rule editor's discovered services and dimensions come from the correlation API.
    ...(correlationLocked.value ? [] : [fetchCatalogue(force), fetchServices(force)]),
  ]);
  // The oldest of the backbone reads, so the age never claims the page is fresher than it is.
  lastFetchedAt.value = Math.min(
    ...[oncallTeamsQuery(orgId.value), ownershipStatsQuery(orgId.value)].map(
      (options) => queryClient.getQueryState(options.queryKey)?.dataUpdatedAt || Date.now(),
    ),
  );
}

const refreshing = ref(false);
const lastFetchedAt = ref<number | null>(null);
// Bumped by Refresh: the default-team card reads the routing config only when it is set up.
const cardKey = ref(0);

/// Refresh and the error state's Retry. Named, so the emitted action id cannot land on `force`.
async function refreshPage() {
  refreshing.value = true;
  try {
    // Sends nothing: every on-call read below re-fetches on its next read.
    await queryClient.invalidateQueries({
      queryKey: oncallKeys.all(orgId.value),
      refetchType: "none",
    });
    await fetchAll(true);
    cardKey.value += 1;
  } finally {
    refreshing.value = false;
  }
}

async function fetchRules(force = false) {
  loadingRules.value = true;
  try {
    // No team_id: the org-wide answer, shadowing computed across every team.
    const stats = await read<OwnershipStats | null>(ownershipStatsQuery(orgId.value), force);
    rules.value = stats?.rules ?? [];
  } catch (err) {
    loadError.value = errorText(err);
  } finally {
    loadingRules.value = false;
  }
}

/// The filtering is the endpoint's, not a client-side sieve: include_dismissed
/// also drops entries a since-written rule would now catch, which no client
/// can compute.
const signalFilters = ref<UnroutedFilters>({ include_dismissed: false });

function setSignalLanding(value: unknown) {
  const landing = value === "default_team" || value === "nobody" ? value : undefined;
  signalFilters.value = {
    ...(landing ? { landing } : {}),
    include_dismissed: signalFilters.value.include_dismissed,
  };
  fetchSignals();
}

function setSignalIncludeDismissed(value: unknown) {
  signalFilters.value = { ...signalFilters.value, include_dismissed: !!value };
  fetchSignals();
}

// The newest read: a slower answer for a filter the reader has already left must not overwrite the queue.
let latestSignalsRead = 0;

async function fetchSignals(force = false) {
  loadingSignals.value = true;
  signalsError.value = false;
  const readId = ++latestSignalsRead;
  try {
    const queue = await read<UnroutedSignal[] | null>(
      unroutedSignalsQuery(orgId.value, signalFilters.value),
      force,
    );
    if (readId !== latestSignalsRead) return;
    signals.value = queue ?? [];
  } catch {
    if (readId !== latestSignalsRead) return;
    signalsError.value = true;
    signals.value = [];
  } finally {
    if (readId === latestSignalsRead) loadingSignals.value = false;
  }
}

// Same trap as `refreshPage`: the queue's own retry must decide `force`, not the event.
const retrySignals = () => fetchSignals(true);

/// The vocabulary degrades to an empty picker rather than blocking the screen:
/// every other section here still answers its question without it.
async function fetchAliases(force = false) {
  try {
    aliases.value = (await read<FieldAlias[]>(semanticGroupsQuery(orgId.value), force)) ?? [];
  } catch {
    aliases.value = [];
  }
}

let conflictRun = 0;

/// The engine replays the draft as a signal; never surfaces an error, since a missing line must not block a rule.
async function previewConflict(dimensions: Record<string, string>) {
  const run = ++conflictRun;
  if (!Object.keys(dimensions).length) {
    conflict.value = null;
    return;
  }
  try {
    // Uncached: a debounced dry run must answer the draft being typed, never an older one.
    const res = await oncallService.previewRouting({
      org_identifier: orgId.value,
      data: { dimensions },
    });
    if (run === conflictRun) conflict.value = res.data ?? null;
  } catch {
    if (run === conflictRun) conflict.value = null;
  }
}

/// Which field names this org has ever emitted, and with what values; degrades to empty.
async function fetchCatalogue(force = false) {
  try {
    const summary = await read<DimensionAnalyticsSummary>(
      dimensionAnalyticsQuery(orgId.value),
      force,
    );
    const dims = summary?.dimensions ?? [];
    catalogue.value = {
      present: summary?.recommended_priority_dimensions ?? dims.map((d) => d.dimension_name),
      values: Object.fromEntries(dims.map((d) => [d.dimension_name, d.value_counts ?? {}])),
    };
  } catch {
    catalogue.value = { present: [], values: {} };
  }
}

async function fetchServices(force = false) {
  try {
    const rows = await read<Record<string, any>[]>(servicesListQuery(orgId.value), force);
    const seen = new Map<string, DiscoveredService>();
    for (const row of rows) {
      const name = String(row.service_name ?? "");
      // Filed under its stream's name, which routing ignores, so offering it would claim nothing.
      if (!name || row.named_after_stream === true) continue;
      const identity = (row.disambiguation ?? {}) as Record<string, string>;
      const existing = seen.get(name);
      if (!existing || (!Object.keys(existing.identity).length && Object.keys(identity).length)) {
        seen.set(name, {
          name,
          setId: String(row.set_id ?? "default"),
          identity,
          ...displayFieldsOf(row),
        });
      }
    }
    services.value = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    services.value = [];
  }
}

function goToTeams() {
  router.push({
    name: "onCallTeams",
    query: { org_identifier: orgId.value },
  });
}

function openAdd() {
  editingRule.value = null;
  claimingSignal.value = null;
  dialogOpen.value = true;
}

function openEdit(rule: OwnershipRuleStats) {
  editingRule.value = rule;
  claimingSignal.value = null;
  dialogOpen.value = true;
}

/// G4: the rule that would have caught this signal, pre-filled. The user
/// picks the team and confirms — the dimensions are already the failing path.
function openClaim(signal: UnroutedSignal) {
  editingRule.value = null;
  claimingSignal.value = signal;
  dialogOpen.value = true;
}

/// One call, in place. An edit used to be create-then-delete, which was
/// deliberate — the path was never owned by nobody — but the server now
/// refuses the create while the original still holds the path, so repointing a
/// rule to another team failed with "another team already owns this path". The
/// update route does the same job atomically.
async function saveRule(draft: RuleDraft) {
  saving.value = true;
  const data = { team_id: draft.team_id, dimensions: draft.dimensions };
  try {
    if (editingRule.value) {
      await ruleUpdate.mutateAsync({ ruleId: editingRule.value.rule_id, data });
    } else {
      await ruleCreate.mutateAsync(data);
    }
    const edited = !!editingRule.value;
    editingRule.value = null;
    claimingSignal.value = null;
    dialogOpen.value = false;
    toast({
      variant: "success",
      message: t(edited ? "oncall.toastRuleUpdated" : "oncall.toastRuleCreated", {
        name: raw(readable(draft.dimensions)),
      }),
    });
    // A claimed signal is never dismissed — the evidence stays in case the rule is wrong.
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    failed(err, t("oncall.saveRuleFailed"));
  } finally {
    saving.value = false;
  }
}

async function deleteRule() {
  const rule = ruleToDelete.value;
  ruleToDelete.value = null;
  if (!rule) return;
  try {
    await ruleDelete.mutateAsync(rule.rule_id);
    toast({
      variant: "success",
      message: t("oncall.toastRuleRemoved", { name: raw(readable(rule.dimensions)) }),
    });
    // A path nothing owns again is unrouted again — the queue is half of what a delete moves.
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    failed(err, t("oncall.deleteRuleFailed"));
  }
}

const claimAllOpen = ref(false);
const claimAllTeam = ref("");
const claimingAll = ref(false);

const teamOptions = computed(() =>
  teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
);

function teamNameOf(teamId: string): string {
  return teams.value.find((team) => team.id === teamId)?.name || teamId;
}

function openClaimAll() {
  claimAllTeam.value = "";
  claimAllOpen.value = true;
}

/// Open signals whose path no rule owns yet, grouped by that path, since one rule claims them all.
const claimableByPath = computed(() => {
  const owned = new Set(rules.value.map((rule) => ownershipPath(rule.dimensions)));
  const groups = new Map<string, { dimensions: Record<string, string>; count: number }>();
  for (const signal of openSignals.value) {
    const dimensions = claimableDimensions(signal.dimensions);
    const path = ownershipPath(dimensions);
    if (!path || owned.has(path)) continue;
    const group = groups.get(path);
    if (group) group.count += 1;
    else groups.set(path, { dimensions, count: 1 });
  }
  return [...groups.values()];
});

const claimableCount = computed(() =>
  claimableByPath.value.reduce((sum, group) => sum + group.count, 0),
);

const CLAIM_FAILED_LISTED = 3;

function failedPathsText(failedPaths: Record<string, string>[]): string {
  const shown = failedPaths.slice(0, CLAIM_FAILED_LISTED).map(readable).join(", ");
  const rest = failedPaths.length - CLAIM_FAILED_LISTED;
  return rest > 0
    ? String(t("oncall.claimSignalsMorePaths", { paths: raw(shown), count: rest }))
    : shown;
}

/// Sequential: the server keys rules on the path, so a parallel twin reads as a failed claim.
async function claimAll() {
  const teamId = claimAllTeam.value;
  const groups = claimableByPath.value;
  if (!teamId || !groups.length) return;
  claimingAll.value = true;
  const total = claimableCount.value;
  let claimed = 0;
  const failedPaths: Record<string, string>[] = [];
  let lastError: unknown = null;
  for (const group of groups) {
    try {
      await ruleCreate.mutateAsync({ team_id: teamId, dimensions: group.dimensions });
      claimed += group.count;
    } catch (err) {
      lastError = err;
      failedPaths.push(group.dimensions);
    }
  }
  claimingAll.value = false;
  claimAllOpen.value = false;
  const team = raw(teamNameOf(teamId));
  if (!failedPaths.length) {
    toast({
      variant: "success",
      message: t("oncall.toastSignalsClaimed", { count: claimed, team }, claimed),
    });
  } else if (claimed) {
    toast({
      variant: "warning",
      message: t(
        "oncall.toastSignalsClaimedPartly",
        { claimed, count: total, team, paths: raw(failedPathsText(failedPaths)) },
        total,
      ),
    });
  } else {
    failed(
      lastError,
      t("oncall.claimSignalsFailedPaths", { paths: raw(failedPathsText(failedPaths)) }),
    );
  }
  await Promise.all([fetchRules(), fetchSignals()]);
}

async function dismissSignal(signal: UnroutedSignal) {
  try {
    await signalDismiss.mutateAsync(signal.id);
    await fetchSignals();
  } catch (err) {
    failed(err, t("oncall.unroutedDismissFailed"));
  }
}

onMounted(() => fetchAll());
</script>
