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
        :value="coverageState"
        size="sm"
        data-test="oncall-team-coverage"
      />
      <!-- The server's own count. It is computed, never stored, so it cannot
           disagree with the configuration it describes. -->
      <OTag
        v-if="configRiskCount"
        variant="amber-soft"
        size="sm"
        data-test="oncall-team-config-risks"
      >
        {{ t("oncall.riskConfigCount", { count: configRiskCount }, configRiskCount) }}
      </OTag>
    </template>

    <template #actions>
      <!-- A cover is a shift handed to a person, so it needs a roster to hand
           it to: on a team with nobody in it this would open on an empty
           picker, which is a dead end rather than an action. -->
      <OButton
        v-if="members.length"
        variant="outline"
        size="sm-action"
        data-test="oncall-team-override-btn"
        @click="openTakeOverride"
      >
        {{ t("oncall.takeOverride") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="oncall-team-detail-edit-btn"
        @click="editOpen = true"
      >
        {{ t("oncall.editTeam") }}
      </OButton>
    </template>

    <!-- A failed load must not fall through to the page below: with nothing
         fetched it renders a team with no members, no schedule and no policy —
         the exact look of a team somebody forgot to configure. -->
    <OContent v-if="oncallUnavailable" y>
      <OEmptyState
        size="hero"
        icon="cloud-off"
        :title="t('oncall.notAvailableTitle')"
        :description="t('oncall.notAvailableDescription')"
        data-test="oncall-team-detail-not-available"
      />
    </OContent>

    <OContent v-else-if="loadError" y>
      <OEmptyState
        size="hero"
        variant="error"
        illustration="broken-panel"
        :title="t('oncall.loadTeamFailed')"
        :description="raw(loadError)"
        :action-label="t('oncall.retry')"
        data-test="oncall-team-detail-error"
        @action="fetchAll"
      />
    </OContent>

    <template v-else>
      <!-- What a page fired right now would do, end to end: who it wakes, in
           what order, when the pager changes hands, and how the week went. The
           tabs below are where you go to CHANGE any of it. One inset and one
           gap: the two strips are peers, not two hand-picked pads. -->
      <OContent y class="flex flex-col gap-3">
        <OnCallTeamPulse
          :preview="firesNowPreview"
          :loading="previewLoading"
          :slots="onCallNow"
          :schedule="schedule"
          :overview="overview"
          :timezone="team?.timezone ?? 'UTC'"
          @edit-ladder="activeTab = 'policy'"
          @open-schedule="activeTab = 'schedule'"
          @open-pages="openOnCallList"
        />

        <OnCallTeamAttention
          :risks="configRisks"
          :reachability="reachability"
          :overview="overview"
          :checked-at="insightsCheckedAt"
          :has-members="hasMembers"
          @act="onAttentionAct"
          @recheck="fetchInsights"
        />
      </OContent>

      <!-- What the team HAS been doing, then the chain that decides it: when each
           person is on, what happens if nobody answers, what reaches the team at
           all, and finally who the people are. -->
      <OTabs v-model="activeTab" data-test="oncall-team-tabs">
        <OTab
          name="overview"
          :label="t('oncall.teamOverview')"
          icon="format-list-bulleted"
          data-test="oncall-team-tab-overview"
        />
        <OTab
          name="schedule"
          :label="t('oncall.schedule')"
          icon="calendar-month"
          data-test="oncall-team-tab-schedule"
        />
        <!-- Counts via the default slot, which is the documented seam for badges;
             `label` and `icon` are ignored once it is provided. The icon is
             sized the way the `icon` prop sizes it on the two tabs above, so the
             strip carries one glyph size rather than two. -->
        <OTab name="policy" data-test="oncall-team-tab-policy">
          <OIcon name="arrow-upward" size="sm" class="shrink-0" />
          <span>{{ t("oncall.escalationTab") }}</span>
          <!-- Warning whether or not the tab is open: a priority that pages
               nobody is a finding, not a tally of what is on the tab. -->
          <OTag v-if="silentPriorities" type="countChip" value="warning">
            {{ silentPriorities }}
          </OTag>
        </OTab>
        <OTab name="ownership" data-test="oncall-team-tab-ownership">
          <OIcon name="account-tree" size="sm" class="shrink-0" />
          <span>{{ t("oncall.routing") }}</span>
          <OTag
            v-if="ruleCount"
            type="countChip"
            :value="activeTab === 'ownership' ? 'primary' : 'neutral'"
          >
            {{ ruleCount }}
          </OTag>
        </OTab>
        <OTab name="members" data-test="oncall-team-tab-members">
          <OIcon name="group-work" size="sm" class="shrink-0" />
          <span>{{ t("oncall.members") }}</span>
          <OTag
            v-if="memberCount"
            type="countChip"
            :value="activeTab === 'members' ? 'primary' : 'neutral'"
          >
            {{ memberCount }}
          </OTag>
        </OTab>
      </OTabs>

      <!-- `scroll` defaults to overflow-hidden, which silently clipped the
           escalation policy so its lower priorities were unreachable. -->
      <OTabPanels v-model="activeTab" grow scroll="y">
        <OTabPanel name="overview">
          <!-- Two blocks in one column. The demo read as a wall: five sortable
               columns of history beside a rail restating reach and readiness that
               the Escalation and Members tabs already own. What is left is the
               pair of questions this tab exists for — has this team been
               answering, and is anybody there to answer next. -->
          <OContent y class="flex flex-col gap-5">
            <OnCallRecentPages
              :pages="recentPages"
              :policy="policy"
              :window-days="ACTIVITY_WINDOW_DAYS"
              :loading="pagesLoading"
              @open="openPage"
              @view-all="openOnCallList"
            />

            <!-- Gaps are the only thing worth looking at here, so they are the
                 only bands that get an alarming colour. -->
            <div
              class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
              data-test="oncall-team-coverage-card"
            >
              <span class="flex flex-wrap items-baseline gap-x-2">
                <OText variant="panel-title">
                  {{ t("oncall.teamCoverage", { days: COVERAGE_DAYS }) }}
                </OText>
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  class="ms-auto"
                  data-test="oncall-team-open-schedule"
                  @click="activeTab = 'schedule'"
                >
                  {{ t("oncall.openSchedule") }}
                </OButton>
              </span>
              <OnCallCoverageStrip
                :rotations="schedule?.rotations ?? []"
                :timezone="team?.timezone ?? 'UTC'"
                :days="COVERAGE_DAYS"
              />
            </div>
          </OContent>
        </OTabPanel>

        <!-- "1.9x load" is a fact about PEOPLE, and the only thing to be done about
             it — change who is in the rotation — is on this tab. Reachability and
             load are columns of the roster now, not panels beside it: one row per
             person answers can we reach them, what have they carried, when are
             they on next. -->
        <OTabPanel name="members">
          <OnCallMembers
            :team-id="teamId"
            :members="members"
            :rotations="schedule?.rotations ?? []"
            :timezone="team?.timezone ?? 'UTC'"
            :on-call-now="onCallNow"
            :reachability="reachability"
            :load="teamLoad"
            :testing="testingPage"
            @changed="fetchAll"
            @open-schedule="activeTab = 'schedule'"
            @test-page="sendTestPage"
          />
        </OTabPanel>

        <!-- What the schedule WILL do, then the rotations that decide it, then
             the editor. Reading before editing: the timeline is resolved by the
             engine, so it answers "is this right" in a way the draft cannot. -->
        <OTabPanel name="schedule">
          <!-- Only what the chart cannot be acted on for. Who is on, until
               when and who is next are on the lane and on the pulse strip
               above the tabs; restating them here gave the reader two
               renderings to reconcile. -->
          <OnCallScheduleAnswer
            :slots="onCallNow"
            :has-members="hasMembers !== false"
            @assign-secondary="onAssignSecondary"
            @request-swap="openCover"
            @add-people="activeTab = 'members'"
          />

          <OContent y class="flex flex-col gap-5">
            <!-- Every act on a rotation arrives here, and every one of them opens
                 the SAME drawer: a rotation is one form, and which button was
                 pressed only decides what it opens on. -->
            <OnCallScheduleTimeline
              v-model:window="scheduleWindow"
              :rotations="schedule?.rotations ?? []"
              :segments="segments"
              :timezone="team?.timezone ?? 'UTC'"
              :loading="segmentsLoading"
              :can-cover="hasMembers !== false"
              @fill-gap="onFillGap"
              @add="openScheduleEditor({ mode: 'new' })"
              @edit="openScheduleEditor({ mode: 'edit', id: $event })"
              @assign-people="openScheduleEditor({ mode: 'edit', id: $event })"
              @duplicate="openScheduleEditor({ mode: 'duplicate', id: $event })"
              @override="openCover"
              @delete="rotationToDelete = $event"
              @presets="presetsOpen = true"
            />

            <!-- Under the calendar, because a cover is an exception to what
                 the calendar draws — and until now the only trace of one was
                 an "· override" annotation on a cell, with no reason, no whose
                 shift, and no way to take it back. -->
            <OnCallCoverList
              ref="coverListRef"
              :team-id="teamId"
              :timezone="team?.timezone ?? 'UTC'"
              :window="scheduleWindow"
              :slots="teamSlots"
              @changed="fetchSegments"
            />

            <OnCallSchedulePresets
              v-model:open="presetsOpen"
              :team-id="teamId"
              :members="members"
              :timezone="team?.timezone ?? 'UTC'"
              :rotation-count="schedule?.rotations?.length ?? 0"
              @applied="onScheduleSaved"
            />

            <!-- Drawer only: the read view stays underneath. Swapping the tab
                 into a separate editing mode meant "Add rotation" first landed
                 on a page-sized editor with a second button of the same name. -->
            <OnCallScheduleEditor
              drawer-only
              :team-id="teamId"
              :timezone="team?.timezone ?? 'UTC'"
              :schedule="schedule"
              :members="members"
              :intent="scheduleIntent"
              @saved="onScheduleSaved"
              @intent-handled="scheduleIntent = null"
              @open-members="activeTab = 'members'"
            />
          </OContent>
        </OTabPanel>

        <!-- Same shape as Schedule: what the ladder WOULD do, then the editor on
             demand. One rail, full width — the ladder answers who and when, and
             says whether a page would land only where one would not. -->
        <OTabPanel name="policy">
          <OContent y class="flex flex-col gap-5">
            <span class="flex flex-wrap items-baseline gap-x-2">
              <OText variant="panel-title">{{ t("oncall.escalationReadTitle") }}</OText>
              <OButton
                variant="outline"
                size="xs"
                class="ms-auto"
                data-test="oncall-policy-edit"
                @click="editingPolicy = true"
              >
                {{ t("oncall.edit") }}
              </OButton>
            </span>

            <OnCallEscalationLadder
              v-model:selected="selectedPriority"
              :priorities="overview?.rungs ?? []"
              :policy="policy"
              :preview="preview"
              :loading="previewLoading"
              @edit="editingPolicy = true"
            />

            <!-- Same move as the schedule tab: the editor is a drawer, so the
                 ladder stays on screen behind it and the edit is checked
                 against what it is replacing. -->
            <OnCallPolicyEditor
              v-model:open="editingPolicy"
              :priority="selectedPriorityNumber"
              :team-id="teamId"
              :policy="policy"
              :slots="teamSlots"
              @saved="onPolicySaved"
            />
          </OContent>
        </OTabPanel>

        <OTabPanel name="ownership">
          <!-- The ladder rides along so the rule editor can say what paging
               this team would actually run. -->
          <OContent y>
            <OnCallOwnership :team-id="teamId" :teams="teams" :ladder="overview?.rungs ?? []" />
          </OContent>
        </OTabPanel>
      </OTabPanels>
    </template>

    <OnCallTeamForm v-model:open="editOpen" :team="team" @saved="onTeamSaved" />

    <!-- Named in the prompt: a rotation is what puts somebody on call, and two
         rotations in one team routinely differ by one word. -->
    <ConfirmDialog
      :model-value="!!rotationToDelete"
      :title="t('oncall.laneDeleteTitle')"
      :message="t('oncall.laneDeleteMessage', { name: rotationNameToDelete })"
      @update:ok="deleteRotation"
      @update:cancel="rotationToDelete = null"
    />

    <OnCallCoverForm
      v-model:open="coverOpen"
      :members="members"
      :timezone="team?.timezone ?? 'UTC'"
      :team-name="team?.name ?? ''"
      :saving="coverSaving"
      :current-holder="onCallNow[0]?.user_email ?? null"
      :gap="coverGap"
      :default-user="coverDefaultUser"
      :shifts="swappableShifts"
      :slots="teamSlots"
      @save="saveCover"
      @swap="saveSwap"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import OnCallScheduleAnswer from "@/components/oncall/OnCallScheduleAnswer.vue";
import OnCallCoverList from "@/components/oncall/OnCallCoverList.vue";
import OnCallSchedulePresets from "@/components/oncall/OnCallSchedulePresets.vue";
import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import OnCallCoverageStrip from "@/components/oncall/OnCallCoverageStrip.vue";
import OnCallRecentPages from "@/components/oncall/OnCallRecentPages.vue";
import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import OnCallEscalationLadder from "@/components/oncall/OnCallEscalationLadder.vue";
import OnCallTeamAttention from "@/components/oncall/OnCallTeamAttention.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OnCallTeamPulse from "@/components/oncall/OnCallTeamPulse.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import oncallService from "@/services/oncall";
import type {
  OnCallPolicy,
  OnCallResponse,
  OnCallSchedule,
  OnCallSlot,
  OnCallTeam,
  ConfigRisks,
  EscalationPreview,
  OnCallTeamMember,
  TeamOverview,
  ResolvedSegment,
  TeamLoad,
  TeamReachability,
  ScheduleEditorIntent,
} from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, MICROS_PER_DAY, sameSlot, staffedSlots } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone, isOnCallUnavailable, upcomingShifts, winningRotation } from "@/utils/oncall";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

