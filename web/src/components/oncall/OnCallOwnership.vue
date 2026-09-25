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
  Routing: what reaches this team, what it caught, and what reached nobody —
  as one list, read top to bottom.

  The rules lead. The cheap answer to "would this page us?" — what a draft
  rule would catch — lives inside the rule editor, where the question
  actually comes up.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-ownership">
    <OnCallRoutingList
      :rules="rules"
      :signals="signals"
      :aliases="aliases"
      :catalogue="catalogue"
      :services="services"
      :sets="sets"
      :team-id="teamId"
      :team-name="teamName"
      :teams="teams"
      :default-team-id="routingConfig?.default_team_id ?? null"
      :ladder="ladder"
      :conflict="conflict"
      :loading="loadingRules"
      :saving="saving"
      :saving-default="savingDefault"
      :claiming="claiming"
      @save-rule="saveRule"
      @remove="(rule) => (ruleToDelete = rule)"
      @set-default="saveDefaultTeam"
      @claim-all="claimAllOpen = true"
      @dismiss="dismissSignal"
      @preview="previewConflict"
    />

    <ConfirmDialog
      :model-value="!!ruleToDelete"
      :title="t('oncall.removeRuleTitle')"
      :message="t('oncall.removeRuleMessage')"
      @update:ok="deleteRule"
      @update:cancel="ruleToDelete = null"
    />

    <!-- Claiming everything writes one rule per signal, so it is confirmed:
         the undo is deleting each rule individually. -->
    <ConfirmDialog
      :model-value="claimAllOpen"
      :title="t('oncall.unroutedClaimAllTitle')"
      :message="
        t('oncall.unroutedClaimAllMessage', { count: openSignals.length, team: raw(teamName) })
      "
      @update:ok="claimAll"
      @update:cancel="claimAllOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallRoutingList from "@/components/oncall/OnCallRoutingList.vue";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { IdentitySet } from "@/services/service_streams";
import {
  dimensionAnalyticsQuery,
  identityConfigQuery,
  semanticGroupsQuery,
  servicesListQuery,
} from "@/services/service_streams.queries";
import { useOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import oncallService from "@/services/oncall";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import {
  createOwnershipRuleMutation,
  deleteOwnershipRuleMutation,
  dismissUnroutedSignalMutation,
  ownershipStatsQuery,
  setRoutingConfigMutation,
  unroutedSignalsQuery,
  updateOwnershipRuleMutation,
} from "@/services/oncall.queries";
import type {
  DimensionCatalogue,
  DiscoveredService,
  OnCallTeam,
  OwnershipRuleStats,
  RoutingPreview,
  TeamRungSummary,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { identityDimensions } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teamId: string;
    teams: OnCallTeam[];
    /** This team's ladder, so a rule can say what paging it would run. */
    ladder?: TeamRungSummary[];
  }>(),
  { ladder: () => [] },
);

const { t } = useI18nTyped();
const store = useStore();

const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string }[]>([]);
/// What this org's telemetry actually carries, so the rule editor offers
/// dimensions that can match and values that have been seen.
const catalogue = ref<DimensionCatalogue>({ present: [], values: {} });
/// Discovered services, so a rule can claim one whole identity rather than be
/// assembled a dimension at a time.
const services = ref<DiscoveredService[]>([]);
/// The org's identity sets. `distinguish_by` is ordered, so it is also the
/// hierarchy — cluster contains namespace — which is what lets the rule editor
/// offer levels to claim instead of a flat list of registry rows.
const sets = ref<IdentitySet[]>([]);
const { config: routingConfig, load: loadRoutingConfig } = useOnCallRoutingConfig();

/// Who holds the path the rule editor is currently drafting.
const conflict = ref<RoutingPreview | null>(null);

const loadingRules = ref(false);
const saving = ref(false);
const savingDefault = ref(false);
const claiming = ref(false);

const claimAllOpen = ref(false);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamName = computed(() => props.teams.find((team) => team.id === props.teamId)?.name ?? "");

