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
  <OContent y class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto" data-test="fleet-overview">
    <OEmptyState
      v-if="forbidden"
      size="block"
      preset="no-access"
      data-test="fleet-overview-forbidden"
    />
    <OBanner
      v-else-if="summaryError"
      variant="error"
      dense
      :content="t('fleet.common.loadFailed')"
      data-test="fleet-overview-error"
    >
      <template #actions>
        <OButton variant="outline" size="sm" data-test="fleet-overview-retry" @click="retry">
          {{ t("common.retry") }}
        </OButton>
      </template>
    </OBanner>
    <div v-if="!forbidden" v-show="!mapExpanded" class="flex shrink-0 items-start gap-2">
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
        :last-run-at="lastUpdatedAt"
        :loading="fetching"
        data-test="fleet-overview-refresh"
        @click="retry"
      />
    </div>
    <OCard
      v-if="!forbidden && activeCardShown"
      v-show="!mapExpanded"
      ref="activeCard"
      variant="outlined"
      class="shrink-0"
      data-test="fleet-overview-active-rollouts"
    >
      <OCardSection role="header">
        <div class="flex items-center gap-2">
          <OText variant="panel-title">{{ t("fleet.rollouts.activeTitle") }}</OText>
          <OText variant="meta" data-test="fleet-overview-active-rollouts-count">{{
            rolloutsForbidden || rolloutsError ? DASH : activeRollouts.length
          }}</OText>
        </div>
      </OCardSection>
      <OCardSection v-if="rolloutsStale" role="body">
        <OBanner
          variant="error"
          dense
          :content="t('fleet.common.loadFailed')"
          data-test="fleet-overview-active-rollouts-stale"
        />
      </OCardSection>
      <FleetRolloutTable
        :rows="activeRollouts"
        show-fleet
        :loading="rollouts.loading.value"
        :error="rolloutsError"
        :forbidden="rolloutsForbidden"
        data-test="fleet-overview-active-rollouts-table"
        @open="openRollout"
        @retry="rollouts.refetch()"
      />
    </OCard>
    <FleetFlowOverview
      v-if="!forbidden"
      v-model:expanded="mapExpanded"
      :class="mapExpanded ? 'max-lg:flex-none' : 'min-h-[max(40rem,calc(100vh-12rem))] shrink-0'"
      @navigate="(tab, query) => emit('navigate', tab, query)"
      @outdated="showOutdated"
    />
    <FleetCollectorVersions
      v-if="!forbidden"
      v-show="!mapExpanded"
      ref="versions"
      class="shrink-0"
    />
  </OContent>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import { FLOW_POLL_MS } from "@/services/fleet.queries";
import FleetFlowOverview from "./FleetFlowOverview.vue";
import FleetCollectorVersions from "./FleetCollectorVersions.vue";
import FleetRolloutTable from "./FleetRolloutTable.vue";
import type { FleetTab } from "./fleetRoute";
import {
  byActiveThenNewest,
  isActiveRollout,
  isForbidden,
  useFleetRollouts,
  useFleetSummary,
  type RolloutRow,
} from "./useFleetApi";

const emit = defineEmits<{
  navigate: [tab: FleetTab, query?: Record<string, string>];
}>();

const DASH = raw("—");

const { t } = useI18nTyped();
const orgId = useOrgId();

const summaryQuery = useFleetSummary(FLOW_POLL_MS);
const summaryError = summaryQuery.error;
const forbidden = computed(() => isForbidden(summaryError.value));
const fetching = summaryQuery.fetching;
const lastUpdatedAt = summaryQuery.lastUpdatedAt;
const rollouts = useFleetRollouts();
const activeRollouts = computed(() =>
  rollouts.rows.value.filter(isActiveRollout).sort(byActiveThenNewest),
);
const rolloutsForbidden = computed(() => isForbidden(rollouts.error.value));
// Judged on the active rows: cached inactive rows must not hide a failed read.
const rolloutsError = computed(() =>
  rollouts.error.value && !rolloutsForbidden.value && !activeRollouts.value.length
    ? String(rollouts.error.value)
    : null,
);
const rolloutsStale = computed(
  () => !!rollouts.error.value && !rolloutsForbidden.value && activeRollouts.value.length > 0,
);
const activeCardShown = computed(
  () => activeRollouts.value.length > 0 || rolloutsForbidden.value || !!rolloutsError.value,
);
const activeCard = ref<{ $el: HTMLElement } | null>(null);
const versions = ref<{ refreshCollectors: () => void; scrollToOutdated: () => void } | null>(null);
const mapExpanded = ref(false);

// The flow map sits under the stat strip, so a refresh must never leave it older than the tiles.
const retry = () => {
  summaryQuery.refetch();
  rollouts.refetch();
  versions.value?.refreshCollectors();
  queryClient.invalidateQueries({ queryKey: fleetKeys.flows(orgId.value) });
};

const stats = computed<StatItem[]>(() => {
  const counts = summaryQuery.summary.value?.collectors;
  const total = counts?.total;
  const n = (key: keyof NonNullable<typeof counts>) => counts?.[key] ?? DASH;
  return [
    {
      key: "offline",
      label: t("fleet.stats.offline"),
      value: n("offline"),
      icon: "cloud-off",
      tone: "error",
      max: total,
      dataTest: "fleet-overview-stat-offline",
    },
    {
      key: "drifted",
      label: t("fleet.stats.drifted"),
      value: n("drifted"),
      icon: "sync-problem",
      tone: "warning",
      max: total,
      dataTest: "fleet-overview-stat-drifted",
    },
    {
      key: "outdated",
      label: t("fleet.stats.outdated"),
      value: n("outdated"),
      icon: "update",
      tone: "orange",
      max: total,
      dataTest: "fleet-overview-stat-outdated",
    },
    {
      key: "rollouts",
      label: t("fleet.stats.rolloutsInProgress"),
      value: summaryQuery.summary.value?.rollouts_active ?? DASH,
      icon: "rocket-launch",
      tone: "primary",
      selectable: activeCardShown.value,
      dataTest: "fleet-overview-stat-rollouts",
    },
    {
      key: "online",
      label: t("fleet.stats.online"),
      value: n("online"),
      icon: "check-circle",
      tone: "success",
      max: total,
      dataTest: "fleet-overview-stat-online",
    },
    {
      key: "total",
      label: t("fleet.stats.total"),
      value: n("total"),
      icon: "dns",
      tone: "neutral",
      dataTest: "fleet-overview-stat-total",
    },
  ];
});

function openRollout(r: RolloutRow) {
  emit("navigate", "fleets", { folder: r.fleetId, rollout: r.id });
}

function scrollTo(el: HTMLElement | undefined) {
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The versions card is hidden while the map is expanded, so it can only be scrolled to once it shows.
async function showOutdated() {
  mapExpanded.value = false;
  await nextTick();
  versions.value?.scrollToOutdated();
}

function onStatSelect(key: string) {
  if (key === "rollouts") scrollTo(activeCard.value?.$el);
  else if (key === "outdated") showOutdated();
  else emit("navigate", "fleets", { scope: "all", ...(key === "total" ? {} : { status: key }) });
}
</script>
