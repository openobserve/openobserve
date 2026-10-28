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
    <!-- The one error tag, decided by the same progress the phrase reads, so the two cannot disagree. -->
    <span v-if="phrase.kind === 'nobodyAnswered'" class="inline-flex">
      <OTag
        type="oncallResponseState"
        value="exhausted"
        size="sm"
        data-test="oncall-escalation-cell-exhausted"
      />
      <OTooltip :content="tooltipContent" />
    </span>
    <span v-else class="truncate" :class="toneClass" data-test="oncall-escalation-cell-level">
      {{ headline }}
      <OTooltip :content="tooltipContent" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import type { EscalationProgress, OnCallResponse } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { formatOnCallInstant, pagePhrase } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Only used for the `data-test` hooks, so each row's cell is addressable. */
    responseId: string;
    record: OnCallResponse;
    /** Absent while the ladder position is still loading, beyond the fetch cap, or on a list that never fetches it. */
    progress?: EscalationProgress | null;
    /** False until the first progress fetch has answered, so an absent `progress` reads as blank, not "Not paged yet". */
    progressLoaded?: boolean;
    /** Rungs the team's policy defines for this priority; absent when the policy could not be read. */
    totalRungs?: number | null;
    /** The step the record says it reached, for a list with no progress per row. */
    reachedStep?: number | null;
  }>(),
  { progress: null, progressLoaded: true, totalRungs: null, reachedStep: null },
);

const { t } = useI18nTyped();
const store = useStore();
const nowMicros = useOnCallClock();

const phrase = computed(() =>
  pagePhrase({
    record: props.record,
    progress: props.progress,
    progressLoaded: props.progressLoaded,
    totalRungs: props.totalRungs,
    reachedStep: props.reachedStep,
    nowMicros: nowMicros.value,
  }),
);

/// Tone is the cell's only signal besides the words, so every phrase has one.
const toneClass = computed(() => {
  switch (phrase.value.kind) {
    case "resolved":
    case "pagesNobody":
    case "unknown":
      return "text-text-secondary";
    case "acknowledged":
      return "text-text-body";
    case "snoozed":
    case "reachedNobody":
      return "text-status-warning-text";
    case "nobodyAnswered":
    case "held":
    case "notPaged":
    case "paging":
      return "text-status-error-text";
  }
  return "text-status-error-text";
});

function pagingLine(step: number, total: number | null, who: string[]): I18nText {
  const names = raw(who.join(", "));
  if (total === null) {
    return who.length
      ? t("oncall.escalationPagingStepOpen", { step, who: names })
      : t("oncall.escalationPagingStepOpenOnly", { step });
  }
  return who.length
    ? t("oncall.escalationPagingStep", { step, total, who: names })
    : t("oncall.escalationPagingStepOnly", { step, total });
}

const headline = computed<I18nText>(() => {
  const p = phrase.value;
  switch (p.kind) {
    case "resolved":
      return p.afterMicros === null
        ? t("oncall.state_resolved")
        : t("oncall.resolvedAfter", { duration: raw(formatMicrosDuration(p.afterMicros)) });
    case "acknowledged":
      return p.by
        ? t("oncall.escalationAckedBy", { who: raw(p.by) })
        : t("oncall.state_acknowledged");
    case "snoozed":
      return t("oncall.escalationSnoozedUntil", {
        time: raw(formatOnCallInstant(p.until, nowMicros.value, store.state.timezone)),
      });
    case "nobodyAnswered":
      return t("oncall.state_exhausted");
    case "held":
      return t("oncall.escalationHeld", { n: p.secondsLeft });
    case "pagesNobody":
      return t("oncall.escalationPagesNobody");
    case "unknown":
      return raw("");
    case "notPaged":
      return t("oncall.escalationNotStarted");
    case "paging":
      return pagingLine(p.step, p.total, p.who);
    case "reachedNobody":
      return p.total === null
        ? t("oncall.escalationStepReachedNobodyOpen", { step: p.step })
        : t("oncall.escalationStepReachedNobody", { step: p.step, total: p.total });
  }
  return raw("");
});

/// Distinct people the fired rungs reached, deduplicated across rungs.
const peopleRung = computed(() => {
  const fired = props.progress?.fired ?? [];
  return new Set(fired.flatMap((rung) => rung.targets)).size;
});

/// Relative, because "in 4m 12s" is the number being decided against.
const detail = computed<I18nText | "">(() => {
  const record = props.record;
  const progress = props.progress;
  if (record.state === "acknowledged" || record.state === "resolved") {
    return record.acked_at
      ? t("oncall.escalationAckedIn", {
          duration: formatMicrosDuration(record.acked_at - record.opened_at),
        })
      : "";
  }
  if (!progress) return "";
  if (phrase.value.kind === "snoozed") return "";
  if (progress.exhausted) {
    return peopleRung.value > 0
      ? t(
          "oncall.ladderFinishedDetail",
          { people: peopleRung.value, levels: props.totalRungs ?? progress.fired.length },
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
  return t("oncall.escalationTo", { who: raw(progress.next_targets.join(", ")), when });
});

const tooltipContent = computed<I18nText>(() =>
  detail.value ? raw(`${headline.value} — ${detail.value}`) : headline.value,
);
</script>
