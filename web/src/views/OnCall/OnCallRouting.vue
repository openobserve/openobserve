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
  Org-level routing: every team's claim over the identity space, on one screen.

  The team tab answers "what reaches THIS team"; this page answers the org's
  questions — which rules exist at all, which team a signal would land on,
  whether a catch-all is nominated, and what fired and woke nobody. The
  sections are the same components the team tab uses, hosted without a team:
  a rule here names its team, and claiming an unrouted signal starts by
  choosing one.

  Order mirrors the team tab's rationale: the simulator leads because it is
  the question people arrive with, the rules follow as the explanation, the
  default team sits above the queue it exists to drain.
-->
<template>
  <OPageLayout
    data-test="oncall-routing-page"
    :title="t('oncall.routingTitle')"
    :subtitle="t('oncall.routingSubtitle')"
    icon="account-tree"
    scroll
  >
    <!-- All on demand: the page's own answer is the rule list, so the tester
         opens in a drawer rather than pushing the lists down the screen, and
         Add rule belongs to the tab that holds rules. The catch-all sits on
         both tabs: setting one is rare, but knowing whether one exists is not. -->
    <template #actions>
      <OnCallDefaultTeamCard v-if="ready" :teams="teams" :dialog="true" />
      <OButton
        v-if="ready"
        variant="outline"
        size="sm-action"
        icon-left="search"
        :active="testerOpen"
        data-test="oncall-routing-test-signal"
        @click="testerOpen = !testerOpen"
      >
        {{ testerOpen ? t("oncall.routingHideTest") : t("oncall.routingTestSignal") }}
      </OButton>
      <OButton
        v-if="ready && tab === 'rules'"
        variant="primary"
        size="sm-action"
        data-test="oncall-routing-add-rule"
        @click="openAdd"
      >
        {{ t("oncall.addRule") }}
      </OButton>
    </template>

    <!-- §G.8.1: the entry fetch is the capability probe. 404 (feature off) and
         403 "Not Supported" (OSS build) both mean on-call is not available
         here — a fact about the deployment, not a failure, so no error tone,
         no retry, and no hint of which of the two it was. -->
    <OEmptyState
      v-if="unavailable"
      size="hero"
      icon="cloud-off"
      :title="t('oncall.notAvailableTitle')"
      :description="t('oncall.notAvailableDescription')"
      data-test="oncall-routing-unavailable"
    />

    <!-- A transient 500 is not "this org has no rules" — say it failed and
         offer the way back. -->
    <OEmptyState
      v-else-if="loadError"
      size="hero"
      variant="error"
      illustration="broken-panel"
      :title="t('oncall.routingLoadFailed')"
      :description="loadError ? raw(loadError) : undefined"
      :action-label="t('oncall.retry')"
      data-test="oncall-routing-error"
      @action="fetchAll"
    />

    <!-- No teams means nothing can own or be paged — routing starts at Teams. -->
    <OEmptyState
      v-else-if="loaded && !teams.length"
      size="hero"
      preset="no-oncall-rules"
      data-test="oncall-routing-empty"
      @action="goToTeams"
    />

    <div v-else class="flex flex-col gap-5 py-4" data-test="oncall-routing-content">
      <!-- Two lists, one question apart: what the org already owns, and what
           nothing owns yet. The count on each is the reason to switch. -->
      <OToggleGroup
        :model-value="tab"
        type="single"
        class="self-start"
        data-test="oncall-routing-tabs"
        @update:model-value="setTab"
      >
        <OToggleGroupItem value="rules" size="sm" data-test="oncall-routing-tab-rules">
          {{ t("oncall.ownershipRules") }}
          <OTag variant="default-soft" size="sm">{{ rules.length }}</OTag>
        </OToggleGroupItem>
        <OToggleGroupItem value="signals" size="sm" data-test="oncall-routing-tab-signals">
          {{ t("oncall.routingTabNeedsRule") }}
          <OTag :variant="openSignalCount ? 'error-soft' : 'default-soft'" size="sm">
            {{ openSignalCount }}
          </OTag>
        </OToggleGroupItem>
      </OToggleGroup>

      <OnCallOwnershipRules
        v-if="tab === 'rules'"
        :rules="rules"
        :aliases="aliases"
        :loading="loadingRules"
        :show-team="true"
        :show-header="false"
        @add="openAdd"
        @edit="openEdit"
        @remove="(rule) => (ruleToDelete = rule)"
      />

      <!-- The queue's own failure must not read as "nothing is unrouted" —
           that is this screen's core claim, and it has to be honest (B8). -->
      <OEmptyState
        v-else-if="signalsError"
        size="inline"
        variant="error"
        :title="t('oncall.unroutedLoadFailed')"
        :action-label="t('oncall.retry')"
        data-test="oncall-unrouted-error"
        @action="fetchSignals"
      />
      <OnCallUnroutedQueue
        v-else
        :signals="signals"
        :teams="teams"
        filterable
        :loading="loadingSignals"
        :show-header="false"
        @claim="openClaim"
        @dismiss="dismissSignal"
        @change-filters="onFiltersChange"
      />
    </div>

    <!-- The tester answers a hypothetical about the rules; it should not cost
         the reader their place in them, so it slides over the page instead of
         inserting a panel above it. -->
    <ODrawer
      :open="testerOpen"
      size="lg"
      :title="t('oncall.simulatorTitle')"
      :sub-title="t('oncall.simulatorHint')"
      data-test="oncall-routing-tester-drawer"
      @update:open="(v: boolean) => (testerOpen = v)"
    >
      <OnCallRoutingSimulator
        :preview="preview"
        :teams="teams"
        :aliases="aliases"
        :loading="testing"
        :sending="sendingTest"
        :embedded="true"
        @run="runPreview"
        @send-test="sendTestPage"
      />
    </ODrawer>

    <!-- One dialog for add, edit and claim: a rule is dimensions plus the team
         they route to. A claim arrives with the dimensions already filled —
         the click removed is the one where the user re-types what the queue
         already knew (G4). -->
    <ODialog
      :open="dialogOpen"
      :title="dialogTitle"
      :primary-button-label="t('oncall.saveRule')"
      :secondary-button-label="t('oncall.cancel')"
      :primary-button-disabled="!draftPairs.length || !draftTeam"
      :primary-button-loading="saving"
      data-test="oncall-routing-rule-dialog"
      @update:open="(v: boolean) => (dialogOpen = v)"
      @click:primary="saveRule"
      @click:secondary="dialogOpen = false"
    >
      <div class="flex flex-col gap-4">
        <OSelect
          :model-value="draftTeam"
          :options="teamOptions"
          :label="t('oncall.ruleRoutesTo')"
          :placeholder="t('oncall.ruleTeamPlaceholder')"
          searchable
          data-test="oncall-routing-rule-team"
          @update:model-value="(v: unknown) => (draftTeam = String(v))"
        />

        <div v-if="draftPairs.length" class="flex flex-wrap gap-2">
          <span
            v-for="(pair, index) in draftPairs"
            :key="index"
            class="border-border-default rounded-default flex items-center gap-1 border px-2 py-1"
          >
            <code class="text-text-body text-compact">{{ raw(`${pair.name}=${pair.value}`) }}</code>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="close"
              :aria-label="t('oncall.removeDimension')"
              @click="draftPairs.splice(index, 1)"
            />
          </span>
        </div>

        <!-- Pair by pair, from the org's vocabulary: free text is how a rule
             ends up matching a dimension nothing ever emits. -->
        <div class="flex flex-wrap items-end gap-2">
          <OSelect
            v-model="draftName"
            :options="dimensionOptions"
            :label="t('oncall.dimensionName')"
            :placeholder="t('oncall.dimensionNamePlaceholder')"
            width="sm"
            searchable
            data-test="oncall-routing-dimension-name"
          />
          <OInput
            v-model="draftValue"
            :label="t('oncall.dimensionValue')"
            :placeholder="t('oncall.dimensionValuePlaceholder')"
            width="sm"
            data-test="oncall-routing-dimension-value"
          />
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!canAddPair"
            data-test="oncall-routing-add-dimension"
            @click="addPair"
          >
            {{ t("oncall.add") }}
          </OButton>
        </div>

        <!-- Values are lowercased on the server to match what the extractor
             pulls off a record. Showing the normalised form means the rule
             read back is the rule that will match. -->
        <p v-if="draftPairs.length" class="text-text-muted text-xs">
          {{ t("oncall.ownershipPreviewPath") }}
          <code class="text-text-body">{{ raw(draftPath) }}</code>
        </p>
      </div>
    </ODialog>

    <ConfirmDialog
      :model-value="!!ruleToDelete"
      :title="t('oncall.removeRuleTitle')"
      :message="t('oncall.removeRuleMessage')"
      @update:ok="deleteRule"
      @update:cancel="ruleToDelete = null"
      @update:model-value="
        (v: boolean) => {
          if (!v) ruleToDelete = null;
        }
      "
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallDefaultTeamCard from "@/components/oncall/OnCallDefaultTeamCard.vue";
import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import type { SimulatorQuery } from "@/components/oncall/OnCallRoutingSimulator.vue";
import OnCallUnroutedQueue from "@/components/oncall/OnCallUnroutedQueue.vue";
import type { UnroutedFilters } from "@/components/oncall/OnCallUnroutedQueue.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import type {
  OnCallTeam,
  OwnershipRuleStats,
  RoutingPreview,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  identityDimensions,
  isOnCallUnavailable,
  normalizeDimensionValue,
  ownershipPath,
} from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teams = ref<OnCallTeam[]>([]);
const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string }[]>([]);
const preview = ref<RoutingPreview | null>(null);

