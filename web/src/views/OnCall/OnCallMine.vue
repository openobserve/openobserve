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

<!-- The reader's own on-call: their shifts, how pages reach them, and what has been sent to them. -->
<template>
  <OPageLayout bleed data-test="oncall-mine-page" :title="t('oncall.mineTitle')" icon="person">
    <template #title-trail>
      <BetaBadge class="shrink-0" />
    </template>
    <template #actions>
      <!-- Personal and org-wide, so it heads the page rather than sitting under one team. -->
      <!-- Away only takes someone off a team's rotation, so a reader on no team has nothing to mark. -->
      <OButton
        v-if="!unavailable && !licenseDenied && (!loaded || (mine?.teams ?? []).length)"
        variant="outline"
        size="sm"
        :disabled="!loaded"
        data-test="oncall-mine-away"
        @click="openAway"
      >
        <OIcon name="event-busy" size="sm" />{{ t("oncall.mineAway") }}
      </OButton>
      <OButton
        v-if="!unavailable && !licenseDenied && myAway"
        variant="outline"
        size="sm"
        :loading="awayClearing"
        data-test="oncall-mine-clear-away"
        @click="clearAway"
      >
        <OTooltip side="bottom" :content="myAwayLabel" />
        <OIcon name="event-available" size="sm" />{{ t("oncall.awayClear") }}
      </OButton>
      <ORefreshButton
        v-if="!unavailable && !licenseDenied"
        class="md:min-w-23"
        layout="inline"
        size="header"
        variant="outline"
        :last-run-at="lastFetchedAt"
        :loading="refreshing || !loaded"
        data-test="oncall-mine-refresh"
        @click="refreshPage"
      />
    </template>

    <OEmptyState
      v-if="unavailable"
      size="hero"
      icon="cloud-off"
      :title="t('oncall.notAvailableTitle')"
      :description="t('oncall.notAvailableDescription')"
      data-test="oncall-mine-unavailable"
    />

    <LicenseDeniedState
      v-else-if="licenseDenied"
      :features="licenseDenied"
      data-test="oncall-mine-license-denied"
    />

    <OContent
      v-else
      y
      class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto"
      data-test="oncall-mine-body"
    >
      <OnCallSetupBanner ref="setupRef" class="shrink-0" @license-denied="licenseDenied = $event" />
      <div class="grid shrink-0 grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
        <!-- The shift first: "am I on call, and until when" is the question this page opens on. -->
        <section
          class="rounded-surface bg-surface-base border-border-default table-last-row-flush flex min-w-0 flex-col overflow-hidden border"
          data-test="oncall-mine-teams"
        >
          <div class="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
            <OText variant="card-title" as="h2" data-test="oncall-mine-shift-headline">
              {{ t("oncall.mineShiftsTitle") }}
            </OText>
            <OSkeleton v-if="!loaded" class="h-5 w-16 rounded-full" />
            <OTag
              v-else-if="loadError === null && (mine?.teams ?? []).length"
              :variant="mine?.on_call_now ? 'success-soft' : 'default-soft'"
              size="sm"
              data-test="oncall-mine-on-call"
            >
              {{ mine?.on_call_now ? t("oncall.mineDutyOn") : t("oncall.mineDutyOff") }}
            </OTag>
            <OText variant="meta" class="ms-auto" data-test="oncall-mine-zone">
              {{ t("oncall.timesInZone", { zone: raw(store.state.timezone) }) }}
            </OText>
          </div>

          <OEmptyState
            v-if="loadError !== null"
            size="inline"
            variant="error"
            :title="t('oncall.mineTeamsLoadFailed')"
            :description="raw(loadError)"
            :action-label="t('oncall.retry')"
            data-test="oncall-mine-teams-error"
            @action="refreshPage"
          />

          <OEmptyState
            v-else-if="loaded && !shiftRows.length"
            size="inline"
            icon="group"
            :title="t('oncall.mineNoTeams')"
            :action-label="t('oncall.mineOpenTeams')"
            action-icon="group"
            data-test="oncall-mine-no-teams"
            @action="openTeams"
          />

          <div v-else-if="isMobile" class="flex flex-col" data-test="oncall-mine-shifts-list">
            <template v-if="!loaded">
              <div
                v-for="n in MOBILE_SKELETON_ROWS"
                :key="n"
                class="border-border-default flex flex-col gap-2 border-t px-4 py-3"
              >
                <OSkeleton class="h-4 w-40" />
                <OSkeleton class="h-3 w-28" />
              </div>
            </template>
            <div
              v-for="row in loaded ? shiftRows : []"
              :key="row.team_id"
              class="border-border-default flex items-center gap-3 border-t px-4 py-3"
              :data-test="`oncall-mine-shift-row-${row.team_id}`"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex min-w-0 items-center gap-2">
                  <router-link
                    class="text-accent min-w-0 text-sm font-medium hover:underline"
                    :to="teamRoute(row.team_id)"
                    :data-test="`oncall-mine-team-${row.team_id}`"
                  >
                    <OTruncatedText class="block">{{ raw(row.team_name) }}</OTruncatedText>
                  </router-link>
                  <OTag
                    :variant="seatVariant(row)"
                    size="sm"
                    class="shrink-0"
                    :data-test="`oncall-mine-duty-${row.team_id}`"
                  >
                    {{ seatLabel(row) }}
                  </OTag>
                  <OnCallHint
                    v-if="row.roles.length > 1"
                    :hint="t('oncall.mineNoBackup')"
                    icon="warning"
                    icon-class="text-status-warning-text"
                    :data-test="`oncall-mine-no-backup-${row.team_id}`"
                  />
                </span>
                <OText
                  v-if="untilLine(row)"
                  variant="meta"
                  as="span"
                  class="truncate"
                  :data-test="`oncall-mine-shift-${row.team_id}`"
                >
                  {{ untilLine(row) }}
                  <template v-if="countdown(row)">
                    {{ raw("·") }} {{ t("oncall.mineShiftLeft", { left: raw(countdown(row)) }) }}
                  </template>
                </OText>
                <span
                  v-if="row.on_call_now === true && row.next"
                  class="text-text-secondary flex min-w-0 items-center gap-1 text-xs"
                >
                  {{ t("oncall.mineThen") }}
                  <OnCallPersonName
                    class="min-w-0 truncate"
                    :email="row.next"
                    :data-test="`oncall-mine-next-${row.team_id}`"
                  />
                </span>
              </div>
              <!-- Off duty leaves only the test page, and a menu of one is a button. -->
              <ODropdown v-if="canCover(row)" side="bottom" align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    icon-left="more-vert"
                    :loading="coverLoadingId === row.team_id || testingId === row.team_id"
                    :aria-label="t('oncall.moreActions')"
                    :data-test="`oncall-mine-row-menu-${row.team_id}`"
                  />
                </template>
                <ODropdownItem
                  icon-left="person-add"
                  :data-test="`oncall-mine-cover-${row.team_id}-menu`"
                  @select="openCover(row)"
                >
                  {{ t("oncall.mineCoverShift") }}
                </ODropdownItem>
                <ODropdownItem
                  icon-left="campaign"
                  :data-test="`oncall-mine-test-page-${row.team_id}-menu`"
                  @select="askTestPage(row.team_id)"
                >
                  {{ t("oncall.mineTestTeam", { team: raw(row.team_name) }) }}
                </ODropdownItem>
              </ODropdown>
              <OButton
                v-else
                variant="ghost"
                size="icon-sm"
                :loading="testingId === row.team_id"
                :aria-label="t('oncall.mineTestTeam', { team: raw(row.team_name) })"
                :data-test="`oncall-mine-test-page-${row.team_id}`"
                @click="askTestPage(row.team_id)"
              >
                <OIcon name="campaign" size="sm" aria-hidden="true" />
                <OTooltip :content="t('oncall.mineTestTeam', { team: raw(row.team_name) })" />
              </OButton>
            </div>
          </div>

          <!-- Scroll events do not bubble, so the frame listens in the capture phase to the table's own scroller. -->
          <div
            v-else
            class="relative h-55.5 shrink-0"
            data-test="oncall-mine-shifts-frame"
            @scroll.capture="onShiftsScroll"
          >
            <OTable
              :data="shiftRows"
              :columns="shiftColumns"
              row-key="team_id"
              :frame="false"
              :loading="!loaded"
              :skeleton-rows="SHIFTS_SKELETON_ROWS"
              :show-global-filter="false"
              pagination="none"
              table-id="oncall-mine-shifts"
              data-test="oncall-mine-shifts-table"
            >
              <template #cell-team="{ row }">
                <router-link
                  class="text-accent inline-block max-w-full text-sm font-medium hover:underline"
                  :to="teamRoute(row.team_id)"
                  :data-test="`oncall-mine-team-${row.team_id}`"
                >
                  <OTruncatedText class="block">{{ raw(row.team_name) }}</OTruncatedText>
                </router-link>
              </template>
              <!-- Null with an unresolved schedule is "we could not work it out", never "off duty". -->
              <template #cell-seat="{ row }">
                <span class="flex flex-wrap items-center gap-1">
                  <OTag
                    :variant="seatVariant(row)"
                    size="sm"
                    :data-test="`oncall-mine-duty-${row.team_id}`"
                  >
                    {{ seatLabel(row) }}
                  </OTag>
                  <OnCallHint
                    v-if="row.roles.length > 1"
                    :hint="t('oncall.mineNoBackup')"
                    icon="warning"
                    icon-class="text-status-warning-text"
                    :data-test="`oncall-mine-no-backup-${row.team_id}`"
                  />
                </span>
              </template>
              <template #cell-until="{ row }">
                <span
                  v-if="untilLine(row)"
                  class="flex min-w-0 flex-col"
                  :data-test="`oncall-mine-shift-${row.team_id}`"
                >
                  <OText variant="body" as="span" class="whitespace-nowrap">
                    {{ untilLine(row) }}
                    <OTooltip :content="raw(fullAt(untilAt(row)))" />
                  </OText>
                  <OText v-if="countdown(row)" variant="meta" as="span">
                    {{ t("oncall.mineShiftLeft", { left: raw(countdown(row)) }) }}
                  </OText>
                </span>
                <OText v-else variant="meta" as="span">{{ raw("—") }}</OText>
              </template>
              <template #cell-then="{ row }">
                <OnCallPersonName
                  v-if="row.on_call_now === true && row.next"
                  class="block min-w-0 truncate"
                  :email="row.next"
                  :data-test="`oncall-mine-next-${row.team_id}`"
                />
                <OText v-else variant="meta" as="span">{{ raw("—") }}</OText>
              </template>
              <template #cell-row-actions="{ row }">
                <div class="flex items-center justify-center">
                  <OButton
                    v-if="canCover(row)"
                    variant="ghost"
                    size="icon-sm"
                    :loading="coverLoadingId === row.team_id"
                    :aria-label="t('oncall.mineCoverShift')"
                    :data-test="`oncall-mine-cover-${row.team_id}`"
                    @click="openCover(row)"
                  >
                    <OIcon name="person-add" size="sm" aria-hidden="true" />
                    <OTooltip :content="t('oncall.mineCoverShift')" />
                  </OButton>
                  <span v-else class="size-8 shrink-0" aria-hidden="true" />
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    :loading="testingId === row.team_id"
                    :aria-label="t('oncall.mineTestTeam', { team: raw(row.team_name) })"
                    :data-test="`oncall-mine-test-page-${row.team_id}`"
                    @click="askTestPage(row.team_id)"
                  >
                    <OIcon name="campaign" size="sm" aria-hidden="true" />
                    <OTooltip :content="t('oncall.mineTestTeam', { team: raw(row.team_name) })" />
                  </OButton>
                </div>
              </template>
            </OTable>
            <div
              v-if="loaded && shiftsBelow > 0"
              class="from-surface-base pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-linear-to-t from-40% to-transparent pb-1.5"
              data-test="oncall-mine-shifts-more"
            >
              <OTag
                variant="default"
                size="sm"
                shape="pill"
                icon="expand-more"
                class="shadow-xs"
                :label="t('oncall.mineShiftsMore', { count: shiftsBelow }, shiftsBelow)"
              />
            </div>
          </div>
        </section>

        <section
          class="rounded-surface bg-surface-base border-border-default flex min-w-0 flex-col border px-4 pt-2 pb-3"
          data-test="oncall-mine-reach"
        >
          <div class="flex min-h-10 items-center">
            <OText variant="card-title" as="h2">{{ t("oncall.mineReachTitle") }}</OText>
          </div>
          <OnCallReachRow
            :label="t('oncall.channel_email')"
            icon="mail"
            data-test="oncall-mine-reach-email"
          >
            <template #value>
              <OTruncatedText class="text-text-body text-sm">{{ raw(viewerEmail) }}</OTruncatedText>
            </template>
            <template #status>
              <OTag variant="success-soft" size="sm">{{ t("oncall.reachAlwaysOn") }}</OTag>
            </template>
          </OnCallReachRow>
          <OnCallPhoneCard
            ref="phoneRef"
            :admin="isAdmin"
            @license-denied="licenseDenied = $event"
          />
          <OnCallSlackCard v-if="slackOffered" ref="slackRef" :admin="isAdmin" />
        </section>
      </div>

      <OnCallMyDeliveries
        ref="deliveriesRef"
        :team-names="teamNames"
        :teams-state="teamsState"
        :test-team-name="testTeam?.team_name ?? null"
        :can-test="!!testTeam"
        :no-team="loaded && loadError === null && !(mine?.teams ?? []).length"
        @test-page="askTestPage(testTeam?.team_id ?? '')"
        @join-team="openTeams"
        @license-denied="licenseDenied = $event"
      />
    </OContent>

    <ConfirmDialog
      :model-value="testConfirmOpen"
      :title="t('oncall.testPageConfirmTitle')"
      :message="t('oncall.setupTestConfirm', { team: raw(testTarget?.team_name ?? '') })"
      :ok-label="t('oncall.setupStep5Cta')"
      @update:ok="sendTestPage"
      @update:cancel="testConfirmOpen = false"
    />

    <OnCallCoverForm
      v-model:open="coverOpen"
      :members="coverMembers"
      :timezone="coverTeam?.timezone ?? 'UTC'"
      :viewer-timezone="store.state.timezone"
      :team-name="coverTeam?.team_name ?? ''"
      :saving="coverSaving"
      :current-holder="viewerEmail"
      :gap="coverGap"
      :rotations="coverRotations"
      :default-rotation="coverTeam?.rotationId ?? ''"
      :resolve-runs="resolveCoverRuns"
      @save="saveCover"
    />

    <ODialog
      :open="awayOpen"
      :title="t('oncall.mineAway')"
      data-test="oncall-mine-away-dialog"
      @update:open="(v: boolean) => (awayOpen = v)"
    >
      <div class="flex flex-col gap-3">
        <OText variant="meta">{{ t("oncall.mineAwayHint") }}</OText>
        <div class="flex flex-col gap-1">
          <OText variant="body-strong" as="span">{{ t("oncall.awayFrom") }}</OText>
          <div class="flex gap-2">
            <ODate
              v-model="awayFromDate"
              class="min-w-0 flex-1"
              data-test="oncall-mine-away-from-date"
            />
            <OTime
              v-model="awayFromTime"
              class="min-w-0 flex-1"
              data-test="oncall-mine-away-from-time"
            />
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <OText variant="body-strong" as="span">{{ t("oncall.awayTo") }}</OText>
          <div class="flex gap-2">
            <ODate
              v-model="awayToDate"
              class="min-w-0 flex-1"
              data-test="oncall-mine-away-to-date"
            />
            <OTime
              v-model="awayToTime"
              class="min-w-0 flex-1"
              data-test="oncall-mine-away-to-time"
            />
          </div>
        </div>
        <OInput
          v-model="awayReason"
          :label="t('oncall.awayReason')"
          :placeholder="t('oncall.awayReasonPlaceholder')"
          data-test="oncall-mine-away-reason"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <OButton variant="outline" size="sm-action" @click="awayOpen = false">
            {{ t("oncall.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :loading="awaySaving"
            :disabled="!awayValid"
            :focusable-unavailable="!awayValid"
            data-test="oncall-mine-away-save"
            @click="saveAway"
          >
            {{ t("oncall.mineAwaySave") }}
            <template v-if="!awayValid" #unavailable-reason>{{
              t("oncall.mineAwayPickTimes")
            }}</template>
          </OButton>
          <OTooltip v-if="!awayValid" :content="t('oncall.mineAwayPickTimes')" />
        </div>
      </template>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import OnCallCoverForm from "@/components/oncall/OnCallCoverForm.vue";
import OnCallHint from "@/components/oncall/OnCallHint.vue";
import OnCallMyDeliveries from "@/components/oncall/OnCallMyDeliveries.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallPhoneCard from "@/components/oncall/OnCallPhoneCard.vue";
import OnCallReachRow from "@/components/oncall/OnCallReachRow.vue";
import OnCallSetupBanner from "@/components/oncall/OnCallSetupBanner.vue";
import OnCallSlackCard from "@/components/oncall/OnCallSlackCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODate from "@/lib/forms/Date/ODate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { queryClient } from "@/composables/query/queryClient";
import { readQuery } from "@/composables/query/readQuery";
import { useOnCallClock } from "@/composables/useOnCallClock";
import {
  createOverrideMutation,
  createUnavailabilityMutation,
  deleteUnavailabilityMutation,
  myOnCallQuery,
  oncallTeamsQuery,
  resolvedScheduleQuery,
  teamMembersQuery,
  teamScheduleQuery,
  testPageMutation,
  unavailabilityQuery,
  whoIsOnCallQuery,
} from "@/services/oncall.queries";
import { orgUsersQuery } from "@/services/users.queries";
import type {
  MyOnCall,
  MyOnCallTeam,
  OnCallTeamMember,
  ResolvedSegment,
  Rotation,
  Unavailability,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  apiErrorMessage,
  apiErrorStatus,
  apiErrorText,
  fromZonedInputValue,
  isOnCallUnavailable,
  testPageOutcome,
} from "@/utils/oncall";
import { readSlackOrgConfig } from "@/utils/slackSettings";

/// How far ahead the shift card looks for the end of this shift and the next one.
const SHIFT_LOOKAHEAD_MICROS = 14 * 24 * 60 * 60 * 1_000_000;

/** What the schedule says about the reader on one team; every field is absent when its read was refused. */
interface ShiftFacts {
  roles: string[];
  rotationId: string | null;
  until: number | null;
  next: string | null;
  nextShiftAt: number | null;
}

/** One row of "Your shifts": the team as the server reports it, plus what its schedule said. */
type ShiftRow = MyOnCallTeam & ShiftFacts;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const nowMicros = useOnCallClock();
const orgId = computed(() => store.state.selectedOrganization.identifier);
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? ""));

