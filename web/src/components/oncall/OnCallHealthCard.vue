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
  Whether the rotation is answering, rather than what is on fire right now.

  Every figure is computed from records the screen already holds — there is no
  metrics endpoint — so the card says what it read, and shows nothing rather
  than a zero when the sample cannot answer a question.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-1.5 border px-3.5 py-2.5"
    data-test="oncall-health-card"
  >
    <span class="flex items-center gap-1.5">
      <OIcon name="show-chart" size="xs" class="text-text-secondary" />
      <OText variant="section">
        {{ t("oncall.healthTitle", { days: windowDays }, windowDays) }}
      </OText>
    </span>

    <p
      v-if="health.medianAckMicros === null"
      class="text-text-secondary text-sm"
      data-test="oncall-health-empty"
    >
      {{ t("oncall.healthNoAcks") }}
    </p>

    <template v-else>
      <span class="flex flex-wrap items-baseline gap-x-2">
        <span
          class="text-text-heading text-3xl leading-none font-semibold"
          data-test="oncall-health-median"
        >
          {{ medianAck }}
        </span>
        <span class="text-text-body text-sm">{{ t("oncall.healthMedianAck") }}</span>
      </span>

      <!-- One line, truncated: an alert name can be arbitrarily long, and
           letting it wrap makes this card taller than the two beside it. -->
      <p class="text-text-secondary truncate text-xs" data-test="oncall-health-detail">
        <span v-if="beforeEscalating" class="text-text-body font-medium">
          {{ beforeEscalating }}
        </span>
        <span v-if="beforeEscalating && topAlert"> · </span>
        <span v-if="topAlert">{{ topAlert }}</span>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import type { ResponseHealth } from "@/utils/oncall";

const props = defineProps<{
  health: ResponseHealth;
  /**
   * Length of the window the figures cover, in micros. The heading is written
   * from THIS rather than carrying its own "7 days", so widening the window
   * cannot leave the card describing a period it did not read.
   */
  windowMicros: number;
}>();

const { t } = useI18nTyped();

const windowDays = computed(() => Math.round(props.windowMicros / MICROS_PER_DAY));

const medianAck = computed(() =>
  raw(props.health.medianAckMicros === null ? "" : formatMicrosDuration(props.health.medianAckMicros)),
);

/// Rounded to whole percent: a tenth of a percent on a sample of forty pages is
/// precision the number does not have.
function percent(share: number): I18nText {
  return raw(`${Math.round(share * 100)}%`);
}

const beforeEscalating = computed<I18nText | "">(() => {
  const share = props.health.ackedBeforeEscalatingPct;
  return share === null
    ? ""
    : t("oncall.healthBeforeEscalating", { percent: percent(share) });
});

const topAlert = computed<I18nText | "">(() => {
  const top = props.health.topAlert;
  return top
    ? t("oncall.healthTopAlert", { percent: percent(top.share), name: raw(top.title) })
    : "";
});
</script>