/** The window the activity panel and the recent-pages list describe. */
const ACTIVITY_WINDOW_DAYS = 7;
const ACTIVITY_WINDOW_MICROS = ACTIVITY_WINDOW_DAYS * MICROS_PER_DAY;
/** How far ahead the coverage strip draws. */
const COVERAGE_DAYS = 14;

const team = ref<OnCallTeam | null>(null);
const members = ref<OnCallTeamMember[]>([]);
const schedule = ref<OnCallSchedule | null>(null);
const policy = ref<OnCallPolicy | null>(null);
const onCallNow = ref<OnCallSlot[]>([]);
// The routing tester can resolve to ANY team, so the whole list is needed to
// name the winner rather than showing a bare id.
const teams = ref<OnCallTeam[]>([]);
const responses = ref<OnCallResponse[]>([]);
const pagesLoading = ref(false);
const testingPage = ref(false);
const overview = ref<TeamOverview | null>(null);
const reachability = ref<TeamReachability | null>(null);
const configRisks = ref<ConfigRisks | null>(null);
/// Micros — when the findings last came back, so the banner can say how fresh
/// they are rather than implying they are live.
const insightsCheckedAt = ref<number | null>(null);
const teamLoad = ref<TeamLoad | null>(null);
const segments = ref<ResolvedSegment[]>([]);
const segmentsLoading = ref(false);
/// Read or edit, never both — the editor brings its own calendar and table.