const orgUsers = useQuery(() =>
  Object.assign(orgUsersQuery(orgId.value), { enabled: !!orgId.value }),
);
// Visibility only: the server is the gate, this decides whether a setup button would help or 403.
const isAdmin = computed(() => {
  const me = viewerEmail.value.toLowerCase();
  const listed = (orgUsers.data.value ?? []).find(
    (user: { email?: string }) => String(user.email ?? "").toLowerCase() === me,
  );
  const role = String(listed?.role ?? store.state.currentuser?.role ?? "").toLowerCase();
  return role === "admin" || role === "root";
});

const mine = ref<MyOnCall | null>(null);
const shifts = ref<Record<string, ShiftFacts>>({});
const loaded = ref(false);
const lastFetchedAt = ref<number | null>(null);
const unavailable = ref(false);
const licenseDenied = ref<string[] | null>(null);
/// Set only when the first load fails; a failed refresh keeps the teams on screen instead.
const loadError = ref<string | null>(null);

// Any read can carry the denial, because the others may be answered from cache; the callers still see the error.
const read: typeof readQuery = (options, force) =>
  readQuery(options, force).catch((err: unknown) => {
    licenseDenied.value = licenseDeniedFeatures(err) ?? licenseDenied.value;
    throw err;
  });

/// Every team's name, not only the reader's own: a page handed over from another team still names its team.
const orgTeamNames = ref<Record<string, string>>({});
const teamNames = computed(() => ({
  ...orgTeamNames.value,
  ...Object.fromEntries((mine.value?.teams ?? []).map((team) => [team.team_id, team.team_name])),
}));

