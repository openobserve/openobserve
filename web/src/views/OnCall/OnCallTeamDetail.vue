<template>
  <OPageLayout
    bleed
    data-test="oncall-team-detail-page"
    :subtitle="subtitle"
    icon="group-work"
    title-overflow="visible"
    tabs-below
    :back="{
      label: t('oncall.backToTeams'),
      to: { name: 'onCallTeams', query: { org_identifier: orgId } },
    }"
  >
    <!-- Team names are free text and can run long; truncate so it never
         crowds the actions on the right. -->
    <template #title>
      <OTruncatedText class="block" data-test="oncall-team-detail-title">{{
        team ? raw(team.name) : t("oncall.teamDetail")
      }}</OTruncatedText>
    </template>

    <!-- Whether a page would reach anybody is the team's headline fact, so it
         rides the title instead of sitting in a card below it. -->
    <template #title-trail>
      <span v-if="loaded" class="inline-flex">
        <OTag
          type="oncallCoverage"
          :value="coverageState"
          size="sm"
          data-test="oncall-team-coverage"
        />
        <OTooltip v-if="coverageTip" side="bottom" :content="coverageTip" />
      </span>
    </template>

    <template #actions>
      <ORefreshButton
        v-if="loaded"
        layout="inline"
        size="header"
        variant="outline"
        :last-run-at="lastFetchedAt"
        :loading="refreshing"
        data-test="oncall-team-refresh"
        @click="refreshPage"
      />
    </template>

    <template #actions-overflow>
      <!-- A cover is a shift handed to a person, so it needs a roster to hand
           it to: on a team with nobody in it this would open on an empty
           picker, which is a dead end rather than an action. -->
      <OButton
        v-if="members.length && canConfigure"
        variant="outline"
        size="sm"
        icon-left="person-add"
        data-test="oncall-team-override-btn"
        @click="openTakeOverride"
      >
        {{ t("oncall.takeOverride") }}
      </OButton>
      <!-- `loaded` stays true after a refresh finds the team gone, so the failure flags are checked too. -->
      <OButton
        v-if="canConfigure && loaded && !teamNotFound && loadError === null"
        variant="outline"
        size="sm"
        icon-left="edit"
        data-test="oncall-team-detail-edit-btn"
        @click="openTeamEdit"
      >
        {{ t("oncall.editTeam") }}
      </OButton>
    </template>

    <!-- Attached to the header, as on the Incident page; only once there is a team to show. -->
    <template v-if="loaded && !oncallUnavailable && !teamNotFound && !loadError" #header-tabs>
      <OTabs v-model="activeTab" align="left" class="flex-1" data-test="oncall-team-tabs">
        <OTab
          name="overview"
          :label="t('oncall.teamOverview')"
          icon="format-list-bulleted"
          data-test="oncall-team-tab-overview"
        />
        <OTab name="schedule" data-test="oncall-team-tab-schedule">
          <OIcon name="calendar-month" size="sm" class="shrink-0" />
          <span>{{ t("oncall.schedule") }}</span>
          <EditorDraftDot
            v-if="scheduleDraftAt(teamId) !== null"
            :saved-at="scheduleDraftAt(teamId)"
            data-test="oncall-team-tab-schedule-draft-dot"
          />
        </OTab>
        <OTab name="policy" data-test="oncall-team-tab-policy">
          <OIcon name="arrow-upward" size="sm" class="shrink-0" />
          <span>{{ t("oncall.escalationTab") }}</span>
          <EditorDraftDot
            v-if="policyDrafts.ids.has(teamId)"
            :saved-at="policyDrafts.savedAt(teamId)"
            data-test="oncall-team-tab-policy-draft-dot"
          />
          <!-- An icon, not a count chip: the other tabs' chips are tallies, this is a finding. -->
          <OIcon
            v-if="silentPriorities"
            name="warning-amber"
            size="sm"
            class="text-status-warning-text shrink-0"
            data-test="oncall-team-tab-policy-warning"
          >
            <OTooltip
              :content="
                t('oncall.tabPrioritiesPageNobody', { count: silentPriorities }, silentPriorities)
              "
            />
          </OIcon>
        </OTab>
        <OTab name="ownership" data-test="oncall-team-tab-ownership">
          <OIcon name="alt-route" size="sm" class="shrink-0" />
          <span>{{ t("oncall.routing") }}</span>
          <OTag v-if="ruleCount" type="countChip" value="neutral">
            {{ ruleCount }}
          </OTag>
        </OTab>
        <OTab name="members" data-test="oncall-team-tab-members">
          <OIcon name="group-work" size="sm" class="shrink-0" />
          <span>{{ t("oncall.members") }}</span>
          <OTag
            v-if="memberCount"
            type="countChip"
            value="neutral"
            data-test="oncall-team-tab-members-count"
          >
            {{ memberCount }}
          </OTag>
        </OTab>
      </OTabs>
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

    <LicenseDeniedState
      v-else-if="licenseDenied"
      :features="licenseDenied"
      data-test="oncall-team-detail-license-denied"
    />

    <OContent v-else-if="teamNotFound" y>
      <OEmptyState
        size="hero"
        :title="t('oncall.teamNotFoundTitle')"
        :description="t('oncall.teamNotFoundDescription')"
        data-test="oncall-team-detail-not-found"
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
        @action="refreshPage"
      />
    </OContent>

    <OnCallTeamDetailSkeleton v-else-if="!loaded" />

    <template v-else>
      <OnCallTeamAttention
        :risks="configRisks"
        :timezone="team?.timezone ?? 'UTC'"
        :reachability="reachability"
        :overview="overview"
        :checked-at="insightsCheckedAt"
        :has-members="hasMembers"
        @act="onAttentionAct"
        @recheck="recheckInsights"
      />

      <OTabPanels :key="tabsKey" v-model="activeTab" grow scroll="y" class="min-h-0">
        <OTabPanel name="overview">
          <OContent y class="flex flex-col gap-5">
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
                  icon-left="calendar-month"
                  class="ms-auto"
                  data-test="oncall-team-open-schedule"
                  @click="activeTab = 'schedule'"
                >
                  {{ t("oncall.openSchedule") }}
                </OButton>
              </span>
              <OnCallCoverageStrip
                :rotations="schedule?.rotations ?? []"
                :unreachable="unreachableEmails"
                :timezone="team?.timezone ?? 'UTC'"
                :days="COVERAGE_DAYS"
              />
            </div>

            <OnCallRecentPages
              :pages="recentPages"
              :policy="policy"
              :loading="pagesLoading"
              :window-days="ACTIVITY_WINDOW_DAYS"
              @open="openPage"
              @view-all="openOnCallList"
            />
          </OContent>
        </OTabPanel>

        <!-- "1.9x load" is a fact about PEOPLE, and the only thing to be done about
             it — change who is in the rotation — is on this tab. Reachability and
             load are columns of the roster now, not panels beside it: one row per
             person answers can we reach them, what have they carried, when are
             they on next. -->
        <OTabPanel name="members" stretch>
          <OnCallMembers
            ref="membersRef"
            :team-id="teamId"
            :team-name="team?.name ?? ''"
            :members="members"
            :rotations="schedule?.rotations ?? []"
            :timezone="team?.timezone ?? 'UTC'"
            :on-call-now="onCallNow"
            :reachability="reachability"
            :load="teamLoad"
            :can-configure="canConfigure"
            @changed="onMembersChanged"
            @open-schedule="activeTab = 'schedule'"
            @license-denied="lockPage"
          />
        </OTabPanel>

        <!-- What the schedule WILL do, then the rotations that decide it, then
             the editor. Reading before editing: the timeline is resolved by the
             engine, so it answers "is this right" in a way the draft cannot. -->
        <OTabPanel name="schedule" layout="flex-col" stretch>
          <!-- Only what the chart cannot be acted on for. Who is on, until
               when and who is next are on the lane the reader is already
               looking at; restating them here gave the reader two renderings
               to reconcile. -->
          <OnCallScheduleAnswer
            :positions="onCallNow"
            :has-members="hasMembers !== false"
            :rotation-count="teamRotations.length"
            @assign-secondary="onAssignSecondary"
            @add-people="activeTab = 'members'"
          />

          <OContent y class="flex h-full min-h-0 flex-1 flex-col gap-5">
            <!-- Every act on a rotation opens the SAME drawer: which button was pressed only decides what it opens on. -->
            <OnCallScheduleTimeline
              v-model:window="scheduleWindow"
              :rotations="teamRotations"
              :segments="segments"
              :timezone="team?.timezone ?? 'UTC'"
              :loading="segmentsLoading"
              :can-cover="hasMembers !== false && canConfigure"
              :absences="teamAbsences"
              :can-mark-away="canConfigure"
              :self-email="selfEmail"
              :swap-rotations="swapRotationIds"
              :shift-spans="shiftSpans"
              :policy="policy"
              @fill-gap="onFillGap"
              @add="openScheduleEditor({ mode: 'new' })"
              @edit="openScheduleEditor({ mode: 'edit', id: $event })"
              @assign-people="openScheduleEditor({ mode: 'edit', id: $event })"
              @duplicate="openScheduleEditor({ mode: 'duplicate', id: $event })"
              @override="openCoverFor"
              @delete="rotationToDelete = $event"
              @presets="openPresets"
              @shift-action="onShiftAction"
              @clear-away="awayToClear = $event"
            />

            <OnCallCoverList
              ref="coverListRef"
              :team-id="teamId"
              :timezone="team?.timezone ?? 'UTC'"
              :window="scheduleWindow"
              :rotations="teamRotations"
              @changed="onCoversChanged"
              @license-denied="lockPage"
            />

            <OnCallSchedulePresets
              v-model:open="presetsOpen"
              :team-id="teamId"
              :members="members"
              :timezone="team?.timezone ?? 'UTC'"
              :rotations="teamRotations"
              :start-on="presetsStartOn"
              @applied="onScheduleSaved"
              @license-denied="lockPage"
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
              :policy="policy"
              @saved="onScheduleSaved"
              @intent-handled="scheduleIntent = null"
              @open-members="activeTab = 'members'"
              @open-policy="openPolicyFromRemove"
              @license-denied="lockPage"
            />
          </OContent>
        </OTabPanel>

        <!-- Same shape as Schedule: what the ladder WOULD do, then the editor on
             demand. One rail, full width — the ladder answers who and when, and
             says whether a page would land only where one would not. -->
        <OTabPanel name="policy">
          <OContent y class="flex flex-col gap-5">
            <OnCallEscalationLadder
              v-model:selected="selectedPriority"
              :priorities="overview?.rungs ?? []"
              :policy="policy"
              :rotations="teamRotations"
              :preview="preview"
              :loading="previewLoading"
              :can-configure="canConfigure"
              :on-call-now="onCallNow"
              @edit="openPolicyEditor"
              @send-test="testPageOpen = true"
            />

            <!-- Same move as the schedule tab: the editor is a drawer, so the
                 ladder stays on screen behind it and the edit is checked
                 against what it is replacing. -->
            <OnCallPolicyEditor
              v-model:open="editingPolicy"
              :priority="selectedPriorityNumber"
              :team-id="teamId"
              :policy="policy"
              :rotations="teamRotations"
              :team-name="team?.name ?? ''"
              @saved="onPolicySaved"
              @policy-written="fetchAll()"
              @open-members="activeTab = 'members'"
              @license-denied="lockPage"
            />
          </OContent>
        </OTabPanel>

        <OTabPanel name="ownership">
          <OContent y>
            <OnCallOwnership
              :team-id="teamId"
              :teams="teams"
              @rules-loaded="(count: number) => (ruleCount = count)"
              @license-denied="lockPage"
            />
          </OContent>
        </OTabPanel>
      </OTabPanels>
    </template>

    <!-- The same drawer as the Teams list's, Default switch included. -->
    <OnCallTeamForm
      v-model:open="editOpen"
      :team="team"
      offer-default
      :is-default="!!team && team.id === defaultTeamId"
      @saved="onTeamSaved"
    />

    <!-- Named in the prompt: a rotation is what puts somebody on call, and two
         rotations in one team routinely differ by one word. -->
    <OnCallRemoveRotationDialog
      :open="!!rotationToDelete"
      :rotation-id="rotationToDelete ?? ''"
      :rotations="teamRotations"
      :holders="holdersByName"
      :policy="policy"
      @update:open="(v: boolean) => (v ? null : (rotationToDelete = null))"
      @confirm="deleteRotation"
      @open-policy="openPolicyFromRemove"
    />

    <!-- Named from the loaded preview: the first step can be the whole team, so this is the last look at who gets woken. -->
    <ODialog
      :open="!!clearingAway"
      size="sm"
      :title="t('oncall.awayClear')"
      :primary-button-label="t('oncall.awayClearConfirm')"
      :secondary-button-label="t('oncall.cancel')"
      data-test="oncall-away-clear-confirm"
      @update:open="(isOpen: boolean) => !isOpen && (awayToClear = null)"
      @click:primary="confirmClearAway"
      @click:secondary="awayToClear = null"
    >
      <i18n-t
        v-if="clearingAway"
        keypath="oncall.awayClearMessage"
        tag="p"
        scope="global"
        class="text-sm"
        data-test="oncall-away-clear-message"
      >
        <template #name><OnCallPersonName :email="clearingAway.user_email" /></template>
        <template #range>{{ clearingAwayRange }}</template>
      </i18n-t>
    </ODialog>

    <ODialog
      v-model:open="testPageOpen"
      size="sm"
      :title="t('oncall.testPageConfirmTitle')"
      :primary-button-label="t('oncall.ladderSendTest')"
      :secondary-button-label="t('oncall.cancel')"
      data-test="oncall-team-test-page-dialog"
      @click:primary="sendTestPage"
      @click:secondary="testPageOpen = false"
    >
      <i18n-t
        :keypath="
          testPageCopy.channels ? 'oncall.testPageConfirm' : 'oncall.testPageConfirmNoChannel'
        "
        tag="p"
        scope="global"
        class="text-sm"
        data-test="oncall-team-test-page-message"
      >
        <template #priority>{{ raw(selectedPriority) }}</template>
        <template #names>
          <template v-for="(email, index) in testPageCopy.emails" :key="email">
            <span v-if="index">{{ raw(", ") }}</span>
            <OnCallPersonName :email="email" data-test="oncall-team-test-page-person" />
          </template>
        </template>
        <template #channels>{{ testPageCopy.channels }}</template>
      </i18n-t>
    </ODialog>

    <OnCallCoverForm
      v-model:open="coverOpen"
      :members="members"
      :timezone="team?.timezone ?? 'UTC'"
      :viewer-timezone="store.state.timezone"
      :team-name="team?.name ?? ''"
      :saving="coverSaving"
      :current-holder="coverHolder"
      :positions="onCallNow"
      :gap="coverGap"
      :default-user="coverDefaultUser"
      :shifts="swapShifts"
      :rotations="teamRotations"
      :default-rotation="coverRotation"
      :default-mode="coverMode"
      :swap-from="coverSwapFrom"
      :resolve-runs="resolveCoverRuns"
      @save="saveCover"
      @swap="saveSwap"
    />

    <OnCallAwayDialog
      v-model:open="awayOpen"
      :email="awayEmail"
      :timezone="team?.timezone ?? 'UTC'"
      :from="awayWindow?.from ?? null"
      :to="awayWindow?.to ?? null"
      @saved="onAwaySaved"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";

