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
    <div v-show="!expanded" class="flex shrink-0 items-start gap-2">
      <OStatStrip
        class="min-w-0 flex-1"
        :items="stats"
        compact
        selectable
        :selected-key="null"
        @select="onStatSelect"
      />
      <ORefreshButton
        layout="inline"
        variant="outline"
        :last-run-at="lastUpdatedAt || null"
        :loading="fetching"
        data-test="fleet-overview-refresh"
        @click="refetch"
      />
    </div>
    <FleetFlowOverview
      v-model:expanded="expanded"
      class="min-h-0 flex-1"
      @navigate="(tab, query) => emit('navigate', tab, query)"
      @outdated="emit('navigate', 'fleets', { scope: 'all', status: 'outdated' })"
    />
  </OContent>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OContent from "@/lib/core/Content/OContent.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import FleetFlowOverview from "./FleetFlowOverview.vue";
import type { FleetTab } from "./fleetRoute";
import { useFleetSummary } from "./useFleetApi";

const emit = defineEmits<{
  navigate: [tab: FleetTab, query?: Record<string, string>];
}>();

const DASH = raw("—");
const { t } = useI18nTyped();
const { summary, fetching, lastUpdatedAt, refetch } = useFleetSummary(FLOW_POLL_MS);
const expanded = ref(false);

// The summary already covers only the fleets the caller may read.
const stats = computed<StatItem[]>(() => {
  const counts = summary.value?.collectors;
  const total = counts?.total;
  const n = (key: keyof NonNullable<typeof counts>) => counts?.[key] ?? DASH;
  const items: StatItem[] = [
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
    {
      key: "outdated",
      label: t("fleet.stats.outdated"),
      value: n("outdated"),
      icon: "update",
      tone: "info",
      max: total,
    },
    {
      key: "rollouts",
      label: t("fleet.stats.activeRollouts"),
      value: summary.value?.rollouts_active ?? DASH,
      icon: "rocket-launch",
      tone: "primary",
      selectable: false,
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
      key: "total",
      label: t("fleet.stats.total"),
      value: n("total"),
      icon: "dns",
      tone: "neutral",
    },
  ];
  return items.map((item) => ({ ...item, dataTest: `fleet-overview-stat-${item.key}` }));
});

function onStatSelect(key: string) {
  emit("navigate", "fleets", { scope: "all", ...(key === "total" ? {} : { status: key }) });
}
</script>
