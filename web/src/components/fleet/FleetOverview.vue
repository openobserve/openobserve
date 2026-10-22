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
  <OContent y class="flex min-h-0 flex-1 flex-col gap-3" data-test="fleet-overview">
    <FleetTokenExpiryBanner
      v-show="!expanded"
      class="shrink-0"
      @open-collector="(c) => emit('navigate', 'fleets', { fleet: c.fleetId, collector: c.id })"
      @open-tokens="(fleetId) => emit('navigate', 'fleets', { fleet: fleetId, tokens: '1' })"
    />
    <OStatStrip
      v-show="!expanded"
      class="shrink-0"
      :items="stats"
      compact
      selectable
      :selected-key="null"
      @select="onStatSelect"
    />
    <FleetFlowOverview
      v-model:expanded="expanded"
      class="min-h-0 flex-1"
      @refresh="refetch"
      @navigate="(tab, query) => emit('navigate', tab, query)"
      @outdated="emit('navigate', 'fleets', { scope: 'all', status: 'outdated' })"
    />
  </OContent>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import FleetFlowOverview from "./FleetFlowOverview.vue";
import FleetTokenExpiryBanner from "./FleetTokenExpiryBanner.vue";
import type { FleetTab } from "./fleetRoute";
import { useFleetSummary } from "./useFleetApi";

const emit = defineEmits<{
  navigate: [tab: FleetTab, query?: Record<string, string>];
}>();

const DASH = raw("—");
const { t } = useI18nTyped();
const { summary, refetch } = useFleetSummary(FLOW_POLL_MS);
const expanded = ref(false);

// The summary already covers only the fleets the caller may read; largest count first.
const stats = computed<StatItem[]>(() => {
  const counts = summary.value?.collectors;
  const total = counts?.total;
  const n = (key: keyof NonNullable<typeof counts>) => counts?.[key] ?? DASH;
  const items: StatItem[] = [
    {
      key: "total",
      label: t("fleet.stats.total"),
      value: n("total"),
      icon: "dns",
      tone: "neutral",
    },
    {
      key: "online",
      label: t("fleet.stats.online"),
      value: n("online"),
      icon: "check-circle",
      tone: "success",
      max: total,
    },
    {
      key: "offline",
      label: t("fleet.stats.offline"),
      value: n("offline"),
      icon: "cloud-off",
      tone: "error",
      max: total,
    },
    {
      key: "degraded",
      label: t("fleet.stats.degraded"),
      value: n("degraded"),
      icon: "warning",
      tone: "warning",
      max: total,
    },
    {
      key: "unknown",
      label: t("fleet.stats.unknown"),
      value: n("unknown"),
      icon: "help-outline",
      tone: "neutral",
      max: total,
    },
  ];
  return items.map((item) => ({ ...item, dataTest: `fleet-overview-stat-${item.key}` }));
});

function onStatSelect(key: string) {
  emit("navigate", "fleets", { scope: "all", ...(key === "total" ? {} : { status: key }) });
}
</script>
