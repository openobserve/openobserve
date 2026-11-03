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

<!-- The reader's own on-call: their shift, how pages reach them, and what has been sent to them. -->
<template>
  <OPageLayout
    bleed
    data-test="oncall-mine-page"
    :title="t('oncall.mineTitle')"
    :subtitle="t('oncall.mineSubtitle')"
    icon="person"
    scroll
  >
    <template #actions>
      <ORefreshButton
        v-if="loaded && !unavailable"
        layout="inline"
        variant="outline"
        :last-run-at="lastFetchedAt"
        :loading="refreshing"
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

    <OContent v-else y class="flex max-w-3xl flex-col gap-5">
      <!-- The shift first: "am I on call, and until when" is the question this page opens on. -->
      <section
        class="rounded-surface bg-surface-base border-border-default flex flex-col gap-3 border px-4 py-3"
        data-test="oncall-mine-teams"
      >
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

        <template v-else-if="loaded">
          <span class="flex flex-wrap items-center gap-2">
            <OText variant="panel-title" data-test="oncall-mine-shift-headline">
              {{ mine?.on_call_now ? t("oncall.mineShiftOn") : t("oncall.mineShiftOff") }}
            </OText>
            <OTag
              v-if="mine?.on_call_now"
              variant="success-soft"
              size="sm"
              data-test="oncall-mine-on-call"
            >
              {{ t("oncall.mineDutyOn") }}
            </OTag>
          </span>

          <OText v-if="!(mine?.teams ?? []).length" variant="meta" data-test="oncall-mine-no-teams">
            {{ t("oncall.mineNoTeams") }}
          </OText>

          <div
            v-for="team in mine?.teams ?? []"
            :key="team.team_id"
            class="flex flex-wrap items-center gap-x-2 gap-y-1"
            :data-test="`oncall-mine-team-${team.team_id}`"
          >
            <router-link
              class="text-accent text-sm font-medium hover:underline"
              :to="teamRoute(team.team_id)"
              :data-test="`oncall-mine-open-team-${team.team_id}`"
            >
              {{ raw(team.team_name) }}
            </router-link>
            <!-- Null with an unresolved schedule is "we could not work it out", never "off duty". -->
            <OTag
              v-if="team.on_call_now === true"
              variant="success-soft"
              size="sm"
              :data-test="`oncall-mine-duty-${team.team_id}`"
            >
              {{ rolesLabel(team.team_id) }}
            </OTag>
            <OTag
              v-else-if="team.on_call_now === false"
              variant="default-soft"
              size="sm"
              :data-test="`oncall-mine-duty-${team.team_id}`"
            >
              {{ t("oncall.mineDutyOff") }}
            </OTag>
            <OTag
              v-else
              variant="amber-soft"
              size="sm"
              :data-test="`oncall-mine-duty-${team.team_id}`"
            >
              {{ t("oncall.mineDutyUnknown") }}
            </OTag>
            <OText
              v-if="shiftLine(team.team_id, team.on_call_now)"
              variant="meta"
              :data-test="`oncall-mine-shift-${team.team_id}`"
            >
              {{ shiftLine(team.team_id, team.on_call_now) }}
            </OText>
            <OText
              v-if="(shifts[team.team_id]?.roles.length ?? 0) > 1"
              variant="meta"
              class="text-status-warning-text"
              :data-test="`oncall-mine-no-backup-${team.team_id}`"
            >
              {{ t("oncall.mineNoBackup") }}
            </OText>
          </div>

          <span v-if="(mine?.teams ?? []).length" class="flex flex-wrap items-center gap-2">
            <OButton
              v-if="shiftTeamId"
              variant="outline"
              size="sm"
              data-test="oncall-mine-cover"
              @click="openSchedule(shiftTeamId)"
            >
              <OIcon name="calendar-month" size="sm" />{{ t("oncall.mineCoverShift") }}
              <OTooltip :content="t('oncall.mineCoverShiftHint')" />
            </OButton>
            <OButton variant="outline" size="sm" data-test="oncall-mine-away" @click="openAway">
              <OIcon name="event" size="sm" />{{ t("oncall.mineAway") }}
            </OButton>
          </span>
        </template>
      </section>

      <section
        class="rounded-surface bg-surface-base border-border-default flex flex-col gap-1 border px-4 py-3"
        data-test="oncall-mine-reach"
      >
        <OText variant="panel-title" class="mb-1">{{ t("oncall.mineReachTitle") }}</OText>
        <div class="flex min-h-8 items-center gap-3" data-test="oncall-mine-reach-email">
          <OText variant="body" class="w-16 shrink-0">{{ t("oncall.channel_email") }}</OText>
          <OText variant="meta" class="min-w-0 flex-1 truncate">{{ raw(viewerEmail) }}</OText>
          <OIcon name="check-circle" size="sm" class="text-status-success-text shrink-0" />
        </div>
        <OnCallPhoneCard ref="phoneRef" :admin="isAdmin" />
        <OnCallSlackCard v-if="slackOffered" ref="slackRef" :admin="isAdmin" />
        <span v-if="testTeam" class="mt-2 flex">
          <OButton
            variant="outline"
            size="sm"
            :loading="testing"
            data-test="oncall-mine-test-page"
            @click="testConfirmOpen = true"
          >
            <OIcon name="campaign" size="sm" />{{ t("oncall.mineTestTeamPage") }}
          </OButton>
        </span>
      </section>

      <OnCallMyDeliveries
        ref="deliveriesRef"
        :team-names="teamNames"
        :can-test="!!testTeam"
        @test-page="testConfirmOpen = true"
      />
    </OContent>

    <ConfirmDialog
      :model-value="testConfirmOpen"
      :title="t('oncall.testPageConfirmTitle')"
      :message="t('oncall.setupTestConfirm', { team: raw(testTeam?.team_name ?? '') })"
      :ok-label="t('oncall.setupStep5Cta')"
      @update:ok="sendTestPage"
      @update:cancel="testConfirmOpen = false"
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
            data-test="oncall-mine-away-save"
            @click="saveAway"
          >
            {{ t("oncall.mineAwaySave") }}
          </OButton>
          <OTooltip v-if="!awayValid" :content="t('oncall.mineAwayPickTimes')" />
        </div>
      </template>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallMyDeliveries from "@/components/oncall/OnCallMyDeliveries.vue";
