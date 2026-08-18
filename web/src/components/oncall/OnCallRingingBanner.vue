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
  The one thing this screen exists to say, and the two ways out of it.

  This replaced a stat card in a three-up grid. A card states a number; the
  number nobody acted on is the problem, so the fact and the action that clears
  it now sit on the same line. Nothing renders while nothing is ringing — an
  always-present banner saying "all clear" is a banner people stop reading.
-->
<template>
  <OBanner
    v-if="ringing > 0"
    variant="error-soft"
    inline-actions
    icon="warning-amber"
    data-test="oncall-ringing-banner"
  >
    <span class="flex flex-wrap items-baseline gap-x-1.5">
      <span class="font-medium" data-test="oncall-ringing-banner-headline">
        {{ headline }}
      </span>
      <!-- Two separate facts, and the second is the one that decides what to do:
           a ladder with rungs left will wake somebody else on its own, and one
           that has finished never will. -->
      <span v-if="detail" data-test="oncall-ringing-banner-detail">{{ detail }}</span>
    </span>

    <template #actions>
      <span class="flex flex-wrap items-center gap-2">
        <OButton
          v-if="canAct"
          variant="primary"
          size="sm-action"
          :loading="busy"
          data-test="oncall-ringing-banner-ack"
          @click="emit('acknowledge-all')"
        >
          {{ t("oncall.ackAllRinging", { count: ringing }) }}
        </OButton>
        <!--
          The screenshot this follows offered "page someone manually". No
          endpoint opens a page from nothing — a page is born from a firing
          alert — and a bulk handoff is worse than none, because the people a
          page may be handed to are per team and these pages need not share one.
          So the second action goes to the record that needs the decision, where
          handoff, escalate-now and promote all live.
        -->
        <OButton
          v-if="oldestId"
          variant="ghost"
          size="sm-action"
          data-test="oncall-ringing-banner-oldest"
          @click="emit('open-oldest')"
        >
          {{ t("oncall.openOldestRinging") }}
        </OButton>
      </span>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Open pages nobody has claimed and nothing is snoozing. */
    ringing: number;
    /** How many of those have no rung left to fire. */
    exhausted?: number;
    /** `opened_at` of the longest-ringing page, in micros. */
    oldestOpenedAt?: number | null;
    /** Ringing pages whose team currently resolves to the viewer. */
    assignedToMe?: number;
    /** False hides the bulk acknowledge — a reader who cannot act reads only. */
    canAct?: boolean;
    busy?: boolean;
    /** Id of the longest-ringing page. Absent hides the second action. */
    oldestId?: string | null;
  }>(),
  {
    exhausted: 0,
    oldestOpenedAt: null,
    assignedToMe: 0,
    canAct: true,
    busy: false,
    oldestId: null,
  },
);

const emit = defineEmits<{ "acknowledge-all": []; "open-oldest": [] }>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

/// The count and how long the worst one has waited. An age is what makes a
/// count urgent — five pages ringing for a minute is a different morning from
/// five that have been ringing for two hours.
const headline = computed<I18nText>(() => {
  const openedAt = props.oldestOpenedAt;
  if (!openedAt) return t("oncall.ringingHeadlineNoAge", { count: props.ringing }, props.ringing);
  return t(
    "oncall.ringingHeadline",
    { count: props.ringing, duration: formatMicrosDuration(nowMicros.value - openedAt) },
    props.ringing,
  );
});

/// Whichever of the two secondary facts is worth a clause. "Exhausted" wins:
/// it is the one that says nobody else is coming.
const detail = computed<I18nText | "">(() => {
  if (props.exhausted > 0) {
    return t("oncall.ringingExhausted", { count: props.exhausted }, props.exhausted);
  }
  if (props.assignedToMe > 0) {
    return t("oncall.ringingAssignedToYou", { count: props.assignedToMe }, props.assignedToMe);
  }
  return "";
});
</script>