import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallMembers from "@/components/oncall/OnCallMembers.vue";
import OnCallOwnership from "@/components/oncall/OnCallOwnership.vue";
import OnCallPolicyEditor from "@/components/oncall/OnCallPolicyEditor.vue";
import OnCallScheduleEditor from "@/components/oncall/OnCallScheduleEditor.vue";
import OnCallScheduleAnswer from "@/components/oncall/OnCallScheduleAnswer.vue";
import OnCallCoverList from "@/components/oncall/OnCallCoverList.vue";
import type { UpcomingShift } from "@/components/oncall/OnCallCoverForm.vue";
import OnCallSchedulePresets from "@/components/oncall/OnCallSchedulePresets.vue";
import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import OnCallCoverageStrip from "@/components/oncall/OnCallCoverageStrip.vue";
import OnCallRecentPages from "@/components/oncall/OnCallRecentPages.vue";
import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import OnCallAwayDialog from "@/components/oncall/OnCallAwayDialog.vue";
import type { ShiftAction } from "@/components/oncall/OnCallScheduleTimeline.vue";
import OnCallEscalationLadder from "@/components/oncall/OnCallEscalationLadder.vue";
import OnCallTeamAttention from "@/components/oncall/OnCallTeamAttention.vue";
import OnCallTeamForm from "@/components/oncall/OnCallTeamForm.vue";
import OnCallRemoveRotationDialog from "@/components/oncall/OnCallRemoveRotationDialog.vue";
import OnCallTeamDetailSkeleton from "@/views/OnCall/OnCallTeamDetailSkeleton.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { useOnCallDefaultTeam } from "@/composables/useOnCallDefaultTeam";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { useListViewState } from "@/composables/useListViewState";
import {
  segmentSpanKey,
  shiftAround,
  shiftLookupWindow,
  SHIFT_LOOKUP_MICROS,
  swappableRuns,
} from "@/components/oncall/resolvedShifts";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import { useEditorDraftIds } from "@/composables/useEditorDraft";
import { deleteEditorDraftsFor } from "@/utils/drafts/editorDraftStore";
import {
  dropRotationDrafts,
  dropScheduleDrafts,
  useScheduleDraftTimes,
} from "@/components/oncall/scheduleDrafts";
import { useMutation } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { destinationKeys } from "@/services/alert_destination.querykeys";
import { oncallKeys } from "@/services/oncall.querykeys";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import { userKeys } from "@/services/users.querykeys";
import analytics from "@/services/product_analytics";
import {
  createOverrideMutation,
  deleteOverrideMutation,
  deleteUnavailabilityMutation,
  escalationPreviewQuery,
  oncallTeamQuery,
  oncallTeamsQuery,
  ownershipRulesQuery,
  resolvedScheduleQuery,
  responsesQuery,
  setTeamScheduleMutation,
  teamConfigRisksQuery,
  teamLoadQuery,
  teamMembersQuery,
  teamOverviewQuery,
  teamPolicyQuery,
  teamReachabilityQuery,
  teamScheduleQuery,
  testPageMutation,
  unavailabilityQuery,
  whoIsOnCallQuery,
} from "@/services/oncall.queries";
import type {
  OnCallPolicy,
  OnCallResponse,
  OnCallSchedule,
  OnCallPosition,
  OnCallTeam,
  ConfigRisks,
  EscalationPreview,
  OnCallTeamMember,
  TeamOverview,
  ResolvedSegment,
  TeamLoad,
  TeamReachability,
  ScheduleEditorIntent,
  OwnershipRule,
  Unavailability,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_HOUR } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import {
  channelList,
  formatDayRange,
  isOnCallUnavailable,
  upcomingShifts,
  winningRule,
} from "@/utils/oncall";
import { serverMessageOf, statusOf } from "@/utils/slackLink";

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { canConfigure, noteConfigurationDenied } = useOnCallPermissions();

