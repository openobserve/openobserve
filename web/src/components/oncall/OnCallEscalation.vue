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
  Where the ladder has got to, as a ladder rather than a log.

  A repeating policy fires the same rung five times, and printing five
  near-identical lines buries the one fact worth reading — that the whole
  repeat reached nobody. Consecutive rungs aiming at the same people are one
  row with a count, which is also how a human describes it out loud.
-->
<template>
  <OCard variant="outlined" data-test="oncall-escalation">
    <OCardSection role="body">
      <span class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <OText variant="panel-title">{{ t("oncall.escalation") }}</OText>
        <OButton
          v-if="teamId"
          variant="ghost"
          size="xs"
          data-test="oncall-escalation-edit"
          @click="emit('edit')"
        >
          {{ t("oncall.edit") }}
        </OButton>
      </span>

      <!-- D-21: an impacted record is a liaison seat, and its ladder is
           deliberately two rungs — the opening page and one chase — with no
           repeat and no handoff. Unexplained, that reads as a ladder somebody
           misconfigured, and its end reads as a failure. -->
      <p
        v-if="isLiaison"
        class="text-text-secondary mb-3 text-sm"
        data-test="oncall-escalation-liaison-note"
      >
        {{ t("oncall.ladderLiaisonNote") }}
      </p>

      <p
        v-if="!groups.length"
        class="text-text-muted mb-3 text-sm"
        data-test="oncall-escalation-none"
      >
        {{ t("oncall.ladderNothingSent") }}
      </p>

      <!-- A rail, not a list: the rungs are one climb, and the level rides the
           rail itself the way the policy editor numbers them. The end is the
           last stop on the same rail rather than a footnote under a rule —
           a ladder that has sent nothing still has one. -->
      <OTimeline>
        <OTimelineItem
          v-for="group in groups"
          :key="group.key"
          :label="group.levelLabel"
          :variant="rungVariant(group)"
          :data-test="`oncall-escalation-rung-${group.firstMicros}`"
        >
          <div
            class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
            :data-test="`oncall-escalation-level-${group.key}`"
          >
            <span class="text-text-body min-w-0 flex-1 text-sm">
              {{ group.said }}
              <span v-if="group.everyLabel" class="text-text-muted">{{ group.everyLabel }}</span>
            </span>

            <!-- `/escalation` cannot say this (§G.9 #6): a fired rung that
                 reached nobody looks exactly like one that landed. The timeline
                 can — its page entry carries the whole-rung-lost marker — so the
                 rail cross-references it rather than vouching for every rung. -->
            <OTag
              v-if="group.lost"
              variant="error-soft"
              size="sm"
              class="shrink-0"
              :data-test="`oncall-escalation-rung-lost-${group.firstMicros}`"
            >
              {{
                group.count > 1
                  ? t("oncall.rungLostTimes", { count: group.count })
                  : t("oncall.rungLost")
              }}
            </OTag>
            <!-- B9's other "nobody": a rung whose targets resolved to no one.
                 The ladder does the OPPOSITE thing about it — an empty rung is
                 consumed and advanced past at once, a lost rung is retried — so
                 the two must not share a tag. -->
            <OTag
              v-else-if="group.empty"
              variant="warning-soft"
              size="sm"
              class="shrink-0"
              :data-test="`oncall-escalation-rung-empty-${group.firstMicros}`"
            >
              {{ t("oncall.rungMatchedNobody") }}
            </OTag>
            <OTimeCell v-else class="text-text-muted shrink-0" :value="group.lastAt" unit="us" />
          </div>
        </OTimelineItem>

        <!-- What is still to come, or that nothing is. -->
        <OTimelineItem
          :label="t('oncall.ladderEnd')"
          :variant="endVariant"
          data-test="oncall-escalation-end"
        >
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="min-w-0 flex-1 text-sm" :class="endTone">{{ endLabel }}</span>
            <OTimeCell v-if="endAt" class="text-text-muted shrink-0" :value="endAt" unit="us" />
          </div>
        </OTimelineItem>
      </OTimeline>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import type {
  DeliveryRecord,
  EscalationProgress,
  OnCallResponseEvent,
  PolicyFinalAction,
  ResponderRole,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { formatMicrosDuration } from "@/utils/formatters";
import { speakTarget } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    progress: EscalationProgress;
    /** The record's timeline, for the whole-rung-lost cross-reference. */
    events?: OnCallResponseEvent[];
    /** The delivery ledger — the only place per-send attempts are recorded. */
    deliveries?: DeliveryRecord[];
    /** The ledger's exact size. `null` means unknown, which withholds the tag. */
    deliveriesTotal?: number | null;
    /**
     * Why this team holds the record. The server always sends it; the default
     * keeps a caller that has only the progress payload rendering the owner
     * reading, which is the one that was correct before this prop existed.
     */
    responderRole?: ResponderRole;
    /** The team's policy `final_action` — what happens when the rungs run out. */
    finalAction?: PolicyFinalAction | null;
    /** Set to offer the edit affordance; the caller owns where it goes. */
    teamId?: string | null;
  }>(),
  {
    events: () => [],
    deliveries: () => [],
    deliveriesTotal: null,
    responderRole: "owner",
    finalAction: null,
    teamId: null,
  },
);

