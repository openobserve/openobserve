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
          <span class="text-text-body text-sm">{{ raw(rung.targets.join(", ")) }}</span>
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
import type { EscalationProgress, OnCallResponseEvent } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    progress: EscalationProgress;
    /** The record's timeline, for the whole-rung-lost cross-reference. */
    events?: OnCallResponseEvent[];
  }>(),
  { events: () => [] },
);

const { t } = useI18nTyped();

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
const nowMicros = useOnCallClock();

function offset(micros: number): string {
  return `+${formatMicrosDuration(micros)}`;
}

const nextWho = computed(() => props.progress.next_targets.join(", "));

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