const loaded = ref(false);
const loadError = ref("");
const unavailable = ref(false);
const signalsError = ref(false);
const loadingRules = ref(false);
const loadingSignals = ref(false);
const testing = ref(false);
const sendingTest = ref(false);
const saving = ref(false);

/// Which list is on screen. `signals` is the queue of paths nothing claims.
const tab = ref<"rules" | "signals">("rules");
/// The tester is opened from the header rather than shipped open: it answers a
/// hypothetical, and the rules below answer what is actually configured.
const testerOpen = ref(false);

const dialogOpen = ref(false);
const editingRule = ref<OwnershipRuleStats | null>(null);
const claimingSignal = ref<UnroutedSignal | null>(null);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);
const draftTeam = ref("");
const draftPairs = ref<{ name: string; value: string }[]>([]);
const draftName = ref("");
const draftValue = ref("");

/// The header actions only make sense once the page has something to act on —
/// not over the unavailable, error or no-teams states.
const ready = computed(() => loaded.value && !loadError.value && !!teams.value.length);

/// Dismissed rows are the historical record, not the worklist, so the tab
/// counts what is still outstanding.
const openSignalCount = computed(
  () => signals.value.filter((signal) => !signal.dismissed_at).length,
);

/// A single-select toggle group can deselect its active item; this screen
/// always shows one of the two lists, so a null round-trip keeps the tab.
function setTab(value: unknown) {
  if (value === "rules" || value === "signals") tab.value = value;
}

