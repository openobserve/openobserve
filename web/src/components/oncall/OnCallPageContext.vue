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
  What a responder should know before claiming a page.

  Both facts are ones we already stored — how often this subject has fired, and
  what a human said it turned out to be last time. Nothing here is inferred: an
  alert that usually turns out to be a noisy threshold is a different decision
  from one that has never fired before.
-->
<template>
  <div class="flex flex-col gap-2" data-test="oncall-page-context">
    <OText variant="section">{{ t("oncall.contextTitle") }}</OText>

    <dl class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
      <dt class="text-text-secondary text-xs">{{ t("oncall.contextFired") }}</dt>
      <dd class="text-text-body text-sm" data-test="oncall-context-fired">
        <span v-if="firings.length">
          {{ t("oncall.contextFiredCount", { count: firings.length + 1, days: windowDays }) }}
        </span>
        <span v-else class="text-text-secondary">{{ t("oncall.contextNoHistory") }}</span>
      </dd>

      <!-- Only rendered when a human actually recorded a cause. A blank row
           would read as "nobody knows", which is a different claim from
           "nobody has written it down". -->
      <template v-if="lastCause">
        <dt class="text-text-secondary text-xs">{{ t("oncall.contextLastCause") }}</dt>
        <dd class="flex flex-wrap items-baseline gap-1.5" data-test="oncall-context-cause">
          <OTag variant="default-soft" size="sm">
            {{ t(`oncall.cause_${lastCause.cause}`) }}
          </OTag>
          <span v-if="lastCause.note" class="text-text-body text-sm italic">
            {{ raw(`“${lastCause.note}”`) }}
          </span>
          <OTimeCell v-if="lastCause.last_closed_at" :value="lastCause.last_closed_at" unit="us" />
        </dd>
      </template>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { CauseGroup, OnCallResponse } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Past firings of the same subject, excluding this one (the server omits it). */
    firings?: OnCallResponse[];
    /** What those firings turned out to be, grouped by cause. */
    causes?: CauseGroup[];
    /** Window the firing count describes, in micros. */
    windowMicros?: number;
  }>(),
  { firings: () => [], causes: () => [], windowMicros: 7 * MICROS_PER_DAY },
);

const { t } = useI18nTyped();

const windowDays = computed(() => Math.round(props.windowMicros / MICROS_PER_DAY));

/// The most recently closed cause, not the most frequent: "what was it last
/// time" is the question being asked before claiming this firing.
const lastCause = computed<CauseGroup | null>(() => {
  const dated = props.causes.filter((group) => !!group.last_closed_at);
  if (!dated.length) return props.causes[0] ?? null;
  return [...dated].sort((a, b) => (b.last_closed_at ?? 0) - (a.last_closed_at ?? 0))[0];
});
</script>
