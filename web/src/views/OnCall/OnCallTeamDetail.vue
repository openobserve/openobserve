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
    constrained
    data-test="oncall-team-detail-page"
    :title="team ? raw(team.name) : t('oncall.teamDetail')"
    :subtitle="team ? raw(team.timezone) : undefined"
    icon="group-work"
    :back="{ label: t('oncall.backToTeams'), to: { name: 'onCallTeams' } }"
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="oncall-team-detail-edit-btn"
        @click="editOpen = true"
      >
        {{ t("oncall.editTeam") }}
      </OButton>
    </template>

    <div class="flex flex-col gap-4">
      <!-- Answer-first: who would be paged right now, before any editing UI. -->
      <OCard data-test="oncall-team-detail-oncall-now">
        <OCardSection>
          <h2 class="text-text-heading mb-3 text-lg">{{ t("oncall.onCallNow") }}</h2>
          <!-- One line per rotation: who has it now, and who it hands over
               to. That second name is what a "secondary" is, and it needs no
               rotation of its own to staff. -->
          <div v-if="onCallNow.length" class="flex flex-wrap gap-2">
            <div
              v-for="slot in onCallNow"
              :key="slot.rotation"
              class="border-border-default flex items-center gap-2 rounded-default border px-3 py-2"
              :data-test="`oncall-slot-${slot.rotation}`"
            >
              <OTag variant="default-soft" size="sm">{{ raw(slot.rotation) }}</OTag>
              <span class="text-text-body text-sm">{{ raw(slot.user_email) }}</span>
              <span v-if="slot.next_user_email" class="text-text-muted text-xs">
                {{ t("oncall.thenHandsTo", { name: slot.next_user_email }) }}
              </span>
            </div>
          </div>

          <!-- The only coverage question left. There are no longer six slots
               to leave empty and warn about forever. -->
          <div v-else class="flex flex-wrap items-center gap-2">
            <OIcon name="warning" size="sm" class="text-icon-chip-warning-text" />
            <span class="text-text-body text-sm" data-test="oncall-team-unstaffed">
              {{ t("oncall.nobodyOnCall") }}
            </span>
          </div>
        </OCardSection>
      </OCard>

      <OTabs v-model="activeTab" class="border-border-default border-b">
        <OTab name="members" data-test="oncall-team-tab-members">
          {{ t("oncall.members") }}
        </OTab>
        <OTab name="schedule" data-test="oncall-team-tab-schedule">
          {{ t("oncall.schedule") }}
        </OTab>
        <OTab name="policy" data-test="oncall-team-tab-policy">
          {{ t("oncall.policy") }}
        </OTab>
        <OTab name="ownership" data-test="oncall-team-tab-ownership">
          {{ t("oncall.ownership") }}
        </OTab>
      </OTabs>

      <OnCallMembers
        v-if="activeTab === 'members'"
        :team-id="teamId"
        :members="members"
        @changed="fetchAll"
      />
      <OnCallScheduleEditor
        v-else-if="activeTab === 'schedule'"
        :team-id="teamId"
        :timezone="team?.timezone ?? 'UTC'"
        :schedule="schedule"
        :members="members"
        @saved="fetchAll"
      />
      <OnCallPolicyEditor
        v-else-if="activeTab === 'policy'"
        :team-id="teamId"
        :policy="policy"
        @saved="fetchAll"
      />
      <OnCallOwnership v-else :team-id="teamId" :teams="teams" />
    </div>

    <OnCallTeamForm v-model:open="editOpen" :team="team" @saved="onTeamSaved" />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import oncallService from "@/services/oncall";
import type {
  OnCallPolicy,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
  OnCallTeamMember,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();

const team = ref<OnCallTeam | null>(null);
const members = ref<OnCallTeamMember[]>([]);
const schedule = ref<OnCallSchedule | null>(null);
const policy = ref<OnCallPolicy | null>(null);
const onCallNow = ref<OnCallSlot[]>([]);
// The routing tester can resolve to ANY team, so the whole list is needed to
// name the winner rather than showing a bare id.
const teams = ref<OnCallTeam[]>([]);
const activeTab = ref("members");
const editOpen = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const teamId = computed(() => String(route.params.teamId ?? ""));

async function fetchAll() {
  const org_identifier = orgId.value;
  const team_id = teamId.value;
  try {
    const [teamRes, memberRes, scheduleRes, policyRes, onCallRes, teamsRes] =
      await Promise.all([
        oncallService.getTeam({ org_identifier, team_id }),
        oncallService.listMembers({ org_identifier, team_id }),
        oncallService.getSchedule({ org_identifier, team_id }),
        oncallService.getPolicy({ org_identifier, team_id }),
        oncallService.whoIsOnCall({ org_identifier, team_id }),
        oncallService.listTeams({ org_identifier }),
      ]);
    team.value = teamRes.data;
    teams.value = teamsRes.data ?? [];
    members.value = memberRes.data ?? [];
    schedule.value = scheduleRes.data ?? null;
    policy.value = policyRes.data;
    onCallNow.value = onCallRes.data ?? [];
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadTeamFailed"),
    });
  }
}

function onTeamSaved() {
  editOpen.value = false;
  fetchAll();
}

onMounted(fetchAll);
</script>