/// What a bulk claim would actually write — dismissed rows are the record, not
/// the worklist, and the confirmation has to count the same set.
const openSignals = computed(() => signals.value.filter((signal) => !signal.dismissed_at));

// Getter form, so every write follows an org switch.
const ruleCreate = useMutation(() => createOwnershipRuleMutation(orgId.value));
const ruleUpdate = useMutation(() => updateOwnershipRuleMutation(orgId.value));
const ruleDelete = useMutation(() => deleteOwnershipRuleMutation(orgId.value));
const signalDismiss = useMutation(() => dismissUnroutedSignalMutation(orgId.value));
const routingConfigWrite = useMutation(() => setRoutingConfigMutation(orgId.value));

function failed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  toast({ variant: "error", message: raw(message) || fallback });
}

/// The vocabulary degrades to an empty picker rather than blocking the screen:
/// every other section here still answers its question without it.
async function fetchAliases() {
  try {
    aliases.value = (await queryClient.fetchQuery(semanticGroupsQuery(orgId.value))) ?? [];
  } catch {
    aliases.value = [];
  }
}

/// The semantic groups say what a dimension COULD be called; this says which of
/// them this org has ever emitted, and with what values. Without it the editor
/// offers the whole vocabulary, most of which can never match here.
/// Services discovery has seen. The identity a rule would write is already on
/// the record — the org's identity sets decided it — so claiming one is a
/// choice, not three fields the reader has to reconstruct.
async function fetchServices() {
  try {
    const rows = await queryClient.fetchQuery(servicesListQuery(orgId.value));
    const seen = new Map<string, DiscoveredService>();
    for (const row of rows) {
      const name = String(row.service_name ?? "");
      if (!name) continue;
      const identity = (row.disambiguation ?? {}) as Record<string, string>;
      const existing = seen.get(name);
      // One row per service. A service seen both with and without its
      // infrastructure identity is one service to a human, and the narrower
      // record is the one worth claiming.
      if (!existing || (!Object.keys(existing.identity).length && Object.keys(identity).length)) {
        seen.set(name, { name, setId: String(row.set_id ?? "default"), identity });
      }
    }
    services.value = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    services.value = [];
  }
}

/// The hierarchy, straight from correlation's own configuration rather than
/// asked for again here — two screens describing one estate is how they end up
/// disagreeing about its shape.
/// Who holds a drafted path today, answered by the engine.
///
/// The draft's own conditions are replayed as if they were a signal, so this is
/// the real decision rather than a second copy of the ordering on this side.
/// Debounced by the editor, so this runs once per pause.
///
/// Never surfaces an error: a conflict line that cannot be drawn is missing
/// context, not a reason to stop somebody writing a rule.
async function previewConflict(dimensions: Record<string, string>) {
  if (!Object.keys(dimensions).length) {
    conflict.value = null;
    return;
  }
  try {
    // Never cached: a dry run per keystroke, each on a draft no entry could be keyed on.
    const res = await oncallService.previewRouting({
      org_identifier: orgId.value,
      data: { dimensions },
    });
    conflict.value = res.data ?? null;
  } catch {
    conflict.value = null;
  }
}

async function fetchSets() {
  try {
    sets.value = (await queryClient.fetchQuery(identityConfigQuery(orgId.value)))?.sets ?? [];
  } catch {
    // No sets means no levels, and the rule editor falls back to the field
    // builder — which is exactly what this screen offered before.
    sets.value = [];
  }
}

async function fetchCatalogue() {
  try {
    const summary = await queryClient.fetchQuery(dimensionAnalyticsQuery(orgId.value));
    const dims = summary?.dimensions ?? [];
    catalogue.value = {
      present: summary?.recommended_priority_dimensions ?? dims.map((d) => d.dimension_name),
      values: Object.fromEntries(dims.map((d) => [d.dimension_name, d.value_counts ?? {}])),
    };
  } catch {
    // An empty catalogue falls back to the full vocabulary and free-text
    // values, which is what this screen did before it existed.
    catalogue.value = { present: [], values: {} };
  }
}

