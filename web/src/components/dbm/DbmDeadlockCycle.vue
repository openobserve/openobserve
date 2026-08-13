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
  DbmDeadlockCycle — one deadlock as a FACE-OFF, rendered inside the expanded
  row rather than in a drawer.

  A deadlock is symmetric: there is no root cause and no upstream party, both
  sides hold what the other wants. A tree would put one at the top and imply
  blame; a timeline would imply a sequence that finished. Two mirrored columns
  with the loop drawn between them state the truth, and the only asymmetry —
  who got cancelled — is the one thing colour is spent on.

  The centre names the CONTESTED OBJECT, because that is what the fix is about.
-->
<template>
  <div class="flex flex-col gap-2" :data-test="dataTest">
    <!-- A half-rendered face-off would read as a bug in the page, so a
         one-sided event says WHY its partner is missing before showing it. -->
    <div
      v-if="event.partial"
      class="bg-status-warning-bg text-text-body rounded-default flex items-start gap-2 px-2.5 py-2 text-xs leading-relaxed"
      :data-test="`${dataTest}-partial`"
    >
      <OIcon name="info-outline" class="text-status-warning-text mt-px size-4 shrink-0" />
      <p>
        <span class="text-text-heading font-semibold">
          {{ t("dbm.deadlocks.detail.partialTitle") }}
        </span>
        {{ t("dbm.deadlocks.detail.partialBody") }}
      </p>
    </div>

    <!-- The two sides, with the loop between them. `items-stretch` so both
         columns share a height however long the statements are. -->
    <div
      class="border-border-default rounded-surface grid items-stretch overflow-hidden border"
      :class="event.partial ? '' : 'md:grid-cols-[1fr_8.5rem_1fr]'"
      :data-test="`${dataTest}-cycle`"
    >
      <DbmDeadlockSide
        v-if="victim"
        :participant="victim"
        :db-system="event.db_system"
        role="victim"
        :data-test="`${dataTest}-victim`"
        @action="(id) => emit('participant-action', id, victim!)"
      />

      <!-- The loop. Two arcs and the contested object — the picture that says
           "neither can move" faster than the sentence below it does. It is
           hidden on a one-sided event: an arc drawn to nothing would assert a
           relationship the data does not contain. -->
      <div
        v-if="!event.partial"
        class="border-border-subtle bg-surface-panel flex flex-col items-center justify-center gap-1 px-1 py-2 md:border-x"
      >
        <span
          class="text-text-label text-3xs text-center leading-tight font-semibold tracking-wide uppercase"
        >
          {{ t("dbm.deadlocks.detail.eachWaits") }}
        </span>
        <svg viewBox="0 0 128 68" fill="none" class="h-17 w-32" aria-hidden="true">
          <defs>
            <!-- One arrowhead definition serves both arcs: `orient="auto"`
                 turns it with each path, so the two ends need no separate
                 marker. -->
            <marker
              :id="markerId"
              markerWidth="7"
              markerHeight="7"
              refX="5.4"
              refY="3"
              orient="auto"
            >
              <path d="M0 0.4 L6 3 L0 5.6 z" fill="var(--color-status-error-text)" />
            </marker>
          </defs>
          <path
            d="M6 26 C 34 6, 94 6, 120 24"
            stroke="var(--color-status-error-text)"
            stroke-width="1.8"
            :marker-end="`url(#${markerId})`"
            fill="none"
          />
          <path
            d="M122 42 C 94 62, 34 62, 8 44"
            stroke="var(--color-status-error-text)"
            stroke-width="1.8"
            :marker-end="`url(#${markerId})`"
            fill="none"
          />
          <rect
            x="34"
            y="26"
            width="60"
            height="16"
            rx="8"
            fill="var(--color-surface-base)"
            stroke="var(--color-border-default)"
          />
          <text
            x="64"
            y="37"
            text-anchor="middle"
            font-size="9"
            font-weight="700"
            fill="var(--color-text-secondary)"
          >
            {{ raw(objectLabel) }}
          </text>
        </svg>
        <span
          class="text-status-error-text text-3xs text-center leading-tight font-semibold tracking-wide uppercase"
        >
          {{ t("dbm.deadlocks.detail.deadlock") }}
        </span>
      </div>

      <DbmDeadlockSide
        v-if="survivor"
        :participant="survivor"
        :db-system="event.db_system"
        role="survivor"
        :data-test="`${dataTest}-survivor`"
        @action="(id) => emit('participant-action', id, survivor!)"
      />
    </div>

    <!-- The ordering, in plain words. The picture shows the shape; this says
         what actually happened and to whom. It names BOTH applications, so it
         is suppressed when only one side reached us. -->
    <div
      v-if="!event.partial && victim && survivor"
      class="bg-status-info-bg text-text-body rounded-default flex items-start gap-2 px-2.5 py-2 text-xs leading-relaxed"
      :data-test="`${dataTest}-plain`"
    >
      <OIcon name="info-outline" class="text-status-info-text mt-px size-4 shrink-0" />
      <p>
        <span class="text-text-heading font-semibold">
          {{ t("dbm.deadlocks.detail.plainTitle") }}
        </span>
        {{ plainBody }}
      </p>
    </div>

    <!-- What to DO. The one band that turns a diagnosis into a change. -->
    <div
      class="border-border-default bg-surface-base rounded-default flex items-center gap-2 border px-2.5 py-1.5 text-xs"
      :data-test="`${dataTest}-fix`"
    >
      <OIcon name="check-circle" class="text-status-success-text size-4 shrink-0" />
      <p class="text-text-body min-w-0 flex-1">
        <span class="text-text-heading font-semibold">
          {{ t("dbm.deadlocks.detail.fixTitle") }}
        </span>
        {{ fixBody }}
      </p>
      <!-- Beside the fix sentence, because that sentence is exactly what the
           user wants elaborated: the band says WHAT to do, this asks HOW. -->
      <DbmSuggestFixButton
        :label="t('dbm.ai.deadlockFix')"
        :tooltip="t('dbm.ai.deadlockFixHint')"
        :data-test="`${dataTest}-ask-ai`"
        @click="emit('ask-ai')"
      />
      <!-- Labelled by PAYLOAD, not destination. This sits beside a per-side
           "Copy SQL", and "Copy for Slack" named where to paste rather than
           what you get — leaving two adjacent buttons that both read as
           "Copy". The tooltip states the scope difference the labels alone
           cannot carry. -->
      <OButton
        variant="primary"
        size="sm"
        icon-left="content-copy"
        class="shrink-0"
        :data-test="`${dataTest}-copy-slack`"
        @click="emit('copy-summary')"
      >
        {{ t("dbm.deadlocks.detail.copyForSlack") }}
        <OTooltip side="top" :content="t('dbm.deadlocks.detail.copyForSlackHint')" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";

