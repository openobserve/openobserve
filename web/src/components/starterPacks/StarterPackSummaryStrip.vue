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

<script setup lang="ts">
import { computed } from "vue";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatTone } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { staleSinceText } from "@/composables/starterPacks/usePackHealth";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

interface Tile {
  key: string;
  label: I18nText;
  value: number | string;
  max?: number;
  sub: I18nText;
  icon: IconName;
  tone: StatTone;
}

const props = defineProps<{ page: StarterPackPage }>();

const { t } = useI18nTyped();
const flow = props.page.flow;

const none = () => t("starterPacks.page.strip.none");
const madeCount = (kind: "dashboard" | "savedView") =>
  props.page.contents.value.filter((row) => row.kind === kind && row.state === "created").length;

const alertsTile = computed<Tile>(() => {
  const base = { key: "alerts", icon: "notifications" as const };
  if (!props.page.installed.value) {
    const count = flow.alertCount.value;
    return {
      ...base,
      label: t("starterPacks.page.strip.alerts"),
      value: "—",
      sub:
        count === null
          ? raw("")
          : count
            ? t("starterPacks.page.strip.willAddAlerts", { count }, count)
            : none(),
      tone: "neutral",
    };
  }
  const total = props.page.turn.rows.value.length;
  if (!total)
    return {
      ...base,
      label: t("starterPacks.page.strip.alerts"),
      value: "—",
      sub: none(),
      tone: "neutral",
    };
  const active = props.page.onRows.value.length;
  const firing = props.page.contents.value.filter(({ state }) => state === "firing").length;
  const paused = total - active;
  const sub = firing
    ? t("starterPacks.page.strip.firing", { count: firing })
    : paused
      ? t("starterPacks.page.strip.paused", { count: paused })
      : t("starterPacks.page.strip.allActive");
  const tone: StatTone = firing ? "error" : active === total ? "success" : "warning";
  return {
    ...base,
    label: t("starterPacks.page.strip.alertsActive"),
    value: active,
    max: total,
    sub,
    tone,
  };
});

const countTile = (
  key: string,
  kind: "dashboard" | "savedView",
  icon: IconName,
  label: I18nText,
  planned: number | null,
): Tile => {
  if (!props.page.installed.value) {
    const sub =
      planned === null
        ? raw("")
        : planned
          ? t("starterPacks.page.strip.willAdd", { count: planned })
          : none();
    return { key, label, value: "—", sub, icon, tone: "neutral" };
  }
  const count = madeCount(kind);
  return { key, label, value: count || "—", sub: count ? raw("") : none(), icon, tone: "neutral" };
};

const streamsTile = computed<Tile>(() => {
  const base = {
    key: "streams",
    icon: "activity" as const,
    label: t("starterPacks.page.strip.streams"),
  };
  const rows = props.page.streamHealth.value;
  if (!rows.length) return { ...base, value: "—", sub: none(), tone: "neutral" };
  const receiving = rows.filter(({ state }) => state === "receiving").length;
  const broken = props.page.brokenStreams.value;
  const newest = Math.max(0, ...rows.map(({ lastUs }) => lastUs ?? 0));
  // The longest-stopped stream, as the notice names it.
  const stopped = broken
    .filter(({ state }) => state === "stopped")
    .sort((a, b) => (a.lastUs ?? 0) - (b.lastUs ?? 0))[0];
  const sub = stopped
    ? t("starterPacks.page.strip.stoppedSince", {
        stream: raw(stopped.name),
        since: raw(staleSinceText(stopped.lastUs)),
      })
    : broken.length
      ? t("starterPacks.page.strip.neverReceived", { count: broken.length })
      : newest
        ? t("starterPacks.page.strip.lastData", { since: raw(staleSinceText(newest)) })
        : raw("");
  const tone: StatTone = broken.length
    ? "error"
    : receiving === rows.length
      ? "success"
      : "warning";
  return { ...base, value: receiving, max: rows.length, sub, tone };
});

const tiles = computed<Tile[]>(() => [
  alertsTile.value,
  countTile(
    "dashboards",
    "dashboard",
    "dashboard",
    t("starterPacks.page.strip.dashboards"),
    flow.dashboardCount.value,
  ),
  countTile(
    "views",
    "savedView",
    "bookmark",
    t("starterPacks.page.strip.views"),
    flow.viewCount.value,
  ),
  streamsTile.value,
]);
</script>

<template>
  <OStatStrip data-test="starter-pack-page-strip">
    <OStatCard
      v-for="tile in tiles"
      :key="tile.key"
      class="grow basis-52 max-lg:shrink-0 max-lg:basis-auto"
      :label="tile.label"
      :value="tile.value"
      :max="tile.max"
      :sub="tile.sub || undefined"
      sub-below
      :hide-bar="tile.max === undefined"
      :icon="tile.icon"
      :tone="tile.tone"
      :data-test="`starter-pack-page-tile-${tile.key}`"
    >
      <template v-if="tile.max !== undefined" #value
        >{{ tile.value
        }}<span class="text-text-secondary text-base font-medium">{{
          raw(` / ${tile.max}`)
        }}</span></template
      >
    </OStatCard>
  </OStatStrip>
</template>
