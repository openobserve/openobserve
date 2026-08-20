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
  What this tab can be ACTED on: whether a secondary exists, and the buttons.

  It used to open with a three-part line — the primary and how long they had
  left, who was next, then the secondary. Every one of those three is said
  elsewhere on the same screen. The primary and the handover are on the pulse
  strip ABOVE the tabs, and the timeline's own band label says "<who> · on now ·
  until <when>" on the span the reader is already looking at; the handover was
  worse than redundant, because the strip derives it from rotation cadence while
  this line derived it from resolved segments, so a cover on the next shift made
  the two name different people a few pixels apart.

  What is left is what nothing else carries. An unstaffed secondary reads as a
  greyed lane on the chart, which is not the same as being told; and the three
  acts — staff the second rung, trade a shift, go and get some people — have no
  other home on this tab. `whoIsOnCall` is still the source, so the pool named
  here is the pool the engine would page.
-->
<template>
  <div
    class="border-border-default px-page-edge flex flex-wrap items-center gap-x-8 gap-y-3 border-b py-3"
    data-test="oncall-schedule-answer"
  >
    <!-- Nobody on call at all is a different and louder claim than an
         unstaffed second rung, so it replaces it rather than sitting beside
         it: naming the secondary's state is beside the point when the first
         rung is empty too. -->
    <div v-if="!holder" class="flex min-w-0 flex-col gap-0.5">
      <OText variant="panel-title" class="text-status-error-text">
        {{ t("oncall.schedNobodyOnCall") }}
      </OText>
      <p class="text-text-secondary text-xs" data-test="oncall-answer-nobody-hint">
        {{ t("oncall.schedNobodyOnCallHint") }}
      </p>
    </div>

    <div v-else class="flex min-w-0 flex-col gap-0.5" data-test="oncall-answer-secondary">
      <OText variant="meta">{{ t("oncall.schedSecondary") }}</OText>
      <!-- An unstaffed secondary is the difference between "the ladder has a
           second rung" and "the second rung resolves to nobody", so it is
           coloured like the finding it is. -->
      <span
        v-if="secondary"
        class="text-text-body truncate text-sm"
        data-test="oncall-answer-secondary-who"
      >
        {{ raw(secondary.user_email) }}
      </span>
      <span v-else class="text-status-error-text text-sm">
        {{ t("oncall.schedNoOneAssigned") }}
      </span>
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
      <OButton
        v-if="hasMembers"
        variant="outline"
        size="sm-action"
        :disabled="!holder"
        data-test="oncall-answer-request-swap"
        @click="emit('request-swap')"
      >
        {{ t("oncall.requestCover") }}
      </OButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallSlot } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

/// The pool a secondary rotation staffs. Lower-cased at the comparison, so it
/// does not depend on somebody spelling it the same way the ladder does.
const SECONDARY_SLOT = "secondary";

const props = withDefaults(
  defineProps<{
    /** `whoIsOnCall` — the server's answer, one entry per staffed pool. */
    slots?: OnCallSlot[];
    /**
     * Whether the team has anybody on it at all.
     *
     * Every action here names a person, so on an empty roster they all open on
     * an empty picker. Defaults true: a caller that does not know must not hide
     * the actions of a team that is staffed.
     */
    hasMembers?: boolean;
  }>(),
  { slots: () => [], hasMembers: true },
);

const emit = defineEmits<{
  "assign-secondary": [];
  "request-swap": [];
  /** The only act an empty team can take: go and add somebody. */
  "add-people": [];
}>();

const { t } = useI18nTyped();

const holder = computed<OnCallSlot | null>(
  () => props.slots.find((slot) => sameSlot(slot.slot, DEFAULT_SLOT)) ?? null,
);

const secondary = computed<OnCallSlot | null>(
  () => props.slots.find((slot) => sameSlot(slot.slot, SECONDARY_SLOT)) ?? null,
);
</script>
