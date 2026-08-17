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
      <OButton
        variant="outline"
        size="sm-action"
        data-test="oncall-team-page-btn"
        @click="notAvailable('pageThisTeam')"
      >
        {{ t("oncall.pageThisTeam") }}
      </OButton>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="oncall-team-override-btn"
        @click="notAvailable('takeOverride')"
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
    <!-- Who holds the pager, who catches it, how far the ladder reaches, and how
         last week went — the four questions asked before anything else on the
         page. The tabs below are where you go to CHANGE any of them. -->
    <div class="bg-border-default border-border-default border-y">
      <OnCallTeamPulse
        :slots="onCallNow"
        :schedule="schedule"
        :policy="policy"
        :overview="overview"
        :reachability="reachability"
        :timezone="team?.timezone ?? 'UTC'"
      />
    </div>

    <OContent class="py-2">
      <OnCallTeamAttention
        :risks="configRisks"
        :reachability="reachability"
        @act="onAttentionAct"
      />
    </OContent>

    <!-- What the team HAS been doing, then the chain that decides it: when each
         person is on, what happens if nobody answers, what reaches the team at
         all, and finally who the people are. -->
    <OTabs v-model="activeTab" data-test="oncall-team-tabs">
      <OTab name="overview" :label="t('oncall.teamOverview')" icon="format-list-bulleted" />
      <OTab name="schedule" :label="t('oncall.schedule')" icon="calendar-month" />
      <!-- Counts via the default slot, which is the documented seam for badges;
           `label` and `icon` are ignored once it is provided. -->
      <OTab name="policy">
        <OIcon name="arrow-upward" size="xs" />
        {{ t("oncall.escalationTab") }}
        <OTag v-if="silentPriorities" variant="amber-soft" size="sm">{{ silentPriorities }}</OTag>
      </OTab>
      <OTab name="ownership">
        <OIcon name="account-tree" size="xs" />
        {{ t("oncall.routing") }}
        <OTag v-if="ruleCount" variant="default-soft" size="sm">{{ ruleCount }}</OTag>
      </OTab>
      <OTab name="members">
        <OIcon name="group-work" size="xs" />
        {{ t("oncall.members") }}
        <OTag v-if="memberCount" variant="default-soft" size="sm">{{ memberCount }}</OTag>
      </OTab>
    </OTabs>

    <!-- `scroll` defaults to overflow-hidden, which silently clipped the
         escalation policy so its lower priorities were unreachable. -->
    <OTabPanels v-model="activeTab" grow scroll="y">
      <!-- What actually happened, not just what fired: the pages this team was
           woken by, and how fast each was answered. -->
      <OTabPanel name="overview">
        <!-- Left is what happened and when nobody is covered; right is how you
             reach these people. Two columns because the right rail is reference
             material — read once during an incident, not scanned. -->
        <OContent
          y
          class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        >
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <span class="flex flex-wrap items-baseline gap-x-2">
                <OText variant="panel-title">{{ t("oncall.teamRecentPages") }}</OText>
                <OText variant="meta">{{ t("oncall.teamRecentPagesHint") }}</OText>
                <OButton
                  variant="outline"
                  size="xs"
                  class="ms-auto"
                  data-test="oncall-team-open-oncall"
                  @click="openOnCallList"
                >
                  {{ t("oncall.teamOpenInOnCall") }}
                </OButton>
              </span>

              <OTable
                :frame="false"
                :data="recentPages"
                :columns="pageColumns"
                row-key="id"
                :loading="pagesLoading"
                pagination="client"
                :page-size="10"
                sort-by="opened_at"
                sort-order="desc"
                :show-global-filter="false"
                table-id="oncall-team-recent-pages"
                data-test="oncall-team-pages-table"
                @row-click="openPage"
              >
                <template #cell-opened_at="{ row }">
                  <OTimeCell :value="row.opened_at" unit="us" />
                </template>
                <template #cell-title="{ row }">
                  <!-- Alert titles are long by nature and this column is one of
                       five: the row tells you a page happened, the tooltip
                       tells you which. -->
                  <span class="text-text-heading truncate text-sm">
                    {{ raw(row.title || row.subject.source_id) }}
                    <OTooltip side="bottom" :content="raw(row.title || row.subject.source_id)" />
                  </span>
                </template>
                <template #cell-acked_by="{ row }">
                  <OUserCell v-if="row.acked_by" :value="row.acked_by" />
                  <span v-else class="text-text-muted text-sm">{{ ABSENT }}</span>
                </template>
                <template #cell-time_to_ack="{ row }">
                  <span class="text-text-body text-sm">{{ timeToAck(row) }}</span>
                </template>
                <template #cell-escalated="{ row }">
                  <OTag v-if="didEscalate(row)" variant="amber-soft" size="sm">
                    {{ t("oncall.escalate") }}
                  </OTag>
                  <span v-else class="text-text-muted text-sm">
                    {{ t("oncall.teamNotEscalated") }}
                  </span>
                </template>
                <template #empty>
                  <OEmptyState
                    size="hero"
                    preset="no-oncall-responses"
                    data-test="oncall-team-pages-empty"
                  />
                </template>
              </OTable>
            </div>

            <!-- Gaps are the only thing worth looking at here, so they are the
                 only bands that get an alarming colour. -->
            <div class="flex flex-col gap-2">
              <span class="flex flex-wrap items-baseline gap-x-2">
                <OText variant="panel-title">
                  {{ t("oncall.teamCoverage", { days: COVERAGE_DAYS }) }}
                </OText>
                <OText variant="meta">{{ t("oncall.teamCoverageHint") }}</OText>
                <OButton
                  variant="outline"
                  size="xs"
                  class="ms-auto"
                  data-test="oncall-team-open-schedule"
                  @click="activeTab = 'schedule'"
                >
                  {{ t("oncall.calendar") }}
                </OButton>
              </span>
              <OnCallCoverageStrip
                :rotations="schedule?.rotations ?? []"
                :timezone="team?.timezone ?? 'UTC'"
                :days="COVERAGE_DAYS"
              />
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <OnCallTeamReach :destinations="policy?.destinations ?? []" />
            <OnCallContactReadiness
              :reachability="reachability"
              :testing="testingPage"
              @test-page="sendTestPage"
            />
            <OnCallLoadBalance :load="teamLoad" />
          </div>
        </OContent>
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

      <!-- What the schedule WILL do, then the rotations that decide it, then
           the editor. Reading before editing: the timeline is resolved by the
           engine, so it answers "is this right" in a way the draft cannot. -->
      <OTabPanel name="schedule">
        <!-- Read, or edit — never both. The editor carries its own draft
             calendar and rotation table, so showing it under these two put two
             of each on the screen. -->
        <OContent y class="flex flex-col gap-5">
            <!-- Only when the window ahead has a hole in it. Handover and who
                 is on call are already in the strip above the tabs. -->
            <OnCallGapBanner
              :segments="segments"
              :timezone="team?.timezone ?? 'UTC'"
              @fill-gap="onFillGap"
            />

            <!-- The rail answers "which rotation is carrying this, and what do
                 I do about it"; the chart answers "when". Side by side because
                 the second question is always asked of the first. -->
            <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
              <OnCallRotationRail
                :rotations="schedule?.rotations ?? []"
                :segments="segments"
                :load="teamLoad"
                :timezone="team?.timezone ?? 'UTC'"
                @edit="openScheduleEditor({ mode: 'edit', name: $event })"
                @add="openScheduleEditor({ mode: 'new' })"
                @override="coverOpen = true"
                @duplicate="openScheduleEditor({ mode: 'duplicate', name: $event })"
                @presets="presetsOpen = true"
              />

              <OnCallScheduleTimeline
                v-model:window="scheduleWindow"
                :rotations="schedule?.rotations ?? []"
                :segments="segments"
                :timezone="team?.timezone ?? 'UTC'"
                :loading="segmentsLoading"
                @fill-gap="onFillGap"
              />
            </div>

            <OnCallSchedulePresets
              v-model:open="presetsOpen"
              :team-id="teamId"
              :members="members"
              :has-schedule="!!schedule?.rotations?.length"
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
            />
        </OContent>
      </OTabPanel>

      <!-- Same shape as Schedule: what the ladder WOULD do, then the editor on
           demand. Reading the policy tells you its shape; only the dry run
           tells you whether it reaches anybody. -->
      <OTabPanel name="policy">
        <OContent y class="flex flex-col gap-5">
          <template v-if="!editingPolicy">
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

            <div class="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <OnCallEscalationLadder
                v-model:selected="selectedPriority"
                :priorities="overview?.rungs ?? []"
                :preview="preview"
                :loading="previewLoading"
                @edit="editingPolicy = true"
              />
              <OnCallEscalationDryRun :preview="preview" />
            </div>
          </template>

          <template v-else>
            <span class="flex flex-wrap items-baseline gap-x-2">
              <OText variant="panel-title">{{ t("oncall.escalationEditing") }}</OText>
              <OButton
                variant="outline"
                size="xs"
                class="ms-auto"
                data-test="oncall-policy-done-editing"
                @click="editingPolicy = false"
              >
                {{ t("oncall.policyDoneEditing") }}
              </OButton>
            </span>
            <OnCallPolicyEditor :team-id="teamId" :policy="policy" @saved="onPolicySaved" />
          </template>
        </OContent>
      </OTabPanel>

      <OTabPanel name="ownership">
        <OnCallOwnership :team-id="teamId" :teams="teams" />
      </OTabPanel>
    </OTabPanels>
    </template>

    <OnCallTeamForm v-model:open="editOpen" :team="team" @saved="onTeamSaved" />

    <OnCallCoverForm
      v-model:open="coverOpen"
      :members="members"
      :timezone="team?.timezone ?? 'UTC'"
      :saving="coverSaving"
      :current-holder="onCallNow[0]?.user_email ?? null"
      :gap="coverGap"
      @save="saveCover"
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
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import OnCallRotationRail from "@/components/oncall/OnCallRotationRail.vue";
import OnCallGapBanner from "@/components/oncall/OnCallGapBanner.vue";
import OnCallSchedulePresets from "@/components/oncall/OnCallSchedulePresets.vue";
import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import OnCallCoverageStrip from "@/components/oncall/OnCallCoverageStrip.vue";
import OnCallContactReadiness from "@/components/oncall/OnCallContactReadiness.vue";
import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import OnCallEscalationDryRun from "@/components/oncall/OnCallEscalationDryRun.vue";
import OnCallEscalationLadder from "@/components/oncall/OnCallEscalationLadder.vue";
import OnCallLoadBalance from "@/components/oncall/OnCallLoadBalance.vue";
import OnCallTeamAttention from "@/components/oncall/OnCallTeamAttention.vue";
import OnCallTeamReach from "@/components/oncall/OnCallTeamReach.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OnCallTeamPulse from "@/components/oncall/OnCallTeamPulse.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
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
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { isOnCallUnavailable } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

