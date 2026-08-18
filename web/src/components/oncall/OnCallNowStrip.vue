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
  Who a page would reach right now, and what keeps causing them — one line.

  These were two cards in a three-up grid, which spent a third of the first
  screen on facts a reader checks once. Now the rotations are behind one button,
  so the line holds every team instead of the four it had room to print, and the
  vertical space goes to the list that needs it.

  What stays OUTSIDE the button is the count and any coverage gap: a team paging
  nobody is the failure this exists to surface, and a failure you have to open a
  menu to find is a failure nobody finds.
-->
<template>
  <div
    class="border-border-default flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b py-1.5"
    data-test="oncall-now-strip"
  >
    <ODropdown content-class="min-w-80">
      <template #trigger>
        <OButton
          variant="outline"
          size="sm"
          icon-left="schedule"
          icon-right="expand-more"
          data-test="oncall-now-strip-trigger"
        >
          {{ triggerLabel }}
          <!-- On the trigger, not inside the menu — see the note above. -->
          <OTag
            v-if="gapCount > 0"
            variant="error-soft"
            size="sm"
            data-test="oncall-now-strip-gap-count"
          >
            {{ t("oncall.coverageGapCount", { count: gapCount }, gapCount) }}
          </OTag>
        </OButton>
      </template>

      <!-- Every team, uncapped: the whole reason this moved into a menu. Gaps
           first, then the reader's own shifts, then the rest. -->
      <ODropdownItem
        v-for="team in orderedTeams"
        :key="team.id"
        :data-test="`oncall-now-team-${team.id}`"
        @select="emit('view-team', team.id)"
      >
        <span class="flex w-full min-w-0 items-center gap-2">
          <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-medium">
            {{ raw(team.name) }}
          </span>

          <OTag
            v-if="!holderOf(team.id)"
            variant="error-soft"
            size="sm"
            :data-test="`oncall-now-gap-${team.id}`"
          >
            {{ t("oncall.coverageGapShort") }}
          </OTag>
          <template v-else>
            <span
              class="text-text-body min-w-0 truncate text-xs"
              :data-test="`oncall-now-holder-${team.id}`"
            >
              {{ holderLabel(team.id) }}
            </span>
            <span
              v-if="handoverLabel(team.id)"
              class="text-text-secondary text-xs whitespace-nowrap"
              :data-test="`oncall-now-handover-${team.id}`"
            >
              {{ handoverLabel(team.id) }}
            </span>
          </template>
        </span>
      </ODropdownItem>

      <ODropdownItem
        v-if="!teams.length"
        disabled
        data-test="oncall-now-strip-empty"
        :text-value="String(t('oncall.nobodyOnCall'))"
      >
        {{ t("oncall.nobodyOnCall") }}
      </ODropdownItem>

      <ODropdownSeparator />

      <ODropdownItem data-test="oncall-now-strip-schedules" @select="emit('view-schedules')">
        <template #icon-left>
          <OIcon name="calendar-month" size="sm" />
        </template>
        {{ t("oncall.allSchedules") }}
      </ODropdownItem>
    </ODropdown>

    <!-- Pushed to the trailing edge: it describes the last thirty days, not the
         shift being read on the left. -->
    <span
      v-if="causesSummary"
      class="text-text-secondary ms-auto truncate text-xs"
      data-test="oncall-now-strip-causes"
    >
      {{ causesSummary }}
      <!-- The card this replaced had a line for the most recent example. It is
           the one fact that names an alert to go and fix, so it survives here
           rather than being dropped for width. -->
      <OTooltip v-if="causesTooltip" side="bottom" :content="causesTooltip" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { CauseAnalytics, CauseCount, OnCallSlot, OnCallTeam } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teams: OnCallTeam[];
    /** Slots per team id, as `whoIsOnCall` returns them. Empty means a gap. */
    slotsByTeam?: Record<string, OnCallSlot[]>;
    /** When each team's shift hands over, in micros, keyed by team id. */
    handoverByTeam?: Record<string, number | null>;
    /** Lowercased email of the signed-in user, so their own shift reads "You". */
    viewerEmail?: string;
    /** `GET /oncall/analytics/causes`. Null when the server has no such route. */
    analytics?: CauseAnalytics | null;
  }>(),
  {
    slotsByTeam: () => ({}),
    handoverByTeam: () => ({}),
    viewerEmail: "",
    analytics: null,
  },
);

