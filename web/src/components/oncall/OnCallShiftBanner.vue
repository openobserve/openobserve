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
  Whether the person reading this screen is themselves on call, and for how much
  longer.

  It is the difference between "these are some pages" and "these are MY pages
  for the next three hours", and it was answerable only by leaving for another
  screen. Rendered only when the viewer actually holds a shift.
-->
<template>
  <div
    class="rounded-default bg-status-success-bg flex items-center gap-3 px-3 py-1.5"
    data-test="oncall-shift-banner"
  >
    <OUserCell :value="userEmail" :name="youLabel" />

    <span class="flex min-w-0 flex-col">
      <span class="text-text-heading truncate text-sm font-semibold">
        {{ t("oncall.shiftBannerTitle", { rotation: raw(rotation) }) }}
      </span>
      <span class="text-text-secondary truncate text-xs" data-test="oncall-shift-banner-team">
        {{ teamsLabel }}
      </span>
    </span>

    <!-- The countdown is the point of the banner, so it keeps its own column
         rather than wrapping into the sentence above it. -->
    <span
      v-if="handover"
      class="border-border-default flex flex-col items-end border-s ps-3"
      data-test="oncall-shift-banner-handover"
    >
      <span class="text-text-heading text-sm font-semibold">{{ handover }}</span>
      <OText variant="section">{{ t("oncall.tillHandover") }}</OText>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    userEmail: string;
    /** The rotation that put them on call, e.g. "Primary". */
    rotation: string;
    teamName: string;
    /** Instant this shift hands over, in micros. Null when it cannot be resolved. */
    endsAt?: number | null;
    /** Teams beyond this one the viewer is also on call for. */
    otherTeams?: number;
  }>(),
  { endsAt: null, otherTeams: 0 },
);

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const youLabel = computed(() => String(t("oncall.onCallYou")));

/// Being on call for three teams at once is worth knowing about, but naming
/// them all would push the countdown off the header.
const teamsLabel = computed<I18nText>(() =>
  props.otherTeams > 0
    ? raw(
        `${props.teamName} · ${t("oncall.shiftBannerMore", { count: props.otherTeams }, props.otherTeams)}`,
      )
    : raw(props.teamName),
);

/// Counts down rather than naming the instant: "3h 12m" is what somebody
/// decides against, and it survives the reader being in another timezone.
const handover = computed<I18nText | "">(() => {
  const endsAt = props.endsAt;
  if (!endsAt) return "";
  const remaining = endsAt - nowMicros.value;
  return remaining <= 0 ? "" : raw(formatMicrosDuration(remaining));
});
</script>