/** The window the activity panel and the recent-pages list describe. */
const ACTIVITY_WINDOW_DAYS = 7;
const ACTIVITY_WINDOW_MICROS = ACTIVITY_WINDOW_DAYS * MICROS_PER_DAY;
/** How far ahead the coverage strip draws. */
const COVERAGE_DAYS = 14;

const team = ref<OnCallTeam | null>(null);
const members = ref<OnCallTeamMember[]>([]);
const schedule = ref<OnCallSchedule | null>(null);
const policy = ref<OnCallPolicy | null>(null);
const onCallNow = ref<OnCallPosition[]>([]);
// The routing tester can resolve to ANY team, so the whole list is needed to
// name the winner rather than showing a bare id.
const teams = ref<OnCallTeam[]>([]);
const responses = ref<OnCallResponse[]>([]);
const pagesLoading = ref(false);
const testPageOpen = ref(false);
const overview = ref<TeamOverview | null>(null);
const reachability = ref<TeamReachability | null>(null);
const configRisks = ref<ConfigRisks | null>(null);
/// Micros — when the findings last came back, so the banner can say how fresh
/// they are rather than implying they are live.
const insightsCheckedAt = ref<number | null>(null);
const teamLoad = ref<TeamLoad | null>(null);
const segments = ref<ResolvedSegment[]>([]);
const segmentsLoading = ref(false);
/// The whole shift behind each band the calendar's edges cut, keyed by `segmentSpanKey`.
const shiftSpans = ref<Record<string, { from: number; to: number }>>({});
/// Read or edit, never both — the editor brings its own calendar and table.

/// What the drawer opens on. One click lands on the rotation the user pointed
/// at — never on a bulk editing mode with its own copy of the page.
const scheduleIntent = ref<ScheduleEditorIntent | null>(null);

async function openScheduleEditor(intent: ScheduleEditorIntent) {
  if (!(await refreshScheduleForEdit())) return;
  scheduleIntent.value = intent;
}

async function openPolicyEditor() {
  const fresh = await readForEdit<OnCallPolicy | null>(
    teamPolicyQuery(orgId.value, teamId.value),
    (value) => (policy.value = value),
  );
  if (fresh) editingPolicy.value = true;
}