const emit = defineEmits<{ "view-schedules": []; "view-team": [teamId: string] }>();

const { t } = useI18nTyped();

/// The first slot with somebody in it is the one a page reaches first.
function holderOf(teamId: string): OnCallSlot | undefined {
  return props.slotsByTeam[teamId]?.find((slot) => !!slot.user_email);
}

/**
 * Gaps first, then the viewer's own teams, then the rest.
 *
 * A team paging nobody is the exception this exists to surface, so it opens the
 * menu rather than sitting wherever the API happened to return it.
 */
const orderedTeams = computed(() => {
  const rank = (team: OnCallTeam): number => {
    const slot = holderOf(team.id);
    if (!slot) return 0;
    if (props.viewerEmail && slot.user_email.toLowerCase() === props.viewerEmail) return 1;
    return 2;
  };
  return [...props.teams].sort((a, b) => rank(a) - rank(b));
});

/// Teams whose rotation resolves to nobody right now.
const gapCount = computed(() => props.teams.filter((team) => !holderOf(team.id)).length);

/**
 * What the closed button says.
 *
 * The count is on the outside because "is anybody on call" must be answerable
 * without opening anything; the gap tag beside it carries the exception.
 */
const triggerLabel = computed<I18nText>(() => {
  // Its own short label — `nobodyOnCall` is a remediation sentence, which reads
  // as a paragraph on a button. The sentence still greets whoever opens the menu.
  if (!props.teams.length) return t("oncall.onCallNowNone");
  return t("oncall.onCallNowCount", { count: props.teams.length }, props.teams.length);
});

/// "You" rather than the viewer's own address: on the screen that pages them,
/// whose shift it is matters more than which mailbox it goes to. The team name is
/// its own column in the row, so this is the person and the rotation that picked
/// them — which is what a reader chasing "why them" is after.
function holderLabel(teamId: string): I18nText {
  const slot = holderOf(teamId);
  if (!slot) return raw("");
  const isViewer = !!props.viewerEmail && slot.user_email.toLowerCase() === props.viewerEmail;
  const who = isViewer ? t("oncall.onCallYou") : raw(slot.user_email);
  return raw(`${who} · ${slot.rotation}`);
}

/// The handover as a wall clock in the TEAM's own zone — a rotation handing over
/// at 21:00 local means nothing rendered in the reader's timezone, and this line
/// is read from other offices.
function handoverLabel(teamId: string): I18nText | "" {
  const at = props.handoverByTeam[teamId];
  const team = props.teams.find((candidate) => candidate.id === teamId);
  if (!at || !team) return "";
  return raw(`→ ${formatInZone(at, team.timezone, { hour: "2-digit", minute: "2-digit" })}`);
}

/// Read from the window the SERVER answered for: the endpoint defaults the range
/// when the client omits it, so echoing a local guess could label this with a
/// period it did not count.
const windowDays = computed(() => {
  const span = (props.analytics?.to ?? 0) - (props.analytics?.from ?? 0);
  return span > 0 ? Math.max(1, Math.round(span / MICROS_PER_DAY)) : 30;
});

/// Sorted here rather than trusted from the wire — the endpoint makes no
/// ordering promise, and "what keeps breaking us" naming the wrong cause is
/// worse than naming none.
const rankedCauses = computed<CauseCount[]>(() => {
  const causes = props.analytics?.causes ?? [];
  if (!causes.length || !props.analytics?.total) return [];
  return [...causes].sort((a, b) => b.count - a.count);
});

function share(count: number): string {
  const total = props.analytics?.total ?? 0;
  return total ? `${Math.round((count / total) * 100)}%` : "";
}

/// A cause is recorded at resolve, so an org that never fills it in gets no
/// summary — which is a different fact from "nothing broke", and saying nothing
/// is the honest form of it on a one-line strip.
const causesSummary = computed<I18nText | "">(() => {
  const top = rankedCauses.value.slice(0, 2);
  if (!top.length) return "";
  const parts = top.map((c) => `${share(c.count)} ${String(t(`oncall.cause_${c.cause}`))}`);
  return t("oncall.causesWindow", {
    days: windowDays.value,
    causes: raw(parts.join(" · ")),
  });
});

const causesTooltip = computed<I18nText | "">(() => {
  const example = rankedCauses.value[0]?.last_title;
  return example ? t("oncall.causesLatest", { name: raw(example) }) : "";
});
</script>