const teamOptions = computed(() =>
  teams.value.map((team) => ({ label: raw(team.name), value: team.id })),
);

const dimensionOptions = computed(() =>
  aliases.value.map((alias) => ({ label: raw(alias.display || alias.id), value: alias.id })),
);

const dialogTitle = computed<I18nText>(() => {
  if (claimingSignal.value) return t("oncall.claimRuleTitle");
  return editingRule.value ? t("oncall.editOwnershipRule") : t("oncall.addOwnershipRule");
});

const canAddPair = computed(
  () =>
    !!draftName.value.trim() &&
    !!draftValue.value.trim() &&
    !draftPairs.value.some((pair) => pair.name === draftName.value.trim()),
);

const draftPath = computed(() =>
  ownershipPath(Object.fromEntries(draftPairs.value.map((pair) => [pair.name, pair.value]))),
);

function addPair() {
  if (!canAddPair.value) return;
  draftPairs.value.push({
    name: draftName.value.trim(),
    value: normalizeDimensionValue(draftValue.value),
  });
  draftName.value = "";
  draftValue.value = "";
}

function failed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  toast({ variant: "error", message: raw(message) || fallback });
}

function errorText(err: unknown): string {
  return (
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (err instanceof Error ? err.message : "")
  );
}

/// Teams and rules are the backbone — without them the screen cannot say what
/// routes where, so their failure is the page's failure, with a retry (B8).
/// The vocabulary and the queue degrade section-by-section instead.
async function fetchAll() {
  loadError.value = "";
  try {
    const res = await oncallService.listTeams({ org_identifier: orgId.value });
    teams.value = res.data ?? [];
  } catch (err) {
    // The probe answered "not here" — that is a deployment fact, not a failure.
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      return;
    }
    loadError.value = errorText(err);
    loaded.value = true;
    return;
  }
  loaded.value = true;
  await Promise.all([fetchRules(), fetchSignals(), fetchAliases()]);
}