const emit = defineEmits<{ edit: [] }>();

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

/// An impacted team is paged to contain the blast radius, never to fix the
/// cause: `impacted_ladder` truncates its policy to two rungs, `tick` refuses
/// to repeat it, and no final action hands it anywhere.
const isLiaison = computed(() => props.responderRole === "impacted");

/// Rungs of the CURRENT run whose page entry says the transport lost them.
/// `/escalation` is scoped to the current run, so the events are too: an
/// earlier run's lost rung is history, not a retry in flight. Absent
/// `ladder_run` means the first run.
const unreachedRungs = computed(() => {
  const pages = props.events.filter((e) => e.kind === "page");
  const run = Math.max(1, ...pages.map((e) => e.ladder_run ?? 1));
  return new Set(
    pages
      .filter((e) => (e.ladder_run ?? 1) === run && e.delivered === false)
      .map((e) => e.rung_micros ?? 0),
  );
});

/// Rungs whose targets resolved to NO ONE — the other "nobody" (B9), told
/// apart structurally rather than by parsing the body: a reached or lost rung
/// always writes per-send delivery entries; an empty rung writes only its
/// page line, because there was never anyone to attempt.
///
/// The attempts come from the **ledger**, not from `events[]`: storage keeps
/// `delivery` out of the timeline, so reading it there found nothing and
/// tagged every rung — including the ones that landed — as matching nobody.
const attemptedRungs = computed(() => {
  const currentRun = Math.max(1, ...props.deliveries.map((d) => d.ladder_run ?? 1));
  return new Set(
    props.deliveries
      .filter((d) => (d.ladder_run ?? 1) === currentRun)
      .map((d) => d.rung_micros ?? 0),
  );
});

/// A page of the ledger cannot prove a rung had no attempts — the missing one
/// may be on the next page. Below that bar the tag is withheld: an unlabelled
/// rung is a smaller wrong than one labelled "matched nobody" falsely.
const ledgerIsWhole = computed(
  () => props.deliveriesTotal === null || props.deliveries.length >= props.deliveriesTotal,
);

const emptyRungs = computed(() => {
  if (!ledgerIsWhole.value) return new Set<number>();
  const currentRun = Math.max(1, ...props.events.map((e) => e.ladder_run ?? 1));
  return new Set(
    props.events
      .filter(
        (e) =>
          (e.ladder_run ?? 1) === currentRun &&
          e.kind === "page" &&
          e.delivered !== false &&
          !attemptedRungs.value.has(e.rung_micros ?? 0),
      )
      .map((e) => e.rung_micros ?? 0),
  );
});

/// The engine's own English, said the way the editor says it. Both used to
/// render, one click apart, and the same rung read as two concepts.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");

interface RungGroup {
  key: string;
  levelLabel: I18nText;
  said: string;
  everyLabel: string;
  count: number;
  firstMicros: number;
  lastAt: number;
  lost: boolean;
  empty: boolean;
}

