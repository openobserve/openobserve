<template>
  <OPageLayout
    bleed
    data-test="oncall-team-detail-page"
    :title="team ? raw(team.name) : t('oncall.teamDetail')"
    :subtitle="subtitle"
    icon="group-work"
    :back="{ label: t('oncall.backToTeams'), to: { name: 'onCallTeams' } }"
  >
    <!-- Whether a page would reach anybody is the team's headline fact, so it
         rides the title instead of sitting in a card below it. -->
    <template #title-trail>
      <OTag
        v-if="loaded"
        type="oncallCoverage"
        :value="onCallNow.length ? 'covered' : 'gap'"
        size="sm"
        data-test="oncall-team-coverage"
      />
    </template>

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

    <OContent y>
      <OStatStrip :items="summaryStats" data-test="oncall-team-stats" />

      <!-- Says what the two names MEAN. "Primary" and "Secondary" are
           positions in one rotation, not two rotations somebody has to staff,
           and the old bar showed a rotation's name where a role belonged. -->
      <div v-if="onCallNow.length" class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div
          v-for="slot in onCallNow"
          :key="slot.rotation"
          class="flex flex-wrap items-center gap-x-4 gap-y-1"
          :data-test="`oncall-slot-${slot.rotation}`"
        >
          <span class="flex items-center gap-2">
            <OTag variant="success-soft" size="sm">{{ t("oncall.rolePrimary") }}</OTag>
            <OUserCell :value="slot.user_email" />
          </span>
          <span v-if="slot.next_user_email" class="flex items-center gap-2">
            <OTag variant="default-soft" size="sm">{{ t("oncall.roleSecondary") }}</OTag>
            <OUserCell :value="slot.next_user_email" />
          </span>
          <span class="text-text-muted text-xs">
            {{ t("oncall.fromRotation", { name: slot.rotation }) }}
          </span>
        </div>
      </div>

    </OContent>

    <OTabs v-model="activeTab" data-test="oncall-team-tabs">
      <OTab name="schedule" :label="t('oncall.schedule')" icon="calendar-month" />
      <OTab name="members" :label="t('oncall.members')" icon="group-work" />
      <OTab name="policy" :label="t('oncall.policy')" icon="arrow-upward" />
      <OTab name="ownership" :label="t('oncall.routing')" icon="account-tree" />
    </OTabs>

    <!-- `scroll` defaults to overflow-hidden, which silently clipped the
         escalation policy so its lower priorities were unreachable. -->
    <OTabPanels v-model="activeTab" grow scroll="y">
      <OTabPanel name="schedule">
        <OnCallScheduleEditor
          :team-id="teamId"
          :timezone="team?.timezone ?? 'UTC'"
          :schedule="schedule"
          :members="members"
          @saved="fetchAll"
        />
      </OTabPanel>

      <OTabPanel name="members">
        <OnCallMembers
          :team-id="teamId"
          :members="members"
          :rotations="schedule?.rotations ?? []"
          :timezone="team?.timezone ?? 'UTC'"
          @changed="fetchAll"
        />
      </OTabPanel>

      <OTabPanel name="policy">
        <OnCallPolicyEditor :team-id="teamId" :policy="policy" @saved="fetchAll" />
      </OTabPanel>

      <OTabPanel name="ownership">
        <OnCallOwnership :team-id="teamId" :teams="teams" />
      </OTabPanel>
    </OTabPanels>

    <OnCallTeamForm v-model:open="editOpen" :team="team" @saved="onTeamSaved" />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";

import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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
const ruleCount = ref(0);
// Where the team actually is in its setup decides the landing tab. A brand
// new team opens on Members, because a schedule with nobody in it is not
// something anybody can act on; once there are people, Schedule leads,
// because that is the question the page exists to answer.
const activeTab = ref("members");
const loaded = ref(false);
const editOpen = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const teamId = computed(() => String(route.params.teamId ?? ""));

const subtitle = computed(() =>
  team.value
    ? t("oncall.teamSubtitle", { tz: team.value.timezone, count: members.value.length })
    : undefined,
);

const rotationCount = computed(() => schedule.value?.rotations?.length ?? 0);

/// A team with no rotation pages nobody, and a team with no routing rule is
/// never reached in the first place. Both are worth a colour before they cost
/// somebody an outage.
const summaryStats = computed<StatItem[]>(() => [
  {
    key: "oncall",
    label: t("oncall.statOnCallNow"),
    value: onCallNow.value.length ? raw(onCallNow.value[0].user_email) : ABSENT,
    icon: "notifications-active",
    tone: onCallNow.value.length ? "success" : "error",
    dataTest: "oncall-team-stat-oncall",
  },
  {
    key: "rotations",
    label: t("oncall.statRotations"),
    value: rotationCount.value,
    icon: "calendar-month",
    tone: rotationCount.value ? "neutral" : "warning",
    dataTest: "oncall-team-stat-rotations",
  },
  {
    key: "members",
    label: t("oncall.members"),
    value: members.value.length,
    icon: "group-work",
    tone: "neutral",
    dataTest: "oncall-team-stat-members",
  },
  {
    key: "rules",
    label: t("oncall.statRoutingRules"),
    value: ruleCount.value,
    icon: "account-tree",
    tone: ruleCount.value ? "neutral" : "warning",
    dataTest: "oncall-team-stat-rules",
  },
]);

const ABSENT = raw("—");

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
    // Only on success, so a failed load never renders a team as uncovered.
    if (!loaded.value) {
      activeTab.value = members.value.length ? "schedule" : "members";
    }
    loaded.value = true;
    await fetchRuleCount();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadTeamFailed"),
    });
  }
}

// The count feeds a warning tile, so a failed lookup leaves it at zero-known
// rather than claiming the team has no routing.
async function fetchRuleCount() {
  try {
    const res = await oncallService.listOwnershipRules({
      org_identifier: orgId.value,
      team_id: teamId.value,
    });
    ruleCount.value = (res.data ?? []).length;
  } catch {
    ruleCount.value = 0;
  }
}

function onTeamSaved() {
  editOpen.value = false;
  fetchAll();
}

onMounted(fetchAll);
</script>
