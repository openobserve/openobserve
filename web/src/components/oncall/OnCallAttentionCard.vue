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
  The one question this screen exists to answer, above the list that answers it
  in detail: is anything waiting on a person right now, and how long has it been
  waiting.

  It is deliberately NOT a seventh stat tile. The facts here are a sentence
  ("the oldest has been ringing for 6m 40s") rather than a count, and a count is
  what the filter strip below already does well.
-->
<template>
  <!-- Deliberately not a red-bordered card: the count and its icon are the
       signal, and tinting the whole surface would compete with the row rails
       in the list below, which carry severity per page. -->
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-1.5 border px-3.5 py-2.5"
    data-test="oncall-attention-card"
  >
    <span class="flex items-center gap-1.5">
      <OIcon
        :name="clear ? 'check-circle' : 'warning-amber'"
        size="xs"
        :class="clear ? 'text-status-success-text' : 'text-status-error-text'"
      />
      <OText variant="section">{{ t("oncall.attentionTitle") }}</OText>
    </span>

    <p v-if="clear" class="text-text-secondary text-sm" data-test="oncall-attention-clear">
      {{ t("oncall.attentionClear") }}
    </p>

    <template v-else>
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          class="text-status-error-text text-3xl leading-none font-semibold"
          data-test="oncall-attention-unacked"
        >
          {{ unacked }}
        </span>
        <span class="text-text-body text-sm">{{ t("oncall.attentionUnacked") }}</span>

        <!-- Pushed to the trailing edge: it is the deadline, not part of the
             count, and reading them as one phrase gets the number wrong. -->
        <OTag
          v-if="escalatesIn"
          variant="error-soft"
          size="sm"
          class="ms-auto"
          data-test="oncall-attention-escalates"
        >
          {{ escalatesIn }}
        </OTag>
      </div>

      <p class="text-text-secondary text-xs" data-test="oncall-attention-detail">
        <span v-if="assignedToMe > 0" class="text-text-body font-medium">
          {{ t("oncall.attentionAssigned", { count: assignedToMe }, assignedToMe) }}
        </span>
        {{ oldestRinging }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Open pages nobody has claimed and nothing is snoozing. */
    unacked: number;
    /** How many of those have a rung still to fire. */
    escalating?: number;
    /** Soonest `next_at` across them, in micros. Null when none is known. */
    nextEscalationAt?: number | null;
    /** Unacknowledged pages whose team currently resolves to the viewer. */
    assignedToMe?: number;
    /** `opened_at` of the longest-unacknowledged page, in micros. */
    oldestOpenedAt?: number | null;
  }>(),
  { escalating: 0, nextEscalationAt: null, assignedToMe: 0, oldestOpenedAt: null },
);

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const clear = computed(() => props.unacked === 0);

/// Only rendered while the deadline is still ahead: a countdown that has passed
/// says the ladder already moved, which the row's own cell reports accurately.
const escalatesIn = computed<I18nText | "">(() => {
  const at = props.nextEscalationAt;
  if (!at || !props.escalating) return "";
  const remaining = at - nowMicros.value;
  if (remaining <= 0) return "";
  return t(
    "oncall.attentionEscalatesIn",
    { count: props.escalating, duration: formatMicrosDuration(remaining) },
    props.escalating,
  );
});

const oldestRinging = computed<I18nText | "">(() => {
  const openedAt = props.oldestOpenedAt;
  if (!openedAt) return "";
  return t("oncall.attentionOldest", {
    duration: formatMicrosDuration(nowMicros.value - openedAt),
  });
});
</script>