async function openTeamEdit() {
  const fresh = await readForEdit<OnCallTeam | null>(
    oncallTeamQuery(orgId.value, teamId.value),
    (value) => (team.value = value),
  );
  if (fresh) editOpen.value = true;
}

const coverOpen = ref(false);
/// The Covers panel reads its own endpoint, so a write made anywhere else has
/// to tell it. `ref="coverListRef"` had no variable behind it in `<script
/// setup>`, which binds to nothing in silence: every cover saved from this page
/// landed on the server and left the list under the calendar unchanged.
const coverListRef = ref<{ refresh: () => Promise<void> | void } | null>(null);

/// So the attention banner's "Add members" can focus the picker even when switching to this tab is a no-op.
const membersRef = ref<{ focusMemberPicker: () => void } | null>(null);

/// Both things a written cover invalidates: the calendar, which the server
/// resolves, and the list of covers beneath it. Never one without the other —
/// a band that moves over a list that does not is the same confusion by half.
async function refreshCoverage() {
  await Promise.allSettled([fetchSegments(), coverListRef.value?.refresh() ?? Promise.resolve()]);
}
const presetsOpen = ref(false);
/// The rotation id a template replaces; empty adds a new rotation.
const presetsStartOn = ref("");
/// The rotation the reader asked to delete, held until they confirm it.
/// The rotation's **id**. The confirm dialog needs its name, which is looked
/// up rather than carried: a name is renameable and two rotations may share
/// one, so it cannot say which row the reader picked.
const rotationToDelete = ref<string | null>(null);
const { nameOf } = useOrgUserNames();
/// Who each rotation puts on call now, by name, for the delete confirm.
const holdersByName = computed(() =>
  onCallNow.value.map((position) => ({
    rotation_id: position.rotation_id,
    name: nameOf(position.user_email),
  })),
);
const coverSaving = ref(false);
const coverGap = ref<{ from: number; to: number } | null>(null);
/// Who the cover dialog opens pre-selected on. Empty for every opener that has
/// no opinion about the person.
const coverDefaultUser = ref("");
const coverRotation = ref("");
const coverMode = ref<"cover" | "swap">("cover");
const coverSwapFrom = ref<{ rotationId: string; at: number } | null>(null);
/// Whose shift a cover from a clicked bar relieves; null falls back to whoever is on now.
const coverHolder = ref<string | null>(null);
const awayOpen = ref(false);
const awayEmail = ref("");
const awayWindow = ref<{ from: number; to: number } | null>(null);
const selfEmail = computed(() => String(store.state.userInfo?.email ?? ""));
const editingPolicy = ref(false);
const selectedPriority = ref("P1");
/// The ladder chips are labels ("P3"); the policy's rungs are numbered. The
/// editor opens on whichever ladder the reader was already looking at.
const selectedPriorityNumber = computed(() => Number(selectedPriority.value.slice(1)) || 1);
const preview = ref<EscalationPreview | null>(null);
const previewLoading = ref(false);
/// Owned by the timeline, which decides the visible range; the fetch follows it.
const scheduleWindow = ref({ from: 0, to: 0 });
/// Null until known, so the header never claims "0 routing rules" for a lookup that failed.
const ruleCount = ref<number | null>(null);
// Where the team actually is in its setup decides the landing tab. A brand
// new team opens on Members, because a schedule with nobody in it is not
// something anybody can act on; once there are people, Schedule leads,
// because that is the question the page exists to answer.
const activeTab = ref("members");
const loaded = ref(false);
const lastFetchedAt = ref<number | null>(null);
const loadError = ref<string | null>(null);
const oncallUnavailable = ref(false);
const licenseDenied = ref<string[] | null>(null);
const teamNotFound = ref(false);
const editOpen = ref(false);

const orgId = computed(() => store.state.selectedOrganization.identifier);
const { defaultTeamId, loadDefaultTeam, setDefaultTeam } = useOnCallDefaultTeam(orgId);
const teamId = computed(() => String(route.params.teamId ?? ""));

const scheduleDraftAt = useScheduleDraftTimes();
const policyDrafts = useEditorDraftIds("oncall_policy");

const scheduleDraftTarget = () => ({ org: orgId.value, teamId: teamId.value });

const dropTeamDrafts = () => {
  dropScheduleDrafts(scheduleDraftTarget());
  deleteEditorDraftsFor({ kind: "oncall_policy", org: orgId.value, entityId: teamId.value });
};

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
  const rules = ruleCount.value;
  const base = t(
    "oncall.teamSubtitle",
    { tz: team.value.timezone, count: memberCount.value },
    memberCount.value,
  );
  if (rules === null) return base;
  return raw(`${base} · ${t("oncall.teamOwnsRules", { count: rules }, rules)}`);
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

// The Pages list keeps its filters in shared view state, not the URL, so the team is set there before the jump.
function openOnCallList() {
  const view = useListViewState("oncall-responses", { teamFilter: "all" });
  Object.assign(view, {
    teamFilter: teamId.value,
    mineOnly: false,
    activeFilter: "all",
    currentPage: 1,
  });
  router.push({ name: "onCallResponses", query: { org_identifier: orgId.value } });
}

// A coverage_gap finding has no single rotation to point at, so land in create mode instead of leaving the drawer closed.
async function onAttentionAct(tab: string, rotation?: string | null) {
  const wasAlreadyThere = activeTab.value === tab;
  activeTab.value = tab;
  if (tab === "members") {
    // The panel only mounts on the tick after switching tabs, so wait unless we were already there.
    if (!wasAlreadyThere) await nextTick();
    membersRef.value?.focusMemberPicker();
    return;
  }
  if (tab !== "schedule") return;
  if (!rotation) {
    openScheduleEditor({ mode: "new" });
    return;
  }
  const target = schedule.value?.rotations.find((r) => r.name === rotation);
  if (target) openScheduleEditor({ mode: "edit", id: target.id });
}

const scheduleWrite = useMutation(() => setTeamScheduleMutation(orgId.value, teamId.value));
const coverWrite = useMutation(() => createOverrideMutation(orgId.value, teamId.value));
const coverDeleteWrite = useMutation(() => deleteOverrideMutation(orgId.value, teamId.value));
const testPageWrite = useMutation(() => testPageMutation(orgId.value));

/// Cache-first everywhere; only a reader asking for a refresh forces a read.
/// Invalidating with `refetchType: "none"` expires the entry before the fetch,
/// so a force costs one request rather than two.
async function read<T>(
  options: { queryKey: readonly unknown[]; [k: string]: any },
  force: boolean,
): Promise<T> {
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  try {
    return (await queryClient.fetchQuery(options as any)) as T;
  } catch (err) {
    // Any read can carry it, because the others may be answered from cache; the callers still see the error.
    const denied = licenseDeniedFeatures(err);
    if (denied) lockPage(denied);
    throw err;
  }
}

function lockPage(features: string[]) {
  // The header reads these three, and its team facts and actions must not outlive the body.
  team.value = null;
  members.value = [];
  loaded.value = false;
  // A lock drawn behind an open form would be out of sight, and saving there can only be refused.
  editOpen.value = false;
  coverOpen.value = false;
  awayOpen.value = false;
  testPageOpen.value = false;
  rotationToDelete.value = null;
  licenseDenied.value = features;
}

