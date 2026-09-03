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
  only answerable by opening the record.

  Words and tone, nothing else. A progress bar, a state icon and a delivery-failure
  line all sat here at various points; the first two restated the headline, and on
  a list whose rows already carry a priority rail, extra severity marks cost more
  attention than they returned.
-->
<template>
  <div class="flex min-w-0 flex-col gap-0.5" :data-test="`oncall-escalation-cell-${responseId}`">
    <!-- Tone alone, no icon and no bar. Both restated what the headline already
         says in words, and three severity signals on one cell competed with the
         row's own priority rail for the same glance. One line, not two: the
         detail sentence is the "why" behind the headline, not a second fact —
         it lives in the hover, not stacked under it. -->
    <span class="truncate text-sm" :class="toneClass" data-test="oncall-escalation-cell-level">
      {{ headline }}
      <OTooltip :content="tooltipContent" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
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

/// A page climbing the ladder is the only state worth shouting about; the three
/// settled states recede so the escalating rows are what the eye lands on. Tone
/// is now the cell's ONLY signal, which is why every state still has to have one.
const toneClass = computed(() => {
  if (props.state === "resolved") return "text-text-secondary";
  if (props.progress?.stopped_because === "snoozed") return "text-status-warning-text";
  if (props.state === "acknowledged") return "text-text-body";
  // Nothing was ever going to page here — the priority's policy has no rungs
  // behind it — so this is not the "wake somebody now" state the error tone
  // is reserved for.
  if (props.totalRungs === 0) return "text-text-secondary";
  return "text-status-error-text";
});

const firedCount = computed(() => props.progress?.fired.length ?? 0);

/// Distinct people the fired rungs reached. Deduplicated across rungs: a ladder
/// that rang the same person twice reached one person, and counting two would
/// promise a second pair of hands that never existed.
const peopleRung = computed(() => {
  const fired = props.progress?.fired ?? [];
  return new Set(fired.flatMap((rung) => rung.targets)).size;
});

/// One or two words. The full sentences ("Escalation stopped — somebody owns
/// this.") belong on the detail screen; in a table cell they truncate to
/// nothing, which is what this column was doing.
const headline = computed<I18nText>(() => {
  if (props.state === "resolved") return t("oncall.escalationResolvedShort");
  if (props.progress?.stopped_because === "snoozed") return t("oncall.escalationSnoozedShort");
  if (props.state === "acknowledged") return t("oncall.escalationAcked");
  // "Level 6 of 6" and "nobody is coming" are the same number and opposite
  // situations. A finished ladder says so in words.
  if (props.progress?.exhausted) return t("oncall.ladderFinished");
  // "Not paged yet" implies a page is coming; a priority with no rungs never
  // pages at all, which is a policy fact, not a pending one.
  if (props.totalRungs === 0) return t("oncall.escalationPagesNobody");
  if (firedCount.value === 0) return t("oncall.escalationNotStarted");
  // Who is being woken RIGHT NOW, not just how far up the ladder we are — that
  // is the name a responder checks against their own.
  const paging = props.progress?.next_targets ?? [];
  if (paging.length) {
    return t("oncall.escalationClimbing", {
      level: firedCount.value,
      who: raw(paging.join(", ")),
    });
  }
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
  // What the ladder spent before running out. "Exhausted" alone does not say
  // whether it reached three people or nobody at all.
  if (progress.exhausted) {
    return peopleRung.value > 0
      ? t(
          "oncall.ladderFinishedDetail",
          { people: peopleRung.value, levels: props.totalRungs ?? firedCount.value },
          peopleRung.value,
        )
      : t("oncall.ladderExhausted");
  }
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

/// What the hover says: the headline alone, or the headline plus the "why"
/// that used to sit under it as a second line.
const tooltipContent = computed<I18nText>(() =>
  detail.value ? raw(`${headline.value} — ${detail.value}`) : headline.value,
);
</script>