/// Never forced: a write expires these entries, so the re-read after one costs one request.
async function fetchRules() {
  loadingRules.value = true;
  try {
    const stats = await queryClient.fetchQuery(ownershipStatsQuery(orgId.value, props.teamId));
    rules.value = stats?.rules ?? [];
  } catch (err) {
    failed(err, t("oncall.loadRulesFailed"));
  } finally {
    loadingRules.value = false;
  }
}

async function fetchSignals() {
  try {
    signals.value = (await queryClient.fetchQuery(unroutedSignalsQuery(orgId.value))) ?? [];
  } catch {
    // Additive: a team with no unrouted traffic and an endpoint that is not
    // there look the same from here, and neither is worth an error toast.
    signals.value = [];
  }
}

/// Always 200 — an org that never nominated answers with nulls. A failure
/// leaves the row unset-looking, which is the honest reading of "could not
/// load": neither state claims a catch-all exists.
async function fetchRoutingConfig() {
  await loadRoutingConfig(orgId.value);
}

/// One call, in place. An edit used to be create-then-delete, which was
/// deliberate — the path was never owned by nobody — but the server now
/// refuses the create while the original still holds the path, so repointing a
/// rule to another team failed with "another team already owns this path". The
/// update route does the same job atomically.
async function saveRule(draft: RuleDraft & { rule?: OwnershipRuleStats | null }) {
  saving.value = true;
  const data = { team_id: draft.team_id || props.teamId, dimensions: draft.dimensions };
  try {
    if (draft.rule) {
      await ruleUpdate.mutateAsync({ ruleId: draft.rule.rule_id, data });
    } else {
      await ruleCreate.mutateAsync(data);
    }
    toast({
      variant: "success",
      message: draft.rule ? t("oncall.ruleUpdated") : t("oncall.ruleCreated"),
    });
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
    // The queue moves with the rules: a path nobody owns again lands unrouted.
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    failed(err, t("oncall.deleteRuleFailed"));
  }
}

async function saveDefaultTeam(teamId: string | null) {
  savingDefault.value = true;
  try {
    await routingConfigWrite.mutateAsync(teamId);
    // Shared with the policy editor's ladder-end warning, which a local patch leaves stale.
    await loadRoutingConfig(orgId.value);
    toast({
      variant: "success",
      message: teamId ? t("oncall.defaultTeamSaved") : t("oncall.defaultTeamCleared"),
    });
  } catch (err) {
    failed(err, t("oncall.defaultTeamSaveFailed"));
  } finally {
    savingDefault.value = false;
  }
}

/// Claiming IS writing a rule for the dimensions that went unmatched. The
/// signal is not dismissed afterwards — once the path is owned it stops being
/// unrouted on its own, and dismissing it as well would hide the evidence if
/// the rule turns out to be wrong.
///
/// Only the org's identity dimensions belong in a rule: a signal arrives
/// carrying everything the alert knew — pod name, node, status code — and a
/// rule written against those matches exactly one pod until it restarts, then
/// nothing, forever.
function routableDimensions(signal: UnroutedSignal): Record<string, string> {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? kept : signal.dimensions;
}

/// Sequential on purpose: the server dedupes rules on the dimension path, and
/// two signals sharing a path would race into a duplicate-key error that reads
/// like the whole operation failed.
async function claimAll() {
  claimAllOpen.value = false;
  claiming.value = true;
  let claimed = 0;
  for (const signal of openSignals.value) {
    try {
      await ruleCreate.mutateAsync({
        team_id: props.teamId,
        dimensions: routableDimensions(signal),
      });
      claimed += 1;
    } catch {
      // One path already covered should not abandon the rest of the queue.
    }
  }
  claiming.value = false;
  toast({
    variant: claimed ? "success" : "error",
    message: claimed ? t("oncall.unroutedClaimed", { count: claimed }) : t("oncall.saveRuleFailed"),
  });
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

onMounted(() => {
  fetchRules();
  fetchSignals();
  fetchAliases();
  fetchCatalogue();
  fetchServices();
  fetchSets();
  fetchRoutingConfig();
});
</script>
