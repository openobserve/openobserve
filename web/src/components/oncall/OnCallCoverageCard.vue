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
  Who a page would actually reach right now, per team.

  A team with nobody on call is the failure this card exists to surface: the
  pages list looks calm precisely because those alerts page nobody, so the gap
  has to be visible beside the list rather than one screen away.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-1.5 border px-3.5 py-2.5"
    data-test="oncall-coverage-card"
  >
    <span class="flex items-center gap-1.5">
      <OIcon name="schedule" size="xs" class="text-text-secondary" />
      <OText variant="section">{{ t("oncall.whoIsOnCallNow") }}</OText>
      <!-- On the heading rather than a row of its own: the card is one of three
           that must stay the same height, and a whole line spent on "+2 more"
           costs a team the reader could have seen instead. -->
      <span
        v-if="hidden > 0"
        class="text-text-secondary ms-auto text-2xs"
        data-test="oncall-coverage-more"
      >
        {{ t("oncall.coverageMore", { count: hidden }) }}
      </span>
    </span>

    <p v-if="!teams.length" class="text-text-secondary text-sm" data-test="oncall-coverage-empty">
      {{ t("oncall.nobodyOnCall") }}
    </p>

    <!-- A three-column grid rather than a flex row per team: the holder and the
         handover then line up down the card instead of ragging against team
         names of different lengths. -->
    <ul v-else class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <li
        v-for="team in visibleTeams"
        :key="team.id"
        class="col-span-3 grid grid-cols-subgrid items-center"
        :data-test="`oncall-coverage-row-${team.id}`"
      >
        <span
          class="text-text-body min-w-0 truncate text-sm font-medium"
          :data-test="`oncall-coverage-team-${team.id}`"
        >
          {{ raw(team.name) }}
        </span>

        <!-- A gap is the exception, so it is the only row that gets colour. -->
        <OTag
          v-if="!holderOf(team.id)"
          variant="error-soft"
          size="sm"
          class="col-span-2 justify-self-end"
          :data-test="`oncall-coverage-gap-${team.id}`"
        >
          {{ t("oncall.coverageGapShort") }}
        </OTag>
        <template v-else>
          <span
            class="text-text-secondary min-w-0 truncate text-xs"
            :data-test="`oncall-coverage-holder-${team.id}`"
          >
            {{ holderLabel(team.id) }}
          </span>
          <span
            v-if="handoverLabel(team.id)"
            class="text-text-secondary text-xs whitespace-nowrap"
            :data-test="`oncall-coverage-handover-${team.id}`"
          >
            {{ handoverLabel(team.id) }}
          </span>
        </template>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallSlot, OnCallTeam } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teams: OnCallTeam[];
    /** Slots per team id, as `whoIsOnCall` returns them. Empty means a gap. */
    slotsByTeam?: Record<string, OnCallSlot[]>;
    /**
     * When each team's current shift hands over, in micros, keyed by team id.
     * Resolved from the schedule rather than the slot — `OnCallSlot` carries no
     * end instant, so the only way to answer "until when" is the rotation maths.
     */
    handoverByTeam?: Record<string, number | null>;
    /** Lowercased email of the signed-in user, so their own shift reads "You". */
    viewerEmail?: string;
  }>(),
  { slotsByTeam: () => ({}), handoverByTeam: () => ({}), viewerEmail: "" },
);

const { t } = useI18nTyped();

/**
 * How many teams fit before the card grows taller than the two beside it.
 *
 * The row is three cards of equal height, and this is the only one whose
 * content is a list — an org with twenty teams would otherwise push the whole
 * page down.
 */
const MAX_ROWS = 3;

/// The first slot is the one a page reaches first; a team with several
/// rotations in force is rare and the row names the winning one.
function holderOf(teamId: string): OnCallSlot | undefined {
  return props.slotsByTeam[teamId]?.find((slot) => !!slot.user_email);
}

/**
 * Gaps first, then the viewer's own teams, then the rest.
 *
 * Truncating in whatever order the API returned would hide the one row that
 * matters: a team paging nobody is the exception this card exists to surface,
 * and on an org with four teams it was the row that fell off the end.
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

const visibleTeams = computed(() => orderedTeams.value.slice(0, MAX_ROWS));
const hidden = computed(() => Math.max(0, props.teams.length - MAX_ROWS));

/// "You" rather than the viewer's own address: on the one screen that pages
/// them, whose shift it is matters more than which mailbox it goes to.
function holderLabel(teamId: string): I18nText {
  const slot = holderOf(teamId);
  if (!slot) return raw("");
  const isViewer =
    !!props.viewerEmail && slot.user_email.toLowerCase() === props.viewerEmail;
  const who = isViewer ? t("oncall.onCallYou") : raw(slot.user_email);
  return raw(`${who} · ${slot.rotation}`);
}

/// The handover as a wall clock in the TEAM's own zone: a rotation that hands
/// over at 21:00 local means nothing rendered in the reader's timezone, and
/// this card is read by people in other offices.
function handoverLabel(teamId: string): I18nText | "" {
  const at = props.handoverByTeam[teamId];
  const team = props.teams.find((candidate) => candidate.id === teamId);
  if (!at || !team) return "";
  return raw(`→ ${formatInZone(at, team.timezone, { hour: "2-digit", minute: "2-digit" })}`);
}
</script>