const teamsState = ref<"pending" | "loaded" | "failed">("pending");

async function fetchTeamNames(force = false) {
  try {
    const teams = await read(oncallTeamsQuery(orgId.value), force);
    orgTeamNames.value = Object.fromEntries(teams.map((team) => [team.id, team.name]));
    teamsState.value = "loaded";
  } catch {
    // Without the team list the reader's own teams still name themselves.
    if (teamsState.value === "pending") teamsState.value = "failed";
  }
}

const NO_FACTS: ShiftFacts = {
  roles: [],
  rotationId: null,
  until: null,
  next: null,
  nextShiftAt: null,
};

/// The instant the Until column shows: the end of a held shift, the start of the next one, else unknown.
function untilAt(row: ShiftRow): number {
  if (row.on_call_now === true && row.until !== null) return row.until;
  if (row.on_call_now === false && row.nextShiftAt !== null) return row.nextShiftAt;
  return Number.POSITIVE_INFINITY;
}

/// Held seats first, then off-duty, then unknown: "am I on call" outranks "when is my next shift".
function dutyRank(row: ShiftRow): number {
  if (row.on_call_now === true) return 0;
  return row.on_call_now === false ? 1 : 2;
}

const shiftRows = computed<ShiftRow[]>(() =>
  (mine.value?.teams ?? [])
    .map((team) => ({ ...team, ...(shifts.value[team.team_id] ?? NO_FACTS) }))
    .sort(
      (a, b) =>
        dutyRank(a) - dutyRank(b) ||
        untilAt(a) - untilAt(b) ||
        a.team_name.localeCompare(b.team_name),
    ),
);