/// Consecutive rungs aiming at the same people fold into one row. A repeat
/// pass is one decision the policy made, not five events a reader should count
/// by hand.
const groups = computed<RungGroup[]>(() => {
  const rungs = [...props.progress.fired].sort((a, b) => a.after_micros - b.after_micros);
  const out: RungGroup[] = [];
  let level = 0;

  for (const rung of rungs) {
    level += 1;
    const said = saidTargets(rung.targets);
    const previous = out[out.length - 1];
    const lost = unreachedRungs.value.has(rung.after_micros);
    const empty = !lost && emptyRungs.value.has(rung.after_micros);

    // Only fold rungs that share a verdict too: "failed ×5" must not swallow
    // the one attempt in the middle that landed.
    if (previous && previous.said === said && previous.lost === lost && previous.empty === empty) {
      previous.count += 1;
      previous.levelLabel = t("oncall.ladderLevelRange", {
        from: level - previous.count + 1,
        to: level,
      });
      previous.everyLabel = everyLabel(rung.at - previous.lastAt);
      previous.lastAt = rung.at;
      continue;
    }

    out.push({
      key: `${rung.after_micros}`,
      levelLabel: t("oncall.ladderLevel", { level }),
      said,
      everyLabel: "",
      count: 1,
      firstMicros: rung.after_micros,
      lastAt: rung.at,
      lost,
      empty,
    });
  }
  return out;
});

/// The cadence of a folded repeat, said once instead of five timestamps.
function everyLabel(gapMicros: number): string {
  return gapMicros > 0
    ? t("oncall.ladderEvery", { duration: formatMicrosDuration(gapMicros) })
    : "";
}

/// The dot the rail's last stop carries. A ladder that ran out is the loud
/// failure this panel exists for; one that stopped because somebody owns it is
/// not, and the two must not share a colour.
const endVariant = computed<TimelineItemVariant>(() => {
  if (stoppedKey.value) return "muted";
  if (props.progress.exhausted) return isLiaison.value ? "muted" : "destructive";
  if (props.progress.stopped_because) return "destructive";
  return "info";
});

/// Which dot a rung carries: a lost rung is the one worth finding at a glance.
function rungVariant(group: RungGroup): TimelineItemVariant {
  if (group.lost) return "destructive";
  if (group.empty) return "muted";
  return "primary";
}

/// `stopped_because` is an enum for the three states this card has copy for and
/// a plain English sentence for the rest (a deleted team, an exhausted ladder).
/// Interpolating the sentence into a key printed the key back at the reader.
const STOPPED_KEYS = ["acknowledged", "snoozed", "resolved"] as const;
type StoppedKey = (typeof STOPPED_KEYS)[number];

const stoppedKey = computed<StoppedKey | null>(() => {
  const reason = props.progress.stopped_because;
  return reason && (STOPPED_KEYS as readonly string[]).includes(reason)
    ? (reason as StoppedKey)
    : null;
});

/// What is still due. The three endings are different emergencies: stopped
/// because somebody owns it, still climbing, or finished with nobody left.
const endLabel = computed<I18nText>(() => {
  if (stoppedKey.value) return t(`oncall.ladderStopped_${stoppedKey.value}`);
  // An exhausted ladder arrives stopped as well, and this card's own wording
  // for it knows about the liaison seat and the final action; the server's
  // one-line reason knows neither.
  if (props.progress.exhausted) {
    if (isLiaison.value) return t("oncall.ladderLiaisonDone");
    return props.finalAction === "notify_default_team"
      ? t("oncall.ladderEndsDefaultTeam")
      : t("oncall.ladderExhausted");
  }
  if (props.progress.stopped_because) return raw(props.progress.stopped_because);
  const at = props.progress.next_at;
  if (!at) return t("oncall.ladderEndUnknown");
  const remaining = at - nowMicros.value;
  const when =
    remaining <= 0
      ? t("oncall.ladderImminent")
      : t("oncall.ladderIn", { duration: formatMicrosDuration(remaining) });
  return t("oncall.ladderNext", { who: saidTargets(props.progress.next_targets), when });
});

const endTone = computed(() => {
  if (stoppedKey.value) return "text-text-secondary";
  if (props.progress.exhausted)
    return isLiaison.value ? "text-text-secondary" : "text-status-warning-text";
  if (props.progress.stopped_because) return "text-status-warning-text";
  return "text-text-body";
});

/// The instant the ladder finished, taken from the last rung it fired — the
/// progress payload has no field for it.
const endAt = computed(() => {
  if (!props.progress.exhausted) return null;
  const last = groups.value[groups.value.length - 1];
  return last ? last.lastAt : null;
});
</script>