/// What the drawer opens on. One click lands on the rotation the user pointed
/// at — never on a bulk editing mode with its own copy of the page.
const scheduleIntent = ref<ScheduleEditorIntent | null>(null);

function openScheduleEditor(intent: ScheduleEditorIntent) {
  scheduleIntent.value = intent;
}

const coverOpen = ref(false);
/// The Covers panel reads its own endpoint, so a write made anywhere else has
/// to tell it. `ref="coverListRef"` had no variable behind it in `<script
/// setup>`, which binds to nothing in silence: every cover saved from this page
/// landed on the server and left the list under the calendar unchanged.
const coverListRef = ref<{ refresh: () => Promise<void> | void } | null>(null);

/// Both things a written cover invalidates: the calendar, which the server
/// resolves, and the list of covers beneath it. Never one without the other —
/// a band that moves over a list that does not is the same confusion by half.
async function refreshCoverage() {
  await Promise.allSettled([fetchSegments(), coverListRef.value?.refresh() ?? Promise.resolve()]);
}
const presetsOpen = ref(false);
/// The rotation the reader asked to delete, held until they confirm it.
/// The rotation's **id**. The confirm dialog needs its name, which is looked
/// up rather than carried: a name is renameable and two rotations may share
/// one, so it cannot say which row the reader picked.
const rotationToDelete = ref<string | null>(null);
const rotationNameToDelete = computed(() =>
  raw(
    (schedule.value?.rotations ?? []).find((rotation) => rotation.id === rotationToDelete.value)
      ?.name ?? "",
  ),
);
const coverSaving = ref(false);
const coverGap = ref<{ from: number; to: number } | null>(null);
/// Who the cover dialog opens pre-selected on. Empty for every opener that has
/// no opinion about the person.
const coverDefaultUser = ref("");
const editingPolicy = ref(false);
const selectedPriority = ref("P1");
/// The ladder chips are labels ("P3"); the policy's rungs are numbered. The
/// editor opens on whichever ladder the reader was already looking at.
const selectedPriorityNumber = computed(() => Number(selectedPriority.value.slice(1)) || 1);
const preview = ref<EscalationPreview | null>(null);
const previewLoading = ref(false);
/// The dry run the header strip draws. Always the top priority, whatever the
/// Escalation tab happens to be showing: a strip that changed under the reader
/// because they clicked P3 on a tab below it would be answering a different
/// question from the one its heading asks.
const firesNowPreview = ref<EscalationPreview | null>(null);
const HEADER_PRIORITY = 1;
/// Owned by the timeline, which decides the visible range; the fetch follows it.
const scheduleWindow = ref({ from: 0, to: 0 });
const ruleCount = ref(0);
// Where the team actually is in its setup decides the landing tab. A brand
// new team opens on Members, because a schedule with nobody in it is not
// something anybody can act on; once there are people, Schedule leads,
// because that is the question the page exists to answer.
const activeTab = ref("members");
const loaded = ref(false);
const loadError = ref<string | null>(null);
const oncallUnavailable = ref(false);
const editOpen = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const teamId = computed(() => String(route.params.teamId ?? ""));