/// Same as the frame's five rows, so the first paint is the loaded height.
const SHIFTS_SKELETON_ROWS = 5;
/// Most readers hold one or two teams, so the phone list skeletons that many.
const MOBILE_SKELETON_ROWS = 2;

const { isMobile } = useBreakpoint();

/// Rows past the frame's fold; the fade and its count say the list goes on.
const shiftsBelow = ref(0);
watch(
  () => shiftRows.value.length,
  (count) => {
    shiftsBelow.value = Math.max(0, count - SHIFTS_SKELETON_ROWS);
  },
  { immediate: true },
);

function onShiftsScroll(event: Event) {
  const el = event.target as HTMLElement;
  const fold = el.scrollTop + el.clientHeight;
  const rows = [...el.querySelectorAll<HTMLElement>("tbody tr")];
  shiftsBelow.value = rows.filter((tr) => tr.offsetTop + tr.offsetHeight / 2 > fold).length;
}

function seatVariant(row: ShiftRow): "success-soft" | "default-soft" | "amber-soft" {
  if (row.on_call_now === true) return "success-soft";
  return row.on_call_now === false ? "default-soft" : "amber-soft";
}

/// Only a shift the reader holds now, with a known end, has a window to hand over.
const canCover = (row: ShiftRow) => row.on_call_now === true && row.until !== null;