/// Read-modify-write: an editor writes its record back whole, so its draft starts from the server's copy, never this page's cached one.
async function readForEdit<T>(
  options: { queryKey: readonly unknown[]; [k: string]: any },
  assign: (value: T) => void,
): Promise<boolean> {
  try {
    assign(await read<T>(options, true));
    return true;
  } catch (err: unknown) {
    if (licenseDenied.value) return false;
    toast({
      variant: "error",
      message: raw(serverMessageOf(err)) || t("oncall.editorReadFailed"),
    });
    return false;
  }
}

/// The fresh read is the one place a rotation deleted elsewhere is known gone, so its orphaned drafts go here.
const refreshScheduleForEdit = () =>
  readForEdit<OnCallSchedule | null>(teamScheduleQuery(orgId.value, teamId.value), (value) => {
    schedule.value = value;
    dropScheduleDrafts({
      ...scheduleDraftTarget(),
      liveRotationIds: new Set((value?.rotations ?? []).map((rotation) => rotation.id)),
    });
  });

function loadFailureOf(err: unknown): string {
  return serverMessageOf(err) ?? (err instanceof Error ? err.message : "");
}

async function fetchAll(force = false) {
  loadError.value = null;
  teamNotFound.value = false;
  licenseDenied.value = null;
  const org = orgId.value;
  const id = teamId.value;

  // Issued together rather than awaiting the teams probe first, which turned every load into teams + max(the other five).
  const [teamsSettled, teamSettled, memberSettled, scheduleSettled, policySettled, onCallSettled] =
    await Promise.allSettled([
      read<OnCallTeam[]>(oncallTeamsQuery(org), force),
      read<OnCallTeam | null>(oncallTeamQuery(org, id), force),
      read<OnCallTeamMember[]>(teamMembersQuery(org, id), force),
      read<OnCallSchedule | null>(teamScheduleQuery(org, id), force),
      read<OnCallPolicy | null>(teamPolicyQuery(org, id), force),
      read<OnCallPosition[]>(whoIsOnCallQuery(org, id), force),
    ]);

  if (licenseDenied.value) return;

  // The org-level list exists in every on-call build regardless of this team id, so only its failure means the feature is unavailable.
  if (teamsSettled.status === "rejected") {
    const err: unknown = teamsSettled.reason;
    if (isOnCallUnavailable(err)) {
      oncallUnavailable.value = true;
      return;
    }
    loadError.value = loadFailureOf(err);
    return;
  }

  if (teamSettled.status === "rejected") {
    const err: unknown = teamSettled.reason;
    // The probe above already confirmed on-call is available, so a 404 on this query alone means the team id was deleted.
    if (statusOf(err) === 404) {
      teamNotFound.value = true;
      dropTeamDrafts();
      return;
    }
    loadError.value = loadFailureOf(err);
    return;
  }

  if (
    memberSettled.status === "rejected" ||
    scheduleSettled.status === "rejected" ||
    policySettled.status === "rejected" ||
    onCallSettled.status === "rejected"
  ) {
    const err: unknown = (
      [memberSettled, scheduleSettled, policySettled, onCallSettled].find(
        (settled) => settled.status === "rejected",
      ) as PromiseRejectedResult
    ).reason;
    loadError.value = loadFailureOf(err);
    return;
  }

  team.value = teamSettled.value;
  teams.value = teamsSettled.value;
  members.value = memberSettled.value;
  schedule.value = scheduleSettled.value;
  policy.value = policySettled.value;
  onCallNow.value = onCallSettled.value;
  // The oldest, so the age never claims the page is fresher than the stalest thing on it.
  lastFetchedAt.value = Math.min(
    ...[
      oncallTeamQuery(org, id),
      teamMembersQuery(org, id),
      teamScheduleQuery(org, id),
      teamPolicyQuery(org, id),
      whoIsOnCallQuery(org, id),
      oncallTeamsQuery(org),
    ].map((options) => queryClient.getQueryState(options.queryKey)?.dataUpdatedAt || Date.now()),
  );
  // Only on success, so a failed load never renders a team as uncovered.
  if (!loaded.value) {
    activeTab.value = routeTab.value ?? (members.value.length ? "overview" : "members");
  }
  loaded.value = true;
  await Promise.allSettled([
    fetchRuleCount(force),
    fetchPages(force),
    fetchInsights(force),
    fetchPreview(force),
  ]);
}

// Same set the Routing tab lists, so the header, the tab chip and the tab agree.
async function fetchRuleCount(force = false) {
  try {
    const rules = await read<OwnershipRule[]>(
      ownershipRulesQuery(orgId.value, teamId.value),
      force,
    );
    ruleCount.value = rules.length;
  } catch {
    ruleCount.value = null;
  }
}

/// The team's own pages, for the activity panel and the overview list. A
/// failure here costs those two surfaces, never the rest of the page.
/// The three insight calls. Each degrades one panel rather than the page, so
/// they are settled independently and never block the team from rendering.
async function fetchInsights(force = false) {
  const org = orgId.value;
  const id = teamId.value;
  const [ov, reach, risks, load] = await Promise.allSettled([
    read<TeamOverview | null>(teamOverviewQuery(org, id), force),
    read<TeamReachability | null>(teamReachabilityQuery(org, id), force),
    read<ConfigRisks | null>(teamConfigRisksQuery(org, id), force),
    read<TeamLoad | null>(teamLoadQuery(org, id), force),
  ]);
  overview.value = ov.status === "fulfilled" ? ov.value : null;
  reachability.value = reach.status === "fulfilled" ? reach.value : null;
  configRisks.value = risks.status === "fulfilled" ? risks.value : null;
  teamLoad.value = load.status === "fulfilled" ? load.value : null;
  insightsCheckedAt.value = Date.now() * 1000;
}

async function fetchPages(force = false) {
  pagesLoading.value = true;
  try {
    responses.value = await read<OnCallResponse[]>(
      responsesQuery(orgId.value, { team_id: teamId.value, include_resolved: true }),
      force,
    );
  } catch {
    responses.value = [];
  } finally {
    pagesLoading.value = false;
  }
}

/// Priorities whose ladder wakes nobody; P4–P5 page nobody by default, so only a silent P1–P3 is a finding.
const silentPriorities = computed(
  () =>
    (overview.value?.rungs ?? []).filter(
      (rung) => !rung.pages_anyone && Number(rung.priority.slice(1)) < 4,
    ).length,
);

/// Green only when every person on call now would receive a page, so the chip never disagrees with the banner naming one who would not.
const unreachableHolders = computed(() => {
  const verdicts = reachability.value?.members ?? [];
  const holders = [
    ...new Set(
      onCallNow.value
        .map((position) => position.user_email?.toLowerCase())
        .filter((email): email is string => !!email),
    ),
  ];
  const known = holders
    .map((email) => verdicts.find((member) => member.user_email.toLowerCase() === email))
    .filter((member) => !!member);
  return { total: holders.length, unreachable: known.filter((m) => !m.would_a_page_land).length };
});