/// The tabs, in the order they render. Also the route's whitelist — a `:tab`
/// outside this set is ignored rather than left on a panel that does not exist.
const TEAM_TABS = ["overview", "members", "schedule", "policy", "ownership"] as const;

/// What each tab is CALLED, which is what its URL should say.
///
/// `policy` and `ownership` are the names the panels were given before the tabs
/// were renamed to Escalation and Routing, and they are still the internal ids
/// — the attention banner, the setup checklist and the policies list all emit
/// them. So the internal name stays and the URL carries the visible word: a
/// link somebody pastes into a thread should say the same thing as the tab it
/// opens.
const TAB_URL_NAME: Record<string, string> = {
  policy: "escalation",
  ownership: "routing",
};

/// The reverse, plus every name that is its own URL. Old links are still
/// accepted — they are in checklists and Slack threads already, and breaking
/// them to tidy a vocabulary would be a worse trade than carrying two spellings.
const URL_TAB_NAME: Record<string, string> = {
  escalation: "policy",
  routing: "ownership",
};

/// Which tab the URL asked for.
///
/// The setup checklist and the policies list both deep-link here with a `tab`
/// param, and the view was never reading it — the links only appeared to work
/// because the default landing tab happened to be the one they asked for.
const routeTab = computed(() => {
  const asked = String(route.params.tab ?? "");
  const tab = URL_TAB_NAME[asked] ?? asked;
  return (TEAM_TABS as readonly string[]).includes(tab) ? tab : null;
});

