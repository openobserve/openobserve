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

  The rules lead. The tester used to, on the theory that "would this page us?"
  is the question people arrive with; but it asks the reader to describe a
  hypothetical alert before they have seen a single rule. It is now a strip that
  opens under the list, and the cheap version of the same answer — what a draft
  rule would catch — lives inside the rule editor, where the question actually
  comes up.
-->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-ownership">
    <OnCallRoutingList
      :rules="rules"
      :signals="signals"
      :aliases="aliases"
      :team-id="teamId"
      :team-name="teamName"
      :teams="teams"
      :default-team-id="routingConfig?.default_team_id ?? null"
      :on-call-now="onCallNow"
      :ladder="ladder"
      :loading="loadingRules"
      :saving="saving"
      :saving-default="savingDefault"
      :claiming="claiming"
      :tester-open="testerOpen"
      @save-rule="saveRule"
      @remove="(rule) => (ruleToDelete = rule)"
      @set-default="saveDefaultTeam"
      @claim-all="claimAllOpen = true"
      @dismiss="dismissSignal"
      @toggle-tester="testerOpen = !testerOpen"
    />

    <OnCallRoutingSimulator
      v-if="testerOpen"
      :preview="preview"
      :team-id="teamId"
      :team-name="teamName"
      :teams="teams"
      :aliases="aliases"
      :loading="testing"
      :sending="sendingTest"
      @run="runPreview"
      @send-test="sendTestPage"
    />

    <ConfirmDialog
      :model-value="!!ruleToDelete"
      :title="t('oncall.removeRuleTitle')"
      :message="t('oncall.removeRuleMessage')"
      @update:ok="deleteRule"
      @update:cancel="ruleToDelete = null"
      @update:model-value="(v: boolean) => { if (!v) ruleToDelete = null; }"
    />

    <!-- Claiming everything writes one rule per signal, so it is confirmed:
         the undo is deleting each rule individually. -->
    <ConfirmDialog
      :model-value="claimAllOpen"
      :title="t('oncall.unroutedClaimAllTitle')"
      :message="t('oncall.unroutedClaimAllMessage', { count: openSignals.length, team: raw(teamName) })"
      @update:ok="claimAll"
      @update:cancel="claimAllOpen = false"
      @update:model-value="(v: boolean) => { if (!v) claimAllOpen = false; }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallRoutingList from "@/components/oncall/OnCallRoutingList.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import type { SimulatorQuery } from "@/components/oncall/OnCallRoutingSimulator.vue";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import type {
  OnCallSlot,
  OnCallTeam,
  OwnershipRuleStats,
  RoutingConfig,
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
    /** Who holds the pager right now — the list says what "it pages" means. */
    onCallNow?: OnCallSlot[];
    /** This team's ladder, so a rule can say what paging it would run. */
    ladder?: TeamRungSummary[];
  }>(),
  { onCallNow: () => [], ladder: () => [] },
);

const { t } = useI18nTyped();
const store = useStore();

const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string }[]>([]);
const routingConfig = ref<RoutingConfig | null>(null);

const preview = ref<RoutingPreview | null>(null);

const loadingRules = ref(false);
const testing = ref(false);
const sendingTest = ref(false);
const saving = ref(false);
const savingDefault = ref(false);
const claiming = ref(false);
const testerOpen = ref(false);

const claimAllOpen = ref(false);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamName = computed(
  () => props.teams.find((team) => team.id === props.teamId)?.name ?? "",
);

/// What a bulk claim would actually write — dismissed rows are the record, not
/// the worklist, and the confirmation has to count the same set.
const openSignals = computed(() => signals.value.filter((signal) => !signal.dismissed_at));

function failed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  toast({ variant: "error", message: raw(message) || fallback });
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

async function fetchRules() {
  loadingRules.value = true;
  try {
    const res = await oncallService.ownershipStats({
      org_identifier: orgId.value,
      team_id: props.teamId,
    });
    rules.value = res.data?.rules ?? [];
  } catch (err) {
    failed(err, t("oncall.loadRulesFailed"));
  } finally {
    loadingRules.value = false;
  }
}

async function fetchSignals() {
  try {
    const res = await oncallService.unroutedSignals({ org_identifier: orgId.value });
    signals.value = res.data ?? [];
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
  try {
    const res = await oncallService.getRoutingConfig({ org_identifier: orgId.value });
    routingConfig.value = res.data ?? null;
  } catch {
    routingConfig.value = null;
  }
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
      await oncallService.updateOwnershipRule({
        org_identifier: orgId.value,
        rule_id: draft.rule.rule_id,
        data,
      });
    } else {
      await oncallService.createOwnershipRule({ org_identifier: orgId.value, data });
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
    await oncallService.deleteOwnershipRule({
      org_identifier: orgId.value,
      rule_id: rule.rule_id,
    });
    await fetchRules();
  } catch (err) {
    failed(err, t("oncall.deleteRuleFailed"));
  }
}

async function saveDefaultTeam(teamId: string | null) {
  savingDefault.value = true;
  try {
    const res = await oncallService.setRoutingConfig({
      org_identifier: orgId.value,
      data: { default_team_id: teamId },
    });
    routingConfig.value = res.data ?? null;
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
    // `attempts`, not `recipients` — the latter never existed on the wire, so
    // this counted `undefined` and called a delivered page "Nobody".
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
      await oncallService.createOwnershipRule({
        org_identifier: orgId.value,
        data: { team_id: props.teamId, dimensions: routableDimensions(signal) },
      });
      claimed += 1;
    } catch {
      // One path already covered should not abandon the rest of the queue.
    }
  }
  claiming.value = false;
  toast({
    variant: claimed ? "success" : "error",
    message: claimed
      ? t("oncall.unroutedClaimed", { count: claimed })
      : t("oncall.saveRuleFailed"),
  });
  await Promise.all([fetchRules(), fetchSignals()]);
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

onMounted(() => {
  fetchRules();
  fetchSignals();
  fetchAliases();
  fetchRoutingConfig();
});
</script>
