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
  Who has actually been carrying the pager.

  `GET .../load` counts pages, nights and acks per person in the database, and
  scores each rotation's share of shift TIME with its own verdict. Nights are
  the number worth looking at: an even split of pages can still hide one person
  taking every 3am.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-2 border px-3.5 py-3"
    data-test="oncall-load-balance"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">
        {{ t("oncall.loadBalanceTitle", { days: windowDays }) }}
      </OText>
      <OText variant="meta">{{ t("oncall.loadBalanceHint") }}</OText>
    </span>

    <p v-if="!carriers.length" class="text-text-secondary text-sm" data-test="oncall-load-empty">
      {{ t("oncall.loadBalanceNone") }}
    </p>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="entry in carriers"
        :key="entry.user_email"
        class="flex flex-col gap-1"
        :data-test="`oncall-load-row-${entry.user_email}`"
      >
        <span class="flex items-baseline justify-between gap-2">
          <OUserCell :value="entry.user_email" />
          <span class="text-text-secondary shrink-0 text-xs">
            {{ entry.summary }}
          </span>
        </span>
        <OProgressBar :value="entry.share" size="xs" :variant="entry.tone" />
      </li>
    </ul>

    <!-- The server's own verdict per rotation, worded by it. A share that is
         merely uneven is not automatically unfair — the rotation may be
         deliberately weighted — so the sentence comes from the engine. -->
    <p
      v-for="fairness in rotations"
      :key="fairness.rotation"
      class="text-text-secondary text-xs"
      :data-test="`oncall-load-fairness-${fairness.rotation}`"
    >
      {{ raw(`${fairness.rotation}: ${fairness.summary}`) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import type { RotationFairness, TeamLoad } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(defineProps<{ load?: TeamLoad | null }>(), { load: null });

const { t } = useI18nTyped();

/// Read from the window the SERVER answered for, so widening it cannot leave
/// the heading naming a period it did not count.
const windowDays = computed(() => {
  const days = props.load?.days;
  if (days) return days;
  const span = (props.load?.to ?? 0) - (props.load?.from ?? 0);
  return span > 0 ? Math.max(1, Math.round(span / MICROS_PER_DAY)) : 30;
});

/**
 * One person answering more than half of everything is the imbalance worth
 * colouring. Below that the bar stays neutral — a rotation is allowed to be
 * slightly uneven without the screen implying somebody is being exploited.
 */
const UNEVEN_SHARE = 0.5;

interface Carrier {
  user_email: string;
  share: number;
  summary: I18nText;
  tone: ProgressBarVariant;
}

/// Ranked by pages carried. Anybody who carried nothing is left out: they are
/// not part of "who has been carrying the pager".
const carriers = computed<Carrier[]>(() => {
  const members = (props.load?.members ?? []).filter((m) => m.pages > 0 || m.acks > 0);
  const total = members.reduce((sum, m) => sum + m.pages, 0);

  return members
    .sort((a, b) => b.pages - a.pages || a.user_email.localeCompare(b.user_email))
    .map((m) => {
      const share = total ? m.pages / total : 0;
      // Nights are called out separately because they are the cost people
      // actually feel, and an even page count can hide an uneven night count.
      const summary = m.nights
        ? t("oncall.loadBalancePagesNights", { pages: m.pages, nights: m.nights })
        : t("oncall.loadBalancePages", { count: m.pages }, m.pages);
      return {
        user_email: m.user_email,
        share,
        summary,
        tone: (share > UNEVEN_SHARE ? "warning" : "default") as ProgressBarVariant,
      };
    });
});

const rotations = computed<RotationFairness[]>(() => props.load?.rotations ?? []);
</script>
