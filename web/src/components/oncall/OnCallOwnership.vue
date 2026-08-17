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
  Routing: what reaches this team, what it caught, and what reached nobody.

  The simulator leads because it is the question people arrive with — "would
  this page us?" — and because it is the only thing here that can be answered
  before understanding the rule table underneath it. The rules follow as the
  explanation, and the unrouted queue last as the work the rules do not cover.
-->
<template>
  <div class="flex flex-col gap-5" data-test="oncall-ownership">
    <OnCallRoutingSimulator
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

    <OnCallOwnershipRules
      :rules="rules"
      :aliases="aliases"
      :loading="loadingRules"
      @add="openAdd"
      @edit="openEdit"
      @remove="(rule) => (ruleToDelete = rule)"
    />

    <OnCallDefaultTeamCard :teams="teams" />

    <OnCallUnroutedQueue
      :signals="signals"
      :team-name="teamName"
      :loading="loadingSignals"
      :claiming="claiming"
      @claim="claimSignal"
      @claim-all="claimAllOpen = true"
      @dismiss="dismissSignal"
    />

    <!-- Rules are built pair by pair rather than typed as JSON: the vocabulary
         is a fixed set of alias ids, and free text is how a rule ends up
         matching a dimension nothing ever emits. -->
    <ODialog
      :open="addOpen"
      :title="editingRule ? t('oncall.editOwnershipRule') : t('oncall.addOwnershipRule')"
      :primary-label="t('oncall.saveRule')"
      :secondary-label="t('oncall.cancel')"
      :primary-disabled="!draftPairs.length"
      :primary-loading="saving"
      data-test="oncall-ownership-add-dialog"
      @update:open="(v: boolean) => (addOpen = v)"
      @click:primary="createRule"
      @click:secondary="addOpen = false"
    >
      <div class="flex flex-col gap-4">
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

        <div class="flex flex-wrap items-end gap-2">
          <OSelect
            v-model="draftName"
            :options="dimensionOptions"
            :label="t('oncall.dimensionName')"
            :placeholder="t('oncall.dimensionNamePlaceholder')"
            width="sm"
            searchable
            data-test="oncall-ownership-dimension-name"
          />
          <OInput
            v-model="draftValue"
            :label="t('oncall.dimensionValue')"
            :placeholder="t('oncall.dimensionValuePlaceholder')"
            width="sm"
            data-test="oncall-ownership-dimension-value"
          />
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!canAddPair"
            data-test="oncall-ownership-add-dimension"
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
      @update:model-value="(v: boolean) => { if (!v) ruleToDelete = null; }"
    />

    <!-- Claiming everything writes one rule per signal, so it is confirmed:
         the undo is deleting each rule individually. -->
    <ConfirmDialog
      :model-value="claimAllOpen"
      :title="t('oncall.unroutedClaimAllTitle')"
      :message="t('oncall.unroutedClaimAllMessage', { count: signals.length, team: raw(teamName) })"
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
import OnCallDefaultTeamCard from "@/components/oncall/OnCallDefaultTeamCard.vue";
import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import type { SimulatorQuery } from "@/components/oncall/OnCallRoutingSimulator.vue";
import OnCallUnroutedQueue from "@/components/oncall/OnCallUnroutedQueue.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import type {
  OnCallTeam,
  OwnershipRuleStats,
  RoutingPreview,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { identityDimensions } from "@/utils/oncall";
import { normalizeDimensionValue, ownershipPath } from "@/utils/oncall";

const props = defineProps<{ teamId: string; teams: OnCallTeam[] }>();

const { t } = useI18nTyped();
const store = useStore();

const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string }[]>([]);

const preview = ref<RoutingPreview | null>(null);

const loadingRules = ref(false);
const loadingSignals = ref(false);
const testing = ref(false);
const sendingTest = ref(false);
const saving = ref(false);
const claiming = ref(false);

const addOpen = ref(false);
const claimAllOpen = ref(false);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);
const draftPairs = ref<{ name: string; value: string }[]>([]);
const draftName = ref("");
const draftValue = ref("");

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamName = computed(
  () => props.teams.find((team) => team.id === props.teamId)?.name ?? "",
);

const dimensionOptions = computed(() =>
  aliases.value.map((alias) => ({ label: raw(alias.display || alias.id), value: alias.id })),
);

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
  loadingSignals.value = true;
  try {
    const res = await oncallService.unroutedSignals({ org_identifier: orgId.value });
    signals.value = res.data ?? [];
  } catch {
    // Additive: a team with no unrouted traffic and an endpoint that is not
    // there look the same from here, and neither is worth an error toast.
    signals.value = [];
  } finally {
    loadingSignals.value = false;
  }
}

/// There is no update route for a rule, deliberately or not — so an edit is a
/// create followed by a delete, in that order: if the create fails the old
/// rule still stands, and the team never has a window with no rule at all.
const editingRule = ref<OwnershipRuleStats | null>(null);

function openAdd() {
  editingRule.value = null;
  draftPairs.value = [];
  addOpen.value = true;
}

function openEdit(rule: OwnershipRuleStats) {
  editingRule.value = rule;
  draftPairs.value = Object.entries(rule.dimensions ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  addOpen.value = true;
}

async function createRule() {
  saving.value = true;
  try {
    await oncallService.createOwnershipRule({
      org_identifier: orgId.value,
      data: {
        team_id: props.teamId,
        dimensions: Object.fromEntries(draftPairs.value.map((pair) => [pair.name, pair.value])),
      },
    });
    if (editingRule.value) {
      await oncallService.deleteOwnershipRule({
        org_identifier: orgId.value,
        rule_id: editingRule.value.rule_id,
      });
    }
    const edited = !!editingRule.value;
    editingRule.value = null;
    draftPairs.value = [];
    addOpen.value = false;
    toast({ variant: "success", message: edited ? t("oncall.ruleUpdated") : t("oncall.ruleCreated") });
    await fetchRules();
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
    const reached = res.data?.recipients?.length ?? 0;
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
/// Only the org's identity dimensions belong in a rule. A signal arrives
/// carrying everything the alert knew — pod name, node, status code — and a
/// rule written against those matches exactly one pod until it restarts, then
/// nothing, forever. Routable facts route; evidence stays on the signal.
function routableDimensions(signal: UnroutedSignal): Record<string, string> {
  const kept = identityDimensions(signal.dimensions);
  // A signal with no identity dimensions at all still deserves a rule: claim
  // what it carried rather than writing one that matches everything.
  return Object.keys(kept).length ? kept : signal.dimensions;
}

async function claimSignal(signal: UnroutedSignal) {
  claiming.value = true;
  try {
    await oncallService.createOwnershipRule({
      org_identifier: orgId.value,
      data: { team_id: props.teamId, dimensions: routableDimensions(signal) },
    });
    toast({ variant: "success", message: t("oncall.ruleCreated") });
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    failed(err, t("oncall.saveRuleFailed"));
  } finally {
    claiming.value = false;
  }
}

/// Sequential on purpose: the server dedupes rules on the dimension path, and
/// two signals sharing a path would race into a duplicate-key error that reads
/// like the whole operation failed.
async function claimAll() {
  claimAllOpen.value = false;
  claiming.value = true;
  let claimed = 0;
  for (const signal of signals.value) {
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
});
</script>