/// The counts come from the overview, which counts alert rules routed here in
/// the database. Falls back to what the page already knows when that call has
/// not answered — a header that waits on a second request reads as broken.
/// The server's count when it has answered, otherwise what the page already
/// knows — a header that waits on a second request reads as broken.
const memberCount = computed(() => overview.value?.members ?? members.value.length);

/// `null` until the roster has been read: an empty array on a page still
/// loading would announce "this team has nobody in it" about every team.
const hasMembers = computed<boolean | null>(() => (loaded.value ? members.value.length > 0 : null));

const subtitle = computed(() => {
  if (!team.value) return undefined;
  const rules = overview.value?.alerts_assigned;
  const base = t(
    "oncall.teamSubtitle",
    { tz: team.value.timezone, count: memberCount.value },
    memberCount.value,
  );
  if (rules === undefined) return base;
  return raw(`${base} · ${t("oncall.teamAlertRules", { count: rules }, rules)}`);
});

/// Pages this team was woken by, inside the activity window.
const recentPages = computed(() => {
  const since = Date.now() * 1000 - ACTIVITY_WINDOW_MICROS;
  return responses.value.filter((row) => row.opened_at >= since);
});

function openPage(row: OnCallResponse) {
  router.push({
    name: "onCallResponseDetail",
    params: { responseId: row.id },
    query: { org_identifier: orgId.value },
  });
}

function openOnCallList() {
  router.push({ name: "onCallResponses", query: { org_identifier: orgId.value } });
}

/// The banner already resolved which tab repairs the finding.
function onAttentionAct(tab: string) {
  activeTab.value = tab;
}