const coverageState = computed<"covered" | "gap" | "unreachable" | "allunreachable">(() => {
  const covered = overview.value?.covered_now ?? onCallNow.value.length > 0;
  if (!covered) return "gap";
  const { unreachable, total } = unreachableHolders.value;
  if (!unreachable) return "covered";
  // Nobody holding the pager would receive a page, which is the coverage bar's red, not a partial warning.
  return unreachable === total ? "allunreachable" : "unreachable";
});

const coverageTip = computed<I18nText | undefined>(() => {
  if (coverageState.value !== "unreachable" && coverageState.value !== "allunreachable") {
    return undefined;
  }
  const { unreachable, total } = unreachableHolders.value;
  return t("oncall.coverageCantReachTip", { count: unreachable, total });
});

/// Who the strip must not count as cover: the server judged a page to them would not land.
const unreachableEmails = computed(() =>
  (reachability.value?.members ?? [])
    .filter((member) => !member.would_a_page_land)
    .map((member) => member.user_email),
);

/// The server sends a test to the first step only, so the first step's people are who it names.
const testPageCopy = computed<{ emails: string[]; channels: I18nText | "" }>(() => {
  const first = [...(preview.value?.rungs ?? [])].sort(
    (a, b) => a.after_micros - b.after_micros,
  )[0];
  const people = first?.recipients ?? [];
  // A person is sent only what they can receive, so a channel nobody on the step can receive is not sent.
  const sent = (preview.value?.channels ?? []).filter((channel) =>
    people.some((one) => (one.deliverable_channels ?? []).includes(channel)),
  );
  return {
    emails: [...new Set(people.map((one) => one.user_email))],
    channels: sent.length ? raw(channelList(sent, t)) : "",
  };
});

/// The one honest answer to "would a page actually land": send a real one and
/// report who it reached. `reached_anyone: false` carries the server's own
/// reason, which is rendered verbatim rather than re-worded.
async function sendTestPage() {
  testPageOpen.value = false;
  try {
    const res = await testPageWrite.mutateAsync({
      teamId: teamId.value,
      priority: selectedPriorityNumber.value,
    });
    const data = res.data;
    // `attempts`, not `recipients` — the latter never existed on the wire.
    const attempts = data?.attempts ?? [];
    const sent = attempts.filter((attempt) => attempt.delivered).length;
    if (data?.reached_anyone) {
      toast({
        variant: sent === attempts.length ? "success" : "warning",
        message: t("oncall.testPageSentOf", { sent, total: attempts.length }, attempts.length),
      });
    } else {
      toast({
        variant: "warning",
        message: t("oncall.testPageNobody", {
          reason: raw(data?.not_sent_because) || t("oncall.wouldPageNobody"),
        }),
      });
    }
  } catch (err: unknown) {
    noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        statusOf(err) === 403
          ? t("oncall.configDenied")
          : raw(serverMessageOf(err)) || t("oncall.testPageFailed"),
    });
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
// The newest read: a slower answer for a window the calendar has already left must not overwrite the lanes.
let latestSegmentsRead = 0;

async function fetchSegments(force = false) {
  const { from, to } = scheduleWindow.value;
  if (!from || !to) return;
  const rotations = schedule.value?.rotations ?? [];
  const readId = ++latestSegmentsRead;
  if (!rotations.length) {
    segments.value = [];
    return;
  }
  segmentsLoading.value = true;
  try {
    const answers = await Promise.all(
      rotations.map((rotation) =>
        read<ResolvedSegment[]>(
          resolvedScheduleQuery(orgId.value, teamId.value, from, to, rotation.id),
          force,
        ),
      ),
    );
    if (readId !== latestSegmentsRead) return;
    // The primary may answer without echoing its own id, so the lane lookup
    // gets one it can match rather than an absent field.
    segments.value = answers.flatMap((lane, index) =>
      lane.map((segment) => ({
        ...segment,
        rotation_id: segment.rotation_id || rotations[index].id,
      })),
    );
    void fetchShiftSpans(segments.value);
  } catch (err: unknown) {
    if (readId !== latestSegmentsRead || licenseDenied.value) return;
    segments.value = [];
    toast({
      variant: "error",
      message: raw(serverMessageOf(err)) || t("oncall.timelineLoadFailed"),
    });
  } finally {
    if (readId === latestSegmentsRead) segmentsLoading.value = false;
  }
}

const absences = ref<Unavailability[]>([]);

/// Only this team's people: the endpoint answers org-wide.
const teamAbsences = computed(() => {
  const emails = new Set(members.value.map((m) => m.user_email.toLowerCase()));
  return absences.value.filter((a) => emails.has(a.user_email.toLowerCase()));
});

let latestAbsencesRead = 0;

/// Silent on failure: an org-wide window read needs the configuration grant, and the lanes stand without it.
async function fetchAbsences(force = false) {
  const { from, to } = scheduleWindow.value;
  if (!from || !to) return;
  const readId = ++latestAbsencesRead;
  try {
    const answer = await read<Unavailability[]>(
      unavailabilityQuery(orgId.value, undefined, from, to),
      force,
    );
    if (readId === latestAbsencesRead) absences.value = answer;
  } catch {
    if (readId === latestAbsencesRead) absences.value = [];
  }
}

/// The gap the chart offered to fill pre-fills the window, so the common case
/// is choosing a person and pressing save.
/// "Assign secondary" is one button with two meanings, and the difference is
/// whether the team already has a secondary rotation to put people INTO. Both
/// land on the same drawer, which is the point: the reader asked to staff the
/// secondary, not to learn how this team models one.
async function onAssignSecondary() {
  if (!(await refreshScheduleForEdit())) return;
  // A SECOND rotation, not one spelled "secondary". The old lookup asked for a
  // slot literally named that, so a team whose second position was called
  // anything else was offered a create it did not need.
  const existing = (schedule.value?.rotations ?? [])[1];
  scheduleIntent.value = existing ? { mode: "edit", id: existing.id } : { mode: "new" };
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
  rotationToDelete.value = null;
  if (!id || !(await refreshScheduleForEdit())) return;
  const current = schedule.value;
  if (!current) return;

  // Filtered by id, not by name: two rotations may share a name, and deleting
  // "the Secondary" must not take a second one called the same thing with it.
  const name = current.rotations.find((rotation) => rotation.id === id)?.name ?? id;
  const rotations = current.rotations.filter((rotation) => rotation.id !== id);
  try {
    await scheduleWrite.mutateAsync({ timezone: current.timezone, rotations });
    toast({ variant: "success", message: t("oncall.laneDeleted", { name: raw(name) }) });
    dropRotationDrafts({ org: orgId.value, teamId: teamId.value, rotationId: id });
    await onScheduleSaved();
  } catch (err: unknown) {
    noteConfigurationDenied(err);
    // The server's own sentence: it refuses a save that would leave two
    // rotations equally in force, and which two is the whole story.
    toast({
      variant: "error",
      message:
        statusOf(err) === 403
          ? t("oncall.configDenied")
          : raw(serverMessageOf(err)) || t("oncall.laneDeleteFailed"),
    });
  }
}

/// A hand-edited policy still pages the rotation, so the remove waits for the policy edit.
function openPolicyFromRemove() {
  rotationToDelete.value = null;
  activeTab.value = "policy";
  void openPolicyEditor();
}

