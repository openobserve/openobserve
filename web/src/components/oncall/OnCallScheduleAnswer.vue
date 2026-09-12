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
  What this tab can be ACTED on: the three acts, and the one claim that stops
  them meaning anything.

  It used to open by naming people — the primary and how long they had left, who
  was next, then whoever was backing them up. Every one of those is said again
  within the same screenful: the timeline's own band label reads "<who> · on now
  · until <when>" on the span the reader is already looking at, and it names the
  second rotation's holder on the lane below. The line named them from
  `whoIsOnCall` while the chart draws resolved segments, so a cover on the next
  shift made the two disagree a few pixels apart.

  What is left is what nothing else carries: two acts — add a second rotation,
  go and get some people — and the claim that stops either mattering. Writing a
  cover moved down onto the chart's own toolbar, beside Add rotation, where the
  rest of what a reader can do to this schedule already lives.

  "The secondary" is a second ROTATION, not a derived position. There is no slot
  keyword to look up: the response carries one entry per rotation that resolves
  to somebody, so "is anybody backing the first up" is a count.
-->
<template>
  <div
    class="border-border-default px-page-edge flex flex-wrap items-center gap-x-8 gap-y-3 border-b py-3"
    data-test="oncall-schedule-answer"
  >
    <!-- Nobody on call at all is the loudest thing this strip can say, and it
         is the one state in which the buttons beside it are beside the point. -->
    <div v-if="!holder" class="flex min-w-0 flex-col gap-0.5">
      <OText variant="panel-title" class="text-status-error-text">
        {{ t("oncall.schedNobodyOnCall") }}
      </OText>
      <p class="text-text-secondary text-xs" data-test="oncall-answer-nobody-hint">
        {{ t("oncall.schedNobodyOnCallHint") }}
      </p>
    </div>

    <span class="ms-auto flex flex-wrap items-center gap-2">
      <!-- On a team with nobody in it every one of these opens on an empty
           picker, so the only act that leads anywhere is offered instead. -->
      <OButton
        v-if="!hasMembers"
        variant="primary"
        size="sm-action"
        data-test="oncall-answer-add-people"
        @click="emit('add-people')"
      >
        {{ t("oncall.rotationOpenMembers") }}
      </OButton>
      <OButton
        v-else-if="!secondary"
        variant="outline"
        size="sm-action"
        data-test="oncall-answer-assign-secondary"
        @click="emit('assign-secondary')"
      >
        {{ t("oncall.schedAssignSecondary") }}
      </OButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallPosition } from "@/ts/interfaces/oncall";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /**
     * `whoIsOnCall` — the server's answer, one entry per rotation that resolves
     * to somebody. A rotation with a gap is absent, not null-held.
     */
    positions?: OnCallPosition[];
    /**
     * Whether the team has anybody on it at all.
     *
     * Every action here names a person, so on an empty roster they all open on
     * an empty picker. Defaults true: a caller that does not know must not hide
     * the actions of a team that is staffed.
     */
    hasMembers?: boolean;
  }>(),
  { positions: () => [], hasMembers: true },
);

const emit = defineEmits<{
  "assign-secondary": [];
  /** The only act an empty team can take: go and add somebody. */
  "add-people": [];
}>();

const { t } = useI18nTyped();

/// The first rotation the team staffs. Not a keyword: the response is ordered
/// by the schedule, so this is "the position listed first" rather than a lookup
/// for `primary` — there is no default slot any more, and nothing derives one.
const holder = computed<OnCallPosition | null>(() => props.positions[0] ?? null);

/// Anybody backing them up — a SECOND staffed rotation, named after itself. The
/// old lookup asked for a slot literally spelled "secondary", so a team whose
/// second position was called anything else read as having none.
const secondary = computed<OnCallPosition | null>(() => props.positions[1] ?? null);
</script>