async function fetchAll() {
  loadError.value = null;
  const org_identifier = orgId.value;
  const team_id = teamId.value;
  try {
    const [teamRes, memberRes, scheduleRes, policyRes, onCallRes, teamsRes] = await Promise.all([
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
      activeTab.value = routeTab.value ?? (members.value.length ? "overview" : "members");
    }
    loaded.value = true;
    await Promise.allSettled([fetchRuleCount(), fetchPages(), fetchInsights(), fetchPreview()]);
  } catch (err: any) {
    // Entry fetch ONLY: a 404 on a specific team id past this point is a
    // missing record, not a missing feature.
    if (isOnCallUnavailable(err)) {
      oncallUnavailable.value = true;
      return;
    }
    // The state, not a toast. With the load failed the page below renders a
    // team with no members, no schedule and no policy — the exact look of a
    // team somebody forgot to configure, on a screen whose job is to say
    // whether a page would land.
    loadError.value = String(err?.response?.data?.message ?? err?.message ?? "");
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

/// The team's own pages, for the activity panel and the overview list. A
/// failure here costs those two surfaces, never the rest of the page.
/// The three insight calls. Each degrades one panel rather than the page, so
/// they are settled independently and never block the team from rendering.
async function fetchInsights() {
  const org_identifier = orgId.value;
  const team_id = teamId.value;
  const [ov, reach, risks, load] = await Promise.allSettled([
    oncallService.teamOverview({ org_identifier, team_id }),
    oncallService.teamReachability({ org_identifier, team_id }),
    oncallService.teamConfigRisks({ org_identifier, team_id }),
    oncallService.teamLoad({ org_identifier, team_id }),
  ]);
  overview.value = ov.status === "fulfilled" ? (ov.value.data ?? null) : null;
  reachability.value = reach.status === "fulfilled" ? (reach.value.data ?? null) : null;
  configRisks.value = risks.status === "fulfilled" ? (risks.value.data ?? null) : null;
  teamLoad.value = load.status === "fulfilled" ? (load.value.data ?? null) : null;
  insightsCheckedAt.value = Date.now() * 1000;
}

async function fetchPages() {
  pagesLoading.value = true;
  try {
    const res = await oncallService.listResponses({
      org_identifier: orgId.value,
      team_id: teamId.value,
      include_resolved: true,
    });
    responses.value = res.data ?? [];
  } catch {
    responses.value = [];
  } finally {
    pagesLoading.value = false;
  }
}

/// Priorities whose ladder wakes nobody — the count the escalation tab badges.
const silentPriorities = computed(
  () => (overview.value?.rungs ?? []).filter((rung) => !rung.pages_anyone).length,
);

/// Rostered and reachable are two questions, and the chip used to answer only
/// the first — a green `Covered` sat beside a panel reading "no page can be
/// delivered to anyone", which tells the reader the team is fine at the exact
/// moment it is not. Reachability is folded in: if everybody holding the pager
/// right now would fail to receive a page, the team is rostered, not covered.
///
/// Silent when reachability did not load — an unanswered question is not a
/// finding, and inventing one here would be the same lie in the other
/// direction.
const coverageState = computed<"covered" | "gap" | "unreachable">(() => {
  const covered = overview.value?.covered_now ?? onCallNow.value.length > 0;
  if (!covered) return "gap";

  const verdicts = reachability.value?.members ?? [];
  const holders = onCallNow.value
    .map((slot) => slot.user_email?.toLowerCase())
    .filter((email): email is string => !!email);
  const known = holders
    .map((email) => verdicts.find((member) => member.user_email.toLowerCase() === email))
    .filter((member) => !!member);

  // Only when the server actually judged the people on call, and judged every
  // one of them unreachable: one reachable holder means a page still lands.
  if (known.length && known.every((member) => !member.would_a_page_land)) return "unreachable";
  return "covered";
});

/// `total` rather than `risks.length`: the server truncates the list it
/// returns but reports the real count, and a badge that quietly under-reported
/// would be worse than no badge.
const configRiskCount = computed(() => configRisks.value?.total ?? 0);

/// The one honest answer to "would a page actually land": send a real one and
/// report who it reached. `reached_anyone: false` carries the server's own
/// reason, which is rendered verbatim rather than re-worded.
async function sendTestPage() {
  testingPage.value = true;
  try {
    const res = await oncallService.testPage({
      org_identifier: orgId.value,
      team_id: teamId.value,
    });
    const data = res.data;
    // `attempts`, not `recipients` — the latter never existed on the wire.
    const reached = (data?.attempts ?? []).filter((attempt) => attempt.delivered).length;
    if (data?.reached_anyone) {
      toast({
        variant: "success",
        message: t("oncall.testPageSent", { count: reached }, reached),
      });
    } else {
      toast({
        variant: "warning",
        message: t("oncall.testPageNobody", {
          reason: raw(data?.not_sent_because) || t("oncall.wouldPageNobody"),
        }),
      });
    }
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.testPageFailed"),
    });
  } finally {
    testingPage.value = false;
  }
}

/// The engine's own resolution of the visible window. Capped server-side at 31
/// days and 2000 segments, and a 400 there is a message rather than a spinner.
///
/// **One call per rotation**: the endpoint resolves ONE at a time and defaults
/// to the team's primary, so asking once got primary segments only — and the
/// timeline drew every other rotation a lane it could never fill. The data was
/// there the whole time; nothing asked for it.
///
/// A team with no rotations is not asked at all. It answers `[]` rather than
/// one long gap segment, so there is nothing to draw and no call to spend.
async function fetchSegments() {
  const { from, to } = scheduleWindow.value;
  if (!from || !to) return;
  const rotations = schedule.value?.rotations ?? [];
  if (!rotations.length) {
    segments.value = [];
    return;
  }
  segmentsLoading.value = true;
  try {
    const answers = await Promise.all(
      rotations.map((rotation) =>
        oncallService.resolvedSchedule({
          org_identifier: orgId.value,
          team_id: teamId.value,
          from,
          to,
          rotation_id: rotation.id,
        }),
      ),
    );
    // The primary may answer without echoing its own id, so the lane lookup
    // gets one it can match rather than an absent field.
    segments.value = answers.flatMap((res, index) =>
      (res.data ?? []).map((segment) => ({
        ...segment,
        rotation_id: segment.rotation_id || rotations[index].id,
      })),
    );
  } catch (err: any) {
    segments.value = [];
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.timelineLoadFailed"),
    });
  } finally {
    segmentsLoading.value = false;
  }
}

/// The gap the chart offered to fill pre-fills the window, so the common case
/// is choosing a person and pressing save.
/// The pool a secondary rotation staffs. Lower-cased at the comparison, so it
/// does not depend on somebody spelling it the way the ladder does.
const SECONDARY_SLOT = "secondary";

/// "Assign secondary" is one button with two meanings, and the difference is
/// whether the team already has a secondary rotation to put people INTO. Both
/// land on the same drawer, which is the point: the reader asked to staff the
/// secondary, not to learn how this team models one.
function onAssignSecondary() {
  const existing = (schedule.value?.rotations ?? []).find((rotation) =>
    sameSlot(rotation.slot, SECONDARY_SLOT),
  );
  openScheduleEditor(existing ? { mode: "edit", name: existing.name } : { mode: "new" });
}