import OnCallPhoneCard from "@/components/oncall/OnCallPhoneCard.vue";
import OnCallSlackCard from "@/components/oncall/OnCallSlackCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODate from "@/lib/forms/Date/ODate.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { queryClient } from "@/composables/query/queryClient";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { useOnCallClock } from "@/composables/useOnCallClock";
import {
  createUnavailabilityMutation,
  myOnCallQuery,
  oncallTeamsQuery,
  resolvedScheduleQuery,
  testPageMutation,
  whoIsOnCallQuery,
} from "@/services/oncall.queries";
import type { MyOnCall, OnCallPosition, OnCallTeam, ResolvedSegment } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  formatOnCallInstant,
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
  until: number | null;
  next: string | null;
  nextShiftAt: number | null;
}

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const nowMicros = useOnCallClock();
const { nameOf } = useOrgUserNames();
const orgId = computed(() => store.state.selectedOrganization.identifier);
const viewerEmail = computed(() => String(store.state.userInfo?.email ?? ""));
// Visibility only: the server is the gate, this decides whether a setup button would help or 403.
const isAdmin = computed(() =>
  ["admin", "root"].includes(String(store.state.currentuser?.role ?? "").toLowerCase()),
);

const mine = ref<MyOnCall | null>(null);
const shifts = ref<Record<string, ShiftFacts>>({});
const loaded = ref(false);
const lastFetchedAt = ref<number | null>(null);
const unavailable = ref(false);
/// Set only when the first load fails; a failed refresh keeps the teams on screen instead.
const loadError = ref<string | null>(null);

/// Every team's name, not only the reader's own: a page handed over from another team still names its team.
const orgTeamNames = ref<Record<string, string>>({});
const teamNames = computed(() => ({
  ...orgTeamNames.value,
  ...Object.fromEntries((mine.value?.teams ?? []).map((team) => [team.team_id, team.team_name])),
}));

async function fetchTeamNames(force = false) {
  try {
    const teams = await read<OnCallTeam[]>(oncallTeamsQuery(orgId.value), force);
    orgTeamNames.value = Object.fromEntries(teams.map((team) => [team.id, team.name]));
  } catch {
    // Without the team list the reader's own teams still name themselves.
  }
}

/// The team whose shift the card counts down: the one the reader is on call for now.
const shiftTeamId = computed(
  () => (mine.value?.teams ?? []).find((team) => team.on_call_now === true)?.team_id ?? null,
);

/// The team test page goes to: one the reader is on call for, else their first team.
const testTeam = computed(
  () =>
    (mine.value?.teams ?? []).find((team) => team.on_call_now === true) ??
    mine.value?.teams[0] ??
    null,
);

