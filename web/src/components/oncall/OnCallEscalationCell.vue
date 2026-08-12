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
  How far up the ladder one page has climbed, as a table cell.

  The list already said WHETHER a page was answered; the question a responder
  actually has at 3am is "how long until this wakes somebody else", and that was
  only answerable by opening the record. The bar is the ladder, not a percentage:
  each fired rung fills one more step of however many the policy defines.
-->
<template>
  <div class="flex min-w-0 flex-col gap-1" :data-test="`oncall-escalation-cell-${responseId}`">
    <span class="flex items-center gap-1.5">
      <OIcon v-if="tone.icon" :name="tone.icon" size="xs" :class="tone.text" />
      <span class="truncate text-sm" :class="tone.text" data-test="oncall-escalation-cell-level">
        {{ headline }}
      </span>
    </span>

    <!-- No progress loaded means the ladder position is unknown, and an empty
         bar would read as "nothing has fired" — which is a different fact. -->
    <OProgressBar
      v-if="progress"
      :value="fillRatio"
      :variant="tone.bar"
      size="xs"
      data-test="oncall-escalation-cell-bar"
    />

    <span
      v-if="detail"
      class="text-text-secondary truncate text-xs"
      data-test="oncall-escalation-cell-detail"
    >
      {{ detail }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import type { EscalationProgress, ResponseState } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = defineProps<{
  /** Only used for the `data-test` hooks, so each row's cell is addressable. */
  responseId: string;
  state: ResponseState;
  /** Absent while the ladder position is still loading, or beyond the fetch cap. */
  progress?: EscalationProgress | null;
  /**
   * Rungs the team's policy defines for this priority. Absent when the policy
   * could not be read — the cell then says "Level 2" rather than inventing a
   * total, because "Level 2 of 3" with a guessed 3 is worse than no denominator.
   */
  totalRungs?: number | null;
  /** `acked_at - opened_at`, so a settled row can say how fast it was answered. */
  ackedInMicros?: number | null;
}>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

interface CellTone {
  text: string;
  bar: ProgressBarVariant;
  icon: IconName | null;
}

/// A page climbing the ladder is the only state worth shouting about; the three
/// settled states recede so the escalating rows are what the eye lands on.
const tone = computed<CellTone>(() => {
  if (props.state === "resolved") {
    return { text: "text-text-secondary", bar: "default", icon: "check-circle" };
  }
  if (props.progress?.stopped_because === "snoozed") {
    return { text: "text-status-warning-text", bar: "warning", icon: "pause-circle-filled" };
  }
  if (props.state === "acknowledged") {
    return { text: "text-status-success-text", bar: "default", icon: "check-circle" };
  }
  if (props.progress?.exhausted) {
    return { text: "text-status-error-text", bar: "danger", icon: "warning-amber" };
  }
  return { text: "text-status-error-text", bar: "danger", icon: "arrow-upward" };
});

const firedCount = computed(() => props.progress?.fired.length ?? 0);

/// The ladder as a fraction of the rungs the policy defines. Without a total the
/// bar still has to mean something, so a climbing ladder that knows only its own
/// position reads as half full rather than as a hidden division by zero.
const fillRatio = computed(() => {
  const total = props.totalRungs ?? 0;
  if (total <= 0) return firedCount.value > 0 ? 0.5 : 0;
  return Math.min(1, firedCount.value / total);
});

/// One or two words. The full sentences ("Escalation stopped — somebody owns
/// this.") belong on the detail screen; in a table cell they truncate to
/// nothing, which is what this column was doing.
const headline = computed<I18nText>(() => {
  if (props.state === "resolved") return t("oncall.escalationResolvedShort");
  if (props.progress?.stopped_because === "snoozed") return t("oncall.escalationSnoozedShort");
  if (props.state === "acknowledged") return t("oncall.escalationAcked");
  if (firedCount.value === 0) return t("oncall.escalationNotStarted");
  return props.totalRungs
    ? t("oncall.escalationLevel", { level: firedCount.value, total: props.totalRungs })
    : t("oncall.escalationLevelOpen", { level: firedCount.value });
});

/// Relative, because "in 4m 12s" is the number being decided against — an
/// absolute instant makes the reader do the arithmetic at the worst moment.
const detail = computed<I18nText | "">(() => {
  const progress = props.progress;
  // How fast it was answered is the useful fact once it IS answered — the
  // ladder itself has nothing left to say.
  if (props.state === "acknowledged" || props.state === "resolved") {
    return props.ackedInMicros === null || props.ackedInMicros === undefined
      ? ""
      : t("oncall.escalationAckedIn", { duration: formatMicrosDuration(props.ackedInMicros) });
  }
  if (!progress) return "";
  if (progress.stopped_because === "snoozed") return "";
  if (progress.exhausted) return t("oncall.ladderExhausted");
  if (!progress.next_at || !progress.next_targets.length) return "";

  const remaining = progress.next_at - nowMicros.value;
  const when =
    remaining <= 0
      ? t("oncall.ladderImminent")
      : t("oncall.ladderIn", { duration: formatMicrosDuration(remaining) });
  // Targets are the engine's own words for a rung ("the on-call", "the next
  // on-call"), so they pass through verbatim rather than being re-derived here.
  return t("oncall.escalationTo", { who: raw(progress.next_targets.join(", ")), when });
});
</script>