/// Deleting a rotation is a schedule save with one layer removed — there is no
/// per-rotation endpoint, and inventing one client-side by PUTting a partial
/// schedule would drop every other layer.
///
/// Until this existed a rotation could be created and never removed: the bulk
/// table that carried the only delete control is not rendered in `drawer-only`,
/// which is the mode this tab has always used.
async function deleteRotation() {
  const id = rotationToDelete.value;
  const current = schedule.value;
  rotationToDelete.value = null;
  if (!id || !current) return;

  // Filtered by id, not by name: two rotations may share a name, and deleting
  // "the Secondary" must not take a second one called the same thing with it.
  const name = current.rotations.find((rotation) => rotation.id === id)?.name ?? id;
  const rotations = current.rotations.filter((rotation) => rotation.id !== id);
  try {
    await oncallService.setSchedule({
      org_identifier: orgId.value,
      team_id: teamId.value,
      data: { timezone: current.timezone, rotations },
    });
    toast({ variant: "success", message: t("oncall.laneDeleted", { name: raw(name) }) });
    await onScheduleSaved();
  } catch (err: any) {
    // The server's own sentence: it refuses a save that would leave two
    // rotations equally in force, and which two is the whole story.
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.laneDeleteFailed"),
    });
  }
}

/// Every way into the cover dialog goes through one of these three, because
/// the dialog carries state from whoever opened it — a gap to fill, a person
/// to pre-select — and an opener that sets one without clearing the other
/// offers the last caller's errand to this one.

/// Somebody else covers a window nobody holds: the hole is known, the person
/// is the open question.
function onFillGap(gap: ResolvedSegment) {
  coverGap.value = { from: gap.from, to: gap.to };
  coverDefaultUser.value = "";
  coverOpen.value = true;
}

/// The plain "arrange a cover" entry: neither end is decided.
function openCover() {
  coverGap.value = null;
  coverDefaultUser.value = "";
  coverOpen.value = true;
}

/// The header offers to cover a shift, so the reader is the person being
/// pre-filled — the dialog opens on the answer they came to give. The window is
/// left blank
/// on purpose: "until when" has no safe default, and a cover silently saved
/// over the wrong hours reassigns a night nobody agreed to. The form drops the
/// pre-fill when the reader is not on this team, which is why the picker is
/// still a picker.
function openTakeOverride() {
  coverGap.value = null;
  coverDefaultUser.value = String(store.state.userInfo?.email ?? "");
  coverOpen.value = true;
}

/// The weeks a swap can trade: the next few shifts of the rotation actually in
/// force, resolved the way the engine resolves it. Empty when there is no
/// rotation to trade shifts of, which hides the swap mode rather than offering
/// an empty picker.
const SWAPPABLE_SHIFTS = 8;

/// Resolved **per slot**, because slots do not compete: a two-slot team has a
/// primary and a secondary in force at the same instant. Feeding every
/// rotation to one `winningRotation` picked whichever layer sorted highest —
/// often the secondary — and the swap then offered the secondary's weeks while
/// writing covers that landed on primary, evicting whoever was on call.
/// The slots this team staffs, in the order the schedule lists them. The cover
/// dialog needs it to ask which rotation is being covered — a cover written
/// with no slot lands on the default one whatever the reader had in mind.
///
/// It counts a rotation's DERIVED secondary too, which is the common case: a
/// team the backend auto-staffed has one rotation carrying two slots. Reading
/// only `rotation.slot` left the calendar asking for `?slot=primary` alone and
/// the cover picker hidden, on every team that had never hand-built a second
/// rotation.
const teamSlots = computed(() => staffedSlots(schedule.value?.rotations ?? []));

const swappableShifts = computed(() => {
  const rotations = schedule.value?.rotations ?? [];
  if (!rotations.length) return [];
  const now = Date.now() * 1000;
  const zone = schedule.value?.timezone || team.value?.timezone || "UTC";
  // `rotation.slot` only, deliberately — NOT `staffedSlots`. A swap trades two
  // shifts on a roster, and a DERIVED secondary has no shift sequence of its
  // own: it is the same roster read an offset further along. Offering its
  // "weeks" would write covers against a position the rotation cannot move.
  const slots = [...new Set(rotations.map((r) => r.slot ?? DEFAULT_SLOT))];
  return slots.flatMap((slot) => {
    const inSlot = rotations.filter((r) => sameSlot(r.slot, slot));
    const current = winningRotation(inSlot, now, zone);
    return current ? upcomingShifts(current, now, SWAPPABLE_SHIFTS) : [];
  });
});

/// Two covers, one each way.
///
/// Written in sequence rather than in parallel: if the second is refused — the
/// server 409s when somebody already covers that window — the first has already
/// landed, and a half-done swap is worse than none. It is undone, and the
/// reader is told which of the three things happened rather than being left to
/// re-read the calendar and guess.
type SwapCover = {
  user_email: string;
  start_at: number;
  end_at: number;
  slot?: string;
  covering_for?: string;
};