const shiftColumns = computed<OTableColumnDef<ShiftRow>[]>(() => [
  {
    id: "team",
    header: t("oncall.team"),
    accessorFn: (row: ShiftRow) => row.team_name,
    size: 160,
    sortable: false,
    meta: { isName: true, flex: true },
  },
  { id: "seat", header: t("oncall.mineSeat"), size: 136, sortable: false },
  { id: "until", header: t("oncall.mineUntil"), size: 176, sortable: false },
  { id: "then", header: t("oncall.mineThen"), size: 160, sortable: false },
  // Not `isAction`/"actions": those pin the column, and a five-row card has nothing to scroll past.
  {
    id: "row-actions",
    header: t("oncall.actions"),
    sortable: false,
    size: 96,
    meta: { align: "center" },
  },
]);

/// The test page goes to a team the reader is on call for, else their first team.
const testTeam = computed(
  () =>
    (mine.value?.teams ?? []).find((team) => team.on_call_now === true) ??
    mine.value?.teams[0] ??
    null,
);

function seatLabel(row: ShiftRow): I18nText {
  if (row.on_call_now === true) {
    return row.roles.length ? raw(row.roles.join(" + ")) : t("oncall.mineDutyOn");
  }
  return row.on_call_now === false ? t("oncall.mineDutyOff") : t("oncall.mineDutyUnknown");
}