/** The window the activity panel and the recent-pages list describe. */
const ACTIVITY_WINDOW_MICROS = 7 * MICROS_PER_DAY;
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
const presetsOpen = ref(false);
const coverSaving = ref(false);
const coverGap = ref<{ from: number; to: number } | null>(null);
const editingPolicy = ref(false);
const selectedPriority = ref("P1");
const preview = ref<EscalationPreview | null>(null);
const previewLoading = ref(false);
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

/// Which tab the URL asked for.
///
/// The setup checklist and the policies list both deep-link here with a `tab`
/// param, and the view was never reading it — the links only appeared to work
/// because the default landing tab happened to be the one they asked for.
const routeTab = computed(() => {
  const tab = String(route.params.tab ?? "");
  return (TEAM_TABS as readonly string[]).includes(tab) ? tab : null;
});

/// The counts come from the overview, which counts alert rules routed here in
/// the database. Falls back to what the page already knows when that call has
/// not answered — a header that waits on a second request reads as broken.
/// The server's count when it has answered, otherwise what the page already
/// knows — a header that waits on a second request reads as broken.
const memberCount = computed(() => overview.value?.members ?? members.value.length);

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

const ABSENT = raw("—");

/// Pages this team was woken by, inside the activity window.
const recentPages = computed(() => {
  const since = Date.now() * 1000 - ACTIVITY_WINDOW_MICROS;
  return responses.value.filter((row) => row.opened_at >= since);
});

