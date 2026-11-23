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
  <div>
    <h2 class="text-text-heading text-base font-bold">
      {{ t("rum.overviewPage.frustrationTitle") }}
    </h2>
    <p class="text-text-secondary mt-1 text-sm">{{ t("rum.overviewPage.frustrationHint") }}</p>
    <div class="mt-3 grid grid-cols-2 gap-3">
      <KpiCard
        v-for="tile in tiles"
        :key="tile.key"
        as="router-link"
        :to="sessionsLink(tile.filter)"
        :label="tile.label"
        :aria-label="
          t('rum.overviewPage.tileOpenSessions', {
            label: tile.label,
            value: raw(formatCount(tile.value)),
          })
        "
        class="no-underline"
        :data-test="`rum-overview-frustration-${tile.key}`"
      >
        <template #value>
          <span class="text-text-heading text-xl font-bold">{{ formatCount(tile.value) }}</span>
          <span class="text-text-secondary text-xs lg:hidden">
            {{ tile.label }} ·
            <span :class="TONE[tile.delta?.tone ?? 'flat']">{{ tile.deltaText }}</span>
          </span>
        </template>
        <template #trend>
          <span class="text-xs font-semibold" :class="TONE[tile.delta?.tone ?? 'flat']">
            {{ tile.deltaText }}
          </span>
        </template>
      </KpiCard>
    </div>
    <router-link
      v-if="(cur?.rage ?? 0) + (cur?.dead ?? 0) > 0"
      :to="replaysLink"
      class="text-text-link mt-3 inline-block text-sm font-bold"
      data-test="rum-overview-frustration-replays"
    >
      {{ t("rum.overviewPage.frustrationReplayLink") }} →
    </router-link>
    <p v-if="(cur?.rage ?? 0) + (cur?.dead ?? 0) > 0" class="text-text-secondary mt-1 text-xs">
      {{ t("rum.overviewPage.frustrationReplayHint") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import KpiCard from "@/components/common/KpiCard.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { deltaSentenceKey, formatCount, kpiDelta } from "@/utils/rum/performanceOverview";

const props = defineProps<{
  cur: { rage: number; dead: number } | null;
  prev: { rage: number; dead: number } | null;
  sessionsLink: (filter: string) => RouteLocationRaw;
  replaysLink: RouteLocationRaw;
}>();
const { t } = useI18nTyped();

const TONE = {
  good: "text-status-success-text",
  bad: "text-status-error-text",
  flat: "text-text-secondary",
} as const;

const tiles = computed(() =>
  (["rage", "dead"] as const).map((key) => {
    const delta = kpiDelta(props.cur?.[key] ?? null, props.prev?.[key] ?? null, {
      higherIsBetter: false,
    });
    return {
      key,
      label: t(key === "rage" ? "rum.overviewPage.rageClicks" : "rum.overviewPage.deadClicks"),
      value: props.cur?.[key] ?? 0,
      delta,
      deltaText: delta
        ? t(deltaSentenceKey(delta, false), { delta: raw(delta.text) })
        : t("rum.overviewPage.deltaNoPrev"),
      filter: `strpos(action_frustration_type, '${key}_click') > 0`,
    };
  }),
);
</script>