function rolesLabel(teamId: string): I18nText {
  const roles = shifts.value[teamId]?.roles ?? [];
  return roles.length ? raw(roles.join(" + ")) : t("oncall.mineDutyOn");
}

function at(micros: number): string {
  return formatOnCallInstant(micros, nowMicros.value, store.state.timezone);
}

/// "until Mon 10:00 (5d 19h) → then Raj" while on call, "Next shift Thu 09:00" while off.
function shiftLine(teamId: string, onCall: boolean | null): I18nText | "" {
  const facts = shifts.value[teamId];
  if (!facts) return "";
  if (onCall === true && facts.until !== null) {
    const until = t("oncall.mineShiftUntil", {
      time: raw(at(facts.until)),
      left: raw(formatMicrosDuration(facts.until - nowMicros.value)),
    });
    return facts.next
      ? t("oncall.mineShiftUntilThen", { until, who: raw(nameOf(facts.next)) })
      : until;
  }
  if (onCall === false && facts.nextShiftAt !== null) {
    return t("oncall.mineNextShift", { time: raw(at(facts.nextShiftAt)) });
  }
  return "";
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
  return queryClient.fetchQuery(options as any) as Promise<T>;
}

/// Role, shift end and who is next need the team's schedule reads; a role without them sees only the duty tag.
async function fetchShifts(force = false) {
  const me = viewerEmail.value.toLowerCase();
  const now = Date.now() * 1000;
  const teams = mine.value?.teams ?? [];
  const entries = await Promise.all(
    teams.map(async (team): Promise<[string, ShiftFacts] | null> => {
      try {
        const positions = await read<OnCallPosition[]>(
          whoIsOnCallQuery(orgId.value, team.team_id),
          force,
        );
        const held = positions.filter((p) => p.user_email.toLowerCase() === me);
        const segments = await read<ResolvedSegment[]>(
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
    mine.value = await read<MyOnCall>(options, force);
    loadError.value = null;
    lastFetchedAt.value = queryClient.getQueryState(options.queryKey)?.dataUpdatedAt ?? null;
    await Promise.all([fetchShifts(force), fetchTeamNames(force)]);
  } catch (err: any) {
    if (isOnCallUnavailable(err)) {
      unavailable.value = true;
      mine.value = null;
      return;
    }
    // A failed refresh keeps what is on screen: blanking it would tell an on-call engineer they are off duty.
    if (loaded.value) {
      toast({
        variant: "error",
        message: raw(err?.response?.data?.message) || t("oncall.refreshFailed"),
      });
      return;
    }
    mine.value = null;
    loadError.value = String(err?.response?.data?.message ?? err?.message ?? "");
  } finally {
    loaded.value = true;
  }
}

function teamRoute(teamId: string) {
  return { name: "onCallTeamDetail", params: { teamId }, query: { org_identifier: orgId.value } };
}

function openSchedule(teamId: string) {
  router.push({
    name: "onCallTeamDetail",
    params: { teamId, tab: "schedule" },
    query: { org_identifier: orgId.value },
  });
}

const testConfirmOpen = ref(false);
const testing = ref(false);
const testWrite = useMutation(() => testPageMutation(orgId.value));

async function sendTestPage() {
  testConfirmOpen.value = false;
  const team = testTeam.value;
  if (!team) return;
  testing.value = true;
  try {
    const res = await testWrite.mutateAsync({ teamId: team.team_id });
    const outcome = testPageOutcome(res.data, t);
    toast({ variant: outcome.variant, message: outcome.message });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.status === 403
          ? t("oncall.configDenied")
          : raw(err?.response?.data?.message) || t("oncall.testPageFailed"),
    });
  } finally {
    testing.value = false;
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
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.awaySaveFailed"),
    });
  } finally {
    awaySaving.value = false;
  }
}

const refreshing = ref(false);
const deliveriesRef = ref<{ refresh: () => Promise<void> } | null>(null);
const phoneRef = ref<{ refresh: () => Promise<void> } | null>(null);
const slackRef = ref<{ refresh: () => Promise<void> } | null>(null);

// Members hear nothing about Slack while it is off, as in the policy editor.
const slackOffered = computed(() => readSlackOrgConfig(store.state.zoConfig).enabled);

/// Named, so the click event cannot land on `force`.
async function refreshPage() {
  refreshing.value = true;
  try {
    await Promise.all([
      fetchMine(true),
      deliveriesRef.value?.refresh(),
      phoneRef.value?.refresh(),
      slackRef.value?.refresh(),
    ]);
  } finally {
    refreshing.value = false;
  }
}

// Wrapped, so nothing can ever pass `force` in.
onMounted(() => fetchMine());
</script>