/// Every way into the cover dialog goes through one of these three, because
/// the dialog carries state from whoever opened it — a gap to fill, a person
/// to pre-select — and an opener that sets one without clearing the other
/// offers the last caller's errand to this one.

/// Somebody else covers a window nobody holds: the hole is known, the person
/// is the open question.
async function onFillGap(gap: ResolvedSegment) {
  await openCoverDialog({ gap: fromNow(await realSpan(gap)), rotation: gap.rotation_id });
}

/// A lane's own "Add a cover": the rotation is decided, the window and person are not.
function openCoverFor(rotationId: string) {
  void openCoverDialog({ rotation: rotationId });
}

async function openCoverDialog(opts: {
  gap?: { from: number; to: number } | null;
  user?: string;
  rotation?: string;
  mode?: "cover" | "swap";
  swapFrom?: { rotationId: string; at: number } | null;
  holder?: string | null;
}) {
  swapShifts.value = await loadSwapShifts(opts.swapFrom ?? null);
  if (licenseDenied.value) return;
  coverGap.value = opts.gap ?? null;
  coverDefaultUser.value = opts.user ?? "";
  coverRotation.value = opts.rotation ?? "";
  coverMode.value = opts.mode ?? "cover";
  coverSwapFrom.value = opts.swapFrom ?? null;
  coverHolder.value = opts.holder ?? null;
  coverOpen.value = true;
}

function resolveCoverRuns(rotationId: string, from: number, to: number) {
  return read<ResolvedSegment[]>(
    resolvedScheduleQuery(orgId.value, teamId.value, from, to, rotationId),
    false,
  );
}

let latestSpansRead = 0;

/// Only bands cut by the calendar's edges need a second read, at most two per rotation.
async function fetchShiftSpans(list: ResolvedSegment[]) {
  const readId = ++latestSpansRead;
  const window = scheduleWindow.value;
  const cut = list.filter((segment) => segment.user_email && shiftLookupWindow(segment, window));
  const entries = await Promise.all(
    cut.map(async (segment) => [segmentSpanKey(segment), await realSpan(segment)] as const),
  );
  if (readId === latestSpansRead) shiftSpans.value = Object.fromEntries(entries);
}

/// From now, never from a shift's past: a cover or an absence over hours that are gone pages nobody.
function fromNow(span: { from: number; to: number }): { from: number; to: number } {
  return { from: Math.max(span.from, Date.now() * 1000), to: span.to };
}

/// The whole shift behind a drawn band: the calendar's read stops at its edges, so a band there is cut.
async function realSpan(segment: ResolvedSegment): Promise<{ from: number; to: number }> {
  const lookup = shiftLookupWindow(segment, scheduleWindow.value);
  if (!lookup) return { from: segment.from, to: segment.to };
  try {
    const runs = await read<ResolvedSegment[]>(
      resolvedScheduleQuery(orgId.value, teamId.value, lookup.from, lookup.to, segment.rotation_id),
      false,
    );
    return shiftAround(segment, runs);
  } catch {
    return { from: segment.from, to: segment.to };
  }
}

async function onShiftAction(action: ShiftAction, segment: ResolvedSegment) {
  const who = segment.user_email ?? "";
  const span = await realSpan(segment);
  if (licenseDenied.value) return;
  if (action === "away") {
    awayEmail.value = who;
    awayWindow.value = fromNow(span);
    awayOpen.value = true;
    return;
  }
  await openCoverDialog({
    gap: action === "cover" ? fromNow(span) : null,
    rotation: segment.rotation_id,
    mode: action === "swap" ? "swap" : "cover",
    swapFrom: { rotationId: segment.rotation_id, at: span.from },
    holder: who || null,
  });
}

async function onAwaySaved() {
  await Promise.allSettled([fetchSegments(), fetchAbsences()]);
}

const deleteAbsenceWrite = useMutation(() => deleteUnavailabilityMutation(orgId.value));

/// The absence the away lane asked to clear; it applies on every team, so it is confirmed first.
const awayToClear = ref<string | null>(null);
const clearingAway = computed(
  () => teamAbsences.value.find((absence) => absence.id === awayToClear.value) ?? null,
);
const clearingAwayRange = computed(() => {
  const absence = clearingAway.value;
  if (!absence) return raw("");
  return raw(formatDayRange(absence.start_at, absence.end_at, team.value?.timezone ?? "UTC"));
});

/// The Members tab's removal, reached from the away lane.
async function confirmClearAway() {
  const absenceId = awayToClear.value;
  awayToClear.value = null;
  if (!absenceId) return;
  try {
    await deleteAbsenceWrite.mutateAsync(absenceId);
    toast({ variant: "success", message: t("oncall.awayRemoved") });
    await onAwaySaved();
  } catch (err: unknown) {
    noteConfigurationDenied(err);
    toast({
      variant: "error",
      message:
        statusOf(err) === 403
          ? t("oncall.configDenied")
          : raw(serverMessageOf(err)) || t("oncall.awayRemoveFailed"),
    });
  }
}

/// The header offers to cover a shift, so the reader is the person being
/// pre-filled — the dialog opens on the answer they came to give. The window is
/// left blank
/// on purpose: "until when" has no safe default, and a cover silently saved
/// over the wrong hours reassigns a night nobody agreed to. The form drops the
/// pre-fill when the reader is not on this team, which is why the picker is
/// still a picker.
function openTakeOverride() {
  void openCoverDialog({ user: selfEmail.value });
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
/// The team's rotations, in schedule order. Every surface that used to ask
/// "which slots does this team staff" asks this instead — a slot could exist
/// because something derived it, and a rotation cannot.
const teamRotations = computed(() => schedule.value?.rotations ?? []);

/// The weeks a swap can trade, one run per rotation.
///
/// Taken from the rotation's WINNING shift rule: that is the roster actually on
/// duty, and it is the only sequence a cover can be written against. A rule
/// that is out of force at `now` has no upcoming weeks to trade, and offering
/// them would write covers over a position that rule does not staff.
const swappableShifts = computed<UpcomingShift[]>(() => {
  const rotations = schedule.value?.rotations ?? [];
  if (!rotations.length) return [];
  const now = Date.now() * 1000;
  const zone = schedule.value?.timezone || team.value?.timezone || "UTC";
  return rotations.flatMap((rotation) => {
    const rule = winningRule(rotation, now, zone);
    if (!rule) return [];
    return upcomingShifts(rule, now, SWAPPABLE_SHIFTS, zone).map((shift) => ({
      ...shift,
      rotationId: rotation.id,
      rotationName: rotation.name,
    }));
  });
});

const swapRotationIds = computed(() => [
  ...new Set(swappableShifts.value.map((s) => s.rotationId)),
]);

/// What the swap picker offers, read from the resolved schedule so active hours and covers are already applied.
const swapShifts = ref<UpcomingShift[]>([]);

/// From the clicked shift when there is one, otherwise from the current hour, which keeps repeat opens on one cached read.
async function loadSwapShifts(
  anchor: { rotationId: string; at: number } | null,
): Promise<UpcomingShift[]> {
  const now = Date.now() * 1000;
  const start = anchor ? anchor.at : Math.floor(now / MICROS_PER_HOUR) * MICROS_PER_HOUR;
  const rotations = teamRotations.value.filter(
    (rotation) =>
      swapRotationIds.value.includes(rotation.id) && (!anchor || rotation.id === anchor.rotationId),
  );
  const lanes = await Promise.allSettled(
    rotations.map(async (rotation) => {
      const runs = await read<ResolvedSegment[]>(
        resolvedScheduleQuery(
          orgId.value,
          teamId.value,
          start,
          start + SHIFT_LOOKUP_MICROS,
          rotation.id,
        ),
        false,
      );
      return swappableRuns(runs, rotation, anchor ? start : now, SWAPPABLE_SHIFTS);
    }),
  );
  return lanes.flatMap((lane) => (lane.status === "fulfilled" ? lane.value : []));
}

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
  rotation_id?: string;
  covering_for?: string;
};