/// The delay before a record's ladder would have woken a SECOND person. Read
/// from the policy so it needs no per-record request and covers every page.
function secondRungDelay(record: OnCallResponse): number | null {
  const steps = policy.value?.rungs.find((rung) => rung.priority === record.priority)?.steps;
  if (!steps || steps.length < 2) return null;
  return [...steps].sort((a, b) => a.after_micros - b.after_micros)[1].after_micros;
}

function timeToAck(record: OnCallResponse) {
  return record.acked_at ? raw(formatMicrosDuration(record.acked_at - record.opened_at)) : ABSENT;
}

/// Whether anybody beyond the first responder was woken — the same policy-based
/// answer the activity panel counts.
function didEscalate(record: OnCallResponse): boolean {
  const after = secondRungDelay(record);
  if (after === null) return false;
  const delay = record.acked_at ? record.acked_at - record.opened_at : null;
  return delay === null ? false : delay >= after;
}

const pageColumns = computed<OTableColumnDef<OnCallResponse>[]>(() => [
  {
    id: "opened_at",
    header: t("oncall.openedAt"),
    size: 140,
    accessorKey: "opened_at",
    sortable: true,
  },
  {
    id: "title",
    header: t("oncall.subject"),
    accessorFn: (row: OnCallResponse) => row.title || row.subject.source_id,
    sortable: true,
    meta: { isName: true },
  },
  {
    id: "acked_by",
    header: t("oncall.teamAnsweredBy"),
    size: 180,
    accessorFn: (row: OnCallResponse) => row.acked_by ?? "",
    sortable: true,
  },
  {
    id: "time_to_ack",
    header: t("oncall.timeToAck"),
    size: 120,
    accessorFn: (row: OnCallResponse) =>
      row.acked_at ? row.acked_at - row.opened_at : Number.MAX_SAFE_INTEGER,
    sortable: true,
  },
  {
    id: "escalated",
    header: t("oncall.teamEscalatedCol"),
    size: 120,
    accessorFn: (row: OnCallResponse) => (didEscalate(row) ? 1 : 0),
    sortable: true,
  },
]);

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