import DbmDeadlockSide from "@/components/dbm/DbmDeadlockSide.vue";
import DbmSuggestFixButton from "@/components/dbm/DbmSuggestFixButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { DeadlockEvent, DeadlockParticipant } from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { survivorOf, victimOf } from "@/utils/dbm/deadlocks";

const props = withDefaults(
  defineProps<{
    event: DeadlockEvent;
    /** The pair's statements touch one object's rows in opposite order. */
    oppositeRowOrder?: boolean;
    dataTest?: string;
  }>(),
  { oppositeRowOrder: false, dataTest: "dbm-deadlock-cycle" },
);

const emit = defineEmits<{
  (e: "participant-action", id: string, participant: DeadlockParticipant): void;
  (e: "copy-summary"): void;
  (e: "ask-ai"): void;
}>();

const { t } = useI18nTyped();

// SVG marker ids must be unique per instance: two expanded cycles on one page
// would otherwise share a marker and the second would inherit the first's.
const markerId = useId();

const victim = computed(() => victimOf(props.event));
const survivor = computed(() => survivorOf(props.event));

/** The contested object — what the fix is actually about. */
const objectLabel = computed(() => props.event.objects?.[0] ?? "");

const sideLabel = (participant: DeadlockParticipant | null) =>
  participant?.application?.trim() || (participant?.pid != null ? String(participant.pid) : "");

const plainBody = computed<I18nText>(() =>
  t("dbm.deadlocks.detail.plainBody", {
    a: sideLabel(victim.value),
    b: sideLabel(survivor.value),
    victim: victim.value?.pid ?? "",
  }),
);

/**
 * The lock-ordering fix is only stated when the evidence supports it; otherwise
 * the generic advice, which is true of every deadlock.
 */
const fixBody = computed<I18nText>(() =>
  props.oppositeRowOrder && objectLabel.value
    ? t("dbm.deadlocks.detail.fixBody", { object: objectLabel.value })
    : t("dbm.deadlocks.detail.fixGeneric"),
);
</script>
