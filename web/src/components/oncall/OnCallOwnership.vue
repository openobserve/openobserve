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

<!-- A team's Routing tab: the org's rule list filtered to this team. Routing itself is org-level. -->
<template>
  <div class="flex flex-col gap-4" data-test="oncall-ownership">
    <span class="flex flex-wrap items-center gap-x-2 gap-y-2" data-test="oncall-ownership-header">
      <span class="flex min-w-0 flex-1 items-center gap-1">
        <OText variant="card-title" data-test="oncall-ownership-title">
          {{ t("oncall.teamRoutingTitle", { team: raw(teamName) }) }}
        </OText>
        <OTooltip side="bottom" :content="t('oncall.routingPrecedence')">
          <OIcon
            name="info-outline"
            size="sm"
            tabindex="0"
            :label="t('oncall.routingPrecedence')"
            class="text-text-secondary cursor-help"
            data-test="oncall-ownership-precedence"
          />
        </OTooltip>
      </span>
      <OButton
        v-if="canConfigure"
        variant="primary"
        size="sm"
        icon-left="add"
        data-test="oncall-ownership-add-rule"
        @click="openAdd"
      >
        {{ t("oncall.newRule") }}
      </OButton>
    </span>

    <OnCallOwnershipRules
      :rules="rules"
      :teams="teams"
      :aliases="aliases"
      :services="services"
      :team-id="teamId"
      :default-team-id="routingConfig?.default_team_id ?? null"
      :loading="loadingRules"
      :editable="canConfigure"
      testable
      @add="openAdd"
      @edit="openEdit"
      @test="(rule: OwnershipRuleStats) => tester.openTester(rule.dimensions)"
      @remove="(rule: OwnershipRuleStats) => (ruleToDelete = rule)"
      @change-default="goToRouting()"
    />

    <OButton
      v-if="openSignals.length"
      variant="ghost-primary"
      size="sm"
      icon-left="alt-route"
      class="self-start"
      data-test="oncall-ownership-unclaimed"
      @click="goToRouting('signals')"
    >
      {{ t("oncall.teamRoutingUnclaimed", { count: openSignals.length }, openSignals.length) }}
    </OButton>

    <ODrawer
      :open="tester.open.value"
      size="lg"
      :title="t('oncall.routingTestRouting')"
      data-test="oncall-ownership-tester-drawer"
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
        @license-denied="emit('licenseDenied', $event)"
      />
    </ODrawer>

    <OnCallRuleEditor
      :open="editorOpen"
      :rule="editingRule"
      :team-id="teamId"
      :teams="teams"
      :aliases="aliases"
      :catalogue="catalogue"
      :services="services"
      :signals="openSignals"
      :rules="rules"
      :conflict="conflict"
      :saving="saving"
      @update:open="(v: boolean) => (editorOpen = v)"
      @save="saveRule"
      @preview="previewConflict"
      @license-denied="emit('licenseDenied', $event)"
    />

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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallOwnershipRules from "@/components/oncall/OnCallOwnershipRules.vue";
import OnCallRoutingSimulator from "@/components/oncall/OnCallRoutingSimulator.vue";
import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  dimensionAnalyticsQuery,
  semanticGroupsQuery,
  servicesListQuery,
} from "@/services/service_streams.queries";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallRoutingConfig } from "@/composables/useOnCallRoutingConfig";
import { useOnCallRoutingTester } from "@/composables/useOnCallRoutingTester";
import oncallService from "@/services/oncall";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import {
  createOwnershipRuleMutation,
  deleteOwnershipRuleMutation,
  ownershipStatsQuery,
  unroutedSignalsQuery,
  updateOwnershipRuleMutation,
} from "@/services/oncall.queries";
import type {
  DimensionCatalogue,
  DiscoveredService,
  OnCallTeam,
  OwnershipRuleStats,
  RoutingPreview,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import { SERVICE_DIMENSION, readableConditions } from "@/utils/oncall";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { displayFieldsOf } from "@/types/serviceRef";

const props = defineProps<{
  teamId: string;
  teams: OnCallTeam[];
}>();

const emit = defineEmits<{
  /** How many rules route to this team, so the page header counts the same list. */
  (e: "rules-loaded", count: number): void;
  (e: "licenseDenied", features: string[]): void;
}>();

/// True when the license refused the read, so the page's lock says it and no toast has to.
function noteDenial(err: unknown): boolean {
  const denied = licenseDeniedFeatures(err);
  if (denied) emit("licenseDenied", denied);
  return !!denied;
}

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { canConfigure } = useOnCallPermissions();
const { locked: correlationLocked } = useLicenseLock("correlation");

const rules = ref<OwnershipRuleStats[]>([]);
const signals = ref<UnroutedSignal[]>([]);
const aliases = ref<{ id: string; display?: string }[]>([]);
const catalogue = ref<DimensionCatalogue>({ present: [], values: {} });
const discovered = ref<DiscoveredService[]>([]);
const conflict = ref<RoutingPreview | null>(null);
const { config: routingConfig, load: loadRoutingConfig } = useOnCallRoutingConfig();

const loadingRules = ref(false);
const saving = ref(false);
const editorOpen = ref(false);
const editingRule = ref<OwnershipRuleStats | null>(null);
const ruleToDelete = ref<OwnershipRuleStats | null>(null);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const teamName = computed(() => props.teams.find((team) => team.id === props.teamId)?.name ?? "");

const openSignals = computed(() => signals.value.filter((signal) => !signal.dismissed_at));

/// Discovery's services plus the ones this team's rules already name, which discovery may never have seen.
const services = computed<DiscoveredService[]>(() => {
  const known = new Set(discovered.value.map((one) => one.name));
  const fromRules = [
    ...new Set(
      rules.value
        .filter((rule) => rule.team_id === props.teamId)
        .map((rule) => rule.dimensions?.[SERVICE_DIMENSION])
        .filter((name): name is string => !!name && !name.endsWith("*")),
    ),
  ]
    .filter((name) => !known.has(name))
    .map((name) => ({ name, setId: "default", identity: {} }));
  return [...discovered.value, ...fromRules];
});

const ruleCreate = useMutation(() => createOwnershipRuleMutation(orgId.value));
const ruleUpdate = useMutation(() => updateOwnershipRuleMutation(orgId.value));
const ruleDelete = useMutation(() => deleteOwnershipRuleMutation(orgId.value));

function writeFailed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  toast({
    variant: "error",
    message: message
      ? t("oncall.toastFailedReason", { action: fallback, reason: raw(message) })
      : fallback,
  });
}