async function saveSwap(value: { first: SwapCover; second: SwapCover }) {
  coverSaving.value = true;
  let firstId: string | null = null;
  try {
    const created = await coverWrite.mutateAsync(value.first);
    firstId = created.data?.id ?? null;

    await coverWrite.mutateAsync(value.second);
    analytics.track("oncall_override_created", { kind: "swap" });

    coverOpen.value = false;
    toast({ variant: "success", message: t("oncall.swapSaved") });
    await refreshCoverage();
  } catch (err: unknown) {
    noteConfigurationDenied(err);
    const reason =
      statusOf(err) === 403
        ? t("oncall.configDenied")
        : raw(serverMessageOf(err)) || t("oncall.coverSaveFailed");
    // Nothing was written, so the server's own sentence is the whole story.
    if (!firstId) {
      toast({ variant: "error", message: reason });
      return;
    }
    try {
      await coverDeleteWrite.mutateAsync(firstId);
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

/// The dialog's own summary sentence on the team's calendar, so the toast and the form say one thing.
function coverSavedMessage(value: {
  user_email: string;
  start_at: number;
  end_at: number;
  rotation_id?: string;
  covering_for?: string;
}) {
  const rotation =
    teamRotations.value.find((one) => one.id === value.rotation_id)?.name ?? team.value?.name;
  const params = {
    name: raw(nameOf(value.user_email)),
    rotation: raw(rotation ?? ""),
    when: raw(formatDayRange(value.start_at, value.end_at, team.value?.timezone ?? "UTC")),
  };
  return value.covering_for
    ? t("oncall.coverSummaryFor", { ...params, holder: raw(nameOf(value.covering_for)) })
    : t("oncall.coverSummaryOn", params);
}

/// A cover takes a slot for a window; outside it the rotation resolves exactly
/// as before, which is what makes taking one safe.
async function saveCover(value: {
  user_email: string;
  start_at: number;
  end_at: number;
  rotation_id?: string;
  covering_for?: string;
}) {
  coverSaving.value = true;
  try {
    await coverWrite.mutateAsync(value);
    analytics.track("oncall_override_created", { kind: "cover" });
    coverOpen.value = false;
    coverGap.value = null;
    // The message is "{name} covers {team} · {range}" and it was called with no
    // params at all, so a successful save reported " covers  · ".
    toast({ variant: "success", message: coverSavedMessage(value) });
    await refreshCoverage();
  } catch (err: unknown) {
    noteConfigurationDenied(err);
    // Two of the server's sentences are worth showing verbatim, and both name
    // the thing that is wrong: a 409 says who already covers that window, and
    // a 400 says the team has no such rotation — a cover over a position
    // nothing staffs would page nobody.
    toast({
      variant: "error",
      message:
        statusOf(err) === 403
          ? t("oncall.configDenied")
          : raw(serverMessageOf(err)) || t("oncall.coverSaveFailed"),
    });
  } finally {
    coverSaving.value = false;
  }
}

/// Back to the resolved view on save: the point of saving is to see what the
/// engine now says, not to keep staring at the form.
/// The dry run for whichever priority is selected. Re-asked on every change,
/// because the answer depends on who is on call at THIS instant.
async function loadPreview(priority: number, force: boolean): Promise<EscalationPreview | null> {
  try {
    return await read<EscalationPreview | null>(
      escalationPreviewQuery(orgId.value, teamId.value, priority),
      force,
    );
  } catch {
    // One priority failing must not blank the strip that lets you pick another.
    return null;
  }
}

// The newest read: a slower dry run for a priority the reader has already left must not overwrite the current one.
let latestPreviewRead = 0;

async function fetchPreview(force = false) {
  const priority = Number(selectedPriority.value.replace(/\D/g, "")) || 1;
  const readId = ++latestPreviewRead;
  previewLoading.value = true;
  const answer = await loadPreview(priority, force);
  if (readId !== latestPreviewRead) return;
  preview.value = answer;
  previewLoading.value = false;
}

/// Back to the dry run on save — seeing whether the change actually reaches
/// anybody is the reason to have made it.
async function onPolicySaved() {
  editingPolicy.value = false;
  await fetchAll();
}

function openPresets(rotationId?: string) {
  presetsStartOn.value = rotationId ?? "";
  presetsOpen.value = true;
}

async function onScheduleSaved() {
  await fetchAll();
  await fetchSegments();
}

/// Sends nothing: the tabs and drawers read these only when they mount or open, so expiring is enough.
function expirePageReads() {
  const org = orgId.value;
  const expire = (queryKey: readonly unknown[], exact: boolean) =>
    queryClient.invalidateQueries({ queryKey, exact, refetchType: "none" });
  void expire(oncallKeys.all(org), false);
  void expire(userKeys.users(org), true);
  void expire(destinationKeys.list(org, "alert", false, ["jira"]), true);
  void expire(serviceStreamKeys.all(org), false);
}

const refreshing = ref(false);
// Bumped by Refresh: the tabs read only on mount, so the open one is remounted to read again.
const tabsKey = ref(0);

/// Refresh and the error state's Retry. The expiry runs first: clearing `loadError` can re-render the tabs.
async function refreshPage() {
  refreshing.value = true;
  try {
    expirePageReads();
    await fetchAll(true);
    tabsKey.value += 1;
  } finally {
    refreshing.value = false;
  }
}

/// Named rather than bound straight to the template: an event handler receives
/// the event as its first argument, and `force` would take it as a yes. A
/// child's `changed` is already covered by that write's own invalidation, so
/// these two stay unforced and only the reader's own Refresh, Retry and Recheck force.
const recheckInsights = () => fetchInsights(true);
const onMembersChanged = () => Promise.allSettled([fetchAll(), fetchAbsences()]);
const onCoversChanged = () => fetchSegments();

async function onTeamSaved(_teamId: string, makeDefault = false) {
  editOpen.value = false;
  if (makeDefault && team.value) await setDefaultTeam(team.value);
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

// Wrapped: a watcher hands the callback the new value, which `force` would read
// as a yes and turn every window move into a forced refetch.
watch(
  scheduleWindow,
  () => {
    fetchSegments();
    fetchAbsences();
  },
  { deep: true },
);
watch(selectedPriority, () => fetchPreview());

onMounted(() => {
  fetchAll();
  loadDefaultTeam().then((denied) => denied && lockPage(denied));
});
</script>