/// The lookahead is two weeks, so the cell drops the year to fit; the tooltip carries it.
function shortAt(micros: number): string {
  const zone = store.state.timezone;
  const day = (us: number) => formatTimestampInTimezone(us, "yyyy-MM-dd", zone);
  const pattern = day(micros) === day(nowMicros.value) ? "HH:mm" : "MMM d, HH:mm";
  return formatTimestampInTimezone(micros, pattern, zone);
}

function fullAt(micros: number): string {
  return formatTimestampInTimezone(micros, "MMM d, yyyy, HH:mm", store.state.timezone);
}

/// When the held stretch ends while on call, when the next one starts while off.
function untilLine(row: ShiftRow): I18nText | "" {
  if (row.on_call_now === true && row.until !== null) return raw(shortAt(row.until));
  if (row.on_call_now === false && row.nextShiftAt !== null) {
    return t("oncall.mineNextShift", { time: raw(shortAt(row.nextShiftAt)) });
  }
  return "";
}

/// Empty once the end has passed, so a stale row never reads "(—)" before the refresh lands.
function countdown(row: ShiftRow): string {
  if (row.on_call_now !== true || row.until === null) return "";
  const left = row.until - nowMicros.value;
  return left > 0 ? formatMicrosDuration(left) : "";
}

/// The current stretch the reader holds, merged across back-to-back segments, and who takes it next.
function shiftFromSegments(segments: ResolvedSegment[], me: string, now: number) {
  const sorted = [...segments].sort((a, b) => a.from - b.from);
  const isMe = (seg: ResolvedSegment) => (seg.user_email ?? "").toLowerCase() === me;
  let index = sorted.findIndex((seg) => seg.from <= now && seg.to > now && isMe(seg));
  if (index < 0) {
    const upcoming = sorted.find((seg) => seg.from > now && isMe(seg));
    return { until: null, next: null, nextShiftAt: upcoming?.from ?? null };
  }
  while (index + 1 < sorted.length && isMe(sorted[index + 1])) index += 1;
  return {
    until: sorted[index].to,
    next: sorted[index + 1]?.user_email ?? null,
    nextShiftAt: null,
  };
}

/// Role, shift end and who is next need the team's schedule reads; a role without them sees only the duty tag.
async function fetchShifts(force = false) {
  const me = viewerEmail.value.toLowerCase();
  const now = Date.now() * 1000;
  const teams = mine.value?.teams ?? [];
  const entries = await Promise.all(
    teams.map(async (team): Promise<[string, ShiftFacts] | null> => {
      try {
        // Off duty holds no seat, so only a held shift needs the who-is-on-call read.
        const positions =
          team.on_call_now === false
            ? []
            : await read(whoIsOnCallQuery(orgId.value, team.team_id), force);
        const held = positions.filter((p) => p.user_email.toLowerCase() === me);
        const segments = await read(
          resolvedScheduleQuery(
            orgId.value,
            team.team_id,
            now,
            now + SHIFT_LOOKAHEAD_MICROS,
            held[0]?.rotation_id,
          ),
          force,
        ).catch(() => [] as ResolvedSegment[]);
        return [
          team.team_id,
          {
            roles: [...new Set(held.map((p) => p.rotation_name))],
            rotationId: held[0]?.rotation_id ?? null,
            ...shiftFromSegments(segments, me, now),
          },
        ];
      } catch {
        return null;
      }
    }),
  );
  shifts.value = Object.fromEntries(entries.filter((e): e is [string, ShiftFacts] => !!e));
}

