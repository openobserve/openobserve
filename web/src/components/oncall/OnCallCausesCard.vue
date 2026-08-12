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
  What keeps breaking us.

  Backed by `GET /oncall/analytics/causes`, which is the only analytics endpoint
  that exists and the only one safe to put on a tile: it counts causes in the
  DATABASE over a window, so it describes the org rather than whichever page of
  records happened to come back. This replaced a median-time-to-ack tile that
  averaged a fetched page — API-FOR-UI.md §E.3 names that tile and says not to
  ship it.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-1.5 border px-3.5 py-2.5"
    data-test="oncall-causes-card"
  >
    <span class="flex items-center gap-1.5">
      <OIcon name="lightbulb-outline" size="xs" class="text-text-secondary" />
      <OText variant="section">
        {{ t("oncall.causesTitle") }}
      </OText>
      <span class="text-text-secondary ms-auto text-2xs">
        {{ t("oncall.causesHint", { days: windowDays }) }}
      </span>
    </span>

    <!-- A cause is recorded at resolve, so an org that never fills it in has
         nothing here — which is a different fact from "nothing broke". -->
    <p
      v-if="!leader"
      class="text-text-secondary text-sm"
      data-test="oncall-causes-empty"
    >
      {{ t("oncall.causesNone") }}
    </p>

    <template v-else>
      <span class="flex flex-wrap items-baseline gap-x-2">
        <span
          class="text-text-heading text-2xl leading-none font-semibold"
          data-test="oncall-causes-share"
        >
          {{ leaderShare }}
        </span>
        <span class="text-text-body truncate text-sm" data-test="oncall-causes-leader">
          {{ t(`oncall.cause_${leader.cause}`) }}
        </span>
      </span>

      <p class="text-text-secondary truncate text-xs" data-test="oncall-causes-detail">
        {{ detail }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { CauseAnalytics, CauseCount } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ analytics: CauseAnalytics | null }>();

const { t } = useI18nTyped();

/// Read from the window the SERVER answered for, not from a local constant —
/// the endpoint defaults the range when the client omits it, so echoing our own
/// guess could label the tile with a period it did not count.
const windowDays = computed(() => {
  const span = (props.analytics?.to ?? 0) - (props.analytics?.from ?? 0);
  return span > 0 ? Math.max(1, Math.round(span / MICROS_PER_DAY)) : 30;
});

/// The biggest cause. Sorted here rather than trusted from the wire: the
/// endpoint makes no ordering promise, and "what keeps breaking us" is
/// meaningless if it names the wrong row.
const leader = computed<CauseCount | null>(() => {
  const causes = props.analytics?.causes ?? [];
  if (!causes.length || !props.analytics?.total) return null;
  return [...causes].sort((a, b) => b.count - a.count)[0];
});

function share(count: number): I18nText {
  const total = props.analytics?.total ?? 0;
  return raw(total ? `${Math.round((count / total) * 100)}%` : "");
}

const leaderShare = computed<I18nText>(() => (leader.value ? share(leader.value.count) : raw("")));

/// The runner-up plus what the leader's most recent example actually was — a
/// cause name alone rarely tells somebody which alert to go and fix.
const detail = computed<I18nText>(() => {
  const causes = [...(props.analytics?.causes ?? [])].sort((a, b) => b.count - a.count);
  const parts: string[] = [];

  const runnerUp = causes[1];
  if (runnerUp) {
    parts.push(
      `${String(share(runnerUp.count))} ${String(t(`oncall.cause_${runnerUp.cause}`))}`,
    );
  }
  const example = leader.value?.last_title;
  if (example) parts.push(String(t("oncall.causesLatest", { name: raw(example) })));

  return raw(parts.join(" · "));
});
</script>