async function fetchRules() {
  loadingRules.value = true;
  try {
    // No team_id: the org-wide answer, shadowing computed across every team.
    const res = await oncallService.ownershipStats({ org_identifier: orgId.value });
    rules.value = res.data?.rules ?? [];
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

function onFiltersChange(filters: UnroutedFilters) {
  signalFilters.value = filters;
  fetchSignals();
}

async function fetchSignals() {
  loadingSignals.value = true;
  signalsError.value = false;
  try {
    const res = await oncallService.unroutedSignals({
      org_identifier: orgId.value,
      ...signalFilters.value,
    });
    signals.value = res.data ?? [];
  } catch {
    signalsError.value = true;
    signals.value = [];
  } finally {
    loadingSignals.value = false;
  }
}

/// The vocabulary degrades to an empty picker rather than blocking the screen:
/// every other section here still answers its question without it.
async function fetchAliases() {
  try {
    const res = await alertsService.getSemanticGroups(orgId.value);
    aliases.value = res.data ?? [];
  } catch {
    aliases.value = [];
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
  draftTeam.value = "";
  draftPairs.value = [];
  dialogOpen.value = true;
}

function openEdit(rule: OwnershipRuleStats) {
  editingRule.value = rule;
  claimingSignal.value = null;
  draftTeam.value = rule.team_id;
  draftPairs.value = Object.entries(rule.dimensions ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  dialogOpen.value = true;
}

/// Only the org's identity dimensions belong in a rule. A signal arrives
/// carrying everything the alert knew — pod name, node, status code — and a
/// rule written against those matches exactly one pod until it restarts, then
/// nothing, forever. Routable facts route; evidence stays on the signal.
function routableDimensions(signal: UnroutedSignal): Record<string, string> {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? kept : signal.dimensions;
}

/// G4: the rule that would have caught this signal, pre-filled. The user
/// picks the team and confirms — the dimensions are already the failing path.
function openClaim(signal: UnroutedSignal) {
  editingRule.value = null;
  claimingSignal.value = signal;
  draftTeam.value = "";
  draftPairs.value = Object.entries(routableDimensions(signal)).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  dialogOpen.value = true;
}

/// One call, in place. An edit used to be create-then-delete, which was
/// deliberate — the path was never owned by nobody — but the server now
/// refuses the create while the original still holds the path, so repointing a
/// rule to another team failed with "another team already owns this path". The
/// update route does the same job atomically.
async function saveRule() {
  saving.value = true;
  const data = {
    team_id: draftTeam.value,
    dimensions: Object.fromEntries(draftPairs.value.map((pair) => [pair.name, pair.value])),
  };
  try {
    if (editingRule.value) {
      await oncallService.updateOwnershipRule({
        org_identifier: orgId.value,
        rule_id: editingRule.value.rule_id,
        data,
      });
    } else {
      await oncallService.createOwnershipRule({ org_identifier: orgId.value, data });
    }
    const edited = !!editingRule.value;
    const claimed = !!claimingSignal.value;
    editingRule.value = null;
    claimingSignal.value = null;
    draftPairs.value = [];
    dialogOpen.value = false;
    toast({
      variant: "success",
      message: edited ? t("oncall.ruleUpdated") : t("oncall.ruleCreated"),
    });
    // A claim changes both lists: the rule now exists, and the path stops
    // being unrouted on its own. The signal is not dismissed — the evidence
    // stays in case the rule turns out to be wrong.
    await Promise.all([fetchRules(), claimed ? fetchSignals() : Promise.resolve()]);
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
    await oncallService.deleteOwnershipRule({
      org_identifier: orgId.value,
      rule_id: rule.rule_id,
    });
    await fetchRules();
  } catch (err) {
    failed(err, t("oncall.deleteRuleFailed"));
  }
}

async function dismissSignal(signal: UnroutedSignal) {
  try {
    await oncallService.dismissUnroutedSignal({
      org_identifier: orgId.value,
      signal_id: signal.id,
    });
    await fetchSignals();
  } catch (err) {
    failed(err, t("oncall.unroutedDismissFailed"));
  }
}

async function runPreview(query: SimulatorQuery) {
  testing.value = true;
  try {
    const res = await oncallService.previewRouting({
      org_identifier: orgId.value,
      data: { dimensions: query.dimensions },
    });
    preview.value = res.data;
  } catch (err) {
    failed(err, t("oncall.testRoutingFailed"));
  } finally {
    testing.value = false;
  }
}

/// This one really sends. The simulator above it does not, which is why the
/// two are separate buttons rather than one control with a mode.
async function sendTestPage(value: { team_id: string; priority: string }) {
  sendingTest.value = true;
  try {
    const res = await oncallService.testPage({
      org_identifier: orgId.value,
      team_id: value.team_id,
      priority: Number(value.priority.replace(/^P/i, "")) || undefined,
    });
    // `attempts`, not `recipients` — the latter never existed on the wire.
    const reached = (res.data?.attempts ?? []).filter((attempt) => attempt.delivered).length;
    toast({
      variant: res.data?.reached_anyone ? "success" : "warning",
      message: res.data?.reached_anyone
        ? t("oncall.testPageSent", { count: reached }, reached)
        : t("oncall.testPageNobody", { reason: raw(res.data?.not_sent_because ?? "") }),
    });
  } catch (err) {
    failed(err, t("oncall.testPageFailed"));
  } finally {
    sendingTest.value = false;
  }
}

onMounted(fetchAll);
</script>
