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
  Which teams a page would reach right now — one button, in the list's toolbar.

  These were two cards in a three-up grid, which spent a third of the first
  screen on facts a reader checks once. Now the rotations are behind one button
  that sits on the filter row, so the line holds every team instead of the four
  it had room to print, and no vertical space is taken from the list at all.

  What stays OUTSIDE the button is the count and any coverage gap: a team paging
  nobody is the failure this exists to surface, and a failure you have to open a
  menu to find is a failure nobody finds.
-->
<template>
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
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import type { OnCallPosition, OnCallTeam } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    teams: OnCallTeam[];
    /**
     * Positions per team id, as `whoIsOnCall` returns them. Empty means a gap —
     * a rotation resolving to nobody is absent from the array rather than
     * present with a null holder.
     */
    positionsByTeam?: Record<string, OnCallPosition[]>;
    /** When each team's shift hands over, in micros, keyed by team id. */
    handoverByTeam?: Record<string, number | null>;
    /** Lowercased email of the signed-in user, so their own shift reads "You". */
    viewerEmail?: string;
  }>(),
  {
    positionsByTeam: () => ({}),
    handoverByTeam: () => ({}),
    viewerEmail: "",
  },
);

const emit = defineEmits<{ "view-schedules": []; "view-team": [teamId: string] }>();

const { t } = useI18nTyped();

/// The first rotation with somebody in it is the one a page reaches first.
function holderOf(teamId: string): OnCallPosition | undefined {
  return props.positionsByTeam[teamId]?.find((position) => !!position.user_email);
}

/**
 * Gaps first, then the viewer's own teams, then the rest.
 *
 * A team paging nobody is the exception this exists to surface, so it opens the
 * menu rather than sitting wherever the API happened to return it.
 */
const orderedTeams = computed(() => {
  const rank = (team: OnCallTeam): number => {
    const position = holderOf(team.id);
    if (!position) return 0;
    if (props.viewerEmail && position.user_email.toLowerCase() === props.viewerEmail) return 1;
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
const triggerLabel = computed<I18nText>(() =>
  t("oncall.onCallNowCount", { count: props.teams.length }),
);

/// "You" rather than the viewer's own address: on the screen that pages them,
/// whose shift it is matters more than which mailbox it goes to. The team name is
/// its own column in the row, so this is the person and the rotation that picked
/// them — which is what a reader chasing "why them" is after.
function holderLabel(teamId: string): I18nText {
  const position = holderOf(teamId);
  if (!position) return raw("");
  const isViewer = !!props.viewerEmail && position.user_email.toLowerCase() === props.viewerEmail;
  const who = isViewer ? t("oncall.onCallYou") : raw(position.user_email);
  // Names the ROTATION, not the shift rule inside it: the rotation is the
  // position a level pages, and the rule is which of its hours this is.
  return raw(`${who} · ${position.rotation_name}`);
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
</script>