async function fetchMine(force = false) {
  try {
    const options = myOnCallQuery(orgId.value);
    mine.value = await read(options, force);
    loadError.value = null;
    lastFetchedAt.value = queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? null;
    await Promise.all([fetchShifts(force), fetchTeamNames(force), fetchMyAway(force)]);
  } catch (err: unknown) {
    // Ahead of the refresh rule below: a lock says why the teams went, so nobody reads it as off duty.
    if (licenseDenied.value) return;
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      mine.value = null;
      return;
    }
    // A failed refresh keeps what is on screen: blanking it would tell an on-call engineer they are off duty.
    if (loaded.value) {
      toast({
        variant: "error",
        message: raw(apiErrorMessage(err)) || t("oncall.refreshFailed"),
      });
      return;
    }
    mine.value = null;
    loadError.value = apiErrorText(err);
  } finally {
    loaded.value = true;
  }
}

function teamRoute(teamId: string) {
  return { name: "onCallTeamDetail", params: { teamId }, query: { org_identifier: orgId.value } };
}

function openTeams() {
  router.push({ name: "onCallTeams", query: { org_identifier: orgId.value } });
}

const coverOpen = ref(false);
const coverTeam = ref<ShiftRow | null>(null);
const coverMembers = ref<OnCallTeamMember[]>([]);
const coverRotations = ref<Rotation[]>([]);
const coverGap = ref<{ from: number; to: number } | null>(null);
const coverLoadingId = ref("");
const coverSaving = ref(false);
const coverWrite = useMutation(() =>
  createOverrideMutation(orgId.value, coverTeam.value?.team_id ?? ""),
);

function resolveCoverRuns(rotationId: string, from: number, to: number) {
  return read(
    resolvedScheduleQuery(orgId.value, coverTeam.value?.team_id ?? "", from, to, rotationId),
    false,
  );
}

/// Opens the team's cover form on the reader's own seat, from now to the end of the shift.
async function openCover(row: ShiftRow) {
  if (row.until === null) return;
  coverLoadingId.value = row.team_id;
  try {
    const [members, schedule] = await Promise.all([
      read(teamMembersQuery(orgId.value, row.team_id), false),
      read(teamScheduleQuery(orgId.value, row.team_id), false),
    ]);
    coverTeam.value = row;
    coverMembers.value = members;
    coverRotations.value = schedule?.rotations ?? [];
    coverGap.value = { from: Math.max(Date.now() * 1000, nowMicros.value), to: row.until };
    coverOpen.value = true;
  } catch (err: unknown) {
    if (licenseDenied.value) return;
    toast({
      variant: "error",
      message:
        apiErrorStatus(err) === 403
          ? t("oncall.configDenied")
          : raw(apiErrorMessage(err)) || t("oncall.coverSaveFailed"),
    });
  } finally {
    coverLoadingId.value = "";
  }
}

async function saveCover(value: {
  user_email: string;
  start_at: number;
  end_at: number;
  rotation_id?: string;
}) {
  coverSaving.value = true;
  try {
    await coverWrite.mutateAsync(value);
    coverOpen.value = false;
    toast({ variant: "success", message: t("oncall.mineCoverSaved") });
    await fetchMine(true);
  } catch (err: unknown) {
    toast({
      variant: "error",
      message:
        apiErrorStatus(err) === 403
          ? t("oncall.configDenied")
          : raw(apiErrorMessage(err)) || t("oncall.coverSaveFailed"),
    });
  } finally {
    coverSaving.value = false;
  }
}

const testConfirmOpen = ref(false);
const testTargetId = ref("");
const testingId = ref("");
const testWrite = useMutation(() => testPageMutation(orgId.value));
const testTarget = computed(
  () => (mine.value?.teams ?? []).find((team) => team.team_id === testTargetId.value) ?? null,
);

function askTestPage(teamId: string) {
  if (!teamId) return;
  testTargetId.value = teamId;
  testConfirmOpen.value = true;
}

async function sendTestPage() {
  testConfirmOpen.value = false;
  const team = testTarget.value;
  if (!team) return;
  testingId.value = team.team_id;
  try {
    const res = await testWrite.mutateAsync({ teamId: team.team_id });
    const outcome = testPageOutcome(res.data, t);
    toast({ variant: outcome.variant, message: outcome.message });
  } catch (err: unknown) {
    toast({
      variant: "error",
      message:
        apiErrorStatus(err) === 403
          ? t("oncall.configDenied")
          : raw(apiErrorMessage(err)) || t("oncall.testPageFailed"),
    });
  } finally {
    testingId.value = "";
  }
}