/// Says so rather than firing a request that 404s. Every one of these is a
/// design element with no endpoint behind it yet.
function notAvailable(featureKey: "pageThisTeam" | "takeOverride") {
  toast({
    variant: "info",
    message: t("oncall.notAvailableYet", { feature: t(`oncall.${featureKey}`) }),
  });
}

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
    const reached = data?.recipients?.length ?? 0;
    if (data?.reached_anyone && reached) {
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
async function fetchSegments() {
  const { from, to } = scheduleWindow.value;
  if (!from || !to) return;
  segmentsLoading.value = true;
  try {
    const res = await oncallService.resolvedSchedule({
      org_identifier: orgId.value,
      team_id: teamId.value,
      from,
      to,
    });
    segments.value = res.data ?? [];
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
function onFillGap(gap: ResolvedSegment) {
  coverGap.value = { from: gap.from, to: gap.to };
  coverOpen.value = true;
}

/// A cover takes a slot for a window; outside it the rotation resolves exactly
/// as before, which is what makes taking one safe.
async function saveCover(value: { user_email: string; start_at: number; end_at: number }) {
  coverSaving.value = true;
  try {
    await oncallService.createOverride({
      org_identifier: orgId.value,
      team_id: teamId.value,
      data: value,
    });
    coverOpen.value = false;
    coverGap.value = null;
    toast({ variant: "success", message: t("oncall.coverSaved") });
    await fetchSegments();
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
async function fetchPreview() {
  const priority = Number(selectedPriority.value.replace(/\D/g, "")) || 1;
  previewLoading.value = true;
  try {
    const res = await oncallService.escalationPreview({
      org_identifier: orgId.value,
      team_id: teamId.value,
      priority,
    });
    preview.value = res.data ?? null;
  } catch {
    // One priority failing must not blank the strip that lets you pick another.
    preview.value = null;
  } finally {
    previewLoading.value = false;
  }
}

/// Back to the dry run on save — seeing whether the change actually reaches
/// anybody is the reason to have made it.
async function onPolicySaved() {
  editingPolicy.value = false;
  await fetchAll();
  await fetchPreview();
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
watch(scheduleWindow, fetchSegments, { deep: true });
watch(selectedPriority, fetchPreview);

onMounted(fetchAll);
</script>