async function saveSwap(value: { first: SwapCover; second: SwapCover }) {
  coverSaving.value = true;
  let firstId: string | null = null;
  try {
    const created = await oncallService.createOverride({
      org_identifier: orgId.value,
      team_id: teamId.value,
      data: value.first,
    });
    firstId = created.data?.id ?? null;

    await oncallService.createOverride({
      org_identifier: orgId.value,
      team_id: teamId.value,
      data: value.second,
    });

    coverOpen.value = false;
    toast({ variant: "success", message: t("oncall.swapSaved") });
    await refreshCoverage();
  } catch (err: any) {
    const reason = raw(err?.response?.data?.message) || t("oncall.coverSaveFailed");
    // Nothing was written, so the server's own sentence is the whole story.
    if (!firstId) {
      toast({ variant: "error", message: reason });
      return;
    }
    try {
      await oncallService.deleteOverride({
        org_identifier: orgId.value,
        team_id: teamId.value,
        override_id: firstId,
      });
      toast({ variant: "error", message: t("oncall.swapRolledBack", { reason }) });
    } catch {
      // The undo failed too: one cover is live and the other is not. Saying
      // "swap failed" here would describe a schedule that no longer exists.
      toast({ variant: "warning", message: t("oncall.swapHalfDone", { reason }) });
      await refreshCoverage();
    }
  } finally {
    coverSaving.value = false;
  }
}

/// In the TEAM's zone, not the browser's: a cover arranged from another office
/// is still a night on the team's calendar, and that is the night being agreed.
function coverSavedMessage(value: { user_email: string; start_at: number; end_at: number }) {
  const zone = team.value?.timezone ?? "UTC";
  const at = (micros: number) =>
    formatInZone(micros, zone, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return t("oncall.coverSaved", {
    name: raw(value.user_email),
    team: raw(team.value?.name ?? ""),
    range: raw(`${at(value.start_at)} – ${at(value.end_at)}`),
  });
}

/// A cover takes a slot for a window; outside it the rotation resolves exactly
/// as before, which is what makes taking one safe.
async function saveCover(value: {
  user_email: string;
  start_at: number;
  end_at: number;
  slot?: string;
}) {
  coverSaving.value = true;
  try {
    await oncallService.createOverride({
      org_identifier: orgId.value,
      team_id: teamId.value,
      data: value,
    });
    coverOpen.value = false;
    coverGap.value = null;
    // The message is "{name} covers {team} · {range}" and it was called with no
    // params at all, so a successful save reported " covers  · ".
    toast({ variant: "success", message: coverSavedMessage(value) });
    await refreshCoverage();
  } catch (err: any) {
    // A 409 is the server saying somebody already covers that window — worth
    // the reader seeing verbatim, since it names them.
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.coverSaveFailed"),
    });
  } finally {
    coverSaving.value = false;
  }
}

/// Back to the resolved view on save: the point of saving is to see what the
/// engine now says, not to keep staring at the form.
/// The dry run for whichever priority is selected. Re-asked on every change,
/// because the answer depends on who is on call at THIS instant.
async function loadPreview(priority: number): Promise<EscalationPreview | null> {
  try {
    const res = await oncallService.escalationPreview({
      org_identifier: orgId.value,
      team_id: teamId.value,
      priority,
    });
    return res.data ?? null;
  } catch {
    // One priority failing must not blank the strip that lets you pick another.
    return null;
  }
}

async function fetchPreview() {
  const priority = Number(selectedPriority.value.replace(/\D/g, "")) || 1;
  previewLoading.value = true;
  preview.value = await loadPreview(priority);
  // One request feeding both surfaces while the tab is on the priority the
  // header draws, which is where every reader starts.
  if (priority === HEADER_PRIORITY) firesNowPreview.value = preview.value;
  previewLoading.value = false;
}

/// Back to the dry run on save — seeing whether the change actually reaches
/// anybody is the reason to have made it. The editor edits ONE priority, so a
/// save made from P3 leaves the header holding an answer from before it.
async function onPolicySaved() {
  editingPolicy.value = false;
  await fetchAll();
  if (selectedPriorityNumber.value !== HEADER_PRIORITY) {
    firesNowPreview.value = await loadPreview(HEADER_PRIORITY);
  }
}

async function onScheduleSaved() {
  await fetchAll();
  await fetchSegments();
}

function onTeamSaved() {
  editOpen.value = false;
  fetchAll();
}

// The timeline owns its window; refetch whenever it moves.
/// The URL follows the tab.
///
/// The route has always carried `:tab`, and the view has always read it — but
/// nothing ever WROTE it, so clicking Escalation and copying the address bar
/// sent somebody to whichever tab this team happens to land on. Half a deep
/// link is worse than none: it looks like it worked.
///
/// `replace`, not `push`: Back should leave the team, not walk the five tabs
/// somebody clicked through on the way.
watch(activeTab, (tab) => {
  // Not while the first fetch is still deciding where to land — that would
  // rewrite the URL somebody just typed.
  if (!loaded.value) return;
  const name = TAB_URL_NAME[tab] ?? tab;
  if (String(route.params.tab ?? "") === name) return;
  router.replace({
    name: "onCallTeamDetail",
    params: { teamId: teamId.value, tab: name },
    query: { org_identifier: orgId.value },
  });
});

watch(scheduleWindow, fetchSegments, { deep: true });
watch(selectedPriority, fetchPreview);

onMounted(fetchAll);
</script>
