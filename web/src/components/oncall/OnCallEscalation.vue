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

<template>
  <OCard data-test="oncall-escalation">
    <OCardSection>
      <h2 class="text-text-heading text-lg">{{ t("oncall.escalation") }}</h2>

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

      <!-- The headline. Mid-incident the question is not "who has been paged"
           but "when does this wake somebody else", and it was answerable
           nowhere in the product. -->
      <p
        v-if="progress.stopped_because"
        class="text-text-secondary mb-3 text-sm"
        data-test="oncall-escalation-stopped"
      >
        {{ t(`oncall.ladderStopped_${progress.stopped_because}`) }}
      </p>
      <!-- A liaison ladder that has run out has done its whole job. "Nobody
           left to escalate to" is the owner team's emergency, not this one's,
           and printing it here asks a team to chase an outage it cannot fix. -->
      <p
        v-else-if="progress.exhausted && isLiaison"
        class="text-text-secondary mb-3 text-sm"
        data-test="oncall-escalation-liaison-done"
      >
        {{ t("oncall.ladderLiaisonDone") }}
      </p>
      <p
        v-else-if="progress.exhausted"
        class="text-status-warning-text mb-3 text-sm"
        data-test="oncall-escalation-exhausted"
      >
        {{ t("oncall.ladderExhausted") }}
      </p>
      <p
        v-else-if="progress.next_at"
        class="text-text-body mb-3 text-sm"
        data-test="oncall-escalation-next"
      >
        {{ t("oncall.ladderNext", { who: nextWho, when: nextWhen }) }}
      </p>

      <ol v-if="progress.fired.length" class="flex flex-col gap-2">
        <li
          v-for="rung in progress.fired"
          :key="rung.after_micros"
          class="flex flex-wrap items-center gap-2"
          :data-test="`oncall-escalation-rung-${rung.after_micros}`"
        >
          <OTag variant="default-soft" size="sm">
            {{ rung.after_micros === 0 ? t("oncall.rungImmediately") : offset(rung.after_micros) }}
          </OTag>
          <span class="text-text-body text-sm">{{ raw(saidTargets(rung.targets)) }}</span>
          <OTimeCell :value="rung.at" unit="us" />
          <!-- `/escalation` cannot say this (§G.9 #6): a fired rung that
               reached nobody looks exactly like one that landed. The timeline
               can — its page entry carries the whole-rung-lost marker — so the
               rail cross-references it rather than vouching for every rung. -->
          <OTag
            v-if="unreachedRungs.has(rung.after_micros)"
            variant="error-soft"
            size="sm"
            :data-test="`oncall-escalation-rung-lost-${rung.after_micros}`"
          >
            {{ t("oncall.rungReachedNobodyRetrying") }}
          </OTag>
          <!-- B9's other "nobody": a rung whose targets resolved to no one.
               The ladder does the OPPOSITE thing about it — an empty rung is
               consumed and advanced past at once, a lost rung is retried — so
               the two must not share a tag. -->
          <OTag
            v-else-if="emptyRungs.has(rung.after_micros)"
            variant="warning-soft"
            size="sm"
            :data-test="`oncall-escalation-rung-empty-${rung.after_micros}`"
          >
            {{ t("oncall.rungMatchedNobody") }}
          </OTag>
        </li>
      </ol>
      <p v-else class="text-text-muted text-sm" data-test="oncall-escalation-none">
        {{ t("oncall.ladderNothingSent") }}
      </p>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type {
  DeliveryRecord,
  EscalationProgress,
  OnCallResponseEvent,
  ResponderRole,
} from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
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
  }>(),
  { events: () => [], deliveries: () => [], deliveriesTotal: null, responderRole: "owner" },
);

const { t } = useI18nTyped();

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
const nowMicros = useOnCallClock();

function offset(micros: number): string {
  return `+${formatMicrosDuration(micros)}`;
}

/// The engine's own English, said the way the editor says it. Both used to
/// render, one click apart, and the same rung read as two concepts.
const saidTargets = (targets: string[]) =>
  targets.map((target) => speakTarget(target, t)).join(", ");

const nextWho = computed(() => saidTargets(props.progress.next_targets));

// Relative, because "in 12 minutes" is what a responder is deciding against.
// An absolute time makes them do the arithmetic themselves.
const nextWhen = computed(() => {
  const at = props.progress.next_at;
  if (!at) return "";
  const remaining = at - nowMicros.value;
  return remaining <= 0
    ? t("oncall.ladderImminent")
    : t("oncall.ladderIn", { duration: formatMicrosDuration(remaining) });
});
</script>
