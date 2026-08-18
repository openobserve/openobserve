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
  Tier 4 of routing: the explicitly nominated catch-all. Nothing is
  auto-created — a fresh org has none — so the unset state is the warning,
  sitting directly above the queue it would drain.

  Self-contained on purpose: the card owns its config round-trip so the team
  tab and the org routing screen render the same fact from the same fetch,
  not two copies that can disagree.
-->
<template>
  <!-- Nominating a catch-all is a one-time act, but "is there one" is a fact
       the screen must carry at all times — so in dialog mode the trigger
       itself names the current answer. -->
  <template v-if="dialog">
    <OButton
      :variant="defaultTeamId ? 'outline' : 'warning'"
      size="sm-action"
      data-test="oncall-default-team-open"
      @click="openDialog"
    >
      {{ triggerLabel }}
    </OButton>

    <ODialog
      :open="open"
      size="sm"
      :title="t('oncall.routingCatchAllTitle')"
      :primary-button-label="t('oncall.save')"
      :secondary-button-label="t('oncall.cancel')"
      :primary-button-disabled="!defaultTeamDirty"
      :primary-button-loading="savingDefault"
      data-test="oncall-default-team-dialog"
      @update:open="(v: boolean) => (open = v)"
      @click:primary="saveDefaultTeam"
      @click:secondary="open = false"
    >
      <div class="flex flex-col gap-3">
        <!-- ODialog's sub-title is one truncating line; a sentence belongs in
             the body, where it wraps. -->
        <OText variant="meta">{{ t("oncall.defaultTeamHint") }}</OText>
        <p
          v-if="routingConfig && !routingConfig.default_team_id"
          class="text-status-warning-text text-sm"
          data-test="oncall-default-team-unset"
        >
          {{ t("oncall.defaultTeamUnset") }}
        </p>
        <OSelect
          :model-value="draftDefaultTeam"
          :options="defaultTeamOptions"
          :placeholder="t('oncall.defaultTeamPlaceholder')"
          data-test="oncall-default-team-select"
          @update:model-value="(v: unknown) => (draftDefaultTeam = String(v))"
        />
      </div>
    </ODialog>
  </template>

  <div
    v-else
    class="border-border-default rounded-surface flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-default-team-card"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.defaultTeamTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.defaultTeamHint") }}</OText>
    </span>

    <p
      v-if="routingConfig && !routingConfig.default_team_id"
      class="text-status-warning-text text-sm"
      data-test="oncall-default-team-unset"
    >
      {{ t("oncall.defaultTeamUnset") }}
    </p>

    <span class="flex flex-wrap items-center gap-2">
      <span class="w-64">
        <OSelect
          :model-value="draftDefaultTeam"
          :options="defaultTeamOptions"
          :placeholder="t('oncall.defaultTeamPlaceholder')"
          data-test="oncall-default-team-select"
          @update:model-value="(v: unknown) => (draftDefaultTeam = String(v))"
        />
      </span>
      <OButton
        variant="primary"
        size="sm-action"
        :loading="savingDefault"
        :disabled="!defaultTeamDirty"
        data-test="oncall-default-team-save"
        @click="saveDefaultTeam"
      >
        {{ t("oncall.save") }}
      </OButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import oncallService from "@/services/oncall";
import type { RoutingConfig } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    teams?: { id: string; name: string }[];
    /** Render as a header button that opens the picker in a modal, instead of
     *  a card the page has to make room for. */
    dialog?: boolean;
  }>(),
  { teams: () => [], dialog: false },
);

const { t } = useI18nTyped();
const store = useStore();

const orgId = computed(() => store.state.selectedOrganization.identifier);

const routingConfig = ref<RoutingConfig | null>(null);
/// `""` means "none" in the picker; the wire value is null. One vocabulary
/// per layer, converted at the save.
const draftDefaultTeam = ref("");
const savingDefault = ref(false);
const open = ref(false);

const defaultTeamId = computed(() => routingConfig.value?.default_team_id ?? "");

/// The trigger is the readout: which team catches everything, or that nothing
/// does. A renamed or deleted team falls back to the id the wire gave.
const triggerLabel = computed<I18nText>(() => {
  const id = defaultTeamId.value;
  if (!id) return t("oncall.routingSetCatchAll");
  const known = props.teams.find((team) => team.id === id)?.name;
  return t("oncall.routingCatchAllIs", { team: raw(known || id) });
});

/// A cancelled edit must not come back as next time's draft.
function openDialog() {
  draftDefaultTeam.value = defaultTeamId.value;
  open.value = true;
}

const defaultTeamOptions = computed(() => [
  { label: t("oncall.defaultTeamNone"), value: "" },
  ...props.teams.map((team) => ({ label: raw(team.name), value: team.id })),
]);

const defaultTeamDirty = computed(
  () => draftDefaultTeam.value !== (routingConfig.value?.default_team_id ?? ""),
);

/// Always 200 — an org that never nominated answers with nulls. A failure
/// leaves the card unset-looking rather than breaking the screen, and unset is
/// the honest reading of "could not load" here: neither claims a catch-all.
async function fetchRoutingConfig() {
  try {
    const res = await oncallService.getRoutingConfig({ org_identifier: orgId.value });
    routingConfig.value = res.data ?? null;
    draftDefaultTeam.value = res.data?.default_team_id ?? "";
  } catch {
    routingConfig.value = null;
  }
}

async function saveDefaultTeam() {
  savingDefault.value = true;
  try {
    const res = await oncallService.setRoutingConfig({
      org_identifier: orgId.value,
      data: { default_team_id: draftDefaultTeam.value || null },
    });
    routingConfig.value = res.data ?? null;
    draftDefaultTeam.value = res.data?.default_team_id ?? "";
    open.value = false;
    toast({
      variant: "success",
      message: draftDefaultTeam.value
        ? t("oncall.defaultTeamSaved")
        : t("oncall.defaultTeamCleared"),
    });
  } catch (err) {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data
      ?.message;
    toast({ variant: "error", message: raw(message) || t("oncall.defaultTeamSaveFailed") });
  } finally {
    savingDefault.value = false;
  }
}

onMounted(fetchRoutingConfig);
</script>
