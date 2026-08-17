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
  <div
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
import oncallService from "@/services/oncall";
import type { RoutingConfig } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ teams?: { id: string; name: string }[] }>(),
  { teams: () => [] },
);

const { t } = useI18nTyped();
const store = useStore();

const orgId = computed(() => store.state.selectedOrganization.identifier);

const routingConfig = ref<RoutingConfig | null>(null);
/// `""` means "none" in the picker; the wire value is null. One vocabulary
/// per layer, converted at the save.
const draftDefaultTeam = ref("");
const savingDefault = ref(false);

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