const awayOpen = ref(false);
const awayFromDate = ref("");
const awayFromTime = ref("");
const awayToDate = ref("");
const awayToTime = ref("");
const awayReason = ref("");
const awaySaving = ref(false);
const awayWrite = useMutation(() => createUnavailabilityMutation(orgId.value));

function zonedMicros(date: string, time: string): number | null {
  if (!date || !time) return null;
  return fromZonedInputValue(`${date}T${time}`, store.state.timezone);
}

const awayValid = computed(() => {
  const from = zonedMicros(awayFromDate.value, awayFromTime.value);
  const to = zonedMicros(awayToDate.value, awayToTime.value);
  return from !== null && to !== null && to > from;
});

function openAway() {
  awayFromDate.value = "";
  awayFromTime.value = "";
  awayToDate.value = "";
  awayToTime.value = "";
  awayReason.value = "";
  awayOpen.value = true;
}

/// No `user_email`: the server reads that as the caller, which needs no admin role.
async function saveAway() {
  const from = zonedMicros(awayFromDate.value, awayFromTime.value);
  const to = zonedMicros(awayToDate.value, awayToTime.value);
  if (from === null || to === null) return;
  awaySaving.value = true;
  try {
    await awayWrite.mutateAsync({
      start_at: from,
      end_at: to,
      ...(awayReason.value.trim() ? { reason: awayReason.value.trim() } : {}),
    });
    awayOpen.value = false;
    toast({ variant: "success", message: t("oncall.mineAwaySaved") });
    await fetchMine(true);
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.awaySaveFailed"),
    });
  } finally {
    awaySaving.value = false;
  }
}

const refreshing = ref(false);
const deliveriesRef = ref<{ refresh: () => Promise<void> } | null>(null);
const phoneRef = ref<{ refresh: () => Promise<void> } | null>(null);
const slackRef = ref<{ refresh: () => Promise<void> } | null>(null);
const setupRef = ref<{ refresh: () => Promise<void> } | null>(null);

// Members hear nothing about Slack while it is off, as in the policy editor.
const slackOffered = computed(() => readSlackOrgConfig(store.state.zoConfig).enabled);

const myAway = ref<Unavailability | null>(null);
const awayClearing = ref(false);
const awayDelete = useMutation(() => deleteUnavailabilityMutation(orgId.value));

/// Current first, else the next upcoming one, as the Members tab shows it.
async function fetchMyAway(force = false) {
  const now = Date.now() * 1000;
  try {
    const absences = await read(
      unavailabilityQuery(orgId.value, viewerEmail.value, now, now + SHIFT_LOOKAHEAD_MICROS * 4),
      force,
    );
    myAway.value =
      absences
        .filter((absence) => absence.end_at > now)
        .sort((a, b) => a.start_at - b.start_at)[0] ?? null;
  } catch {
    // Without the read the reader can still clear it from the team's Members tab.
    myAway.value = null;
  }
}

const myAwayLabel = computed<I18nText>(() => {
  const away = myAway.value;
  if (!away) return raw("");
  const day = (micros: number) =>
    formatTimestampInTimezone(micros, "MMM d, HH:mm", store.state.timezone);
  return nowMicros.value >= away.start_at
    ? t("oncall.awayUntil", { date: raw(day(away.end_at)) })
    : t("oncall.awayWindow", { from: raw(day(away.start_at)), to: raw(day(away.end_at)) });
});

async function clearAway() {
  if (!myAway.value) return;
  awayClearing.value = true;
  try {
    await awayDelete.mutateAsync(myAway.value.id);
    toast({ variant: "success", message: t("oncall.awayRemoved") });
    await fetchMine(true);
  } catch (err: unknown) {
    toast({
      variant: "error",
      message: raw(apiErrorMessage(err)) || t("oncall.awayRemoveFailed"),
    });
  } finally {
    awayClearing.value = false;
  }
}

/// Named, so the click event cannot land on `force`.
async function refreshPage() {
  refreshing.value = true;
  try {
    await Promise.all([
      fetchMine(true),
      deliveriesRef.value?.refresh(),
      phoneRef.value?.refresh(),
      slackRef.value?.refresh(),
      setupRef.value?.refresh(),
    ]);
  } finally {
    refreshing.value = false;
  }
}

// A lock drawn behind an open form would be out of sight, and saving there can only be refused.
watch(licenseDenied, () => {
  coverOpen.value = false;
  awayOpen.value = false;
  testConfirmOpen.value = false;
});

// Wrapped, so nothing can ever pass `force` in.
onMounted(() => fetchMine());
</script>
