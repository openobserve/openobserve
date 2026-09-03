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
  The reader's own on-call: which teams they are on and whether they are holding
  the pager, and what has actually been sent to them.

  This path used to be a STUB that hardcoded "You are not on an on-call team
  yet" without asking the server anything, four centimetres from a banner saying
  the reader was on call — so it was retired to a redirect. It is a page again
  because two endpoints exist that only make sense here: `GET /oncall/my/teams`
  answers duty in one request instead of one per team, and
  `GET /oncall/my/deliveries` is the only thing in the product that answers "did
  my phone actually ring", which no per-team screen can ask.

  The triage list still owns "what needs somebody" — this page links to it
  narrowed rather than rendering a second copy of it.
-->
<template>
  <!-- Reached from the On-Call header, same as Teams and Routing, and with the
       same single rail entry behind it. -->
  <OPageLayout
    bleed
    data-test="oncall-mine-page"
    :title="t('oncall.mineTitle')"
    :subtitle="t('oncall.mineSubtitle')"
    icon="person"
    :back="{
      label: t('oncall.backToResponses'),
      to: { name: 'onCallResponses', query: { org_identifier: orgId } },
      dataTest: 'oncall-mine-back-btn',
    }"
    scroll
  >
    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="notifications-active"
        data-test="oncall-mine-open-pages"
        @click="openMyPages"
      >
        {{ t("oncall.mineOpenPages") }}
      </OButton>
    </template>

    <!-- §G.8.1: the entry fetch is the capability probe. 404 (feature off) and
         403 "Not Supported" (OSS build) both mean on-call is not available
         here — a fact, not a failure. -->
    <OEmptyState
      v-if="unavailable"
      size="hero"
      icon="cloud-off"
      :title="t('oncall.notAvailableTitle')"
      :description="t('oncall.notAvailableDescription')"
      data-test="oncall-mine-unavailable"
    />

    <OContent v-else y class="flex flex-col gap-5">
      <!-- Duty first, because it is the fact that decides whether the rest of
           this page is urgent. -->
      <div
        class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
        data-test="oncall-mine-teams"
      >
        <span class="flex flex-wrap items-center gap-2">
          <OText variant="panel-title">{{ t("oncall.mineTeamsTitle") }}</OText>
          <OTag
            v-if="mine?.on_call_now"
            variant="success-soft"
            size="sm"
            data-test="oncall-mine-on-call"
          >
            {{ t("oncall.mineOnCallNow") }}
          </OTag>
        </span>

        <div
          v-for="team in mine?.teams ?? []"
          :key="team.team_id"
          class="flex flex-wrap items-center gap-2"
          :data-test="`oncall-mine-team-${team.team_id}`"
        >
          <OButton
            variant="ghost-primary"
            size="xs"
            :data-test="`oncall-mine-open-team-${team.team_id}`"
            @click="openTeam(team.team_id)"
          >
            {{ raw(team.team_name) }}
          </OButton>

          <!-- Three states, not two. `null` with `schedule_resolved: false`
               means the schedule could not be resolved, and saying "off duty"
               there is the one answer this must never give: telling somebody
               they are not on call when the truth is we could not work it out. -->
          <OTag
            v-if="team.on_call_now === true"
            variant="success-soft"
            size="xs"
            :data-test="`oncall-mine-duty-${team.team_id}`"
          >
            {{ t("oncall.mineDutyOn") }}
          </OTag>
          <OTag
            v-else-if="team.on_call_now === false"
            variant="default-soft"
            size="xs"
            :data-test="`oncall-mine-duty-${team.team_id}`"
          >
            {{ t("oncall.mineDutyOff") }}
          </OTag>
          <OTag
            v-else
            variant="amber-soft"
            size="xs"
            :data-test="`oncall-mine-duty-${team.team_id}`"
          >
            {{ t("oncall.mineDutyUnknown") }}
          </OTag>

          <!-- Who IS holding it, when that is not the reader. The question
               after "am I on call" is almost always "then who is". -->
          <OText v-if="team.on_call.length" variant="meta">
            {{ t("oncall.mineHeldBy", { who: raw(team.on_call.join(", ")) }) }}
          </OText>
        </div>

        <OText
          v-if="loaded && !(mine?.teams ?? []).length"
          variant="meta"
          data-test="oncall-mine-no-teams"
        >
          {{ t("oncall.mineNoTeams") }}
        </OText>
      </div>

      <OnCallMyDeliveries :team-names="teamNames" />
    </OContent>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OnCallMyDeliveries from "@/components/oncall/OnCallMyDeliveries.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OText from "@/lib/core/Typography/OText.vue";
import oncallService from "@/services/oncall";
import type { MyOnCall } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { isOnCallUnavailable } from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const mine = ref<MyOnCall | null>(null);
const loaded = ref(false);
const unavailable = ref(false);

const teamNames = computed(() =>
  Object.fromEntries((mine.value?.teams ?? []).map((team) => [team.team_id, team.team_name])),
);

/// One request for every team the reader is on and whether they hold the pager
/// for it. The triage list derives a narrower version of this from one
/// `/on-call` call per team, which is the right trade there — it needs the
/// rotation name and the handover instant, which this does not carry.
async function fetchMine() {
  try {
    const res = await oncallService.myOnCall({ org_identifier: orgId.value });
    mine.value = res.data ?? null;
  } catch (err) {
    if (isOnCallUnavailable(err)) unavailable.value = true;
    mine.value = null;
  } finally {
    loaded.value = true;
  }
}

function openMyPages() {
  router.push({
    name: "onCallResponses",
    query: { org_identifier: orgId.value, mine: "1" },
  });
}

function openTeam(teamId: string) {
  router.push({
    name: "onCallTeamDetail",
    params: { teamId },
    query: { org_identifier: orgId.value },
  });
}

onMounted(fetchMine);
</script>
