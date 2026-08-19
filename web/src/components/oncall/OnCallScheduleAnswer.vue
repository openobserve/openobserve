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
  Who is on, until when, who is next, and who is behind them — in one line.

  The schedule tab used to answer this three times: a rail card per rotation, a
  pulse panel above the tabs, and the chart itself. Three renderings of one fact
  is three chances to disagree, and the reader had to check. This is the single
  place the tab makes the claim, and every part of it is read off the SERVER's
  resolution (`whoIsOnCall` for the holder, `resolved-schedule` for the
  instants) rather than recomputed from rotation arithmetic — a screen whose
  whole job is "who gets paged" must not be able to name a different person from
  the one the engine will page.
-->
<template>
  <div
    class="border-border-default px-page-edge flex flex-wrap items-center gap-x-8 gap-y-3 border-b py-3"
    data-test="oncall-schedule-answer"
  >
    <!-- Nobody on call is not a quieter version of this line — it is a
         different claim, and it takes the whole width rather than leaving the
         reader to notice a blank name. -->
    <template v-if="!holder">
      <div class="flex min-w-0 flex-col gap-0.5">
        <OText variant="panel-title" class="text-status-error-text">
          {{ t("oncall.schedNobodyOnCall") }}
        </OText>
        <p class="text-text-secondary text-xs" data-test="oncall-answer-nobody-hint">
          {{ t("oncall.schedNobodyOnCallHint") }}
        </p>
      </div>
    </template>

    <template v-else>
      <div class="flex min-w-0 flex-col gap-0.5" data-test="oncall-answer-holder">
        <span class="flex flex-wrap items-center gap-2">
          <OText variant="panel-title">{{ raw(holder.user_email) }}</OText>
          <OTag variant="success-soft" size="sm">{{ t("oncall.schedPrimaryTag") }}</OTag>
        </span>
        <p class="text-text-secondary text-xs" data-test="oncall-answer-until">
          {{ untilLine }}
        </p>
      </div>

      <div
        class="border-border-default flex min-w-0 flex-col gap-0.5 sm:border-s sm:ps-8"
        data-test="oncall-answer-next"
      >
        <OText variant="meta">{{ t("oncall.schedNext") }}</OText>
        <span class="text-text-body truncate text-sm">{{ nextLine }}</span>
      </div>

      <div
        class="border-border-default flex min-w-0 flex-col gap-0.5 sm:border-s sm:ps-8"
        data-test="oncall-answer-secondary"
      >
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
    </template>

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
        {{ t("oncall.schedRequestSwap") }}
      </OButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallSlot, ResolvedSegment } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

/// The pool a secondary rotation staffs. Lower-cased at the comparison, so it
/// does not depend on somebody spelling it the same way the ladder does.
const SECONDARY_SLOT = "secondary";

const props = withDefaults(
  defineProps<{
    /** `whoIsOnCall` — the server's answer, one entry per staffed pool. */
    slots?: OnCallSlot[];
    /** `resolved-schedule` for the visible window. Supplies the instants. */
    segments?: ResolvedSegment[];
    /** The team's zone. A handover read in the browser's zone is a lie. */
    timezone?: string;
    /**
     * Whether the team has anybody on it at all.
     *
     * Every action here names a person, so on an empty roster they all open on
     * an empty picker. Defaults true: a caller that does not know must not hide
     * the actions of a team that is staffed.
     */
    hasMembers?: boolean;
  }>(),
  { slots: () => [], segments: () => [], timezone: "UTC", hasMembers: true },
);

const emit = defineEmits<{
  "assign-secondary": [];
  "request-swap": [];
  /** The only act an empty team can take: go and add somebody. */
  "add-people": [];
}>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const holder = computed<OnCallSlot | null>(
  () => props.slots.find((slot) => sameSlot(slot.slot, DEFAULT_SLOT)) ?? null,
);

const secondary = computed<OnCallSlot | null>(
  () => props.slots.find((slot) => sameSlot(slot.slot, SECONDARY_SLOT)) ?? null,
);

/// The span covering the present in the pool this line speaks for.
///
/// From the segments rather than from `shift_micros` arithmetic: a cover, a
/// restriction or a higher layer all end the current shift somewhere other than
/// where the rotation's own cadence would put it.
const current = computed<ResolvedSegment | null>(
  () =>
    props.segments.find(
      (segment) =>
        !!segment.user_email &&
        sameSlot(segment.slot, DEFAULT_SLOT) &&
        segment.from <= nowMicros.value &&
        segment.to > nowMicros.value,
    ) ?? null,
);

/// The next span in the same pool with somebody different on it.
const upcoming = computed<ResolvedSegment | null>(() => {
  const from = current.value?.to ?? nowMicros.value;
  return (
    props.segments
      .filter(
        (segment) =>
          !!segment.user_email &&
          sameSlot(segment.slot, DEFAULT_SLOT) &&
          segment.from >= from &&
          segment.user_email !== current.value?.user_email,
      )
      .sort((a, b) => a.from - b.from)[0] ?? null
  );
});

const at = (micros: number) =>
  raw(
    formatInZone(micros, props.timezone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

/// "On call until Mon 25 Aug, 14:30 · 6d 4h left".
///
/// The window the chart drew may simply not reach the handover — that is a
/// missing fact, not "no handover exists", so it says so rather than printing
/// an end time it inferred.
const untilLine = computed<I18nText>(() => {
  const segment = current.value;
  if (!segment) return t("oncall.schedNoHandover");
  return raw(
    `${t("oncall.schedUntil", { when: at(segment.to) })} · ${t("oncall.schedLeft", {
      duration: raw(formatMicrosDuration(Math.max(0, segment.to - nowMicros.value))),
    })}`,
  );
});

const nextLine = computed<I18nText>(() => {
  const segment = upcoming.value;
  if (!segment?.user_email) return t("oncall.schedNextNobody");
  return t("oncall.schedNextWho", {
    who: raw(segment.user_email),
    when: at(segment.from),
  });
});
</script>
