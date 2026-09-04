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
  A page that has reached nobody, said at the top of the screen.

  The ledger and the ladder both already hold this fact, spread over a dozen
  rows a reader has to add up. What they cannot say is the one sentence that
  matters — nobody has seen this — nor the reason, which is usually a missing
  transport rather than anything about this page.

  Silent unless every attempt since the last landed send failed. A banner
  that also appears when one send of five bounced — or that still remembers
  a lucky send from days ago while everything since has failed — is a banner
  people learn to scroll past.
-->
<template>
  <OBanner
    v-if="visible"
    variant="error"
    inline-actions
    icon="warning-amber"
    class="mb-3"
    data-test="oncall-reach-alarm"
  >
    <span class="flex flex-wrap items-baseline gap-x-1.5">
      <span class="font-medium" data-test="oncall-reach-alarm-headline">
        {{ t("oncall.reachAlarmHeadline") }}
      </span>
      <span data-test="oncall-reach-alarm-detail">{{ detail }}</span>
      <!-- The deployment-level reason, only when the server has stated it.
           Guessing at a cause is how a team spends an outage checking a
           mailbox that was never the problem. -->
      <span v-if="cause" class="font-medium" data-test="oncall-reach-alarm-cause">
        {{ cause }}
      </span>
    </span>

    <template #actions>
      <span class="flex flex-wrap items-center gap-2">
        <!--
          Not "page someone manually": no endpoint opens a page from nothing —
          a page is born from a firing alert. Escalating this record is the
          real verb that wakes the next rung now, and it is the one a reader
          staring at a silent ladder actually wants.
        -->
        <OButton
          v-if="canEscalate"
          variant="primary"
          size="sm-action"
          :loading="escalating"
          data-test="oncall-reach-alarm-escalate"
          @click="emit('escalate')"
        >
          {{ t("oncall.escalate") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          data-test="oncall-reach-alarm-reachability"
          @click="emit('open-reachability')"
        >
          {{ t("oncall.reachAlarmCheckTransports") }}
        </OButton>
      </span>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type {
  DeliveryRecord,
  EscalationProgress,
  ResponseState,
} from "@/ts/interfaces/oncall";
import { useI18nTyped } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    state: ResponseState;
    /** Every send this page attempted — the only record of what landed. */
    deliveries?: DeliveryRecord[];
    /** The ledger's exact size. A page of it cannot prove "all failed". */
    deliveriesTotal?: number | null;
    progress?: EscalationProgress | null;
    /**
     * `false` from `GET /teams/{id}/reachability`. `null` means the check did
     * not answer, which is not the same as a working transport.
     */
    smtpConfigured?: boolean | null;
    escalating?: boolean;
  }>(),
  {
    deliveries: () => [],
    deliveriesTotal: null,
    progress: null,
    smtpConfigured: null,
    escalating: false,
  },
);

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();
const emit = defineEmits<{ escalate: []; "open-reachability": [] }>();

/// Sends addressed to a person. A room post is a broadcast, and one that fails
/// says nothing about whether the on-call was reached.
const personSends = computed(() =>
  props.deliveries.filter((d) => d.channel !== "chat" && d.channel !== "webhook"),
);

/// Only what has happened since the last time anyone was actually reached. A
/// send that landed hours or days ago and drew no acknowledgment does not
/// vouch for the attempts made since — a ladder keeps failing long after
/// whatever reached somebody once, including across a handoff that restarts
/// it under a new team (a later run's deliveries are, by construction,
/// chronologically after an earlier run's).
const sinceLastLanded = computed(() => {
  const lastLandedAt = Math.max(
    -Infinity,
    ...personSends.value.filter((d) => d.delivered === true).map((d) => d.at),
  );
  return personSends.value.filter((d) => d.at > lastLandedAt);
});

const failed = computed(() => sinceLastLanded.value.filter((d) => d.delivered === false));
const landed = computed(() => sinceLastLanded.value.filter((d) => d.delivered === true));

/// A truncated ledger cannot support "all of them failed" — the send that
/// landed may be on the page nobody fetched. Withholding the banner is the
/// smaller wrong.
const ledgerIsWhole = computed(
  () => props.deliveriesTotal === null || props.deliveries.length >= props.deliveriesTotal,
);

const visible = computed(
  () =>
    props.state === "triggered" &&
    ledgerIsWhole.value &&
    failed.value.length > 0 &&
    landed.value.length === 0,
);

/// Who was aimed at, deduplicated: five retries to one address is one person
/// nobody has reached, not five.
const people = computed(() => [
  ...new Set(failed.value.map((d) => d.recipient).filter((r): r is string => !!r)),
]);

const detail = computed(() => {
  const count = failed.value.length;
  const who = people.value.join(", ");
  const failure = who
    ? t("oncall.reachAlarmFailedTo", { count, who }, count)
    : t("oncall.reachAlarmFailed", { count }, count);
  return `${failure} ${retry.value}`.trim();
});

/// Whether anything is still trying. The two ends of this are different
/// emergencies: a ladder still climbing may yet reach somebody, and one that
/// has finished never will.
const retry = computed(() => {
  if (props.progress?.exhausted) return t("oncall.reachAlarmNoRetry");
  const at = props.progress?.next_at;
  if (!at) return "";
  const remaining = at - nowMicros.value;
  return remaining > 0
    ? t("oncall.reachAlarmRetries", { duration: formatMicrosDuration(remaining) })
    : t("oncall.reachAlarmRetryImminent");
});

/// The server's own finding, never our inference. `smtp_configured: false`
/// explains every failed email row above it in one line.
const cause = computed(() =>
  props.smtpConfigured === false ? t("oncall.reachAlarmNoTransport") : "",
);

const canEscalate = computed(() => !props.progress?.exhausted);
</script>