function failed(err: unknown, fallback: Parameters<typeof toast>[0]["message"]) {
  if (!noteDenial(err)) writeFailed(err, fallback);
}

const tester = useOnCallRoutingTester({
  orgId,
  signals: openSignals,
  onError: failed,
  onSendError: writeFailed,
});

function readable(dimensions: Record<string, string>): string {
  return readableConditions(dimensions, aliases.value, {
    and: String(t("oncall.ruleEditorAnd")),
    startsWith: (field) => String(t("oncall.ruleChipStartsWith", { field: raw(field) })),
  });
}

function goToRouting(tab?: "signals") {
  router.push({
    name: "onCallRouting",
    query: { org_identifier: orgId.value, ...(tab ? { tab } : {}) },
  });
}

function openAdd() {
  editingRule.value = null;
  editorOpen.value = true;
}

function openEdit(rule: OwnershipRuleStats) {
  editingRule.value = rule;
  editorOpen.value = true;
}

async function fetchAliases() {
  try {
    aliases.value = (await queryClient.fetchQuery(semanticGroupsQuery(orgId.value))) ?? [];
  } catch {
    aliases.value = [];
  }
}

async function fetchServices() {
  try {
    const rows = await queryClient.fetchQuery(servicesListQuery(orgId.value));
    // A record filed under its stream's name is ignored by routing, so offering it would claim nothing.
    const seen = new Map<string, DiscoveredService>();
    for (const row of rows) {
      const name = String(row.service_name ?? "");
      if (!name || row.named_after_stream === true || seen.has(name)) continue;
      seen.set(name, { name, setId: "default", identity: {}, ...displayFieldsOf(row) });
    }
    discovered.value = [...seen.values()];
  } catch {
    discovered.value = [];
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
    catalogue.value = { present: [], values: {} };
  }
}

let conflictRun = 0;

/// Never surfaces an error: a missing outcome line must not stop somebody writing a rule.
async function previewConflict(dimensions: Record<string, string>) {
  const run = ++conflictRun;
  if (!Object.keys(dimensions).length) {
    conflict.value = null;
    return;
  }
  try {
    const res = await oncallService.previewRouting({
      org_identifier: orgId.value,
      data: { dimensions },
    });
    if (run === conflictRun) conflict.value = res.data ?? null;
  } catch (err) {
    noteDenial(err);
    if (run === conflictRun) conflict.value = null;
  }
}

async function fetchRules() {
  loadingRules.value = true;
  try {
    // The org's whole list, so this tab numbers its rules by their place in the org's order.
    const stats = await queryClient.fetchQuery(ownershipStatsQuery(orgId.value));
    rules.value = stats?.rules ?? [];
    emit("rules-loaded", rules.value.filter((rule) => rule.team_id === props.teamId).length);
  } catch (err) {
    failed(err, t("oncall.loadRulesFailed"));
  } finally {
    loadingRules.value = false;
  }
}

async function fetchSignals() {
  try {
    signals.value = (await queryClient.fetchQuery(unroutedSignalsQuery(orgId.value))) ?? [];
  } catch (err) {
    noteDenial(err);
    signals.value = [];
  }
}

async function saveRule(draft: RuleDraft) {
  saving.value = true;
  const data = { team_id: draft.team_id || props.teamId, dimensions: draft.dimensions };
  const rule = editingRule.value;
  try {
    if (rule) {
      await ruleUpdate.mutateAsync({ ruleId: rule.rule_id, data });
    } else {
      await ruleCreate.mutateAsync(data);
    }
    editorOpen.value = false;
    editingRule.value = null;
    toast({
      variant: "success",
      message: t(rule ? "oncall.toastRuleUpdated" : "oncall.toastRuleCreated", {
        name: raw(readable(draft.dimensions)),
      }),
    });
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    writeFailed(err, t("oncall.saveRuleFailed"));
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
    await Promise.all([fetchRules(), fetchSignals()]);
  } catch (err) {
    writeFailed(err, t("oncall.deleteRuleFailed"));
  }
}

// Correlation reads wait for the org config: on a cold load it lands after mount, and empty reads as unlocked.
let correlationRead = false;
const configLoaded = computed(() => Object.keys(store.state.zoConfig ?? {}).length > 0);
watch(
  [configLoaded, correlationLocked],
  ([loaded, locked]) => {
    if (!loaded || locked || correlationRead) return;
    correlationRead = true;
    fetchCatalogue();
    fetchServices();
  },
  { immediate: true },
);

onMounted(() => {
  fetchRules();
  fetchSignals();
  fetchAliases();
  loadRoutingConfig(orgId.value).then((denied) => denied && emit("licenseDenied", denied));
});
</script>
